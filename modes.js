// modes.js — «Режимы» (2.3.12): «Призрачная гонка» (ghosts of the daily tracks) and «Столкни» (online push duel / 4 players).
//
//   GET  /api/v2/modes/tracks                         today's 3 ghost tracks {id, len, day, ends}
//   GET  /api/v2/modes/ghost_top?track=               the 20 best ghosts of a track
//   GET  /api/v2/modes/ghost?track=&acc= | &nick= | &top=1   one ghost: {acc, nick, skin, trail, ms, inp}
//   POST /api/v2/modes/ghost_submit {id,secret,track,inp,ms,vs?,skin?,trail?}   a finished run (inputs) → re-simulated here
//   POST /api/v2/modes/ghost_me     {id,secret}       my bests on today's tracks + today's rewards
//   POST /api/v2/modes/push_find    {id,secret,dev?,size:2|4}   → {wait:true, n} (poll every ~1.5 s) | {match, ticket, size}
//   POST /api/v2/modes/push_cancel  {id,secret}
//   POST /api/v2/modes/push_me      {id,secret}       rating, games, rewarded wins today
//   GET  /api/v2/modes/push_top                       the 20 best ratings
//   WS   /api/v2/modes/push_ws?m=<match>              the match (PushMatch, protocol below)
//
// Fairness / anti-cheat (the same gates as runs and the raid):
//   * identity = the account (Accounts DO auth); suspended / banned / no consent → no online modes (accounts_guard gate);
//     the Online DO ban flag is checked again; per-IP / per-account / per-device limits; cooldown between submits;
//   * a ghost is only seed + inputs: the server replays it with modes_core.js (the game's own file) and accepts only the time
//     it computes itself (±1 ms); impossible press rates / unfinished runs / a wrong time → refused and flagged in Online;
//   * «Столкни» physics run only here (PushMatch, 30 ticks/s); a phone sends swipes / brace, never positions; dash cooldown,
//     message rate and size are enforced here; a flood is kicked;
//   * matchmaking reuses the raid's rules: never two accounts of one device in a match (hard), the same IP + a young account /
//     a shared device history → another opponent (soft, CGNAT-safe), same-IP pairs logged;
//   * rating Elo; rewards small with daily caps, written once per (match, account) through the Online inbox (rewards journal →
//     the god panel's rollback works); the same two accounts more than PAIR_MAX times a day → no rating, no reward (anti-farm);
//   * skins / trails are looks only (ids [a-z0-9_]).
//
// PushMatch protocol (JSON text frames ≤ 1 KB):
//   C→S {t:'join', id, secret, ticket, skin?, trail?}   S→C {t:'joined', you, size, players:[{slot,nick,skin,trail,r,on}], seed, phase, round, score, now, tps}
//   C→S {t:'in', q, dx, dy}  a dash (world direction, any length)      C→S {t:'br', q, on:0|1}  brace
//   C→S {t:'ping', c}  S→C {t:'pong', c, s}             C→S {t:'leave'}
//   S→C {t:'round', n, at, seed, score}   (round world n starts at server time `at`; tick 0 = at)
//   S→C {t:'s', k, st, ps:[[slot, x, y, vx, vy, brace, cd, alive, ack]]}  every 2 ticks; x … in mm, mm/s
//   S→C {t:'rend', n, win, score}    S→C {t:'end', ranks:[slot…], res:{slot:{r, d, gems, why}}}   S→C {t:'pl', players}
//   S→C {t:'err', e}  close 4001 auth, 4003 refused, 4005 replaced (another tab), 4008 flood

import { accCall } from "./accounts.js";
import { gate } from "./accounts_guard.js";
import { seatCheck } from "./raid3.js";   // the raid's seat rules (read-only use)
import { ModesCore as MC } from "./modes_core.js";

