// «Кто онлайн» (07.11.2026): who is online now — the list behind the «N онлайн» chip.
//   GET  /api/v2/online/list        public: [{nick, skin, act}] (no account ids), max 100, banned / punished left out
//   POST /api/v2/god {action:"who"} owner only (the god-panel auth): the same list + the account id of every row
// "online" = profiles.last_seen within ONLINE_WINDOW (the same rule as GET /online). The list is built at most once per
// WHO_TTL s (memory of the Online DO); punishments come from one pun_many call to the Accounts DO per build. Accounts
// unreachable: the last list, or 503 — never an unchecked list. «act» = what the player does (POST /ping {act} → profiles.act).
export const WHO_N = 100, WHO_TTL = 10;
const WHO_PAGE = 150;
export const WHO_ACTS = ["menu", "run", "raid", "push", "ghost"];

// POST /ping {act}: what the player does now → profiles.act (the column is added on first use; written only when it changes)
function actCol(self) {
  if (self.whoCol) return;
  try { self.sql.exec("ALTER TABLE profiles ADD COLUMN act TEXT"); } catch (e) { /* already there */ }
  self.whoCol = true;
}
export function whoNote(self, p, act) {
  if (typeof act !== "string" || !WHO_ACTS.includes(act) || !p || !p.id) return;
  actCol(self);
  if (p.act !== act) self.sql.exec("UPDATE profiles SET act = ? WHERE id = ?", act, p.id);
}

async function build(self, punMany, windowSec) {
  const t = Math.floor(Date.now() / 1000);
  actCol(self);
  const cand = self.rows("SELECT id, nick, skin, act FROM profiles WHERE last_seen > ? AND banned = 0 ORDER BY last_seen DESC, id LIMIT ?",
    t - windowSec, WHO_PAGE);
  const pun = await punMany(self, cand.map((c) => c.id));
  const rows = cand.filter((c) => !pun[c.id]).slice(0, WHO_N);
  return { at: Date.now(), rows };
}

// -> {ok, count, rows:[{nick, skin, act[, id]}]}; withIds only for the god action
export async function whoList(self, punMany, windowSec, withIds) {
  let c = self.whoCache;
  if (!c || Date.now() - c.at > WHO_TTL * 1000) {
    if (!self.whoBuild) self.whoBuild = build(self, punMany, windowSec).finally(() => { self.whoBuild = null; });
    try { c = self.whoCache = await self.whoBuild; }
    catch (e) { if (!c) return { err: "server", status: 503 }; }
  }
  const rows = c.rows.map((r) => {
    const o = { nick: r.nick || null, skin: r.skin || null, act: WHO_ACTS.includes(r.act) ? r.act : null };
    return withIds ? { id: r.id, ...o } : o;
  });
  return { ok: true, count: rows.length, max: WHO_N, ttl: WHO_TTL, rows };
}
