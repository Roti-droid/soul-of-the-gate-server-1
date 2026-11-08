// online_guard.js — 2.3.6 «Защита аккаунтов и наказания»: the Online-DO side (merged into online.js).
//
//   POST /api/v2/acc/status      {id,secret}                -> punishment, unseen warnings, consent version, «new sign-in»
//   POST /api/v2/acc/sessions    {id,secret}                -> devices signed in (label, kind, created, last seen, current)
//   POST /api/v2/acc/logout_all  {id,secret}                -> only this device stays signed in
//   POST /api/v2/acc/consent     {id,secret,v,terms,privacy,age}
//   POST /api/v2/acc/warn_ack    {id,secret}
//   POST /api/v2/acc/pw_set      {id,secret,old?,pw}        -> other devices signed out
//   (password sign-in / reset go through the game WebSocket: acc_pw_login, acc_pw_reset — index.js)
//
// Rewards journal (table rewards): every grant to the inbox (season, raid, gift…) + redeemed codes (Lobby) + capsule skins
// (asked from Chest3 at rollback). God «откат» takes back what was given in a time window: undelivered inbox items are
// cancelled, delivered ones become one inbox item {kind:'revoke'} the game applies (crystals, skins, frames, trails, titles).
// Paid codes (bought with Stars) are kept unless the rollback is for payment fraud.

import { accCall } from "./accounts.js";
import { isOwnerId, cleanScope } from "./accounts_guard.js";
import { noticeAdd, noticeLift, noticeWarnSeen } from "./online_notice.js";   // punishment notices in the ping answer

const now = () => Math.floor(Date.now() / 1000);
const ACC_RE = /^[0-9a-f]{12}$/;
const DAY = 86400;

export const REWARDS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rewards (n INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT NOT NULL, src TEXT NOT NULL, ref TEXT,
    reward TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, inbox INTEGER, revoked INTEGER)`,
  "CREATE INDEX IF NOT EXISTS rewards_acc ON rewards (acc, at)",
];

// 2.3.9 god-panel device tokens: the GOD_KEY is typed once per device, then the panel works with a random 256-bit token.
// Only sha256(token) is stored, bound to the owner account + the session (sha256 of the device secret) + the guard device id.
// 30 days; revoked by «Выйти на всех устройствах», a password change, «Выйти из аккаунта» and «Забыть это устройство».
export const GOD_TOKEN_TTL = 30 * DAY;
export const GOD_TOKENS_MAX = 10;
export const GODTOK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS god_tokens (h TEXT PRIMARY KEY, acc TEXT NOT NULL, sess TEXT NOT NULL, dev TEXT, label TEXT,
    created INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER)`,
  "CREATE INDEX IF NOT EXISTS god_tokens_acc ON god_tokens (acc)",
];
export function godRevokeAll(self, acc) {
  if (typeof acc !== "string" || !ACC_RE.test(acc)) return 0;
  const n = self.one("SELECT COUNT(*) AS n FROM god_tokens WHERE acc = ?", acc).n;
  self.sql.exec("DELETE FROM god_tokens WHERE acc = ?", acc);
  return n;
}

// called from Online.grant() and the Lobby (codes)
export function journal(self, acc, src, ref, reward, paid, inboxN) {
  self.sql.exec("INSERT INTO rewards (acc, src, ref, reward, paid, at, inbox) VALUES (?, ?, ?, ?, ?, ?, ?)", acc, String(src).slice(0, 16),
    ref == null ? null : String(ref).slice(0, 40), JSON.stringify(reward || {}).slice(0, 2000), paid ? 1 : 0, now(), inboxN == null ? null : inboxN);
}

// POST https://online/guard/internal (x-internal: guard) — Lobby only
export function guardInternal(b) {
  if (b.op === "journal") {
    if (typeof b.acc !== "string" || !ACC_RE.test(b.acc)) return { err: "bad_acc" };
    journal(this, b.acc, b.src || "code", b.ref, b.reward, !!b.paid, null);
    return { ok: true };
  }
  return { err: "unknown_op" };
}