const ACC_RE = /^[0-9a-f]{12}$/;
const DEV_RE = /^[0-9a-f]{16,64}$/;
const SKIN_RE = /^[a-z0-9_]{1,24}$/;
const MATCH_RE = /^p[0-9]{1,9}$/;
const nowS = () => Math.floor(Date.now() / 1000);
export const MODES = {
  ghost: { finish: 10, beat: 8, dayCap: 60, cooldownSec: 4, top: 20 },
  push: { win: 15, dayWins: 5, pairMax: 3, k2: 32, k4: 16, r0: 1000, waitSec: 8, fourAfterSec: 20, joinSec: 12, offSec: 25, maxRounds: 7 },
  youngSec: 24 * 3600,
};
function testOn(env) { return env.MODES_TEST === "1"; }
// MODES_TEST only: a shorter countdown / pause between rounds (the physics and the round clock stay the game's)
function countSec(env) { const v = Number(env.MODES_COUNT_SEC); return testOn(env) && v > 0 ? v : MC.PU.COUNT; }
function gapSec(env) { const v = Number(env.MODES_GAP_SEC); return testOn(env) && v > 0 ? v : MC.PU.BETWEEN; }
function youngSec(env) { const v = Number(env.MODES_YOUNG_SEC); return testOn(env) && v > 0 ? v : MODES.youngSec; }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function hex(b) { return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function token() { const b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b); }
async function ipKey(ip) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("modesip:" + ip)))).slice(0, 16); }
// the day of the ghost tracks (UTC); a run that started before midnight is accepted 15 min into the next day
export function trackOk(id, t = nowS()) {
  if (typeof id !== "string" || !MC.TRACK_RE.test(id)) return false;
  const d = id.slice(0, 10);
  return d === MC.dayKey(t) || d === MC.dayKey(t - 900);
}
async function authAcc(env, id, secret, dev) {
  try {
    const a = await accCall(env, "auth", { id, secret, raid: true, dev: typeof dev === "string" && DEV_RE.test(dev) ? dev : undefined });
    if (a && a.ok) return a;
    return a && a.err === "Аккаунт не найден" ? { bad: true } : { busy: true };
  } catch (e) { console.log("modes auth", e && e.message || e); return { busy: true }; }
}
async function whoOf(env, a, ip) {
  const r = (a && a.rd) || {}, dk = typeof r.sdev === "string" ? r.sdev : null;
  const devs = [...new Set([...(Array.isArray(r.devs) ? r.devs.filter((x) => typeof x === "string") : []), ...(dk ? [dk] : [])])].slice(0, 9);
  const created = Number(r.created) || 0;
  return { ipk: await ipKey(ip), dk, devs, young: created > 0 && nowS() - created < youngSec(env), g: !!(a && a.google) };
}
// Online DO: ban check, cheat flag, rewards (inbox + journal), god log (modes_online.js)
export async function onlineModes(env, body) {
  if (!env.ONLINE) return { err: "no_online" };
  const stub = env.ONLINE.get(env.ONLINE.idFromName("online"));
  const r = await stub.fetch("https://online/modes/internal", { method: "POST", headers: { "content-type": "application/json", "x-internal": "modes" }, body: JSON.stringify(body) });
  return r.json();
}
function hubStub(env) { return env.MODESHUB.get(env.MODESHUB.idFromName("hub")); }
async function hubCall(env, op, body) {
  const r = await hubStub(env).fetch("https://hub/int/" + op, { method: "POST", headers: { "content-type": "application/json", "x-internal": "modes" }, body: JSON.stringify(body || {}) });
  return r.json();
}

