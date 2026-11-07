// raid3_rules.js — «Душа Врат» weekly online raid: calendar, enemies, attack director, judge.
// Pure module (no I/O) shared by raid3.js (Durable Objects) and the tests. The CLIENT never decides anything:
// it only renders what the server announces and sends its own button presses with timestamps.
//
import { TITAN_ADDS } from "./raid3_titan_adds.js";
import { HYDRA_PAT } from "./raid3_hydra_rules.js";
import { VOID_PAT } from "./raid3_void_rules.js";
import { HEART_PAT } from "./raid3_heart_rules.js";
import { MECH_TH } from "./raid3_mech_th.js";
import { MECH_HY } from "./raid3_mech_hy.js";
import { MECH_VH } from "./raid3_mech_vh.js";
import { addActs } from "./raid3_acts.js";
//
// Calendar (owner, 05.11): week N = one boss, picked at random from the 4 (bossOfWeek below, never twice in a row);
// days 1–4 = one minion of that boss per day, days 5–7 = the boss itself. Days are UTC.
//
// Physics (identical in src/raid3_fight.js): the ball runs at a fixed speed on 3 lanes, L/R = change lane, U = jump, D = slide
// (in the air D = fast fall into a slide). The server rebuilds every player's state from the timestamped presses and judges each
// attack / strike orb at its exact time with the same rules for everybody. Damage exists only as collected strike orbs.

export const DAY = 86400, WEEK = 7 * DAY;
export const RAID3_EPOCH = Date.UTC(2026, 10, 2) / 1000;   // Monday 2026-11-02 00:00 UTC — week 1 = Кристальный Титан

export const PHYS = {
  speed: 16,          // m/s, constant for everybody (no boosts, no shop power, no donate power)
  laneDelay: 0.05,    // s after a press the ball counts as being in the new lane
  jumpT: 0.66,        // s in the air
  jumpH: 2.3,         // m (visual)
  airPad: 0.07,       // the first / last 0.07 s of a jump are still "low"
  slideT: 0.62,       // s
  slidePad: 0.04,
  fastFall: 0.12,     // s from D in the air to touching the ground
  altDelay: 0.12,     // 2.5 the glider: s after U / D the glider counts as being at the new height
};

export const RULES = {
  maxPlayers: 6,
  lobbySec: 20,
  countdownSec: 3,
  hearts: 3,
  invulSec: 1.5,                     // 2.3.11 (owner): a hit = −1 heart, then 1.5 s of blinking invulnerability
  downSec: 5,                        // «Без сил» 5 s, then back with all hearts
  upInvulSec: 1.5,
  orbDmg: 100,                       // per ◆ (an enemy may have its own: ENEMIES[id].orbDmg — the 2.3.11 Titan)
  comboStep: 0.1, comboMax: 10,      // ×1.0 … ×2.0 for a streak of orbs without being hit
  // 2.3.11 «Удар»: every 3 judged ◆ = one charge (max 2, server-side); press S (swipe ↑ with a charge) = a strong strike:
  // orbDmg × k × combo, × openK inside the boss's «открыт» window after an attack. The S press is also a jump for the body.
  strike: { every: 3, k: 3, openK: 1.5, max: 2 },
  judgeMaxLag: 1.2,                  // s: an event is judged at the latest this long after its time
  lagSlack: 0.35,                    // s: how far back a press may be dated (on top of rtt/2)
  futureSlack: 0.35,                 // s: how far ahead of the server clock a press may be dated
  rttMax: 0.6,                       // s: a player can't buy more back-dating by answering pings slowly
  pressMaxPerSec: 10,                // presses (a human does ≤ 6–7 / s)
  msgMaxPerSec: 30, msgKickPerSec: 80,
  susKick: 8, susDecayPer5s: 0.5,
  accPerIpPerMatch: 3,
  reward: { minion: 120, boss: 300 }, rewardMinK: 0.35, rewardMaxK: 2.5,
  minShareOfAvg: 0.08, minOnline: 0.4, afkPressEverySec: 5,   // fewer presses than 1 per 5 s of fight = afk, no reward
  dailyCap: { minion: 5, boss: 3 },  // rewarded wins per account per UTC day (checked in the Online DO)
};

