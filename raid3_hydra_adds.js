// raid3_hydra_adds.js — attack patterns of the Rift Hydra's four minions (days 1–4), v3 (owner 06.11: all-new attacks):
//   spawn   «Отродье Разлома»  — brood  (hatchlings scuttle down two lanes, then two others: the free lane moves),
//                                 tunnel (it bursts out of a burrow and leaps chest-high over two lanes: slide; the burrow erupts),
//                                 geyser (an acid geyser opens a hole in a lane, then splashes low across the road);
//   eel     «Разломный угорь»  — current (the rift current carries everybody a lane, then the eel's body chest-high over two lanes),
//                                 noose  (a loop of its body chest-high over two lanes, then it pulls tight along the road: jump),
//                                 surge  (charged puddles under two lanes, then the spark jumps to the third: jump it);
//   spitter «Кислотный плевун» — puddle (an acid puddle opens a hole in a lane, then spreads to the next one),
//                                 arc    (a spray sweeps two lanes, then the other two), mortar (a big glob lands, then its splash);
//   coil    «Кольцо Гидры»     — wheel  (rolls down a lane, then hops chest-high over another), band (it lies across two lanes
//                                 chest-high while the third cracks open: slide or jump), twin (a low hoop across the road + a high
//                                 segment over one lane: jump in another lane).
// Pure data, merged into raid3_hydra_rules.js's HYDRA_PAT. Atomic kinds only (spike / wave / beam / pit / warp / orb); `v` =
// the picture for the client (src/raid3_adds_th.js), prefixed with the minion. Every pattern leaves a way through and its orbs
// lie on that way; lane changes ≥ 0.5 s apart, two jumps ≥ 0.75 s apart (×0.9 in phase 2 stays human).
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const third = (a, b) => L3.find((x) => x !== a && x !== b);
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
const warp = (map, t, v) => ({ k: "warp", t, map, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
function core(n, gap) {          // the creature is open: a run of strike orbs, every second one high
  return (r) => { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * gap, i % 2 === 1)); l = pick(r, others(l)); } return [0.7 + n * gap + 0.2, ev]; };
}