// ------------------------------------------------------------------ worker entry
const PUB = ["test_result", "tracks", "ghost_top", "ghost", "ghost_submit", "ghost_me", "push_find", "push_cancel", "push_me", "push_top"];
export async function handleModes(request, env) {
  if (!env.MODESHUB || !env.PUSHMATCH) return json({ err: "not_configured" }, 503);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" } });
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (url.pathname === "/api/v2/modes/push_ws") {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ err: "ws_only" }, 426);
    const m = url.searchParams.get("m") || "";
    if (!MATCH_RE.test(m)) return json({ err: "bad_match" }, 400);
    const h = new Headers(request.headers); h.set("x-ip", ip); h.set("x-match", m);
    try { return await env.PUSHMATCH.get(env.PUSHMATCH.idFromName("push:" + m)).fetch(new Request(request.url, { headers: h })); }
    catch (e) { console.log("modes ws", e && e.message || e); return json({ err: "busy" }, 503); }
  }
  const op = url.pathname.replace(/^\/api\/v2\/modes\//, "");
  if (!PUB.includes(op)) return json({ err: "unknown" }, 404);
  const get = ["tracks", "ghost_top", "ghost", "push_top"].includes(op);
  if (get !== (request.method === "GET")) return json({ err: "method" }, 405);
  const body = get ? null : (await request.text()).slice(0, 8192);
  let res;
  try { res = await hubStub(env).fetch("https://hub/pub/" + op + (get ? url.search.slice(0, 160) : ""), { method: request.method, headers: { "content-type": "application/json", "x-ip": ip }, body }); }
  catch (e) { console.log("modes hub", e && e.message || e); return json({ err: "busy" }, 503); }
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

// ------------------------------------------------------------------ hub: ghosts, push matchmaking, rating, rewards
export class ModesHub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    for (const q of [
      "CREATE TABLE IF NOT EXISTS ghost (track TEXT NOT NULL, acc TEXT NOT NULL, nick TEXT, skin TEXT, trail TEXT, ms INTEGER NOT NULL, inp TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (track, acc))",
      "CREATE INDEX IF NOT EXISTS ghost_ms ON ghost (track, ms)",
      "CREATE TABLE IF NOT EXISTS grw (day TEXT NOT NULL, acc TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, gems INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (day, acc, kind, ref))",
      "CREATE TABLE IF NOT EXISTS prate (acc TEXT PRIMARY KEY, nick TEXT, r INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS pmatch (match TEXT PRIMARY KEY, size INTEGER, seed INTEGER, accs TEXT, created INTEGER, res TEXT)",
      "CREATE TABLE IF NOT EXISTS ppair (day TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, a, b))",
      "CREATE TABLE IF NOT EXISTS pseat (acc TEXT PRIMARY KEY, match TEXT NOT NULL, ticket TEXT NOT NULL, slot INTEGER NOT NULL, exp INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)",
    ]) this.sql.exec(q);
    this.hits = new Map(); this.queue = new Map(); this.cd = new Map(); this.avoid = new Map();
  }
  one(q, ...b) { return this.sql.exec(q, ...b).toArray()[0] || null; }
  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  kv(k, v) {
    if (v === undefined) { const r = this.one("SELECT v FROM kv WHERE k = ?", k); return r ? JSON.parse(r.v) : null; }
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
  }
  limit(key, max, winSec) {
    const t = Date.now(), arr = (this.hits.get(key) || []).filter((x) => t - x < winSec * 1000);
    if (arr.length >= max) { this.hits.set(key, arr); return false; }
    arr.push(t); this.hits.set(key, arr); if (this.hits.size > 20000) this.hits.clear();
    return true;
  }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, ip = request.headers.get("x-ip") || "?";
    let body = {};
    if (request.method === "POST") { try { body = JSON.parse((await request.text()) || "{}"); } catch { return json({ err: "bad_json" }, 400); } }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ err: "bad_json" }, 400);
    try {
      if (path.startsWith("/int/")) {
        if (request.headers.get("x-internal") !== "modes") return json({ err: "forbidden" }, 403);
        const op = path.slice(5);
        if (op === "verify") return json(this.verify(body));
        if (op === "result") return json(await this.result(body));
        if (op === "free") return json(this.free(body));
        return json({ err: "unknown" }, 404);
      }
      if (!this.limit("ip:" + ip, 400, 60)) return json({ err: "rate" }, 429);   // a flood ceiling (one carrier IP may be a town)
      const op = path.replace(/^\/pub\//, ""), q = url.searchParams;
      if (op === "tracks") return json(this.tracks());
      if (op === "ghost_top") return json(...this.ghostTop(q.get("track"), q.get("me")));
      if (op === "ghost") return json(...this.ghostGet(q));
      if (op === "test_result") {   // MODES_TEST only: a finished match of given accounts straight into result() (rating / anti-farm / caps)
        if (!testOn(this.env)) return json({ err: "unknown" }, 404);
        let n = (this.kv("n") || 0) + 1; this.kv("n", n);
        const accs = (Array.isArray(body.accs) ? body.accs : []).filter((x) => ACC_RE.test(String(x))).slice(0, 4);
        this.sql.exec("INSERT INTO pmatch (match, size, seed, accs, created) VALUES (?, ?, 1, ?, ?)", "p" + n, accs.length, JSON.stringify(accs.map((x) => ({ acc: x, nick: "t", r: this.rating(x, null).r }))), nowS());
        return json({ match: "p" + n, ...await this.result({ match: "p" + n, ranks: body.ranks, rounds: 2, quit: body.quit }) });
      }
      if (op === "push_top") return json({ ok: true, rows: this.rows("SELECT acc, nick, r, games, wins FROM prate WHERE games > 0 ORDER BY r DESC, games DESC LIMIT 20") });
      // authenticated
      const { id, secret } = body;
      if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || secret.length > 64) return json({ err: "auth" }, 401);
      if (!this.limit("try:" + id + "|" + ip, 60, 60)) return json({ err: "rate" }, 429);
      const a = await authAcc(this.env, id, secret, body.dev);
      if (a.busy) return json({ err: "busy" }, 503);
      if (!a.ok) return json({ err: "auth" }, 401);
      if (!this.limit("acc:" + id, 60, 60)) return json({ err: "rate" }, 429);
      const g = gate(a, "online", this.env);
      if (g) return json({ err: g.err, pun: g.pun || null, terms_v: g.terms_v }, 403);
      if (op === "ghost_me") return json(this.ghostMe(id));
      if (op === "push_me") return json(this.pushMe(id, a.nick));
      if (op === "push_cancel") { this.queue.delete(id); return json({ ok: true }); }
      const chk = await onlineModes(this.env, { op: "check", acc: id }).catch(() => null);
      if (chk && chk.banned) return json({ err: "banned" }, 403);
      if (op === "ghost_submit") return json(...await this.ghostSubmit(id, a, body, ip));
      if (op === "push_find") return json(...await this.pushFind(id, a, body, ip));
      return json({ err: "unknown" }, 404);
    } catch (e) {
      console.log("modeshub error", e && e.stack || e);
      return json({ err: "server" }, 500);
    }
  }

  // ---------------------------------------------------------------- ghosts
  tracks() {
    const t = nowS(), day = MC.dayKey(t), ends = Date.parse(day + "T00:00:00Z") / 1000 + 86400;
    return { ok: true, day, ends, now: t, tracks: MC.trackIds(day).map((id, i) => ({ id, k: i + 1, len: MC.GH.TRACKS[i + 1].len, n: this.one("SELECT COUNT(*) AS n FROM ghost WHERE track = ?", id).n })),
      rewards: { finish: MODES.ghost.finish, beat: MODES.ghost.beat, dayCap: MODES.ghost.dayCap } };
  }
  ghostTop(track, me) {
    if (typeof track !== "string" || !MC.TRACK_RE.test(track)) return [{ err: "track" }, 400];
    const rows = this.rows("SELECT acc, nick, skin, trail, ms FROM ghost WHERE track = ? ORDER BY ms, at LIMIT ?", track, MODES.ghost.top).map((r, i) => ({ place: i + 1, ...r }));
    let mine = null;
    if (typeof me === "string" && ACC_RE.test(me)) {
      const m = this.one("SELECT ms FROM ghost WHERE track = ? AND acc = ?", track, me);
      if (m) mine = { ms: m.ms, place: this.one("SELECT COUNT(*) AS n FROM ghost WHERE track = ? AND ms < ?", track, m.ms).n + 1 };
    }
    return [{ ok: true, track, rows, me: mine, total: this.one("SELECT COUNT(*) AS n FROM ghost WHERE track = ?", track).n }, 200];
  }
  ghostGet(q) {
    const track = q.get("track");
    if (typeof track !== "string" || !MC.TRACK_RE.test(track)) return [{ err: "track" }, 400];
    let r = null;
    const acc = q.get("acc"), nick = q.get("nick");
    if (acc) { if (!ACC_RE.test(acc)) return [{ err: "bad_acc" }, 400]; r = this.one("SELECT * FROM ghost WHERE track = ? AND acc = ?", track, acc); }
    else if (nick) {   // any case, Cyrillic too (SQLite lower() is ASCII only)
      const want = String(nick).slice(0, 24).trim().toLowerCase();
      r = this.rows("SELECT * FROM ghost WHERE track = ? ORDER BY ms LIMIT 5000", track).find((x) => String(x.nick || "").toLowerCase() === want) || null;
    }
    else r = this.one("SELECT * FROM ghost WHERE track = ? ORDER BY ms, at LIMIT 1", track);
    if (!r) return [{ err: "no_ghost" }, 404];
    return [{ ok: true, track, acc: r.acc, nick: r.nick, skin: r.skin, trail: r.trail, ms: r.ms, inp: r.inp }, 200];
  }
  ghostMe(acc) {
    const day = MC.dayKey(nowS()), ids = MC.trackIds(day);
    const best = {}; for (const id of ids) { const r = this.one("SELECT ms FROM ghost WHERE track = ? AND acc = ?", id, acc); best[id] = r ? r.ms : null; }
    const got = this.one("SELECT COALESCE(SUM(gems), 0) AS g FROM grw WHERE day = ? AND acc = ? AND kind LIKE 'g_%'", day, acc).g;
    return { ok: true, day, best, gems: got, dayCap: MODES.ghost.dayCap };
  }
  // a reward once per (day, acc, kind, ref), inside the day cap of its group; → gems actually given (0 = none)
  reward(acc, kind, ref, gems, capKind, cap) {
    const day = MC.dayKey(nowS());
    if (this.one("SELECT 1 AS x FROM grw WHERE day = ? AND acc = ? AND kind = ? AND ref = ?", day, acc, kind, ref)) return { gems: 0, why: "once" };
    const had = this.one("SELECT COALESCE(SUM(gems), 0) AS g FROM grw WHERE day = ? AND acc = ? AND kind LIKE ?", day, acc, capKind + "%").g;
    const g = Math.max(0, Math.min(gems, cap - had));
    if (g <= 0) return { gems: 0, why: "cap" };
    this.sql.exec("INSERT INTO grw (day, acc, kind, ref, gems, at) VALUES (?, ?, ?, ?, ?, ?)", day, acc, kind, ref, g, nowS());
    return { gems: g, key: `${kind}:${day}:${acc}:${ref}` };
  }
  async ghostSubmit(acc, a, b, ip) {
    if (!trackOk(b.track)) return [{ err: "wrong_day" }, 400];
    const last = this.cd.get(acc) || 0;
    if (Date.now() - last < MODES.ghost.cooldownSec * 1000) return [{ err: "rate" }, 429];
    this.cd.set(acc, Date.now()); if (this.cd.size > 20000) this.cd.clear();
    const chk = MC.ghostProblem(b.track, b.inp, b.ms);
    if (!chk.ok) {
      if (chk.err !== "track") onlineModes(this.env, { op: "flag", acc, why: chk.err, src: "ghost" }).catch(() => {});
      return [{ err: chk.err }, 400];
    }
    const ms = chk.ms, nick = (a.nick || "Игрок").slice(0, 16);
    const skin = typeof b.skin === "string" && SKIN_RE.test(b.skin) ? b.skin : null, trail = typeof b.trail === "string" && SKIN_RE.test(b.trail) ? b.trail : null;
    const prev = this.one("SELECT ms FROM ghost WHERE track = ? AND acc = ?", b.track, acc);
    const improved = !prev || ms < prev.ms;
    if (improved) this.sql.exec("INSERT INTO ghost (track, acc, nick, skin, trail, ms, inp, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (track, acc) DO UPDATE SET nick = excluded.nick, skin = excluded.skin, trail = excluded.trail, ms = excluded.ms, inp = excluded.inp, at = excluded.at",
      b.track, acc, nick, skin, trail, ms, b.inp, nowS());
    else this.sql.exec("UPDATE ghost SET nick = ?, skin = COALESCE(?, skin), trail = COALESCE(?, trail) WHERE track = ? AND acc = ?", nick, skin, trail, b.track, acc);
    const best = improved ? ms : prev.ms, place = this.one("SELECT COUNT(*) AS n FROM ghost WHERE track = ? AND ms < ?", b.track, best).n + 1;
    // rewards: the first finish of each track today; beating another player's ghost (the one raced) once per (track, rival)
    const rw = [];
    const f = this.reward(acc, "g_fin", b.track, MODES.ghost.finish, "g_", MODES.ghost.dayCap); if (f.gems) rw.push({ why: "finish", ...f });
    let beat = false;
    if (typeof b.vs === "string" && ACC_RE.test(b.vs) && b.vs !== acc) {
      const v = this.one("SELECT ms FROM ghost WHERE track = ? AND acc = ?", b.track, b.vs);
      if (v && ms < v.ms) { beat = true; const q = this.reward(acc, "g_beat", b.track + ":" + b.vs, MODES.ghost.beat, "g_", MODES.ghost.dayCap); if (q.gems) rw.push({ why: "beat", ...q }); }
    }
    let gems = 0;
    for (const r of rw) {
      const gr = await onlineModes(this.env, { op: "grant", acc, gems: r.gems, key: r.key, src: "ghost3", why: r.why }).catch(() => null);
      if (gr && gr.ok) gems += r.gems;
    }
    const cap = this.one("SELECT COALESCE(SUM(gems), 0) AS g FROM grw WHERE day = ? AND acc = ? AND kind LIKE 'g_%'", MC.dayKey(nowS()), acc).g >= MODES.ghost.dayCap;
    return [{ ok: true, ms, best, improved, place, beat, gems, cap, hits: chk.run.hits }, 200];
  }

  // ---------------------------------------------------------------- push: rating + matchmaking
  rating(acc, nick) {
    let r = this.one("SELECT * FROM prate WHERE acc = ?", acc);
    if (!r) { this.sql.exec("INSERT INTO prate (acc, nick, r, games, wins, at) VALUES (?, ?, ?, 0, 0, ?)", acc, nick || null, MODES.push.r0, nowS()); r = this.one("SELECT * FROM prate WHERE acc = ?", acc); }
    else if (nick && nick !== r.nick) this.sql.exec("UPDATE prate SET nick = ? WHERE acc = ?", nick, acc);
    return r;
  }
  pushMe(acc, nick) {
    const r = this.rating(acc, nick), day = MC.dayKey(nowS());
    const w = this.one("SELECT COUNT(*) AS n FROM grw WHERE day = ? AND acc = ? AND kind = 'p_win'", day, acc).n;
    return { ok: true, r: r.r, games: r.games, wins: r.wins, today: w, dayWins: MODES.push.dayWins, win: MODES.push.win, place: this.one("SELECT COUNT(*) AS n FROM prate WHERE r > ? AND games > 0", r.r).n + 1 };
  }
  async pushFind(acc, a, b, ip) {
    const size = b.size === 4 ? 4 : 2;
    const me = { acc, ...await whoOf(this.env, a, ip) };
    if (me.dk && !this.limit("dev:" + me.dk, 80, 60)) return [{ err: "rate" }, 429];
    const t = nowS();
    this.sql.exec("DELETE FROM pseat WHERE exp < ?", t);
    const mine = this.one("SELECT * FROM pseat WHERE acc = ?", acc);
    if (mine) { this.queue.delete(acc); return [{ ok: true, match: mine.match, ticket: mine.ticket, slot: mine.slot, size: this.one("SELECT size FROM pmatch WHERE match = ?", mine.match)?.size || 2, again: true }, 200]; }
    const ms = Date.now();
    for (const [k, q] of this.queue) if (ms - q.at > MODES.push.waitSec * 1000) this.queue.delete(k);
    const r = this.rating(acc, a.nick);
    const ent = this.queue.get(acc) || { acc, first: ms };
    Object.assign(ent, { who: me, size, at: ms, r: r.r, nick: a.nick }); this.queue.set(acc, ent);
    // the others waiting for the same size that may sit with me (the raid's device / soft IP rules), oldest first
    const av = this.avoid.get(acc);
    const fits = (x, group) => {
      if (x.acc === acc || x.size !== size) return false;
      if (av && av.until > ms && av.with.includes(x.acc)) return false;
      const r2 = seatCheck(x.who, group.map((g) => g.who)); return r2.ok;
    };
    const group = [ent];
    for (const x of [...this.queue.values()].sort((p, q) => p.first - q.first)) { if (group.length >= size) break; if (fits(x, group)) group.push(x); }
    const oldest = Math.min(...group.map((g) => g.first));
    const go = group.length >= size || (size === 4 && group.length >= 2 && ms - oldest > MODES.push.fourAfterSec * 1000);
    if (!go) return [{ ok: true, wait: true, n: [...this.queue.values()].filter((x) => x.size === size).length, size }, 200];
    // a match: seats + tickets for everybody in the group (the others get theirs on their next poll — the seat is there)
    let n = (this.kv("n") || 0) + 1; this.kv("n", n);
    const match = "p" + n, seed = (Math.floor(Math.random() * 0x7fffffff) ^ n) >>> 0 || 1;
    const accs = group.map((g) => g.acc);
    this.sql.exec("INSERT INTO pmatch (match, size, seed, accs, created) VALUES (?, ?, ?, ?, ?)", match, group.length, seed, JSON.stringify(accs.map((x, i) => ({ acc: x, nick: (group[i].nick || "Игрок").slice(0, 16), r: group[i].r }))), t);
    let myTicket = null;
    group.forEach((g, i) => {
      const tk = token(); if (g.acc === acc) myTicket = tk;
      this.sql.exec("INSERT INTO pseat (acc, match, ticket, slot, exp) VALUES (?, ?, ?, ?, ?) ON CONFLICT (acc) DO UPDATE SET match = excluded.match, ticket = excluded.ticket, slot = excluded.slot, exp = excluded.exp", g.acc, match, tk, i, t + 15 * 60);
      this.queue.delete(g.acc);
    });
    const same = group.filter((g) => g.who.ipk === me.ipk).length;
    if (same >= 2) { console.log("modes ip pair", match, same); onlineModes(this.env, { op: "log", actor: acc, action: "sus:push_ip", args: { match, n: same, accs } }).catch(() => {}); }
    return [{ ok: true, match, ticket: myTicket, slot: 0, size: group.length }, 200];
  }
  verify({ acc, match, ticket }) {
    const s = this.one("SELECT * FROM pseat WHERE acc = ?", acc);
    if (!s || s.match !== match || s.ticket !== ticket || s.exp < nowS()) return { err: "ticket" };
    const m = this.one("SELECT * FROM pmatch WHERE match = ?", match); if (!m) return { err: "ticket" };
    return { ok: true, slot: s.slot, size: m.size, seed: m.seed, roster: JSON.parse(m.accs), done: !!m.res };
  }
  free({ match, accs, avoid }) {   // seats freed (a match that never started / refused a player)
    for (const a of Array.isArray(accs) ? accs : []) this.sql.exec("DELETE FROM pseat WHERE acc = ? AND match = ?", String(a), String(match));
    if (avoid && Array.isArray(accs)) for (const a of accs) this.avoid.set(String(a), { with: (Array.isArray(avoid) ? avoid : []).map(String), until: Date.now() + 10 * 60 * 1000 });
    return { ok: true };
  }
  // the end of a match: rating + rewards, written once (a retry gets the same answer)
  async result({ match, ranks, rounds, quit }) {
    const m = this.one("SELECT * FROM pmatch WHERE match = ?", String(match));
    if (!m) return { err: "match" };
    if (m.res) return { ok: true, again: true, res: JSON.parse(m.res) };
    const roster = JSON.parse(m.accs), day = MC.dayKey(nowS());
    const order = (Array.isArray(ranks) ? ranks : []).filter((s) => Number.isInteger(s) && roster[s]).slice(0, roster.length);
    const res = {};
    roster.forEach((x, i) => { res[i] = { r: this.rating(x.acc, x.nick).r, d: 0, gems: 0, why: null }; });
    const quitters = new Set(Array.isArray(quit) ? quit : []);
    if (order.length >= 2 && Number.isInteger(rounds) && rounds > 0) {
      const win = order[0], K = roster.length > 2 ? MODES.push.k4 : MODES.push.k2;
      // every pair with the winner (duel: one pair); a pair seen > pairMax times today counts for nothing
      const pairs = roster.map((_, i) => i).filter((i) => i !== win);
      let rated = 0;
      for (const l of pairs) {
        const A = roster[win].acc, B = roster[l].acc, [a, b] = A < B ? [A, B] : [B, A];
        this.sql.exec("INSERT INTO ppair (day, a, b, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, a, b) DO UPDATE SET n = n + 1", day, a, b);
        const n = this.one("SELECT n FROM ppair WHERE day = ? AND a = ? AND b = ?", day, a, b).n;
        if (n > MODES.push.pairMax) { res[l].why = res[l].why || "pair"; continue; }
        const [ra, rb] = MC.elo(res[win].r + res[win].d, res[l].r + res[l].d, 1, K);
        res[l].d += rb - (res[l].r + res[l].d); res[win].d += ra - (res[win].r + res[win].d); rated++;
      }
      if (!rated) res[win].why = "pair";
      for (let i = 0; i < roster.length; i++) {
        const x = roster[i];
        this.sql.exec("UPDATE prate SET r = MAX(100, r + ?), games = games + 1, wins = wins + ?, at = ? WHERE acc = ?", res[i].d, i === win ? 1 : 0, nowS(), x.acc);
        res[i].r = Math.max(100, res[i].r + res[i].d);
      }
      if (rated && !quitters.has(win)) {
        const cnt = this.one("SELECT COUNT(*) AS n FROM grw WHERE day = ? AND acc = ? AND kind = 'p_win'", day, roster[win].acc).n;
        if (cnt >= MODES.push.dayWins) res[win].why = "cap";
        else {
          const q = this.reward(roster[win].acc, "p_win", String(match), MODES.push.win, "p_win", MODES.push.win * MODES.push.dayWins);
          if (q.gems) { const gr = await onlineModes(this.env, { op: "grant", acc: roster[win].acc, gems: q.gems, key: q.key, src: "push3", why: "win" }).catch(() => null); if (gr && gr.ok) res[win].gems = q.gems; }
        }
      }
    }
    this.sql.exec("UPDATE pmatch SET res = ? WHERE match = ?", JSON.stringify(res), m.match);
    for (const x of roster) this.sql.exec("DELETE FROM pseat WHERE acc = ? AND match = ?", x.acc, m.match);
    return { ok: true, res };
  }
}

