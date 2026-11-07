// raid3_mech_vh.js — 2.3.11 «переделка»: the Void Knight's and the Heart's weeks, every enemy its OWN mechanic (owner, 06.11):
//   voidknight  a duel on the ghost steed beside him (mode "duel": the presses are parries): he slashes, you parry with a swipe
//               TOWARD the slash (← / →), an overhead blow = ↑, a low sweep = ↓; a parry = a counter blow (◆ ×2.5).
//               «Галоп!» and «Клинки Пустоты!» are its special phases (~22 s)
//   squire      boomerang shields: out down one lane, back down another
//   lancer      the joust: he charges at you down a lane — be off his lane and swipe ↑ right at the clash (a counter ×3)
//   shade       darkness: only a circle of light around the ball; the blades flash briefly before they strike
//   herald      the mirror (mode "mirror": ← / → swapped) and he strikes the mirror of where you stood 1 s ago
//   heart       zero gravity: free flight in a 3×3 ring (3 heights × 3 lanes, mode "grid"); the pulse waves fill the ring but
//               for a gap — in the heartbeat's rhythm (lub-dub, rest). «Аритмия!» and «Остановка сердца!» (~22 s)
//   pulse       the floor pulses: lanes vanish and come back on the beat (a vanished lane = a pit judged every 0.3 s)
//   vein        inside a vein-tube (mode "ring": 6 positions around it, ← / → turn 360°)
//   echo        the Gate Echo repeats your moves 2 s later — its blow lands where you were 2 s ago
//   keeper      the sky arena: a glider on a 3×3 grid, walls with gaps fly at you — be in the free cell
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const mode = (t, until, m, v) => ({ k: "mode", t, until, mode: m, v: v || m, lanes: [] });
const parry = (dir, t, v) => ({ k: "parry", dir, t, v, x: 2.5, lanes: [1] });
const clash = (l, t) => ({ k: "clash", lanes: [l], t, v: "ln_clash", x: 3 });
const echo = (t, d) => ({ k: "echo", t, d: d || 2, v: "ec_blow", lanes: [] });
const mir = (t, d) => ({ k: "mir", t, d: d || 1, v: "hr_mirror", lanes: [] });
const cell = (cells, t, v) => ({ k: "cell", cells: cells.map((c) => [c[0], c[1]]), t, v });
const corb = (c, rw, t) => ({ k: "orb", lane: c, row: rw, t, hi: false, v: "orb" });
const ALL = []; for (const rw of L3) for (const c of L3) ALL.push([c, rw]);
const but = (keep) => ALL.filter((x) => !keep.some((k) => k[0] === x[0] && k[1] === x[1]));
const near1 = (c) => ALL.filter((x) => Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) === 1);
const SL = { L: "vk_slashL", R: "vk_slashR", U: "vk_over", D: "vk_sweep" };
const DIRS = ["L", "R", "U", "D"];

