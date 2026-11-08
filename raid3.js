// raid3.js — «Душа Врат» weekly online raid (2.4): matchmaking hub + one Durable Object per match.
//
//   GET  /api/v2/raid3/today                      calendar: week, day, today's enemy, the 7 days, open lobby, shared hp (pool)
//   POST /api/v2/raid3/pool   {id,secret}         the shared hp of today's enemy + your own contribution (raid3_pool.js)
//   POST /api/v2/raid3/find   {id,secret}         -> {match, ticket}  (same match again while it lives = reconnect)
//   WS   /api/v2/raid3/ws?m=<match>               the match itself (protocol below)
//
// Everything that matters is decided here, never on the phone:
//   * one seed per match, the attack director (raid3_rules.js) runs on the server and announces events ~2 s ahead;
//   * the shared hp, the phases (by hp), the timer, hearts / down / revive, every hit and every strike orb are judged by the
//     server from the players' timestamped presses with the same physics for everybody;
//   * plausibility: press times vs the server clock (rtt-aware, no back-dating, no future), press rate, distance vs time,
//     message rate and size; suspicion score → kick, the cheater's damage is removed from the boss, no reward, Online flag;
//   * one account = one seat in one match (hub ticket); never two accounts of one device in one match (device = the session's
//     device hash from Accounts, or the device id a newer client sends with find; none = the account alone counts);
//   * the IP check is SOFT (mobile carriers put many phones behind one IP, CGNAT): the same IP alone refuses nobody; the same IP
//     plus a young account (< 24 h) or a shared device history puts the player into ANOTHER match (not an error); same IP
//     without Google / device id only marks; same-IP clusters go to the god log («sus:raid3_ip»);
//   * /find limits: 20 / min per account, 30 / min per device, 300 / min per IP (anti-flood ceiling only);
//   * rewards only for a win, by contribution, written once per (match, account) in the Online DO, daily cap per account;
//   * nothing from the shop or donations is read here: skins are cosmetic only.
//   * 2.3.12 «Тренировка рейда» (owner only): the Online DO checks OWNER_ID + GOD_KEY / god token (god action raid_practice) and asks
//     the hub (internal /practice) for a match «P<n>» vs any of the 20 enemies; friends join with a 6-letter code (/find {code}).
//     A practice match has its own local hp: no shared pool, no rewards, no weekly fund, no result written in the Online DO.
//   * 2.3.12 a client with cheats used this session sends ch:1 with join: its damage stays out of the shared pool, no rewards, no fund.
//
// Protocol (JSON text frames, ≤ 2 KB):
//   C→S {t:'join', id, secret, ticket, skin?, trail?}  (skin / trail: looks only, ids [a-z0-9_]{1,24}, relayed to the others)            S→C {t:'joined', you, match, enemy, phase, players, lobbyEnds, now, rules, phys}
//   C→S {t:'in', ft, d, a:[[ft,'L'|'R'|'U'|'D'],…]}      presses since the last frame + own fight time + metres run
//   C→S {t:'ping', c}  S→C {t:'pong', c, s}             clock sync;   S→C {t:'sp', s}  C→S {t:'spr', s}   rtt measurement
//   C→S {t:'leave'}
//   S→C {t:'lobby', players, lobbyEnds}  {t:'start', at, seed, enemy, hpMax, limit}  {t:'atk', list}
//   S→C {t:'tick', ft, hp, ph, ps:[[pid,hearts,downLeft,dmg,lane,air,on,combo]], ev:[[pid,eventId,code,dmg]]}
//        code: 'h' hurt, 'o' orb, 'd' down, 'u' back up, 's' strike (2.3.11: [pid, 0, 's', dmg, open 0|1])
//        2.3.11: ps entries also carry [.., charges, orbsToNextCharge]; atk may carry ow:[[from,until],…] = «открыт» windows;
//        C→S presses may be 'S' = «Удар» (a jump for the body + a strike if the server counted a charge). Old clients ignore all this.
//   S→C {t:'end', won, ft, hp, results:[{pid,nick,dmg,share,gems,why}]}   {t:'kick', why}   {t:'err', e}
//   S→C {t:'clk'}   the press times are far off the server clock (the phone's clock jumped): resync (2.4.x; old clients ignore it)
// Mobile network (2.4.x): a bursty socket after a stall is not a flood (token bucket), a late press is suspicious only when it is
// older than the frame's own clock, the press rate is measured in press time, not arrival time. Close codes: 4001 auth,
// 4002 idle / no join, 4003 refused, 4005 replaced by another tab of the same account (don't reconnect), 4009 kicked,
// 1013 busy (try again). A player who comes back after the end gets the «end» message again (same ticket, match in memory).

import { accCall } from "./accounts.js";
import { gate, isOwnerId } from "./accounts_guard.js";   // 2.3.6: suspended / banned / no consent -> no online raid
import { RULES, PHYS, ENEMIES, RAID3_EPOCH, WEEK, DAY, calendar, playableOf, Director, newBody, applyPress, bodyAt, judge, judge2, laneAtT, tiltBody, warpBody, modeBody, rewards, openAt, strikeDmg, orbDmgOf, strikeOn } from "./raid3_rules.js";
import { periodOf, validPeriod, POOL, FUND, poolPhase, PHASE_TH } from "./raid3_pool.js";

const MATCH_RE = /^(?:[0-9]{1,5}-[1-7]-[0-9]{1,7}|P[0-9]{1,7})$/;   // P<n> = an owner practice match (2.3.12)
const PRACTICE_RE = /^P[0-9]{1,7}$/;
const PCODE_RE = /^[A-Z2-9]{6}$/;
const PCODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PRACTICE_LOBBY = { solo: 4, friends: 45 };   // s: «В бой» at once / time for friends to type the code
const PRACTICE_KEEP = 3600;                          // s a practice record is kept in the hub
const ACC_RE = /^[0-9a-f]{12}$/;
const SKIN_RE = /^[a-z0-9_]{1,24}$/;
const TICK_MS = 300;
const MSG_MAX = 2048;
const nowS = () => Math.floor(Date.now() / 1000);
// anti-abuse limits (owner 06.11: per device and account first; the IP only as a soft signal and a flood ceiling)
const FIND_IP_PER_MIN = 300;    // one carrier IP (CGNAT) may be a whole town: only a flood ceiling
const FIND_TRY_PER_MIN = 40;    // per (account, IP) before the secret is checked: caps the auth calls; a stranger can't lock the owner out
const FIND_ACC_PER_MIN = 20;    // per account, after the secret is checked
const FIND_DEV_PER_MIN = 30;    // per device (two accounts of one phone share it)
const YOUNG_SEC = 24 * 3600;    // a younger account + the same IP in one match = suspicious
const OPEN_MAX = 16;            // open lobbies kept for seating (a moved player gets another one)
const AVOID_MS = 10 * 60 * 1000;
const DEV_RE = /^[0-9a-f]{16,64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function hex(b) { return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function token() { const b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b); }
function testOn(env) { return env.RAID3_TEST === "1"; }
// RAID3_TEST only: «as if it were time at» for today / pool / find (calendar tests: boss days, rematches, the weekly fund)
function testAt(env, at) { return testOn(env) && Number.isInteger(at) && at >= RAID3_EPOCH && at < RAID3_EPOCH + 520 * WEEK ? at : null; }
// the calendar of the day a match was opened (match id = "week-day-n", see RaidHub.find); falls back to now
function matchCal(match) {
  const m = /^([0-9]{1,5})-([1-7])-[0-9]+$/.exec(String(match || ""));
  return m ? calendar(RAID3_EPOCH + (Number(m[1]) - 1) * WEEK + (Number(m[2]) - 1) * DAY + 60) : calendar();
}
function lobbySec(env) { const v = Number(env.RAID3_LOBBY_SEC); return testOn(env) && v > 0 ? v : RULES.lobbySec; }
// same-IP accounts in one match from which the cluster is written to the god log (was a hard refusal before CGNAT)
function clusterAt(env) { const v = Number(env.RAID3_IP_LIMIT); return testOn(env) && v > 0 ? v : RULES.accPerIpPerMatch; }
function youngSec(env) { const v = Number(env.RAID3_YOUNG_SEC); return testOn(env) && v > 0 ? v : YOUNG_SEC; }
function fightSec(env, lim) { const v = Number(env.RAID3_FIGHT_SEC); return testOn(env) && v > 0 ? v : lim; }   // 2.3.11 test knob: a shorter timed fight
const BEAT_W = 0.14;   // 2.3.11 the Warden: s around a beat a strike counts as on the beat
const WIPE_K = 0.5;   // 2.3.11 a wipe: contribution counts, no survival bonus — half of the rewards, not a win of the week
function hpScale(env) { const v = Number(env.RAID3_HP_SCALE); return testOn(env) && v > 0 ? v : 1; }

// Online DO internal call (rewards inbox, ban check, cheat flags). The header can't be sent from outside: handleOnline()
// builds its own headers for public requests.
async function onlineCall(env, body) {
  if (!env.ONLINE) return { err: "no_online" };
  const stub = env.ONLINE.get(env.ONLINE.idFromName("online"));
  const r = await stub.fetch("https://online/raid3/internal", { method: "POST", headers: { "content-type": "application/json", "x-internal": "raid3" }, body: JSON.stringify(body) });
  return r.json();
}
function hubStub(env) { return env.RAIDHUB.get(env.RAIDHUB.idFromName("hub")); }
// account check that tells «wrong secret» from «the Accounts object did not answer» (the latter must not end a session)
async function authAcc(env, id, secret, dev) {
  try {
    const a = await accCall(env, "auth", { id, secret, raid: true, dev: typeof dev === "string" && DEV_RE.test(dev) ? dev : undefined });
    if (a && a.ok) return a;
    return a && a.err === "Аккаунт не найден" ? { bad: true } : { busy: true };
  } catch (e) { console.log("raid3 auth", e && e.message || e); return { busy: true }; }
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function ipKey(ip) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("raid3ip:" + ip)))).slice(0, 16); }
// who sits on a seat, for the limits: ip hash, current device hash (null = unknown → the account alone), all session devices,
// young (< 24 h), Google linked. The raw IP / device id is never stored.
async function whoOf(env, a, ip) {
  const r = (a && a.rd) || {}, dk = typeof r.sdev === "string" ? r.sdev : null;
  const devs = [...new Set([...(Array.isArray(r.devs) ? r.devs.filter((x) => typeof x === "string") : []), ...(dk ? [dk] : [])])].slice(0, 9);
  const created = Number(r.created) || 0;
  return { ipk: await ipKey(ip), dk, devs, young: created > 0 && nowS() - created < youngSec(env), g: !!(a && a.google) };
}
// may <me> sit in a match with <others>? (pure; the hub when seating, the match again on join)
//   {ok:false, why:'device'}            the same device as a player there (any IP) — hard rule
//   {ok:false, why:'ip', sig}           the same IP AND young (either side) / a shared device history → another match
//   {ok:true, same, marks}              same: same-IP players there; marks: soft signals (no Google, no device id)
export function seatCheck(me, others) {
  for (const q of others) if (me.dk && q.dk && me.dk === q.dk) return { ok: false, why: "device" };
  const same = others.filter((q) => q.ipk && q.ipk === me.ipk);
  if (!same.length) return { ok: true, same: 0, marks: [] };
  for (const q of same) {
    if (me.young || q.young) return { ok: false, why: "ip", sig: "young" };
    if ((me.devs || []).some((d) => (q.devs || []).includes(d))) return { ok: false, why: "ip", sig: "dev_history" };
  }
  const marks = []; if (!me.g) marks.push("nogoogle"); if (!me.dk) marks.push("nodev");
  return { ok: true, same: same.length, marks };
}
function seatWho(r) { let devs = []; try { devs = JSON.parse(r.devs || "[]"); } catch { devs = []; } return { acc: r.acc, ipk: r.ipk || null, dk: r.dk || null, devs: Array.isArray(devs) ? devs : [], young: !!r.young, g: !!r.g }; }
function logWho(w, marks) { return { acc: w.acc, young: w.young, g: w.g, dev: !!w.dk, marks: marks || [] }; }
async function hubCall(env, op, body) {
  const r = await hubStub(env).fetch("https://hub/" + op, { method: "POST", headers: { "content-type": "application/json", "x-internal": "raid3" }, body: JSON.stringify(body || {}) });
  return r.json();
}

