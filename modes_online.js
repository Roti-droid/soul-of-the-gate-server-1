// modes_online.js — the Online DO side of «Режимы» (modes.js): ban check, cheat flag, rewards into the inbox (+ the rewards
// journal of online_guard.js, so the god panel's rollback covers them), god log rows. Called as modesInternal.call(onlineDO, body)
// from Online.fetch for "/modes/internal" with the header x-internal: modes (public requests can't carry it).
const ACC_RE = /^[0-9a-f]{12}$/;
let ready = false;
export function modesInternal(b) {
  if (!ready) { this.sql.exec("CREATE TABLE IF NOT EXISTS modes_grant (key TEXT PRIMARY KEY, acc TEXT NOT NULL, gems INTEGER NOT NULL, at INTEGER NOT NULL)"); ready = true; }
  if (!b || typeof b.acc !== "string" || !ACC_RE.test(b.acc)) return { err: "bad_acc" };
  const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
  if (b.op === "check") { const p = this.one("SELECT banned FROM profiles WHERE id = ?", b.acc); return { ok: true, banned: !!(p && p.banned) }; }
  if (b.op === "flag") { const p = this.profile(b.acc); this.flag(p, clip(b.src, 8) + "_" + clip(b.why, 24), "modes"); return { ok: true }; }
  if (b.op === "log") { this.log(b.acc, "modes", clip(b.action, 32) || "modes", b.args || null, 1); return { ok: true }; }
  if (b.op === "grant") {
    const key = clip(b.key, 80), gems = Number(b.gems);
    if (!key || !Number.isInteger(gems) || gems <= 0 || gems > 100) return { err: "bad" };
    const p = this.profile(b.acc);
    if (p.banned) return { err: "banned" };
    if (this.one("SELECT 1 AS x FROM modes_grant WHERE key = ?", key)) return { ok: true, again: true };   // a retry: granted once
    this.sql.exec("INSERT INTO modes_grant (key, acc, gems, at) VALUES (?, ?, ?, ?)", key, b.acc, gems, Math.floor(Date.now() / 1000));
    this.grant(b.acc, "modes", { gems, src: clip(b.src, 12) || "modes", why: clip(b.why, 12), match: key });
    return { ok: true };
  }
  return { err: "unknown_op" };
}
