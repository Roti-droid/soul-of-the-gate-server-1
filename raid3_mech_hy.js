// raid3_mech_hy.js — 2.3.11 «переделка»: the Rift Hydra's week, every enemy its OWN mechanic (owner's list, 06.11):
//   hydra   the deck of a big ship at sea, a 3×3 grid (columns А/Б/В = lanes, rows 1/2/3 = alt 0..2, row 1 nearest the camera):
//           a swipe is an instant one-cell step (mode "grid"); the heads strike cells, rows, columns or a cross, the sea washes
//           rows; always ≥ 1 safe cell; the ◆ lie on cells. «Шторм!» and «Все головы!» are its two special phases (~22 s)
//   spawn   it multiplies — every copy takes a lane; only the MAIN one glows: strikes from its lane ×2 (a copy ×0.5)
//   eel     an underwater tunnel (mode "water": a jump floats 1.15 s, no slide); the eel swims loops: jump its body and steer
//           in the water away from its bite
//   spitter acid puddles stay and spread (a puddle = a pit judged every 0.3 s for seconds: a jump does not cover it)
//   coil    a spiral road around the ring: gravity shifts (floor → wall → ceiling: the camera rolls, on the ceiling the screen's
//           left / right are swapped for you), gaps in the spiral, armoured segments, coil bands
// Pure data merged into PAT of raid3_rules.js.
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
const warp = (map, t, v) => ({ k: "warp", t, map, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const mode = (t, until, m, v) => ({ k: "mode", t, until, mode: m, v: v || m, lanes: [] });
// the grid
const cell = (cells, t, v) => ({ k: "cell", cells: cells.map((c) => [c[0], c[1]]), t, v });
const corb = (c, rw, t) => ({ k: "orb", lane: c, row: rw, t, hi: false, v: "orb" });
const ROW = (rw) => L3.map((c) => [c, rw]), COL = (c) => L3.map((rw) => [c, rw]);
const CROSS = (c, rw) => [[c, rw], [c - 1, rw], [c + 1, rw], [c, rw - 1], [c, rw + 1]].filter((x) => x[0] >= 0 && x[0] <= 2 && x[1] >= 0 && x[1] <= 2);
const ALL = [].concat(ROW(0), ROW(1), ROW(2));
const free = (hit) => ALL.filter((x) => !hit.some((h) => h[0] === x[0] && h[1] === x[1]));
const pickC = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
// the open window after an attack on the deck + two ◆ on safe cells
function gopen(r, ev, h, safe) {
  const a = h + 0.2, c1 = pickC(r, safe), c2 = pickC(r, ALL.filter((x) => Math.abs(x[0] - c1[0]) + Math.abs(x[1] - c1[1]) === 1));
  ev.push(corb(c1[0], c1[1], h + 0.6), corb(c2[0], c2[1], h + 1.2));
  return [a + 1.5 + 0.1, ev, { open: [a, a + 1.5] }];
}

const HYDRA = {
  phases: [0.67, 0.34], first: "deck", enter: { 1: "storm", 2: "heads" }, enterSeq: true, autoOpen: false,
  list: [
    { id: "deck", w: [0, 0, 0], f() { return [0.6, [mode(0.3, 400, "grid", "deck")]]; } },   // the whole fight on the deck
    // «Укус»: the three heads bite three cells (one per column, different rows); the ◆ on a safe cell
    { id: "bite", w: [3, 3, 2], f(r, p) {
      const rows = [0, 1, 2].sort(() => r() - 0.5), hit = L3.map((c) => [c, rows[c]]), ev = [cell(hit, 1.3, "hy_bite")];
      if (p) { const hit2 = L3.map((c) => [c, (rows[c] + 1) % 3]); ev.push(cell(hit2, 2.2, "hy_bite")); return gopen(r, ev, 2.2, free(hit2)); }
      return gopen(r, ev, 1.3, free(hit));
    } },
    // «Пламя по ряду»: a head breathes fire along a row, then another row
    { id: "breath", w: [2, 2, 2], f(r, p) {
      const a = Math.floor(r() * 3) % 3, b = pick(r, others(a)), ev = [cell(ROW(a), 1.3, "hy_fire"), corb(pick(r, L3), pick(r, others(a)), 1.3), cell(ROW(b), 2.1, "hy_fire")];
      return gopen(r, ev, 2.1, free(ROW(b)));
    } },
    // «Шея»: a neck slams down a column (А, Б or В), phase 2+: and the next one
    { id: "neck", w: [2, 2, 2], f(r, p) {
      const c = lane(r), ev = [cell(COL(c), 1.3, "hy_neck"), corb(pick(r, others(c)), Math.floor(r() * 3) % 3, 1.3)];
      if (!p) return gopen(r, ev, 1.3, free(COL(c)));
      const d = pick(r, others(c)); ev.push(cell(COL(d), 2.1, "hy_neck"));
      return gopen(r, ev, 2.1, free(COL(d)));
    } },
    // «Крест»: a burst of rift light on a cross of five cells (the four corners around it are safe)
    { id: "cross", w: [1, 2, 3], f(r) {
      const c = lane(r), rw = Math.floor(r() * 3) % 3, hit = CROSS(c, rw), ev = [cell(hit, 1.4, "hy_cross")];
      return gopen(r, ev, 1.4, free(hit));
    } },
    // «Волна»: the sea washes the deck row by row toward you (far row first) — step INTO the row it has just left
    { id: "wash", w: [2, 2, 2], f(r) {
      const ev = [cell(ROW(2), 1.3, "hy_wave"), cell(ROW(1), 1.75, "hy_wave"), cell(ROW(0), 2.2, "hy_wave"), corb(pick(r, L3), 2, 2.2)];
      return gopen(r, ev, 2.2, free(ROW(0)));
    } },
    // «Шторм!» (~22 s): the sea rises — waves from the sides wash columns, lightning on two cells, no breath between
    { id: "storm", w: [0, 0, 0], f(r) {
      const ev = [mode(0.3, 0, "storm", "storm")]; let t = 2.0;
      for (let i = 0; i < 16; i++) {
        if (i % 3 === 2) { const rw = Math.floor(r() * 3) % 3; ev.push(cell(ROW(rw), t, "hy_wave"), corb(pick(r, L3), pick(r, others(rw)), t)); }
        else { const c = lane(r), hit = COL(c).concat([[pick(r, others(c)), Math.floor(r() * 3) % 3]]); ev.push(cell(hit, t, i % 2 ? "hy_wave" : "hy_bolt")); const sf = free(hit); const o = pickC(r, sf); ev.push(corb(o[0], o[1], t)); }
        t += 1.3;
      }
      ev[0].until = t + 0.2; return [t + 0.5, ev];
    } },
    // «Все головы!» (~22 s): all three heads at once — a row, a column and a bite in turns, quicker
    { id: "heads", w: [0, 0, 0], f(r) {
      const ev = [mode(0.3, 0, "heads", "heads")]; let t = 2.0;
      for (let i = 0; i < 17; i++) {
        const k = i % 3, a = Math.floor(r() * 3) % 3, hit = k === 0 ? ROW(a) : k === 1 ? COL(a) : CROSS(lane(r), Math.floor(r() * 3) % 3);
        ev.push(cell(hit, t, k === 0 ? "hy_fire" : k === 1 ? "hy_neck" : "hy_cross")); const o = pickC(r, free(hit)); ev.push(corb(o[0], o[1], t));
        t += 1.2;
      }
      ev[0].until = t + 0.2; return [t + 0.5, ev];
    } },
    { id: "core", w: [1, 1, 1], f(r) { const ev = []; let c = [lane(r), 1]; for (let i = 0; i < 4; i++) { ev.push(corb(c[0], c[1], 0.7 + i * 0.6)); const n = ALL.filter((x) => Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) === 1); c = pickC(r, n); } return [3.3, ev]; } },
  ],
};

// a spawn pattern: [len, ev, {tgts}] — main = the glowing one's lane; the copies attack the other lanes
const SPAWN = {
  phases: [0.5],
  list: [
    // «Выводок»: the copies lunge in their two lanes, twice; the main one's lane is the safe one (and the ◆ are there)
    { id: "brood", w: [3, 2], f(r) { const m = lane(r); return [3.0, [sp(others(m), 1.4, "sp_copy"), orb(m, 1.4), sp(others(m), 2.4, "sp_copy"), orb(m, 2.4)], { tgts: [[0.4, 3.0, m]] }]; } },
    // «Перетасовка»: the main one swaps places with a copy — follow its glow
    { id: "shuffle", w: [2, 2], f(r) {
      const m1 = lane(r), m2 = pick(r, others(m1));
      return [3.4, [sp(others(m1), 1.4, "sp_copy"), orb(m1, 1.4), sp(others(m2), 2.8, "sp_copy"), orb(m2, 2.8)], { tgts: [[0.4, 1.9, m1], [1.9, 3.4, m2]] }];
    } },
    // «Плевок копий»: the copies spit low over their lanes (jump it) while the main one rears back (slide under its tail)
    { id: "spit", w: [2, 2], f(r) { const m = lane(r); return [2.8, [pit(others(m), 1.4, "sp_spit"), orb(m, 1.4), beam([m], 2.2, "sp_tail"), orb(pick(r, others(m)), 2.2, true)], { tgts: [[0.4, 2.8, m]] }]; } },
    // «Рой» (phase 2): three copies charge one after another, each in another lane
    { id: "swarm", w: [0, 2], f(r) {
      let a = lane(r); const ev = [], m = pick(r, others(a)); let t = 1.3;
      for (let i = 0; i < 3; i++) { ev.push(sp([a], t, "sp_copy"), orb(pick(r, others(a)), t)); a = pick(r, others(a)); t += 0.7; }
      return [t + 0.3, ev, { tgts: [[0.4, t + 0.3, m]] }];
    } },
  ],
};

const EEL = {
  phases: [0.5], first: "dive", autoOpen: true,
  list: [
    { id: "dive", w: [0, 0], f() { return [0.6, [mode(0.3, 400, "water", "water")]]; } },   // the whole fight under water
    // «Петля»: its body loops low across the tunnel (jump — you float), the head bites a lane while you are up (steer away)
    { id: "loop", w: [3, 3], f(r) { const a = lane(r); return [2.4, [wave(1.3, "el_loop"), orb(pick(r, others(a)), 1.4, true), sp([a], 1.95, "el_bite"), orb(pick(r, others(a)), 1.95)]]; } },
    // «Удушье»: it coils around one lane twice; the ◆ around it
    { id: "squeeze", w: [2, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [2.6, [sp([a], 1.3, "el_coil"), orb(pick(r, others(a)), 1.3), sp([b], 2.1, "el_coil"), orb(pick(r, others(b)), 2.1)]]; } },
    // «Течение»: the current carries you a lane, then a low loop (jump)
    { id: "current", w: [2, 2], f(r) { const s = r() < 0.5 ? [0, 0, 1] : [1, 2, 2]; return [2.5, [warp(s, 1.2, "el_flow"), wave(1.9, "el_loop"), orb(1, 2.0, true)]]; } },
    // «Пузыри»: a column of rising bubbles — the ◆ float up high (jump to them), a bite between
    { id: "bubbles", w: [1, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [2.6, [orb(a, 1.0, true), sp([a], 1.8, "el_bite"), orb(b, 1.8, true), orb(pick(r, others(b)), 2.4, true)]]; } },
  ],
};

// acid puddles: a pit judged every TICK s over [t, t + dur] in the lane (the first tick carries the picture)
const TICK = 0.3;
function puddle(lanes, t, dur, v) { const ev = []; for (let k = 0; t + k * TICK <= t + dur + 1e-6; k++) ev.push(pit(lanes, Math.round((t + k * TICK) * 100) / 100, k ? "spt_tick" : v)); ev[0].dur = dur; return ev; }
const SPITTER = {
  phases: [0.5], autoOpen: true,
  list: [
    // «Лужа»: a glob lands in a lane, the acid stays 3 s and spreads into a neighbour lane after 1.2 s — keep to the clean lane
    { id: "puddle", w: [3, 2], f(r) {
      const a = lane(r), b = a === 1 ? pick(r, [0, 2]) : 1, c = L3.find((x) => x !== a && x !== b);
      return [4.6, [...puddle([a], 1.3, 3.0, "spt_glob"), ...puddle([b], 2.5, 1.8, "spt_spread"), orb(c, 1.6), orb(c, 2.8), orb(c, 3.8)]];
    } },
    // «Дождь»: short acid drops in two lanes (1 s), then in two others
    { id: "rain", w: [2, 2], f(r) {
      const f = lane(r), g = pick(r, others(f).filter((x) => Math.abs(x - f) === 1));   // the next clean lane is next door
      return [3.9, [...puddle(others(f), 1.3, 0.9, "spt_drop"), orb(f, 1.5), ...puddle(others(g), 2.8, 0.9, "spt_drop"), orb(g, 3.0)]];
    } },
    // «Дуга»: a spit arc across the road (jump), the puddle left behind in one lane
    { id: "arc", w: [2, 2], f(r) { const a = lane(r); return [3.6, [wave(1.3, "spt_arc"), orb(pick(r, L3), 1.35, true), ...puddle([a], 1.9, 1.5, "spt_spread"), orb(pick(r, others(a)), 2.4)]]; } },
    // «Болото» (phase 2): two lanes of acid for 2.5 s — one clean lane, the ◆ there
    { id: "swamp", w: [0, 2], f(r) { const c = lane(r); return [4.2, [...puddle(others(c), 1.4, 2.4, "spt_glob"), orb(c, 1.8), orb(c, 2.6), orb(c, 3.4)]]; } },
  ],
};

// gravity: {k:"grav", side 0 floor / 1 the right wall / 2 the ceiling / 3 the left wall} — never judged (the lanes stay lanes)
const grav = (t, side) => ({ k: "grav", t, side, v: "cl_grav", lanes: [] });
const COIL = {
  phases: [0.5], autoOpen: true,
  list: [
    // «Виток»: the road twists a quarter (gravity shifts), a gap in the spiral (jump), a segment in a lane
    { id: "twist", w: [3, 2], f(r, p, d) {
      const s = d ? (d.side = ((d.side || 0) + 1) % 4) : 1, a = lane(r);
      return [2.8, [grav(0.8, s), wave(1.6, "cl_gap"), orb(lane(r), 1.65, true), sp([a], 2.3, "cl_seg"), orb(pick(r, others(a)), 2.3)]];
    } },
    // «Кольцо»: a coil band over the road at chest height (slide) and armoured segments in two lanes
    { id: "band", w: [2, 2], f(r) { const f = lane(r); return [2.6, [beam(L3, 1.3, "cl_band"), orb(lane(r), 1.75), sp(others(f), 2.1, "cl_seg"), orb(f, 2.1)]]; } },
    // «Сальто»: upside down — gravity to the ceiling at once, then a gap
    { id: "flip", w: [1, 2], f(r, p, d) { const s = d ? (d.side = ((d.side || 0) + 2) % 4) : 2; return [2.4, [grav(0.8, s), wave(1.7, "cl_gap"), orb(lane(r), 1.75, true)]]; } },
    // «Двойной виток» (phase 2): two segments one after another (another lane each), then a gap
    { id: "double", w: [0, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [3.0, [sp([a], 1.3, "cl_seg"), orb(pick(r, others(a)), 1.3), sp([b], 1.9, "cl_seg"), orb(pick(r, others(b)), 1.9), wave(2.5, "cl_gap"), orb(lane(r), 2.55, true)]]; } },
  ],
};

export const MECH_HY = { hydra: HYDRA, spawn: SPAWN, eel: EEL, spitter: SPITTER, coil: COIL };
for (const id of ["spawn", "eel", "spitter", "coil"]) for (const it of MECH_HY[id].list) { const f0 = it.f; it.f = (r, p, d) => { const x = f0(r, p, d); x[0] += 0.5; return x; }; }
