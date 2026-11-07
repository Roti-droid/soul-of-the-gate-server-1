// raid3_heart_rules.js — attack patterns of week «Сердце Разлома» (boss, days 5–7) and its four minions (days 1–4):
//   pulse  «Пульс Разлома»     — a beating heart of rift crystal: systole (the road contracts), arrhythmia, vessels;
//   vein   «Жила Разлома»      — a crystal serpent of veins: whip, sprout (thorn, roots, swing), the stream of clots;
//   echo   «Эхо Врат»          — the ghost of the old Gate: resound (bell and its mirrored echo), phase gates (the road turns), choir;
//   keeper «Хранитель Сердца»  — the last guard with a crescent halberd and soul stones: verdict, guardian stones, the seal;
//   heart  «Сердце Разлома»    — a huge spinning torus-portal with crystal petals, a void whirl and caught souls inside:
//       «Притяжение» (pull)  — the whirl pulls everybody into the middle lane (warp map [1,1,1]) + rings;
//       «Осколки душ» (souls) — soul lights dive onto lanes one after another (round marks);
//       «Пульс» (pulse)       — expanding rings, height alternating: low (jump) / high (slide);
//       «Разрыв» (rupture)    — holes open in the road by the marks (pit: another lane or jump over);
//       связки (combo); phases 0.66 / 0.33, the last one = the finale (music 'final' on the client).
// Pure data for raid3_rules.js (merged into its PAT table there). Kinds: spike / wave / beam / orb / pit (judged), warp
// (moves the ball, never hurts). `v` = the client picture (src/raid3_heart.js). A warp never shares its instant with a danger.
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const pull = (t, v) => ({ k: "warp", lanes: [0, 2], map: [1, 1, 1], t, v });
import { mode, rideFirst } from "./raid3_void_rules.js";
const mirror = (a, b, t, v) => { const m = [0, 1, 2]; m[a] = b; m[b] = a; return { k: "warp", lanes: [a, b].sort(), map: m, t, v }; };
function core(n, gap, hiEvery = 2) {
  return (r) => { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * gap, i % hiEvery === hiEvery - 1)); l = pick(r, others(l)); } return [0.7 + n * gap + 0.2, ev]; };
}
function barrage(r, t0, n, k, v, two) {
  const ev = []; let prev = null, cur = lane(r);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * k, ls = [cur];
    if (two && i % 2 === 1 && prev !== null) ls.push(others(cur).find((x) => x !== prev));
    ev.push(sp(ls, t, v)); if (prev !== null && !ls.includes(prev)) ev.push(orb(prev, t));
    prev = cur; cur = pick(r, others(cur));
  }
  return [t0 + (n - 1) * k, ev];
}
// rings / beats with alternating height: low = jump (high orb), high = slide (orb after); gaps leave time to land / stand up
function rings(r, t0, n, vlo, vhi, hi0) {
  const ev = []; let t = t0, hi = hi0, end = t0;
  for (let i = 0; i < n; i++) {
    if (hi) { ev.push(beam(L3, t, vhi), orb(lane(r), t + 0.6)); end = t + 0.6; t += 1.1; }
    else { ev.push(wave(t, vlo), orb(lane(r), t, true)); end = t; t += 0.9; }
    hi = !hi;
  }
  return [end, ev];
}
// holes in the road: two lanes (the orb in the third), then the third lane opens too — jump it, the orb is above the hole
function rupture(r, t0, v, second) {
  const f = lane(r), ev = [pit(others(f), t0, v), orb(f, t0)];
  if (second) ev.push(pit([f], t0 + 0.75, v), orb(f, t0 + 0.75, true));
  return [t0 + (second ? 0.75 : 0), ev];
}

