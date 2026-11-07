// online.js — 2.2 «Онлайн и сезоны»: HTTP JSON API under /api/v2/* backed by one SQLite Durable Object "Online".
//
//   GET  /api/v2/daily                 today's seed + rules (deterministic from the UTC date)
//   POST /api/v2/daily/submit          {id,secret,day,seed,m,t,cry,g?}  score (+ optional compact ghost)
//   GET  /api/v2/daily/top?day=&me=    daily leaderboard (top 50 + my place)
//   GET  /api/v2/ghost?day=&acc=       best ghost of the day, or of one account
//   GET  /api/v2/profile?acc=          public profile;  POST /api/v2/profile/me {id,secret} -> own profile
//   POST /api/v2/profile/set           {id,secret,avatar?,skin?,stats?}
//   POST /api/v2/run                   {id,secret,m,t,diff,cry}  any normal run -> xp + season progress
//   GET  /api/v2/raid                  weekly boss state;  POST /api/v2/raid/hit → {ok:false, err:'moved'} (2.4: runs no longer hit the raid)
//   POST /api/v2/raid/claim            {id,secret,week}  reward after the boss of that week fell
//   GET  /api/v2/season                season id, ends, tiers;  POST /api/v2/season/claim {id,secret,tier}
//   POST /api/v2/season/claim          {id,secret,tier,track:"prem"} premium track (pass on the account, checked in Accounts)
//   POST /api/v2/pass/legacy           {id,secret} old local SAVE.pass -> account pass (see accounts.js pass_legacy)
//   GET  /api/v2/promo                 the current discount (promo.js) for the game's popup
//   POST /api/v2/inbox                 {id,secret} -> pending grants;  POST /api/v2/inbox/ack {id,secret,upto}
//   POST /api/v2/ping                  {id,secret} presence;  GET /api/v2/online -> {count}
//   POST /api/v2/god                   {id,secret,key,action,...} owner only (env.OWNER_ID + env.GOD_KEY)
//
// Rewards are never applied by the server to the local save: they go to an inbox the client pulls and acks.
// Identity = the existing account (accounts.js, id + secret), checked through the Accounts DO.

import { accCall, seasonInfo, SCORE_MAX } from "./accounts.js";
import { currentPromo } from "./promo.js";
import { PRODUCTS } from "./donate.js";
import { POOL, POOL_SCHEMA, poolResult, poolHit, poolView, ensurePool, validPeriod, weekStatus, fundView, fundPending, fundPlan, fundPay } from "./raid3_pool.js";
// 2.3.6 account protection: /acc/* routes, rewards journal + god «наказания / откат» (online_guard.js)
import { ACC_ROUTES, GUARD_GOD, REWARDS_SCHEMA, journal, guardInternal, GODTOK_SCHEMA, GOD_TOKEN_TTL, GOD_TOKENS_MAX, godRevokeAll } from "./online_guard.js";
import { gate, devHash, cleanLabel, isOwnerId, ownerConfigured } from "./accounts_guard.js";
import { calendar as raid3Calendar, ENEMIES as RAID3_ENEMIES } from "./raid3_rules.js";
import { CREATOR_GOD } from "./creator.js";   // «Создать»: hide a level / ban an author from publishing (god panel)
import { modesInternal } from "./modes_online.js";   // 2.3.12 «Режимы»: ban check / flags / rewards for modes.js

const DAY = 86400;
const WEEK = 7 * DAY;
export const RAID_EPOCH = Date.UTC(2026, 9, 19) / 1000; // Monday 2026-10-19 00:00 UTC
const now = () => Math.floor(Date.now() / 1000);

// ------------------------------------------------------------------ game constants (from src/diff.js, read-only)
export const DIFF_MAX = { easy: 27, normal: 35, hard: 45 };   // max forward speed, m/s
const SPEED_SLACK = 1.25;        // boosts / jetpack / rounding
const T_MAX = 5400;              // s, one run
const BODY_MAX = 24 * 1024;
const GHOST_MAX_B64 = 16 * 1024;
const TOP_N = 50;
const ONLINE_WINDOW = 90;        // s since last ping = "online"

// cooldowns per account (s) and per-IP request budget
const CD = { daily: 20, run: 20, raid: 15, ping: 20, profile: 5, claim: 2, rclaim: 2, legacy: 30 };
const IP_PER_MIN = 120;
const GOD_FAILS_PER_10MIN = 5;