// ------------------------------------------------------------------ one push match
const PU = MC.PU;
const TICK_MS = 1000 / PU.TPS;
const MSG_MAX = 1024;
const RATE = 30, BURST = 60, FLOOD = 90;   // frames / s
export class PushMatch {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.name = null; this.phase = "new";   // new → wait → count → round → gap → … → end
    this.pl = []; this.socks = new Map(); this.round = 0; this.score = []; this.w = null; this.timer = null; this.endMsg = null; this.rounds = 0;
  }
  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ err: "ws_only" }, 426);
    if (!this.name) this.name = request.headers.get("x-match");
    const pair = new WebSocketPair(), ws = pair[1];
    ws.accept();
    const meta = { slot: null, joining: false, tok: BURST, tokAt: Date.now(), ip: request.headers.get("x-ip") || "?" };
    this.socks.set(ws, meta);
    ws.addEventListener("message", (e) => { this.onMsg(ws, meta, e.data).catch((err) => console.log("push msg", err && err.stack || err)); });
    ws.addEventListener("close", () => this.onClose(ws, meta));
    ws.addEventListener("error", () => this.onClose(ws, meta));
    setTimeout(() => { if (meta.slot == null && this.socks.has(ws)) { this.socks.delete(ws); try { ws.close(4002, "no_join"); } catch { /* */ } } }, 12000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* closed */ } }
  bcast(m) { const s = JSON.stringify(m); for (const p of this.pl) if (p && p.ws) { try { p.ws.send(s); } catch { /* */ } } }
  pub() { return this.pl.map((p, i) => p ? { slot: i, nick: p.nick, skin: p.skin, trail: p.trail, r: p.r, on: !!p.ws, left: !!p.left } : { slot: i, nick: "—", on: false, left: true }); }
  async onMsg(ws, meta, raw) {
    if (typeof raw !== "string" || raw.length > MSG_MAX) return;
    const t = Date.now();
    meta.tok = Math.min(BURST, meta.tok + (t - meta.tokAt) / 1000 * RATE) - 1; meta.tokAt = t;
    const p = meta.slot != null ? this.pl[meta.slot] : null;
    if (meta.tok < -FLOOD) { this.send(ws, { t: "err", e: "flood" }); try { ws.close(4008, "flood"); } catch { /* */ } if (p && this.env.ONLINE) onlineModes(this.env, { op: "flag", acc: p.acc, why: "push_flood", src: "push" }).catch(() => {}); return; }
    if (meta.tok < 0) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "ping") { this.send(ws, { t: "pong", c: m.c, s: Date.now() }); return; }
    if (m.t === "join") { if (meta.slot == null && !meta.joining) await this.join(ws, meta, m); return; }
    if (!p || p.ws !== ws) return;
    p.lastMsg = t;
    const q = Number.isInteger(m.q) && m.q > 0 && m.q < 1e9 ? m.q : 0;
    if (m.t === "in") { if (q > p.q && Number.isFinite(m.dx) && Number.isFinite(m.dy) && Math.abs(m.dx) <= 1000 && Math.abs(m.dy) <= 1000) { p.q = q; p.dash = [m.dx, m.dy]; } return; }
    if (m.t === "br") { if (q > p.q) { p.q = q; p.brace = m.on ? 1 : 0; } return; }
    if (m.t === "leave") { p.left = true; this.drop(p); try { ws.close(1000, "bye"); } catch { /* */ } }
  }
  refuse(ws, e) { this.send(ws, { t: "err", e }); try { ws.close(e === "auth" ? 4001 : e === "replaced" ? 4005 : e === "busy" ? 1013 : 4003, e); } catch { /* */ } }
  async join(ws, meta, m) {
    meta.joining = true;
    try {
      const { id, secret, ticket } = m;
      if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || typeof ticket !== "string" || ticket.length > 64) return this.refuse(ws, "auth");
      const a = await authAcc(this.env, id, secret);
      if (a.busy) return this.refuse(ws, "busy");
      if (!a.ok) return this.refuse(ws, "auth");
      const g = gate(a, "online", this.env); if (g) return this.refuse(ws, g.err);
      if (this.phase === "end") { const p0 = this.pl.find((x) => x && x.acc === id); if (p0 && this.endMsg) { this.send(ws, this.endMsg); try { ws.close(1000, "end"); } catch { /* */ } return; } return this.refuse(ws, "ended"); }
      let v; try { v = await hubCall(this.env, "verify", { acc: id, match: this.name, ticket }); } catch { v = { err: "busy" }; }
      if (!v || !v.ok) return this.refuse(ws, v && v.err === "ticket" ? "ticket" : "busy");
      if (v.done) return this.refuse(ws, "ended");
      if (this.phase === "new") {
        this.size = v.size; this.seed = v.seed; this.roster = v.roster; this.pl = new Array(v.size).fill(null); this.score = new Array(v.size).fill(0);
        this.phase = "wait"; this.waitUntil = Date.now() + MODES.push.joinSec * 1000;
        this.timer = setInterval(() => { try { this.loop(); } catch (e) { console.log("push tick", e && e.stack || e); } }, TICK_MS);
      }
      const slot = v.slot, old = this.pl[slot];
      if (old && old.acc === id) {                                 // reconnect / another tab: the newest socket takes the seat
        if (old.ws && old.ws !== ws) { const om = this.socks.get(old.ws); if (om) om.slot = null; this.send(old.ws, { t: "err", e: "replaced" }); try { old.ws.close(4005, "replaced"); } catch { /* */ } }
        old.ws = ws; old.offAt = 0; old.lastMsg = Date.now(); meta.slot = slot;
      } else {
        const who = { acc: id, ...await whoOf(this.env, a, meta.ip || "?") };
        this.pl[slot] = { acc: id, nick: (a.nick || (this.roster[slot] && this.roster[slot].nick) || "Игрок").slice(0, 16), r: this.roster[slot] ? this.roster[slot].r : MODES.push.r0,
          skin: typeof m.skin === "string" && SKIN_RE.test(m.skin) ? m.skin : null, trail: typeof m.trail === "string" && SKIN_RE.test(m.trail) ? m.trail : null,
          ws, who, q: 0, brace: 0, dash: null, offAt: 0, lastMsg: Date.now(), left: false };
        meta.slot = slot;
      }
      const p = this.pl[slot];
      this.send(ws, { t: "joined", you: slot, size: this.size, players: this.pub(), seed: this.seed, phase: this.phase, round: this.round, score: this.score, now: Date.now(), tps: PU.TPS, ack: p.q });
      if (this.w && (this.phase === "round" || this.phase === "count" || this.phase === "gap")) this.send(ws, { t: "round", n: this.round, at: this.roundAt, seed: this.seed, score: this.score, phase: this.phase });
      this.bcast({ t: "pl", players: this.pub() });
    } catch (e) { console.log("push join", e && e.stack || e); if (meta.slot == null) this.refuse(ws, "busy"); }
    finally { meta.joining = false; }
  }
  onClose(ws, meta) {
    this.socks.delete(ws);
    const p = meta.slot != null ? this.pl[meta.slot] : null;
    if (p && p.ws === ws) this.drop(p);
  }
  drop(p) { p.ws = null; p.offAt = Date.now(); p.brace = 0; p.dash = null; this.bcast({ t: "pl", players: this.pub() }); }
  active() { return this.pl.map((p, i) => (p && !p.left ? i : -1)).filter((i) => i >= 0); }
  newRound() {
    this.round += 1; this.rounds += 1;
    this.w = MC.pushNew(this.size, this.seed, this.round);
    this.pl.forEach((p, i) => { if (!p || p.left) { this.w.balls[i].alive = 0; this.w.balls[i].fellAt = 0; } });   // a seat nobody took / a player who left: no ball
    this.phase = "count"; this.roundAt = Date.now() + countSec(this.env) * 1000; this.tickDone = 0;
    for (const p of this.pl) if (p) { p.dash = null; }
    this.bcast({ t: "round", n: this.round, at: this.roundAt, seed: this.seed, score: this.score, phase: "count" });
  }
  loop() {
    const t = Date.now();
    // players gone for good (a phone that never came back) leave the match
    for (const p of this.pl) if (p && !p.left && !p.ws && p.offAt && t - p.offAt > MODES.push.offSec * 1000) { p.left = true; if (this.w) { const i = this.pl.indexOf(p), b = this.w.balls[i]; if (b && b.alive) { b.alive = 0; b.fellAt = this.w.tick; } } this.bcast({ t: "pl", players: this.pub() }); }
    if (this.phase === "wait") {
      const joined = this.pl.filter((p) => p).length;
      if (joined === this.size || (t > this.waitUntil && joined >= 2)) { this.pl.forEach((p, i) => { if (!p) this.pl[i] = null; }); this.newRound(); }
      else if (t > this.waitUntil + 20000) this.finish("nobody");
      return;
    }
    if (this.phase === "end") return;
    if (this.active().length < 2 && this.phase !== "end") { this.finish("left"); return; }
    if (this.phase === "count") { if (t >= this.roundAt) this.phase = "round"; else return; }
    if (this.phase === "gap") { if (t >= this.gapUntil) this.newRound(); return; }
    // the round: catch up to wall time at a fixed step (≤ 4 steps per timer call: a stalled object never jumps far)
    const want = Math.floor((t - this.roundAt) / TICK_MS);
    let steps = 0;
    while (this.w.tick < want && steps < 4 && !this.w.over) {
      this.pl.forEach((p, i) => {
        if (!p) return; const b = this.w.balls[i];
        b.brace = p.ws ? p.brace : 0;
        if (p.dash) { MC.pushDash(this.w, i, p.dash[0], p.dash[1]); p.dash = null; }
      });
      MC.pushStep(this.w); steps++;
      if (this.w.tick % 2 === 0 || this.w.over) this.snap();
    }
    if (steps === 4 && this.w.tick < want - 8) this.roundAt = t - this.w.tick * TICK_MS;   // far behind (the object was paused): time slides, no jump
    if (this.w.over) {
      const win = MC.pushWinner(this.w);
      if (win >= 0) this.score[win] += 1;
      this.bcast({ t: "rend", n: this.round, win, score: this.score });
      const top = Math.max(...this.score);
      if (top >= PU.WIN_ROUNDS || this.rounds >= MODES.push.maxRounds) { this.finish("done"); return; }
      this.phase = "gap"; this.gapUntil = t + gapSec(this.env) * 1000; this.w.over = true;
    }
  }
  snap() {
    const w = this.w, ps = w.balls.map((b, i) => [i, Math.round(b.x * 1000), Math.round(b.y * 1000), Math.round(b.vx * 1000), Math.round(b.vy * 1000), b.brace, b.cd, b.alive, this.pl[i] ? this.pl[i].q : 0]);
    this.bcast({ t: "s", k: w.tick, st: Date.now(), ps });
  }
  async finish(why) {
    if (this.phase === "end") return;
    this.phase = "end"; clearInterval(this.timer); this.timer = null;
    // ranks: round wins, then who is still in; players who left go last
    const idx = this.pl.map((p, i) => i).filter((i) => this.pl[i]);
    idx.sort((a, b) => (this.pl[a].left - this.pl[b].left) || (this.score[b] - this.score[a]) || ((this.w && this.w.balls[b].alive) - (this.w && this.w.balls[a].alive)));
    let res = null;
    // a match counts when a round was won, or a rival left after real play (≥ 10 s of a round) — a walk-over in the countdown is no win
    const realPlay = this.score.some((x) => x > 0) || (this.w && this.w.tick > 10 * PU.TPS);
    const played = why !== "nobody" && this.rounds > 0 && idx.length >= 2 && realPlay;
    if (played) {
      const body = { match: this.name, ranks: idx, rounds: this.rounds, quit: idx.filter((i) => this.pl[i].left) };
      for (let k = 0; k < 4 && !res; k++) { try { const r = await hubCall(this.env, "result", body); if (r && r.ok) res = r.res; } catch (e) { console.log("push result", e && e.message || e); } if (!res) await new Promise((r) => setTimeout(r, 400 * (k + 1))); }
      if (!res) console.log("push result FAILED", this.name);
    } else await hubCall(this.env, "free", { match: this.name, accs: this.pl.filter(Boolean).map((p) => p.acc) }).catch(() => {});
    this.endMsg = { t: "end", why, ranks: played ? idx : [], score: this.score, res: res || {} };
    this.bcast(this.endMsg);
  }
}