async function fwd(self, op, body, ip) {
  if (!self.limit("accg:" + ip, 30, 60)) return { err: "rate", status: 429 };
  const { id, secret } = body;
  if (typeof id !== "string" || !ACC_RE.test(id) || typeof secret !== "string" || secret.length > 64) return { err: "auth", status: 401 };
  let r;
  try { r = await accCall(self.env, op, { ...body, id, secret, ip }); } catch (e) { return { err: "server", status: 503 }; }
  if (!r || r.err) return { err: r && r.code === "auth" ? "auth" : (r && r.code) || "bad", text: r && r.err, status: r && r.code === "auth" ? 401 : 400, ...(r && r.terms_v ? { terms_v: r.terms_v } : {}) };
  return r;
}

export const ACC_ROUTES = {
  async "POST /acc/status"({ body, ip }) { return fwd(this, "acc_status", { id: body.id, secret: body.secret }, ip); },
  async "POST /acc/sessions"({ body, ip }) { return fwd(this, "sessions", { id: body.id, secret: body.secret }, ip); },
  async "POST /acc/logout_all"({ body, ip }) {
    const r = await fwd(this, "logout_all", { id: body.id, secret: body.secret }, ip);
    if (r.ok) { this.authCache.clear(); r.god_revoked = godRevokeAll(this, body.id); }   // other devices' cached sign-ins die here too (+ god tokens)
    return r;
  },
  async "POST /acc/consent"({ body, ip }) {
    const r = await fwd(this, "consent", { id: body.id, secret: body.secret, v: body.v, terms: body.terms === true, privacy: body.privacy === true, age: body.age === true }, ip);
    if (r.ok) for (const k of [...this.authCache.keys()]) if (k.startsWith(body.id + ":")) this.authCache.delete(k);
    return r;
  },
  async "POST /acc/warn_ack"({ body, ip }) { const r = await fwd(this, "warn_ack", { id: body.id, secret: body.secret }, ip); if (r.ok) noticeWarnSeen(this, body.id); return r; },
  async "POST /acc/pw_set"({ body, ip }) {
    const r = await fwd(this, "pw_set", { id: body.id, secret: body.secret, old: typeof body.old === "string" ? body.old : null, pw: body.pw }, ip);
    if (r.ok) { this.authCache.clear(); godRevokeAll(this, body.id); }
    return r;
  },
};

// ---------------------------------------------------------------- rollback
function rewardParts(r, into) {
  const g = Number.isInteger(r.gems) ? r.gems : Number.isInteger(r.crystals) ? r.crystals : 0;
  if (g > 0) into.gems += g;
  if (Number.isInteger(r.dark) && r.dark > 0) into.dark += r.dark;
  for (const s of [r.skin, ...(Array.isArray(r.skins) ? r.skins : [])]) if (typeof s === "string" && s && !into.skins.includes(s)) into.skins.push(s);
  for (const k of ["frames", "trails", "deaths"]) {   // 2.3.14: + deaths; premium-track inbox items carry one trail / death / frame
    const one = r[k.slice(0, -1)];
    for (const x of [one, ...(Array.isArray(r[k]) ? r[k] : [])]) if (typeof x === "string" && x && !into[k].includes(x)) into[k].push(x);
  }
  if (typeof r.title === "string" && !into.titles.includes(r.title)) into.titles.push(r.title);
}

async function chest3Revoke(env, acc, from, until) {
  if (!env.CHEST3) return [];
  try {
    const st = env.CHEST3.get(env.CHEST3.idFromName("chest3"));
    const r = await (await st.fetch("https://chest3/guard_revoke", { method: "POST", headers: { "content-type": "application/json", "x-internal": "guard" },
      body: JSON.stringify({ acc, from, until }) })).json();
    return r && r.ok && Array.isArray(r.rows) ? r.rows : [];
  } catch (e) { console.log(`rollback: chest3 failed: ${e}`); return []; }
}