// ------------------------------------------------------------------ deterministic daily
export function mulberry(seed) {          // identical to src/core.js
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function dayKey(t = now()) { return new Date(t * 1000).toISOString().slice(0, 10); }

const DAILY_MODS = ["no_shield", "double_crystals", "fast_start", "saws_plus", "low_gravity", "fog", "one_life", "magnet_off"];
export function dailyInfo(day = dayKey()) {
  const seed = fnv1a("cr-daily:" + day) || 1;
  const r = mulberry(seed);
  const diff = ["easy", "normal", "normal", "hard"][Math.floor(r() * 4)];
  const mods = [];
  const nMods = 1 + Math.floor(r() * 2);
  while (mods.length < nMods) { const m = DAILY_MODS[Math.floor(r() * DAILY_MODS.length)]; if (!mods.includes(m)) mods.push(m); }
  const goal = { easy: 1500, normal: 2500, hard: 3500 }[diff] + Math.floor(r() * 10) * 100;
  const start = Date.parse(day + "T00:00:00Z") / 1000;
  return { day, seed, diff, mods, goal, ends: start + DAY };
}

// ------------------------------------------------------------------ season (bigger + harder, owner's request)
// 30 tiers (was 12). Step grows: tier i costs 2500 + 150*i metres -> ~140 km for the whole 14-day season.
export const SEASON_TIERS = (() => {
  const skins = { 5: "lava", 10: "season_frost", 15: "season_neon", 20: "season_aurora", 25: "season_void", 30: "season_crown" };
  const out = []; let need = 0;
  for (let i = 1; i <= 30; i++) {
    need += 2500 + 150 * i;
    const r = skins[i] ? { skin: skins[i], gems: 500 * Math.ceil(i / 5) } : { gems: 150 + 60 * i };
    if (i % 10 === 0) r.title = "season_t" + i;
    out.push({ tier: i, xp: need, reward: r });
  }
  return out;
})();
// premium track (Премиум-пропуск, 75⭐): a reward on EVERY tier, only crystals / dark crystals / a title — nothing that
// counts in the rankings or the raid. The pass itself (skin, frame, trail, +15 % crystals per run) is applied by the game.
export const PREMIUM_TIERS = SEASON_TIERS.map(({ tier, xp }) => {
  const r = { gems: 100 + 50 * tier };
  if (tier % 3 === 0) r.dark = 30 + 5 * tier;
  if (tier % 5 === 0) r.gems += 400 * (tier / 5);
  if (tier === 30) r.title = "season_p30";
  return { tier, xp, reward: r };
});
export function seasonTierOf(xp) { let t = 0; for (const s of SEASON_TIERS) if (xp >= s.xp) t = s.tier; return t; }
export function levelOf(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1; }

// ------------------------------------------------------------------ weekly raid
const BOSSES = [
  { id: "warden", hp: 300_000 },
  { id: "frost_titan", hp: 350_000 },
  { id: "neon_hydra", hp: 400_000 },
  { id: "void_knight", hp: 450_000 },
];
const DPS_MAX = 160;             // damage per second of fight the client may claim
const HIT_MAX = 30000;           // one report
const RAID_ACC_WEEK_MAX = 400000;
const RAID_REWARDS = [            // by own damage, only if the boss fell that week
  { dmg: 1000, gems: 600 },
  { dmg: 20000, gems: 2000 },
  { dmg: 100000, gems: 5000, skin: "raid_slayer" },
];
export function weekOf(t = now()) { return Math.floor((t - RAID_EPOCH) / WEEK) + 1; }
export function bossOf(week) { const b = BOSSES[((week - 1) % BOSSES.length + BOSSES.length) % BOSSES.length]; return { ...b, hp: b.hp + 25000 * Math.floor((week - 1) / BOSSES.length) }; }

// ------------------------------------------------------------------ anti-cheat
export function runProblem({ m, t, diff, cry }) {
  if (!Number.isFinite(m) || !Number.isFinite(t)) return "bad_number";
  if (!DIFF_MAX[diff]) return "bad_diff";
  if (m < 0 || m > SCORE_MAX || !Number.isInteger(m)) return "bad_distance";
  if (t < 1 || t > T_MAX) return "bad_time";
  if (m / t > DIFF_MAX[diff] * SPEED_SLACK) return "too_fast";
  if (cry != null && (!Number.isInteger(cry) || cry < 0 || cry > m / 2 + 50)) return "bad_crystals";
  return null;
}

// ghost v1: base64url bytes [1, interval*10, (dd, x, y) * n]; dd = metres*4 (uint8), x = lateral*40 (int8), y = height*20 (uint8)
export function ghostProblem(g, { m, t, diff }) {
  if (typeof g !== "string" || g.length > GHOST_MAX_B64 || !/^[A-Za-z0-9_-]+$/.test(g)) return "ghost_format";
  let b;
  try { b = Uint8Array.from(atob(g.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); } catch { return "ghost_format"; }
  if (b.length < 5 || b[0] !== 1 || (b.length - 2) % 3) return "ghost_format";
  const dt = b[1] / 10;
  if (dt < 0.2 || dt > 1.0) return "ghost_interval";
  const n = (b.length - 2) / 3;
  if (Math.abs(n * dt - t) > t * 0.1 + 1) return "ghost_time";
  const stepMax = Math.ceil(DIFF_MAX[diff] * SPEED_SLACK * 1.1 * dt * 4);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dd = b[2 + i * 3];
    if (dd > stepMax) return "ghost_step";
    sum += dd;
  }
  const dist = sum / 4;
  if (Math.abs(dist - m) > m * 0.03 + 5) return "ghost_distance";
  return null;
}

// ------------------------------------------------------------------ helpers
function hex(bytes) { return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function sha(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }
async function safeEq(a, b) {           // constant-time over the hashes
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [x, y] = [await sha("god:" + a), await sha("god:" + b)];
  let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
const ACC_RE = /^[0-9a-f]{12}$/;
const SKIN_RE = /^[a-z0-9_]{1,24}$/;
const STAT_KEYS = ["runs", "best", "km", "crystals", "deaths", "bosses", "jumps", "playtime"];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
}

// ------------------------------------------------------------------ worker-side entry
export async function handleOnline(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!env.ONLINE) return json({ err: "not_configured" }, 503);
  if (request.method !== "GET" && request.method !== "POST") return json({ err: "method" }, 405);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > BODY_MAX) return json({ err: "too_big" }, 413);
  const url = new URL(request.url);
  const headers = { "x-ip": request.headers.get("cf-connecting-ip") || "local", "content-type": "application/json" };
  const body = request.method === "POST" ? await request.text() : null;
  if (body && body.length > BODY_MAX) return json({ err: "too_big" }, 413);
  const stub = env.ONLINE.get(env.ONLINE.idFromName("online"));
  const res = await stub.fetch("https://online" + url.pathname + url.search, { method: request.method, headers, body });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
}

// ------------------------------------------------------------------ Durable Object
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, nick TEXT, avatar INTEGER NOT NULL DEFAULT 0, skin TEXT,
    xp INTEGER NOT NULL DEFAULT 0, stats TEXT NOT NULL DEFAULT '{}', season INTEGER NOT NULL DEFAULT 0,
    season_xp INTEGER NOT NULL DEFAULT 0, claimed TEXT NOT NULL DEFAULT '[]', banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT, flags INTEGER NOT NULL DEFAULT 0, last_seen INTEGER, created INTEGER NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS profiles_seen ON profiles (last_seen)",
  `CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, acc TEXT NOT NULL, m INTEGER NOT NULL, t REAL NOT NULL,
    cry INTEGER, at INTEGER NOT NULL, ghost TEXT, PRIMARY KEY (day, acc))`,
  "CREATE INDEX IF NOT EXISTS daily_rank ON daily (day, m DESC, at)",
  `CREATE TABLE IF NOT EXISTS raid (week INTEGER PRIMARY KEY, boss TEXT NOT NULL, hp_max INTEGER NOT NULL, hp INTEGER NOT NULL, killed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS raid_dmg (week INTEGER NOT NULL, acc TEXT NOT NULL, dmg INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (week, acc))`,
  `CREATE TABLE IF NOT EXISTS inbox (n INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    at INTEGER NOT NULL, taken INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS inbox_acc ON inbox (acc, taken)",
  `CREATE TABLE IF NOT EXISTS god_log (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, ip TEXT,
    action TEXT NOT NULL, args TEXT, ok INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)",
  // raid3.js (weekly online raid): one row per rewarded (match, account) — a second grant for the same pair is impossible
  `CREATE TABLE IF NOT EXISTS raid3_win (match TEXT NOT NULL, acc TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, enemy TEXT,
    gems INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (match, acc))`,
  "CREATE INDEX IF NOT EXISTS raid3_win_day ON raid3_win (acc, day, kind)",
  ...POOL_SCHEMA,   // raid3_pool.js: the shared hp of the day's enemy
  ...REWARDS_SCHEMA,
  ...GODTOK_SCHEMA,   // 2.3.9 god-panel device tokens (online_guard.js)
];