// «Невесомость» (phases 2 and 3 open with it): the Heart draws everyone into its whirl; each ball rides a shard of the Gate
// down the stream of souls inside the portal — souls dive onto lanes, a pulse ring, the petals sweep high — then out again.
function htFloat(r, p) {
  const ev = [mode(1.0, "ht_float_on")];
  const [e1, list] = barrage(r, 1.9, p === 2 ? 4 : 3, 0.62, "ht_soul", false); ev.push(...list);
  let t = e1 + 0.9; const f = lane(r);
  ev.push(wave(t, "ht_pulse_lo"), orb(f, t, true));
  t += 0.9; ev.push(beam(L3, t, "ht_petal_hi"), orb(f, t + 0.6)); t += 0.6;
  t += 0.8; ev.push(mode(t, "ht_float_off"));
  return [t + 0.3, ev];
}
// ---------------------------------------------------------------- «Сердце Разлома»
const HEART = {
  phases: [0.66, 0.33],
  speed: [1, 0.9, 0.8],
  list: [
    // «Притяжение»: everybody is pulled into the middle; a ring follows (jump, the orb above the middle);
    // phases 2–3: then a soul dives into the middle — get out
    { id: "pull", w: [3, 2, 2], f(r, p) {
      const ev = [pull(1.1, "ht_pull"), wave(1.75, "ht_ring"), orb(1, 1.75, true)];
      if (p) { const f = pick(r, [0, 2]); ev.push(sp([1], 2.45, "ht_soul"), orb(f, 2.45)); return [3.0, ev]; }
      return [2.3, ev];
    } },
    // «Осколки душ»: soul lights dive one lane after another (finale: every second on two lanes)
    { id: "souls", w: [3, 2, 2], f(r, p) { const [e, ev] = barrage(r, 1.0, 3 + (p ? 1 : 0), 0.62, "ht_soul", p === 2); return [e + 0.6, ev]; } },
    // «Пульс»: rings of alternating height
    { id: "pulse", w: [2, 2, 2], f(r, p) { const [e, ev] = rings(r, 1.0, p ? 3 : 2, "ht_pulse_lo", "ht_pulse_hi", r() < 0.5); return [e + 0.5, ev]; } },
    // «Разрыв»: holes open by the marks
    { id: "rupture", w: [2, 3, 2], f(r, p) { const [e, ev] = rupture(r, 1.05, "ht_pit", p > 0); return [e + 0.7, ev]; } },
    // «Лепестковый шквал»: the crown of petals tears off and whirls across the road like a saw, low (jump) or high (slide)
    { id: "petals", w: [2, 2, 2], f(r, p) { const [e, ev] = rings(r, 1.0, p ? 3 : 2, "ht_petal_lo", "ht_petal_hi", r() < 0.5); return [e + 0.5, ev]; } },
    // «Взгляд Разлома»: the black eye opens and its beam burns lane after lane (finale: every second on two lanes)
    { id: "gaze", w: [2, 2, 2], f(r, p) { const [e, ev] = barrage(r, 1.1, 3 + (p ? 1 : 0), 0.66, "ht_gaze", p === 2); return [e + 0.6, ev]; } },
    { id: "float", w: [0, 1, 1], f: (r, p) => htFloat(r, p) },
    // связки
    { id: "combo", w: [1, 2, 3], f(r, p) {
      const kind = pick(r, p === 2 ? ["pp", "sr", "ps", "pr"] : ["pp", "sr", "ps"]);
      if (kind === "pp") {     // pull into the middle, then the middle opens: jump the hole (orb above) or step aside (orb there)
        const f = pick(r, [0, 2]);
        return [2.3, [pull(1.1, "ht_pull"), pit([1], 1.7, "ht_pit"), orb(1, 1.7, true), orb(f, 2.3)]];
      }
      if (kind === "sr") {     // a soul dives on one lane + a low pulse at once: jump in a free lane
        const a = lane(r), f = pick(r, others(a));
        return [2.0, [sp([a], 1.05, "ht_soul"), wave(1.05, "ht_pulse_lo"), orb(f, 1.05, true), orb(pick(r, others(f)), 1.7)]];
      }
      if (kind === "ps") {     // holes in two lanes + a high pulse over the third: slide in the free lane
        const f = lane(r);
        return [2.1, [pit(others(f), 1.1, "ht_pit"), beam(L3, 1.1, "ht_pulse_hi"), orb(f, 1.7)]];
      }
      // pr (finale): pull, ring, then holes on the sides and the middle with an orb above it
      return [3.0, [pull(1.1, "ht_pull"), wave(1.7, "ht_ring"), orb(1, 1.7, true), pit([0, 2], 2.4, "ht_pit"), orb(1, 2.4)]];
    } },
    { id: "core", w: [1, 1, 1], f: core(4, 0.8) },
  ],
};
HEART.list = rideFirst(HEART.list, htFloat, "htFloat");

