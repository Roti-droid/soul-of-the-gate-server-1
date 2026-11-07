// raid3_void_rules.js — attack patterns of week «Рыцарь Пустоты» (boss, days 5–7) and his four minions (days 1–4):
//   squire  «Оруженосец Пустоты» — a young void squire, kite shield and sword: fan of blades, shield boomerang, leap from the sky;
//   lancer  «Копейщик тьмы»      — a gaunt dark lancer: harpoon (drags the road into its lane), pole vault, whirling lance;
//   shade   «Тень клинка»        — a great shadow sword and its wraith: split (copies, then the true one), eclipse, mirror of the road;
//   herald  «Глашатай Пустоты»   — a hooded herald with a void horn: the toll of the bell, the seals, the blast that shoves the road;
//   voidknight «Рыцарь Пустоты»  — an empty armour of a former royal guard: helm, pauldrons, gauntlets and shield float apart,
//       tied by violet void threads; the weapon is a flail on a chain:
//       «Раскол брони» (shatter) — the armour parts strike lanes one after another (round marks);
//       «Цеп» (flail)            — the flail head sweeps across the road, its colour = its height: violet low (jump), gold high (slide);
//       «Зеркала пустоты» (mirror) — a pair of portals: ride into one, come out of the other lane (a warp event);
//       «Щит-стена» (wall)       — a wall of shields with a hole that moves lane by lane;
//       связки (combo) + phases by hp (0.66 / 0.33): faster, two-lane strikes, double portals.
// Pure data for raid3_rules.js (merged into its PAT table there). Event kinds: spike / wave / beam / orb (judged) and warp
// (moves the ball: lane L → map[L] at that moment, never hurts). `v` = the picture for the client (src/raid3_void.js).
// Every pattern leaves a way through and puts its orbs on that way; required lane changes stay ≥ 0.45 s apart; a warp never
// shares its instant with a danger in one of its own lanes (so the order of judging at one instant doesn't matter).
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
// a phase of another way of moving (the client shows a vehicle / a scene; never judged, never hurts): `v` = "<name>_on" / "<name>_off"
export const mode = (t, v) => ({ k: "mode", lanes: [], t, v });
// the first pattern after each phase change is the phase's ride (the Director keeps which phases already had theirs)
export function rideFirst(list, ride, key) {
  return list.map((it) => ({ ...it, f(r, p, d) { if (p > 0 && d) { const m = d[key] || (d[key] = {}); if (!m[p]) { m[p] = 1; return ride(r, p); } } return it.f(r, p, d); } }));
}
const free = (hit) => L3.filter((x) => !hit.includes(x));
// a pair of portals in lanes a and b (whoever rides into one comes out of the other)
export function mirrorMap(a, b) { const m = [0, 1, 2]; m[a] = b; m[b] = a; return m; }
const warp = (a, b, t, v) => ({ k: "warp", lanes: [a, b].sort(), map: mirrorMap(a, b), t, v });
function core(n, gap, hiEvery = 2) {   // the enemy is open: a run of strike orbs
  return (r) => { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * gap, i % hiEvery === hiEvery - 1)); l = pick(r, others(l)); } return [0.7 + n * gap + 0.2, ev]; };
}
// a run of single-lane strikes, never the lane of the one before; the orb waits where the previous one struck
function barrage(r, t0, n, k, v, two) {
  const ev = []; let prev = null, cur = lane(r);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * k, ls = [cur];
    if (two && i % 2 === 1 && prev !== null) ls.push(others(cur).find((x) => x !== prev));
    ev.push(sp(ls, t, typeof v === "function" ? v(i) : v));
    if (prev !== null && !ls.includes(prev)) ev.push(orb(prev, t));
    prev = cur; cur = pick(r, others(cur));
  }
  return [t0 + (n - 1) * k, ev];
}
// a wall across the road with a hole that moves to a neighbouring lane every step; the orb waits in the hole
function wall(r, t0, n, k, v) {
  const ev = []; let h = lane(r);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * k; ev.push(sp(others(h), t, v), orb(h, t, false));
    h = h === 1 ? pick(r, [0, 2]) : 1;
  }
  return [t0 + (n - 1) * k, ev];
}
// a flail / blade sweeping across the road: low = jump (high orb on top), high = slide (orb after it)
function sweep(r, t0, hi, vlo, vhi) {
  if (hi) return [t0 + 0.6, [beam(L3, t0, vhi), orb(lane(r), t0 + 0.6)], 1.1];
  return [t0, [wave(t0, vlo), orb(lane(r), t0, true)], 0.85];
}

// ---------------------------------------------------------------- «Рыцарь Пустоты»
const PARTS = ["vk_helm", "vk_pauldron", "vk_gauntlet", "vk_shield"];

