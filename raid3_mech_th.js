// raid3_mech_th.js — 2.3.11 «переделка»: the Crystal Titan's week, every enemy with its OWN mechanic (owner's list, 06.11):
//   titan   the fight (raid3_rules.js PAT.titan) + «Погоня!» (the bike chase, ~22 s, he runs and throws the cavern) + «Обвал!»
//           (the finale, ~22 s: he breaks the floor, the road shatters into plates — jump across the surviving ones)
//   golem   «Валун»: he curls into a boulder and rolls at you, bouncing off the walls (its arrival lane = the end of its zigzag),
//           then rolls back up and comes again; between the rolls he stands up dizzy (open) and stamps
//   hound   «Погоня сзади»: it chases from behind — the camera looks back, every attack flies at your back
//   weaver  «Призмы»: laser beams between prisms lie across the road (jump them / take the free lane); a jump in a prism's lane
//           turns the prism so the beam hits the Weaver (◆ ×3 «prism»)
//   warden  «Ритм»: a rhythm fight — beats every 0.6 s; his attacks land on the beat; a strike on the beat = ×2, and swipe ↑ on the
//           beat with no charge still hits (one ◆)
// Pure data merged into PAT of raid3_rules.js (it replaces raid3_titan_adds.js for these four and extends the Titan).
const L3 = [0, 1, 2];
const others = (l) => L3.filter((x) => x !== l);
const lane = (r) => Math.floor(r() * 3) % 3;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const third = (a, b) => L3.find((x) => x !== a && x !== b);
const sp = (lanes, t, v) => ({ k: "spike", lanes: [...lanes].sort(), t, v });
const wave = (t, v) => ({ k: "wave", t, v });
const beam = (lanes, t, v) => ({ k: "beam", lanes: [...lanes].sort(), t, v });
const pit = (lanes, t, v) => ({ k: "pit", lanes: [...lanes].sort(), t, v });
const orb = (l, t, hi, x) => { const o = { k: "orb", lane: l, t, hi: !!hi, v: "orb" }; if (x) { o.x = x; o.v = "wv_prism"; } return o; };
const mode = (t, until, m, v) => ({ k: "mode", t, until, mode: m, v: v || m, lanes: [] });

// ---------------------------------------------------------------- the Titan's two phases (20–25 s each)
// «Погоня!» on the bike: gates (the free lane), ramps over a crevasse (jump), a thrown blade (slide), a boulder (lane)
function chaseLong(r, p) {
  const ev = [mode(0.3, 0, "bike", "bike")], n = 14, gap = p >= 2 ? 1.3 : 1.4; let t = 2.4;
  for (let i = 0; i < n; i++) {
    const k = i === 0 ? 0 : Math.floor(r() * 4) % 4;
    if (k === 0) { const f = lane(r); ev.push(sp(others(f), t, "ch_gate"), orb(f, t)); }
    else if (k === 1) ev.push(wave(t, "ch_ramp"), orb(lane(r), t + 0.55));
    else if (k === 2) ev.push(beam(L3, t, "ch_sweep"), orb(lane(r), t + 0.7));
    else { const a = lane(r); ev.push(sp([a], t, "ch_boulder"), orb(pick(r, others(a)), t)); }
    t += gap;
  }
  ev[0].until = t + 0.2;
  return [t + 0.6, ev];
}
// «Обвал!»: the floor breaks — rows of plates come at you; a crumbled plate = a pit in its lane, a crevasse across = jump;
// the ◆ sit on the surviving plates. Always one surviving plate (or a jump) per row; the rows are 1.1 s apart.
function shatter(r, p) {
  const ev = [mode(0.3, 0, "plates", "plates")], n = 18, gap = 1.1; let t = 2.6, keep = 1;
  for (let i = 0; i < n; i++) {
    if (i % 4 === 3) { ev.push(wave(t, "pl_gap"), orb(keep, t + 0.5)); }   // the crevasse across: jump onto the next row
    else {
      keep = i ? pick(r, [keep, ...others(keep).filter((x) => Math.abs(x - keep) === 1)]) : lane(r);   // the next plate ≤ 1 lane away
      ev.push(pit(others(keep), t, "pl_fall"), orb(keep, t));
    }
    t += gap;
  }
  ev[0].until = t + 0.2;
  return [t + 0.6, ev];
}

// ---------------------------------------------------------------- the four minions
// a chain of ◆ while the enemy is open
function chain(r, n, k) { let l = lane(r); const ev = []; for (let i = 0; i < n; i++) { ev.push(orb(l, 0.7 + i * k)); l = pick(r, others(l)); } return [0.7 + n * k + 0.2, ev]; }

