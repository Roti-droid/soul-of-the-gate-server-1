// creator.js — «Душа Врат»: «Создать» — player-made levels, «Искры автора» (✦), «Магазин автора», «Битвы авторов».
//
//   GET  /api/v2/creator/info                         -> {ok, shop, caps, week, theme, ends}
//   GET  /api/v2/creator/list?sort=new|top|plays|featured|battle&q=&page=&week=   -> {ok, rows, page, more}
//   GET  /api/v2/creator/level?id=                    -> {ok, level:{…meta, data}}
//   GET  /api/v2/creator/battle?week=                 -> {ok, week, theme, ends, rows, winners, prev}
//   POST /api/v2/creator/me       {id,secret}         -> {ok, sparks, total, owned, badge, today, mine[…meta, earned, prize], author{levels,plays,completes,likes,earned}, banned}
//   POST /api/v2/creator/publish  {id,secret,level,battle?}  -> {ok, lid}     (account only, rate / size limited, validated here)
//   POST /api/v2/creator/start    {id,secret,lid}     -> {ok, tk, plays}       a ticket: the completion must come through it
//   POST /api/v2/creator/finish   {id,secret,tk,t,rec,cry,mod?}  -> {ok, first, sparks, author, balance, why?}
//   POST /api/v2/creator/like     {id,secret,lid}     -> {ok, likes}           only after a verified completion, once, never own
//   POST /api/v2/creator/report   {id,secret,lid,reason}  -> {ok}               once per account; 5 reports hide until the god panel looks
//   POST /api/v2/creator/buy      {id,secret,item}    -> {ok, item, sparks, owned}
//   POST /api/v2/creator/badge    {id,secret,badge}   -> {ok, badge}           wear an owned badge (shown next to the nick) or null
//   (god panel, from the Online DO only) POST https://creator/god {action: cr_hide|cr_unhide|cr_ban|cr_unban|cr_reports|cr_levels}
//
// ✦ live ONLY here (server-authoritative): a completion pays only through a ticket from /start, the claimed time must fit the
// wall clock since the ticket and the level's physics (creator_rules.js passCheck: not faster than the speed curve allows, a
// pass record that is legal for every hazard, lane changes the ball can make, crystals ≤ what the level has) — the same idea
// as online.js runProblem / ghostProblem for normal runs. A level pays ONCE per account (never the author's own level), daily
// caps per player and per author, no author pay when the completer comes from the author's publish IP. Mods active → no pay.
// Punished accounts (accounts_guard.js gate: banned / suspended / no consent) can't publish, play for ✦, like or report.

import { accCall } from "./accounts.js";
import { gate, isOwnerId } from "./accounts_guard.js";
import C from "./creator_rules.js";

const ACC_RE = /^[0-9a-f]{12}$/;
const LID_RE = /^[0-9a-z]{8}$/;
const TK_RE = /^[0-9a-f]{24}$/;
const BODY_MAX = 16384;
const PAGE = 20;
const TICKET_TTL = 2 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const dayKey = (t = now()) => new Date(t * 1000).toISOString().slice(0, 10);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
}
function hex(b) { return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function sha(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }
function rid(n, alpha) { const b = crypto.getRandomValues(new Uint8Array(n)); let s = ""; for (const x of b) s += alpha[x % alpha.length]; return s; }

// ------------------------------------------------------------------ worker entry (index.js routes /api/v2/creator/* here)
export async function handleCreator(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: env.CREATOR_TEST === "1" ? { ...CORS, "access-control-allow-headers": "content-type, x-test-ip" } : CORS });
  if (!env.CREATOR) return json({ err: "not_configured" }, 503);
  if (request.method !== "GET" && request.method !== "POST") return json({ err: "method" }, 405);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > BODY_MAX) return json({ err: "too_big" }, 413);
  const body = request.method === "POST" ? await request.text() : null;
  if (body && body.length > BODY_MAX) return json({ err: "too_big" }, 413);
  const url = new URL(request.url);
  const stub = env.CREATOR.get(env.CREATOR.idFromName("creator"));
  let ip = request.headers.get("cf-connecting-ip") || "local";
  if (env.CREATOR_TEST === "1" && /^[0-9.]{7,15}$/.test(request.headers.get("x-test-ip") || "")) ip = request.headers.get("x-test-ip");   // tests only: one IP per test account
  const res = await stub.fetch("https://creator" + url.pathname.replace(/^\/api\/v2\/creator/, "") + url.search, {
    method: request.method, headers: { "content-type": "application/json", "x-ip": ip, "x-internal": "creator" }, body });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
}