// ------------------------------------------------------------------ worker-side entry
export async function handleRaid3(request, env) {
  if (!env.RAIDHUB || !env.MATCH) return json({ err: "not_configured" }, 503);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" } });
  if (url.pathname === "/api/v2/raid3/ws") {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ err: "ws_only" }, 426);
    const m = url.searchParams.get("m") || "";
    if (!MATCH_RE.test(m)) return json({ err: "bad_match" }, 400);
    const stub = env.MATCH.get(env.MATCH.idFromName("raid3:" + m));
    const h = new Headers(request.headers); h.set("x-ip", request.headers.get("cf-connecting-ip") || "local"); h.set("x-match", m);
    try { return await stub.fetch(new Request(request.url, { headers: h })); }
    catch (e) { console.log("raid3 ws", e && e.message || e); return json({ err: "busy" }, 503); }
  }
  const op = url.pathname.replace(/^\/api\/v2\/raid3\//, "");
  if (!["today", "find", "pool", "test_result"].includes(op)) return json({ err: "unknown" }, 404);
  if (op !== "today" && request.method !== "POST") return json({ err: "method" }, 405);
  const body = request.method === "POST" ? (await request.text()).slice(0, 4096) : null;
  let res;
  try { res = await hubStub(env).fetch("https://hub/pub/" + op + (op === "today" ? url.search.slice(0, 64) : ""), { method: request.method, headers: { "content-type": "application/json", "x-ip": request.headers.get("cf-connecting-ip") || "local" }, body }); }
  catch (e) { console.log("raid3 hub", e && e.message || e); return json({ err: "busy" }, 503); }   // the hub did not answer: JSON, not an HTML error page
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

// ------------------------------------------------------------------ hub: who plays in which match
export class RaidHub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS seat (acc TEXT PRIMARY KEY, match TEXT NOT NULL, ticket TEXT NOT NULL, enemy TEXT NOT NULL, exp INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    // anti-abuse columns of a seat (older storage gets them added): ip hash, device hash, session devices, young, Google
    const have = new Set(this.sql.exec("PRAGMA table_info(seat)").toArray().map((r) => r.name));
    for (const [c, t] of [["ipk", "TEXT"], ["dk", "TEXT"], ["devs", "TEXT"], ["young", "INTEGER"], ["g", "INTEGER"]]) if (!have.has(c)) this.sql.exec(`ALTER TABLE seat ADD COLUMN ${c} ${t}`);
    this.hits = new Map();
    this.avoid = new Map();   // acc → {m, until}: the match refused this account on join (soft IP / device): seat it elsewhere
  }
  // the open lobbies, oldest first (was one «open» lobby; a player moved by the limits needs another one)
  opens() { const l = this.kv("opens"); if (Array.isArray(l)) return l; const o = this.kv("open"); return o ? [o] : []; }
  // the lobby /today shows: the newest one still taking players with somebody in it
  shownLobby(dayKey, rt) {
    const ls = lobbySec(this.env), l = this.opens().filter((o) => o.day === dayKey && rt - o.created <= ls - 3 && o.count > 0);
    return l.length ? l[l.length - 1] : null;
  }
  // god log (Online DO) + worker log, at most once per key in 10 min
  logIp(key, ev) {
    if (!this.limit("log:" + key, 1, 600)) return;
    console.log("raid3 ip cluster", JSON.stringify(ev));
    onlineCall(this.env, { op: "ipcluster", ...ev }).catch(() => {});
  }
  one(q, ...b) { return this.sql.exec(q, ...b).toArray()[0] || null; }
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
    const url = new URL(request.url), path = url.pathname;
    let body = {};
    if (request.method === "POST") { try { body = JSON.parse((await request.text()) || "{}"); } catch { return json({ err: "bad_json" }, 400); } }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ err: "bad_json" }, 400);
    try {
      if (path === "/pub/today") return json(await this.today(testAt(this.env, Number(url.searchParams.get("at")))));
      if (path === "/pub/pool") return json(...await this.pool(body, request.headers.get("x-ip") || "?"));
      if (path === "/pub/test_result") {   // RAID3_TEST only: a match result straight into the Online DO (pool race tests)
        if (!testOn(this.env)) return json({ err: "unknown" }, 404);
        return json(await onlineCall(this.env, { ...body, op: "result" }));
      }
      if (path === "/pub/find") return json(...await this.find(body, request.headers.get("x-ip") || "?"));
      if (request.headers.get("x-internal") !== "raid3") return json({ err: "forbidden" }, 403);
      if (path === "/verify") return json(this.verify(body));
      if (path === "/practice") return json(this.practice(body));
      if (path === "/done") return json(this.done(body));
      return json({ err: "unknown" }, 404);
    } catch (e) {
      console.log("raidhub error", e && e.stack || e);
      return json({ err: "server" }, 500);
    }
  }
  // the week at time t from the Online DO: minions defeated in their day (→ the boss comes on days 5–7 or not), the weekly fund
  async weekOf(t, acc) { const r = await onlineCall(this.env, { op: "week", t, acc: acc || undefined }).catch(() => null); return r && r.ok ? r : null; }
  // who is fought today after the owner's rule (06.11): days 1–4 the minion of the day; days 5–7 the boss ONLY if all 4 minions
  // were defeated in their own day, otherwise an undefeated minion again (rematch: its own fresh shared hp for days 5–7).
  // null = unknown (the Online DO did not answer on a boss day)
  fightOf(c, wk) {
    if (c.day <= 4) return { ...c.today, rematch: false };
    if (!wk) return null;
    if (wk.status.bossAppears) return { ...c.today, rematch: false };
    const m = wk.status.rematch, e = ENEMIES[m.id] || ENEMIES[m.play];
    return { day: c.day, id: m.id, name: e.name, en: e.en, kind: "minion", ready: !!e.ready, play: m.play, rematch: true };
  }
  async today(at) {
    const t = at || nowS(), c = calendar(t), rt = nowS(), o = this.shownLobby(c.dayKey, rt);
    // the open lobby only while find still puts players into it (find opens a new match after ls − 3 s) and somebody is in it
    const lobby = o ? { players: o.count, ends: o.created + lobbySec(this.env) } : null;
    // the Online part (week status + shared hp) is cached for 3 s: a big online polls /today, the Online DO is one for everybody
    // (not for the test-only `at`: the calendar tests change the week between two calls)
    const ck = c.dayKey, hit = !at && this.todayC && this.todayC.k === ck && Date.now() - this.todayC.at < 3000 ? this.todayC : null;
    const wk = hit ? hit.wk : await this.weekOf(t, null);
    const f = this.fightOf(c, wk) || c.today;
    const st = wk ? wk.status : null, gateBoss = st ? { appears: c.day >= 5 ? st.bossAppears : null, beaten: st.beaten, of: 4 } : null;
    const days = c.days.map((d) => d.day <= 4
      ? { ...d, beaten: st ? st.minions[d.day - 1].beaten : null }
      : { ...d, noBoss: !!(st && c.day >= 5 && !st.bossAppears) });
    const pool = hit ? hit.pool : await this.poolOf({ ...c, today: f }, null).catch(() => null);
    if (!hit && !at && wk) this.todayC = { k: ck, at: Date.now(), wk, pool };
    // days 5–7 and the Online DO did not answer: whether the boss came is unknown (find answers 503 then), say so
    return { ok: true, now: rt, unknown: c.day >= 5 && !wk ? true : undefined, ...c, days, today: f, bossGate: gateBoss, fund: wk ? wk.fund : null,
      enemy: { id: f.id, play: f.play, ...pubEnemy(f.play) }, lobby, pool, rules: { dailyCap: RULES.dailyCap, maxPlayers: RULES.maxPlayers, reward: RULES.reward,
      kill: { minion: POOL.minion.kill, boss: POOL.boss.kill, minK: POOL.killMinK, maxK: POOL.killMaxK }, cleanupK: POOL.cleanupK, fund: { accMax: FUND.accMax } } };
  }
  // the shared hp of today's enemy (created on first look, sized by last week's active players). c.today = the fight of today
  async poolOf(c, acc) {
    const id = c.today.play, kind = ENEMIES[id].kind;
    const r = await onlineCall(this.env, { op: "pool", period: periodOf(c, id, kind), enemy: id, kind, week: c.week, acc, create: true });
    return r && r.ok ? r.pool : null;
  }
  async pool(body, ip) {
    if (!this.limit("ip:" + ip, 30, 60)) return [{ err: "rate" }, 429];
    const { id, secret } = body;
    if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || secret.length > 64) return [{ err: "auth" }, 401];
    const a = await authAcc(this.env, id, secret);
    if (a.busy) return [{ err: "busy" }, 503];
    if (!a.ok) return [{ err: "auth" }, 401];
    const t = testAt(this.env, body.at) || nowS(), c = calendar(t), wk = await this.weekOf(t, id), f = this.fightOf(c, wk) || c.today;
    return [{ ok: true, pool: await this.poolOf({ ...c, today: f }, id), fund: wk ? wk.fund : null }, 200];
  }
  async find(body, ip) {
    if (!this.limit("ip:" + ip, FIND_IP_PER_MIN, 60)) return [{ err: "rate" }, 429];   // flood ceiling only (CGNAT)
    const { id, secret } = body;
    if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || secret.length > 64) return [{ err: "auth" }, 401];
    if (!this.limit("try:" + id + "|" + ip, FIND_TRY_PER_MIN, 60)) return [{ err: "rate" }, 429];
    const a = await authAcc(this.env, id, secret, body.dev);
    if (a.busy) return [{ err: "busy" }, 503];
    if (!a.ok) return [{ err: "auth" }, 401];
    const me = { acc: id, ...await whoOf(this.env, a, ip) };
    // per account, then per device (no device id = old session / 2.3.9 client: the account limit alone)
    if (!this.limit("acc:" + id, FIND_ACC_PER_MIN, 60)) return [{ err: "rate" }, 429];
    if (me.dk && !this.limit("dev:" + me.dk, FIND_DEV_PER_MIN, 60)) return [{ err: "rate" }, 429];
    const g = gate(a, "raid", this.env);   // 07.11: a suspension scoped to other features keeps the raid open
    if (g) return [{ err: g.err, pun: g.pun || null, terms_v: g.terms_v, need: g.need, text: g.text }, 403];
    const chk = await onlineCall(this.env, { op: "check", acc: id }).catch(() => null);   // the ban is checked again with the result
    if (chk && chk.banned) return [{ err: "banned" }, 403];
    const rt = nowS(), t = testAt(this.env, body.at) || rt, c = calendar(t);
    this.sql.exec("DELETE FROM seat WHERE exp < ?", rt);
    if (body.code != null) return this.findCode(id, me, body.code, rt);   // 2.3.12 a friend joins the owner's practice
    const mine = this.one("SELECT * FROM seat WHERE acc = ?", id);
    if (mine) return [{ ok: true, match: mine.match, ticket: mine.ticket, enemy: mine.enemy, again: true }, 200];
    const f = this.fightOf(c, c.day >= 5 ? await this.weekOf(t, null) : null);
    if (!f) return [{ err: "server" }, 503];   // a boss day and nobody knows whether the boss came: no guessing
    let enemy = f.play;
    if (testOn(this.env) && typeof body.force === "string" && ENEMIES[body.force]) enemy = playableOf(body.force);
    let n = this.kv("n") || 0;
    const ls = lobbySec(this.env);
    // live lobbies of today (still taking players); the oldest compatible one first (it starts first)
    // (kept a while after they stop taking players: verify still knows their lobby end for a slow phone)
    let opens = this.opens().filter((o) => rt - o.created <= ls + 120);
    const av = this.avoid.get(id), avoidM = av && av.until > Date.now() ? av.m : null;
    let o = null, moved = null, chkOk = null;
    for (const x of opens) {
      if (x.day !== c.dayKey || rt - x.created > ls - 3 || x.enemy !== enemy || x.count >= RULES.maxPlayers) continue;
      if (x.match === avoidM) { moved = moved || av.why || "ip"; continue; }
      const others = this.sql.exec("SELECT * FROM seat WHERE match = ?", x.match).toArray().map(seatWho);
      const r = seatCheck(me, others);
      if (!r.ok) {
        moved = moved || r.why;
        if (r.why === "ip") this.logIp(`ref:${id}:${x.match}`, { kind: "refused", actor: id, match: x.match, ipk: me.ipk, sig: r.sig,
          accs: [logWho(me), ...others.filter((q) => q.ipk === me.ipk).map((q) => logWho(q))] });
        continue;
      }
      o = x; chkOk = r; break;
    }
    if (!o) {   // nothing fits (or nothing open): a new match — a player moved by the limits plays, never gets an error
      n += 1; this.kv("n", n);
      o = { match: `${c.week}-${c.day}-${n}`, day: c.dayKey, enemy, created: rt, count: 0 };
      opens.push(o); if (opens.length > OPEN_MAX) opens = opens.slice(-OPEN_MAX);
      chkOk = { ok: true, same: 0, marks: [] };
    }
    o.count += 1; this.kv("opens", opens); this.sql.exec("DELETE FROM kv WHERE k = 'open'");
    const ticket = token();
    this.sql.exec("INSERT INTO seat (acc, match, ticket, enemy, exp, ipk, dk, devs, young, g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, o.match, ticket, enemy, rt + 15 * 60,
      me.ipk, me.dk, JSON.stringify(me.devs), me.young ? 1 : 0, me.g ? 1 : 0);
    // a same-IP cluster (CGNAT or a farm): allowed, written to the god log once per (match, ip) and again when it grows
    if (chkOk.same + 1 >= clusterAt(this.env)) {
      const same = this.sql.exec("SELECT * FROM seat WHERE match = ? AND ipk = ?", o.match, me.ipk).toArray().map(seatWho);
      this.logIp(`cl:${o.match}:${me.ipk}:${same.length}`, { kind: "cluster", actor: id, match: o.match, ipk: me.ipk, n: same.length,
        accs: same.map((q) => logWho(q, [...(q.g ? [] : ["nogoogle"]), ...(q.dk ? [] : ["nodev"])])) });
    }
    return [{ ok: true, match: o.match, ticket, enemy, lobbyEnds: o.created + ls, today: f.id, rematch: !!f.rematch, period: periodOf(c, enemy, ENEMIES[enemy].kind), week: c.week, day: c.day,
      moved: moved || undefined }, 200];
  }
  verify({ acc, match, ticket }) {
    const r = this.one("SELECT * FROM seat WHERE acc = ?", acc);
    if (!r || r.match !== match || r.ticket !== ticket || r.exp < nowS()) return { err: "ticket" };
    if (PRACTICE_RE.test(String(match))) {   // 2.3.12 practice: no calendar, no period (= no shared pool)
      const pm = this.kv("pm:" + match);
      if (!pm) return { err: "ticket" };
      return { ok: true, practice: true, enemy: pm.enemy, owner: pm.owner, phase: pm.phase || 0, lobbySec: Math.max(1, pm.ends - pm.created), lobbyEnds: pm.ends * 1000, hpScale: hpScale(this.env), day: null, week: null, period: null };
    }
    // the period is fixed by the lobby (match "week-day-n" was named by find on that day), not by the moment of the first join:
    // a lobby opened at 23:59 of day 4 still hits the minion's pool of day 4, not an invalid «day 5» period (= no shared hp)
    const c = matchCal(r.match), kind = ENEMIES[r.enemy] ? ENEMIES[r.enemy].kind : "minion";
    const o = this.opens().find((x) => x.match === r.match), lobbyEnds = o ? (o.created + lobbySec(this.env)) * 1000 : null;
    return { ok: true, enemy: r.enemy, lobbySec: lobbySec(this.env), lobbyEnds, hpScale: hpScale(this.env), day: c.dayKey, week: c.week, period: periodOf(c, r.enemy, kind) };
  }
  // 2.3.12 «Тренировка рейда»: called by the Online DO after the god check (OWNER_ID + GOD_KEY / device token); checked here again.
  // The owner's old seat (a normal lobby) is given up: one seat per account.
  practice({ acc, enemy, friends, phase }) {
    if (!isOwnerId(this.env, acc)) return { err: "forbidden" };
    if (typeof enemy !== "string" || !Object.prototype.hasOwnProperty.call(ENEMIES, enemy)) return { err: "bad_enemy" };
    const rt = nowS();
    for (const r of this.sql.exec("SELECT k, v FROM kv WHERE k LIKE 'pm:%'").toArray()) {   // old practice records
      let o = null; try { o = JSON.parse(r.v); } catch { o = null; }
      if (!o || rt - o.created > PRACTICE_KEEP) { this.sql.exec("DELETE FROM kv WHERE k = ?", r.k); if (o && o.code) this.sql.exec("DELETE FROM kv WHERE k = ?", "pc:" + o.code); }
    }
    const n = (this.kv("pn") || 0) + 1; this.kv("pn", n);
    const match = "P" + n, ls = friends ? PRACTICE_LOBBY.friends : PRACTICE_LOBBY.solo;
    let code = null;
    if (friends) for (let i = 0; i < 8 && !code; i++) {
      const b = new Uint8Array(6); crypto.getRandomValues(b);
      const c = [...b].map((x) => PCODE_ABC[x % PCODE_ABC.length]).join("");
      if (!this.kv("pc:" + c)) code = c;
    }
    const pm = { match, enemy, created: rt, ends: rt + ls, code, owner: acc, phase: Number.isInteger(phase) ? Math.max(0, Math.min(2, phase)) : 0 };
    this.kv("pm:" + match, pm); if (code) this.kv("pc:" + code, match);
    const mine = this.one("SELECT * FROM seat WHERE acc = ?", acc);
    if (mine) this.done({ match: mine.match, accs: [acc] });
    const ticket = token();
    this.sql.exec("INSERT INTO seat (acc, match, ticket, enemy, exp) VALUES (?, ?, ?, ?, ?)", acc, match, ticket, enemy, rt + 15 * 60);
    return { ok: true, practice: 1, match, ticket, enemy, code, lobbyEnds: pm.ends, phase: pm.phase };
  }
  // a friend with the code: the same match while its lobby is open; the device rule holds (never two accounts of one phone)
  findCode(id, me, code, rt) {
    const cd = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (!PCODE_RE.test(cd)) return [{ err: "code" }, 404];
    const m = this.kv("pc:" + cd), pm = m ? this.kv("pm:" + m) : null;
    if (!pm || rt > pm.ends - 1) return [{ err: "code" }, 404];
    const mine = this.one("SELECT * FROM seat WHERE acc = ?", id);
    if (mine && mine.match === pm.match) return [{ ok: true, practice: 1, match: mine.match, ticket: mine.ticket, enemy: mine.enemy, code: cd, lobbyEnds: pm.ends, again: true }, 200];
    const others = this.sql.exec("SELECT * FROM seat WHERE match = ?", pm.match).toArray().map(seatWho);
    if (others.length >= RULES.maxPlayers) return [{ err: "full" }, 409];
    for (const q of others) if (me.dk && q.dk && me.dk === q.dk) return [{ err: "device" }, 409];
    if (mine) this.done({ match: mine.match, accs: [id] });
    const ticket = token();
    this.sql.exec("INSERT INTO seat (acc, match, ticket, enemy, exp, ipk, dk, devs, young, g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, pm.match, ticket, pm.enemy, rt + 15 * 60,
      me.ipk, me.dk, JSON.stringify(me.devs), me.young ? 1 : 0, me.g ? 1 : 0);
    return [{ ok: true, practice: 1, match: pm.match, ticket, enemy: pm.enemy, code: cd, lobbyEnds: pm.ends }, 200];
  }
  done({ match, accs, avoid }) {
    if (!Array.isArray(accs)) return { err: "bad" };
    // the match refused the account by the limits (device / soft IP): the next find seats it in another match
    if (avoid) for (const a of accs) { this.avoid.set(String(a), { m: String(match), why: String(avoid).slice(0, 8), until: Date.now() + AVOID_MS }); if (this.avoid.size > 5000) this.avoid.clear(); }
    let freed = 0;
    for (const a of accs) { this.sql.exec("DELETE FROM seat WHERE acc = ? AND match = ?", String(a), String(match)); freed += this.one("SELECT changes() AS n").n; }
    // a seat freed in the still open lobby (left / refused): /today shows the real count, and the place can be taken again
    const l = this.opens(), o = l.find((x) => x.match === String(match));
    if (freed && o) { o.count = Math.max(0, o.count - freed); this.kv("opens", l); }
    return { ok: true };
  }
}
function pubEnemy(id) { const e = ENEMIES[id]; return { id, kind: e.kind, name: e.name, en: e.en, limit: e.limit }; }