// ---------------------------------------------------------------- the Void Knight: the duel
function duelRun(r, n, gap, mv, v) {
  const ev = [mode(0.3, 0, mv, v)]; let t = 2.2, last = null;
  for (let i = 0; i < n; i++) {
    let d = pick(r, DIRS); if (d === last) d = pick(r, DIRS.filter((x) => x !== last)); last = d;
    ev.push(parry(d, t, SL[d]));
    if (mv === "voidblades" && i % 3 === 1) { const d2 = d === "L" ? "R" : d === "R" ? "L" : d === "U" ? "D" : "U"; ev.push(parry(d2, t + 0.6, SL[d2])); t += 0.6; last = d2; }
    t += gap;
  }
  ev[0].until = t + 0.2; return [t + 0.5, ev];
}
const VOIDKNIGHT = {
  phases: [0.66, 0.33], first: "mount", enter: { 1: "gallop", 2: "blades" }, enterSeq: true, autoOpen: false,
  list: [
    { id: "mount", w: [0, 0, 0], f() { return [0.6, [mode(0.3, 400, "duel", "duel")]]; } },   // the whole fight on the steeds
    // «Выпад»: one slash — from the left or the right (swipe toward it)
    { id: "slash", w: [3, 2, 2], f(r) { const d = pick(r, ["L", "R"]); return [2.1, [parry(d, 1.4, SL[d])]]; } },
    // «Сверху / Снизу»: an overhead blow (↑), then a low sweep at the steed's legs (↓)
    { id: "highlow", w: [2, 2, 2], f(r) { const a = pick(r, ["U", "D"]), b = a === "U" ? "D" : "U"; return [2.8, [parry(a, 1.4, SL[a]), parry(b, 2.1, SL[b])]]; } },
    // «Связка»: three blows, each from another side
    { id: "combo", w: [1, 2, 3], f(r) {
      const ev = []; let last = null, t = 1.4;
      for (let i = 0; i < 3; i++) { let d = pick(r, DIRS); if (d === last) d = pick(r, DIRS.filter((x) => x !== last)); last = d; ev.push(parry(d, t, SL[d])); t += 0.62; }
      return [t + 0.2, ev];
    } },
    // «Обманка»: he raises the blade on one side and strikes from the other (the marker shows the real side ~1 s before)
    { id: "feint", w: [0, 2, 2], f(r) { const d = pick(r, ["L", "R"]); return [2.2, [parry(d, 1.5, SL[d] + "_f")]]; } },
    { id: "gallop", w: [0, 0, 0], f(r) { return duelRun(r, 18, 1.05, "gallop", "gallop"); } },
    { id: "blades", w: [0, 0, 0], f(r) { return duelRun(r, 14, 1.15, "voidblades", "voidblades"); } },
  ],
};
// ---------------------------------------------------------------- his minions
const SQUIRE = {
  phases: [0.5],
  list: [
    // «Бумеранг»: a shield flies out down lane a, curves and comes back down lane b (another lane)
    { id: "boomerang", w: [3, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [2.8, [sp([a], 1.3, "sq_out"), orb(pick(r, others(a)), 1.3), sp([b], 2.4, "sq_back"), orb(pick(r, others(b)), 2.4)]]; } },
    // «Пара щитов»: two shields out (two lanes), back crossed
    { id: "pair", w: [2, 2], f(r) { const f = lane(r), g = pick(r, others(f)); return [3.0, [sp(others(f), 1.3, "sq_out"), orb(f, 1.3), sp(others(g), 2.5, "sq_back"), orb(g, 2.5)]]; } },
    // «Низкий бросок»: the shield skims low over the road (jump), back high (slide)
    { id: "skim", w: [2, 2], f(r) { return [2.8, [wave(1.3, "sq_low"), orb(lane(r), 1.3, true), beam(L3, 2.3, "sq_high"), orb(lane(r), 2.7)]]; } },
    { id: "wall", w: [0, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [3.2, [sp([a], 1.3, "sq_out"), sp([b], 1.9, "sq_out"), orb(pick(r, others(b)), 1.9), sp([a], 2.6, "sq_back"), orb(pick(r, others(a)), 2.6)]]; } },
  ],
};
const LANCER = {
  phases: [0.5],
  list: [
    // «Сшибка»: he lowers the lance at lane a and charges — be off it and swipe ↑ at the clash
    { id: "charge", w: [3, 3], f(r) { const a = lane(r); return [2.4, [clash(a, 1.6), orb(pick(r, others(a)), 2.2)]]; } },
    // «Двойная сшибка»: two charges, the second at the lane you dodged to
    { id: "double", w: [2, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [3.4, [clash(a, 1.6), clash(b, 2.8)]]; } },
    // «Удар древком»: the butt of the lance sweeps low (jump), then the charge
    { id: "butt", w: [2, 2], f(r) { const a = lane(r); return [3.2, [wave(1.3, "ln_butt"), orb(lane(r), 1.3, true), clash(a, 2.5)]]; } },
    { id: "storm", w: [0, 2], f(r) { const a = lane(r), b = pick(r, others(a)), c = pick(r, others(b)); return [4.2, [clash(a, 1.6), clash(b, 2.7), clash(c, 3.8)]]; } },
  ],
};
const SHADE = {
  phases: [0.5], dark: true,
  list: [
    { id: "blades", w: [3, 2], f(r) { const f = lane(r); return [2.0, [sp(others(f), 1.3, "sh_blade"), orb(f, 1.3)]]; } },
    { id: "sweep", w: [2, 2], f(r) { const d = r() < 0.5 ? [0, 1, 2] : [2, 1, 0]; return [2.4, [sp([d[0]], 1.3, "sh_blade"), sp([d[1]], 1.75, "sh_blade"), orb(d[2], 1.3), orb(d[2], 1.75)]]; } },
    { id: "low", w: [2, 2], f(r) { const f = lane(r); return [2.4, [pit(others(f), 1.3, "sh_low"), orb(f, 1.3), beam(L3, 2.0, "sh_high"), orb(lane(r), 2.4)]]; } },
    { id: "flurry", w: [0, 2], f(r) { let a = lane(r); const ev = []; let t = 1.3; for (let i = 0; i < 3; i++) { ev.push(sp([a], t, "sh_blade"), orb(pick(r, others(a)), t)); a = pick(r, others(a)); t += 0.65; } return [t + 0.2, ev]; } },
  ],
};
const HERALD = {
  phases: [0.5], first: "glass",
  list: [
    { id: "glass", w: [0, 0], f() { return [0.6, [mode(0.3, 400, "mirror", "mirror")]]; } },   // the whole fight in the mirror
    // «Отражение»: he strikes the mirror of where you stood 1 s ago (the middle mirrors itself — leave it)
    { id: "reflect", w: [3, 2], f(r) { return [2.2, [mir(1.4, 1.0), orb(lane(r), 1.9)]]; } },
    // «Два отражения»: twice, 0.8 s apart
    { id: "twice", w: [2, 2], f(r) { return [2.9, [mir(1.4, 1.0), mir(2.2, 1.0), orb(lane(r), 2.6)]]; } },
    // «Осколки»: mirror shards in two lanes + the reflection
    { id: "shards", w: [2, 2], f(r) { const f = lane(r); return [2.8, [sp(others(f), 1.3, "hr_shard"), orb(f, 1.3), mir(2.2, 1.0)]]; } },
    { id: "hall", w: [0, 2], f(r) { const f = lane(r); return [3.2, [mir(1.4, 1.0), sp(others(f), 2.2, "hr_shard"), orb(f, 2.2), mir(2.9, 1.0)]]; } },
  ],
};

