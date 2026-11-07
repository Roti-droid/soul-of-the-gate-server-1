// raid3_titan_adds.js — attack patterns of the Crystal Titan's minions (days 1–4), v3 (owner 06.11: all-new attacks):
//   golem  «Осколочный голем»  — fault  (a rift opens holes lane after lane), swing (a slab on a chain: low pass, then high),
//                                hurl   (a boulder lands, ricochets to another lane and bursts into a low shard ridge),
//                                quarry (phase 2: a hole + a slab + a boulder at once — pick your dodge);
//   hound  «Кварцевая гончая»  — pack   (two phantom hounds charge down two lanes, then the third down the free one),
//                                snap   (quartz jaws close in one lane while it mauls another: jump the jaws or the free lane),
//                                leap   (it leaps over the road at chest height and lands in a lane, phase 2: the landing ridge),
//                                frenzy (phase 2: jaws, then the pack);
//   weaver «Призменный ткач»   — harp   (strings across the road: high – low – high), nets (webs over two lanes: jump them),
//                                yank   (it yanks its threads: the road carries everybody a lane, then a lance in the edge lane),
//                                cradle (phase 2: nets + a low string);
//   warden «Страж Резонанса»   — knell  (the bell cracks the middle lane, then the two outer ones), tuning (a fork prong + its
//                                humming string, then they swap lanes), shove (the toll pushes everybody a lane + the echo ridge),
//                                requiem (phase 2: knell + tuning).
// Pure data for raid3_rules.js (merged into its PAT table there; `golem` here replaces the stage-1 golem). Atomic kinds only
// (spike / wave / beam / pit / warp / orb, judged on the server); `v` = the picture for the client (src/raid3_adds_th.js).
// Every pattern leaves a way through and puts its strike orbs on that way; lane changes inside a pattern are ≥ 0.5 s apart,
// two jumps ≥ 0.7 s apart (a jump lasts 0.66 s).
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
const SIDE = [[0, 0, 1], [1, 2, 2]];          // a warp that carries everybody one lane left / right (the edge lane stays)
// a chain of strike orbs (the enemy's core is open): never the same lane twice in a row
function chain(r, n, k, hiEvery) { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * k, i % hiEvery === hiEvery - 1)); l = pick(r, others(l)); } return [0.7 + n * k + 0.2, ev]; }