export class Online {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
    try { this.sql.exec("ALTER TABLE profiles ADD COLUMN pclaimed TEXT"); } catch (e) { /* already there */ }   // premium track tiers taken
    this.authCache = new Map();   // id:sha(secret) -> {until, nick}
    this.hits = new Map();        // rate-limit buckets: key -> [times]
    this.cd = new Map();          // cooldowns: "op:acc" -> last time
  }
  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.rows(q, ...b)[0] || null; }

  limit(key, max, winSec) {
    const t = Date.now(), arr = (this.hits.get(key) || []).filter((x) => t - x < winSec * 1000);
    if (arr.length >= max) { this.hits.set(key, arr); return false; }
    arr.push(t); this.hits.set(key, arr);
    if (this.hits.size > 20000) this.hits.clear();
    return true;
  }
  cooldown(op, acc) {
    const k = op + ":" + acc, t = now(), last = this.cd.get(k) || 0;
    if (t - last < CD[op]) return false;
    this.cd.set(k, t); if (this.cd.size > 50000) this.cd.clear();
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    // raid3.js internal calls (rewards / ban check); public requests never carry this header (handleOnline sets its own)
    if (url.pathname === "/raid3/internal") {
      if (request.headers.get("x-internal") !== "raid3") return json({ err: "forbidden" }, 403);
      try { return json(await raid3Internal.call(this, JSON.parse(await request.text() || "{}"))); }
      catch (e) { console.log(`online raid3 error: ${e && e.stack ? e.stack : e}`); return json({ err: "server" }, 500); }
    }
    if (url.pathname === "/modes/internal") {             // modes.js (ghost race / push duel): rewards, flags, ban check
      if (request.headers.get("x-internal") !== "modes") return json({ err: "forbidden" }, 403);
      try { return json(modesInternal.call(this, JSON.parse(await request.text() || "{}"))); }
      catch (e) { console.log(`online modes error: ${e && e.stack ? e.stack : e}`); return json({ err: "server" }, 500); }
    }
    if (url.pathname === "/guard/internal") {             // Lobby: redeemed codes -> rewards journal
      if (request.headers.get("x-internal") !== "guard") return json({ err: "forbidden" }, 403);
      try { return json(guardInternal.call(this, JSON.parse(await request.text() || "{}"))); }
      catch (e) { console.log(`online guard error: ${e && e.stack ? e.stack : e}`); return json({ err: "server" }, 500); }
    }
    const ip = request.headers.get("x-ip") || "?";
    if (!this.limit("ip:" + ip, IP_PER_MIN, 60)) return json({ err: "rate" }, 429);
    const route = request.method + " " + url.pathname.replace(/^\/api\/v2/, "").replace(/\/+$/, "");
    const fn = Object.prototype.hasOwnProperty.call(ROUTES, route) ? ROUTES[route] : null;
    if (!fn) return json({ err: "unknown" }, 404);
    let body = {};
    if (request.method === "POST") {
      try { body = JSON.parse(await request.text() || "{}"); } catch { return json({ err: "bad_json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ err: "bad_json" }, 400);
    }
    try {
      const out = await fn.call(this, { body, q: url.searchParams, ip });
      return json(out, out && out.err ? (out.status || 400) : 200);
    } catch (e) {
      console.log(`online ${route} error: ${e && e.stack ? e.stack : e}`);
      return json({ err: "server" }, 500);
    }
  }

  // ---- identity
  async who(body, ip) {
    const { id, secret } = body;
    this.whoRate = false;
    if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || secret.length > 64) return null;
    const key = id + ":" + await sha(secret);
    const c = this.authCache.get(key);
    let nick, g;
    if (c && c.until > Date.now()) { nick = c.nick; g = c.g; }
    else {
      // 2.3.9: only real checks in the Accounts DO count (60 / min per IP); a cached sign-in (this id + this secret already
      // verified) is not limited — before, a busy minute (or many players behind one mobile IP) turned into «not signed in»
      if (!this.limit("auth:" + ip, 60, 60)) { this.whoRate = true; return null; }
      const r = await accCall(this.env, "auth", { id, secret });
      if (!r || !r.ok) return null;
      nick = r.nick || null;
      g = gate(r, "online", this.env);   // 2.3.6: punishment / consent (cached 1 min: a ban or «выйти везде» acts fast)
      this.authCache.set(key, { until: Date.now() + (g ? 10 : 60) * 1000, nick, g });
      if (this.authCache.size > 20000) this.authCache.clear();
    }
    const p = this.profile(id, nick);
    p._g = g || null;
    return p;
  }
  profile(id, nick) {
    let p = this.one("SELECT * FROM profiles WHERE id = ?", id);
    if (!p) {
      this.sql.exec("INSERT INTO profiles (id, nick, created) VALUES (?, ?, ?)", id, nick, now());
      p = this.one("SELECT * FROM profiles WHERE id = ?", id);
    } else if (nick !== undefined && nick !== p.nick) {
      this.sql.exec("UPDATE profiles SET nick = ? WHERE id = ?", nick, id); p.nick = nick;
    }
    const s = this.season();
    if (p.season !== s.season) {   // new season: progress resets, claimed list resets
      this.sql.exec("UPDATE profiles SET season = ?, season_xp = 0, claimed = '[]', pclaimed = '[]' WHERE id = ?", s.season, id);
      p.season = s.season; p.season_xp = 0; p.claimed = "[]"; p.pclaimed = "[]";
    }
    return p;
  }
  async me(body, ip) {
    const p = await this.who(body, ip);
    if (!p) return [null, { err: "auth", status: 401 }];
    if (p._g) return [null, { err: p._g.err, pun: p._g.pun || null, terms_v: p._g.terms_v, status: 403 }];
    if (p.banned) return [null, { err: "banned", reason: p.ban_reason || null, status: 403 }];
    return [p, null];
  }
  pubProfile(p) {
    const stats = JSON.parse(p.stats || "{}");
    return { id: p.id, nick: p.nick, avatar: p.avatar, skin: p.skin, xp: p.xp, level: levelOf(p.xp), stats,
      season: p.season, season_xp: p.season_xp, season_tier: seasonTierOf(p.season_xp), banned: !!p.banned };
  }
  season() {
    const s = seasonInfo();
    const o = this.one("SELECT v FROM kv WHERE k = 'season_override'");
    if (o && o.v) { const ov = JSON.parse(o.v); if (ov && Number.isInteger(ov.season)) return { season: ov.season, ends: ov.ends || s.ends, override: true }; }
    return s;
  }
  flag(p, why, ip) {
    this.sql.exec("UPDATE profiles SET flags = flags + 1 WHERE id = ?", p.id);
    this.log(p.id, ip, "cheat:" + why, null, 0);
  }
  log(actor, ip, action, args, ok) {
    this.sql.exec("INSERT INTO god_log (at, actor, ip, action, args, ok) VALUES (?, ?, ?, ?, ?, ?)", now(), actor, ip, action,
      args == null ? null : JSON.stringify(args).slice(0, 2000), ok ? 1 : 0);
  }
  grant(acc, kind, payload) {
    this.sql.exec("INSERT INTO inbox (acc, kind, payload, at) VALUES (?, ?, ?, ?)", acc, kind, JSON.stringify(payload), now());
    const n = this.one("SELECT last_insert_rowid() AS n").n;
    journal(this, acc, kind, payload && (payload.match || (payload.season != null ? payload.season + ":" + payload.tier : payload.week)), payload, false, n);
  }
  addXp(p, m) {
    const xp = Math.floor(m / 10), sxp = Math.floor(m);
    this.sql.exec("UPDATE profiles SET xp = xp + ?, season_xp = season_xp + ? WHERE id = ?", xp, sxp, p.id);
    return { xp: p.xp + xp, season_xp: p.season_xp + sxp };
  }
  // the pass lives on the account (Accounts DO) -> true / false / null (Accounts unreachable)
  async hasPass(id) {
    try {
      const r = await accCall(this.env, "pass_get", { acc: id });
      return r && r.ok ? !!r.pass : null;
    } catch (e) { return null; }
  }
  raidRow(week) {
    let r = this.one("SELECT * FROM raid WHERE week = ?", week);
    if (!r) {
      const b = bossOf(week);
      this.sql.exec("INSERT INTO raid (week, boss, hp_max, hp) VALUES (?, ?, ?, ?)", week, b.id, b.hp, b.hp);
      r = this.one("SELECT * FROM raid WHERE week = ?", week);
    }
    return r;
  }
}

// ------------------------------------------------------------------ routes
const ROUTES = {
  "GET /daily"() { return { ok: true, ...dailyInfo(), now: now() }; },

  async "POST /daily/submit"({ body, ip }) {
    if (body.ch) return { err: "cheat_session" };   // 2.3.12: cheats were used on the phone this session — no rewards, no leaderboard
    const [p, e] = await this.me(body, ip); if (e) return e;
    const today = dayKey(), grace = dayKey(now() - 600);   // runs that started just before midnight
    const day = body.day;
    if (day !== today && day !== grace) return { err: "wrong_day" };
    const d = dailyInfo(day);
    if (body.seed !== d.seed) return { err: "wrong_seed" };
    if (!this.cooldown("daily", p.id)) return { err: "rate", status: 429 };
    const run = { m: body.m, t: body.t, diff: d.diff, cry: body.cry ?? null };
    const bad = runProblem(run);
    if (bad) { this.flag(p, bad, ip); return { err: bad }; }
    let ghost = null;
    if (body.g != null) {
      const gb = ghostProblem(body.g, run);
      if (gb) { this.flag(p, gb, ip); return { err: gb }; }
      ghost = body.g;
    }
    const prev = this.one("SELECT m FROM daily WHERE day = ? AND acc = ?", day, p.id);
    const isNew = !prev || run.m > prev.m;
    if (isNew) {
      this.sql.exec("INSERT INTO daily (day, acc, m, t, cry, at, ghost) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, acc) DO UPDATE " +
        "SET m = excluded.m, t = excluded.t, cry = excluded.cry, at = excluded.at, ghost = COALESCE(excluded.ghost, daily.ghost)",
        day, p.id, run.m, run.t, run.cry, now(), ghost);
    }
    const prog = this.addXp(p, run.m);
    const rank = this.one("SELECT COUNT(*) AS n FROM daily d JOIN profiles p ON p.id = d.acc WHERE d.day = ? AND p.banned = 0 AND d.m > ?",
      day, isNew ? run.m : prev.m).n + 1;
    return { ok: true, day, best: isNew ? run.m : prev.m, new: isNew, rank, goal_done: run.m >= d.goal, ...prog };
  },

  "GET /daily/top"({ q }) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") || "") ? q.get("day") : dayKey();
    const rows = this.rows("SELECT d.acc, p.nick, p.avatar, p.skin, d.m, d.t, d.ghost IS NOT NULL AS has_ghost FROM daily d " +
      "JOIN profiles p ON p.id = d.acc WHERE d.day = ? AND p.banned = 0 ORDER BY d.m DESC, d.at LIMIT ?", day, TOP_N)
      .map((r, i) => ({ place: i + 1, ...r, has_ghost: !!r.has_ghost }));
    const meId = q.get("me");
    let me = null;
    if (meId && ACC_RE.test(meId)) {
      const r = this.one("SELECT m FROM daily WHERE day = ? AND acc = ?", day, meId);
      if (r) me = { m: r.m, place: this.one("SELECT COUNT(*) AS n FROM daily d JOIN profiles p ON p.id = d.acc WHERE d.day = ? AND p.banned = 0 AND d.m > ?", day, r.m).n + 1 };
    }
    return { ok: true, day, rows, me };
  },

  "GET /ghost"({ q }) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") || "") ? q.get("day") : dayKey();
    const acc = q.get("acc");
    const r = acc && ACC_RE.test(acc)
      ? this.one("SELECT d.acc, p.nick, d.m, d.t, d.ghost FROM daily d JOIN profiles p ON p.id = d.acc WHERE d.day = ? AND d.acc = ? AND d.ghost IS NOT NULL AND p.banned = 0", day, acc)
      : this.one("SELECT d.acc, p.nick, d.m, d.t, d.ghost FROM daily d JOIN profiles p ON p.id = d.acc WHERE d.day = ? AND d.ghost IS NOT NULL AND p.banned = 0 ORDER BY d.m DESC, d.at LIMIT 1", day);
    if (!r) return { err: "no_ghost", status: 404 };
    return { ok: true, day, seed: dailyInfo(day).seed, acc: r.acc, nick: r.nick, m: r.m, t: r.t, g: r.ghost };
  },

  "GET /profile"({ q }) {
    const acc = q.get("acc");
    if (!acc || !ACC_RE.test(acc)) return { err: "bad_acc" };
    const p = this.one("SELECT * FROM profiles WHERE id = ?", acc);
    if (!p) return { err: "not_found", status: 404 };
    return { ok: true, profile: this.pubProfile(p) };
  },

  async "POST /profile/me"({ body, ip }) {
    const p = await this.who(body, ip);
    if (!p) return { err: "auth", status: 401 };
    let claimed = []; try { claimed = JSON.parse(p.claimed || "[]"); } catch { claimed = []; }   // 2.2 client: which season tiers are taken
    let pclaimed = []; try { pclaimed = JSON.parse(p.pclaimed || "[]"); } catch { pclaimed = []; }
    const pass = await this.hasPass(p.id);
    // 2.3.9: owner: true only for the owner's own signed-in account (the «God-панель» row in «Ещё»; rights are still checked per call)
    return { ok: true, profile: this.pubProfile(p), claimed, pclaimed, pass: pass === true, pass_known: pass !== null,
      ban_reason: p.banned ? p.ban_reason : undefined, owner: isOwnerId(this.env, p.id) ? true : undefined };
  },

  async "POST /profile/set"({ body, ip }) {
    const [p, e] = await this.me(body, ip); if (e) return e;
    if (!this.cooldown("profile", p.id)) return { err: "rate", status: 429 };
    if (body.avatar != null) {
      if (!Number.isInteger(body.avatar) || body.avatar < 0 || body.avatar > 63) return { err: "bad_avatar" };
      this.sql.exec("UPDATE profiles SET avatar = ? WHERE id = ?", body.avatar, p.id);
    }
    if (body.skin != null) {
      if (typeof body.skin !== "string" || !SKIN_RE.test(body.skin)) return { err: "bad_skin" };
      this.sql.exec("UPDATE profiles SET skin = ? WHERE id = ?", body.skin, p.id);
    }
    if (body.stats != null) {
      if (typeof body.stats !== "object" || Array.isArray(body.stats)) return { err: "bad_stats" };
      const clean = {};
      for (const k of STAT_KEYS) {
        const v = body.stats[k];
        if (v == null) continue;
        if (!Number.isFinite(v) || v < 0 || v > 1e9) return { err: "bad_stats" };
        clean[k] = Math.floor(v);
      }
      if (clean.best != null && clean.best > SCORE_MAX) return { err: "bad_stats" };
      this.sql.exec("UPDATE profiles SET stats = ? WHERE id = ?", JSON.stringify(clean), p.id);
    }
    return { ok: true, profile: this.pubProfile(this.one("SELECT * FROM profiles WHERE id = ?", p.id)) };
  },

  async "POST /run"({ body, ip }) {
    if (body.ch) return { err: "cheat_session" };   // 2.3.12: cheats were used on the phone this session — no rewards, no leaderboard
    const [p, e] = await this.me(body, ip); if (e) return e;
    if (!this.cooldown("run", p.id)) return { err: "rate", status: 429 };
    const run = { m: body.m, t: body.t, diff: body.diff, cry: body.cry ?? null };
    const bad = runProblem(run);
    if (bad) { this.flag(p, bad, ip); return { err: bad }; }
    const prog = this.addXp(p, run.m);
    return { ok: true, ...prog, level: levelOf(prog.xp), season_tier: seasonTierOf(prog.season_xp) };
  },

  "GET /raid"() {
    const week = weekOf(), r = this.raidRow(week);
    const top = this.rows("SELECT d.acc, p.nick, d.dmg FROM raid_dmg d JOIN profiles p ON p.id = d.acc WHERE d.week = ? AND p.banned = 0 " +
      "ORDER BY d.dmg DESC LIMIT 10", week);
    const players = this.one("SELECT COUNT(*) AS n FROM raid_dmg WHERE week = ?", week).n;
    return { ok: true, week, boss: r.boss, hp: r.hp, hp_max: r.hp_max, killed: r.killed_at != null,
      ends: RAID_EPOCH + week * WEEK, players, top, rewards: RAID_REWARDS };
  },

  // 2.4 (owner): runs no longer hit the raid — the raid is fights only (raid3.js). Old clients get a clean "moved" and keep working.
  async "POST /raid/hit"() { return { ok: false, err: "moved" }; },

  async "POST /raid/claim"({ body, ip }) {
    if (body.ch) return { err: "cheat_session" };   // 2.3.12: cheats were used on the phone this session — no rewards, no leaderboard
    const [p, e] = await this.me(body, ip); if (e) return e;
    if (!this.cooldown("rclaim", p.id)) return { err: "rate", status: 429 };
    const week = Number.isInteger(body.week) ? body.week : weekOf();
    if (week > weekOf() || week < weekOf() - 4) return { err: "bad_week" };
    const r = this.one("SELECT * FROM raid WHERE week = ?", week);
    if (!r || r.killed_at == null) return { err: "boss_alive" };
    const d = this.one("SELECT * FROM raid_dmg WHERE week = ? AND acc = ?", week, p.id);
    if (!d) return { err: "not_in_raid" };
    if (d.claimed) return { err: "claimed" };
    const reward = { gems: 0 };
    for (const t of RAID_REWARDS) if (d.dmg >= t.dmg) { reward.gems = t.gems; if (t.skin) reward.skin = t.skin; }
    if (!reward.gems) return { err: "too_little" };
    this.sql.exec("UPDATE raid_dmg SET claimed = 1 WHERE week = ? AND acc = ?", week, p.id);
    this.grant(p.id, "raid", { week, ...reward });
    return { ok: true, week, reward };
  },

  "GET /season"() {
    const s = this.season();
    return { ok: true, season: s.season, ends: s.ends, tiers: SEASON_TIERS, ptiers: PREMIUM_TIERS };
  },

  async "POST /season/claim"({ body, ip }) {
    if (body.ch) return { err: "cheat_session" };   // 2.3.12: cheats were used on the phone this session — no rewards, no leaderboard
    const [p, e] = await this.me(body, ip); if (e) return e;
    if (!this.cooldown("claim", p.id)) return { err: "rate", status: 429 };
    if (body.track === "prem") {
      const pt = PREMIUM_TIERS.find((s) => s.tier === body.tier);
      if (!pt) return { err: "bad_tier" };
      if (p.season_xp < pt.xp) return { err: "locked" };
      const pass = await this.hasPass(p.id);
      if (pass === null) return { err: "server", status: 503 };
      if (!pass) return { err: "no_pass", status: 403 };
      const fresh = this.one("SELECT pclaimed FROM profiles WHERE id = ?", p.id);   // re-read after the await
      let pc = []; try { pc = JSON.parse((fresh && fresh.pclaimed) || "[]"); } catch { pc = []; }
      if (pc.includes(pt.tier)) return { err: "claimed" };
      pc.push(pt.tier);
      this.sql.exec("UPDATE profiles SET pclaimed = ? WHERE id = ?", JSON.stringify(pc), p.id);
      this.grant(p.id, "season", { season: p.season, tier: pt.tier, prem: true, ...pt.reward });
      return { ok: true, tier: pt.tier, track: "prem", reward: pt.reward };
    }
    const tier = SEASON_TIERS.find((s) => s.tier === body.tier);
    if (!tier) return { err: "bad_tier" };
    if (p.season_xp < tier.xp) return { err: "locked" };
    const claimed = JSON.parse(p.claimed || "[]");
    if (claimed.includes(tier.tier)) return { err: "claimed" };
    claimed.push(tier.tier);
    this.sql.exec("UPDATE profiles SET claimed = ? WHERE id = ?", JSON.stringify(claimed), p.id);
    this.grant(p.id, "season", { season: p.season, tier: tier.tier, ...tier.reward });
    return { ok: true, tier: tier.tier, reward: tier.reward };
  },

  async "POST /pass/legacy"({ body, ip }) {
    if (body.ch) return { err: "cheat_session" };   // 2.3.12: cheats were used on the phone this session — no rewards, no leaderboard
    const [p, e] = await this.me(body, ip); if (e) return e;
    if (!this.cooldown("legacy", p.id)) return { err: "rate", status: 429 };
    let r;
    try { r = await accCall(this.env, "pass_legacy", { acc: p.id }); } catch (x) { return { err: "server", status: 503 }; }
    if (!r || !r.ok) return { err: r && r.code === "closed" ? "legacy_closed" : "no_legacy", text: r && r.err };
    this.log(p.id, ip, "pass_legacy", null, 1);
    return { ok: true, pass: true };
  },

  "GET /promo"() {
    const pr = currentPromo(this.env);
    const prod = pr && PRODUCTS.find((x) => x.id === pr.id);
    if (!pr || !prod) return { ok: true, promo: null, now: now() };
    return { ok: true, now: now(), promo: { id: pr.id, slot: pr.slot, stars: pr.stars, old: prod.stars, ends: pr.ends,
      off: Math.round((1 - pr.stars / prod.stars) * 100), title: prod.title, reward: prod.reward } };
  },

  async "POST /inbox"({ body, ip }) {
    const p = await this.who(body, ip);
    if (!p) return { err: "auth", status: 401 };
    const items = this.rows("SELECT n, kind, payload, at FROM inbox WHERE acc = ? AND taken = 0 ORDER BY n LIMIT 50", p.id)
      .map((r) => ({ n: r.n, kind: r.kind, at: r.at, ...JSON.parse(r.payload) }));
    return { ok: true, items };
  },

  async "POST /inbox/ack"({ body, ip }) {
    const p = await this.who(body, ip);
    if (!p) return { err: "auth", status: 401 };
    if (!Number.isInteger(body.upto) || body.upto < 1) return { err: "bad_upto" };
    this.sql.exec("UPDATE inbox SET taken = 1 WHERE acc = ? AND n <= ?", p.id, body.upto);
    return { ok: true };
  },

  async "POST /ping"({ body, ip }) {
    const p = await this.who(body, ip);
    if (!p) return { err: "auth", status: 401 };
    if (this.cooldown("ping", p.id)) this.sql.exec("UPDATE profiles SET last_seen = ? WHERE id = ?", now(), p.id);
    return { ok: true, online: this.one("SELECT COUNT(*) AS n FROM profiles WHERE last_seen > ?", now() - ONLINE_WINDOW).n };
  },

  "GET /online"() {
    return { ok: true, count: this.one("SELECT COUNT(*) AS n FROM profiles WHERE last_seen > ?", now() - ONLINE_WINDOW).n };
  },

  // 2.3.9: rights = owner account (id + secret, checked in Accounts) AND (GOD_KEY or this device's god token «gt»).
  // The reason of a refusal (why) is told only to the owner's signed-in account or to a request with the right key;
  // anybody else gets a bare {err:"forbidden"}.
  async "POST /god"({ body, ip }) {
    const env = this.env, act = typeof body.action === "string" ? body.action.slice(0, 20) : "";
    const deny = (why, tell, extra) => {
      this.log(typeof body.id === "string" ? body.id.slice(0, 16) : null, ip, "god_denied", { why, action: act }, 0);
      return tell ? { err: "forbidden", why, ...(extra || {}), status: 403 } : { err: "forbidden", status: 403 };
    };
    if (!this.limit("godfail:" + ip, GOD_FAILS_PER_10MIN, 600)) return { err: "rate", why: "rate", status: 429 };
    const hasKey = typeof body.key === "string" && body.key.length > 0 && body.key.length <= 256;
    const keyOk = !!env.GOD_KEY && hasKey && (await safeEq(body.key, env.GOD_KEY));
    // 2.3.12: the owner = OWNER_ID or OWNER_ID_ALT (isOwnerId); GOD_NO_KEY = "1" (owner's decision 07.11): the signed-in owner account
    // alone is enough (id + secret checked by Accounts exactly as before), no key; the rate limit, the log and the device tokens stay
    const noKey = env.GOD_NO_KEY === "1";
    const ownerId = isOwnerId(env, body.id);
    const p = ownerId || keyOk ? await this.who(body, ip) : null;
    const tell = keyOk || !!(ownerId && p);
    if ((!env.GOD_KEY && !noKey) || !ownerConfigured(env)) return deny("not_configured", tell, { missing: [!env.GOD_KEY && !noKey && "GOD_KEY", !ownerConfigured(env) && "OWNER_ID"].filter(Boolean) });
    if (!ownerId) return deny("not_owner", tell, { your_id: typeof body.id === "string" && ACC_RE.test(body.id) ? body.id : null });
    if (!p && this.whoRate) return { err: "rate", why: "rate", status: 429 };
    if (!p) return deny("bad_account", tell);
    // the owner's account is confirmed: now the key or the token of this device
    const sessH = await sha("godsess:" + body.secret);
    let via = null, tok = null;
    if (keyOk) via = "key";
    else if (typeof body.gt === "string" && /^[0-9a-f]{64}$/.test(body.gt)) {
      tok = this.one("SELECT * FROM god_tokens WHERE h = ?", await sha("godtok:" + body.gt));
      const dv = await devHash(body.dev);
      if (tok && tok.expires <= now()) { this.sql.exec("DELETE FROM god_tokens WHERE h = ?", tok.h); tok = null; }
      if (!tok || tok.acc !== p.id || tok.sess !== sessH || (tok.dev || null) !== (dv || null)) { if (!noKey) return deny("token_bad", true); tok = null; via = "account"; }
      else via = "token";
    } else if (noKey && !hasKey) via = "account";   // GOD_NO_KEY: the owner's own signed-in account
    else return deny(hasKey ? "bad_key" : "no_key", true);
    this.hits.delete("godfail:" + ip);   // a correct login doesn't burn the failure budget
    if (tok) this.sql.exec("UPDATE god_tokens SET used = ? WHERE h = ?", now(), tok.h);
    const fn = Object.prototype.hasOwnProperty.call(GOD, act) && !(Object.prototype.hasOwnProperty.call(CREATOR_GOD, act) && env.CREATOR_ON !== "1") ? GOD[act] : null;   // 2.3.12: «Создать» off → its god actions too
    if (!fn) return { err: "unknown_action", action: act };
    const out = await fn.call(this, body, { p, via, tok, sessH });
    this.log(p.id, ip, "god:" + act, { ...body, id: undefined, secret: undefined, key: undefined, gt: undefined, dev: undefined, label: undefined, via }, out && out.ok);
    return out;
  },
};