// ---------------------------------------------------------------- the Heart: zero gravity in a 3×3 ring
function lubdub(r, t0, gaps, v) {   // one heartbeat: two waves 0.45 s apart, each leaves its gap cells
  const g1 = gaps[0], g2 = gaps[1];
  return [cell(but(g1), t0, v), corb(g1[0][0], g1[0][1], t0), cell(but(g2), t0 + 0.6, v), corb(g2[0][0], g2[0][1], t0 + 0.6)];
}
const HEART = {
  phases: [0.66, 0.33], first: "float", enter: { 1: "arrhythmia", 2: "arrest" }, enterSeq: true, autoOpen: false,
  list: [
    { id: "float", w: [0, 0, 0], f() { return [0.6, [mode(0.3, 400, "grid", "zerog")]]; } },   // the whole fight in zero-g
    // «Удар сердца»: lub-dub — the first wave leaves a gap, the second a gap next to it
    { id: "beat", w: [3, 3, 2], f(r) { const g = pick(r, ALL), h = pick(r, near1(g)); return [2.8, lubdub(r, 1.4, [[g], [h]], "ht_pulse")]; } },
    // «Кольцо»: a ring wave — the outer eight cells, the centre is the gap; then the centre and a corner is the gap
    { id: "ring", w: [2, 2, 2], f(r) { const c = pick(r, [[0, 0], [2, 0], [0, 2], [2, 2]]); return [3.0, [cell(but([[1, 1]]), 1.4, "ht_ring"), corb(1, 1, 1.4), cell(but([c]), 2.2, "ht_ring"), corb(c[0], c[1], 2.2)]]; } },
    // «Крест»: a cross of the vessels pulses (5 cells), then the corners (4)
    { id: "vessels", w: [2, 2, 2], f(r) { const cr = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], co = [[0, 0], [2, 0], [0, 2], [2, 2]]; return [3.0, [cell(cr, 1.4, "ht_vessel"), corb(co[0][0], co[0][1], 1.6), cell(co, 2.2, "ht_vessel"), corb(1, 1, 2.4)]]; } },
    { id: "arrhythmia", w: [0, 0, 0], f(r) {   // «Аритмия!» (~22 s): beats at uneven intervals
      const ev = [mode(0.3, 0, "arrhythmia", "arrhythmia")]; let t = 2.2, g = pick(r, ALL);
      for (let i = 0; i < 18; i++) { const h = pick(r, near1(g)); ev.push(cell(but([h]), t, "ht_pulse"), corb(h[0], h[1], t)); g = h; t += [0.85, 1.25, 1.0, 1.4][i % 4]; }
      ev[0].until = t + 0.2; return [t + 0.5, ev];
    } },
    { id: "arrest", w: [0, 0, 0], f(r) {   // «Остановка сердца!» (~22 s): slow, then racing — the gap moves one cell per beat
      const ev = [mode(0.3, 0, "arrest", "arrest")]; let t = 2.2, g = [1, 1];
      for (let i = 0; i < 20; i++) { const h = pick(r, near1(g)); ev.push(cell(but([h]), t, "ht_pulse"), corb(h[0], h[1], t)); g = h; t += i < 8 ? 1.3 : 0.9; }
      ev[0].until = t + 0.2; return [t + 0.5, ev];
    } },
    { id: "core", w: [1, 1, 1], f(r) { const ev = []; let c = [1, 1]; for (let i = 0; i < 4; i++) { ev.push(corb(c[0], c[1], 0.8 + i * 0.6)); c = pick(r, near1(c)); } return [3.4, ev, { open: [0.6, 3.2] }]; } },
  ],
};
const TICK = 0.3;
function gone(lanes, t, dur, v) { const ev = []; for (let k = 0; k * TICK <= dur + 1e-6; k++) ev.push(pit(lanes, Math.round((t + k * TICK) * 100) / 100, k ? "pu_tick" : v)); return ev; }
const PULSE = {
  phases: [0.5], autoOpen: true,
  list: [
    // «Пульс пола»: on the beat a lane vanishes for 1.2 s, then the next one (the other two stay)
    { id: "vanish", w: [3, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [3.6, [...gone([a], 1.3, 1.2, "pu_vanish"), orb(pick(r, others(a)), 1.6), ...gone([b], 2.6, 0.9, "pu_vanish"), orb(pick(r, others(b)), 2.9)]]; } },
    // «Сердцебиение»: two lanes vanish together, one lane beats on
    { id: "double", w: [2, 2], f(r) { const k = lane(r); return [3.0, [...gone(others(k), 1.3, 1.2, "pu_vanish"), orb(k, 1.5), orb(k, 2.2)]]; } },
    // «Волна»: the floor heaves — a ring of pulse across the road (jump)
    { id: "heave", w: [2, 2], f(r) { return [2.2, [wave(1.3, "pu_heave"), orb(lane(r), 1.35, true), orb(lane(r), 1.9)]]; } },
    { id: "flutter", w: [0, 2], f(r) { let a = lane(r); const ev = []; let t = 1.3; for (let i = 0; i < 3; i++) { ev.push(...gone([a], t, 0.6, "pu_vanish"), orb(pick(r, others(a)), t + 0.3)); a = pick(r, others(a)); t += 1.0; } return [t + 0.3, ev]; } },
  ],
};
// the vein: positions 0..5 around the tube (0 = the bottom, 1 / 5 = beside it, 3 = the top)
const R6 = [0, 1, 2, 3, 4, 5], r6 = (r) => Math.floor(r() * 6) % 6, rot = (p, k) => (((p + k) % 6) + 6) % 6;
const VEIN = {
  phases: [0.5], first: "enter", autoOpen: false,
  list: [
    { id: "enter", w: [0, 0], f() { return [0.6, [mode(0.3, 400, "ring", "vein")]]; } },   // the whole fight inside the vein
    // «Клапан»: a valve closes the tube but for a gap of two positions — turn to the gap
    { id: "valve", w: [3, 2], f(r) { const g = r6(r), keep = [g, rot(g, 1)]; return [2.0, [sp(R6.filter((x) => !keep.includes(x)), 1.4, "vn_valve"), orb(g, 1.4)]]; } },
    // «Спираль»: blood clots spiral along the wall — two positions at a time, turning
    { id: "spiral", w: [2, 2], f(r) { let a = r6(r); const ev = []; let t = 1.3; for (let i = 0; i < 3; i++) { ev.push(sp([a, rot(a, 3)], t, "vn_clot"), orb(rot(a, 1 + (i % 2) * 3), t)); a = rot(a, 1); t += 0.6; } return [t + 0.3, ev]; } },
    // «Сужение»: the vein contracts — a ring low over the floor (jump) and the valve
    { id: "squeeze", w: [2, 2], f(r) { const g = r6(r); return [2.8, [wave(1.3, "vn_ring"), orb(r6(r), 1.35, true), sp(R6.filter((x) => x !== g && x !== rot(g, 1)), 2.2, "vn_valve"), orb(g, 2.2)]]; } },
    { id: "core", w: [1, 1], f(r) { let p = r6(r); const ev = []; for (let i = 0; i < 4; i++) { ev.push(orb(p, 0.8 + i * 0.7)); p = rot(p, pick(r, [1, 2, -1, -2])); } return [3.6, ev, { open: [0.6, 3.4] }]; } },
  ],
};
const ECHO = {
  phases: [0.5],
  list: [
    // «Эхо»: it strikes where you were 2 s ago — keep moving
    { id: "repeat", w: [3, 2], f(r) { return [2.6, [echo(1.6, 2), orb(lane(r), 2.0), echo(2.3, 2)]]; } },
    // «Эхо и разлом»: the echo + a rift in two lanes (the third is free)
    { id: "rift", w: [2, 2], f(r) { const f = lane(r); return [2.8, [sp(others(f), 1.3, "ec_rift"), orb(f, 1.3), echo(2.1, 2)]]; } },
    // «Двойное эхо»: where you were 2 s ago AND 1 s ago
    { id: "double", w: [1, 2], f(r) { return [2.6, [echo(1.6, 2), echo(1.6, 1), orb(lane(r), 2.2)]]; } },
    { id: "wave", w: [2, 2], f(r) { return [2.6, [wave(1.3, "ec_wave"), orb(lane(r), 1.3, true), echo(2.0, 2)]]; } },
  ],
};
// the keeper: walls with gaps on the 3×3 grid of the glider (heights × lanes)
const KEEPER = {
  phases: [0.5], first: "sky", autoOpen: false,
  list: [
    { id: "sky", w: [0, 0], f() { return [0.6, [mode(0.3, 400, "grid", "sky")]]; } },   // the whole fight on the glider
    // «Стена»: a wall with one gap, then another wall with the gap next to it
    { id: "wall", w: [3, 3], f(r) { const g = pick(r, ALL), h = pick(r, near1(g)); return [2.8, [cell(but([g]), 1.4, "kp_wall"), corb(g[0], g[1], 1.4), cell(but([h]), 2.2, "kp_wall"), corb(h[0], h[1], 2.2)]]; } },
    // «Ворота»: two gaps (a row of the wall is open)
    { id: "gate", w: [2, 2], f(r) { const rw = lane(r), keep = L3.map((c) => [c, rw]); return [2.2, [cell(but(keep), 1.4, "kp_gate"), corb(pick(r, L3), rw, 1.4)]]; } },
    // «Лабиринт»: three walls, the gap walks one cell each time
    { id: "maze", w: [1, 2], f(r) { let g = pick(r, ALL); const ev = []; let t = 1.4; for (let i = 0; i < 3; i++) { ev.push(cell(but([g]), t, "kp_wall"), corb(g[0], g[1], t)); g = pick(r, near1(g)); t += 0.8; } return [t + 0.2, ev]; } },
    { id: "core", w: [1, 1], f(r) { const ev = []; let c = [1, 1]; for (let i = 0; i < 4; i++) { ev.push(corb(c[0], c[1], 0.8 + i * 0.6)); c = pick(r, near1(c)); } return [3.4, ev, { open: [0.6, 3.2] }]; } },
  ],
};

export const MECH_VH = { voidknight: VOIDKNIGHT, squire: SQUIRE, lancer: LANCER, shade: SHADE, herald: HERALD, heart: HEART, pulse: PULSE, vein: VEIN, echo: ECHO, keeper: KEEPER };
for (const id of ["squire", "lancer", "shade", "herald", "pulse", "vein", "echo", "keeper"]) for (const it of MECH_VH[id].list) { const f0 = it.f; it.f = (r, p, d) => { const x = f0(r, p, d); x[0] += 0.5; return x; }; }
