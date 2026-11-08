// Punishment notices (07.11.2026): a warning / suspension / ban issued in the god panel reaches the player within seconds.
// The Online DO keeps one row per issued punishment (table notices, added on first use). POST /ping answers the unseen ones
// as {notices:[{n, type, reason, until, at, scope?, revoked?}]} (scope: the features of a scoped suspension / warning); the game shows a window and confirms with POST /notice/ack
// {id, secret, upto} → seen once per notice, kept across restarts (offline: the next ping after launch shows it).
// Lifted punishments and expired suspensions / bans are not announced. The profile history (Accounts pun table) is untouched;
// a confirmed warning notice also marks the account's warnings seen there (the same as «Понятно» on /acc/warn_ack).
import { accCall } from "./accounts.js";

const ACC_RE = /^[0-9a-f]{12}$/;
const now = () => Math.floor(Date.now() / 1000);
export const NOTICE_TYPES = ["warn", "suspend", "ban", "perm"];
const MAX_UNSEEN = 5;

function schema(self) {
  if (self.ntcOk) return;
  self.sql.exec(`CREATE TABLE IF NOT EXISTS notices (n INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT NOT NULL, pun INTEGER, type TEXT NOT NULL,
    reason TEXT, until INTEGER, at INTEGER NOT NULL, revoked TEXT, seen INTEGER NOT NULL DEFAULT 0, scope TEXT)`);
  self.sql.exec("CREATE INDEX IF NOT EXISTS notices_acc ON notices (acc, seen)");
  self.ntcOk = true;
}

// the rewards taken back by a rollback (only what is not zero)
function revokedOf(rb) {
  if (!rb || !rb.ok) return null;
  const b = rb.back || {}, o = {};
  if (b.gems > 0) o.gems = b.gems;
  if (b.dark > 0) o.dark = b.dark;
  for (const k of ["skins", "frames", "trails", "deaths", "titles"]) if (Array.isArray(b[k]) && b[k].length) o[k] = b[k].slice(0, 20);
  if (rb.cancelled > 0) o.cancelled = rb.cancelled;
  if (rb.places && (rb.places.daily > 0 || rb.places.season > 0)) o.places = (rb.places.daily || 0) + (rb.places.season || 0);
  return Object.keys(o).length ? o : null;
}

// GUARD_GOD.punish / evasion: one notice per punished account
export function noticeAdd(self, acc, pun, rb) {
  if (!ACC_RE.test(acc || "") || !pun || !NOTICE_TYPES.includes(pun.type)) return;
  schema(self);
  const rv = revokedOf(rb);
  const sc = Array.isArray(pun.scope) && pun.scope.length ? pun.scope.join(",") : null;   // scoped suspension / warning; null = all online
  self.sql.exec("INSERT INTO notices (acc, pun, type, reason, until, at, revoked, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", acc,
    Number.isInteger(pun.n) ? pun.n : null, pun.type, typeof pun.reason === "string" ? pun.reason.slice(0, 200) : null,
    Number.isInteger(pun.until) ? pun.until : null, now(), rv ? JSON.stringify(rv) : null, sc);
}

// GUARD_GOD.lift: nothing left to announce
export function noticeLift(self, acc) {
  if (!ACC_RE.test(acc || "")) return;
  schema(self);
  self.sql.exec("UPDATE notices SET seen = 1 WHERE acc = ? AND seen = 0", acc);
}

// POST /ping: the unseen notices of this account (null when none — the answer stays as before)
export function noticesFor(self, acc) {
  schema(self);
  const rows = self.rows("SELECT n, type, reason, until, at, revoked, scope FROM notices WHERE acc = ? AND seen = 0 " +
    "AND (type = 'warn' OR type = 'perm' OR until IS NULL OR until > ?) ORDER BY n LIMIT ?", acc, now(), MAX_UNSEEN);
  if (!rows.length) return null;
  return rows.map((r) => {
    const o = { n: r.n, type: r.type, reason: r.reason || null, until: r.until == null ? null : r.until, at: r.at };
    if (r.scope) o.scope = r.scope.split(",");
    if (r.revoked) { try { o.revoked = JSON.parse(r.revoked); } catch (e) { /* ignore */ } }
    return o;
  });
}

// POST /acc/warn_ack (the warning window of the profile): the warning notices are seen too
export function noticeWarnSeen(self, acc) {
  if (!ACC_RE.test(acc || "")) return;
  schema(self);
  self.sql.exec("UPDATE notices SET seen = 1 WHERE acc = ? AND seen = 0 AND type = 'warn'", acc);
}

export const NOTICE_ROUTES = {
  // {id, secret, upto}: every notice of this account up to n = upto is seen
  async "POST /notice/ack"({ body, ip }) {
    const p = await this.who(body, ip);
    if (!p) return { err: "auth", status: 401 };
    if (!Number.isInteger(body.upto) || body.upto < 1) return { err: "bad_upto" };
    schema(this);
    const warn = this.one("SELECT COUNT(*) AS c FROM notices WHERE acc = ? AND seen = 0 AND n <= ? AND type = 'warn'", p.id, body.upto).c;
    this.sql.exec("UPDATE notices SET seen = 1 WHERE acc = ? AND seen = 0 AND n <= ?", p.id, body.upto);
    if (warn) { try { await accCall(this.env, "warn_ack", { id: body.id, secret: body.secret }); } catch (e) { /* the profile window asks again */ } }
    return { ok: true };
  },
};