// ------------------------------------------------------------------ one match
const MSG_BURST = RULES.msgMaxPerSec * 8;   // token bucket: a phone's queued frames after a stall arrive at once — not a flood
const MSG_FLOOD = RULES.msgKickPerSec;      // this many frames beyond an empty bucket = a real flood → kick
const JOIN_WAIT_MS = 15000;                 // a socket that never sends «join» is closed
const IDLE_MS = 30000;                      // fight: nothing from a player for this long = gone (the half-open socket of a phone)
const CLOCK_FAR = 30;                       // s: a press this far off the server clock = the phone's clock jumped, not a cheat
const RELEASE = new Set(["ended", "started", "full", "ip_limit"]);   // refusals that free the hub seat (next find = a new match; ip_limit: old servers only)
export class Match {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.name = null; this.phase = "new";         // new → lobby → fight → end
    this.players = new Map();                      // pid → player
    this.byAcc = new Map();
    this.socks = new Map();                        // ws → meta
    this.pending = [];                             // announced, not yet judged by everyone
    this.timer = null; this.nextPid = 1; this.lastSus = 0; this.endMsg = null;
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ err: "ws_only" }, 426);
    if (!this.name) this.name = request.headers.get("x-match");
    const pair = new WebSocketPair(), ws = pair[1];
    ws.accept();
    const ip = request.headers.get("x-ip") || "?";
    const meta = { ip, pid: null, joining: false, tok: MSG_BURST, tokAt: Date.now(), rateAt: 0 };
    this.socks.set(ws, meta);
    ws.addEventListener("message", (e) => { this.onMsg(ws, meta, e.data).catch((err) => console.log("raid3 msg", err && err.stack || err)); });
    ws.addEventListener("close", () => this.onClose(ws, meta));
    ws.addEventListener("error", () => this.onClose(ws, meta));
    setTimeout(() => { if (!meta.pid && this.socks.has(ws)) { this.socks.delete(ws); this.send(ws, { t: "err", e: "no_join" }); try { ws.close(4002, "no_join"); } catch { /* */ } } }, JOIN_WAIT_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* closed */ } }
  bcast(m) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p.ws) { try { p.ws.send(s); } catch { /* closed */ } } }
  ms() { return Date.now(); }
  ft() { return this.startAt ? (Date.now() - this.startAt) / 1000 : 0; }

  async onMsg(ws, meta, raw) {
    if (typeof raw !== "string" || raw.length > MSG_MAX) { this.send(ws, { t: "err", e: "too_big" }); return; }
    const t = Date.now();
    // token bucket: msgMaxPerSec on average, bursts up to MSG_BURST (a stalled mobile socket delivers its queue at once)
    meta.tok = Math.min(MSG_BURST, meta.tok + (t - meta.tokAt) / 1000 * RULES.msgMaxPerSec) - 1; meta.tokAt = t;
    const p = meta.pid ? this.players.get(meta.pid) : null;
    if (p && p.ws === ws) p.lastMsg = t;
    if (meta.tok < -MSG_FLOOD) { if (p) this.kick(p, "flood"); else try { ws.close(4008, "flood"); } catch { /* */ } return; }
    if (meta.tok < 0) { if (p && t - meta.rateAt > 1000) { meta.rateAt = t; this.sus(p, 0.5, "msg_rate"); } return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "ping") { this.send(ws, { t: "pong", c: m.c, s: Date.now() }); return; }
    if (m.t === "join") { if (!meta.pid && !meta.joining) await this.join(ws, meta, m); return; }
    if (!p || p.ws !== ws) return;
    if (m.t === "spr") { const r = (Date.now() - Number(m.s)) / 1000; if (r >= 0 && r < 10) { p.rtts.push(Math.min(r, RULES.rttMax)); if (p.rtts.length > 7) p.rtts.shift(); } return; }
    if (m.t === "in") { this.input(p, m); return; }
    if (m.t === "leave") { p.left = true; this.disconnect(p); try { ws.close(1000, "bye"); } catch { /* */ } }
  }

  async join(ws, meta, m) {
    meta.joining = true;
    try {
      const { id, secret, ticket } = m;
      if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || typeof ticket !== "string" || ticket.length > 64) return this.refuse(ws, "auth");
      // a fresh object for a match that already began (the runtime restarted it, e.g. a deploy): never a second fight under one name
      if (this.phase === "new") { this.beganP = this.beganP || this.ctx.storage.get("began").catch(() => null); if (await this.beganP && this.phase === "new") this.phase = "end"; }
      const a = await authAcc(this.env, id, secret);
      if (a.busy) return this.refuse(ws, "busy");
      if (!a.ok) return this.refuse(ws, "auth");
      const g = gate(a, "raid", this.env);   // 07.11: a suspension scoped to other features keeps the raid open
      if (g) return this.refuse(ws, g.err);
      if (this.phase === "end") return this.afterEnd(ws, id);
      let v; try { v = await hubCall(this.env, "verify", { acc: id, match: this.name, ticket }); } catch (e) { v = { err: "busy" }; }
      if (!v || !v.ok) return this.refuse(ws, v && v.err === "ticket" ? "ticket" : "busy");
      if (this.phase === "end") return this.afterEnd(ws, id);
      const old = this.byAcc.get(id);
      if (old) {                                          // reconnect (same account, same match) or a second tab
        if (old.cheat) return this.refuse(ws, "kicked");
        const now = Date.now();
        if (old.ws && old.ws !== ws) {                    // the other tab / the dead socket of the old network: replaced
          old.repl = (old.repl || []).filter((x) => now - x < 20000); old.repl.push(now);
          if (old.repl.length > 4) return this.refuse(ws, "replaced");   // two old (2.3.9) tabs taking the seat in turns: keep the current one
          const ow = old.ws, om = this.socks.get(ow); if (om) om.pid = null;
          this.send(ow, { t: "err", e: "replaced" }); try { ow.close(4005, "replaced"); } catch { /* */ }
        }
        if (old.on && this.phase === "fight") old.onMs += Math.max(0, now - Math.max(old.onSince, this.startAt || old.onSince));
        old.ws = ws; old.on = true; old.left = false; old.onSince = now; old.offAt = 0; old.lastMsg = now; meta.pid = old.pid;
        if (m.ch === 1 || m.ch === true) old.nr = true;   // 2.3.12 cheats used this session (also after a reconnect): no rewards
        if (this.phase === "fight") old.rejoinFt = this.ft() - 0.3;   // presses from before the reconnect are stale: the client starts from the server body
        this.welcome(old);
        if (this.phase === "lobby") this.bcast({ t: "lobby", players: this.pubPlayers(), lobbyEnds: this.lobbyEnds });
        return;
      }
      // a slow phone seated by the hub may still come in during the countdown (hp grows with it, the start is sent again)
      const late = this.phase === "fight";
      if (late && this.ft() > -0.3) return this.refuse(ws, "started", id);
      if (this.phase === "new") {
        this.enemyId = v.enemy; this.enemy = ENEMIES[v.enemy]; this.hpK = v.hpScale || 1; this.day = v.day;
        const ls = (v.lobbySec || RULES.lobbySec) * 1000;
        this.lobbyEnds = Number.isFinite(v.lobbyEnds) && v.lobbyEnds > 0 ? Math.min(Date.now() + ls, Math.max(v.lobbyEnds, Date.now() + 5000)) : Date.now() + ls;
        this.phase = "lobby";
        this.practice = v.practice === true && PRACTICE_RE.test(String(this.name || ""));   // 2.3.12: an owner practice match (own hp, nothing written)
        if (this.practice) { this.week = null; this.period = null; this.pool = null; this.pracPh = Number.isInteger(v.phase) ? Math.max(0, Math.min(2, v.phase)) : 0; }
        else {
          const cal = calendar(); this.week = Number.isInteger(v.week) ? v.week : cal.week;   // the shared hp this match hits (fixed by the hub)
          this.period = validPeriod(v.period) ? v.period : periodOf(cal, v.enemy, this.enemy.kind);
          onlineCall(this.env, { op: "pool", period: this.period, enemy: v.enemy, kind: this.enemy.kind, week: this.week, create: true })
            .then((r) => { if (r && r.ok) { this.pool = r.pool; if (this.phase === "lobby" && r.pool && r.pool.plan) this.bcast({ t: "lobby", players: this.pubPlayers(), lobbyEnds: this.lobbyEnds, plan: r.pool.plan }); } }).catch(() => {});   // 2.3.12 «План дня» in the lobby
        }
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.log("raid3 tick", e && e.stack || e); } }, TICK_MS);
      }
      if (this.players.size >= RULES.maxPlayers) return this.refuse(ws, "full", id);
      // the hub already seated by these rules; checked again with this socket's IP (the phone may have changed network).
      // IP alone refuses nobody. A refusal frees the seat and tells the hub to seat the account elsewhere; the code is «started»
      // because every client (2.3.9+) answers it with «найдём новый» + a new find, not a dead end.
      const who = { acc: id, ...await whoOf(this.env, a, meta.ip) };
      const sc = seatCheck(who, [...this.players.values()].map((q) => q.who).filter(Boolean));
      if (!sc.ok) { console.log("raid3 seat refused", this.name, id, sc.why, sc.sig || ""); return this.refuse(ws, "started", id, sc.why); }
      if (this.phase === "end") return this.afterEnd(ws, id);
      if (this.byAcc.has(id) || this.players.size >= RULES.maxPlayers) return this.refuse(ws, this.byAcc.has(id) ? "busy" : "full", this.byAcc.has(id) ? null : id);
      const now = Date.now();
      const p = {
        pid: this.nextPid++, acc: id, nick: (a.nick || "Игрок").slice(0, 16), skin: typeof m.skin === "string" && SKIN_RE.test(m.skin) ? m.skin : null, trail: typeof m.trail === "string" && SKIN_RE.test(m.trail) ? m.trail : null,
        ws, ip: meta.ip, who, marks: sc.marks, on: true, left: false, onSince: late ? this.startAt : now, onMs: 0, offAt: 0, lastMsg: now, rejoinFt: -9,
        presses: [], body: newBody(), judgedT: -9, lastFt: 0, lastD: 0, rtts: [], pressTimes: [], rateFt: -99, futAt: -9, clkAt: 0,
        hearts: RULES.hearts, invulUntil: -9, downUntil: -9, dmg: 0, streak: 0, orbs: 0, hits: 0, sus: 0, flags: {}, cheat: false,
        charges: 0, orbC: 0, strikes: 0, sq: [],         // 2.3.11 «Удар»: charges counted here from judged orbs; sq = strike presses to resolve
        nr: m.ch === 1 || m.ch === true,                 // 2.3.12 cheats used this session on the phone: damage out of the pool, no rewards
      };
      this.players.set(p.pid, p); this.byAcc.set(id, p); meta.pid = p.pid;
      if (late) {
        const per = Math.max(1, Math.round(this.enemy.hp * this.hpK));
        this.hpMax += per; this.hp += per;
        this.welcome(p);
        this.bcast(this.startMsg());                     // everybody's hp bar (the clients are still counting down)
      } else this.welcome(p);
      this.bcast({ t: "lobby", players: this.pubPlayers(), lobbyEnds: this.lobbyEnds });
      if (this.phase === "lobby" && this.players.size >= RULES.maxPlayers && this.lobbyEnds - Date.now() > 3000) this.lobbyEnds = Date.now() + 3000;
    } catch (e) {
      console.log("raid3 join", e && e.stack || e);
      if (!meta.pid) this.refuse(ws, "busy");
    } finally { meta.joining = false; }
  }
  // the match is over: a player of it gets the result again (the phone was away at the end); anybody else: «ended»
  afterEnd(ws, acc) {
    const p = this.byAcc.get(acc);
    if (p && !p.cheat && this.endMsg) { this.send(ws, this.endMsg); try { ws.close(1000, "end"); } catch { /* */ } return; }
    return this.refuse(ws, p && p.cheat ? "kicked" : "ended", p ? null : acc);
  }
  async refuse(ws, e, acc, avoid) {
    // a refused seat is freed in the hub first, so the client's next find gets a new match (not the same refusal forever);
    // avoid (device / ip): the hub must not seat the account in this match again
    if (acc && RELEASE.has(e)) await hubCall(this.env, "done", { match: this.name, accs: [acc], avoid: avoid || undefined }).catch(() => {});
    this.send(ws, { t: "err", e });
    try { ws.close(e === "busy" ? 1013 : e === "auth" ? 4001 : e === "replaced" ? 4005 : 4003, e); } catch { /* */ }
  }
  welcome(p) {
    this.send(p.ws, { t: "joined", you: p.pid, match: this.name, enemy: pubEnemy(this.enemyId), phase: this.phase, players: this.pubPlayers(),
      lobbyEnds: this.lobbyEnds, now: Date.now(), phys: PHYS, practice: this.practice ? 1 : undefined, plan: this.pool && this.pool.plan ? this.pool.plan : undefined, pth: PHASE_TH, rules: { hearts: RULES.hearts, downSec: RULES.downSec, orbDmg: orbDmgOf(this.enemyId), comboStep: RULES.comboStep, comboMax: RULES.comboMax,
        invulSec: RULES.invulSec, strike: strikeOn(this.enemyId) ? RULES.strike : null } });
    if (this.phase === "fight") {
      this.send(p.ws, this.startMsg());
      const ft = this.ft(), list = this.pending.filter((e) => e.t > ft - 0.5 || (e.k === "mode" && e.until >= ft)).map(pubEv);
      for (const m of this.dir ? this.dir.modes || [] : []) if (m.until >= ft - 0.5 && !list.some((x) => x.id === m.id)) list.push(pubEv(m));   // 2.3.11: an active ride survives a reconnect
      if (list.length) this.send(p.ws, { t: "atk", list, ow: this.dir ? this.dir.wins.filter((w) => w[1] > ft) : undefined, bt: this.dir && this.dir.beats ? this.dir.beats.filter((x) => x > ft - 1) : undefined, tg: this.dir && this.dir.tgts ? this.dir.tgts.filter((x) => x[1] > ft) : undefined });
      // the server body is the truth after a reconnect: the client starts from it (presses already received included)
      const bb = { ...p.body }; for (const q of p.presses) { if (q.ft > ft) break; applyPress(bb, q.ft, q.a); }
      const b = bodyAt(bb, Math.max(0, ft));
      this.send(p.ws, { t: "you", lane: b.lane, hearts: p.hearts, dmg: p.dmg, combo: p.streak, ch: p.charges, oc: p.orbC });
    }
  }
  pubPlayers() { return [...this.players.values()].filter((p) => !p.cheat).map((p) => ({ pid: p.pid, nick: p.nick, skin: p.skin, trail: p.trail, on: p.on })); }
  startMsg() { return { t: "start", at: this.startAt, now: Date.now(), seed: this.seed, enemy: pubEnemy(this.enemyId), hpMax: this.hpMax, hp: this.hp, limit: this.limitSec || this.enemy.limit, pool: pubPool(this.pool), timed: 1, practice: this.practice ? 1 : undefined,
    pph: this.pph || 0, pth: PHASE_TH, plan: this.pool && this.pool.plan ? this.pool.plan : undefined }; }   // 2.3.12 the match's phase (of the pool), the thresholds, «План дня»
  // 2.3.11 one hit of a player: his damage + the live shared pool (sent in batches by flush)
  // 2.3.12 practice: the match's own hp only (nothing to the shared pool); a no-reward player (cheats this session): his damage is
  // shown to him but never reaches the shared pool (no kill reward, no weekly fund)
  hit(p, d) {
    p.dmg += d;
    if (this.practice) { this.hp = Math.max(0, this.hp - d); return; }
    if (p.nr) return;
    this.dealt += d; this.unflushed += d; this.unsent.push([p.acc, p.nick, d]); this.hp = Math.max(0, Math.min(this.hpMax, this.hp - d));
  }
  flush() {
    if (this.flushing || !this.period || this.phase === "new") return this.flushing || null;
    if (!this.batch) { if (!this.unsent.length) return null; this.batch = { seq: ++this.seq, hits: this.unsent.slice(0, 400) }; this.unsent = this.unsent.slice(400); }
    const bt = this.batch, sum = bt.hits.reduce((a, h) => a + h[2], 0);
    const body = { op: "hit", period: this.period, match: this.name, enemy: this.enemyId, kind: this.enemy.kind, week: this.week, seq: bt.seq, hits: bt.hits };
    this.flushing = (async () => {
      let r = null;
      for (let i = 0; i < 3 && !(r && r.ok); i++) { if (i) await sleepMs(300 * 2 ** i); try { r = await onlineCall(this.env, body); } catch (e) { r = null; } }
      this.flushing = null;
      if (!(r && r.ok)) { console.log("raid3 hit flush failed", this.name, bt.seq); return; }   // the same batch (same seq) goes again next time
      this.batch = null; this.unflushed -= sum;
      if (r.pool) { this.pool = r.pool; this.hpMax = Math.max(1, r.pool.hpMax); }
      this.hp = Math.max(0, (this.pool ? this.pool.hp : this.hp) - this.unflushed);
      if (r.killedNow && r.killer) { this.killer = r.killer; this.killMap = r.kill || {}; if (this.phase === "fight") await this.finish(true, "killed"); }
    })();
    return this.flushing;
  }

  onClose(ws, meta) {
    this.socks.delete(ws);
    const p = meta.pid ? this.players.get(meta.pid) : null;
    if (p && p.ws === ws) this.disconnect(p);
  }
  disconnect(p) {
    if (p.on) p.onMs += Math.max(0, Date.now() - p.onSince);
    p.on = false; p.ws = null; p.offAt = Date.now();
    if (this.phase === "lobby") {
      if (p.left) { this.players.delete(p.pid); this.byAcc.delete(p.acc); hubCall(this.env, "done", { match: this.name, accs: [p.acc] }).catch(() => {}); }
      this.bcast({ t: "lobby", players: this.pubPlayers(), lobbyEnds: this.lobbyEnds });
    }
  }

  // ---------------------------------------------------------------- presses: time checks, rate, distance
  // Every check is made for a phone on a mobile network: frames arrive late and in bursts, the phone's clock may jump.
  //   * a press may be dated rtt/2 + lagSlack back (more is clamped, never applied before an already judged moment);
  //     it is SUSPICIOUS only when it is > 1 s older than the frame's own fight time (back-dating against one's own clock) —
  //     a frame that was stuck in the network is old as a whole and is not;
  //   * future: a press / frame time > 0.85 s ahead costs 1 point at most once a second; > CLOCK_FAR ahead = a clock jump:
  //     clamped to now, no points, the client is asked to resync ({t:'clk'});
  //   * press rate in press time (monotonic, ≤ now): a burst of presses that waited in the network is not «fast fingers».
  input(p, m) {
    if (this.phase !== "fight" || p.cheat) return;
    const now = this.ft();
    const rtt = p.rtts.length ? [...p.rtts].sort((a, b) => a - b)[p.rtts.length >> 1] : 0.3;
    const minFt = now - rtt / 2 - RULES.lagSlack, maxFt = now + RULES.futureSlack;
    const mft = typeof m.ft === "number" && Number.isFinite(m.ft) ? m.ft : null;
    const list = Array.isArray(m.a) ? m.a.slice(0, 12) : [];
    if (Array.isArray(m.a) && m.a.length > 12) this.sus(p, 1, "batch");
    let fut = false, far = false, late = false, fast = false, bad = false;
    for (const it of list) {
      if (!Array.isArray(it) || typeof it[0] !== "number" || !Number.isFinite(it[0]) || !["L", "R", "U", "D", "S"].includes(it[1])) { bad = true; continue; }
      const t0 = it[0];
      if (t0 < p.rejoinFt) continue;                  // sent before the reconnect: the client restarted from the server body
      let ft = t0;
      if (ft > maxFt + 0.5) { if (ft - now > CLOCK_FAR) far = true; else fut = true; ft = now; }
      else if (ft > maxFt) ft = maxFt;
      if (ft < minFt) { if (mft !== null && mft - t0 > 1.0 && mft - now < CLOCK_FAR) late = true; ft = minFt; }
      const last = p.presses.length ? p.presses[p.presses.length - 1].ft : p.judgedT;
      if (ft < last) ft = last;                       // order is the order of arrival; never before an already judged moment
      const rf = Math.max(Math.min(t0, maxFt), p.rateFt); p.rateFt = rf;
      p.pressTimes = p.pressTimes.filter((x) => rf - x < 1); p.pressTimes.push(rf);
      if (p.pressTimes.length > RULES.pressMaxPerSec) { fast = true; continue; }
      p.presses.push({ ft: Math.round(ft * 1000) / 1000, a: it[1] }); p.pressN = (p.pressN || 0) + 1;
      if (it[1] === "S") p.sq.push(Math.round(ft * 1000) / 1000);   // 2.3.11: resolved in tick() once every orb before it is judged
    }
    if (mft !== null) {
      if (mft > maxFt + 0.5) { if (mft - now > CLOCK_FAR) far = true; else fut = true; }
      const f = Math.min(mft, maxFt);
      if (f > p.lastFt) p.lastFt = f;
      if (now - mft > CLOCK_FAR) far = true;          // far behind: the same clock problem (a stalled frame is seconds old, not minutes)
    }
    if (bad) this.sus(p, 0.5, "bad_press");
    if (fast) this.sus(p, 0.5, "press_rate");
    if (late) this.sus(p, 0.5, "late");
    if (fut && now - p.futAt >= 1) { p.futAt = now; this.sus(p, 1, "future"); }
    if (far) { p.flags.clock = (p.flags.clock || 0) + 1; if (Date.now() - p.clkAt > 3000 && p.ws) { p.clkAt = Date.now(); this.send(p.ws, { t: "clk" }); } }
    if (typeof m.d === "number" && Number.isFinite(m.d) && mft !== null) {
      const exp = PHYS.speed * Math.max(0, mft);
      if (Math.abs(m.d - exp) > 4 + exp * 0.05 && now - (p.distAt || -9) > 2) { p.distAt = now; this.sus(p, 1, "distance"); }
      p.lastD = m.d;
    }
  }
  sus(p, w, why) {
    if (p.cheat) return;
    p.sus += w; p.flags[why] = (p.flags[why] || 0) + 1;
    if (p.sus >= RULES.susKick) this.kick(p, why);
  }
  kick(p, why) {
    if (p.cheat) return;
    p.cheat = true; p.cheatWhy = why;
    if (this.phase === "fight" && p.dmg > 0 && !this.practice && !p.nr) { this.unsent.push([p.acc, p.nick, -p.dmg]); this.unflushed -= p.dmg; this.dealt -= p.dmg; this.hp = Math.min(this.hpMax, this.hp + p.dmg); }   // a cheater's damage is given back to the pool
    p.dmg = 0;
    console.log("raid3 kick", this.name, p.acc, why, JSON.stringify(p.flags));
    if (p.ws) { this.send(p.ws, { t: "kick", why: "suspicious" }); try { p.ws.close(4009, "suspicious"); } catch { /* */ } }
    this.disconnect(p);
    this.bcast({ t: "lobby", players: this.pubPlayers(), lobbyEnds: this.lobbyEnds, removed: p.pid });
  }

  // ---------------------------------------------------------------- the clock
  tick() {
    const t = Date.now();
    if (this.phase === "lobby") {
      const fair = [...this.players.values()].filter((p) => !p.cheat);
      if (!fair.some((p) => p.on) && t > this.lobbyEnds + 30000) { this.finish(false, "empty"); return; }
      if (t >= this.lobbyEnds && fair.some((p) => p.on)) this.begin();
      return;
    }
    if (this.phase !== "fight") return;
    // a phone that went away without closing (half-open socket): after IDLE_MS of silence it is offline (its client reconnects)
    for (const p of this.players.values()) {
      if (p.ws && p.on && t - p.lastMsg > IDLE_MS) { const w = p.ws, om = this.socks.get(w); if (om) om.pid = null; this.disconnect(p); try { w.close(4002, "idle"); } catch { /* */ } }
    }
    const ft = this.ft();
    if (ft < 0) return;
    // new events (same for everybody), announced ~2 s ahead
    const fresh = this.dir.advance(ft + 3.2, this.hp / this.hpMax, Math.max(0, ft));   // 2.3.11: hp = the live shared pool (+ the time marks)
    if (Date.now() - this.flushAt > 2000) { this.flushAt = Date.now(); this.flush(); }
    const nw = this.dir.wins.length > (this.winSent || 0) ? this.dir.wins.slice(this.winSent || 0) : null;
    const nb = (this.dir.beats || []).length > (this.beatSent || 0) ? this.dir.beats.slice(this.beatSent || 0) : null, ng = (this.dir.tgts || []).length > (this.tgSent || 0) ? this.dir.tgts.slice(this.tgSent || 0) : null;
    if (fresh.length || nw || nb || ng) { this.pending.push(...fresh); this.winSent = this.dir.wins.length; this.beatSent = (this.dir.beats || []).length; this.tgSent = (this.dir.tgts || []).length; this.bcast({ t: "atk", list: fresh.map(pubEv), ow: nw || undefined, bt: nb || undefined, tg: ng || undefined }); }
    // judge
    const ev = [];
    const keep = [];
    for (const e of this.pending) {
      let open = false;
      for (const p of this.players.values()) {
        if (p.cheat || (e.done && e.done.has(p.pid))) continue;
        if (!(p.lastFt >= e.t + 0.05 || ft >= e.t + RULES.judgeMaxLag)) { open = true; continue; }
        (e.done || (e.done = new Set())).add(p.pid);
        this.judgeOne(p, e, ev);
      }
      if (open || ft < e.t + RULES.judgeMaxLag) keep.push(e);
    }
    this.pending = keep;
    // 2.3.11 strikes: a strike press is resolved when the player's clock is past it (every orb before it is judged by then)
    for (const p of this.players.values()) if (p.sq.length && !p.cheat) this.strikes(p, ft, ev);
    // revive
    for (const p of this.players.values()) {
      if (p.downUntil > 0 && ft >= p.downUntil) {
        // 2.3.11 «без сознания» is over: back on the MIDDLE lane with all hearts (presses from while it was out are dropped)
        const t0 = p.downUntil, gl = p.body.gl ? { gl: p.body.gl, alt: p.body.alt, altPrev: p.body.altPrev, altAt: p.body.altAt, gd: p.body.gd } : {};
        for (const k of ["rg", "mr", "du", "wa"]) if (p.body[k]) gl[k] = p.body[k];   // 2.3.11 the enemy's own way of moving goes on
        if (gl.rg && gl.rg[1] >= t0) gl.ll = [[t0, 0]];
        p.presses = p.presses.filter((q) => q.ft > t0); p.sq = p.sq.filter((x) => x > t0);
        p.body = Object.assign(newBody(), gl, gl.rg && gl.rg[1] >= t0 ? { lane: 0, prevLane: 0, laneAt: t0 } : { lane: 1, prevLane: 1, laneAt: t0 });
        p.downUntil = -9; p.hearts = RULES.hearts; p.invulUntil = ft + RULES.upInvulSec; ev.push([p.pid, 0, "u", 0]);
      }
    }
    // suspicion decays slowly
    if (ft - this.lastSus > 5) { this.lastSus = ft; for (const p of this.players.values()) p.sus = Math.max(0, p.sus - RULES.susDecayPer5s); }
    if (t - (this.lastPing || 0) > 1000) { this.lastPing = t; this.bcast({ t: "sp", s: t }); }
    const ps = [...this.players.values()].filter((p) => !p.cheat).map((p) => {
      const at = Math.min(p.lastFt, ft), bb = { ...p.body };
      for (const q of p.presses) { if (q.ft > at) break; applyPress(bb, q.ft, q.a); }
      const b = bodyAt(bb, at);
      return [p.pid, p.hearts, p.downUntil > 0 ? Math.max(0, Math.round((p.downUntil - ft) * 10) / 10) : 0, p.dmg, b.lane, b.high ? 1 : b.slide ? 2 : 0, p.on ? 1 : 0, p.streak, p.charges, p.orbC];
    });
    this.bcast({ t: "tick", ft: Math.round(ft * 100) / 100, hp: this.hp, ph: this.dir.phaseAt(this.hp / this.hpMax, ft), ps, ev,
      pool: [this.hp, this.hpMax, this.pool && this.pool.killed ? 1 : 0], md: this.modeNow(ft) });   // 2.3.11 md = the ride / special phase now [id, mode, from, until, v] (a late join / a lost atk still sees it)   // 2.3.11: the live shared pool (old clients ignore it)
    // the end (2.3.11): the time is up = «бой окончен» (a win: everybody who survived to the end); everybody in the fight knocked
    // out at the same moment = «Все пали» at once (solo: your knockout); the killing blow on the pool ends it in flush()
    if (this.practice && this.hp <= 0) return this.finish(true, "killed");   // 2.3.12 practice: its own hp is the kill
    if (ft >= this.limitSec) return this.finish(true, "time");
    const onl = [...this.players.values()].filter((p) => !p.cheat && p.on), alive = onl.filter((p) => !(p.downUntil > 0));
    if (onl.length && !alive.length) return this.finish(false, "wiped");
    if (!onl.length) { this.noneSince = this.noneSince || t; if (t - this.noneSince > 20000) return this.finish(false, "empty"); }
    else this.noneSince = 0;
  }
  // 2.3.12 the other players (online, up, not cheating) at time t: lane + alt from their bodies (the presses known so far)
  mates(p, t) {
    const out = [];
    for (const q of this.players.values()) {
      if (q === p || q.cheat || !q.on || q.downUntil > 0) continue;
      const bb = { ...q.body }; for (const x of q.presses) { if (x.ft > t) break; applyPress(bb, x.ft, x.a); }
      const b = bodyAt(bb, t); out.push({ lane: b.lane, alt: b.alt });
    }
    return out;
  }
  modeNow(ft) { let r = null; for (const m of this.dir ? this.dir.modes || [] : []) if (ft >= m.t - 0.6 && ft <= m.until + 0.4 && m.mode !== "end") r = [m.id, m.mode, m.t, m.until, m.v]; return r; }   // the latest one (a special phase inside a whole-fight mode)
  anyOn() { for (const p of this.players.values()) if (!p.cheat && p.on) return true; return false; }

  begin() {
    const fair = [...this.players.values()].filter((p) => !p.cheat), t = Date.now();
    // hp for the players who are here (or dropped < 15 s ago and likely coming back), not for every phone that ever joined the lobby
    const n = Math.max(1, fair.filter((p) => p.on || t - p.offAt < 15000).length);
    const b = new Uint32Array(1); crypto.getRandomValues(b);
    this.seed = (b[0] % 2147483646) + 1;
    // 2.3.12 (owner 07.11): the phase of the whole match = the phase of the shared pool now (practice: the owner's choice)
    this.pph = this.practice ? (this.pracPh || 0) : this.pool ? poolPhase(this.pool.hp, this.pool.hpMax) : 0;
    this.dir = new Director(this.seed, this.enemyId, { phase: this.pph, limit: fightSec(this.env, this.enemy.limit), acts: this.env.RAID3_ACTS === "1" });   // interactions: off for 2.3.12
    // 2.3.11 (owner): no hp of the match — a timed fight; every hit goes live into the shared pool (flush() every ~2 s), the enemy
    // dies only when the pool reaches 0 (the killing blow ends the match: «killed»). hp / hpMax = the live shared pool (old clients
    // draw it in their match bar; a pool not loaded yet: a stand-in of the old size)
    this.unsent = []; this.batch = null; this.unflushed = 0; this.dealt = 0; this.seq = 0; this.flushAt = Date.now(); this.killer = null;
    this.cleanupStart = !!(this.pool && this.pool.killed); this.limitSec = fightSec(this.env, this.enemy.limit);
    this.hpMax = this.pool ? Math.max(1, this.pool.hpMax) : Math.max(1, Math.round(this.enemy.hp * n * this.hpK));
    this.hp = this.pool ? Math.max(0, this.pool.hp) : this.hpMax;
    this.startAt = t + RULES.countdownSec * 1000;
    this.phase = "fight";
    for (const p of fair) { p.onMs = 0; if (p.on) p.onSince = this.startAt; }   // lobby time is not fight time
    this.ctx.storage.put("began", t).catch(() => {});
    this.bcast(this.startMsg());
  }

  judgeOne(p, e, out) {
    if (!p.on && !(p.lastFt >= e.t)) return;          // offline players are neither hurt nor paid
    if (e.t > p.judgedT) p.judgedT = e.t;
    // fold presses up to e.t into the body (events are judged in time order per player)
    while (p.presses.length && p.presses[0].ft <= e.t) { const q = p.presses.shift(); applyPress(p.body, q.ft, q.a); }
    if (e.k === "warp") { warpBody(p.body, e); return; }   // portals / pull move everybody (also a downed ball), never hurt
    if (e.k === "tilt") { tiltBody(p.body, e); out.push([p.pid, e.id, "t", 0]); return; }   // 2.3.12 the deck tilts
    if (e.k === "mode") { modeBody(p.body, e); return; }   // 2.5 phases of movement: the glider has its own heights
    if (p.downUntil > 0) return;
    const s = bodyAt(p.body, e.t);
    let j = judge2(e, s, p.body);   // 2.3.11: + parry / clash / echo / mirror / cell; 2.3.12 + the interactions (raid3_rules.js)
    if (j === "blocked") { out.push([p.pid, e.id, "b", 0]); return; }   // a shield took it
    // 2.3.12 the team kinds: a grab is beaten by a teammate next to you; the co-op bonus needs everybody on the marks
    if (e.k === "grab" && j === "hurt" && this.mates(p, e.t).some((q) => Math.abs(q.lane - s.lane) + Math.abs((q.alt == null ? 1 : q.alt) - (s.alt == null ? 1 : s.alt)) === 1)) { out.push([p.pid, e.id, "k", 0]); return; }
    if (e.k === "coop" && j === "gain") { const ms = this.mates(p, e.t); if (!ms.every((q) => (e.cells || []).some((c) => c[0] === q.lane && c[1] === (q.alt == null ? 1 : q.alt)) || (e.lanes || []).includes(q.lane))) j = null; }
    if (!j) return;
    if (j === "gain") {   // an orb (× e.x: the prism of the Weaver), a parry / a clash (counter blow, × e.x or 2)
      const mult = 1 + Math.min(p.streak, RULES.comboMax) * RULES.comboStep;
      const d = Math.round(orbDmgOf(this.enemyId) * mult * (e.x != null ? e.x : e.k === "orb" ? 1 : 2));
      if (e.item === "charge" && p.charges < RULES.strike.max) p.charges++;   // 2.3.12 a picked charge crystal
      p.streak++; p.orbs++;
      if (e.k === "parry") p.parryRun = (p.parryRun || 0) + 1;   // 2.3.12 the Knight: 4 clean parries in a row = a breach (the next strike ×2)
      if (strikeOn(this.enemyId)) { p.orbC = Math.min(RULES.strike.every, p.orbC + 1); if (p.orbC >= RULES.strike.every && p.charges < RULES.strike.max) { p.charges++; p.orbC = 0; } }
      if (d > 0) this.hit(p, d);
      out.push([p.pid, e.id, "o", d]);
    } else {
      if (e.t < p.invulUntil) return;
      p.hits++; p.streak = 0; p.parryRun = 0; p.hearts--; p.invulUntil = e.t + RULES.invulSec;
      out.push([p.pid, e.id, "h", 0]);
      if (p.hearts <= 0) { p.downUntil = e.t + RULES.downSec; out.push([p.pid, e.id, "d", 0]); }
    }
  }

  // 2.3.11 «Удар»: a strike press with a charge = orbDmg × k × combo (× openK inside an «открыт» window of the director);
  // without a charge, while down or after the end it is only the jump it already was. Judged at the press's own (clamped) time.
  strikes(p, ft, out) {
    while (p.sq.length) {
      const st = p.sq[0];
      if (!(p.lastFt >= st + 0.05 || ft >= st + RULES.judgeMaxLag)) return;
      p.sq.shift();
      if (!strikeOn(this.enemyId) || (p.downUntil > 0 && st < p.downUntil)) continue;
      if (!p.on && !(p.lastFt >= st)) continue;
      // 2.3.11 the Warden: a strike on the beat (±BEAT_W) = ×2; on the beat without a charge = one ◆ of damage (once per beat)
      const bt = (this.dir.beats || []).find((x) => Math.abs(x - st) <= BEAT_W);
      if (p.body.hpn) {   // 2.3.12 a harpoon: the swipe throws it (no charge needed) — ×8
        p.body.hpn = 0; const dh = Math.round(orbDmgOf(this.enemyId) * 8 * (1 + Math.min(p.streak, RULES.comboMax) * RULES.comboStep));
        this.hit(p, dh); out.push([p.pid, 0, "s", dh, 3]); continue;
      }
      if (p.charges <= 0) {
        if (bt == null || p.beatUsed === bt) continue;
        p.beatUsed = bt; const d0 = Math.round(orbDmgOf(this.enemyId) * (1 + Math.min(p.streak, RULES.comboMax) * RULES.comboStep));
        this.hit(p, d0); out.push([p.pid, 0, "s", d0, 2]); continue;
      }
      const w = openAt(this.dir.wins, st);
      let d = strikeDmg(p.streak, !!w, orbDmgOf(this.enemyId));
      if (bt != null) { d *= 2; p.beatUsed = bt; p.chord = (p.chord || 0) + 1; if (p.chord >= 3) { d *= 2; p.chord = 0; } } else p.chord = 0;   // 2.3.12 the chord: the 3rd beat strike in a row ×2 more
      // 2.3.11 the Spawn: the strike hits the glowing main one only from its lane (×2); from another lane a copy (×0.5)
      if ((p.parryRun || 0) >= 4) { d *= 2; p.parryRun = 0; out.push([p.pid, 0, "x", 0]); }   // the breach
      const tg = (this.dir.tgts || []).find((x) => st >= x[0] && st <= x[1]);
      if (tg) d = Math.round(d * (laneAtT(p.body, st) === tg[2] ? 2 : 0.5));
      p.charges--; p.strikes++;
      if (d > 0) this.hit(p, d);
      out.push([p.pid, 0, "s", d, w ? 1 : 0, bt != null ? 1 : 0, tg ? (laneAtT(p.body, st) === tg[2] ? 1 : -1) : 0]);
    }
  }

  async finish(won, why) {
    if (this.phase === "end") return;
    const wasFight = this.phase === "fight";
    this.phase = "end";
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (wasFight) { for (let i = 0; i < 3 && (this.unsent.length || this.batch || this.flushing); i++) { try { await (this.flushing || this.flush()); } catch (e) { /* */ } } }   // the last hits reach the pool first
    const ft = this.ft(), dur = Math.max(1, Math.min(ft, this.limitSec || (this.enemy ? this.enemy.limit : 1))) * 1000;
    const list = [...this.players.values()];
    for (const p of list) if (p.on) { p.onMs += Math.max(0, Date.now() - Math.max(p.onSince, this.startAt || p.onSince)); p.onSince = Date.now(); }
    const wipe = why === "wiped";
    const rw = wasFight && !this.practice && (won || wipe) ? rewards(this.enemy.kind, list.map((p) => ({ pid: p.pid, dmg: p.dmg, cheat: p.cheat, onFrac: Math.min(1, p.onMs / dur), afk: (p.pressN || 0) < dur / 1000 / RULES.afkPressEverySec }))) : [];
    if (wipe) for (const r of rw) if (r.gems > 0) r.gems = Math.max(1, Math.round(r.gems * WIPE_K));
    for (const r of rw) { const q = this.players.get(r.pid); if (q && q.nr) { r.gems = 0; r.why = "nr"; } }   // 2.3.12 cheats this session: no reward
    const byPid = new Map(rw.map((r) => [r.pid, r]));
    let granted = {}, gemsBy = {}, killBy = {}, cleanup = false, killedNow = false;
    if (wasFight && !this.practice) {   // 2.3.12 a practice match writes nothing (no rewards, no fund, not a match of the week)
      // the write is idempotent in the Online DO (once per match+account, the pool once per match): retried when it fails
      const body = { op: "result", match: this.name, day: this.day, kind: this.enemy.kind, enemy: this.enemyId, won, wipe, live: true, cleanup: !!this.cleanupStart,
        period: this.period, week: this.week,
        players: list.map((p) => { const r = byPid.get(p.pid); return { acc: p.acc, nick: p.nick, dmg: p.nr ? 0 : p.dmg, gems: r && !p.nr ? r.gems : 0, cheat: p.cheat, why: p.cheat ? p.cheatWhy : null, flags: p.flags,
          afk: !!(p.nr || (r && (r.why === "afk" || r.why === "offline"))) }; }) };   // afk / offline: no part of the weekly fund
      let res = null;
      for (let i = 0; i < 4 && !(res && res.ok); i++) {
        if (i) await sleepMs(300 * 2 ** i);         // 0.6 s, 1.2 s, 2.4 s
        try { res = await onlineCall(this.env, body); } catch (e) { res = null; console.log("raid3 result try", i, e && e.message || e); }
      }
      if (res && res.ok) {
        granted = res.status || {}; gemsBy = res.gems || {}; killBy = res.kill || {};
        if (res.pool) this.pool = res.pool;
        cleanup = !!res.cleanup; killedNow = !!res.killedNow;
      } else console.log("raid3 result FAILED", this.name, JSON.stringify(res));
    }
    const total = list.reduce((s, p) => s + (p.cheat ? 0 : p.dmg), 0);
    const results = list.filter((p) => !p.cheat).map((p) => {
      const r = byPid.get(p.pid), g = granted[p.acc];
      const gems = r && g === "ok" ? (gemsBy[p.acc] != null ? gemsBy[p.acc] : r.gems) : 0;
      return { pid: p.pid, nick: p.nick, dmg: p.dmg, orbs: p.orbs, hits: p.hits, strikes: p.strikes, share: total ? Math.round(p.dmg / total * 1000) / 1000 : 0, gems, kill: killBy[p.acc] || 0, why: this.practice ? "practice" : !won ? why : r && r.gems > 0 ? (g || "server") : r ? r.why : "none" };
    }).sort((a, b) => b.dmg - a.dmg);
    const kp = this.killer ? [...this.players.values()].find((p) => p.acc === this.killer.acc) : null;
    this.endMsg = { t: "end", won, why, ft: Math.round(ft * 100) / 100, hp: this.hp, hpMax: this.hpMax, results, pool: pubPool(this.pool), cleanup, killedNow,
      timed: 1, killer: kp ? { pid: kp.pid, nick: kp.nick, gems: this.killer.gems } : null, practice: this.practice ? 1 : undefined };
    this.bcast(this.endMsg);
    hubCall(this.env, "done", { match: this.name, accs: list.map((p) => p.acc) }).catch(() => hubCall(this.env, "done", { match: this.name, accs: list.map((p) => p.acc) }).catch(() => {}));
    setTimeout(() => { for (const p of this.players.values()) if (p.ws) { try { p.ws.close(1000, "end"); } catch { /* */ } } }, 4000);
  }
}
function pubPool(p) { return p ? { hp: p.hp, hpMax: p.hpMax, killed: p.killed, players: p.players, matches: p.matches, top: p.top } : null; }
function pubEv(e) {
  const o = { id: e.id, k: e.k, v: e.v, t: e.t, at: e.at, p: e.p };
  if (e.lanes) o.lanes = e.lanes;
  if (e.map) o.map = e.map;
  if (e.k === "mode") { o.mode = e.mode; o.until = e.until; }   // 2.5 phases of movement (bike, glider, …): the client needs the window
  if (e.k === "orb") { o.lane = e.lane; o.hi = e.hi ? 1 : 0; if (e.row != null) o.row = e.row; if (e.x) o.x = e.x; }
  for (const k of ["cells", "dir", "d", "g", "x", "until2", "side", "item", "lo", "rmap", "row"]) if (e[k] != null && o[k] == null) o[k] = e[k];
  if (e.k !== "orb" && e.hi) o.hi = 1;   // 2.3.11 the new kinds (old clients ignore them)
  if (e.k !== "orb" && !o.lanes && e.cells) o.lanes = [...new Set(e.cells.map((c) => c[0]))].sort();   // old clients: draw the cells as lanes
  return o;
}
