// season_v2.js — 2.3.14 «Премиум-сезон» (owner Arsenii 07.11): the season tier tables, VERSIONED.
//   v1 (2.2 … 2.3.13): the free track gave the big looks (lava, the season skins, «Золотое сияние», «Огненная бездна», «Корона
//      сезона» + 3 titles); the premium track gave only crystals / dark crystals / a title.
//   v2: the free track = crystals + 1 small skin + 1 small trail + 1 small title; the big looks moved to the premium track
//      (+ the premium-only looks of cosm4.js, PREMIUM_COSMETICS in online.js).
// Nothing is ever taken back: a tier claimed under v1 stays claimed and keeps what it gave (the inbox already delivered it).
// When v2 gives MORE on a tier that was claimed under v1 (a new look, more crystals) the player may claim the difference once
// ("top-up"); a tier where v2 gives less or the same is simply done. Which claims were made under v2 is kept per profile in
// the column cv = {"s": season, "f": [tiers], "p": [tiers]}; a claimed tier missing there was claimed under v1.
// Pure module (no imports): test/test_season_v2_unit.mjs.

export const SEASON_TABLE_V = 2;
const LOOKS = ["skin", "trail", "death", "frame", "title"];
const XP = (() => { const o = []; let need = 0; for (let i = 1; i <= 30; i++) { need += 2500 + 150 * i; o.push(need); } return o; })();

// ---- v1, exactly as served until 2.3.13 (only used to work out what an old claim already gave)
export const SEASON_TIERS_V1 = XP.map((xp, k) => {
  const i = k + 1, skins = { 5: "lava", 10: "season_frost", 15: "season_neon", 20: "season_aurora", 25: "season_void", 30: "season_crown" };
  const r = skins[i] ? { skin: skins[i], gems: 500 * Math.ceil(i / 5) } : { gems: 150 + 60 * i };
  if (i % 10 === 0) r.title = "season_t" + i;
  return { tier: i, xp, reward: r };
});
export const PREMIUM_TIERS_V1 = XP.map((xp, k) => {
  const i = k + 1, r = { gems: 100 + 50 * i };
  if (i % 3 === 0) r.dark = 30 + 5 * i;
  if (i % 5 === 0) r.gems += 400 * (i / 5);
  if (i === 30) r.title = "season_p30";
  return { tier: i, xp, reward: r };
});

// ---- v2 (game copies: season22.js FREE_LOOKS / pass3.js PBIG — test_season_v2_unit.mjs checks they match)
export const FREE_LOOKS = { 12: { skin: "mint" }, 24: { trail: "t_confetti" }, 30: { title: "season_f30" } };
export const PREMIUM_BIG = { 5: { skin: "lava" }, 10: { skin: "season_frost" }, 15: { skin: "season_neon", title: "season_p15" }, 20: { skin: "season_aurora" }, 25: { skin: "season_void" }, 30: { skin: "season_crown" } };
export function buildFree() {
  return XP.map((xp, k) => {
    const i = k + 1, r = { gems: 150 + 60 * i + (i % 5 === 0 ? 250 : 0) };
    if (FREE_LOOKS[i]) Object.assign(r, FREE_LOOKS[i]);
    return { tier: i, xp, reward: r };
  });
}
export function buildPremium(looks) {   // looks = online.js PREMIUM_COSMETICS (cosm4.js premium-only items)
  return PREMIUM_TIERS_V1.map(({ tier, xp, reward }) => ({ tier, xp, reward: { ...reward, ...(looks && looks[tier]), ...PREMIUM_BIG[tier] } }));
}

// what v2 gives on top of what v1 already gave on the same tier (null = nothing more)
export function rewardDelta(oldR, newR) {
  const d = {};
  for (const k of ["gems", "dark"]) { const x = ((newR && newR[k]) || 0) - ((oldR && oldR[k]) || 0); if (x > 0) d[k] = x; }
  for (const k of LOOKS) if (newR && newR[k] && (!oldR || oldR[k] !== newR[k])) d[k] = newR[k];
  return Object.keys(d).length ? d : null;
}
export function cvRead(raw, season) {
  let o = null; try { o = JSON.parse(raw || "null"); } catch { o = null; }
  if (!o || typeof o !== "object" || o.s !== season) o = { s: season, f: [], p: [] };
  if (!Array.isArray(o.f)) o.f = [];
  if (!Array.isArray(o.p)) o.p = [];
  return o;
}
export function listRead(raw) { let a = []; try { a = JSON.parse(raw || "[]"); } catch { a = []; } return Array.isArray(a) ? a : []; }
// one tier of one track: "open" (never claimed) | "done" | "topup" (claimed under v1, v2 gives more: d = the difference)
export function tierState(track, tier, claimed, cv, now, v1) {
  if (!claimed.includes(tier)) return { st: "open" };
  if ((track === "prem" ? cv.p : cv.f).includes(tier)) return { st: "done" };
  const o = v1.find((t) => t.tier === tier), n = now.find((t) => t.tier === tier);
  const d = o && n ? rewardDelta(o.reward, n.reward) : null;
  return d ? { st: "topup", d } : { st: "done" };
}
// for /profile/me: the tiers shown as taken (a pending top-up is NOT taken, so any client shows «Забрать») + the top-ups
export function claimView(track, claimed, cv, now, v1) {
  const done = [], topup = [];
  for (const t of claimed) (tierState(track, t, claimed, cv, now, v1).st === "topup" ? topup : done).push(t);
  return { done, topup };
}
