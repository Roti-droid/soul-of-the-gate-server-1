// raid3_pool.js — the SHARED hp of the day's enemy (owner, 05.11): one match never kills the enemy of the day. The minion of
// the day (days 1–4) and the boss of the week (days 5–7) have ONE hp pool for the whole period on the server; every WON match
// takes the damage of that match (sum of its fair players' judged damage) off the pool. When the pool reaches 0 the enemy is
// defeated until its period ends: everybody who contributed gets ONE kill reward by contribution, later fights are a
// «зачистка» (cleanup) with smaller per-match rewards. Lives inside the Online Durable Object: every call is one synchronous
// SQL transaction of one DO request, so two matches finishing at the same moment can never race (no await between read
// and write). A match takes hp off once (PRIMARY KEY period+match), a kill reward is given once (PRIMARY KEY period+acc).
//
// Pool size from the number of active raid players of the PREVIOUS week (one row per (week, acc) with damage > 0), clamped.

export const POOL = {
  // 2.3.11 timed fights (150 s, all damage into the pool): a good player deals ≈ 8 000 on a minion / ≈ 10 000 on a boss per match —
  // the pool stays ≈ 3 (minion) / 5 (boss) good matches per active player of last week, as before
  minion: { perActive: 8000 * 3, min: 80000, max: 8000000, kill: 400 },
  boss: { perActive: 10000 * 5, min: 100000, max: 10000000, kill: 1000 },
  cleanupK: 0.4,                                                           // per-match reward after the kill
  killMinK: 0.25, killMaxK: 3,                                             // kill reward = kill × n × share, clamped
  top: 5,
};

export const POOL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS raid3_pool (period TEXT PRIMARY KEY, enemy TEXT NOT NULL, kind TEXT NOT NULL, week INTEGER NOT NULL,
    hp_max INTEGER NOT NULL, hp INTEGER NOT NULL, active INTEGER NOT NULL, created INTEGER NOT NULL, killed_at INTEGER, kill_match TEXT)`,
  `CREATE TABLE IF NOT EXISTS raid3_pdmg (period TEXT NOT NULL, acc TEXT NOT NULL, nick TEXT, dmg INTEGER NOT NULL, wins INTEGER NOT NULL,
    PRIMARY KEY (period, acc))`,
  "CREATE INDEX IF NOT EXISTS raid3_pdmg_top ON raid3_pdmg (period, dmg)",
  `CREATE TABLE IF NOT EXISTS raid3_pmatch (period TEXT NOT NULL, match TEXT NOT NULL, dmg INTEGER NOT NULL, took INTEGER NOT NULL,
    at INTEGER NOT NULL, PRIMARY KEY (period, match))`,
  `CREATE TABLE IF NOT EXISTS raid3_pkill (period TEXT NOT NULL, acc TEXT NOT NULL, gems INTEGER NOT NULL, share REAL NOT NULL,
    at INTEGER NOT NULL, PRIMARY KEY (period, acc))`,
  // 2.3.11 live pool: one row per flushed batch of a match (idempotent retries), the killing blow of a period (its player)
  `CREATE TABLE IF NOT EXISTS raid3_phit (period TEXT NOT NULL, match TEXT NOT NULL, seq INTEGER NOT NULL, dmg INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (period, match, seq))`,
  `CREATE TABLE IF NOT EXISTS raid3_pkb (period TEXT PRIMARY KEY, acc TEXT NOT NULL, match TEXT NOT NULL, gems INTEGER NOT NULL, at INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS raid3_active (week INTEGER NOT NULL, acc TEXT NOT NULL, PRIMARY KEY (week, acc))",
  // weekly fund (owner 06.11): won matches per account per week where the player was not afk / offline (the participation bar)
  "CREATE TABLE IF NOT EXISTS raid3_wact (week INTEGER NOT NULL, acc TEXT NOT NULL, wins INTEGER NOT NULL, PRIMARY KEY (week, acc))",
  `CREATE TABLE IF NOT EXISTS raid3_wfund (week INTEGER PRIMARY KEY, gems INTEGER NOT NULL, taken INTEGER NOT NULL, kills INTEGER NOT NULL,
    boss INTEGER NOT NULL, players INTEGER NOT NULL, at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS raid3_wpay (week INTEGER NOT NULL, acc TEXT NOT NULL, gems INTEGER NOT NULL, share REAL NOT NULL,
    why TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (week, acc))`,
  // 2.3.12 «План дня»: the pool's hp at the first look / hit of each UTC day (the day's progress toward the next phase)
  "CREATE TABLE IF NOT EXISTS raid3_pday (period TEXT NOT NULL, day TEXT NOT NULL, hp INTEGER NOT NULL, PRIMARY KEY (period, day))",
];