// «Призрачная скачка» (phases 2 and 3 open with it): everyone rides a spectral steed over a crumbling bridge beside the Knight;
// the bridge breaks under lanes (pits), the flail sweeps low, the chains close lanes, a quake ridge — then the steeds fade.
function vkRide(r, p) {
  const ev = [mode(1.0, "vk_ride_on")]; let f = lane(r), t = 1.9;
  ev.push(pit(others(f), t, "vk_rift"), orb(f, t));                              // the bridge breaks under two lanes
  t += 0.85; ev.push(wave(t, "vk_flail_lo"), orb(f, t, true));                     // the flail low: jump
  t += 0.95; const g = pick(r, others(f)); ev.push(beam(others(g), t, "vk_chain"), orb(g, t)); f = g;   // chains over two lanes
  t += 0.9; const h = pick(r, others(f)); ev.push(pit([f], t, "vk_rift"), orb(h, t));             // the stone under you falls
  t += 0.85; ev.push(wave(t, "vk_quake"), orb(h, t, true));
  if (p === 2) { t += 0.85; const k = pick(r, others(h)); ev.push(pit(others(k), t, "vk_rift"), orb(k, t)); }
  t += 0.9; ev.push(mode(t, "vk_ride_off"));
  return [t + 0.3, ev];
}
const VOIDKNIGHT = {
  phases: [0.66, 0.33],
  speed: [1, 0.9, 0.82],
  list: [
    // «Раскол брони»: helm, pauldron, gauntlet, shield strike lanes one after another (phase 3: every second strike on two lanes)
    { id: "shatter", w: [3, 2, 2], f(r, p) { const off = Math.floor(r() * 4); const [e, ev] = barrage(r, 1.0, 3 + (p ? 1 : 0), 0.62, (i) => PARTS[(off + i) % 4], p === 2); return [e + 0.6, ev]; } },
    // «Цеп»: the flail sweeps across, low or high (the colour says which); 2–3 sweeps, heights mixed
    { id: "flail", w: [3, 2, 2], f(r, p) {
      const n = p ? 3 : 2, ev = []; let t = 1.0, hi = r() < 0.5, end = t;
      for (let i = 0; i < n; i++) { const [e, list, gap] = sweep(r, t, hi, "vk_flail_lo", "vk_flail_hi"); ev.push(...list); end = e; t += gap; hi = r() < 0.5 ? !hi : hi; }
      return [end + 0.5, ev];
    } },
    // «Зеркала пустоты»: a void spike closes one lane, the two others are a portal pair; the orbs wait at both exits
    // (phase 2+: a second pair right after — from the exit you ride into the next mirror)
    { id: "mirror", w: [2, 3, 2], f(r, p) {
      const c = lane(r), [a, b] = others(c), ev = [sp([c], 1.1, "vk_void"), warp(a, b, 1.1, "vk_mirror"), orb(pick(r, [a, b]), 1.6)];
      if (!p) return [2.2, ev];
      const c2 = pick(r, L3), [a2, b2] = others(c2);
      ev.push(sp([c2], 2.3, "vk_void"), warp(a2, b2, 2.3, "vk_mirror"), orb(pick(r, [a2, b2]), 2.8, true));
      return [3.3, ev];
    } },
    // «Щит-стена»: shields close two lanes, the hole moves
    { id: "wall", w: [2, 2, 2], f(r, p) { const [e, ev] = wall(r, 1.0, p ? 4 : 3, 0.72, "vk_wall"); return [e + 0.6, ev]; } },
    // связки
    { id: "combo", w: [1, 2, 3], f(r, p) {
      const kind = pick(r, p === 2 ? ["mf", "wf", "sf", "mm"] : ["mf", "wf", "sf"]);
      if (kind === "mf") {   // mirror, then the low flail at the exits: jump, the orbs are up there
        const c = lane(r), [a, b] = others(c);
        return [2.4, [sp([c], 1.1, "vk_void"), warp(a, b, 1.1, "vk_mirror"), wave(1.75, "vk_flail_lo"), orb(pick(r, [a, b]), 1.75, true)]];
      }
      if (kind === "wf") {   // a shield wall with a hole + the high flail over the hole: slide in the hole
        const h = lane(r);
        return [2.3, [sp(others(h), 1.1, "vk_wall"), beam(L3, 1.1, "vk_flail_hi"), orb(h, 1.75)]];
      }
      if (kind === "sf") {   // a gauntlet strikes one lane + the low flail: jump in a free lane
        const a = lane(r), f = pick(r, others(a));
        return [2.2, [sp([a], 1.05, "vk_gauntlet"), wave(1.05, "vk_flail_lo"), orb(f, 1.05, true), sp([f], 1.75, "vk_helm"), orb(pick(r, others(f)), 1.75)]];
      }
      // mm: two mirrors in a row
      const c = lane(r), [a, b] = others(c), c2 = pick(r, [a, b]), [a2, b2] = others(c2);
      return [2.9, [sp([c], 1.1, "vk_void"), warp(a, b, 1.1, "vk_mirror"), sp([c2], 1.85, "vk_void"), warp(a2, b2, 1.85, "vk_mirror"), orb(pick(r, [a2, b2]), 2.4)]];
    } },
    // «Цепи пустоты»: void chains close two lanes at chest height (slide or the free lane), then two others; phase 2+: all three
    { id: "chains", w: [2, 2, 2], f(r, p) {
      const a = lane(r), b = pick(r, others(a)), ev = [beam(others(a), 1.1, "vk_chain"), orb(a, 1.1), beam(others(b), 1.95, "vk_chain"), orb(b, 1.95)];
      if (!p) return [2.5, ev];
      ev.push(beam(L3, 2.85, "vk_chain"), orb(b, 3.45)); return [3.8, ev];
    } },
    // «Сокрушающий удар»: the flail comes down — a rift runs down a lane (jump it or leave), then a quake ridge (jump)
    { id: "slam", w: [2, 2, 2], f(r, p) {
      const c = lane(r), f = pick(r, others(c)), hit = p === 2 ? others(f) : [c];
      return [2.3, [pit(hit, 1.1, "vk_rift"), orb(f, 1.1), wave(1.8, "vk_quake"), orb(f, 1.8, true)]];
    } },
    { id: "ride", w: [0, 1, 1], f: (r, p) => vkRide(r, p) },
    { id: "core", w: [1, 1, 1], f: core(4, 0.8) },
  ],
};
VOIDKNIGHT.list = rideFirst(VOIDKNIGHT.list, vkRide, "vkRide");