// ---------------------------------------------------------------- minions (days 1–4), v2: three attacks each with their own links
const adj = (r, l) => (l === 1 ? pick(r, [0, 2]) : 1);   // a neighbouring lane (one step away)
const PULSE = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Систола»: the road contracts into the middle lane, the beat runs down it (jump), then the clot bursts there (step aside)
    { id: "systole", w: [3, 2], f(r, p) {
      const ev = [pull(1.1, "pl_sys"), wave(1.75, "pl_beat2"), orb(1, 1.75, true), sp([1], 2.4, "pl_burst2"), orb(pick(r, [0, 2]), 2.4)];
      if (p) ev.push(pit([1], 3.05, "pl_rupt"), orb(1, 3.05, true));
      return [p ? 3.5 : 2.9, ev];
    } },
    // «Аритмия»: beats out of rhythm — a beat (jump), clots burst on two lanes (the free one), another beat late
    { id: "arrhythmia", w: [2, 2], f(r, p) {
      const f = lane(r), ev = [wave(1.0, "pl_wave"), sp(others(f), 1.6, "pl_clot"), orb(f, 1.6), wave(2.35, "pl_wave"), orb(f, 2.35, true)];
      if (p) { const g = adj(r, f); ev.push(sp(others(g), 3.0, "pl_clot"), orb(g, 3.0)); }
      return [p ? 3.5 : 2.8, ev];
    } },
    // «Сосуды»: the vessels under two lanes burst (jump or the third lane), then an artery whips over that lane at chest height
    { id: "vessel", w: [2, 2], f(r, p) {
      const f = lane(r), g = adj(r, f), ev = [pit(others(f), 1.1, "pl_rupt"), orb(f, 1.1), beam([f], 1.75, "pl_vessel"), orb(g, 1.75)];
      if (p) { const h = adj(r, g); ev.push(beam(others(h), 2.45, "pl_vessel"), orb(h, 2.45)); }
      return [p ? 3.0 : 2.3, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const VEIN = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Хлыст»: the vein lashes two lanes, then two others (follow the free lane); phase 2: a third lash
    { id: "whip", w: [3, 2], f(r, p) {
      const f = lane(r), g = adj(r, f), ev = [sp(others(f), 1.1, "vn_whip"), orb(f, 1.1), sp(others(g), 1.85, "vn_whip"), orb(g, 1.85)];
      if (p) { const h = adj(r, g); ev.push(sp(others(h), 2.6, "vn_whip"), orb(h, 2.6)); }
      return [p ? 3.1 : 2.4, ev];
    } },
    // «Росток»: a thorn rises in the middle, its roots burst out under the outer lanes (back to the middle or jump),
    // then the thorn swings over the road at chest height (slide)
    { id: "sprout", w: [2, 2], f(r) {
      const o = pick(r, [0, 2]);
      return [3.1, [sp([1], 1.0, "vn_thorn"), orb(o, 1.0), pit([0, 2], 1.65, "vn_root"), beam(L3, 2.4, "vn_swing"), orb(lane(r), 3.0)]];
    } },
    // «Кровоток»: clots race down the lanes in the stream (one lane, the next, the first again)
    { id: "flow", w: [2, 2], f(r, p) {
      const c = lane(r), b = adj(r, c), a = L3.find((x) => x !== b && x !== c);
      const ev = [sp([a], 1.0, "vn_clot"), sp([b], 1.5, "vn_clot"), orb(c, 1.5, true), sp([a], 2.0, "vn_clot"), orb(b, 2.0)];
      if (p) ev.push(sp([c], 2.55, "vn_clot"));
      return [p ? 3.0 : 2.5, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const ECHO = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Отзвук»: a bell strikes a lane, its echo strikes the mirrored lane(s) of the road; phase 2: the echo of the echo
    { id: "resound", w: [3, 2], f(r, p) {
      const a = lane(r), m = a === 1 ? [0, 2] : [2 - a], f = adj(r, a), g = a === 1 ? 1 : 1;
      const ev = [sp([a], 1.1, "ec_bell"), orb(f, 1.1), sp(m, 1.75, "ec_echo2"), orb(g, 1.75)];
      if (p) ev.push(sp([a], 2.4, "ec_bell"), orb(a === 1 ? pick(r, [0, 2]) : 1, 2.4, true));
      return [p ? 2.9 : 2.3, ev];
    } },
    // «Фазовые врата»: three ghost gates turn the road — every lane moves one place round, then a chime falls in one lane
    { id: "phase", w: [2, 2], f(r, p) {
      const cyc = (t, d) => ({ k: "warp", lanes: [0, 1, 2], map: d ? [1, 2, 0] : [2, 0, 1], t, v: "ec_phase" });
      const d = r() < 0.5, c = lane(r), ev = [cyc(1.2, d), sp([c], 1.85, "ec_chime2"), orb(adj(r, c), 1.85)];
      if (!p) return [2.4, ev];
      const c2 = lane(r); ev.push(cyc(2.5, !d), sp([c2], 3.15, "ec_chime2"), orb(adj(r, c2), 3.15, true));
      return [3.7, ev];
    } },
    // «Хор»: the choir of the Gate — two low rings of sound (jump, jump), then the ghost arch sweeps over (slide)
    { id: "choir", w: [2, 2], f(r) {
      return [3.5, [wave(1.0, "ec_ring"), orb(lane(r), 1.0, true), wave(1.85, "ec_ring"), orb(lane(r), 1.85, true), beam(L3, 2.7, "ec_arch2"), orb(lane(r), 3.3)]];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const KEEPER = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Приговор»: the halberd's crescent falls on a lane, then reaps the other lanes at chest height (slide or that lane)
    { id: "verdict", w: [3, 2], f(r, p) {
      const a = lane(r), ev = [sp([a], 1.1, "kp_axe"), orb(adj(r, a), 1.1), beam(others(a), 1.8, "kp_reap"), orb(a, 1.8)];
      if (p) ev.push(wave(2.5, "kp_ring"), orb(a, 2.5, true));
      return [p ? 3.0 : 2.4, ev];
    } },
    // «Камни-стражи»: the soul stones land as pillars on two lanes, then burst outward (jump); phase 2: two more
    { id: "stones", w: [2, 2], f(r, p) {
      const f = lane(r), ev = [sp(others(f), 1.1, "kp_pillar"), orb(f, 1.1), wave(1.75, "kp_burst"), orb(f, 1.75, true)];
      if (p) { const g = adj(r, f); ev.push(sp(others(g), 2.45, "kp_pillar"), orb(g, 2.45)); }
      return [p ? 3.0 : 2.3, ev];
    } },
    // «Печать Сердца»: the seal pushes the middle lane out to one side, then brands that side (back to the middle or jump)
    { id: "seal", w: [2, 2], f(r, p) {
      const s = pick(r, [0, 2]), ev = [{ k: "warp", lanes: [1], map: s ? [0, 2, 2] : [0, 0, 2], t: 1.1, v: "kp_seal" }, pit([s], 1.75, "kp_brand"), orb(1, 1.75)];
      if (p) ev.push(pit([1, 2 - s], 2.45, "kp_brand"), orb(s, 2.45));
      return [p ? 3.0 : 2.3, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8, 3) },
  ],
};

export const HEART_PAT = { heart: HEART, pulse: PULSE, vein: VEIN, echo: ECHO, keeper: KEEPER };