// 2.3.12 (owner 07.11) the PHASES of an enemy come from its shared pool, not from the match: 100–66 % phase 1, 66–33 % phase 2,
// 33–0 % phase 3 (0-based 0 / 1 / 2). The phase is read when a match begins and the whole match plays in it (a pool that crosses a
// threshold mid-match changes the next matches). «План дня» = today's quota: reach the next threshold (phase 3: defeat it).
// Not met — nothing bad: the next day goes on in the same phase.
export const PHASE_TH = [0.66, 0.33];
export function poolPhase(hp, hpMax) { const f = hpMax > 0 ? Math.max(0, hp) / hpMax : 1; return f > PHASE_TH[0] ? 0 : f > PHASE_TH[1] ? 1 : 2; }
const dayNow = () => new Date().toISOString().slice(0, 10);
export function poolDayStart(db, p) {   // (writes once per period and UTC day)
  if (!p) return null;
  const d = dayNow(); db.sql.exec("INSERT OR IGNORE INTO raid3_pday (period, day, hp) VALUES (?, ?, ?)", p.period, d, Math.max(0, p.hp));
  const r = db.one("SELECT hp FROM raid3_pday WHERE period = ? AND day = ?", p.period, d); return r ? r.hp : p.hp;
}
export function poolPlan(hp, hpMax, startHp) {
  const m = Math.max(1, hpMax), now = Math.max(0, hp) / m, from = Math.max(0, startHp == null ? hp : startHp) / m, ph = poolPhase(hp, hpMax);
  const phFrom = poolPhase(startHp == null ? hp : startHp, hpMax), target = phFrom < 2 ? PHASE_TH[phFrom] : 0;   // the day's quota is set by the phase the day began in
  const r3 = (x) => Math.round(x * 1000) / 1000, prog = from > target ? Math.max(0, Math.min(1, (from - now) / (from - target))) : 1;
  return { phase: ph, phases: PHASE_TH, target, from: r3(from), now: r3(now), progress: r3(prog), done: now <= target };
}

// The weekly fund: grows with the common result of the week — every defeated enemy (pool at 0; the boss is worth much more)
// and every point of shared hp taken off — and is split at the end of the week (UTC) between all participants BY CONTRIBUTION
// (weight = shared-hp damage of the week + winW × won matches), with a participation bar (≥ 1 won match not afk/offline) and a
// cap per account. Paid ONCE per account (PRIMARY KEY week+acc) through the inbox (grant → rewards journal). Also when the boss
// did not come. Banned / punished accounts get nothing (their part is not handed to others: the cap keeps it fair anyway).
export const FUND = { perHp: 0.01, kill: { minion: 600, boss: 3000 }, winW: 300, accMax: 3000, max: 2000000 };

