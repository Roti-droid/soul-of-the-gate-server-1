// raid3_hydra_rules.js — attack patterns of week 2: «Гидра Разлома» (boss, days 5–7) and her four minions (days 1–4):
//   spawn / eel / spitter / coil — the minions: their v3 patterns live in raid3_hydra_adds.js (merged into HYDRA_PAT below);
//   hydra   «Гидра Разлома»     — three necks from rifts by the road, crystal masks of three colours, the colour IS the attack:
//       cyan    (c) — a ray along a lane (lasts 0.5 s: leave that lane);
//       magenta (m) — a bouncing sphere, every landing = a round shadow on one lane (be in another lane at that moment);
//       gold    (g) — a glaive thrown across the road: low (jump) or high (slide);
//     «тройной укус» = every living head in turn; связки = two heads at once; every beaten head (phase by hp) is gone and the
//     others get faster (pattern speed 1 → 0.88 → 0.78). Which head falls first is decided by the seed: order = rotate(c,m,g, seed % 3).
// Pure data for raid3_rules.js (merged into its PAT table there). Only the atomic kinds the judge knows (spike / wave / beam /
// orb); `v` = visual name for the client (first letter of a hydra visual = the head). Every pattern leaves a way through and its
// orbs lie on that way; lane changes required inside a pattern stay ≥ 0.45 s apart even at the fastest speed.
import { HYDRA_ADDS } from "./raid3_hydra_adds.js";
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const free = (hit) => L3.filter((x) => !hit.includes(x));
function core(n, gap) {          // the creature is open: a run of strike orbs, every second one high
  return (r) => { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * gap, i % 2 === 1)); l = pick(r, others(l)); } return [0.7 + n * gap + 0.2, ev]; };
}

// ---------------------------------------------------------------- the hydra's three heads
export const HEADS = ["c", "m", "g"];
export function hydraOrder(seed) { const k = (seed >>> 0) % 3; return [HEADS[k], HEADS[(k + 1) % 3], HEADS[(k + 2) % 3]]; }
const alive = (d, p) => (d && d.order ? d.order : HEADS).slice(p);
// one head's attack starting at t0; returns [end, events]
function ray(r, t0, p, start) {          // cyan: a ray down one lane (two in later phases), three judged moments over 0.5 s
  const a = start != null ? start : lane(r), hit = p ? [a, pick(r, others(a))] : [a], f = pick(r, free(hit));
  return [t0 + 0.5, [sp(hit, t0, "c_ray"), sp(hit, t0 + 0.25, "c_ray2"), sp(hit, t0 + 0.5, "c_ray2"), orb(f, t0 + 0.25)]];
}
function hop(r, t0, n, k, first) {       // magenta: a sphere bouncing lane to lane; the orb waits where it landed before
  const ev = []; let prev = null, cur = first != null ? first : lane(r);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * k;
    ev.push(sp([cur], t, i ? "m_hop" : "m_hop1"));
    if (prev !== null) ev.push(orb(prev, t));
    prev = cur; cur = pick(r, others(cur));
  }
  return [t0 + (n - 1) * k, ev];
}
function toss(r, t0, hi, last = true) {  // gold: a glaive across the road — low = jump (high orb on top), high = slide (orb after)
  if (hi) { const l = lane(r); return [t0 + 0.7, last ? [beam(L3, t0, "g_high"), orb(l, t0 + 0.7)] : [beam(L3, t0, "g_high")]]; }
  return [t0, [wave(t0, "g_low"), orb(lane(r), t0, true)]];
}
function solo(r, h, t0, p) {
  if (h === "c") {               // later phases: a second ray right after, on the lane that was free (move!)
    const [e1, ev1] = ray(r, t0, p);
    if (!p) return [e1, ev1];
    const was = ev1.find((e) => e.k === "orb").lane, [e2, ev2] = ray(r, e1 + 0.5, p - 1, was);
    return [e2, ev1.concat(ev2)];
  }
  if (h === "m") return hop(r, t0, 3 + p, 0.62);
  const n = p ? 3 : 2, ev = []; let end = t0, hi = r() < 0.5;
  for (let i = 0; i < n; i++) { const [e, list] = toss(r, t0 + i * 0.85, hi, i === n - 1); ev.push(...list); end = e; hi = !hi; }
  return [end, ev];
}
// head h for a pattern of head `want`: the wanted one if it lives, otherwise one of the living (the survivors take over)
function headFor(r, d, p, want) { const al = alive(d, p); return al.includes(want) ? want : pick(r, al); }