export const TITAN_ADDS = {
  golem: {
    phases: [0.5],
    list: [
      // «Разлом»: both fists into the ground, a rift runs at the runner and opens a hole in lane a (jump it, the orb is above),
      // then in lane b; phase 2: a third hole
      { id: "fault", w: [3, 2], f(r, p) {
        const a = lane(r), b = pick(r, others(a)), ev = [pit([a], 1.0, "gm_rift"), orb(a, 1.0, true), pit([b], 1.6, "gm_rift"), orb(pick(r, others(b)), 1.6)];
        if (p) { const c = pick(r, others(b)); ev.push(pit([c], 2.3, "gm_rift"), orb(c, 2.3, true)); }
        return [p ? 2.8 : 2.1, ev];
      } },
      // «Маятник»: a crystal slab on a chain from his fist — the first pass sweeps low (jump), the back pass chest-high (slide)
      { id: "swing", w: [2, 2], f(r, p) {
        const l = lane(r), m = pick(r, others(l)), ev = [wave(1.0, "gm_slab_lo"), orb(l, 1.0, true), beam(L3, 1.8, "gm_slab_hi")];
        if (p) ev.push(wave(2.6, "gm_slab_lo"), orb(m, 2.6, true)); else ev.push(orb(m, 2.45));
        return [p ? 3.1 : 2.8, ev];
      } },
      // «Рикошет»: a boulder lands in lane a, bounces into lane b, then bursts into a low ridge of shards (jump)
      { id: "hurl", w: [2, 2], f(r) {
        const a = lane(r), b = pick(r, others(a)), c = third(a, b);
        return [2.7, [sp([a], 1.0, "gm_boulder"), orb(c, 1.0), sp([b], 1.6, "gm_ricochet"), orb(c, 1.6), wave(2.3, "gm_shards"), orb(pick(r, L3), 2.3, true)]];
      } },
      // «Каменоломня» (phase 2): a hole, a slab and a boulder at once — jump in the hole's lane (the orb is above) or slide under
      // the slab; then the shard ridge
      { id: "quarry", w: [0, 2], f(r) {
        const a = lane(r), b = pick(r, others(a)), c = third(a, b);
        return [2.4, [pit([a], 1.0, "gm_rift"), beam([b], 1.0, "gm_slab_hi"), sp([c], 1.0, "gm_boulder"), orb(a, 1.0, true), wave(1.8, "gm_shards"), orb(pick(r, L3), 1.8, true)]];
      } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.8, 4); } },
    ],
  },
  hound: {
    phases: [0.5],
    list: [
      // «Призрачная стая»: two phantom hounds charge down two lanes, the third one down the lane that was free
      { id: "pack", w: [3, 2], f(r, p) {
        const f = lane(r), x = pick(r, others(f)), ev = [sp(others(f), 1.0, "hd_phantom"), orb(f, 1.0), sp([f], 1.6, "hd_phantom"), orb(x, 1.6)];
        if (p) { const y = pick(r, others(x)); ev.push(sp(others(y), 2.2, "hd_phantom"), orb(y, 2.2)); }
        return [p ? 2.7 : 2.1, ev];
      } },
      // «Капкан»: quartz jaws snap shut in lane a (jump over them — the orb is above) while it mauls lane b; lane c is free
      { id: "snap", w: [2, 2], f(r, p) {
        const a = lane(r), b = pick(r, others(a)), ev = [pit([a], 1.0, "hd_jaws"), sp([b], 1.0, "hd_maul"), orb(a, 1.0, true)];
        if (p) { const a2 = pick(r, others(a)), b2 = third(a, a2); ev.push(pit([a2], 1.75, "hd_jaws"), sp([b2], 1.75, "hd_maul"), orb(a2, 1.75, true)); }
        return [p ? 2.3 : 1.7, ev];
      } },
      // «Прыжок»: it leaps over the road — its body passes chest-high (slide) — and lands in lane x; phase 2: the landing ridge
      { id: "leap", w: [2, 2], f(r, p) {
        const x = lane(r), f = pick(r, others(x)), ev = [beam(L3, 1.0, "hd_leap"), sp([x], 1.65, "hd_land"), orb(f, 1.65)];
        if (p) ev.push(wave(2.4, "hd_ridge"), orb(pick(r, L3), 2.4, true));
        return [p ? 2.9 : 2.2, ev];
      } },
      // «Неистовство» (phase 2): the jaws, then the pack
      { id: "frenzy", w: [0, 2], f(r) {
        const a = lane(r), b = pick(r, others(a)), c = third(a, b);
        return [2.4, [pit([a], 1.0, "hd_jaws"), sp([b], 1.0, "hd_maul"), orb(c, 1.0), sp(others(a), 1.65, "hd_phantom"), orb(a, 1.65)]];
      } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.8, 4); } },
    ],
  },
  weaver: {
    phases: [0.5],
    list: [
      // «Арфа»: light strings across the road — high (slide), low (jump), phase 2: high again
      { id: "harp", w: [3, 2], f(r, p) {
        const l = lane(r), m = pick(r, others(l)), ev = [beam(L3, 1.0, "wv_str_hi"), wave(1.85, "wv_str_lo"), orb(l, 1.85, true)];
        if (p) ev.push(beam(L3, 2.7, "wv_str_hi"), orb(m, 3.3)); else ev.push(orb(m, 2.5));
        return [p ? 3.6 : 2.8, ev];
      } },
      // «Сети»: webs fall over two lanes — jump them (the orb waits above one) or take the free lane; phase 2: again elsewhere
      { id: "nets", w: [2, 2], f(r, p) {
        const f = lane(r), a = pick(r, others(f)), ev = [pit(others(f), 1.0, "wv_net"), orb(a, 1.0, true)];
        if (p) { const g = pick(r, others(f)), b = pick(r, others(g)); ev.push(pit(others(g), 1.8, "wv_net"), orb(b, 1.8, true)); }
        return [p ? 2.4 : 1.7, ev];
      } },
      // «Рывок»: it yanks the threads hooked into the road — everybody is carried one lane — and a prism lance bursts in the edge
      // lane they were carried to (move away; the orb is in the middle)
      { id: "yank", w: [2, 2], f(r) {
        const s = r() < 0.5 ? 0 : 1, edge = s ? 2 : 0;
        return [2.3, [warp(SIDE[s], 1.0, "wv_yank"), sp([edge], 1.65, "wv_lance"), orb(1, 1.65)]];
      } },
      // «Колыбель» (phase 2): nets, then a low string
      { id: "cradle", w: [0, 2], f(r) {
        const f = lane(r), a = pick(r, others(f));
        return [2.3, [pit(others(f), 1.0, "wv_net"), orb(a, 1.0, true), wave(1.8, "wv_str_lo"), orb(pick(r, L3), 1.8, true)]];
      } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.8, 2); } },
    ],
  },
  warden: {
    phases: [0.5],
    list: [
      // «Набат»: the bell cracks the middle lane (an outer lane is safe), then the two outer lanes (the middle is safe);
      // phase 2: the middle again (jump it, the orb is above)
      { id: "knell", w: [3, 2], f(r, p) {
        const o = r() < 0.5 ? 0 : 2, ev = [pit([1], 1.0, "wd_knell"), orb(o, 1.0), pit([0, 2], 1.6, "wd_knell"), orb(1, 1.6)];
        if (p) ev.push(pit([1], 2.35, "wd_knell"), orb(1, 2.35, true));
        return [p ? 2.8 : 2.1, ev];
      } },
      // «Камертон»: a fork prong in lane a and its humming string in lane b (slide), lane c free — then they move on
      // (prong → c, string → a): go to b; phase 2: once more (prong → b, string → c)
      { id: "tuning", w: [2, 2], f(r, p) {
        const a = lane(r), b = pick(r, others(a)), c = third(a, b), ev = [sp([a], 1.0, "wd_prong"), beam([b], 1.0, "wd_hum"), orb(c, 1.0), sp([c], 1.6, "wd_prong"), beam([a], 1.6, "wd_hum"), orb(b, 1.6)];
        if (p) ev.push(sp([b], 2.2, "wd_prong"), beam([c], 2.2, "wd_hum"), orb(a, 2.2));
        return [p ? 2.7 : 2.1, ev];
      } },
      // «Толчок»: the toll pushes everybody one lane, then its echo runs down the road low (jump)
      { id: "shove", w: [2, 2], f(r, p) {
        const s = r() < 0.5 ? 0 : 1, ev = [warp(SIDE[s], 1.0, "wd_shove"), wave(1.65, "wd_echo"), orb(s ? 2 : 0, 1.65, true)];
        if (p) ev.push(warp(SIDE[1 - s], 2.35, "wd_shove"), orb(1, 2.9));
        return [p ? 3.2 : 2.2, ev];
      } },
      // «Реквием» (phase 2): the middle cracks, then the fork (prong in one outer lane, string in the other)
      { id: "requiem", w: [0, 2], f(r) {
        const o = r() < 0.5 ? 0 : 2, q = 2 - o;
        return [2.3, [pit([1], 1.0, "wd_knell"), orb(o, 1.0), sp([o], 1.6, "wd_prong"), beam([q], 1.6, "wd_hum"), orb(1, 1.6)]];
      } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.8, 3); } },
    ],
  },
};

// every pattern ends with a short breath (the arena is calm for a moment: the minion recovers, the round marks clear)
const BREATH = 0.6;
for (const pat of Object.values(TITAN_ADDS)) for (const it of pat.list) { const f0 = it.f; it.f = (r, p, d) => { const [len, ev] = f0(r, p, d); return [len + BREATH, ev]; }; }