const SPAWN = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    { id: "brood", w: [3, 2], f(r, p) {        // hatchlings down two lanes (orb in the free one), then down the free one + another
      const f = lane(r), x = pick(r, others(f)), y = third(f, x), ev = [sp(others(f), 1.0, "sp_brood"), orb(f, 1.0), sp([f, x], 1.6, "sp_brood"), orb(y, 1.6)];
      if (p) { const z = pick(r, others(y)); ev.push(sp(others(z), 2.2, "sp_brood"), orb(z, 2.2)); }
      return [p ? 2.7 : 2.1, ev];
    } },
    { id: "tunnel", w: [2, 2], f(r, p) {       // bursts out in lane c and leaps chest-high over a + b: slide in a / b
      const c = lane(r), a = pick(r, others(c)), ev = [sp([c], 1.0, "sp_burst"), beam(others(c), 1.0, "sp_leap"), orb(a, 1.6)];
      if (p) { const c2 = pick(r, others(c)), a2 = pick(r, others(c2)); ev.push(sp([c2], 2.2, "sp_burst"), beam(others(c2), 2.2, "sp_leap"), orb(a2, 2.8)); }
      return [p ? 3.2 : 2.1, ev];
    } },
    { id: "geyser", w: [2, 2], f(r, p) {       // a hole in lane a (the orb above it), then the low splash across the road
      const a = lane(r), ev = [pit([a], 1.0, "sp_geyser"), orb(a, 1.0, true), wave(1.8, "sp_splash"), orb(pick(r, L3), 1.8, true)];
      if (p) { const b = pick(r, others(a)); ev.push(pit([b], 2.6, "sp_geyser"), orb(pick(r, others(b)), 2.6)); }
      return [p ? 3.0 : 2.3, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const EEL = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    { id: "current", w: [3, 2], f(r) {         // carried a lane towards one edge, then its body chest-high over that edge and the middle
      const s = r() < 0.5 ? 0 : 1, safe = s ? 0 : 2;
      return [2.3, [{ k: "warp", t: 1.0, map: s ? [1, 2, 2] : [0, 0, 1], v: "eel_current" }, beam(others(safe), 1.65, "eel_body"), orb(safe, 1.65)]];
    } },
    { id: "noose", w: [2, 2], f(r, p) {        // a loop over two lanes chest-high (slide or the free lane), then it pulls tight low
      const f = lane(r), ev = [beam(others(f), 1.0, "eel_loop"), orb(f, 1.0), wave(1.8, "eel_pull"), orb(pick(r, L3), 1.8, true)];
      if (p) { const g = pick(r, others(f)); ev.push(beam(others(g), 2.55, "eel_loop"), orb(g, 2.55)); }
      return [p ? 3.0 : 2.3, ev];
    } },
    { id: "surge", w: [2, 2], f(r, p) {        // charged puddles under two lanes (stand in the third), then the spark jumps there: jump it
      const f = lane(r), ev = [pit(others(f), 1.0, "eel_puddle"), orb(f, 1.0), pit([f], 1.7, "eel_spark"), orb(f, 1.7, true)];
      if (p) { const g = pick(r, others(f)); ev.push(pit(others(g), 2.45, "eel_puddle"), orb(g, 2.45)); }
      return [p ? 2.9 : 2.2, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const SPITTER = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    { id: "puddle", w: [3, 2], f(r, p) {       // an acid puddle in lane a (jump it, the orb above), then it spreads to a neighbour lane
      const a = lane(r), b = pick(r, others(a)), c = third(a, b), ev = [pit([a], 1.0, "spt_puddle"), orb(a, 1.0, true), pit([a, b], 1.75, "spt_spread"), orb(c, 1.75)];
      if (p) ev.push(pit([b, c], 2.5, "spt_spread"), orb(a, 2.5));
      return [p ? 3.0 : 2.2, ev];
    } },
    { id: "arc", w: [2, 2], f(r, p) {          // the spray sweeps lanes 0+1, then 1+2 (or the other way): the free lane flips
      const d = r() < 0.5 ? 0 : 1, A = d ? [1, 2] : [0, 1], B = d ? [0, 1] : [1, 2], ev = [beam(A, 1.0, "spt_spray"), orb(d ? 0 : 2, 1.0), beam(B, 1.6, "spt_spray"), orb(d ? 2 : 0, 1.6)];
      if (p) ev.push(beam(A, 2.2, "spt_spray"), orb(d ? 0 : 2, 2.2));
      return [p ? 2.7 : 2.1, ev];
    } },
    { id: "mortar", w: [2, 2], f(r) {          // a big glob lands in lane a, then its splash runs low across the road
      const a = lane(r), f = pick(r, others(a));
      return [2.4, [sp([a], 1.0, "spt_mortar"), orb(f, 1.0), wave(1.75, "spt_splash"), orb(f, 1.75, true)]];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const COIL = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    { id: "wheel", w: [3, 2], f(r, p) {        // rolls down lane a, then hops chest-high over lane b; the third lane is safe all along
      const a = lane(r), b = pick(r, others(a)), c = third(a, b), ev = [sp([a], 1.0, "coil_wheel"), orb(c, 1.0), beam([b], 1.6, "coil_hop"), orb(c, 1.6)];
      if (p) ev.push(sp([c], 2.2, "coil_wheel"), orb(a, 2.2));
      return [p ? 2.7 : 2.1, ev];
    } },
    { id: "band", w: [2, 2], f(r, p) {         // lies chest-high across two lanes (slide) while lane c cracks open (jump, the orb above)
      const c = lane(r), ev = [beam(others(c), 1.0, "coil_band"), pit([c], 1.0, "coil_crack"), orb(c, 1.0, true)];
      if (p) { const c2 = pick(r, others(c)); ev.push(beam(others(c2), 1.8, "coil_band"), pit([c2], 1.8, "coil_crack"), orb(c2, 1.8, true)); }
      else ev.push(orb(pick(r, L3), 1.7));
      return [p ? 2.3 : 2.1, ev];
    } },
    { id: "twin", w: [2, 2], f(r, p) {         // a low hoop across the road + a high segment over lane x: jump in another lane
      const x = lane(r), f = pick(r, others(x)), ev = [wave(1.0, "coil_hoop_lo"), beam([x], 1.0, "coil_hop"), orb(f, 1.0, true)];
      if (p) ev.push(beam([0, 1, 2], 1.8, "coil_spin_hi"), orb(pick(r, L3), 2.45)); else ev.push(orb(pick(r, others(f)), 1.65));
      return [p ? 2.8 : 2.1, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};

export const HYDRA_ADDS = { spawn: SPAWN, eel: EEL, spitter: SPITTER, coil: COIL };

// every pattern ends with a short breath (the arena is calm for a moment: the minion recovers, the round marks clear)
const BREATH = 0.5;
for (const pat of Object.values(HYDRA_ADDS)) for (const it of pat.list) { const f0 = it.f; it.f = (r, p, d) => { const [len, ev] = f0(r, p, d); return [len + BREATH, ev]; }; }
