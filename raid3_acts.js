// raid3_acts.js — 2.3.12 the interactions of every enemy (owner: «что интересного здесь игрокам?», «все идеи, в меру»): each enemy
// and each of its phases get 2–3 things to DO that a runner does not have. Judged on the server (raid3_rules.js judgeAct, the team
// kinds in raid3.js); every one is optional or dodgeable, telegraphed ≥ 1 s, and never stands in a hazard at the same moment.
//   v names are the enemy's own pictures (src/raid3_acts_fx.js draws them); old clients see marks on the lanes and ignore them.
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const orb = (l, t, hi) => ({ k: "orb", lane: l, t, hi: !!hi, v: "orb" });
const corb = (c, rw, t) => ({ k: "orb", lane: c, row: rw, t, hi: false, v: "orb" });
const P = (lanes, t, v, o) => Object.assign({ k: "pick", lanes, t, v }, o || {});
const PC = (cell, t, v, o) => Object.assign({ k: "pick", cells: [cell], t, v }, o || {});
const HOLD = (lanes, t, d, v, x) => ({ k: "hold", lanes, t, d, v, x });
const HOLDC = (cell, t, d, v, x) => ({ k: "hold", cells: [cell], t, d, v, x });
const ALL = []; for (const rw of L3) for (const c of L3) ALL.push([c, rw]);
const near1 = (c) => ALL.filter((x) => Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) === 1);
const pickC = (r) => ALL[Math.floor(r() * 9) % 9];