// ---------------------------------------------------------------- minions (days 1–4), v2: three attacks each with their own links
const adj = (r, l) => (l === 1 ? pick(r, [0, 2]) : 1);   // a neighbouring lane (one step away)
const push = (t, right, v) => ({ k: "warp", lanes: right ? [0, 1] : [1, 2], map: right ? [1, 2, 2] : [0, 0, 1], t, v });   // shoved one lane aside
const SQUIRE = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Веер клинков»: a ghost blade stabs the lanes one after another (step in behind it); phase 2: then a low sword arc (jump)
    { id: "fan", w: [3, 2], f(r, p) {
      const d = r() < 0.5 ? [0, 1, 2] : [2, 1, 0], ev = [sp([d[0]], 1.1, "sq_fan"), sp([d[1]], 1.58, "sq_fan"), sp([d[2]], 2.06, "sq_fan"), orb(d[1], 2.06)];
      if (p) ev.push(wave(2.8, "sq_arc"), orb(lane(r), 2.8, true));
      return [p ? 3.3 : 2.5, ev];
    } },
    // «Бросок щита»: the shield flies down one lane past you and comes back down another; phase 2: a second throw
    { id: "shield", w: [2, 2], f(r, p) {
      const a = lane(r), b = pick(r, others(a)), c = L3.find((x) => x !== a && x !== b);
      const ev = [sp([a], 1.1, "sq_shield"), orb(b, 1.1), sp([b], 1.85, "sq_shield2"), orb(c, 1.85)];
      if (p) { const g = adj(r, c); ev.push(sp([c], 2.75, "sq_shield"), orb(g, 2.75)); }
      return [p ? 3.2 : 2.3, ev];
    } },
    // «Выпад с небес»: he lands sword first — a crater in a lane (jump it or step aside), then the shock ring (jump); phase 2: two craters
    { id: "leap", w: [2, 2], f(r, p) {
      const a = lane(r), f = pick(r, others(a)), hit = p ? others(f) : [a];
      return [2.4, [pit(hit, 1.2, "sq_crater"), orb(f, 1.2), wave(1.85, "sq_shock"), orb(f, 1.85, true)]];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const LANCER = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Гарпун»: the lance strikes a lane, its void chain DRAGS everyone into that lane, then it tears out of the road there
    { id: "harpoon", w: [3, 2], f(r, p) {
      const a = lane(r), g = p ? adj(r, a) : pick(r, others(a));
      return [3.1, [sp([a], 1.0, "ln_harpoon"), { k: "warp", lanes: others(a), map: [a, a, a], t: 1.55, v: "ln_hook" }, orb(a, 1.95), sp([a], 2.6, "ln_tear"), orb(g, 2.6)]];
    } },
    // «Прыжок с древком»: the lance plants in a lane, he vaults over the road (slide under him), lands with a shock ring (jump)
    { id: "vault", w: [2, 2], f(r, p) {
      const c = lane(r), f = pick(r, others(c)), hit = p ? others(f) : [c];
      return [3.0, [sp(hit, 1.0, "ln_plant"), orb(f, 1.0), beam(L3, 1.7, "ln_vault"), wave(2.45, "ln_land"), orb(lane(r), 2.45, true)]];
    } },
    // «Вихрь копья»: the lance whirls flat over two lanes high (slide, or the free lane), then low over the whole road (jump)
    { id: "spin", w: [2, 2], f(r, p) {
      const f = lane(r), g = lane(r), ev = [beam(others(f), 1.1, "ln_spin_hi"), orb(f, 1.1), wave(1.9, "ln_spin_lo"), orb(g, 1.9, true)];
      if (p) { const h = adj(r, g); ev.push(beam(others(h), 2.7, "ln_spin_hi"), orb(h, 2.7)); }
      return [p ? 3.2 : 2.4, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const SHADE = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Раскол тени»: two shadow copies fall on two lanes, then the true sword on the lane that was free (step aside)
    { id: "split", w: [3, 2], f(r, p) {
      const f = lane(r), g = adj(r, f), ev = [sp(others(f), 1.1, "sh_split"), orb(f, 1.1), sp([f], 1.75, "sh_true"), orb(g, 1.75)];
      if (p) { const h = adj(r, g); ev.push(sp(others(h), 2.45, "sh_split"), orb(h, 2.45)); }
      return [p ? 3.0 : 2.4, ev];
    } },
    // «Затмение»: two lanes turn into pools of shadow (jump), the third is cut at chest height (slide) — choose; phase 2: a ring (jump)
    { id: "eclipse", w: [2, 2], f(r, p) {
      const f = lane(r), ev = [pit(others(f), 1.2, "sh_umbra"), beam([f], 1.2, "sh_eclipse"), orb(f, 1.85)];
      if (p) ev.push(wave(2.5, "sh_ring"), orb(lane(r), 2.5, true));
      return [p ? 3.0 : 2.4, ev];
    } },
    // «Зеркальный вихрь»: the outer lanes swap places (a mirror of the road), then a blade falls in one lane; phase 2: twice
    { id: "mirror", w: [2, 2], f(r, p) {
      const sw = (t) => ({ k: "warp", lanes: [0, 2], map: [2, 1, 0], t, v: "sh_mirror" });
      const c = lane(r), ev = [sw(1.1), sp([c], 1.7, "sh_fall"), orb(adj(r, c), 1.7)];
      if (!p) return [2.3, ev];
      const c2 = lane(r); ev.push(sw(2.4), sp([c2], 3.0, "sh_fall"), orb(adj(r, c2), 3.0, true));
      return [3.6, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8) },
  ],
};
const HERALD = {
  phases: [0.5], speed: [1, 0.9],
  list: [
    // «Набат»: a giant bell drops over a lane, its peal runs down the road (jump), its echo cuts the other lanes (slide or the bell's lane)
    { id: "toll", w: [3, 2], f(r) {
      const a = lane(r), f = adj(r, a);
      return [3.0, [sp([a], 1.1, "hr_bell"), wave(1.75, "hr_peal"), orb(f, 1.75, true), beam(others(a), 2.45, "hr_echo"), orb(a, 2.45)]];
    } },
    // «Печати»: the royal seal burns holes lane after lane (jump them or step aside); phase 2: a fourth on two lanes
    { id: "seals", w: [2, 2], f(r, p) {
      const y = pick(r, [0, 2]), [x, z] = r() < 0.5 ? others(y) : others(y).reverse();
      const ev = [pit([x], 1.0, "hr_seal"), pit([y], 1.6, "hr_seal"), orb(z, 1.6), pit([z], 2.2, "hr_seal"), orb(x, 2.2)];
      if (p) ev.push(pit(others(x), 2.8, "hr_seal"), orb(x, 2.8, true));
      return [p ? 3.4 : 2.8, ev];
    } },
    // «Глас пустоты»: the horn's blast shoves the whole road one lane aside, then the wind tears the far lane; phase 2: back again
    { id: "gale", w: [2, 2], f(r, p) {
      const right = r() < 0.5, ev = [push(1.1, right, "hr_gale"), sp([right ? 2 : 0], 1.75, "hr_blast"), orb(1, 1.75)];
      if (!p) return [2.3, ev];
      ev.push(push(2.45, !right, "hr_gale"), sp([right ? 0 : 2], 3.1, "hr_blast"), orb(1, 3.1, true));
      return [3.6, ev];
    } },
    { id: "core", w: [1, 1], f: core(4, 0.8, 3) },
  ],
};

export const VOID_PAT = { voidknight: VOIDKNIGHT, squire: SQUIRE, lancer: LANCER, shade: SHADE, herald: HERALD };