// god panel actions (merged into online.js GOD): they forward to the Creator DO
async function godFwd(env, action, b) {
  if (!env.CREATOR) return { err: "not_configured" };
  const st = env.CREATOR.get(env.CREATOR.idFromName("creator"));
  const r = await st.fetch("https://creator/god", { method: "POST", headers: { "content-type": "application/json", "x-internal": "god" }, body: JSON.stringify({ ...b, action }) });
  return r.json();
}
export const CREATOR_GOD = {
  cr_hide(b) { return godFwd(this.env, "cr_hide", { lid: b.lid, reason: b.reason || b.note }); },
  cr_unhide(b) { return godFwd(this.env, "cr_unhide", { lid: b.lid }); },
  cr_ban(b) { if (isOwnerId(this.env, b.to)) return { err: "self" }; return godFwd(this.env, "cr_ban", { to: b.to, reason: b.reason || b.note }); },
  cr_unban(b) { return godFwd(this.env, "cr_unban", { to: b.to }); },
  cr_reports(b) { return godFwd(this.env, "cr_reports", { limit: b.limit }); },
  cr_levels(b) { return godFwd(this.env, "cr_levels", { to: b.to }); },
};

// ------------------------------------------------------------------ Durable Object
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS levels (id TEXT PRIMARY KEY, author TEXT NOT NULL, nick TEXT, title TEXT NOT NULL, data TEXT NOT NULL,
    env TEXT, world TEXT, len INTEGER, spd TEXT, haz INTEGER, created INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, hide_reason TEXT,
    plays INTEGER NOT NULL DEFAULT 0, completes INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
    week INTEGER, featured INTEGER, ip_h TEXT)`,
  "CREATE INDEX IF NOT EXISTS levels_new ON levels (hidden, created)",
  "CREATE INDEX IF NOT EXISTS levels_author ON levels (author, created)",
  "CREATE INDEX IF NOT EXISTS levels_week ON levels (week, likes)",
  "CREATE TABLE IF NOT EXISTS plays (lid TEXT NOT NULL, acc TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (lid, acc, day))",
  "CREATE TABLE IF NOT EXISTS tickets (tk TEXT PRIMARY KEY, acc TEXT NOT NULL, lid TEXT NOT NULL, at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, ip_h TEXT)",
  "CREATE INDEX IF NOT EXISTS tickets_at ON tickets (at)",
  `CREATE TABLE IF NOT EXISTS completes (lid TEXT NOT NULL, acc TEXT NOT NULL, at INTEGER NOT NULL, t REAL NOT NULL, sparks INTEGER NOT NULL,
    author_sparks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (lid, acc))`,
  "CREATE TABLE IF NOT EXISTS likes (lid TEXT NOT NULL, acc TEXT NOT NULL, at INTEGER NOT NULL, week INTEGER, PRIMARY KEY (lid, acc))",
  "CREATE TABLE IF NOT EXISTS reports (lid TEXT NOT NULL, acc TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL, PRIMARY KEY (lid, acc))",
  `CREATE TABLE IF NOT EXISTS wallet (acc TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, day TEXT,
    p_day INTEGER NOT NULL DEFAULT 0, p_lv INTEGER NOT NULL DEFAULT 0, a_day INTEGER NOT NULL DEFAULT 0, pub_day INTEGER NOT NULL DEFAULT 0,
    pub_at INTEGER, badge TEXT, banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT)`,
  "CREATE TABLE IF NOT EXISTS owned (acc TEXT NOT NULL, item TEXT NOT NULL, at INTEGER NOT NULL, src TEXT, PRIMARY KEY (acc, item))",
  "CREATE TABLE IF NOT EXISTS log (n INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS log_acc ON log (acc, at)",
  "CREATE TABLE IF NOT EXISTS battles (week INTEGER PRIMARY KEY, theme TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, winners TEXT)",
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)",
];
const IP_PER_MIN = 120, WRITE_PER_MIN_IP = 40, AUTH_PER_MIN_IP = 60;

export class Creator {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
    this.authOk = new Map(); this.hits = new Map();
  }
  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.rows(q, ...b)[0] || null; }
  test() { return this.env.CREATOR_TEST === "1"; }
  t() { const s = this.test() ? Number((this.one("SELECT v FROM kv WHERE k = 'shift'") || {}).v || 0) : 0; return now() + s; }   // test knob: shifted clock
  week() { return C.weekOf(this.t()); }
  limit(k, n, sec) {
    const t = Date.now(), h = this.hits.get(k);
    if (!h || t - h[1] > sec * 1000) { this.hits.set(k, [1, t]); if (this.hits.size > 20000) this.hits.clear(); return true; }
    return ++h[0] <= n;
  }
  async who(b, ip, need = "online") {
    if (!b || typeof b.id !== "string" || !ACC_RE.test(b.id) || typeof b.secret !== "string" || !b.secret || b.secret.length > 64) return { err: "auth", status: 401 };
    const key = b.id + ":" + await sha(b.secret), c = this.authOk.get(key);
    const out = (g, nick) => (g ? { err: g.err, pun: g.pun || null, need: g.need, text: g.text, status: 403 } : { acc: b.id, nick });
    if (c && c.until > Date.now()) return out(gate(c.a, need, this.env), c.nick);
    if (!this.limit("auth:" + ip, AUTH_PER_MIN_IP, 60)) return { err: "rate", status: 429 };
    let r; try { r = await accCall(this.env, "auth", { id: b.id, secret: b.secret }); } catch (e) { r = null; }
    if (!r || !r.ok) return { err: "auth", status: 401 };
    const a = { pun: r.pun || null, consent_v: r.consent_v }, g = gate(a, need, this.env);   // the raw punishment is cached: each op asks its own scope
    this.authOk.set(key, { until: Date.now() + (a.pun || g ? 10 : 60) * 1000, nick: r.nick || null, a }); if (this.authOk.size > 20000) this.authOk.clear();
    return out(g, r.nick || null);
  }
  wallet(acc) {
    let w = this.one("SELECT * FROM wallet WHERE acc = ?", acc);
    if (!w) { this.sql.exec("INSERT INTO wallet (acc, day) VALUES (?, ?)", acc, dayKey(this.t())); w = this.one("SELECT * FROM wallet WHERE acc = ?", acc); }
    const d = dayKey(this.t());
    if (w.day !== d) { this.sql.exec("UPDATE wallet SET day = ?, p_day = 0, p_lv = 0, a_day = 0, pub_day = 0 WHERE acc = ?", d, acc); w.day = d; w.p_day = w.p_lv = w.a_day = w.pub_day = 0; }
    return w;
  }
  pay(acc, amount, kind, ref, field) {
    this.wallet(acc);
    this.sql.exec(`UPDATE wallet SET sparks = sparks + ?, total = total + ?${field ? `, ${field} = ${field} + ?` : ""} WHERE acc = ?`, ...(field ? [amount, amount, amount, acc] : [amount, amount, acc]));
    this.sql.exec("INSERT INTO log (acc, kind, amount, ref, at) VALUES (?, ?, ?, ?, ?)", acc, kind, amount, ref == null ? null : String(ref).slice(0, 40), now());
  }
  meta(r) {
    const w = this.one("SELECT badge FROM wallet WHERE acc = ?", r.author);
    return { id: r.id, title: r.title, author: r.author, nick: r.nick, badge: w ? w.badge : null, env: r.env, world: r.world, len: r.len, spd: r.spd, haz: r.haz,
      plays: r.plays, completes: r.completes, likes: r.likes, created: r.created, week: r.week, featured: r.featured, hidden: !!r.hidden };
  }
  // «Битвы авторов»: the week before the current one is settled once (top 3 by likes, ≥ 1 like): ✦ + badge + featured
  settle() {
    const w = this.week() - 1; if (w < 1) return;
    const b = this.one("SELECT * FROM battles WHERE week = ?", w);
    if (b && b.done) return;
    const top = this.rows("SELECT * FROM levels WHERE week = ? AND hidden = 0 AND likes > 0 ORDER BY likes DESC, completes DESC, created ASC LIMIT 3", w);
    const winners = [];
    this.ctx.storage.transactionSync(() => {
      top.forEach((r, i) => {
        const pz = C.BATTLE_PRIZE[i];
        this.pay(r.author, pz.sparks, "battle", w + ":" + (i + 1));
        this.sql.exec("INSERT INTO owned (acc, item, at, src) VALUES (?, ?, ?, 'battle') ON CONFLICT DO NOTHING", r.author, pz.badge, now());
        this.sql.exec("UPDATE levels SET featured = ? WHERE id = ?", w * 10 + i + 1, r.id);
        winners.push({ place: i + 1, lid: r.id, author: r.author, nick: r.nick, title: r.title, likes: r.likes, sparks: pz.sparks, badge: pz.badge });
      });
      this.sql.exec("INSERT INTO battles (week, theme, done, winners) VALUES (?, ?, 1, ?) ON CONFLICT (week) DO UPDATE SET done = 1, winners = excluded.winners",
        w, C.themeOf(w).id, JSON.stringify(winners));
    });
  }

  async fetch(request) {
    const url = new URL(request.url), op = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    const internal = request.headers.get("x-internal");
    try {
      if (op === "god") {
        if (internal !== "god") return json({ err: "forbidden" }, 403);
        return json(this.god(JSON.parse(await request.text() || "{}")));
      }
      if (internal !== "creator") return json({ err: "forbidden" }, 403);
      const ip = request.headers.get("x-ip") || "local";
      if (!this.limit("ip:" + ip, IP_PER_MIN, 60)) return json({ err: "rate" }, 429);
      this.settle();
      if (request.method === "GET") {
        const fn = { info: this.info, list: this.list, level: this.level, battle: this.battle }[op];
        if (!fn) return json({ err: "unknown" }, 404);
        const out = fn.call(this, url.searchParams);
        return json(out, out.err ? (out.status || 400) : 200);
      }
      const fn = { me: this.me, publish: this.publish, start: this.start, finish: this.finish, like: this.like, report: this.report, buy: this.buy, badge: this.badgeSet, test_shift: this.testShift }[op];
      if (!fn) return json({ err: "unknown" }, 404);
      if (!this.limit("w:" + ip, WRITE_PER_MIN_IP, 60)) return json({ err: "rate" }, 429);
      let b; try { b = JSON.parse(await request.text() || "{}"); } catch (e) { return json({ err: "bad_json" }, 400); }
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ err: "bad_json" }, 400);
      const u = await this.who(b, ip, op === "me" || op === "start" ? "online" : "creator");   // 07.11: «Создать» scope (publish / like / finish → sparks / shop)
      if (u.err) return json({ err: u.err, pun: u.pun || undefined, need: u.need, text: u.text }, u.status || 400);
      const out = await fn.call(this, b, u, ip);
      return json(out, out && out.err ? (out.status || 400) : 200);
    } catch (e) {
      console.log("creator " + op + " error: " + (e && e.stack ? e.stack : e));
      return json({ err: "server" }, 500);
    }
  }

  // ---------------------------------------------------------------- reads
  info() {
    const w = this.week();
    return { ok: true, shop: C.SHOP.map((x) => ({ id: x.id, type: x.type, price: x.price })), caps: C.CAPS, week: w, theme: C.themeOf(w).id,
      ends: C.BATTLE_EPOCH + w * 604800 - (this.t() - now()), prize: C.BATTLE_PRIZE };
  }
  list(q) {
    const sort = q.get("sort") || "new", page = Math.max(0, Math.min(50, parseInt(q.get("page") || "0", 10) || 0)), s = (q.get("q") || "").slice(0, 32).trim();
    const base = "SELECT l.* FROM levels l LEFT JOIN wallet w ON w.acc = l.author WHERE l.hidden = 0 AND COALESCE(w.banned, 0) = 0";
    let where = "", args = [];
    if (s) { if (LID_RE.test(s.toLowerCase())) { where += " AND (l.id = ? OR l.title LIKE ? OR l.nick LIKE ?)"; args.push(s.toLowerCase()); } else where += " AND (l.title LIKE ? OR l.nick LIKE ?)"; args.push("%" + s.replace(/[%_]/g, "") + "%", "%" + s.replace(/[%_]/g, "") + "%"); }
    let order = " ORDER BY l.created DESC";
    if (sort === "top") order = " ORDER BY l.likes DESC, l.completes DESC, l.created DESC";
    else if (sort === "plays") order = " ORDER BY l.plays DESC, l.created DESC";
    else if (sort === "featured") { where += " AND l.featured IS NOT NULL"; order = " ORDER BY l.featured DESC"; }
    else if (sort === "battle") { const wk = parseInt(q.get("week") || "", 10) || this.week(); where += " AND l.week = ?"; args.push(wk); order = " ORDER BY l.likes DESC, l.completes DESC, l.created ASC"; }
    else if (sort !== "new") return { err: "bad_sort" };
    const rows = this.rows(base + where + order + " LIMIT ? OFFSET ?", ...args, PAGE + 1, page * PAGE);
    return { ok: true, page, more: rows.length > PAGE, rows: rows.slice(0, PAGE).map((r) => this.meta(r)) };
  }
  level(q) {
    const id = (q.get("id") || "").toLowerCase();
    if (!LID_RE.test(id)) return { err: "bad_id" };
    const r = this.one("SELECT * FROM levels WHERE id = ?", id);
    if (!r) return { err: "not_found", status: 404 };
    const w = this.one("SELECT banned FROM wallet WHERE acc = ?", r.author);
    if (r.hidden || (w && w.banned)) return { err: "hidden", status: 410 };
    return { ok: true, level: { ...this.meta(r), data: JSON.parse(r.data) } };
  }
  battle(q) {
    const cw = this.week(), wk = Math.max(1, Math.min(cw, parseInt(q.get("week") || "", 10) || cw));
    const rows = this.rows("SELECT * FROM levels WHERE week = ? AND hidden = 0 ORDER BY likes DESC, completes DESC, created ASC LIMIT 50", wk).map((r, i) => ({ place: i + 1, ...this.meta(r) }));
    const prev = this.one("SELECT * FROM battles WHERE week = ?", cw - 1);
    const th = C.themeOf(wk);
    return { ok: true, week: wk, current: cw, theme: th.id, ends: C.BATTLE_EPOCH + wk * 604800 - (this.t() - now()), rows,
      winners: prev && prev.winners ? JSON.parse(prev.winners) : [], prize: C.BATTLE_PRIZE };
  }
  // ---------------------------------------------------------------- account calls
  me(b, u) {
    const w = this.wallet(u.acc);
    const owned = this.rows("SELECT item FROM owned WHERE acc = ?", u.acc).map((r) => r.item);
    // 2.3.14 author profile: ✦ each level earned its author = the author share of every first completion (completes.author_sparks)
    // + a battle prize (levels.featured = week * 10 + place). Read-only sums of what the server already paid.
    const earnedOf = new Map(this.rows("SELECT c.lid AS lid, SUM(c.author_sparks) AS s FROM completes c JOIN levels l ON l.id = c.lid WHERE l.author = ? GROUP BY c.lid", u.acc).map((r) => [r.lid, r.s || 0]));
    const prizeOf = (r) => { const pl = r.featured ? r.featured % 10 : 0; return pl >= 1 && pl <= C.BATTLE_PRIZE.length ? C.BATTLE_PRIZE[pl - 1].sparks : 0; };
    const mine = this.rows("SELECT * FROM levels WHERE author = ? ORDER BY created DESC LIMIT 30", u.acc).map((r) => ({ ...this.meta(r), hide_reason: r.hide_reason || undefined,
      earned: (earnedOf.get(r.id) || 0) + prizeOf(r), prize: prizeOf(r) || undefined }));
    const tot = this.one("SELECT COUNT(*) AS n, COALESCE(SUM(plays), 0) AS plays, COALESCE(SUM(completes), 0) AS completes, COALESCE(SUM(likes), 0) AS likes FROM levels WHERE author = ?", u.acc);
    const aEarn = this.one("SELECT COALESCE(SUM(amount), 0) AS s FROM log WHERE acc = ? AND kind IN ('author', 'battle')", u.acc);
    const author = { levels: tot.n, plays: tot.plays, completes: tot.completes, likes: tot.likes, earned: aEarn.s };
    const done = this.rows("SELECT lid FROM completes WHERE acc = ? ORDER BY at DESC LIMIT 300", u.acc).map((r) => r.lid);
    const liked = this.rows("SELECT lid FROM likes WHERE acc = ? ORDER BY at DESC LIMIT 300", u.acc).map((r) => r.lid);
    return { ok: true, sparks: w.sparks, total: w.total, owned, badge: w.badge, banned: !!w.banned, ban_reason: w.ban_reason || undefined,
      today: { sparks: w.p_day, levels: w.p_lv, author: w.a_day, published: w.pub_day }, caps: C.CAPS, mine, author, done, liked, week: this.week() };
  }
  async publish(b, u, ip) {
    const w = this.wallet(u.acc);
    if (w.banned) return { err: "creator_banned", reason: w.ban_reason || null, status: 403 };
    const gap = this.test() ? 1 : C.CAPS.publishGapS;
    if (w.pub_at && this.t() - w.pub_at < gap) return { err: "rate", retry: gap - (this.t() - w.pub_at), status: 429 };
    if (w.pub_day >= C.CAPS.publishDay) return { err: "cap_publish", status: 429 };
    const raw = b.level, size = JSON.stringify(raw === undefined ? null : raw).length;
    if (size > C.MAXJSON) return { err: "too_big", status: 413 };
    const v = C.validate(raw, { size });
    if (!v.ok) return { err: "invalid", errs: v.errs.slice(0, 20) };
    let week = null;
    if (b.battle === true) {
      week = this.week();
      const th = C.themeOf(week);
      if (!th.ok(v.lvl)) return { err: "theme", theme: th.id };
      if (this.one("SELECT id FROM levels WHERE author = ? AND week = ?", u.acc, week)) return { err: "battle_once" };
    }
    const data = JSON.stringify(v.lvl);
    let lid = rid(8, "0123456789abcdefghijklmnopqrstuvwxyz");
    while (this.one("SELECT id FROM levels WHERE id = ?", lid)) lid = rid(8, "0123456789abcdefghijklmnopqrstuvwxyz");
    const iph = (await sha("crip:" + ip)).slice(0, 16);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO levels (id, author, nick, title, data, env, world, len, spd, haz, created, week, ip_h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        lid, u.acc, u.nick ? String(u.nick).slice(0, 16) : null, v.lvl.title, data, v.lvl.env, v.lvl.world, v.lvl.len, v.lvl.spd, v.hazards, this.t(), week, iph);
      this.sql.exec("UPDATE wallet SET pub_day = pub_day + 1, pub_at = ? WHERE acc = ?", this.t(), u.acc);
    });
    return { ok: true, lid, week, hazards: v.hazards };
  }
  async start(b, u, ip) {
    const lid = typeof b.lid === "string" ? b.lid.toLowerCase() : "";
    if (!LID_RE.test(lid)) return { err: "bad_id" };
    const r = this.one("SELECT id, hidden, plays FROM levels WHERE id = ?", lid);
    if (!r) return { err: "not_found", status: 404 };
    if (r.hidden) return { err: "hidden", status: 410 };
    if (!this.limit("start:" + u.acc, 30, 60)) return { err: "rate", status: 429 };
    const tk = hex(crypto.getRandomValues(new Uint8Array(12))), t = this.t();
    this.sql.exec("DELETE FROM tickets WHERE at < ?", t - TICKET_TTL);
    const iph = (await sha("crip:" + ip)).slice(0, 16);
    this.sql.exec("INSERT INTO tickets (tk, acc, lid, at, ip_h) VALUES (?, ?, ?, ?, ?)", tk, u.acc, lid, t, iph);
    const cur = this.sql.exec("INSERT INTO plays (lid, acc, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", lid, u.acc, dayKey(t));
    if (cur.rowsWritten) this.sql.exec("UPDATE levels SET plays = plays + 1 WHERE id = ?", lid);
    return { ok: true, tk, plays: r.plays + (cur.rowsWritten ? 1 : 0) };
  }
  finish(b, u) {
    if (typeof b.tk !== "string" || !TK_RE.test(b.tk)) return { err: "bad_ticket" };
    const tk = this.one("SELECT * FROM tickets WHERE tk = ?", b.tk), t = this.t();
    if (!tk || tk.acc !== u.acc) return { err: "bad_ticket" };
    if (tk.used) return { err: "ticket_used" };
    if (t - tk.at > TICKET_TTL) return { err: "ticket_old" };
    const r = this.one("SELECT * FROM levels WHERE id = ?", tk.lid);
    if (!r || r.hidden) return { err: "hidden", status: 410 };
    const L = JSON.parse(r.data);
    this.sql.exec("UPDATE tickets SET used = 1 WHERE tk = ?", b.tk);
    const run = { t: b.t, rec: b.rec, cry: b.cry == null ? null : b.cry };
    // the claimed run time can't be longer than the wall clock since the ticket (+ slack for the network)
    if (typeof run.t === "number" && run.t > t - tk.at + 4) return this.cheat(u, tk.lid, "clock");
    const bad = C.passCheck(L, run);
    if (bad) return this.cheat(u, tk.lid, bad);
    const was = this.one("SELECT * FROM completes WHERE lid = ? AND acc = ?", tk.lid, u.acc);
    const w = this.wallet(u.acc);
    if (was) return { ok: true, first: false, sparks: 0, author: 0, balance: w.sparks, why: "again" };
    const own = r.author === u.acc, rw = C.reward(L, r.haz);
    let pay = 0, apay = 0, why = null;
    if (own) why = "own";
    else if (b.mod === true) why = "mods";
    else if (w.p_lv >= C.CAPS.levelsDay || w.p_day >= C.CAPS.playerDay) why = "cap";
    else pay = Math.min(rw.player, C.CAPS.playerDay - w.p_day);
    if (pay > 0) {
      const aw = this.wallet(r.author);
      if (!aw.banned && aw.a_day < C.CAPS.authorDay && tk.ip_h !== r.ip_h) apay = Math.min(rw.author, C.CAPS.authorDay - aw.a_day);
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO completes (lid, acc, at, t, sparks, author_sparks) VALUES (?, ?, ?, ?, ?, ?)", tk.lid, u.acc, t, run.t, pay, apay);
      if (!own) this.sql.exec("UPDATE levels SET completes = completes + 1 WHERE id = ?", tk.lid);
      if (pay > 0) { this.pay(u.acc, pay, "play", tk.lid, "p_day"); this.sql.exec("UPDATE wallet SET p_lv = p_lv + 1 WHERE acc = ?", u.acc); }
      if (apay > 0) this.pay(r.author, apay, "author", tk.lid, "a_day");
    });
    return { ok: true, first: true, sparks: pay, author: apay, balance: w.sparks + pay, why };
  }
  cheat(u, lid, why) {
    this.sql.exec("INSERT INTO log (acc, kind, amount, ref, at) VALUES (?, ?, 0, ?, ?)", u.acc, "cheat:" + String(why).slice(0, 16), lid, now());
    return { err: "check", why };
  }
  like(b, u) {
    const lid = typeof b.lid === "string" ? b.lid.toLowerCase() : "";
    const r = LID_RE.test(lid) ? this.one("SELECT * FROM levels WHERE id = ?", lid) : null;
    if (!r || r.hidden) return { err: "not_found", status: 404 };
    if (r.author === u.acc) return { err: "own" };
    if (!this.one("SELECT 1 AS x FROM completes WHERE lid = ? AND acc = ?", lid, u.acc)) return { err: "not_completed" };
    // a battle vote counts only while that battle week runs (later likes still count for «Лучшие»)
    const cur = this.sql.exec("INSERT INTO likes (lid, acc, at, week) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", lid, u.acc, this.t(), r.week && r.week === this.week() ? r.week : null);
    if (!cur.rowsWritten) return { err: "already", likes: r.likes };
    if (r.week && r.week !== this.week()) { this.sql.exec("UPDATE levels SET likes = likes + 1 WHERE id = ?", lid); return { ok: true, likes: r.likes + 1, vote: false }; }
    this.sql.exec("UPDATE levels SET likes = likes + 1 WHERE id = ?", lid);
    return { ok: true, likes: r.likes + 1, vote: !!r.week };
  }
  report(b, u) {
    const lid = typeof b.lid === "string" ? b.lid.toLowerCase() : "";
    const r = LID_RE.test(lid) ? this.one("SELECT * FROM levels WHERE id = ?", lid) : null;
    if (!r) return { err: "not_found", status: 404 };
    if (r.author === u.acc) return { err: "own" };
    const reason = typeof b.reason === "string" ? b.reason.replace(/[\u0000-\u001f<>]/g, "").slice(0, 120) : null;
    const cur = this.sql.exec("INSERT INTO reports (lid, acc, reason, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", lid, u.acc, reason, now());
    if (!cur.rowsWritten) return { err: "already" };
    this.sql.exec("UPDATE levels SET reports = reports + 1 WHERE id = ?", lid);
    if (r.reports + 1 >= C.CAPS.reportsHide && !r.hidden) this.sql.exec("UPDATE levels SET hidden = 2, hide_reason = 'reports' WHERE id = ?", lid);   // 2 = auto, until the god panel looks
    return { ok: true };
  }
  buy(b, u) {
    const it = typeof b.item === "string" ? C.shopItem(b.item) : null;
    if (!it || it.price < 0) return { err: "bad_item" };
    if (this.one("SELECT 1 AS x FROM owned WHERE acc = ? AND item = ?", u.acc, it.id)) return { err: "owned" };
    const w = this.wallet(u.acc);
    if (w.sparks < it.price) return { err: "poor", price: it.price, sparks: w.sparks };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE wallet SET sparks = sparks - ? WHERE acc = ?", it.price, u.acc);
      this.sql.exec("INSERT INTO owned (acc, item, at, src) VALUES (?, ?, ?, 'shop')", u.acc, it.id, now());
      this.sql.exec("INSERT INTO log (acc, kind, amount, ref, at) VALUES (?, 'buy', ?, ?, ?)", u.acc, -it.price, it.id, now());
    });
    return { ok: true, item: it.id, sparks: w.sparks - it.price, owned: this.rows("SELECT item FROM owned WHERE acc = ?", u.acc).map((r) => r.item) };
  }
  badgeSet(b, u) {
    if (b.badge === null) { this.wallet(u.acc); this.sql.exec("UPDATE wallet SET badge = NULL WHERE acc = ?", u.acc); return { ok: true, badge: null }; }
    const it = typeof b.badge === "string" ? C.shopItem(b.badge) : null;
    if (!it || it.type !== "badge") return { err: "bad_item" };
    if (!this.one("SELECT 1 AS x FROM owned WHERE acc = ? AND item = ?", u.acc, it.id)) return { err: "not_owned" };
    this.wallet(u.acc); this.sql.exec("UPDATE wallet SET badge = ? WHERE acc = ?", it.id, u.acc);
    return { ok: true, badge: it.id };
  }
  testShift(b) {   // CREATOR_TEST=1 only: move this DO's clock (battle week tests)
    if (!this.test()) return { err: "unknown", status: 404 };
    const s = Number.isInteger(b.shift) ? b.shift : 0;
    this.sql.exec("INSERT INTO kv (k, v) VALUES ('shift', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", String(s));
    return { ok: true, shift: s, week: this.week() };
  }
  // ---------------------------------------------------------------- moderation (god panel → Online DO → here)
  god(b) {
    const lid = typeof b.lid === "string" ? b.lid.toLowerCase() : "";
    switch (b.action) {
      case "cr_hide": case "cr_unhide": {
        const r = LID_RE.test(lid) ? this.one("SELECT id, title, author FROM levels WHERE id = ?", lid) : null;
        if (!r) return { err: "not_found" };
        if (b.action === "cr_hide") this.sql.exec("UPDATE levels SET hidden = 1, hide_reason = ? WHERE id = ?", typeof b.reason === "string" ? b.reason.slice(0, 120) : "god", lid);
        else { this.sql.exec("UPDATE levels SET hidden = 0, hide_reason = NULL, reports = 0 WHERE id = ?", lid); this.sql.exec("DELETE FROM reports WHERE lid = ?", lid); }
        return { ok: true, lid, title: r.title, author: r.author, hidden: b.action === "cr_hide" };
      }
      case "cr_ban": case "cr_unban": {
        if (typeof b.to !== "string" || !ACC_RE.test(b.to)) return { err: "bad_to" };
        this.wallet(b.to);
        this.sql.exec("UPDATE wallet SET banned = ?, ban_reason = ? WHERE acc = ?", b.action === "cr_ban" ? 1 : 0, b.action === "cr_ban" && typeof b.reason === "string" ? b.reason.slice(0, 120) : null, b.to);
        const n = this.one("SELECT COUNT(*) AS n FROM levels WHERE author = ?", b.to).n;
        return { ok: true, to: b.to, banned: b.action === "cr_ban", levels: n };
      }
      case "cr_reports": {
        const lim = Number.isInteger(b.limit) ? Math.min(Math.max(b.limit, 1), 100) : 30;
        const rows = this.rows("SELECT * FROM levels WHERE reports > 0 ORDER BY hidden = 2 DESC, reports DESC, created DESC LIMIT ?", lim).map((r) => ({
          ...this.meta(r), reports: r.reports, hide_reason: r.hide_reason, reasons: this.rows("SELECT reason FROM reports WHERE lid = ? AND reason IS NOT NULL LIMIT 5", r.id).map((x) => x.reason) }));
        return { ok: true, rows };
      }
      case "cr_levels": {
        if (typeof b.to !== "string" || !ACC_RE.test(b.to)) return { err: "bad_to" };
        const w = this.one("SELECT * FROM wallet WHERE acc = ?", b.to);
        return { ok: true, to: b.to, banned: !!(w && w.banned), sparks: w ? w.sparks : 0, total: w ? w.total : 0,
          rows: this.rows("SELECT * FROM levels WHERE author = ? ORDER BY created DESC LIMIT 50", b.to).map((r) => ({ ...this.meta(r), reports: r.reports, hide_reason: r.hide_reason })) };
      }
    }
    return { err: "unknown_action" };
  }
}