export const MECH_TH = {
  titanExtra: { chaseLong, shatter },
  golem: {
    phases: [0.5],
    list: [
      // «Валун»: three rolls — each arrives in one lane (the zigzag off the walls shows which), the ◆ in the other two
      { id: "roll", w: [3, 3], f(r, p) {
        const ev = []; let a = lane(r); const n = p ? 3 : 2;
        for (let i = 0; i < n; i++) { const t = 1.4 + i * 1.15; ev.push(sp([a], t, "gm_roll"), orb(pick(r, others(a)), t)); a = pick(r, others(a)); }
        return [1.4 + n * 1.15, ev];
      } },
      // «Рикошет»: the boulder hits the row slantwise off a wall — the edge lane, then the middle 0.4 s later (go to the far edge)
      { id: "carom", w: [2, 2], f(r, p) {
        const s = r() < 0.5 ? 0 : 2, far = 2 - s, ev = [sp([s], 1.4, "gm_carom"), sp([1], 1.8, "gm_carom"), orb(far, 1.4), orb(far, 1.8)];
        if (p) ev.push(sp([far], 2.8, "gm_carom"), sp([1], 3.2, "gm_carom"), orb(s, 2.8), orb(s, 3.2));
        return [p ? 3.6 : 2.4, ev];
      } },
      // «Топот»: he stands up from the boulder and stamps — a ring of shards along the floor (jump), then the second foot
      { id: "stomp", w: [2, 2], f(r, p) {
        const ev = [wave(1.3, "gm_stomp"), orb(lane(r), 1.85)];
        if (p) ev.push(wave(2.5, "gm_stomp"), orb(lane(r), 3.05));
        return [p ? 3.3 : 2.1, ev];
      } },
      // «Лавина» (phase 2): the boulder bursts in two on a wall — two lanes at once, the third is free
      { id: "split", w: [0, 2], f(r) { const f = lane(r); return [2.2, [sp(others(f), 1.4, "gm_split"), orb(f, 1.4), orb(pick(r, others(f)), 2.0)]]; } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.75); } },
    ],
  },
  hound: {
    phases: [0.5], back: true,                // the client turns the camera to look back (the hound is behind)
    list: [
      // «Укус»: it lunges at your back in one lane, then again where you dodged to
      { id: "lunge", w: [3, 2], f(r, p) {
        const a = lane(r), b = pick(r, others(a)), ev = [sp([a], 1.3, "hd_lunge"), orb(b, 1.3), sp([b], 2.0, "hd_lunge"), orb(third(a, b), 2.0)];
        if (p) { const c = third(a, b); ev.push(sp([c], 2.7, "hd_lunge"), orb(a, 2.7)); }
        return [p ? 3.0 : 2.3, ev];
      } },
      // «Когти»: a low claw swipe across two lanes behind you (jump it or the free lane)
      { id: "rake", w: [2, 2], f(r, p) {
        const f = lane(r), ev = [pit(others(f), 1.3, "hd_rake"), orb(f, 1.3)];
        if (p) { const g = pick(r, others(f)); ev.push(pit(others(g), 2.1, "hd_rake"), orb(g, 2.1)); }
        return [p ? 2.4 : 1.6, ev];
      } },
      // «Прыжок»: it leaps over you — its body passes chest-high (slide) and lands ahead in a lane
      // (its body sweeps chest-high over two lanes — slide under it or take the third lane, where the ◆ is)
      { id: "vault", w: [2, 2], f(r) { const x = lane(r), f = lane(r); return [2.4, [beam(others(f), 1.3, "hd_vault"), orb(f, 1.3), sp([x], 2.05, "hd_land"), orb(pick(r, others(x)), 2.05)]]; } },
      // «Вой» (phase 2): a sonic ring from behind (jump), then the lunge
      { id: "howl", w: [0, 2], f(r) { const a = lane(r); return [2.4, [wave(1.3, "hd_howl"), orb(lane(r), 1.3, true), sp([a], 2.1, "hd_lunge"), orb(pick(r, others(a)), 2.1)]]; } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.75); } },
    ],
  },
  weaver: {
    phases: [0.5],
    list: [
      // «Луч»: a laser between two prisms lies over two lanes at the ground (jump it / the third lane); the prism in the third
      // lane: jump there and it turns the beam into the Weaver (◆ ×3)
      { id: "laser", w: [3, 3], f(r, p) {
        const f = lane(r), ev = [pit(others(f), 1.4, "wv_laser"), orb(f, 1.4, true, 3)];
        if (p) { const g = pick(r, others(f)); ev.push(pit(others(g), 2.3, "wv_laser"), orb(g, 2.3, true, 3)); }
        return [p ? 2.6 : 1.8, ev];
      } },
      // «Крест»: a high beam across all lanes (slide), then the low laser — the prism waits in the free lane
      { id: "cross", w: [2, 2], f(r) { const f = lane(r); return [2.6, [beam(L3, 1.3, "wv_high"), orb(pick(r, L3), 1.7), pit(others(f), 2.2, "wv_laser"), orb(f, 2.2, true, 3)]]; } },
      // «Веер»: the beam sweeps lane by lane (a pit moving across, 0.35 s apart) — run ahead of it to the last lane's prism
      { id: "fan", w: [2, 2], f(r) {
        const dir = r() < 0.5 ? [0, 1, 2] : [2, 1, 0], ev = [];
        ev.push(pit([dir[0]], 1.3, "wv_fan"), pit([dir[1]], 1.75, "wv_fan"), orb(dir[2], 1.3), orb(dir[2], 1.75, true, 3));
        return [2.2, ev];
      } },
      // «Призменная клетка» (phase 2): lasers over the two outer lanes, the middle prism, then the middle laser
      { id: "cage", w: [0, 2], f(r) { const o = r() < 0.5 ? 0 : 2; return [2.6, [pit([0, 2], 1.3, "wv_laser"), orb(1, 1.3, true, 3), pit([1], 2.2, "wv_laser"), orb(o, 2.2)]]; } },
      { id: "core", w: [1, 1], f(r) { return chain(r, 4, 0.75); } },
    ],
  },
  // 2.3.12: the beat is the music's — the Warden's theme (src/music_bosses.js 'warden', 150 BPM): a beat every half bar = 0.8 s
  warden: {
    phases: [0.5], beat: 0.8, speed: [1, 1], autoOpen: false,
    list: [
      // «Набат»: the bell cracks lanes ON THE BEAT: the middle, then the two outer lanes, ◆ on the beats
      { id: "knell", w: [3, 2], f(r, p) {
        const B = 0.8, o = r() < 0.5 ? 0 : 2, ev = [pit([1], 2 * B, "wd_knell"), orb(o, 2 * B), pit([0, 2], 3 * B, "wd_knell"), orb(1, 3 * B)];
        if (p) ev.push(pit([1], 4 * B, "wd_knell"), orb(2 - o, 4 * B));
        return [(p ? 5 : 4) * B, ev, { beats: beatsTo((p ? 5 : 4) * B) }];
      } },
      // «Камертон»: the fork rings on the beat — a prong in a lane and the hum (low: jump) over the road on the next beat
      { id: "fork", w: [2, 2], f(r) {
        const B = 0.8, a = lane(r), b = pick(r, others(a));
        return [4 * B, [sp([a], 2 * B, "wd_fork"), orb(b, 2 * B), wave(3 * B, "wd_hum"), orb(third(a, b), 3 * B, true)], { beats: beatsTo(4 * B) }];
      } },
      // «Аккорд»: three tolls on three beats in a row, each on another lane (the ◆ always where the toll is not)
      { id: "chord", w: [2, 2], f(r) {
        const B = 0.8, ev = []; let a = lane(r);
        for (let i = 0; i < 3; i++) { const t = (2 + i) * B; ev.push(sp([a], t, "wd_toll"), orb(pick(r, others(a)), t)); a = pick(r, others(a)); }
        return [5 * B, ev, { beats: beatsTo(5 * B) }];
      } },
      // «Реквием» (phase 2): the echo rings low over the road twice on the beat (jump, jump)
      { id: "requiem", w: [0, 2], f(r) { const B = 0.8; return [5 * B, [wave(2 * B, "wd_echo"), orb(lane(r), 2.5 * B), wave(3 * B, "wd_echo"), orb(lane(r), 4 * B)], { beats: beatsTo(5 * B) }]; } },
      { id: "core", w: [1, 1], f(r) { let l = lane(r); const ev = []; for (let i = 0; i < 4; i++) { ev.push(orb(l, (1 + i) * 0.8)); l = pick(r, others(l)); } return [5 * 0.8, ev, { beats: beatsTo(5 * 0.8) }]; } },
    ],
  },
};
// the beats of a Warden pattern (every 0.6 s from 0.6)
function beatsTo(len) { const b = []; for (let t = 0; t < len + 0.01; t += 0.8) b.push(Math.round(t * 100) / 100); return b; }
// every minion pattern ends with a short breath
// (the Warden: 0.35 — with the director's 0.25 every pattern is a whole number of beats, the rhythm never stumbles)
for (const id of ["golem", "hound", "weaver", "warden"]) for (const it of MECH_TH[id].list) { const f0 = it.f, br = id === "warden" ? 0.55 : 0.5; it.f = (r, p, d) => { const x = f0(r, p, d); x[0] += br; return x; }; }