Object.assign(ROUTES, ACC_ROUTES);

const GOD = {
  ...GUARD_GOD,
  ...CREATOR_GOD,
  give(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const reward = {};
    if (b.crystals != null) { if (!Number.isInteger(b.crystals) || b.crystals < 1 || b.crystals > 1_000_000) return { err: "bad_crystals" }; reward.gems = b.crystals; }
    if (b.skin != null) { if (!SKIN_RE.test(b.skin)) return { err: "bad_skin" }; reward.skin = b.skin; }
    if (!reward.gems && !reward.skin) return { err: "nothing" };
    this.profile(b.to);
    this.grant(b.to, "gift", { ...reward, note: typeof b.note === "string" ? b.note.slice(0, 80) : undefined });
    return { ok: true, to: b.to, reward };
  },
  async pass(b) {       // {to, on: true|false}
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const r = await accCall(this.env, "pass_grant", { acc: b.to, src: "god", on: b.on !== false });
    return r && r.ok ? { ok: true, to: b.to, pass: r.pass } : { err: "not_found" };
  },
  // 2.3.9: «Бан» / «Разбан» were only a flag in the Online profile (the 1 на 1, capsules and the Lobby did not see it, the player
  // got no window). Now they are the real punishment of the account (permanent ban / lift), like «Наказания».
  async ban(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    if (isOwnerId(this.env, b.to)) return { err: "self" };
    const r = await GUARD_GOD.punish.call(this, { to: b.to, type: "perm", reason: typeof b.reason === "string" ? b.reason : undefined });
    return r && r.ok ? { ok: true, to: b.to, banned: true, pun: r.pun } : r;
  },
  async unban(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const r = await GUARD_GOD.lift.call(this, { to: b.to });
    return r && r.ok ? { ok: true, to: b.to, banned: false, lifted: r.lifted } : r;
  },
  online() {
    const rows = this.rows("SELECT id, nick, last_seen, flags, banned FROM profiles WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 200", now() - ONLINE_WINDOW);
    return { ok: true, count: rows.length, rows };
  },
  // one card: the online profile + the account (punishment, history, password, devices, links, pass). Was two buttons.
  async player(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const p = this.one("SELECT * FROM profiles WHERE id = ?", b.to);
    let g = null; try { g = await accCall(this.env, "pun_get", { to: b.to }); } catch (e) { g = null; }
    if (!(g && g.ok) && !p) return { err: "not_found" };
    const pass = g && g.ok ? await this.hasPass(b.to) : null;
    return { ...(g && g.ok ? g : {}), ok: true, id: b.to, nick: (g && g.nick) || (p && p.nick) || null, account: !!(g && g.ok),
      profile: p ? this.pubProfile(p) : null, flags: p ? p.flags : 0, banned: p ? !!p.banned : false, ban_reason: p ? p.ban_reason : null,
      last_seen: p ? p.last_seen : null, pass };
  },
  set_season(b) {
    if (b.season == null) { this.sql.exec("DELETE FROM kv WHERE k = 'season_override'"); const s = seasonInfo(); return { ok: true, season: s.season, ends: s.ends, override: false }; }
    if (!Number.isInteger(b.season) || b.season < 1 || b.season > 9999) return { err: "bad_season" };
    const ends = Number.isInteger(b.ends) ? b.ends : null;
    this.sql.exec("INSERT INTO kv (k, v) VALUES ('season_override', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify({ season: b.season, ends }));
    return { ok: true, season: b.season, ends: this.season().ends, override: true };
  },
  // 2.4+: the raid is the online fights (raid3_pool.js); the old 2.2 table alone was reset before, which changed nothing in the game.
  raid_reset() {
    const week = weekOf(), c = raid3Calendar();
    this.sql.exec("DELETE FROM raid WHERE week = ?", week);
    this.sql.exec("DELETE FROM raid_dmg WHERE week = ?", week);
    const periods = this.rows("SELECT period FROM raid3_pool WHERE week = ?", c.week).map((r) => r.period);
    for (const pd of periods) for (const t of ["raid3_pdmg", "raid3_pmatch", "raid3_pkill", "raid3_pool"]) this.sql.exec(`DELETE FROM ${t} WHERE period = ?`, pd);
    return { ok: true, week: c.week, boss: c.boss.id, pools: periods.length };
  },
  // ---- 2.3.9 the key once per device: a token for this device (owner account + session + device id), 30 days
  async login(b, c) {
    const t = now();
    this.sql.exec("DELETE FROM god_tokens WHERE expires <= ?", t);
    if (c.via === "token") return { ok: true, via: "token", until: c.tok.expires };
    const gt = hex(crypto.getRandomValues(new Uint8Array(32)));   // 256 bit; only its hash is kept
    this.sql.exec("INSERT INTO god_tokens (h, acc, sess, dev, label, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)",
      await sha("godtok:" + gt), c.p.id, c.sessH, await devHash(b.dev), cleanLabel(b.label), t, t + GOD_TOKEN_TTL);
    this.sql.exec("DELETE FROM god_tokens WHERE acc = ? AND h NOT IN (SELECT h FROM god_tokens WHERE acc = ? ORDER BY created DESC LIMIT ?)", c.p.id, c.p.id, GOD_TOKENS_MAX);
    return { ok: true, via: "key", gt, until: t + GOD_TOKEN_TTL };
  },
  // «Забыть это устройство» (also sent by «Выйти из аккаунта»); {all: true} = every device of the owner
  forget(b, c) {
    if (b.all === true) return { ok: true, revoked: godRevokeAll(this, c.p.id) };
    if (c.tok) this.sql.exec("DELETE FROM god_tokens WHERE h = ?", c.tok.h);
    return { ok: true, revoked: c.tok ? 1 : 0 };
  },
  status(b, c) {
    const rows = this.rows("SELECT label, created, used, expires FROM god_tokens WHERE acc = ? AND expires > ? ORDER BY created DESC", c.p.id, now());
    return { ok: true, via: c.via, until: c.tok ? c.tok.expires : null, owner: c.p.id, devices: rows, needKey: this.env.GOD_NO_KEY !== "1" };
  },
  // 2.3.12 «Тренировка рейда»: a practice match vs any of the 20 enemies (owner only: the checks of POST /god above + the hub checks
  // OWNER_ID again). {enemy, friends?} -> {match, ticket, enemy, code?}: own hp, no shared pool, no rewards, no result written.
  async raid_practice(b, c) {
    const enemy = typeof b.enemy === "string" ? b.enemy : "";
    if (!Object.prototype.hasOwnProperty.call(RAID3_ENEMIES, enemy)) return { err: "bad_enemy" };
    if (!this.env.RAIDHUB) return { err: "not_configured" };
    let r = null;
    try {
      const res = await this.env.RAIDHUB.get(this.env.RAIDHUB.idFromName("hub")).fetch("https://hub/practice", { method: "POST",
        headers: { "content-type": "application/json", "x-internal": "raid3" }, body: JSON.stringify({ acc: c.p.id, enemy, friends: b.friends === true, phase: Number.isInteger(b.phase) ? Math.max(0, Math.min(2, b.phase)) : 0 }) });
      r = await res.json();
    } catch (e) { r = null; }
    return r && r.ok ? r : { err: (r && r.err) || "server" };
  },
  log(b) {
    const lim = Number.isInteger(b.limit) ? Math.min(Math.max(b.limit, 1), 200) : 50;
    return { ok: true, rows: this.rows("SELECT * FROM god_log ORDER BY n DESC LIMIT ?", lim) };
  },
};

// ------------------------------------------------------------------ raid3.js internal (weekly online raid)
const RAID3_CAP = { minion: 5, boss: 3 };      // rewarded wins per account per UTC day (= RULES.dailyCap in raid3_rules.js)
// test-only knob (RAID3_TEST=1): a fixed small pool so the tests can kill it
function raid3PoolOverride(env) { const v = Number(env && env.RAID3_POOL_HP); return env && env.RAID3_TEST === "1" && v > 0 ? v : 0; }
// the week at time t: which minions were defeated in their day (→ boss or a rematch on days 5–7) + the weekly fund (+ own share);
// pays out the funds of finished weeks first (once per account: raid3_pool.js fundPlan / fundPay; punishment checked in Accounts)
async function raid3Week(b) {
  const t = Number.isInteger(b.t) ? b.t : now(), cal = raid3Calendar(t), acc = typeof b.acc === "string" && ACC_RE.test(b.acc) ? b.acc : null;
  for (const w of fundPending(this, cal.week)) {
    const list = fundPlan(this, w);
    let pun = {};
    if (list.length) {
      try { const r = await accCall(this.env, "pun_many", { ids: list.map((x) => x.acc) }); if (!r || !r.ok) throw new Error("pun_many"); pun = r.pun; }
      catch (e) { console.log("raid3 fund: punishment check failed, retry later", e && e.message); break; }   // no blind payout
    }
    fundPay(this, w, list, pun);
  }
  return { ok: true, week: cal.week, day: cal.day, status: weekStatus(this, cal), fund: fundView(this, cal.week, acc) };
}
function raid3Internal(b) {
  if (b.op === "check") {
    if (typeof b.acc !== "string" || !ACC_RE.test(b.acc)) return { err: "bad_acc" };
    const p = this.one("SELECT banned FROM profiles WHERE id = ?", b.acc);
    return { ok: true, banned: !!(p && p.banned) };
  }
  if (b.op === "week") return raid3Week.call(this, b);
  // raid3.js soft IP check: a suspicious same-IP cluster (several accounts of one IP in one match, or a same-IP join refused for a
  // young account / a shared device history) -> one god_log row «sus:raid3_ip» for the god panel («Лог») and the «Наказания» card.
  // No profile flag: one carrier IP (CGNAT) is not proof. Only a hash of the IP is stored.
  if (b.op === "ipcluster") {
    const accs = (Array.isArray(b.accs) ? b.accs : []).filter((x) => x && typeof x.acc === "string" && ACC_RE.test(x.acc)).slice(0, 8);
    if (!accs.length || typeof b.actor !== "string" || !ACC_RE.test(b.actor)) return { err: "bad" };
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    const args = { kind: b.kind === "refused" ? "refused" : "cluster", match: clip(b.match, 24), sig: clip(b.sig, 20), n: Number.isInteger(b.n) ? b.n : accs.length,
      accs: accs.map((x) => ({ acc: x.acc, young: !!x.young, google: !!x.g, dev: !!x.dev, marks: Array.isArray(x.marks) ? x.marks.slice(0, 4).map((m) => clip(m, 16)) : [] })) };
    this.log(b.actor, "raid3:" + (clip(b.ipk, 16) || "?"), "sus:raid3_ip", args, 1);
    return { ok: true };
  }
  if (b.op === "pool") {   // the shared hp of a period (+ the asking account's own contribution)
    if (!validPeriod(b.period) || !RAID3_CAP[b.kind] || !Number.isInteger(b.week)) return { err: "bad" };
    if (b.create) ensurePool(this, b.period, String(b.enemy || "").slice(0, 16), b.kind, b.week, raid3PoolOverride(this.env));
    return { ok: true, pool: poolView(this, b.period, b.acc) };
  }
  if (b.op === "hit") {    // 2.3.11 live damage of a running match → the shared pool (raid3_pool.js poolHit)
    if (typeof b.match !== "string" || !validPeriod(b.period) || !RAID3_CAP[b.kind] || !Number.isInteger(b.week)) return { err: "bad" };
    return { ok: true, ...poolHit(this, { period: b.period, match: b.match.slice(0, 40), enemy: String(b.enemy || "").slice(0, 16), kind: b.kind, week: b.week, seq: b.seq, hits: b.hits }, raid3PoolOverride(this.env)) };
  }
  if (b.op === "result") {
    const status = {}, gemsOut = {};
    if (typeof b.match !== "string" || !Array.isArray(b.players) || !RAID3_CAP[b.kind]) return { err: "bad" };
    const day = typeof b.day === "string" ? b.day.slice(0, 10) : dayKey();
    // the shared pool first (same synchronous transaction): a win takes this match's damage off the day's hp
    const pr = validPeriod(b.period) && Number.isInteger(b.week)
      ? poolResult(this, { period: b.period, match: b.match, enemy: String(b.enemy || "").slice(0, 16), kind: b.kind, week: b.week, won: !!b.won, players: b.players.slice(0, 8), live: !!b.live, cleanup: !!b.cleanup }, raid3PoolOverride(this.env))
      : null;
    for (const pl of b.players.slice(0, 8)) {
      if (!pl || typeof pl.acc !== "string" || !ACC_RE.test(pl.acc)) continue;
      const prof = this.profile(pl.acc);
      if (pl.cheat) { this.flag(prof, "raid3_" + String(pl.why || "cheat").slice(0, 20), "raid3"); status[pl.acc] = "cheat"; continue; }
      if (!(b.won || b.wipe) || !Number.isInteger(pl.gems) || pl.gems <= 0) { status[pl.acc] = "none"; continue; }   // 2.3.11 a wipe: reduced rewards (counted in the daily cap, not a win of the week)
      if (prof.banned) { status[pl.acc] = "banned"; continue; }
      // already written for this match (the match retried after a lost answer): the same answer again, nothing granted twice.
      // Checked before the daily cap: this match's own row must not count as «the 6th win of the day» on the retry.
      const before = this.one("SELECT gems FROM raid3_win WHERE match = ? AND acc = ?", b.match, pl.acc);
      if (before) { status[pl.acc] = "ok"; gemsOut[pl.acc] = before.gems; continue; }
      const n = this.one("SELECT COUNT(*) AS n FROM raid3_win WHERE acc = ? AND day = ? AND kind = ?", pl.acc, day, b.kind).n;
      if (n >= RAID3_CAP[b.kind]) { status[pl.acc] = "cap"; continue; }
      const gems = Math.max(1, Math.round(Math.min(pl.gems, 2000) * (pr && pr.cleanup ? POOL.cleanupK : 1)));   // «зачистка»: smaller
      this.sql.exec("INSERT INTO raid3_win (match, acc, day, kind, enemy, gems, at) VALUES (?, ?, ?, ?, ?, ?, ?)", b.match, pl.acc, day, b.kind,
        typeof b.enemy === "string" ? b.enemy.slice(0, 16) : null, gems, now());
      this.grant(pl.acc, "raid", { gems, src: "raid3", enemy: b.enemy, match: b.match });
      status[pl.acc] = "ok"; gemsOut[pl.acc] = gems;
    }
    return { ok: true, status, gems: gemsOut, pool: pr ? pr.pool : null, cleanup: pr ? pr.cleanup : false, killedNow: pr ? pr.killedNow : false, kill: pr ? pr.kill : {} };
  }
  return { err: "unknown_op" };
}