// {to, from, until?, fraud?, places? (default true), reason?}
export async function rollback(self, b) {
  if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
  const t = now();
  const from = Number.isInteger(b.from) ? b.from : Number.isFinite(b.days) && b.days > 0 ? t - Math.round(b.days * DAY) : null;
  if (!from || from > t || from < t - 400 * DAY) return { err: "bad_from" };
  const until = Number.isInteger(b.until) && b.until > from ? Math.min(b.until, t) : t;
  const fraud = b.fraud === true;
  // all awaits first (capsules from Chest3), then the synchronous part
  const caps = await chest3Revoke(self.env, b.to, from, until);
  const back = { gems: 0, dark: 0, skins: [], frames: [], trails: [], deaths: [], titles: [] };
  let cancelled = 0, taken = 0, keptPaid = 0, passOff = false;
  const rows = self.rows("SELECT * FROM rewards WHERE acc = ? AND at >= ? AND at <= ? AND revoked IS NULL ORDER BY n", b.to, from, until);
  for (const r of rows) {
    if (r.paid && !fraud) { keptPaid++; continue; }
    let rw = {}; try { rw = JSON.parse(r.reward) || {}; } catch (e) { rw = {}; }
    const ib = r.inbox != null ? self.one("SELECT taken FROM inbox WHERE n = ?", r.inbox) : null;
    if (ib && !ib.taken) { self.sql.exec("UPDATE inbox SET taken = 1 WHERE n = ?", r.inbox); cancelled++; }
    else { rewardParts(rw, back); taken++; if (rw.pass === true) passOff = true; }
    self.sql.exec("UPDATE rewards SET revoked = ? WHERE n = ?", t, r.n);
  }
  for (const c of caps) {
    if (typeof c.skin === "string" && !back.skins.includes(c.skin)) back.skins.push(c.skin);
    journal(self, b.to, "capsule", c.nonce, { skin: c.skin, price: c.price }, 0, null);
    self.sql.exec("UPDATE rewards SET revoked = ? WHERE n = (SELECT MAX(n) FROM rewards WHERE acc = ?)", t, b.to);
  }
  if (passOff && fraud) { try { await accCall(self.env, "pass_grant", { acc: b.to, src: "god:fraud", on: false }); } catch (e) { /* the owner can switch it off by hand */ } }
  const any = back.gems || back.dark || back.skins.length || back.frames.length || back.trails.length || back.deaths.length || back.titles.length;
  const why = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 120) : null;
  if (any) self.sql.exec("INSERT INTO inbox (acc, kind, payload, at) VALUES (?, 'revoke', ?, ?)", b.to, JSON.stringify({ ...back, reason: why, from, until }), t);
  let places = { daily: 0, season: 0 };
  if (b.places !== false) {
    places.daily = self.one("SELECT COUNT(*) AS n FROM daily WHERE acc = ? AND at >= ? AND at <= ?", b.to, from, until).n;
    self.sql.exec("DELETE FROM daily WHERE acc = ? AND at >= ? AND at <= ?", b.to, from, until);
    try { const r = await accCall(self.env, "scores_drop", { acc: b.to, from, until }); places.season = (r && r.removed) || 0; } catch (e) { /* ignore */ }
  }
  console.log(`rollback ${b.to}: ${rows.length} journal rows (${cancelled} cancelled, ${taken} taken back, ${keptPaid} paid kept), ${caps.length} capsules`);
  return { ok: true, to: b.to, from, until, cancelled, taken, kept_paid: keptPaid, capsules: caps.length, back, places, pass_off: passOff && fraud };
}

const PTYPE = ["warn", "suspend", "ban", "perm"];