const PERIOD_RE = /^[0-9]{1,5}-([1-4]|b|r)-[a-z]{2,12}$/;   // day 1–4 minion · b = boss of days 5–7 · r = minion rematch of days 5–7
const ACC_RE = /^[0-9a-f]{12}$/;
const nowS = () => Math.floor(Date.now() / 1000);
// period of a match: the minion's day or the boss's days 5–7 of that week (+ enemy id: forced test fights get their own pool)
// A minion period on days 1–4 is the enemy's own day in that week's calendar (today, if it is today's enemy), else (forced test
// enemies / a fallback enemy) today. A minion fought on days 5–7 is a REMATCH (the boss did not come, owner 06.11): its own fresh
// pool «week-r-id» for days 5–7 — never «5..7» (not a valid period = no shared hp), never the pool of its own day.
export function periodOf(cal, enemyId, kind) {
  if (kind === "boss") return `${cal.week}-b-${enemyId}`;
  if (cal.day >= 5) return `${cal.week}-r-${enemyId}`;
  const days = cal.days || [], td = days[cal.day - 1];
  let d = td && td.kind === "minion" && (td.play === enemyId || td.id === enemyId) ? cal.day : 0;
  if (!d) { const f = days.find((x) => x.day <= 4 && (x.play === enemyId || x.id === enemyId)); d = f ? f.day : Math.min(Math.max(1, cal.day | 0), 4); }
  return `${cal.week}-${d}-${enemyId}`;
}
export function validPeriod(p) { return typeof p === "string" && PERIOD_RE.test(p); }
export function poolHp(kind, active, override) {
  const c = POOL[kind] || POOL.minion;
  if (override > 0) return Math.round(override);
  return Math.max(c.min, Math.min(c.max, Math.round(c.perActive * active)));
}
export function killRewards(kind, rows) {   // rows: [{acc, dmg}] → [{acc, gems, share}]
  const c = POOL[kind] || POOL.minion, total = rows.reduce((s, r) => s + r.dmg, 0), n = rows.length || 1;
  return rows.filter((r) => r.dmg > 0).map((r) => {
    const share = total ? r.dmg / total : 0;
    return { acc: r.acc, share, gems: Math.max(Math.round(c.kill * POOL.killMinK), Math.min(Math.round(c.kill * POOL.killMaxK), Math.round(c.kill * n * share))) };
  });
}