// ---------------------------------------------------------------- content
export const BOSSES = [
  { id: "titan", name: "Кристальный Титан", en: "Crystal Titan", minions: ["golem", "hound", "weaver", "warden"] },
  { id: "hydra", name: "Гидра Разлома", en: "Rift Hydra", minions: ["spawn", "eel", "spitter", "coil"] },
  { id: "voidknight", name: "Рыцарь Пустоты", en: "Void Knight", minions: ["squire", "lancer", "shade", "herald"] },
  { id: "heart", name: "Сердце Разлома", en: "Heart of the Rift", minions: ["pulse", "vein", "echo", "keeper"] },
];
// hp = per player at the start of the match; limit = s. 2.3.11 orbDmg = per ◆ of this enemy (tuned with strikes: a good 6-team ≈ 2–2.5 min on a boss, ≈ 70 s on a minion). ready = playable now (stage 1: golem + titan); the rest play a ready
// stand-in of the same kind until their own patterns + models arrive (stage 2).
export const ENEMIES = {
  golem:    { kind: "minion", boss: "titan", name: "Осколочный голем", en: "Shard Golem", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  hound:    { kind: "minion", boss: "titan", name: "Кварцевая гончая", en: "Quartz Hound", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  weaver:   { kind: "minion", boss: "titan", name: "Призменный ткач", en: "Prism Weaver", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  warden:   { kind: "minion", boss: "titan", name: "Страж Резонанса", en: "Resonance Warden", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  // 2.3.11 the Titan is a fight: own orb damage (every ◆ = a bolt) + «Удар» strikes (strike: true) + open windows
  titan:    { kind: "boss", boss: "titan", name: "Кристальный Титан", en: "Crystal Titan", hp: 9000, limit: 150, ready: true, orbDmg: 45, strike: true },
  spawn:    { kind: "minion", boss: "hydra", name: "Отродье Разлома", en: "Rift Spawn", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  eel:      { kind: "minion", boss: "hydra", name: "Разломный угорь", en: "Rift Eel", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  spitter:  { kind: "minion", boss: "hydra", name: "Кислотный плевун", en: "Acid Spitter", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  coil:     { kind: "minion", boss: "hydra", name: "Кольцо Гидры", en: "Hydra Coil", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  hydra:    { kind: "boss", boss: "hydra", name: "Гидра Разлома", en: "Rift Hydra", hp: 9500, limit: 150, ready: true, orbDmg: 58 },
  squire:   { kind: "minion", boss: "voidknight", name: "Оруженосец Пустоты", en: "Void Squire", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  lancer:   { kind: "minion", boss: "voidknight", name: "Копейщик тьмы", en: "Dark Lancer", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  shade:    { kind: "minion", boss: "voidknight", name: "Тень клинка", en: "Blade Shade", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  herald:   { kind: "minion", boss: "voidknight", name: "Глашатай Пустоты", en: "Void Herald", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  voidknight: { kind: "boss", boss: "voidknight", name: "Рыцарь Пустоты", en: "Void Knight", hp: 10000, limit: 150, ready: true, orbDmg: 58 },
  pulse:    { kind: "minion", boss: "heart", name: "Пульс Разлома", en: "Rift Pulse", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  vein:     { kind: "minion", boss: "heart", name: "Жила Разлома", en: "Rift Vein", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  echo:     { kind: "minion", boss: "heart", name: "Эхо Врат", en: "Gate Echo", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  keeper:   { kind: "minion", boss: "heart", name: "Хранитель Сердца", en: "Heart Keeper", hp: 3600, limit: 150, ready: true, orbDmg: 40 },
  heart:    { kind: "boss", boss: "heart", name: "Сердце Разлома", en: "Heart of the Rift", hp: 11000, limit: 150, ready: true, orbDmg: 62 },
};
export function playableOf(id) {
  const e = ENEMIES[id];
  if (!e) return "golem";
  if (e.ready) return id;
  return e.kind === "boss" ? "titan" : "golem";
}

// Boss of the week (owner, 05.11): NOT a rotation — a deterministic random pick from the 4 bosses by the week number
// (FNV-1a of a constant salt + week; the salt is in the code, not a secret, so the client's offline calendar in
// src/raid3_ui.js computes the same and nobody can "re-roll"). Never the same boss two weeks in a row: week w picks one of
// the 3 bosses other than week w-1's. Week 1 (the launch week, 02.11.2026) stays the Crystal Titan.
export const BOSS_SALT = "dusha-vrat:raid3:boss-of-week:v1";
export function hash32(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const _bossW = [0];
export function bossIndexOfWeek(week) {
  const w = Math.max(1, Math.min(200000, Math.floor(week) || 1));
  while (_bossW.length < w) {
    const k = _bossW.length + 1, prev = _bossW[k - 2], opts = [0, 1, 2, 3].filter((x) => x !== prev);
    _bossW.push(opts[hash32(BOSS_SALT + ":" + k) % 3]);
  }
  return _bossW[w - 1];
}
export function bossOfWeek(week) { return BOSSES[bossIndexOfWeek(week)]; }

export function calendar(t = Math.floor(Date.now() / 1000)) {
  const s = Math.max(0, t - RAID3_EPOCH);
  const week = Math.floor(s / WEEK) + 1;
  const day = Math.floor((s % WEEK) / DAY) + 1;                // 1..7
  const boss = bossOfWeek(week);
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const id = d <= 4 ? boss.minions[d - 1] : boss.id, e = ENEMIES[id];
    return { day: d, id, name: e.name, en: e.en, kind: e.kind, ready: !!e.ready, play: playableOf(id) };
  });
  const today = days[day - 1];
  const weekStart = RAID3_EPOCH + (week - 1) * WEEK;
  return {
    week, day, boss: { id: boss.id, name: boss.name, en: boss.en }, today, days,
    dayKey: new Date(t * 1000).toISOString().slice(0, 10),
    dayEnds: weekStart + day * DAY, weekEnds: weekStart + WEEK,
  };
}

// ---------------------------------------------------------------- deterministic rng (same as src/core.js mulberry)
export function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- attack director
// Atomic event kinds (what the judge looks at):
//   spike {lanes}: tall crystal in those lanes — be in another lane (jumping does not help)
//   wave         : low shock across all lanes — be high in a jump
//   beam {lanes} : chest-high beam — slide (or be in another lane)
//   orb {lane,hi}: strike orb — be in that lane; hi = only in the air, low = on the ground and not sliding
//   pit {lanes}  : a hole in the road in those lanes — be in another lane or high in a jump (weeks 3–4)
//   warp {map}   : never hurts; moves the ball: whoever is in lane L at t is now in lane map[L] (portals of the Void Knight,
//                  the pull of the Heart). Applied by the server to the body (warpBody) and by the client the same way.
// v = visual name for the client (fist, meteor, shard, ...). Every pattern leaves a way through and puts its orbs on that way
// («атаки в связках»: the dodge and the hit are one move). Lane changes required inside a pattern are ≥ 0.45 s apart.
const L3 = [0, 1, 2];
function others(l) { return L3.filter((x) => x !== l); }

const PAT = {
  golem: {
    phases: [0.5],                // phase 2 at ≤ 50 % hp
    list: [
      { id: "volley", w: [3, 2], f(r, p) { const f = lane(r); return [1.9, [sp(others(f), 1.0, "shard"), orb(f, 1.0)]]; } },
      { id: "slam", w: [2, 2], f(r) { return [1.8, [wave(1.0, "quake"), orb(lane(r), 1.0, true)]]; } },
      { id: "roll", w: [2, 2], f(r, p) {
        const dir = r() < 0.5 ? [0, 1, 2] : [2, 1, 0], k = 0.48;
        return [1.0 + 3 * k + 0.6, [sp([dir[0]], 0.9, "boulder"), sp([dir[1]], 0.9 + k, "boulder"), sp([dir[2]], 0.9 + 2 * k, "boulder"), orb(dir[0], 0.9 + 2 * k)]];
      } },
      { id: "combo", w: [1, 3], f(r) { const f = lane(r); return [2.5, [sp(others(f), 0.9, "shard"), orb(f, 0.9), wave(1.75, "quake"), orb(f, 1.75, true)]]; } },
      { id: "crush", w: [0, 2], f(r) { const a = lane(r), f = pick(r, others(a)); return [1.9, [sp([a], 0.95, "fist"), wave(0.95, "quake"), orb(f, 0.95, true)]]; } },
      { id: "core", w: [1, 1], f(r) { let l = lane(r); const ev = []; for (let i = 0; i < 4; i++) { ev.push(orb(l, 0.7 + i * 0.8, i === 3)); l = pick(r, others(l)); } return [3.6, ev]; } },
    ],
  },
  // 2.3.11 (owner: «мы с боссом сражаемся, а не километры проходить»; «у боссов свои атаки, без беговых препятствий»): the Titan
  // stands close and every attack is made by his own body and lands on the ROW of the players (the client draws it there, not as
  // obstacles coming down the road). Four attacks, each telegraphed by round marks on the struck lanes ~1 s before, each with a
  // free lane or a jump; after each one the boss is «открыт» for ~1.5 s (open window: strikes ×1.5) and drops more ◆.
  //   slam  «Кулак»          his fist hits a lane (lane), then the shock rings run across the road (jump)
  //   rain  «Кристальный дождь»  shards fall on two lanes (the third is free), a second volley moves the free lane
  //   sweep «Взгляд»          the visor beam burns across the road lane by lane at the ground (jump as it reaches you)
  //   swipe «Взмах»           a crystal palm sweeps in low from the side over two lanes (the far lane, or jump)
  // Orbs only on the ground (never in the air), on the free lane / after landing. The chase on the bike stays (phase entries).
  titan: {
    phases: [0.6, 0.25],
    enter: { 1: "chase", 2: "chase" },   // 2.5: every new phase opens with the chase on the crystal bike
    open: 1.5,                           // 2.3.11: the «открыт» window after every attack pattern (s)
    list: [
      { id: "slam", w: [3, 3, 3], f(r, p) {
        const a = lane(r), f = pick(r, others(a)), ev = [sp([a], 1.3, "slam"), orb(f, 1.3)];
        if (!p) { ev.push(wave(1.95, "slamw")); return openAfter(r, ev, 1.95, f); }
        // phase 2+: the other fist comes down where you dodged to, then the rings
        const g = pick(r, others(f));
        ev.push(sp([f], 2.2, "slam"), orb(g, 2.2), wave(2.85, "slamw"));
        return openAfter(r, ev, 2.85, g);
      } },
      { id: "rain", w: [2, 3, 3], f(r, p) {
        const a = lane(r), b = pick(r, others(a)), f = L3.find((x) => x !== a && x !== b), ev = [sp([a, b], 1.3, "rain"), orb(f, 1.3)];
        const x = pick(r, [a, b]), y = x === a ? b : a;         // volley 2 falls on the free lane + one more: the third is free
        ev.push(sp([f, x], 2.15, "rain"), orb(y, 2.15));
        if (!p) return openAfter(r, ev, 2.15, y);
        const z = pick(r, others(y)), w = L3.find((q) => q !== y && q !== z);
        ev.push(sp([y, z], 3.0, "rain"), orb(w, 3.0));
        return openAfter(r, ev, 3.0, w);
      } },
      { id: "sweep", w: [2, 2, 2], f(r, p) {
        const dir = r() < 0.5 ? [0, 1, 2] : [2, 1, 0], t0 = 1.4, k = 0.28, ev = [];
        dir.forEach((l, i) => ev.push(pit([l], t0 + i * k, "sweep")));
        if (!p) return openAfter(r, ev, t0 + 2 * k, dir[0]);
        const t1 = t0 + 2 * k + 0.6; ev.push(orb(dir[0], t1));
        const t2 = t1 + 0.45;                                 // phase 2+: the beam comes back the other way
        [dir[2], dir[1], dir[0]].forEach((l, i) => ev.push(pit([l], t2 + i * k, "sweep")));
        return openAfter(r, ev, t2 + 2 * k, dir[2]);
      } },
      { id: "swipe", w: [2, 2, 2], f(r, p) {
        const s = r() < 0.5 ? 0 : 2, far = 2 - s, ev = [pit([s], 1.35, "swipe"), pit([1], 1.55, "swipe"), orb(far, 1.35)];
        if (!p) return openAfter(r, ev, 1.55, far);
        ev.push(pit([far], 2.45, "swipe"), pit([1], 2.65, "swipe"), orb(s, 2.45));   // the backhand from the other side
        return openAfter(r, ev, 2.65, s);
      } },
      // 2.5 «Погоня»: the phase entry — the ball becomes a crystal bike, the Titan runs and throws the cavern at you:
      // gates of pylons (the free lane), ramps over a crevasse (jump), a thrown blade (slide), a rolling boulder (lane)
      { id: "chase", w: [0, 0, 0], f(r, p) { return chase(r, p, ["ch_gate", "ch_ramp", "ch_sweep", "ch_boulder"], "bike", null, null, true); } },
    ],
  },
};
// a phase of movement (bike / glider): one mode event (the judge ignores it: the same lanes, jump and slide apply, so it is as
// fair as the run), then a run of obstacles 1.25–1.4 s apart, every one with its orb on the way through. v = [lane-block, low
// (jump), high (slide), lane-one]; warp = true adds gusts (a warp of one lane) instead of the lane-one obstacle every other time
export function modeEv(t, m, v) { return { k: "mode", t, until: t, mode: m, v, lanes: [] }; }
export function chase(r, p, v, m, mv, wind, low) {   // low (2.3.11 Titan): the orb of a jump obstacle waits on the ground after the landing
  const ev = [modeEv(0.3, m, mv || m)], n = p >= 2 ? 7 : 6, gap = p >= 2 ? 1.25 : 1.4; let t = 2.4;
  for (let i = 0; i < n; i++) {
    let k = i === 0 ? 0 : Math.floor(r() * 4) % 4;
    if (k === 3 && wind && i % 2) k = 4;
    if (k === 0) { const f = lane(r); ev.push(sp(others(f), t, v[0]), orb(f, t)); }
    else if (k === 1) ev.push(wave(t, v[1]), low ? orb(lane(r), t + 0.55) : orb(lane(r), t, true));
    else if (k === 2) ev.push(beam(L3, t, v[2]), orb(lane(r), t + 0.75));
    else if (k === 3) { const a = lane(r); ev.push(sp([a], t, v[3]), orb(pick(r, others(a)), t)); }
    else { const map = r() < 0.5 ? [1, 2, 2] : [0, 0, 1]; ev.push({ k: "warp", t, map, v: wind }, orb(map[1], t + 0.65)); }
    t += gap;
  }
  ev[0].until = t + 0.2;
  return [t + 0.6, ev];
}
// days 2–4 of the Titan week: their own patterns (raid3_titan_adds.js)
Object.assign(PAT, TITAN_ADDS);
// week 2: the Rift Hydra and her minions (raid3_hydra_rules.js)
Object.assign(PAT, HYDRA_PAT);
// weeks 3–4: the Void Knight, the Heart of the Rift and their minions (raid3_void_rules.js / raid3_heart_rules.js)
Object.assign(PAT, VOID_PAT, HEART_PAT);
// 2.3.11 «переделка»: every enemy its own mechanic (raid3_mech_*.js) — the Titan week
for (const id of ["golem", "hound", "weaver", "warden"]) PAT[id] = MECH_TH[id];
PAT.titan.enter = { 1: "chase", 2: "shatter" }; PAT.titan.enterSeq = true;   // «Погоня!» then «Обвал!» (each ~22 s, by hp or at 45 s / 100 s)
PAT.titan.list = PAT.titan.list.filter((x) => x.id !== "chase").concat([
  { id: "chase", w: [0, 0, 0], f: MECH_TH.titanExtra.chaseLong },
  { id: "shatter", w: [0, 0, 0], f: MECH_TH.titanExtra.shatter },
]);
// the Hydra week (raid3_mech_hy.js): the deck 3×3, the glowing main spawn, under water, acid puddles, the spiral with gravity
for (const id of ["hydra", "spawn", "eel", "spitter", "coil"]) PAT[id] = MECH_HY[id];
// the Void Knight's and the Heart's weeks (raid3_mech_vh.js): the steed duel, boomerangs, the joust, darkness, the mirror;
// zero-g pulses, vanishing lanes, the vein ring, the echo, the sky walls
for (const id of Object.keys(MECH_VH)) PAT[id] = MECH_VH[id];
// 2.3.12 the interactions of every enemy and its phases (raid3_acts.js): cannons, grabs, barrels, harpoons, co-op marks, …
addActs(PAT);
function lane(r) { return Math.floor(r() * 3) % 3; }
function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
function sp(lanes, t, v) { return { k: "spike", lanes: [...lanes].sort(), t, v }; }
function wave(t, v) { return { k: "wave", t, v }; }
function beam(lanes, t, v) { return { k: "beam", lanes: [...lanes].sort(), t, v }; }
function orb(l, t, hi) { return { k: "orb", lane: l, t, hi: !!hi, v: "orb" }; }
function pit(lanes, t, v) { return { k: "pit", lanes: [...lanes].sort(), t, v }; }
// 2.3.11 the end of an attack: the boss is «открыт» (open window, strikes ×openK) and sheds two ◆ on the ground, the first one
// a lane away from where the attack left you, the second another lane further (≥ 0.6 s apart); returns [len, ev, {open}]
function openAfter(r, ev, h, from) {
  const op = PAT.titan.open || 1.5, a = h + 0.2, l1 = pick(r, others(from)), l2 = pick(r, others(l1));
  ev.push(orb(l1, h + 0.75), orb(l2, h + 1.35), orb(lane(r), 0.55));   // + one ◆ before the wind-up (≥ 0.7 s to leave its lane)
  return [a + op + 0.1, ev, { open: [a, a + op] }];
}

export const TIME_MARKS = [45, 100];
// 2.3.11 (owner: the same fight for every boss and minion): after each attack of the other enemies (not a ride / flight) the
// enemy is «открыт» for OPEN_S (strikes ×openK) and sheds two ◆ on the ground; an orb «in the air» outside a glider flight
// waits on the ground after the landing instead (dropped where that would put it into a hazard). Returns {open, len} or null.
const OPEN_S = 1.5;
function groundFight(r, evs, pat) {
  if (evs.some((e) => e.k === "mode")) return null;                    // a ride / a flight / zero-g: its own rules
  const hz = evs.filter((e) => e.k !== "orb" && e.k !== "warp");
  const hurts = (l, t) => hz.some((e) => Math.abs(e.t - t) < 0.3 && (e.k === "wave" || (e.lanes || []).includes(l)));
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]; if (e.k !== "orb" || !e.hi || e.x) continue;   // (a prism ◆ of the Weaver stays up: it is the jump)
    const t2 = e.t + 0.5; e.hi = false;
    // never into a hazard, never a hair away from another moment (a human needs ≥ 0.15 s between two instants)
    if (hurts(e.lane, t2) || evs.some((q) => q !== e && Math.abs(q.t - t2) < 0.3 && (q.k !== "orb" || q.lane !== e.lane) && Math.abs(q.t - t2) > 0.001)) evs.splice(i, 1); else e.t = t2;
  }
  if (!hz.length || pat.autoOpen === false) return null;
  const h = Math.max(...hz.map((e) => e.t)), a = h + 0.2, last = evs.filter((e) => e.k === "orb").reduce((m, e) => Math.max(m, e.t), 0);
  const ob = evs.filter((e) => e.k === "orb" && e.t > h - 0.6).sort((x, y) => x.t - y.t), lastL = ob.length ? ob[ob.length - 1].lane : 1;
  let l1 = pick(r, others(lastL)); const t1 = Math.max(h + 0.75, last + 0.6);
  if (t1 < a + OPEN_S - 0.2) { evs.push(orb(l1, t1)); const t2 = t1 + 0.6; if (t2 < a + OPEN_S) evs.push(orb(pick(r, others(l1)), t2)); }
  return { open: [a, a + OPEN_S], len: a + OPEN_S + 0.1 };
}   // 2.3.11: s of fight time — a boss's phases 2 and 3 at the latest
// The director produces events in time order, a little ahead of the clock; the phase (by hp) is read when a pattern starts,
// so everybody in the match gets the same events from the same seed and the same shared hp.
// 2.3.12 (owner 07.11): the phase of a match is the phase of the enemy's SHARED POOL when the match begins (raid3_pool.js
// poolPhase: 100–66 % / 66–33 % / 33–0 %) and the whole match plays in it — no switching by time (45 s / 100 s) or by the
// match's own hp any more. Phase 1 = the base fight; phase 2 = the enemy's vehicle / special for the WHOLE match (the Titan's
// bike chase, the Hydra's storm, the Knight's gallop, the Heart's arrhythmia); phase 3 = its finale (the Titan's «Обвал», all
// heads, the void blades, the arrest). A whole-match mode keeps ONE mode window to the end of the fight (until = limit + 1).
// Minions (2 weight sets before): phase 2 = their second set, phase 3 = the same with their special doubled, a little quicker.
export function phaseWeights(it, p) {
  const w = it.w || [];
  if (w[p] != null) return w[p];
  const w1 = w[1] != null ? w[1] : w[0] || 0;
  return p >= 2 && !(w[0] > 0) && w1 > 0 ? w1 * 2 : w1;   // the special of a minion (0 in phase 1) is its finale
}
export class Director {
  constructor(seed, enemyId, opts) {
    opts = opts || {};
    this.fixed = Math.max(0, Math.min(2, Number.isInteger(opts.phase) ? opts.phase : 0));   // 2.3.12: one phase for the whole match
    this.limit = opts.limit > 0 ? opts.limit : 150;
    this.acts = opts.acts === true;   // 2.3.12 release: the interactions (raid3_acts.js: cannons, grabs, barrels…) are unfinished — OFF unless asked
    this.r = mulberry(seed >>> 0 || 1);
    this.enemy = playableOf(enemyId);
    this.pat = PAT[this.enemy];
    this.next = 2.2;          // first pattern bar (s of fight time)
    this.n = 0;               // event ids
    this.last = null; this.bag = [];
    this.beats = []; this.tgts = []; this.modes = [];   // 2.3.11 (see advance)
    this.wins = [];           // 2.3.11 «открыт» windows [from, until] (fight time), in order; raid3.js announces and uses them
    // hpOnly: tests of the hp phases. 2.3.11 timed fights on a shared pool: the phases come by time (a minion: one at 60 s)
    this.marks = [];          // 2.3.12: no time marks (the pool decides the phase)
    if (this.pat.init) this.pat.init(this, seed >>> 0 || 1);   // e.g. the hydra: which head falls first (by seed)
  }
  phaseOf() { return this.fixed; }
  // 2.3.11 (owner: «у Титана на середине нету байка»): a boss's phase — and with it the vehicle phase that opens it (bike /
  // glider / steed / zero-g) — comes at the hp threshold OR at a time mark of the fight, whichever is first (45 s, 100 s), so
  // every boss fight has its rides even when the damage is low. Deterministic: the same for everybody in the match.
  phaseAt() { return this.fixed; }   // (hp / time arguments kept for the callers; 2.3.12: the phase is fixed per match)
  choose(p) {
    if (!this.bag.length) {
      const items = [];
      for (const it of this.pat.list) { if (it.act && !this.acts) continue; for (let i = 0; i < phaseWeights(it, p); i++) items.push(it); }
      for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(this.r() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
      this.bag = items;
    }
    let it = this.bag.pop();
    if (this.last && it.id === this.last && this.bag.length) { const o = this.bag.pop(); this.bag.unshift(it); it = o; }
    this.last = it.id;
    return it;
  }
  // events with t < until (fight time); `now` = current fight time (announce time)
  advance(until, hpFrac, now) {
    const out = [];
    while (this.next < until) {
      const p = this.phaseAt(hpFrac, this.next);
      // a phase may open with its own pattern (pat.enter[p] = pattern id; e.g. the chase of the Titan, the flight of the Hydra)
      // 2.3.11: the entries are played in their order (a low shared pool = phase 2 at once: still the chase first), one at a time,
      // ≥ 20 s of the fight apart — so every fight has each of its rides / special phases
      // 2.3.12: phase 2 / 3 of an enemy with its own vehicle / special (pat.enter[p]) = that pattern again and again, the whole match
      const whole = p >= 1 && this.pat.enter && this.pat.enter[p] ? this.pat.list.find((x) => x.id === this.pat.enter[p]) : null; let ek = 0;
      // 2.3.11 pat.first: the fight opens with it (the Hydra's deck, the Heart's zero-g, …: a whole-fight way of moving)
      const fst = this.pat.first && !this.firstDone ? (this.firstDone = 1, this.pat.list.find((x) => x.id === this.pat.first)) : null;
      const it = fst || whole || this.choose(p);
      let [len, evs, ex] = it.f(this.r, p, this);
      const sp0 = this.pat.speed, speed = sp0 ? (sp0[p] != null ? sp0[p] : sp0[sp0.length - 1]) : p >= 2 ? 0.86 : p ? 0.92 : 1;   // later phases breathe less (an own list: its last entry, e.g. the Warden's beat stays)
      let L = len;
      if (!(ex && ex.open) && this.pat !== PAT.titan) { const g = groundFight(this.r, evs, this.pat); if (g) { ex = Object.assign({}, ex, { open: g.open }); L = Math.max(len, g.len); } }
      if (it === whole && !fst) {   // one mode window for the whole match: the first one lasts to the end, the later ones are dropped
        const mm = evs.filter((e) => e.k === "mode" && e.mode !== "end");
        if (!this.wholeMode && mm.length) { this.wholeMode = mm[0].mode; mm[0].until = (this.limit + 1 - this.next) / speed; mm[0].whole = 1; }
        else if (this.wholeMode) evs = evs.filter((e) => !(e.k === "mode" && (e.mode === this.wholeMode || e.mode === "end")));
      }
      if (ex && ex.open) this.wins.push([round2(this.next + ex.open[0] * speed), round2(this.next + ex.open[1] * speed)]);
      // 2.3.11 a pattern may also bring beats (the Warden's rhythm: strikes ×2) and targets [from, until, lane] (the Spawn's main one)
      if (ex && ex.beats) for (const x of ex.beats) this.beats.push(round2(this.next + x * speed));
      if (ex && ex.tgts) for (const x of ex.tgts) this.tgts.push([round2(this.next + x[0] * speed), round2(this.next + x[1] * speed), x[2]]);
      for (const e of evs) {
        e.t = round2(this.next + e.t * speed);
        if (e.until != null) e.until = round2(this.next + e.until * speed);   // mode events: the end of the phase of movement
        e.at = round2(Math.max(now, e.t - 2.2));
        e.id = ++this.n; e.p = it.id; e.ph = p;
        if (e.k === "mode") this.modes.push(e);
        out.push(e);
      }
      void ek;
      this.next = round2(this.next + L * speed + 0.25);
    }
    out.sort((a, b) => a.t - b.t || a.id - b.id);
    return out;
  }
}
function round2(x) { return Math.round(x * 100) / 100; }

// ---------------------------------------------------------------- player state from presses
// presses: [{ft, a}] sorted by ft (a = 'L' | 'R' | 'U' | 'D'); base = state before the first press.
export function newBody() { return { lane: 1, laneAt: -9, airFrom: -9, airUntil: -9, slideFrom: -9, slideUntil: -9 }; }
// 2.3.11 «переделка»: each enemy's own way of moving. A mode event opens a window on the body (closed by {mode:"end"}):
//   glider / grid   U / D = one height / row up / down and it stays (grid: an instant step, 0.05 s) — lane × alt = a 3×3 cell
//   ring            the inside of a vein: 6 positions around the tube, L / R turn around it (wraps); lane = the position 0..5
//   mirror          L / R are swapped (the Herald's mirror)
//   duel            the steed duel: L / R / U / D are parries only (the body stays in its lane on the ground)
//   water           under water: a jump floats for WATER_JUMP s, no slide
// b.ll = the lane log [[t, lane], …] (last ~8 s: the Echo / the mirror hit where you were), b.pl = the last presses [[t, a], …]
// (parries). Arrays are replaced, never pushed (the server copies bodies with {...b}).
export const WATER_JUMP = 1.15, GRID_DELAY = 0.05, RING_N = 6;
const RING_IN = [5, 0, 1], RING_OUT = [1, 2, 2, 1, 0, 0];
const inW = (w, t) => !!w && t >= w[0] && t <= w[1];
function logLane(b, t, l) { const ll = (b.ll || []).filter((x) => x[0] > t - 8); ll.push([t, l]); b.ll = ll; }
export function laneAtT(b, t) {   // the lane at an earlier moment t (the lane log; before the log: the first known lane)
  const ll = b.ll || []; let l = null;
  for (const x of ll) { if (x[0] <= t) l = x[1]; else break; }
  return l == null ? (ll.length ? ll[0][1] : b.lane) : l;
}
export function applyPress(b, ft, a) {
  const P = PHYS;
  b.pl = (b.pl || []).filter((x) => x[0] > ft - 2).concat([[ft, a]]);
  if (inW(b.du, ft)) return b;                         // the duel: a parry, the body does not move
  if (a === "S" && b.gd && inW(b.gl, ft)) return b;    // the grid: a strike is only the strike (↑ is a row step there)
  if (a === "S") a = "U";   // 2.3.11 «Удар»: the strike press is a jump for the body (the damage is judged in raid3.js)
  if (inW(b.mr, ft) && (a === "L" || a === "R")) a = a === "L" ? "R" : "L";
  // 2.5 the glider (a mode window from a {k:"mode", mode:"glider"} event): U / D move it one height up / down and it stays
  // there (0 = low = counts as sliding, 1 = the middle, 2 = high = counts as in the air); lanes as usual
  if ((a === "U" || a === "D") && b.gl && ft >= b.gl[0] && ft <= b.gl[1]) {
    const ca = ft >= b.altAt ? b.alt : b.altPrev, na = Math.max(0, Math.min(2, ca + (a === "U" ? 1 : -1)));
    if (na !== ca) { b.altPrev = ca; b.alt = na; b.altAt = ft + (b.gd ? GRID_DELAY : P.altDelay); }
    return b;
  }
  if ((a === "L" || a === "R") && inW(b.rg, ft)) {     // the vein: around the tube
    const cur = ft >= b.laneAt ? b.lane : b.prevLane, nl = (cur + (a === "L" ? RING_N - 1 : 1)) % RING_N;
    b.prevLane = cur; b.lane = nl; b.laneAt = ft + P.laneDelay; logLane(b, b.laneAt, nl); return b;
  }
  if (a === "L" || a === "R") {
    const nl = Math.max(0, Math.min(2, b.lane + (a === "L" ? -1 : 1)));
    if (nl !== b.lane) { b.prevLane = b.lane; b.lane = nl; b.laneAt = ft + P.laneDelay; logLane(b, b.laneAt, nl); }
  } else if (a === "U") {
    if (ft >= b.airUntil) { b.airFrom = ft; b.airUntil = ft + (inW(b.wa, ft) ? WATER_JUMP : P.jumpT); b.slideUntil = Math.min(b.slideUntil, ft); }
  } else if (a === "D") {
    if (inW(b.wa, ft)) return b;
    if (ft < b.airUntil) { b.airUntil = ft + P.fastFall; b.slideFrom = b.airUntil; b.slideUntil = b.airUntil + P.slideT; }
    else if (ft >= b.slideUntil) { b.slideFrom = ft; b.slideUntil = ft + P.slideT; }
  }
  return b;
}
// state at time t given the body after all presses with ft <= t
export function bodyAt(b, t) {
  const P = PHYS;
  const lane = t >= b.laneAt ? b.lane : (b.prevLane != null ? b.prevLane : b.lane);
  if (b.gl && t >= b.gl[0] && t <= b.gl[1]) { const alt = t >= b.altAt ? b.alt : b.altPrev; return { lane, high: alt === 2, slide: alt === 0, alt }; }
  const high = t >= b.airFrom + P.airPad && t <= b.airUntil - P.airPad;
  const slide = t >= b.slideFrom + P.slidePad && t <= b.slideUntil;
  return { lane, high, slide, alt: 1 };
}
export function stateAt(presses, t, base) {
  const b = Object.assign(newBody(), base || {});
  for (const p of presses) { if (p.ft > t) break; applyPress(b, p.ft, p.a); }
  return bodyAt(b, t);
}
// 2.3.11 the open window at time t (Director.wins), or null
export function openAt(wins, t) { for (const w of wins || []) if (t >= w[0] && t <= w[1]) return w; return null; }
// 2.3.11 the damage of one strike: orbDmg × k × the same combo multiplier as an orb (× openK inside an «открыт» window of the director)
export function orbDmgOf(id) { const e = ENEMIES[id]; return e && e.orbDmg > 0 ? e.orbDmg : RULES.orbDmg; }
export function strikeOn(id) { const e = ENEMIES[id]; return !!e && e.strike !== false; }   // 2.3.11: every enemy (owner: the same fight everywhere)
export function strikeDmg(streak, open, od) {
  const R = RULES, mult = 1 + Math.min(streak, R.comboMax) * R.comboStep;
  return Math.round((od || R.orbDmg) * R.strike.k * mult * (open ? R.strike.openK : 1));
}
// true = the attack hurts / the orb is taken (the atomic kinds; judge2 = all kinds with the body)
export function judge(ev, s) {
  switch (ev.k) {
    case "spike": return ev.lanes.includes(s.lane);
    case "wave": return !s.high;
    case "beam": return ev.lanes.includes(s.lane) && !s.slide;
    case "orb": return s.lane === ev.lane && (ev.row != null ? (s.alt == null ? 1 : s.alt) === ev.row : ev.hi ? s.high : !s.high && !s.slide);
    case "pit": return ev.lanes.includes(s.lane) && !s.high;
    case "cell": return (ev.cells || []).some((c) => c[0] === s.lane && c[1] === (s.alt == null ? 1 : s.alt));
    default: return false;          // warp: never hurts (it moves the body: warpBody)
  }
}
// 2.3.11 PARRY = how long before the blow a parry swipe counts; CLASH = the joust's window for the swipe ↑ at the clash
export const PARRY = [0.5, 0.02], CLASH = [0.32, 0.02];
const pressIn = (b, t, w, ok) => (b.pl || []).some((x) => x[0] >= t - w[0] && x[0] <= t + w[1] && ok(x[1]));
// → "hurt" | "gain" | null. s = bodyAt(b, ev.t); b = the body with every press ≤ ev.t folded in
// 2.3.12 the interactions (not a runner): every kind is a moment at ev.t on a lane / a cell (ev.cells or ev.lanes, + ev.row):
//   pick  you are there (hi: in the air, lo: sliding) → you take it: ev.item = charge | harpoon | air | shield (+ damage × ev.x)
//   hold  you stayed there the last ev.d s (the cannon, a lever, an updraft) → gain × ev.x
//   push  you stepped onto the cell from the row behind (the barrel rolls on into the head) → gain × ev.x
//   lure  you were in ev.lanes[0] ev.d s ago and left it (the echo strikes itself) → gain × ev.x
//   grab  you are on the cell → hurt, unless a teammate stands next to you (raid3.js) — leave it or stand together
//   tilt  everybody slides by ev.map (the deck tilts) unless they hold on: a tap (S) in the last 0.6 s
//   breath under water: hurt unless you carry air (a bubble), which it uses up
//   coop  you are on a marked cell — and raid3.js: so is everybody (a co-op bonus); alone it is yours
// Items live on the body (flat fields, copied with {...b}): b.air, b.hpn (a harpoon: the next S is a harpoon throw), b.sh (a shield
// takes the next hit).
const onIt = (ev, s) => {
  const al = s.alt == null ? 1 : s.alt;
  if (ev.cells) return ev.cells.some((c) => c[0] === s.lane && c[1] === al);
  return (ev.lanes || []).includes(s.lane) && (ev.row == null || ev.row === al);
};
export const HOLD_TAP = 0.6;
function judgeAct(ev, s, b) {
  switch (ev.k) {
    case "pick": {
      if (!onIt(ev, s) || (ev.hi && !s.high) || (ev.lo && !s.slide) || (!ev.hi && !ev.lo && !b.gl && s.high)) return null;
      if (ev.item === "air") b.air = Math.min(2, (b.air || 0) + 1); else if (ev.item === "harpoon") b.hpn = 1; else if (ev.item === "shield") b.sh = 1;
      return "gain";
    }
    case "hold": {
      if (!onIt(ev, s)) return null;
      const s0 = bodyAt(b, ev.t - (ev.d || 1.2)); if (!onIt(ev, s0)) return null;
      for (const x of b.ll || []) if (x[0] > ev.t - (ev.d || 1.2) && x[0] <= ev.t && x[1] !== s.lane) return null;   // no stepping out and back
      return "gain";
    }
    case "push": { const s0 = bodyAt(b, ev.t - 0.45), c = ev.cells[0]; return s.lane === c[0] && s.alt === c[1] && s0.lane === c[0] && s0.alt === c[1] - 1 ? "gain" : null; }
    case "lure": { const L = ev.lanes[0]; return laneAtT(b, ev.t - (ev.d || 2)) === L && s.lane !== L ? "gain" : null; }
    case "grab": return onIt(ev, s) ? "hurt" : null;
    case "breath": if ((b.air || 0) > 0) { b.air--; return null; } return "hurt";
    case "coop": return onIt(ev, s) ? "gain" : null;
    case "tilt": return null;
  }
  return undefined;
}
export const ACT_KINDS = ["pick", "hold", "push", "lure", "grab", "tilt", "breath", "coop"];
export function tiltBody(b, ev) {   // the deck tilts: everybody who did not hold on slides by ev.map (lane) / ev.rmap (row)
  if ((b.pl || []).some((x) => x[0] >= ev.t - HOLD_TAP && x[0] <= ev.t + 0.02 && x[1] === "S")) return b;
  const s = bodyAt(b, ev.t);
  if (ev.map) { const to = ev.map[s.lane]; if (Number.isInteger(to) && to !== s.lane) { b.prevLane = s.lane; b.lane = to; b.laneAt = ev.t; logLane(b, ev.t, to); } }
  if (ev.rmap && b.gl) { const al = s.alt, to = ev.rmap[al]; if (Number.isInteger(to) && to !== al) { b.altPrev = al; b.alt = to; b.altAt = ev.t; } }
  return b;
}
function shielded(b, j) { if (j === "hurt" && (b.sh || 0) > 0) { b.sh = 0; return "blocked"; } return j; }
export function judge2(ev, s, b) {
  const a = judgeAct(ev, s, b); if (a !== undefined) return shielded(b, a);
  return shielded(b, judge2a(ev, s, b));
}
function judge2a(ev, s, b) {
  switch (ev.k) {
    case "parry": return pressIn(b, ev.t, PARRY, (a) => a === ev.dir || (ev.dir === "U" && a === "S")) ? "gain" : "hurt";
    case "clash":
      if ((ev.lanes || []).includes(s.lane)) return "hurt";
      return pressIn(b, ev.t, CLASH, (a) => a === "U" || a === "S") ? "gain" : null;
    case "echo": return !s.high && laneAtT(b, ev.t - (ev.d || 2)) === s.lane ? "hurt" : null;
    case "mir": return !s.high && 2 - laneAtT(b, ev.t - (ev.d || 1)) === s.lane ? "hurt" : null;
    case "beat": case "mode": case "warp": return null;
    case "orb": return judge(ev, s) ? "gain" : null;
    default: return judge(ev, s) ? "hurt" : null;
  }
}
// 2.5 a glider mode event opens the window of the glider's own heights (it starts in the middle); 2.3.11 the other modes
export function modeBody(b, ev) {
  const w = [ev.t, ev.until];
  if (ev.mode === "glider" || ev.mode === "grid") { b.gl = w; b.alt = 1; b.altPrev = 1; b.altAt = ev.t; b.gd = ev.mode === "grid" ? 1 : 0; }
  else if (ev.mode === "ring") { const L = bodyAt(b, ev.t).lane; b.rg = w; b.prevLane = b.lane = RING_IN[Math.max(0, Math.min(2, L))]; b.laneAt = ev.t; logLane(b, ev.t, b.lane); }
  else if (ev.mode === "mirror") b.mr = w;
  else if (ev.mode === "duel") b.du = w;
  else if (ev.mode === "water") b.wa = w;
  else if (ev.mode === "end") {   // closes every window; out of the vein onto the 3 lanes
    if (b.rg) { const L = bodyAt(b, ev.t).lane; b.prevLane = b.lane = RING_OUT[((L % RING_N) + RING_N) % RING_N]; b.laneAt = ev.t; logLane(b, ev.t, b.lane); }
    for (const k of ["rg", "mr", "du", "wa"]) if (b[k]) b[k] = null;
    if (b.gl && b.gl[1] > ev.t) b.gl = [b.gl[0], ev.t];
  }
  return b;
}
// a warp event moves the body (after all presses with ft <= ev.t are folded in): lane at that moment → map[lane], at once
export function warpBody(b, ev) {
  const L = bodyAt(b, ev.t).lane, to = ev.map && Number.isInteger(ev.map[L]) ? ev.map[L] : L;
  if (to !== L) { b.prevLane = L; b.lane = to; b.laneAt = ev.t; logLane(b, ev.t, to); }   // a lane outside the portals / pull is left alone
  return b;
}

// ---------------------------------------------------------------- rewards (by contribution, only for a win)
export function rewards(kind, players) {
  const R = RULES, base = R.reward[kind] || R.reward.minion;
  const fair = players.filter((p) => !p.cheat);
  const total = fair.reduce((s, p) => s + p.dmg, 0), n = fair.length || 1, avg = total / n;
  return players.map((p) => {
    if (p.cheat) return { pid: p.pid, gems: 0, share: 0, why: "cheat" };
    const share = total > 0 ? p.dmg / total : 0;
    if (p.dmg <= 0) return { pid: p.pid, gems: 0, share, why: "no_damage" };
    if (p.onFrac < R.minOnline) return { pid: p.pid, gems: 0, share, why: "offline" };
    if (p.afk) return { pid: p.pid, gems: 0, share, why: "afk" };          // standing still in the middle lane catches stray orbs
    if (p.dmg < avg * R.minShareOfAvg) return { pid: p.pid, gems: 0, share, why: "too_little" };
    const g = Math.round(base * n * share);
    return { pid: p.pid, gems: Math.max(Math.round(base * R.rewardMinK), Math.min(Math.round(base * R.rewardMaxK), g)), share, why: "ok" };
  });
}