export const GUARD_GOD = {
  // {to, type, days? | until?, reason, revoke?: true, from? | vdays? (violation started N days ago), fraud?}
  async punish(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    if (isOwnerId(this.env, b.to)) return { err: "self" };
    if (!PTYPE.includes(b.type)) return { err: "bad_type" };
    let until = Number.isInteger(b.until) ? b.until : null;
    if (until == null && Number.isFinite(b.days) && b.days > 0) until = now() + Math.round(b.days * DAY);
    // 07.11 scope (suspend / warn): ["raid","push","ghost","creator","season","nick"] or "all" / none = all online; ban = everything
    const scope = (b.type === "suspend" || b.type === "warn") && b.scope != null ? cleanScope(b.scope) : null;
    if (b.scope != null && b.scope !== "all" && !(Array.isArray(b.scope) && b.scope.includes("all")) && (b.type === "suspend" || b.type === "warn") && !scope) return { err: "bad_scope" };
    const r = await accCall(this.env, "pun_set", { to: b.to, type: b.type, until, reason: b.reason, by: "god", scope });
    if (!r || !r.ok) return { err: (r && r.err) || "server" };
    this.profile(b.to);
    if (b.type === "perm") this.sql.exec("UPDATE profiles SET banned = 1, ban_reason = ? WHERE id = ?", typeof b.reason === "string" ? b.reason.slice(0, 120) : null, b.to);
    this.authCache.clear();
    let rb = null;
    if (b.revoke) rb = await rollback(this, { to: b.to, from: b.from, days: b.vdays, fraud: b.fraud, reason: b.reason, places: b.places });
    noticeAdd(this, b.to, r.pun, rb);   // the player sees it within seconds (POST /ping → notices)
    return { ok: true, to: b.to, pun: r.pun, active: r.active, rollback: rb };
  },
  async lift(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const r = await accCall(this.env, "pun_lift", { to: b.to });
    if (!r || !r.ok) return { err: (r && r.err) || "server" };
    this.sql.exec("UPDATE profiles SET banned = 0, ban_reason = NULL WHERE id = ?", b.to);
    this.authCache.clear(); noticeLift(this, b.to);
    return { ok: true, to: b.to, lifted: r.lifted };
  },
  async pcard(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const r = await accCall(this.env, "pun_get", { to: b.to });
    if (!r || !r.ok) return { err: (r && r.err) || "not_found" };
    const p = this.one("SELECT flags, banned, last_seen FROM profiles WHERE id = ?", b.to);
    return { ...r, flags: p ? p.flags : 0, last_seen: p ? p.last_seen : null };
  },
  rewards(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const lim = Number.isInteger(b.limit) ? Math.min(Math.max(b.limit, 1), 200) : 60;
    const rows = this.rows("SELECT r.n, r.src, r.ref, r.reward, r.paid, r.at, r.revoked, i.taken FROM rewards r LEFT JOIN inbox i ON i.n = r.inbox " +
      "WHERE r.acc = ? ORDER BY r.n DESC LIMIT ?", b.to, lim)
      .map((r) => ({ n: r.n, src: r.src, ref: r.ref, reward: JSON.parse(r.reward || "{}"), paid: !!r.paid, at: r.at, revoked: r.revoked,
        delivered: r.taken == null ? true : !!r.taken }));
    return { ok: true, to: b.to, rows };
  },
  async rollback(b) { return rollback(this, b); },
  async linked(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    return accCall(this.env, "linked", { to: b.to });
  },
  async evasion(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    const r = await accCall(this.env, "pun_evasion", { to: b.to, reason: b.reason, by: "god" });
    if (r && r.ok) { for (const id of r.banned || []) { this.profile(id); this.sql.exec("UPDATE profiles SET banned = 1, ban_reason = 'обход бана' WHERE id = ?", id); noticeAdd(this, id, { type: "perm", reason: ("Обход бана" + (typeof b.reason === "string" && b.reason.trim() ? ": " + b.reason.trim() : "")).slice(0, 200) }, null); } this.authCache.clear(); }
    return r;
  },
  async pw_clear(b) {
    if (!ACC_RE.test(b.to || "")) return { err: "bad_to" };
    return accCall(this.env, "pw_clear", { to: b.to });
  },
};