// ---------------------------------------------------------------- per enemy: extra patterns (weights per phase) + phase hooks
const ACTS = {
  // the Titan: «Руна под ногой» — stand on the rune under his raised foot (1.2 s) → he stumbles ×4; «Трещина» — everybody on the
  // cracked lane → it splits under him ×3 (co-op; alone it is yours)
  titan: [
    { id: "rune", w: [1, 1, 1], f(r) { const l = lane(r); return [2.6, [HOLD([l], 2.0, 1.2, "ti_rune", 4), orb(pick(r, others(l)), 0.75)]]; } },
    { id: "crack", w: [0, 1, 1], f(r) { const l = lane(r); return [2.4, [{ k: "coop", lanes: [l], t: 1.8, v: "ti_crack", x: 3 }, orb(pick(r, others(l)), 0.75)]]; } },
  ],
  // the golem: «Отбой» — jump onto the back of the boulder as it rolls past (×3); «Ядро» — a core crystal falls off him: a charge
  golem: [
    { id: "rebound", w: [1, 1], f(r) { const l = lane(r); return [2.4, [{ k: "spike", lanes: [l], t: 1.3, v: "gm_roll" }, orb(pick(r, others(l)), 1.3), P([l], 1.85, "gm_rebound", { hi: 1, x: 3 })]]; } },
    { id: "corefall", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "gm_core", { item: "charge", x: 0 })]]; } },
  ],
  // the hound: «Приманка» — stay on the bait 1.4 s, it bites the bait (×3); «Хвост» — slide under it and grab the tail (×3)
  hound: [
    { id: "bait", w: [1, 1], f(r) { const l = lane(r); return [2.8, [HOLD([l], 2.2, 1.4, "hd_bait", 3)]]; } },
    { id: "tail", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "hd_tail", { lo: 1, x: 3 })]]; } },
  ],
  // the weaver: «Нить» — slide through a thread and it wraps you in silk (a shield for one hit); «Хор призм» — everybody on the
  // prism lanes → the beams join on it ×3
  weaver: [
    { id: "thread", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "wv_thread", { lo: 1, item: "shield", x: 1 })]]; } },
    { id: "choir", w: [1, 1], f(r) { const f = lane(r); return [2.4, [{ k: "coop", lanes: others(f), t: 1.8, v: "wv_choir", x: 3 }]]; } },
  ],
  // the warden: the chord (3 strikes on the beat in a row, raid3.js); «Колокольчик» — a bell rings in a lane on a beat: jump to it
  warden: [
    { id: "bell", w: [1, 1], f(r) { const l = lane(r), B = 0.8; return [4 * B + 0.55, [P([l], 2 * B, "wd_bell", { hi: 1, item: "charge", x: 1 })], { beats: [0, 0.8, 1.6, 2.4, 3.2] }]; } },
  ],
  // the Hydra's deck (the coordinator's design): «Пушка» — stand on the cannon 1.5 s, it fires at a head ×8; «Хват» — a head grabs
  // a cell: leave it or have a teammate next to you; «Бочка» — step onto the barrel's cell from the row behind: it rolls into a
  // head ×5; «Гарпун» — take it, the next strike swipe throws it ×8; «Все на метки!» — everybody on the gold cells ×3
  hydra: [
    { id: "cannon", w: [1, 1, 1], f(r) { const c = pickC(r); return [2.9, [HOLDC(c, 2.3, 1.5, "hy_cannon", 8)]]; } },
    { id: "grab", w: [1, 1, 1], f(r) { const c = pickC(r), o = pick(r, ALL.filter((x) => x[0] !== c[0] || x[1] !== c[1])); return [2.4, [{ k: "grab", cells: [c], t: 1.5, v: "hy_grab" }, corb(o[0], o[1], 1.5)]]; } },
    { id: "barrel", w: [1, 1, 1], f(r) { const c = [lane(r), 1 + (Math.floor(r() * 2) % 2)]; return [2.4, [{ k: "push", cells: [c], t: 1.8, v: "hy_barrel", x: 5 }]]; } },
    { id: "harpoon", w: [1, 1, 1], f(r) { const c = pickC(r); return [2.0, [PC(c, 1.3, "hy_harpoon", { item: "harpoon", x: 0 })]]; } },
    { id: "coopc", w: [0, 1, 1], f(r) { const c = pickC(r), cs = [c, ...near1(c).slice(0, 2)]; return [2.4, [{ k: "coop", cells: cs, t: 1.8, v: "hy_coop", x: 3 }]]; } },
    { id: "tilt", w: [1, 1, 1], f(r) { const map = r() < 0.5 ? [0, 0, 1] : [1, 2, 2]; return [2.4, [{ k: "tilt", t: 1.6, map, v: "hy_tilt", lanes: [] }]]; } },
  ],
  // the spawn: «Кладка» — slide over the eggs and crush them (×2); «Гнездо» — stand 1.2 s by the main one's nest (×3)
  spawn: [
    { id: "eggs", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "sp_egg", { lo: 1, x: 2 })]]; } },
    { id: "nest", w: [1, 1], f(r) { const l = lane(r); return [2.8, [HOLD([l], 2.2, 1.2, "sp_nest", 3)], { tgts: [[0.3, 2.8, l]] }]; } },
  ],
  // the eel: «Воздух» — bubbles in two lanes, then the breath (no bubble = −♥); «Плавник» — jump over its fin as it passes (×3)
  eel: [
    { id: "air", w: [2, 2], f(r) { const a = lane(r), b = pick(r, others(a)); return [3.2, [P([a], 1.0, "el_bubble", { item: "air", x: 0 }), P([b], 1.7, "el_bubble", { item: "air", x: 0 }), { k: "breath", t: 2.7, v: "el_breath", lanes: [] }]]; } },
    { id: "fin", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "el_fin", { hi: 1, x: 3 })]]; } },
  ],
  // the spitter: «Нейтрализатор» — a crystal that takes one acid hit (a shield); «Отбить» — jump into the glob in the air (×3)
  spitter: [
    { id: "neutral", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "spt_crystal", { item: "shield", x: 0 })]]; } },
    { id: "reflect", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "spt_reflect", { hi: 1, x: 3 })]]; } },
  ],
  // the coil: «Чешуя» — jump and tear off a loose scale (×3); «Удержаться» — keep to the lane 1.2 s while the spiral turns (×3)
  coil: [
    { id: "scale", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "cl_scale", { hi: 1, x: 3 })]]; } },
    { id: "cling", w: [1, 1], f(r) { const l = lane(r); return [2.8, [HOLD([l], 2.2, 1.2, "cl_hold", 3)]]; } },
  ],
  // the Void Knight: the breach (4 clean parries in a row → the next strike ×2, raid3.js); «Удар щитом» — he bashes low: parry ↓ (×4)
  voidknight: [
    { id: "bash", w: [1, 1, 1], f() { return [2.2, [{ k: "parry", dir: "D", t: 1.5, v: "vk_bash", x: 4, lanes: [1] }]]; } },
  ],
  // the squire: «Поймать щит» — jump and catch a returning shield (it guards you once); «Подножка» — slide into his legs (×3)
  squire: [
    { id: "catch", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "sq_catch", { hi: 1, item: "shield", x: 1 })]]; } },
    { id: "trip", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "sq_trip", { lo: 1, x: 3 })]]; } },
  ],
  // the lancer: «Обломок» — a broken lance tip: a charge; «Строй» — everybody off the lance lane → the charge breaks on you (×2)
  lancer: [
    { id: "shard", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "ln_shard", { item: "charge", x: 0 })]]; } },
    { id: "rally", w: [1, 1], f(r) { const a = lane(r); return [2.6, [{ k: "clash", lanes: [a], t: 1.6, v: "ln_clash", x: 3 }, { k: "coop", lanes: others(a), t: 1.6, v: "ln_rally", x: 2 }]]; } },
  ],
  // the shade: «Огонёк» — a light (a charge); «Фонарь» — stand in the lamp light 1.2 s, the shade burns (×3)
  shade: [
    { id: "light", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "sh_light", { item: "charge", x: 0 })]]; } },
    { id: "lamp", w: [1, 1], f(r) { const l = lane(r); return [2.8, [HOLD([l], 2.2, 1.2, "sh_lamp", 3)]]; } },
  ],
  // the herald: «Разбить зеркало» — jump into the mirror shard (×4); «Тишина» — stand still 1.4 s and his toll breaks (×3)
  herald: [
    { id: "break", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "hr_break", { hi: 1, x: 4 })]]; } },
    { id: "still", w: [1, 1], f(r) { const l = lane(r); return [3.0, [HOLD([l], 2.4, 1.4, "hr_still", 3)]]; } },
  ],
  // the Heart (zero-g): «Вена» — fly through a vein ring (a charge); «Синхрон» — the whole team through one cell (×4)
  heart: [
    { id: "veinring", w: [1, 1, 1], f(r) { const c = pickC(r); return [2.0, [PC(c, 1.4, "ht_vein", { item: "charge", x: 0 })]]; } },
    { id: "sync", w: [1, 1, 1], f(r) { const c = pickC(r); return [2.4, [{ k: "coop", cells: [c], t: 1.8, v: "ht_sync", x: 4 }]]; } },
  ],
  // the pulse: «Плитка» — stay on the beating tile 1.4 s (×3); «Толчок» — jump on the pulse (×2)
  pulse: [
    { id: "tile", w: [1, 1], f(r) { const l = lane(r); return [3.0, [HOLD([l], 2.4, 1.4, "pu_tile", 3)]]; } },
    { id: "kick", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "pu_kick", { hi: 1, x: 2 })]]; } },
  ],
  // the vein: «Сгусток» — turn into a clot and knock it away (×3); «Клапан» — everybody on the two valve positions (×3)
  vein: [
    { id: "clot", w: [1, 1], f(r) { const p = Math.floor(r() * 6) % 6; return [2.0, [P([p], 1.3, "vn_clot2", { x: 3 })]]; } },
    { id: "valve", w: [1, 1], f(r) { const p = Math.floor(r() * 3) % 3; return [2.4, [{ k: "coop", lanes: [p, p + 3], t: 1.8, v: "vn_valve2", x: 3 }]]; } },
  ],
  // the echo: «Обман» — stand in a lane, then leave it: the echo strikes there 2 s later and hits itself (×4); «Осколок» — a shield
  echo: [
    { id: "lure", w: [1, 1], f(r) { const l = lane(r); return [3.4, [orb(l, 0.8), { k: "lure", lanes: [l], t: 2.8, d: 2, v: "ec_lure", x: 4 }, orb(pick(r, others(l)), 2.8)]]; } },
    { id: "shard", w: [1, 1], f(r) { const l = lane(r); return [2.0, [P([l], 1.3, "ec_shard", { item: "shield", x: 0 })]]; } },
  ],
  // the keeper (the sky): «Поток» — an updraft in the top row (a charge); «Печать» — hold a seal cell 1.6 s (×4)
  keeper: [
    { id: "draft", w: [1, 1], f(r) { const c = [lane(r), 2]; return [2.0, [PC(c, 1.4, "kp_draft", { item: "charge", x: 0 })]]; } },
    { id: "seal", w: [1, 1], f(r) { const c = pickC(r); return [3.0, [HOLDC(c, 2.4, 1.6, "kp_seal", 4)]]; } },
  ],
};
// the phases of movement: some of their ◆ become the phase's own things to take
const PHASE = {
  chase: (ev, r) => convert(ev, r, 3, (e) => P([e.lane], e.t, "ch_boost", { item: "charge", x: 1 })),
  shatter: (ev, r) => convert(ev, r, 3, (e) => P([e.lane], e.t, "pl_lever", { x: 4 })),
  gallop: (ev, r) => addBetween(ev, "parry", 3, (t) => P([1], t, "vk_soul", { item: "charge", x: 0 })),
  blades: (ev, r) => addBetween(ev, "parry", 4, (t) => P([1], t, "vk_soul", { item: "charge", x: 0 })),
  arrhythmia: (ev, r) => convert(ev, r, 3, (e) => PC([e.lane, e.row], e.t, "ht_vein", { item: "charge", x: 1 })),
  arrest: (ev, r) => convert(ev, r, 3, (e) => PC([e.lane, e.row], e.t, "ht_vein", { item: "charge", x: 1 })),
  storm: (ev, r) => {   // the storm tilts the deck between the strikes (hold on with a tap)
    const cs = ev.filter((e) => e.k === "cell").map((e) => e.t), out = [];
    for (let i = 2; i < cs.length - 1; i += 4) out.push({ k: "tilt", t: Math.round((cs[i] + 0.65) * 100) / 100, map: r() < 0.5 ? [0, 0, 1] : [1, 2, 2], v: "hy_tilt", lanes: [] });
    return ev.concat(out);
  },
};
function convert(ev, r, every, mk) { let n = 0; return ev.map((e) => (e.k === "orb" && !e.hi && ++n % every === 0 ? mk(e) : e)); }
function addBetween(ev, kind, every, mk) {
  const ts = ev.filter((e) => e.k === kind).map((e) => e.t).sort((a, b) => a - b), out = ev.slice();
  for (let i = every; i < ts.length; i += every) out.push(mk(Math.round(((ts[i - 1] + ts[i]) / 2) * 100) / 100));
  return out;
}
export function addActs(PAT) {
  for (const id in ACTS) { if (!PAT[id]) continue; for (const it of ACTS[id]) { const n = PAT[id].phases.length + 1; const w = it.w.slice(0, n); while (w.length < n) w.push(w[w.length - 1]); PAT[id].list.push({ id: "act_" + it.id, w, f: it.f, act: 1 }); } }
  for (const id in PAT) for (const it of PAT[id].list) {
    const hook = PHASE[it.id]; if (!hook || it._acts) continue; it._acts = 1;
    const f0 = it.f; it.f = (r, p, d) => { const x = f0(r, p, d); if (d && d.acts) x[1] = hook(x[1], r); return x; };   // only with the interactions on (RAID3_ACTS=1)
  }
}
export { ACTS };