// db = the Online DO (sql / one / rows / grant). All functions are synchronous.
export function ensurePool(db, period, enemy, kind, week, override) {
  let p = db.one("SELECT * FROM raid3_pool WHERE period = ?", period);
  if (p) return p;
  const active = db.one("SELECT COUNT(*) AS n FROM raid3_active WHERE week = ?", week - 1).n;
  const hp = poolHp(kind, active, override);
  db.sql.exec("INSERT INTO raid3_pool (period, enemy, kind, week, hp_max, hp, active, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    period, enemy, kind, week, hp, hp, active, nowS());
  p = db.one("SELECT * FROM raid3_pool WHERE period = ?", period); poolDayStart(db, p);   // 2.3.12 the plan of its first day starts full
  return p;
}
export function poolView(db, period, acc) {
  const p = db.one("SELECT * FROM raid3_pool WHERE period = ?", period);
  if (!p) return null;
  const top = db.rows("SELECT nick, dmg, wins FROM raid3_pdmg WHERE period = ? ORDER BY dmg DESC LIMIT ?", period, POOL.top);
  const n = db.one("SELECT COUNT(*) AS n FROM raid3_pdmg WHERE period = ?", period).n;
  const st = poolDayStart(db, p), pl = poolPlan(p.hp, p.hp_max, st);
  const v = { period, enemy: p.enemy, kind: p.kind, hp: p.hp, hpMax: p.hp_max, killed: p.hp <= 0, killedAt: p.killed_at || null, players: n, phase: pl.phase, plan: pl,
    matches: db.one("SELECT COUNT(*) AS n FROM raid3_pmatch WHERE period = ?", period).n, top: top.map((r) => ({ nick: r.nick || "—", dmg: r.dmg, wins: r.wins })) };
  if (acc && ACC_RE.test(acc)) {
    const me = db.one("SELECT dmg, wins FROM raid3_pdmg WHERE period = ? AND acc = ?", period, acc);
    const k = db.one("SELECT gems FROM raid3_pkill WHERE period = ? AND acc = ?", period, acc);
    const rank = me ? db.one("SELECT COUNT(*) AS n FROM raid3_pdmg WHERE period = ? AND dmg > ?", period, me.dmg).n + 1 : null;
    v.me = { dmg: me ? me.dmg : 0, wins: me ? me.wins : 0, rank, killGems: k ? k.gems : 0 };
  }
  return v;
}
// players: [{acc, nick, dmg, cheat}] of one finished match. Records activity; on a win takes the match damage off the pool
// (once per match), credits contributions, and on the killing blow grants the kill rewards (once per account).
// → {pool, cleanup (the pool was already at 0 before this match), killedNow, kill: {acc: gems}}
export function poolResult(db, b, override) {
  const { period, match, enemy, kind, week, won } = b;
  const fair = (b.players || []).filter((pl) => pl && typeof pl.acc === "string" && ACC_RE.test(pl.acc) && !pl.cheat && Number.isInteger(pl.dmg) && pl.dmg >= 0);
  for (const pl of fair) if (pl.dmg > 0) db.sql.exec("INSERT OR IGNORE INTO raid3_active (week, acc) VALUES (?, ?)", week, pl.acc);
  const p0 = ensurePool(db, period, enemy, kind, week, override);
  const out = { cleanup: p0.hp <= 0, killedNow: false, kill: {} };
  if (b.live) {   // 2.3.11: the damage went into the pool live (poolHit); the end only credits the win (survived / the kill)
    const first = !db.one("SELECT 1 AS x FROM raid3_phit WHERE period = ? AND match = ? AND seq = -1", period, match);
    if (first) {
      db.sql.exec("INSERT OR IGNORE INTO raid3_phit (period, match, seq, dmg, at) VALUES (?, ?, -1, 0, ?)", period, match, nowS());
      db.sql.exec("INSERT OR IGNORE INTO raid3_pmatch (period, match, dmg, took, at) VALUES (?, ?, 0, 0, ?)", period, match, nowS());
      if (won) for (const pl of fair) {
        if (pl.dmg <= 0) continue;
        if (!pl.afk && Number.isInteger(week)) db.sql.exec(`INSERT INTO raid3_wact (week, acc, wins) VALUES (?, ?, 1)
          ON CONFLICT (week, acc) DO UPDATE SET wins = wins + 1`, week, pl.acc);
        db.sql.exec("UPDATE raid3_pdmg SET wins = wins + 1 WHERE period = ? AND acc = ?", period, pl.acc);
      }
    }
    out.cleanup = !!b.cleanup;
    const kb = db.one("SELECT acc, match FROM raid3_pkb WHERE period = ?", period);
    if (kb && kb.match === match) { out.killedNow = true; for (const r of db.rows("SELECT acc, gems FROM raid3_pkill WHERE period = ?", period)) out.kill[r.acc] = r.gems; out.killer = kb.acc; }
  }
  else if (won && !db.one("SELECT 1 AS x FROM raid3_pmatch WHERE period = ? AND match = ?", period, match)) {
    const dmg = Math.min(fair.reduce((s, pl) => s + Math.min(pl.dmg, 1e7), 0), 1e8), took = Math.min(dmg, Math.max(0, p0.hp));
    db.sql.exec("INSERT INTO raid3_pmatch (period, match, dmg, took, at) VALUES (?, ?, ?, ?, ?)", period, match, dmg, took, nowS());
    db.sql.exec("UPDATE raid3_pool SET hp = hp - ? WHERE period = ?", took, period);
    for (const pl of fair) {
      if (pl.dmg <= 0) continue;
      if (!pl.afk && Number.isInteger(week)) db.sql.exec(`INSERT INTO raid3_wact (week, acc, wins) VALUES (?, ?, 1)
        ON CONFLICT (week, acc) DO UPDATE SET wins = wins + 1`, week, pl.acc);
      db.sql.exec(`INSERT INTO raid3_pdmg (period, acc, nick, dmg, wins) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT (period, acc) DO UPDATE SET dmg = dmg + excluded.dmg, wins = wins + 1, nick = excluded.nick`, period, pl.acc, String(pl.nick || "").slice(0, 16), Math.min(pl.dmg, 1e7));
    }
    const p1 = db.one("SELECT hp FROM raid3_pool WHERE period = ?", period);
    if (p0.hp > 0 && p1.hp <= 0) {
      out.killedNow = true;
      db.sql.exec("UPDATE raid3_pool SET killed_at = ?, kill_match = ? WHERE period = ?", nowS(), match, period);
      const rows = db.rows("SELECT acc, dmg FROM raid3_pdmg WHERE period = ?", period);
      for (const r of killRewards(kind, rows)) {
        if (db.one("SELECT 1 AS x FROM raid3_pkill WHERE period = ? AND acc = ?", period, r.acc)) continue;
        const prof = db.one("SELECT banned FROM profiles WHERE id = ?", r.acc);
        if (prof && prof.banned) continue;
        db.sql.exec("INSERT INTO raid3_pkill (period, acc, gems, share, at) VALUES (?, ?, ?, ?, ?)", period, r.acc, r.gems, r.share, nowS());
        db.grant(r.acc, "raid", { gems: r.gems, src: "raid3_kill", enemy, period });
        out.kill[r.acc] = r.gems;
      }
    }
  }
  else if (won) {   // the same match again (its first answer was lost): the same kill answer, nothing granted twice
    const p = db.one("SELECT kill_match FROM raid3_pool WHERE period = ?", period), pm = db.one("SELECT took, dmg FROM raid3_pmatch WHERE period = ? AND match = ?", period, match);
    out.cleanup = !!(pm && pm.took === 0 && pm.dmg > 0 && p && p.kill_match !== match);   // «зачистка» as it was the first time
    if (p && p.kill_match === match) {
      out.killedNow = true;
      for (const r of db.rows("SELECT acc, gems FROM raid3_pkill WHERE period = ?", period)) out.kill[r.acc] = r.gems;
    }
  }
  out.pool = poolView(db, period);
  return out;
}

// 2.3.11 (owner: «у матча нет своего HP — весь урон сразу в общую полосу»): a match flushes its damage every ~2 s as one batch
// of hits in the order they were judged: hits [[acc, nick, dmg], …] (dmg < 0 = a kicked cheater's damage given back). Each hit
// takes min(dmg, hp) off the pool at once and is credited to the player; the hit that brings the pool to 0 is the killing blow:
// its player gets the kill bonus (POOL[kind].kill, once per period), every contributor of the period the kill reward by share
// (as before). Idempotent per (period, match, seq): a retried batch changes nothing and gets the same answer.
// → {pool, killedNow, killer: {acc, gems} | null, kill: {acc: gems}}
export function poolHit(db, b, override) {
  const { period, match, enemy, kind, week } = b, seq = Number.isInteger(b.seq) ? b.seq : 0;
  const p0 = ensurePool(db, period, enemy, kind, week, override);
  poolDayStart(db, p0);   // 2.3.12 the day's first hit also fixes the day's start (the plan)
  const out = { killedNow: false, killer: null, kill: {} };
  const again = db.one("SELECT 1 AS x FROM raid3_phit WHERE period = ? AND match = ? AND seq = ?", period, match, seq);
  if (!again) {
    const hits = (Array.isArray(b.hits) ? b.hits : []).slice(0, 400).filter((h) => Array.isArray(h) && typeof h[0] === "string" && ACC_RE.test(h[0]) && Number.isInteger(h[2]) && Math.abs(h[2]) <= 1e6);
    let hp = Math.max(0, p0.hp), killer = null, sum = 0, took = 0;
    for (const h of hits) {
      const acc = h[0], nick = String(h[1] || "").slice(0, 16), d = h[2]; sum += d;
      if (d > 0) {
        const t = Math.min(d, hp); hp -= t; took += t;
        if (t > 0 && hp <= 0 && p0.hp > 0 && !killer) killer = acc;
        db.sql.exec("INSERT OR IGNORE INTO raid3_active (week, acc) VALUES (?, ?)", week, acc);
      } else if (d < 0 && p0.hp > 0 && !killer) { const back = Math.min(-d, Math.max(0, p0.hp_max - hp)); hp += back; took -= back; }
      db.sql.exec(`INSERT INTO raid3_pdmg (period, acc, nick, dmg, wins) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT (period, acc) DO UPDATE SET dmg = MAX(0, dmg + excluded.dmg), nick = CASE WHEN excluded.nick != '' THEN excluded.nick ELSE nick END`, period, acc, nick, d);
    }
    db.sql.exec("INSERT INTO raid3_phit (period, match, seq, dmg, at) VALUES (?, ?, ?, ?, ?)", period, match, seq, sum, nowS());
    db.sql.exec(`INSERT INTO raid3_pmatch (period, match, dmg, took, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (period, match) DO UPDATE SET dmg = dmg + excluded.dmg, took = took + excluded.took`, period, match, sum, took, nowS());
    db.sql.exec("UPDATE raid3_pool SET hp = ? WHERE period = ?", hp, period);
    if (killer) {
      out.killedNow = true;
      db.sql.exec("UPDATE raid3_pool SET killed_at = ?, kill_match = ? WHERE period = ?", nowS(), match, period);
      const c = POOL[kind] || POOL.minion, prof = db.one("SELECT banned FROM profiles WHERE id = ?", killer);
      if (!(prof && prof.banned)) {
        db.sql.exec("INSERT OR IGNORE INTO raid3_pkb (period, acc, match, gems, at) VALUES (?, ?, ?, ?, ?)", period, killer, match, c.kill, nowS());
        if (db.one("SELECT changes() AS n").n === 1) db.grant(killer, "raid", { gems: c.kill, src: "raid3_killblow", enemy, period });
      }
      for (const r of killRewards(kind, db.rows("SELECT acc, dmg FROM raid3_pdmg WHERE period = ?", period))) {
        if (db.one("SELECT 1 AS x FROM raid3_pkill WHERE period = ? AND acc = ?", period, r.acc)) continue;
        const pf = db.one("SELECT banned FROM profiles WHERE id = ?", r.acc);
        if (pf && pf.banned) continue;
        db.sql.exec("INSERT INTO raid3_pkill (period, acc, gems, share, at) VALUES (?, ?, ?, ?, ?)", period, r.acc, r.gems, r.share, nowS());
        db.grant(r.acc, "raid", { gems: r.gems, src: "raid3_kill", enemy, period });
        out.kill[r.acc] = r.gems;
      }
    }
  }
  const kb = db.one("SELECT acc, match, gems FROM raid3_pkb WHERE period = ?", period);
  if (kb && kb.match === match) { out.killedNow = true; out.killer = { acc: kb.acc, gems: kb.gems }; if (again) for (const r of db.rows("SELECT acc, gems FROM raid3_pkill WHERE period = ?", period)) out.kill[r.acc] = r.gems; }
  out.pool = poolView(db, period);
  return out;
}

// Boss of the week only if ALL 4 minions of the week were defeated IN THEIR OWN DAY (their day pool reached 0; owner 06.11).
// cal = raid3_rules.js calendar(t). → { minions: [{day, id, beaten: true | false | null (today, not yet / future)}], beaten (count),
// bossAppears (days 5–7 only), rematch: on days 5–7 without the boss — the enemy to fight and its period (null otherwise) }.
// Rematch enemy = the first unbeaten minion (by day) whose rematch pool is still alive; all rematch pools killed → the last
// unbeaten one (cleanup fights). A rematch kill never summons the boss. Synchronous (one DO request, no race with poolResult).
export function weekStatus(db, cal) {
  const killed = (period) => { const p = db.one("SELECT hp FROM raid3_pool WHERE period = ?", period); return !!(p && p.hp <= 0); };
  const minions = cal.days.slice(0, 4).map((d) => {
    const k = killed(`${cal.week}-${d.day}-${d.play}`);
    return { day: d.day, id: d.id, play: d.play, beaten: k ? true : d.day < cal.day ? false : null };
  });
  const beaten = minions.filter((m) => m.beaten).length, out = { minions, beaten, bossAppears: beaten === 4, rematch: null };
  if (cal.day >= 5 && !out.bossAppears) {
    const left = minions.filter((m) => !m.beaten), live = left.find((m) => !killed(`${cal.week}-r-${m.play}`)) || left[left.length - 1];
    out.rematch = { day: live.day, id: live.id, play: live.play, period: `${cal.week}-r-${live.play}` };
  }
  return out;
}

// ---------------------------------------------------------------- the weekly fund
export function fundOf(db, week) {
  const ps = db.rows("SELECT kind, hp, hp_max FROM raid3_pool WHERE week = ?", week);
  let taken = 0, kills = 0, boss = 0, g = 0;
  for (const p of ps) {
    taken += Math.max(0, p.hp_max - Math.max(0, p.hp));
    if (p.hp <= 0) { kills++; if (p.kind === "boss") boss = 1; g += FUND.kill[p.kind] || FUND.kill.minion; }
  }
  g += taken * FUND.perHp;
  return { week, gems: Math.round(Math.min(FUND.max, g)), taken, kills, boss: !!boss };
}
// eligible participants of a week with their weight and gems of a fund (banned profiles are out)
// Water-filling (owner 06.11): the fund is split by weight; whatever the cap cuts off (and the parts of excluded accounts) goes
// to the others by weight until they reach the cap too; if everybody is at the cap the rest is not paid.
// Integer gems: total paid = min(fund, n × cap) exactly (largest remainders get the last gems), nobody above the cap.
export function waterFill(total, rows, cap) {
  const out = rows.map(() => 0), T = Math.max(0, Math.min(Math.floor(total), cap * rows.length));
  let act = rows.map((r, i) => i).filter((i) => rows[i].weight > 0), rem = T;
  const real = rows.map(() => 0);
  for (;;) {
    const W = act.reduce((s, i) => s + rows[i].weight, 0);
    if (!act.length || W <= 0 || rem <= 0) break;
    const over = act.filter((i) => rem * rows[i].weight / W >= cap);
    if (!over.length) { for (const i of act) real[i] = rem * rows[i].weight / W; break; }
    for (const i of over) { real[i] = cap; rem -= cap; }
    act = act.filter((i) => !over.includes(i));
  }
  let left = T;
  for (let i = 0; i < rows.length; i++) { out[i] = Math.min(cap, Math.floor(real[i] + 1e-9)); left -= out[i]; }
  const order = rows.map((r, i) => i).filter((i) => out[i] < cap).sort((a, b) => (real[b] - Math.floor(real[b] + 1e-9)) - (real[a] - Math.floor(real[a] + 1e-9)) || rows[b].weight - rows[a].weight);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length) { const i = order[k]; if (out[i] < cap) { out[i]++; left--; } if (order.every((x) => out[x] >= cap)) break; }
  return out;
}
// participants of a week with weight and gems (banned profiles, accounts in `skip` and accounts already refused a payout are out)
export function fundShares(db, week, gems, skip) {
  const rows = db.rows(`SELECT a.acc AS acc, a.wins AS wins, COALESCE((SELECT SUM(d.dmg) FROM raid3_pdmg d JOIN raid3_pool p ON p.period = d.period
      WHERE p.week = ? AND d.acc = a.acc), 0) AS dmg FROM raid3_wact a LEFT JOIN profiles f ON f.id = a.acc
      WHERE a.week = ? AND a.wins >= 1 AND COALESCE(f.banned, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM raid3_wpay w WHERE w.week = a.week AND w.acc = a.acc AND w.why IN ('banned', 'punished'))`, week, week)
    .filter((r) => !(skip && skip[r.acc])).map((r) => ({ ...r, weight: r.dmg + FUND.winW * r.wins }));
  const total = rows.reduce((s, r) => s + r.weight, 0), g = waterFill(gems, rows, FUND.accMax);
  return rows.map((r, i) => ({ acc: r.acc, dmg: r.dmg, wins: r.wins, weight: r.weight, share: total ? r.weight / total : 0, gems: g[i] }));
}
export function fundView(db, week, acc) {
  const f = fundOf(db, week), sh = fundShares(db, week, f.gems);
  const v = { week, gems: f.gems, kills: f.kills, taken: f.taken, boss: f.boss, players: sh.length, accMax: FUND.accMax };
  if (acc && ACC_RE.test(acc)) {
    const me = sh.find((r) => r.acc === acc);
    v.me = me ? { gems: me.gems, share: Math.round(me.share * 10000) / 10000, dmg: me.dmg, wins: me.wins } : { gems: 0, share: 0, dmg: 0, wins: 0 };
    const last = db.one("SELECT gems FROM raid3_wpay WHERE week = ? AND acc = ? AND why = 'ok'", week - 1, acc);
    v.last = { week: week - 1, got: !!last, gems: last ? last.gems : 0 };
  }
  return v;
}
// weeks before `cur` with raid activity that are not paid out yet
export function fundPending(db, cur) {
  return db.rows(`SELECT DISTINCT p.week AS week FROM raid3_pool p LEFT JOIN raid3_wfund f ON f.week = p.week
    WHERE p.week < ? AND (f.week IS NULL OR f.done = 0) ORDER BY p.week LIMIT 4`, cur).map((r) => r.week);
}
// step 1 (sync): freeze the fund of the week (first call wins) → the list to pay
export function fundPlan(db, week) {
  let f = db.one("SELECT * FROM raid3_wfund WHERE week = ?", week);
  if (!f) {
    const x = fundOf(db, week), n = fundShares(db, week, x.gems).length;
    db.sql.exec("INSERT OR IGNORE INTO raid3_wfund (week, gems, taken, kills, boss, players, at) VALUES (?, ?, ?, ?, ?, ?, ?)", week, x.gems, x.taken, x.kills, x.boss ? 1 : 0, n, nowS());
    f = db.one("SELECT * FROM raid3_wfund WHERE week = ?", week);
  }
  return fundShares(db, week, f.gems).filter((r) => !db.one("SELECT 1 AS x FROM raid3_wpay WHERE week = ? AND acc = ?", week, r.acc));
}
// step 2 (sync, after the punishment check): pay once per account. punished: {acc: true}
export function fundPay(db, week, list, punished) {
  const out = {}, f = db.one("SELECT gems FROM raid3_wfund WHERE week = ?", week);
  const skip = { ...(punished || {}) };
  for (const r of list) { const prof = db.one("SELECT banned FROM profiles WHERE id = ?", r.acc); if (prof && prof.banned) skip[r.acc] = true; }
  const fin = Object.fromEntries(fundShares(db, week, f ? f.gems : 0, skip).map((x) => [x.acc, x]));   // excluded parts go to the others
  for (const r0 of list) {
    const r = fin[r0.acc] || { ...r0, gems: 0 };
    const prof = db.one("SELECT banned FROM profiles WHERE id = ?", r.acc);
    const why = prof && prof.banned ? "banned" : punished && punished[r.acc] ? "punished" : r.gems > 0 ? "ok" : "zero";
    db.sql.exec("INSERT OR IGNORE INTO raid3_wpay (week, acc, gems, share, why, at) VALUES (?, ?, ?, ?, ?, ?)", week, r.acc, why === "ok" ? r.gems : 0, r.share, why, nowS());
    if (db.one("SELECT changes() AS n").n !== 1) continue;    // already paid by a concurrent settle
    if (why === "ok") { db.grant(r.acc, "raid", { gems: r.gems, src: "raid3_week", week }); out[r.acc] = r.gems; }
  }
  db.sql.exec("UPDATE raid3_wfund SET done = 1 WHERE week = ?", week);
  return out;
}