// 2.5 «Полёт»: the entry of every new phase — the ball becomes a crystal glider and flies between the necks. One mode event
// (the judge ignores it: lanes, U = climb (high), D = dive (slide) are the usual body, so it is as fair as the run), then:
// fl_wall a rift wall from the ground (climb), fl_neck a neck arching over the road (dive), fl_bite heads lunge into lanes
// (move), fl_wind a gust that carries everybody one lane (a warp) with the orb where it carries you.
function flight(r, p) {
  const ev = [{ k: "mode", t: 0.3, until: 0.3, mode: "glider", v: "fl_glider", lanes: [] }], n = p >= 2 ? 7 : 6, gap = p >= 2 ? 1.6 : 1.45; let t = 2.4;   // (the speed of later phases shortens it)
  for (let i = 0; i < n; i++) {
    const k = i === 0 ? 0 : Math.floor(r() * 4) % 4;
    if (k === 0) ev.push(wave(t, "fl_wall"), orb(lane(r), t, true));
    else if (k === 1) ev.push(beam(L3, t, "fl_neck"), orb(lane(r), t + 0.75));
    else if (k === 2) { const f = lane(r), hit = i % 2 ? others(f) : [pick(r, others(f))]; ev.push(sp(hit, t, "fl_bite"), orb(f, t)); }
    else { const map = r() < 0.5 ? [1, 2, 2] : [0, 0, 1]; ev.push({ k: "warp", t, map, v: "fl_wind" }, orb(map[1], t + 0.65)); }
    t += gap;
  }
  ev[0].until = t + 0.2;
  return [t + 0.6, ev];
}

const HYDRA = {
  phases: [0.67, 0.34],          // phase = how many heads are beaten
  enter: { 1: "flight", 2: "flight" },
  speed: [1, 0.88, 0.78],        // every beaten head makes the others faster
  init(d, seed) { d.order = hydraOrder(seed); },
  list: [
    { id: "ray", w: [3, 2, 2], f(r, p, d) { const [e, ev] = solo(r, headFor(r, d, p, "c"), 1.1, p); return [e + 0.6, ev]; } },
    { id: "hop", w: [3, 2, 2], f(r, p, d) { const [e, ev] = solo(r, headFor(r, d, p, "m"), 1.1, p); return [e + 0.6, ev]; } },
    { id: "throw", w: [3, 2, 2], f(r, p, d) { const [e, ev] = solo(r, headFor(r, d, p, "g"), 1.1, p); return [e + 0.6, ev]; } },
    { id: "bite", w: [1, 2, 3], f(r, p, d) {
      // «тройной укус»: every living head in turn (the last head alone bites three times)
      let hs = alive(d, p).slice(); for (let i = hs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [hs[i], hs[j]] = [hs[j], hs[i]]; }
      if (hs.length === 1) hs = [hs[0], hs[0], hs[0]]; else if (hs.length === 2) hs.push(hs[0]);
      const ev = []; let t = 1.1;
      for (const h of hs) {
        let e, list;
        if (h === "c") [e, list] = ray(r, t, 0);
        else if (h === "m") [e, list] = hop(r, t, 2, 0.62);
        else [e, list] = toss(r, t, r() < 0.5);
        ev.push(...list); t = e + 0.95;
      }
      return [t - 0.35, ev];
    } },
    { id: "duo", w: [1, 3, 0], f(r, p, d) {
      // связки: two heads at once — the dodge of one is the way through the other
      const al = alive(d, p);
      if (al.length < 2) { const [e, ev] = solo(r, al[0], 1.1, p); return [e + 0.6, ev]; }
      const pair = [...al].sort().slice(0, 3), has = (h) => pair.includes(h);
      const combos = []; if (has("c") && has("g")) combos.push("cg"); if (has("c") && has("m")) combos.push("cm"); if (has("m") && has("g")) combos.push("mg");
      const c = pick(r, combos), t0 = 1.1;
      if (c === "cg") {          // ray on a lane + a low glaive in the middle of it: jump in a free lane, the orb is up there
        const a = lane(r), f = pick(r, others(a));
        return [t0 + 1.1, [sp([a], t0, "c_ray"), sp([a], t0 + 0.25, "c_ray2"), sp([a], t0 + 0.5, "c_ray2"), wave(t0 + 0.25, "g_low"), orb(f, t0 + 0.25, true)]];
      }
      if (c === "cm") {          // ray on a, the sphere lands on b: stand in the third lane, then the sphere lands there → go to b
        const a = lane(r), b = pick(r, others(a)), x = free([a, b])[0];
        return [t0 + 1.2, [sp([a], t0, "c_ray"), sp([a], t0 + 0.25, "c_ray2"), sp([a], t0 + 0.5, "c_ray2"), sp([b], t0 + 0.25, "m_hop1"), orb(x, t0 + 0.25), sp([x], t0 + 0.87, "m_hop"), orb(b, t0 + 0.87)]];
      }
      // mg: a landing, a high glaive (slide), a landing again — the orb waits in the first crater
      const a = lane(r), b = pick(r, others(a));
      return [t0 + 1.7, [sp([a], t0, "m_hop1"), orb(b, t0), beam(L3, t0 + 0.6, "g_high"), sp([b], t0 + 1.24, "m_hop"), orb(a, t0 + 1.24)]];
    } },
    { id: "core", w: [1, 1, 1], f: core(4, 0.8) },
    { id: "flight", w: [0, 0, 0], f(r, p) { return flight(r, p); } },
  ],
};

// ---------------------------------------------------------------- minions (days 1–4): raid3_hydra_adds.js (v3, all-new attacks)
export const HYDRA_PAT = { hydra: HYDRA, ...HYDRA_ADDS };
