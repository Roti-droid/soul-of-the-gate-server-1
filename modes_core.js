/* modes_core.js — «Режимы» (2.3.12): the shared, pure rules of «Призрачная гонка» and «Столкни».
   THE SAME FILE runs in the game (build.py bundle) and on the server (webrelease-donate/modes_core.js = this text +
   one `export` line; test/test_modes_core.mjs checks that the two are identical). No DOM, no three.js, no Math.sin/cos/random
   in the simulations: only + − × ÷, sqrt, floor, min, max, abs — IEEE-exact everywhere, so a replay is bit-identical on
   every phone and on the server.

   Ghost race (GH): a seeded straight track (3 lanes) with solid obstacles; a run = the seed + the inputs [tick, act] at a
   fixed 30 ticks/s. The server re-simulates a submitted run and gets the same finish time — nothing else is trusted.
     wall  — a crystal block in one lane, 0.9 m high: jump it or change lane (you can land on top of it);
     gate  — a 2.6 m wall over two lanes: take the open lane;
     bar   — a beam over the whole road, its bottom at 0.8 m: slide under it (posts stand outside the road);
     gem   — three crystals in a lane (low / high = jump): +speed.
   Hitting anything solid stops the ball AT the surface (never through it) and costs speed.
   Inputs: L / R lane, U jump (also ends a slide), D slide (in the air: dive). Encoding: v1 = base64url of
   [1, varint((dTick << 2) | act) …] — ~1–2 bytes per press.

   Push arena (PU, «Столкни»): circles on a round floating platform made of rings of tiles. Swipe = dash (impulse, cooldown),
   hold = brace (2.6× mass, more grip, half dash). Ring drops, bumpers and crystal pillars come by the round clock, all from the
   match seed. The server runs PU.step at 30 ticks/s; phones only predict their own ball and interpolate the others.
   Rating: Elo (K 32 duel, 16 per pair in a 4-player match).
   2.3.14 «Столкни»: punchier dash + jump, 8 arenas rotating per round, escalating telegraphed hazards, a knockback cap, the bot's
   levels (pushBot) — see the push section. */
var ModesCore = (function () {
  'use strict';
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fnv1a(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function dayKey(t) { return new Date(t * 1000).toISOString().slice(0, 10); }

  // ================================================================ ghost race
  var GH = {
    TPS: 30, LANE_W: 2.1, R: 0.72, V0: 11,   // 2.3.14: the runner's own lane width and ball size (was 2.2 / 0.55)
    VMAX: 19, ACC: 0.5, VHIT: 4, STUN: 8, JUMP_V: 8.6, GRAV: 27, DIVE_V: -15,
    SLIDE_T: 17, SLIDE_SY: 0.5, LAT_V: 12, BOOST: 2.6, VOVER: 3, MAX_TICKS: 30 * 420, MAX_INPUTS: 4000,
    // 2.3.14 skill speed (the time now depends on the line): VTOP = the cap of every boost, above VMAX the speed decays by DECAY/s
    VTOP: 28, DECAY: 0.9, STREAK_T: 36, STREAK_K: 0.35, PAD_V: 6, PAD_L: 3, GRAZE: 0.25, GRAZE_V: 1.8, PJ_V: 1.5,
    SOFT_R: 0.5, SOFT_Y: 0.5, SOFT_K: 0.72, RAIL_H: 1.2, RAMP_L: 6, RAIL_A: 6, RAIL_W: 0.95,
    WALL_H: 0.9, WALL_D: 0.7, GATE_H: 2.6, BAR_Y0: 0.8, BAR_Y1: 1.5, BAR_D: 0.4, GEM_R: 0.36, GEM_Y: 0.6, GEM_HI: 1.7,
    TRACKS: [null, { len: 1000, k: 0.1 }, { len: 2000, k: 0.45 }, { len: 3000, k: 0.75 }],   // 3 daily tracks: short / middle / long (2.3.14: was 600/1000/1500)
    ACTS: 'LRUD'
  };
  var TRACK_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-3]$/;
  function laneX(l) { return (l - 1) * GH.LANE_W; }
  // the daily track id: '<UTC day>.<1..3>'
  function trackIds(day) { return [1, 2, 3].map(function (k) { return day + '.' + k; }); }
  function ghostTrack(id) {
    if (!TRACK_RE.test(String(id))) return null;
    var k = Number(id.slice(11)), T0 = GH.TRACKS[k], seed = fnv1a('ghost3:' + id) || 1, r = mulberry(seed);
    var len = T0.len, z = 46, boxes = [], gems = [], marks = [], last = '';
    // one piece: its boxes / gems / mark at z; returns the length it needs before the next piece (reaction room at full speed)
    function wall(zz, ls, kind) { ls.forEach(function (q) { boxes.push({ k: 'wall', z0: zz, z1: zz + GH.WALL_D, x0: laneX(q) - 1.0, x1: laneX(q) + 1.0, y0: 0, y1: GH.WALL_H }); }); marks.push({ k: kind, z: zz, lanes: ls }); }
    function gate(zz, l0) { [0, 1, 2].forEach(function (q) { if (q !== l0) boxes.push({ k: 'gate', z0: zz, z1: zz + GH.WALL_D, x0: laneX(q) - 1.05, x1: laneX(q) + 1.05, y0: 0, y1: GH.GATE_H }); }); marks.push({ k: 'gate', z: zz, open: l0 }); }
    function bar(zz) { boxes.push({ k: 'bar', z0: zz, z1: zz + GH.BAR_D, x0: -3.3, x1: 3.3, y0: GH.BAR_Y0, y1: GH.BAR_Y1 }); marks.push({ k: 'bar', z: zz }); }
    function gem(zz, l0, hi) { for (var g = 0; g < 3; g++) gems.push({ z: zz + g * 3.2, x: laneX(l0), y: hi ? GH.GEM_HI : GH.GEM_Y, i: gems.length }); marks.push({ k: 'gem', z: zz, lane: l0, hi: hi }); }
    function other(l0) { return (l0 + 1 + Math.floor(r() * 2)) % 3; }
    var pads = [], softs = [];
    function pad(zz, l0) { pads.push({ z0: zz, z1: zz + GH.PAD_L, x: laneX(l0), lane: l0, i: pads.length }); marks.push({ k: 'pad', z: zz, lane: l0 }); }
    function soft(zz, ls) { ls.forEach(function (q) { softs.push({ z: zz, x: laneX(q), y: GH.SOFT_Y, i: softs.length }); }); marks.push({ k: 'soft', z: zz, lanes: ls }); }
    // the shortcut: a ramp up to a rail (faster on top) with a hole in the middle — jump it, or fall into it and hit the next rail's face
    function rail(zz, l0) {
      var x0 = laneX(l0) - GH.RAIL_W, x1 = laneX(l0) + GH.RAIL_W, r0 = zz + GH.RAMP_L, gA = r0 + 14, gB = gA + 5, e = gB + 14;
      boxes.push({ k: 'ramp', z0: zz, z1: r0, x0: x0, x1: x1, y0: 0, y1: GH.RAIL_H });
      boxes.push({ k: 'rail', z0: r0, z1: gA, x0: x0, x1: x1, y0: 0, y1: GH.RAIL_H });
      boxes.push({ k: 'rail', z0: gB, z1: e, x0: x0, x1: x1, y0: 0, y1: GH.RAIL_H });
      for (var g = 0; g < 3; g++) gems.push({ z: gB + 3 + g * 3.2, x: laneX(l0), y: GH.RAIL_H + GH.GEM_Y, i: gems.length });
      marks.push({ k: 'rail', z: zz, lane: l0, gap: gA, gap1: gB, end: e });
      return e - zz;
    }
    while (z < len - 40) {
      var hard = Math.min(1, z / len * 0.8 + T0.k * 0.5), p = r(), kind;
      // 2.3.14: denser, and combos that mix the run's moves (always one free path: never a jump straight into a bar)
      var pc = 0.12 + hard * 0.26;                       // the share of combos grows along the track
      if (p < pc) { var c = r(); kind = c < 0.4 ? 'zig' : c < 0.7 ? 'gatebar' : 'barwall'; }
      else { p = (p - pc) / (1 - pc); if (p < 0.27) kind = 'wall'; else if (p < 0.39) kind = 'wall2'; else if (p < 0.54) kind = 'bar'; else if (p < 0.67) kind = 'gate'; else if (p < 0.80) kind = 'gem'; else if (p < 0.90) kind = 'soft'; else kind = 'rail'; }
      if (kind === 'rail' && z > len - 110) kind = 'gem';
      if (kind === last && kind !== 'wall') kind = 'wall';
      var l = Math.floor(r() * 3), gap;
      if (kind === 'wall') { if (r() < 0.4) { pad(z - 9, l); } wall(z, [l], 'wall'); gap = 12; }   // a pad right before the wall: take it, then dodge late
      else if (kind === 'wall2') { wall(z, [0, 1, 2].filter(function (x) { return x !== l; }), 'wall2'); gap = 18; }   // jump (airtime ≈ 16 m) or the free lane
      else if (kind === 'gate') { gate(z, l); gap = 15; }
      else if (kind === 'bar') { bar(z); gap = 14; }
      else if (kind === 'gem') { var hi = r() < 0.4; gem(z, l, hi); gap = hi ? 18 : 12; if (!hi && r() < 0.5) { gem(z + 12, other(l), false); gap = 12 + 6.4 + 12; } }   // a second line in another lane: the streak
      else if (kind === 'soft') { var ls2 = r() < 0.5 ? [l] : [l, other(l)]; soft(z, ls2.filter(function (x, i) { return ls2.indexOf(x) === i; })); gap = 12; }
      else if (kind === 'rail') { gap = rail(z, l) + 10; }
      else if (kind === 'zig') { var l2 = other(l); wall(z, [l], 'wall'); if (r() < 0.6) pad(z + 2, l); wall(z + 11, [l2], 'wall'); gap = 11 + 12; }   // two lane changes (a pad between: hug the first wall's lane)
      else if (kind === 'gatebar') { gate(z, l); bar(z + 11); gap = 11 + 14; }                                           // the open lane, then slide
      else { bar(z); var l3 = Math.floor(r() * 3), gg = r() < 0.5; wall(z + 10, [l3], 'wall'); if (gg) gem(z + 20, other(l3), false); gap = gg ? 20 + 6.4 + 12 : 10 + 12; }   // the crystals never lead into the next piece   // slide, then a lane change
      last = kind;
      z += gap * 1.15 + Math.floor(r() * (11 - hard * 6));   // ×1.15: the reaction room holds up to VTOP
    }
    boxes.sort(function (a, b) { return a.z0 - b.z0; });
    boxes.forEach(function (q, i) { q.i = i; });
    marks.sort(function (a, b) { return a.z - b.z; });
    return { id: id, seed: seed, len: len, boxes: boxes, gems: gems, marks: marks, pads: pads, softs: softs };
  }
  // the ball's collider is the ellipsoid it is drawn as: semi-axes (R·sx, R·sy, R·sx), sx = 1/√sy (the slide squash keeps volume)
  function ghostSy(b) { return b.slide > 0 ? GH.SLIDE_SY : 1; }
  function hitBox(x, y, z, sy, bx) {   // ellipsoid (centre x, y + R·sy, z) vs box: scale into the unit-sphere space, exact
    var sx = 1 / Math.sqrt(sy), rx = GH.R * sx, ry = GH.R * sy, cy = y + ry;
    var px = Math.max(bx.x0, Math.min(x, bx.x1)), py = Math.max(bx.y0, Math.min(cy, bx.y1)), pz = Math.max(bx.z0, Math.min(z, bx.z1));
    var dx = (px - x) / rx, dy = (py - cy) / ry, dz = (pz - z) / rx;
    return dx * dx + dy * dy + dz * dz < 1 - 1e-9;
  }
  // a ramp is a wedge: its top rises from 0 to RAIL_H along z; against the ball it is the box under the top at the ball's z
  function rampTop(q, z) { return GH.RAIL_H * Math.max(0, Math.min(1, (z - q.z0) / (q.z1 - q.z0 - GH.R))); }   // at the rail's height a ball radius before its end: the ball rolls onto the rail, never into its face
  var RB = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  function anyHit(tr, b, x, y, z, sy) {
    var bs = tr.boxes;
    for (var i = b.bi; i < bs.length; i++) {
      var q = bs[i]; if (q.z0 > z + 2) break; if (q.z1 < z - 2) continue;
      if (q.k === 'ramp') { RB.x0 = q.x0; RB.x1 = q.x1; RB.z0 = q.z0; RB.z1 = q.z1; RB.y1 = rampTop(q, z); if (RB.y1 > 1e-6 && hitBox(x, y, z, sy, RB)) return q; continue; }
      if (hitBox(x, y, z, sy, q)) return q;
    }
    return null;
  }
  function floorAt(tr, b, x, z) {     // the top the ball stands on: the road (0), a wall, a ramp or a rail under its centre
    var bs = tr.boxes, f = 0;
    for (var i = b.bi; i < bs.length; i++) {
      var q = bs[i]; if (q.z0 > z + 1) break;
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      if (q.k === 'wall' || q.k === 'rail') f = Math.max(f, q.y1); else if (q.k === 'ramp') f = Math.max(f, rampTop(q, z));
    }
    return f;
  }
  function ghostNew(tr) { return { tr: tr, tick: 0, z: 0, x: 0, y: 0, vy: 0, lane: 1, v: GH.V0, slide: 0, stun: 0, hits: 0, gems: 0, got: {}, bi: 0, blk: 0, done: false, fin: 0,
    streak: 0, gemT: -99, pads: 0, padGot: {}, grazes: 0, gz: {}, soft: 0, br: {}, air: 0, over: 0, pj: 0, ev: 0 }; }
  function ghostInput(b, act) {
    var sy = ghostSy(b), gr = b.y <= floorAt(b.tr, b, b.x, b.z) + 1e-6;
    if (act === 'L' && b.lane > 0) b.lane -= 1;
    else if (act === 'R' && b.lane < 2) b.lane += 1;
    else if (act === 'U') { if (gr) { b.slide = 0; if (!anyHit(b.tr, b, b.x, b.y, b.z, 1)) { b.vy = GH.JUMP_V; b.air = 1; b.over = 0; } else b.slide = 1; } }
    else if (act === 'D') { if (!gr) b.vy = Math.min(b.vy, GH.DIVE_V); else b.slide = GH.SLIDE_T; }
    return sy;
  }
  function isRail(tr, b, x, z) { var bs = tr.boxes; for (var i = b.bi; i < bs.length; i++) { var q = bs[i]; if (q.z0 > z + 1) break; if (q.k === 'rail' && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return true; } return false; }
  function ghostStep(b) {
    if (b.done) return b;
    var tr = b.tr, dt = 1 / GH.TPS, bs = tr.boxes;
    while (b.bi < bs.length && bs[b.bi].z1 < b.z - 3) b.bi++;
    // slide: it ends by itself, but never inside a bar (the ball stays low while something is right above it)
    if (b.slide > 0) { b.slide -= 1; if (b.slide === 0 && anyHit(tr, b, b.x, b.y, b.z, 1)) b.slide = 1; }
    var sy = ghostSy(b);
    // vertical
    b.vy -= GH.GRAV * dt;
    var ny = b.y + b.vy * dt, fl = floorAt(tr, b, b.x, b.z);
    if (ny <= fl) {
      if (b.air && b.vy < 0) { b.air = 0; if (b.over) { b.pj += 1; b.v = Math.min(GH.VTOP, b.v + GH.PJ_V); b.ev = 3; } }   // a perfect jump: landed after clearing something
      ny = fl; b.vy = 0;
    }
    var hv = anyHit(tr, b, b.x, ny, b.z, sy);
    if (hv) { if (b.vy > 0) { ny = Math.max(fl, hv.y0 - 2 * GH.R * sy - 1e-6); } else { ny = Math.max(ny, hv.y1); } b.vy = 0; if (anyHit(tr, b, b.x, ny, b.z, sy)) ny = b.y; }
    b.y = ny;
    // lateral: towards the lane; blocked by a solid side = back to the lane it came from
    var tx = laneX(b.lane), dx = tx - b.x, st = Math.min(Math.abs(dx), GH.LAT_V * dt);
    if (st > 0) {
      var nx = b.x + (dx > 0 ? st : -st);
      if (anyHit(tr, b, nx, b.y, b.z, sy)) { var lf = b.x / GH.LANE_W + 1; b.lane = Math.max(0, Math.min(2, dx > 0 ? Math.floor(lf + 1e-9) : Math.ceil(lf - 1e-9))); }   // blocked: back to the lane it came from
      else b.x = nx;
    }
    // forward
    var onRail = b.y > 0.5 && b.y <= fl + 1e-6 && fl >= GH.RAIL_H - 1e-6 && isRail(tr, b, b.x, b.z);
    if (b.stun > 0) b.stun -= 1;
    else if (onRail) b.v = Math.min(GH.VTOP, b.v + GH.RAIL_A * dt);                                  // the shortcut: faster on the rail
    else if (b.v < GH.VMAX) b.v = Math.min(GH.VMAX, b.v + GH.ACC * dt * (1 + (GH.VMAX - b.v) / GH.VMAX));
    else if (b.v > GH.VMAX) b.v = Math.max(GH.VMAX, b.v - GH.DECAY * dt);
    var z0 = b.z, nz = z0 + b.v * dt, hq = anyHit(tr, b, b.x, b.y, nz, sy);
    if (hq && hq.k === 'ramp' && b.x >= hq.x0 && b.x <= hq.x1 && b.y <= rampTop(hq, nz) + 0.3) { b.y = rampTop(hq, nz); if (b.vy < 0) b.vy = 0; }   // up the slope (a ramp only blocks from the side)
    if (hq && anyHit(tr, b, b.x, b.y, nz, sy)) {          // stop at the contact (bisection, 14 halvings ≈ 0.1 mm)
      var lo = z0, hi = nz;
      for (var k = 0; k < 14; k++) { var mid = (lo + hi) / 2; if (anyHit(tr, b, b.x, b.y, mid, sy)) hi = mid; else lo = mid; }
      nz = lo; b.v = GH.VHIT; if (!b.blk) b.hits += 1; b.stun = GH.STUN; b.blk = 1;
    } else b.blk = 0;
    // a graze: an obstacle passed this tick with a hair of room (late dodge beside it, or a low clear over it) — a short boost
    for (var gi0 = b.bi; gi0 < bs.length; gi0++) {
      var q = bs[gi0]; if (q.z0 > nz) break;
      if (b.gz[q.i] || b.blk || q.z1 < z0 || q.z1 >= nz || q.k === 'ramp' || q.k === 'rail' || q.k === 'bar') continue;
      var rx2 = GH.R / Math.sqrt(sy), side = Math.max(q.x0 - (b.x + rx2), (b.x - rx2) - q.x1), top = b.y - q.y1;
      if ((side >= 0 && side < GH.GRAZE && b.y < q.y1) || (side < 0 && top >= 0 && top < GH.GRAZE + 0.1)) { b.gz[q.i] = 1; b.grazes += 1; b.v = Math.min(GH.VTOP, b.v + GH.GRAZE_V); b.ev = 2; }
      if (side < 0 && top >= 0 && b.air) b.over = 1;
    }
    b.z = nz;
    // speed pads (on the road, in one lane)
    var pdz = tr.pads;
    for (var pi = 0; pi < pdz.length; pi++) {
      var pd = pdz[pi]; if (pd.z0 > b.z) break; if (pd.z1 < z0 || b.padGot[pd.i]) continue;
      if (b.y <= 1e-6 && Math.abs(b.x - pd.x) < 0.9) { b.padGot[pd.i] = 1; b.pads += 1; b.v = Math.min(GH.VTOP, b.v + GH.PAD_V); b.ev = 1; }
    }
    // soft crystal clusters: touching one shatters it and costs speed (a stumble, not a stop)
    var sfz = tr.softs;
    for (var si = 0; si < sfz.length; si++) {
      var sf = sfz[si]; if (sf.z > b.z + 2) break; if (sf.z < b.z - 2 || b.br[sf.i]) continue;
      var fx = sf.x - b.x, fy = sf.y - (b.y + GH.R * sy), fz = sf.z - b.z, fr2 = GH.R + GH.SOFT_R;
      if (fx * fx + fy * fy + fz * fz < fr2 * fr2) { b.br[sf.i] = 1; b.soft += 1; b.v *= GH.SOFT_K; b.streak = 0; b.ev = 4; }
    }
    // crystals
    var gs = tr.gems;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i]; if (g.z > b.z + 2) break; if (g.z < b.z - 2 || b.got[g.i]) continue;
      var ex = g.x - b.x, ey = g.y - (b.y + GH.R * sy), ez = g.z - b.z, rr = GH.R + GH.GEM_R;
      if (ex * ex + ey * ey + ez * ez < rr * rr) {   // a crystal: +speed; crystals in a row (≤ STREAK_T ticks apart) chain into a streak
        b.streak = b.tick - b.gemT <= GH.STREAK_T ? b.streak + 1 : 1; b.gemT = b.tick;
        b.got[g.i] = 1; b.gems += 1; b.v = Math.min(GH.VTOP, b.v + GH.BOOST * (1 + GH.STREAK_K * (Math.min(b.streak, 5) - 1)));
      }
    }
    b.tick += 1;
    if (b.z >= tr.len) { b.done = true; b.fin = Math.round(((b.tick - 1) + (tr.len - z0) / (b.z - z0)) * 1000 / GH.TPS); }   // ms
    return b;
  }
  // inputs [[tick, act], …] (sorted) → the run; opts.frames: keep [x, y, z, sy] per tick (the ghost's replay)
  function ghostRun(tr, inputs, opts) {
    var b = ghostNew(tr), j = 0, fr = opts && opts.frames ? [] : null, n = inputs.length;
    if (fr) fr.push([b.x, b.y, b.z, 1]);
    while (!b.done && b.tick < GH.MAX_TICKS) {
      while (j < n && inputs[j][0] <= b.tick) { ghostInput(b, inputs[j][1]); j++; }
      ghostStep(b);
      if (fr) fr.push([b.x, b.y, b.z, ghostSy(b)]);
    }
    return { done: b.done, ms: b.fin, ticks: b.tick, hits: b.hits, gems: b.gems, pads: b.pads, grazes: b.grazes, soft: b.soft, pj: b.pj, frames: fr, used: j };
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64enc(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b2 = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0, n = (a << 16) | (b2 << 8) | c;
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
    }
    return s;
  }
  function b64dec(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
    var out = [], acc = 0, bits = 0;
    for (var i = 0; i < s.length; i++) { acc = (acc << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
    return out;
  }
  function encodeInputs(inp) {
    var by = [1], prev = 0;
    for (var i = 0; i < inp.length; i++) {
      var d = inp[i][0] - prev, a = GH.ACTS.indexOf(inp[i][1]); prev = inp[i][0];
      var v = d * 4 + a;
      while (v >= 128) { by.push((v & 127) | 128); v = Math.floor(v / 128); }
      by.push(v);
    }
    return b64enc(by);
  }
  function decodeInputs(s) {          // → [[tick, act]…] or null (format)
    var by = b64dec(s); if (!by || !by.length || by[0] !== 1) return null;
    var out = [], t = 0, i = 1;
    while (i < by.length) {
      var v = 0, mul = 1, n = 0;
      for (;;) { if (i >= by.length || n > 4) return null; var c = by[i++]; v += (c & 127) * mul; mul *= 128; n++; if (!(c & 128)) break; }
      t += Math.floor(v / 4); out.push([t, GH.ACTS[v % 4]]);
      if (out.length > GH.MAX_INPUTS || t > GH.MAX_TICKS) return null;
    }
    return out;
  }
  // the server's check of a submitted run: null = fine, else the reason (a flag)
  function ghostProblem(trackId, s, ms) {
    var tr = ghostTrack(trackId); if (!tr) return { err: 'track' };
    if (typeof s !== 'string' || s.length > 6000) return { err: 'ghost_format' };
    var inp = decodeInputs(s); if (!inp) return { err: 'ghost_format' };
    // a person: ≤ 3 presses on one tick, ≤ 14 presses in any 1 s
    var same = 0;
    for (var i = 0; i < inp.length; i++) {
      same = i && inp[i][0] === inp[i - 1][0] ? same + 1 : 0; if (same >= 3) return { err: 'ghost_rate' };
      if (i >= 14 && inp[i][0] - inp[i - 14][0] < GH.TPS) return { err: 'ghost_rate' };
    }
    var r = ghostRun(tr, inp);
    if (!r.done) return { err: 'ghost_unfinished' };
    if (!Number.isInteger(ms) || Math.abs(r.ms - ms) > 1) return { err: 'ghost_time', ms: r.ms };
    return { ok: true, ms: r.ms, inp: inp, run: r };
  }

  // ================================================================ push arena («Столкни»)
  // 2.3.14: a punchier dash (stronger, short cooldown, a «punch» window: knockback grows with the relative speed, brace still halves
  // it), a jump (tap: over sweeping beams and gaps), 8 arenas that rotate per round (classic, islands, carousel, platforms, tilt,
  // ice, bumpers, spiral), timed hazards that escalate through the round (falling tiles, sweeping beams, gusts, pillar waves,
  // sudden death: the edge burns inward), each telegraphed before it hits; the knockback speed is capped after every contact.
  // The floor is tiles: ring k = SEG[k] sectors of equal «diamond angle» (pang: + − × ÷ only); a tile is solid until its fall time.
  // Everything here is a pure function of (seed, round, inputs) — the server, the phone's prediction and the practice bot agree.
  var PU = {
    TPS: 30, R: 0.62, DASH_V: 14, DASH_CD: 20, DASH_T: 8, DASH_GLIDE: 0.35, PUNCH: 0.45, HIT_MIN: 2,
    FRICT: 1.25, BRACE_FRICT: 3.4, BRACE_MASS: 2.6, BRACE_DASH: 0.5, VMAX: 16, VHMAX: 11, REST: 0.92,
    JUMP_V: 7.2, GRAV: 24, JUMP_CD: 15, ICE_FRICT: 0.22, ICE_BRACE: 0.9, PLAT_FRICT: 5,
    RINGS: [3.4, 5.4, 7.4, 9.4], SEG: [1, 12, 16, 20], BIG: 1.4,   // BIG: the arena's scale for a free-for-all of 5–8 players   // outer radius / tiles of ring 0 (centre disc) … ring 3 (the edge at the start)
    DROP_AT: [24, 34, 44],                // s of the round: ring 3, 2, 1 fall (they blink WARN s before)
    WARN: 2.4, TILE_WARN: 1.6, BUMP_AT: 8, PILLAR_AT: [15, 30, 40], RISE: 0.9, SINK: 0.5,
    ROUND_MAX: 62, WIN_ROUNDS: 2, COUNT: 3, BETWEEN: 3.2,
    BUMP_R: 0.75, BUMP_H: 0.8, BUMP_KICK: 8, BUMP_E: 1.0, BUMP_UP: 7, PILLAR_R: 0.6, PILLAR_E: 0.35, PILLAR_H: 2.4,
    BEAM_H: 0.45, BEAM_W: 0.36, BEAM_V: 5.5, BEAM_L: 10.6, BEAM_WARN: 2, BEAM_E: 0.5, BEAM_GAP: 2.6,
    GUST_A: 4, GUST_T: 1.6, GUST_WARN: 1.5, TILT_A: 2.6, TILT_P: 8,
    SD_AT: 50, SD_WARN: 2.5, SD_V: 0.6, SD_MIN: 0.2,
    ARENAS: ['classic', 'islands', 'carousel', 'platforms', 'tilt', 'ice', 'bumpers', 'spiral'],
    EV: { hit: 1, bump: 2, fall: 3, beam: 4, dash: 5, jump: 6 }
  };
  // 16 compass directions (unit vectors, a table — no trig, identical everywhere)
  var D16 = [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
    [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827]];
  // the «diamond angle» of (x, y) in [0, 4): monotonic in the true angle, + − × ÷ only; pdir = its inverse (not normalised)
  function pang(x, y) {
    if (y >= 0) { if (x > 0) return y / (x + y); if (y > 0 || x < 0) return 1 - x / (y - x); return 0; }
    return x < 0 ? 2 - y / (-x - y) : 3 + x / (x - y);
  }
  function pdir(p) { var q = Math.floor(p) % 4, f = p - Math.floor(p); return q === 0 ? [1 - f, f] : q === 1 ? [-f, 1 - f] : q === 2 ? [f - 1, -f] : [f, f - 1]; }
  function tileIdx(k, x, y) { return k ? Math.min(PU.SEG[k] - 1, Math.floor(pang(x, y) * PU.SEG[k] / 4)) : 0; }
  function ringsOf(n) { return n > 4 ? PU.RINGS.map(function (x) { return x * PU.BIG; }) : PU.RINGS; }
  function tileCentre(k, idx, rg) {  // the middle of a tile (ring k ≥ 1): its mid radius on its mid diamond-angle ray
    rg = rg || PU.RINGS;
    var d = pdir((idx + 0.5) * 4 / PU.SEG[k]), l = Math.sqrt(d[0] * d[0] + d[1] * d[1]), rm = (rg[k] + rg[k - 1]) / 2;
    return [d[0] / l * rm, d[1] / l * rm];
  }
  function tri(u) { u = u - Math.floor(u); return u < 0.5 ? 4 * u - 1 : 3 - 4 * u; }   // a triangle wave in [−1, 1], period 1
  // the arena of a round: a permutation of the 8 kinds from the match seed (every round another one; round 1 = the seed's first)
  function pushArenaOf(seed, round) {
    var r = mulberry((seed ^ 0x5bd1e995) >>> 0 || 1), ord = PU.ARENAS.map(function (x, i) { return i; });
    for (var i = ord.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), q = ord[i]; ord[i] = ord[j]; ord[j] = q; }
    return PU.ARENAS[ord[(Math.max(1, round) - 1) % ord.length]];
  }
  function pushSpawns(n, kind) {      // start places (deterministic, no trig at run time); 5–8 players: 8 places on the big arena
    var s = kind === 'platforms' ? 1.9 : 4.6;
    if (n > 4) { s *= PU.BIG; return [0, 8, 4, 12, 2, 10, 6, 14].slice(0, n).map(function (q) { return [D16[q][0] * s, D16[q][1] * s]; }); }
    var P4 = [[-s, 0], [s, 0], [0, -s], [0, s]];
    return n === 2 ? [P4[0], P4[1]] : P4.slice(0, n);
  }
  // the whole round from the seed: the arena, its tiles and their fall times, hazards, beams, gusts, tilt, platforms
  function pushPlan(seed, round, n) {
    var kind = pushArenaOf(seed, round), r = mulberry((seed ^ Math.imul(round + 1, 0x9E3779B1)) >>> 0 || 1), sp = pushSpawns(n, kind);
    var rg = ringsOf(n), sc = rg[0] / PU.RINGS[0], BL = rg[3] + 1.2;
    var P = { kind: kind, rg: rg, tf: [], ice: null, rot: [0, 0, 0, 0], plats: [], hz: [], beams: [], gusts: [], tilt: null, drops: [], sd0: 0 }, k, i;
    var FOREVER = 1e9;
    for (k = 0; k < 4; k++) { var row = []; for (i = 0; i < PU.SEG[k]; i++) row.push(FOREVER); P.tf.push(row); }
    function ringAll(k2, at) { for (var q = 0; q < PU.SEG[k2]; q++) P.tf[k2][q] = Math.min(P.tf[k2][q], at); }
    // the arena's shape
    if (kind === 'islands') for (i = 0; i < PU.SEG[2]; i += 2) P.tf[2][i] = -1;                 // ring 2: every other tile is a gap
    if (kind === 'platforms') { ringAll(1, -1); ringAll(2, -1);                                   // a void between the centre and the outer ring,
      [2, 6, 10, 14].forEach(function (d, q) { P.plats.push({ dx: D16[d][0], dy: D16[d][1], mid: 5.4 * sc, amp: 0.85 * sc, per: 5, ph: q * 0.25, r: 1.25 * sc }); }); }   // bridged by 4 moving platforms
    if (kind === 'carousel') { P.rot[2] = -0.45; P.rot[3] = 0.32; }                               // rings 2 and 3 turn (opposite ways)
    if (kind === 'ice') { P.ice = [[], [], [], []]; for (k = 1; k < 4; k++) for (i = 0; i < PU.SEG[k]; i++) P.ice[k].push(i * 4 < PU.SEG[k] * 2 ? 1 : 0); }   // half of the outer rings is ice
    if (kind === 'tilt') { P.tilt = []; for (i = 0; i < 9; i++) P.tilt.push(Math.floor(r() * 16)); }
    // ring drops by the clock (the spiral drops tile by tile instead; on «platforms» only the outer ring goes)
    if (kind === 'platforms') { ringAll(3, PU.DROP_AT[1]); P.drops.push([PU.DROP_AT[1], 3]); }
    else if (kind !== 'spiral') for (i = 0; i < 3; i++) { ringAll(3 - i, PU.DROP_AT[i]); P.drops.push([PU.DROP_AT[i], 3 - i]); }
    function present(k2, q, at) { return P.tf[k2][q] > at; }
    function free(x, y, rad) {
      for (var a = 0; a < P.hz.length; a++) { var dx = P.hz[a].x - x, dy = P.hz[a].y - y, m = P.hz[a].r + rad + 1.4; if (dx * dx + dy * dy < m * m) return false; }
      for (var b = 0; b < sp.length; b++) { var ex = sp[b][0] - x, ey = sp[b][1] - y; if (ex * ex + ey * ey < 2.2 * 2.2) return false; }
      return x * x + y * y > 1.4 * 1.4;
    }
    // hazards stand in the middle of one tile (and fall with it); never on a turning ring, a gap, or a start place
    function place(hk, cnt, rings, rad, at) {
      for (var tt = 0, got = 0; tt < 80 && got < cnt; tt++) {
        var k2 = rings[Math.floor(r() * rings.length)], q = k2 ? Math.floor(r() * PU.SEG[k2]) : 0, c;
        if (k2) c = tileCentre(k2, q, rg); else { var d = D16[Math.floor(r() * 16)]; c = [d[0] * 2.0 * sc, d[1] * 2.0 * sc]; }
        if (P.rot[k2] || !present(k2, q, at + 1) || P.hz.some(function (h) { return h.ring === k2 && h.idx === q; })) continue;
        if (free(c[0], c[1], rad)) { P.hz.push({ k: hk, x: c[0], y: c[1], r: rad, at: at + got * 0.6, ring: k2, idx: q }); got++; }
      }
    }
    if (kind === 'spiral') {          // the spiral eats the outer rings tile by tile, from the edge inwards (before the hazards: they stand on what stays)
      var c2 = 0;
      for (k = 3; k >= 1; k--) { var off = Math.floor(r() * PU.SEG[k]); for (i = 0; i < PU.SEG[k]; i++) { P.tf[k][(off + i) % PU.SEG[k]] = 12 + c2 * 0.7; c2++; } }
    }
    var big = n > 2, huge = n > 4, rot = kind === 'carousel';
    if (kind === 'bumpers') place('bump', huge ? 12 : big ? 8 : 6, [1, 2, 3], PU.BUMP_R, 4);
    else place('bump', huge ? 5 : big ? 3 : 2, kind === 'platforms' ? [3] : rot ? [1] : [1, 2], PU.BUMP_R, PU.BUMP_AT);
    var pr = kind === 'platforms' ? [0] : rot ? [0, 1] : [1, 2], waves = kind === 'bumpers' ? [1, 1, 0] : huge ? [4, 3, 2] : [big ? 3 : 2, 2, 1];
    for (i = 0; i < 3; i++) place('pillar', waves[i], pr, PU.PILLAR_R, PU.PILLAR_AT[i]);
    // single tiles fall more and more often (blink TILE_WARN s first); the spiral eats the outer rings tile by tile
    if (kind !== 'spiral') {
      var tt2 = 12 + r() * 2, gap = 4.5;
      while (tt2 < 49) {
        for (var tr2 = 0; tr2 < 24; tr2++) {
          var k3 = 1 + Math.floor(r() * 3), q3 = Math.floor(r() * PU.SEG[k3]);
          if (P.rot[k3] || !present(k3, q3, tt2 + 0.5) || P.hz.some(function (h) { return h.ring === k3 && h.idx === q3; })) continue;
          P.tf[k3][q3] = tt2; break;
        }
        tt2 += gap; gap = Math.max(1.6, gap * 0.85);
      }
    }
    // sweeping beams (jump them) and gusts, more often as the round goes on; a gust never sits inside a beam's sweep
    var bt = 18 + r() * 2, bg = kind === 'spiral' ? 13 : 11, dur = 2 * BL / PU.BEAM_V;
    while (bt < 53) { var bd = D16[Math.floor(r() * 16)]; P.beams.push({ at: bt, ux: bd[0], uy: bd[1], gap: (r() - 0.5) * 7 * sc, L: BL }); bt += bg; bg = Math.max(7, bg - 2); }   // gap: where the bar has a hole (along it)
    var gt = 13 + r() * 2, gg = 10;
    while (gt < 56) {
      for (var b2 = 0; b2 < P.beams.length; b2++) { var B = P.beams[b2]; if (gt + PU.GUST_T > B.at - PU.BEAM_WARN && gt < B.at + dur) gt = B.at + dur + 0.5; }
      if (gt >= 56) break;
      var gd = D16[Math.floor(r() * 16)]; P.gusts.push({ at: gt, x: gd[0], y: gd[1] }); gt += gg; gg = Math.max(6.5, gg - 1);
    }
    // sudden death starts from the floor that is left at SD_AT
    P.sd0 = edgeOf(P, PU.SD_AT - 1e-6, true) + 0.05;
    return P;
  }
  // (old name, tests) the hazards of one round
  function pushLayout(seed, round, n) { return pushPlan(seed, round, n).hz; }
  function platAt(p, t) {
    var tr0 = tri(t / p.per + p.ph), c = p.mid + p.amp * tr0, u = t / p.per + p.ph, sg = (u - Math.floor(u)) < 0.5 ? 1 : -1, v = sg * 4 * p.amp / p.per;
    return { x: p.dx * c, y: p.dy * c, vx: p.dx * v, vy: p.dy * v, r: p.r };
  }
  function sdR(w, t) { return t < PU.SD_AT ? 1e9 : Math.max(PU.SD_MIN, w.sd0 - PU.SD_V * (t - PU.SD_AT)); }
  // the outer radius of what is still floor at t
  function edgeOf(w, t, noSd) {
    var e = 0, k, i;
    for (k = 0; k < 4; k++) for (i = 0; i < PU.SEG[k]; i++) if (w.tf[k][i] > t) { e = w.rg[k]; break; }
    for (i = 0; i < w.plats.length; i++) { var p = platAt(w.plats[i], t), d = Math.sqrt(p.x * p.x + p.y * p.y) + p.r; if (d > e) e = d; }
    return noSd ? e : Math.min(e, sdR(w, t));
  }
  // the floor under a point at round time t: 0 = void, 1 = floor, 2 = ice, 3 = a platform; FV = the floor's own velocity there
  var FV = [0, 0];
  function puFloor(w, x, y, t) {
    FV[0] = 0; FV[1] = 0;
    var r2 = x * x + y * y, k = 0, i;
    if (t >= PU.SD_AT) { var s = sdR(w, t); if (r2 > s * s) return 0; }
    while (k < 4 && r2 > w.rg[k] * w.rg[k]) k++;
    if (k < 4) {
      var idx = tileIdx(k, x, y);
      if (t < w.tf[k][idx]) { var om = w.rot[k]; if (om) { FV[0] = -om * y; FV[1] = om * x; } return w.ice && w.ice[k] && w.ice[k][idx] ? 2 : 1; }
    }
    for (i = 0; i < w.plats.length; i++) { var p = platAt(w.plats[i], t), dx = x - p.x, dy = y - p.y; if (dx * dx + dy * dy <= p.r * p.r) { FV[0] = p.vx; FV[1] = p.vy; return 3; } }
    return 0;
  }
  function tileFall(w, k, idx) { return w.tf[k][idx]; }
  function beamDur(B) { return 2 * B.L / PU.BEAM_V; }
  function beamAt(B, t) {            // the beam's position along its direction (it sweeps from −L to +L), or null when it is not out
    return t >= B.at && t < B.at + beamDur(B) ? -B.L + PU.BEAM_V * (t - B.at) : null;
  }
  function gustAt(w, t) { for (var i = 0; i < w.gusts.length; i++) { var g = w.gusts[i]; if (t >= g.at && t < g.at + PU.GUST_T) return [g.x * PU.GUST_A, g.y * PU.GUST_A]; } return null; }
  function tiltAt(w, t) {            // the slope's pull (m/s²): a triangle wave along an axis that changes every TILT_P s
    if (!w.tilt) return [0, 0];
    var seg = Math.min(w.tilt.length - 1, Math.floor(t / PU.TILT_P)), d = D16[w.tilt[seg]], u = (t - seg * PU.TILT_P) / PU.TILT_P, a = PU.TILT_A * (u < 0.5 ? 2 * u : 2 - 2 * u);
    return [d[0] * a, d[1] * a];
  }
  // a hazard's height share at t: rises over RISE from `at`, ducks into the floor for every beam's sweep, falls with its tile
  function hzLevel(w, h, t) {
    if (t < h.at) return 0;
    var lv = Math.min(1, (t - h.at) / PU.RISE);
    for (var i = 0; i < w.beams.length; i++) {
      var b0 = w.beams[i].at, b1 = b0 + beamDur(w.beams[i]);
      if (t >= b0 - PU.SINK && t < b0) lv = Math.min(lv, (b0 - t) / PU.SINK);
      else if (t >= b0 && t < b1) lv = 0;
      else if (t >= b1 && t < b1 + PU.RISE) lv = Math.min(lv, (t - b1) / PU.RISE);
    }
    return lv;
  }
  function hzOn(w, h, t) {
    if (t >= w.tf[h.ring][h.idx]) return false;
    if (t >= PU.SD_AT) { var s = sdR(w, t), d = Math.sqrt(h.x * h.x + h.y * h.y) + h.r; if (d > s) return false; }
    return hzLevel(w, h, t) > 0;
  }
  function pushNew(n, seed, round) {
    var P = pushPlan(seed, round, n), sp = pushSpawns(n, P.kind), balls = [];
    for (var i = 0; i < n; i++) balls.push({ i: i, x: sp[i][0], y: sp[i][1], h: 0, vx: 0, vy: 0, vh: 0, brace: 0, cd: 12, jcd: 0, dsh: 0, alive: 1, fellAt: -1, lastHit: -1 });
    return { n: n, seed: seed, round: round, tick: 0, balls: balls, kind: P.kind, rg: P.rg, tf: P.tf, ice: P.ice, rot: P.rot, plats: P.plats, hz: P.hz, beams: P.beams, gusts: P.gusts,
      tilt: P.tilt, drops: P.drops, sd0: P.sd0, over: false, ev: [] };
  }
  // the same round with other balls (the phone's prediction): shares the plan, copies the balls
  function pushClone(w, balls, tick) {
    var o = {}; for (var k in w) o[k] = w[k];
    o.balls = balls.map(function (b) { var c = {}; for (var q in b) c[q] = b[q]; return c; }); o.tick = tick; o.over = false; o.ev = [];
    return o;
  }
  function ev(w, a) { w.ev.push(a); if (w.ev.length > 48) w.ev.shift(); }
  function pushDash(w, i, dx, dy) {   // a swipe: direction (any length); false if on cooldown / gone
    var b = w.balls[i]; if (!b || !b.alive || b.cd > 0) return false;
    var l = Math.sqrt(dx * dx + dy * dy); if (!(l > 1e-6)) return false;
    var k = PU.DASH_V * (b.brace ? PU.BRACE_DASH : 1) / l;
    b.vx += dx * k; b.vy += dy * k; b.cd = PU.DASH_CD; b.dsh = PU.DASH_T;
    ev(w, [PU.EV.dash, i, -1, 0, Math.round(b.x * 1000), Math.round(b.y * 1000)]);
    return true;
  }
  function pushJump(w, i) {           // a tap: only from the floor, a short cooldown
    var b = w.balls[i]; if (!b || !b.alive || b.h > 1e-6 || b.vh > 0 || b.jcd > 0) return false;
    if (!puFloor(w, b.x, b.y, w.tick / PU.TPS)) return false;
    b.vh = PU.JUMP_V; b.jcd = PU.JUMP_CD;
    ev(w, [PU.EV.jump, i, -1, 0, Math.round(b.x * 1000), Math.round(b.y * 1000)]);
    return true;
  }
  function capV(b) {
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (sp > PU.VMAX) { b.vx *= PU.VMAX / sp; b.vy *= PU.VMAX / sp; }
    if (b.vh > PU.VHMAX) b.vh = PU.VHMAX;
  }
  function pushStep(w) {
    if (w.over) return w;
    var dt = 1 / PU.TPS, t = w.tick * dt, bs = w.balls, n = bs.length, i, j, R = PU.R;
    var gu = gustAt(w, t), tl = tiltAt(w, t), RG = w.rg;
    for (i = 0; i < n; i++) {
      var b = bs[i]; if (!b.alive) continue;
      if (b.cd > 0) b.cd -= 1; if (b.jcd > 0) b.jcd -= 1; if (b.dsh > 0) b.dsh -= 1;
      var m = b.brace ? PU.BRACE_MASS : 1, ground = b.h <= 1e-6 && b.vh <= 0, fk = ground ? puFloor(w, b.x, b.y, t) : 0;
      if (fk) {                         // friction pulls the ball towards the floor's own velocity (a turning ring, a platform)
        var f = fk === 2 ? (b.brace ? PU.ICE_BRACE : PU.ICE_FRICT) : fk === 3 ? PU.PLAT_FRICT : (b.brace ? PU.BRACE_FRICT : PU.FRICT);
        if (b.dsh > 0 && fk !== 3) f *= PU.DASH_GLIDE;
        var k = Math.max(0, 1 - f * dt), fx = FV[0], fy = FV[1];
        b.vx = fx + (b.vx - fx) * k; b.vy = fy + (b.vy - fy) * k;
        b.vx += tl[0] * dt; b.vy += tl[1] * dt;
      }
      if (gu) { b.vx += gu[0] / m * dt; b.vy += gu[1] / m * dt; }
      capV(b);
      if (!ground) b.vh -= PU.GRAV * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt;
      if (b.h <= 0 && puFloor(w, b.x, b.y, t)) { b.h = 0; if (b.vh < 0) b.vh = 0; }   // landed (over the void it keeps going down)
    }
    var hitPair = {};
    for (var pass = 0; pass < 8; pass++) {   // contacts solved together a few times: a ball between a rival and a pillar ends up touching both, inside neither
      // ball ↔ ball: spheres in 3D (a jump can land on a rival), masses by brace, restitution REST; a dashing ball punches harder
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        var a = bs[i], c = bs[j]; if (!a.alive || !c.alive) continue;
        var dx = c.x - a.x, dy = c.y - a.y, dz = c.h - a.h, d2 = dx * dx + dy * dy + dz * dz, mm = 2 * R;
        if (d2 >= mm * mm) continue;
        var d = Math.sqrt(d2), nx = d > 1e-9 ? dx / d : 1, ny = d > 1e-9 ? dy / d : 0, nz = d > 1e-9 ? dz / d : 0;
        var ma = a.brace ? PU.BRACE_MASS : 1, mc = c.brace ? PU.BRACE_MASS : 1, inv = 1 / ma + 1 / mc, pen = mm - d;
        a.x -= nx * pen / ma / inv; a.y -= ny * pen / ma / inv; a.h -= nz * pen / ma / inv;
        c.x += nx * pen / mc / inv; c.y += ny * pen / mc / inv; c.h += nz * pen / mc / inv;
        if (a.h < 0) a.h = 0; if (c.h < 0) c.h = 0;
        var van = a.vx * nx + a.vy * ny + a.vh * nz, vcn = c.vx * nx + c.vy * ny + c.vh * nz, rv = vcn - van;
        if (rv < 0) {
          var pk = 1 + ((a.dsh > 0 && van > 0) || (c.dsh > 0 && vcn < 0) ? PU.PUNCH : 0);
          var jj = -(1 + PU.REST) * rv / inv * pk;
          a.vx -= jj * nx / ma; a.vy -= jj * ny / ma; a.vh -= jj * nz / ma; c.vx += jj * nx / mc; c.vy += jj * ny / mc; c.vh += jj * nz / mc;
          a.lastHit = c.i; c.lastHit = a.i;
          var key = i * 8 + j;
          if (!hitPair[key] && -rv > PU.HIT_MIN) { hitPair[key] = 1; ev(w, [PU.EV.hit, i, j, Math.round(-rv * pk * 10), Math.round((a.x + c.x) * 500), Math.round((a.y + c.y) * 500)]); }
        }
      }
      for (i = 0; i < n; i++) {
        var q = bs[i]; if (!q.alive) continue;
        // ball ↔ hazards (solid, infinite mass; a hazard rising under a ball pushes it out). A bumper is a short cylinder: its top is a trampoline
        for (j = 0; j < w.hz.length; j++) {
          var h = w.hz[j]; if (!hzOn(w, h, t)) continue;
          var ex = q.x - h.x, ey = q.y - h.y, e2 = ex * ex + ey * ey, rr = R + h.r;
          if (e2 >= rr * rr) continue;
          var e = Math.sqrt(e2), ux = e > 1e-9 ? ex / e : 1, uy = e > 1e-9 ? ey / e : 0;
          if (h.k === 'bump') {
            var H = PU.BUMP_H * hzLevel(w, h, t), cz = q.h + R, dr = Math.max(0, e - h.r), dzz = Math.max(0, cz - H), l2 = dr * dr + dzz * dzz;
            if (l2 >= R * R) continue;
            var nr, nzz, push;
            if (l2 < 1e-12) { nr = 1; nzz = 0; push = rr - e; } else { var ll = Math.sqrt(l2); nr = dr / ll; nzz = dzz / ll; push = R - ll; }
            q.x += ux * nr * push; q.y += uy * nr * push; q.h += nzz * push;
            var vn = (q.vx * ux + q.vy * uy) * nr + q.vh * nzz, nv = Math.max(nzz > 0.7 ? PU.BUMP_UP : PU.BUMP_KICK, -vn * PU.BUMP_E, vn);
            q.vx += (nv - vn) * ux * nr; q.vy += (nv - vn) * uy * nr; q.vh += (nv - vn) * nzz;
            if (nzz > 0.7) { q.vx += ux * 2.5; q.vy += uy * 2.5; }   // off the top, never bouncing on it for ever
            if (q.bpT !== w.tick && q.bpT !== w.tick - 1) ev(w, [PU.EV.bump, i, j, Math.round(nv * 10), Math.round(h.x * 1000), Math.round(h.y * 1000)]);
            q.bpT = w.tick;
          } else {                       // a pillar: taller than any jump — a side wall
            q.x = h.x + ux * rr; q.y = h.y + uy * rr;
            var vp = q.vx * ux + q.vy * uy;
            if (vp < 0) { q.vx -= (1 + PU.PILLAR_E) * vp * ux; q.vy -= (1 + PU.PILLAR_E) * vp * uy; }
          }
        }
        // ball ↔ sweeping beams: a low moving bar with a hole = two boxes (thickness W, height BEAM_H, from the hole's sides out past
        // the arena) — sphere vs box, exact; the bar moves along u at BEAM_V
        for (j = 0; j < w.beams.length; j++) {
          var B = w.beams[j], s = beamAt(B, t); if (s == null) continue;
          for (var sd = -1; sd <= 1; sd += 2) {
            var ds = q.x * B.ux + q.y * B.uy - s, dv = -q.x * B.uy + q.y * B.ux - B.gap, cz2 = q.h + R, hw = PU.BEAM_W / 2, g2 = PU.BEAM_GAP / 2;
            var cs = Math.max(-hw, Math.min(ds, hw)), du = ds - cs, cv = sd > 0 ? Math.max(g2, dv) : Math.min(-g2, dv), dvv = dv - cv;
            var dzb = cz2 - Math.max(0, Math.min(cz2, PU.BEAM_H)), l3 = du * du + dvv * dvv + dzb * dzb;
            if (l3 >= R * R) continue;
            var nu, nv2, nz2, pu;
            if (l3 < 1e-12) { nu = 1; nv2 = 0; nz2 = 0; pu = hw + R - ds; } else { var l4 = Math.sqrt(l3); nu = du / l4; nv2 = dvv / l4; nz2 = dzb / l4; pu = R - l4; }
            var nx3 = B.ux * nu - B.uy * nv2, ny3 = B.uy * nu + B.ux * nv2;
            q.x += nx3 * pu; q.y += ny3 * pu; q.h += nz2 * pu; if (q.h < 0) q.h = 0;
            var vr = q.vx * nx3 + q.vy * ny3 + q.vh * nz2 - PU.BEAM_V * nu;
            if (vr < 0) { var ji = -(1 + PU.BEAM_E) * vr; q.vx += ji * nx3; q.vy += ji * ny3; q.vh += ji * nz2; }
            if (q.bmT !== w.tick && q.bmT !== w.tick - 1) ev(w, [PU.EV.beam, i, j, 0, Math.round(q.x * 1000), Math.round(q.y * 1000)]);
            q.bmT = w.tick;
          }
        }
      }
    }
    // the knockback cap (2.3.14 fix: a hit can never throw a ball faster than VMAX, so it can't leave the view in one frame)
    for (i = 0; i < n; i++) if (bs[i].alive) capV(bs[i]);
    // the edge: the centre over no floor and not in the air = falls (the floor is exactly the drawn tiles / platforms)
    for (i = 0; i < n; i++) {
      var o = bs[i];
      if (o.alive && o.h <= 1e-6 && !puFloor(w, o.x, o.y, t)) { o.alive = 0; o.fellAt = w.tick; ev(w, [PU.EV.fall, i, o.lastHit, 0, Math.round(o.x * 1000), Math.round(o.y * 1000)]); }
    }
    w.tick += 1;
    var alive = 0; for (i = 0; i < n; i++) alive += bs[i].alive;
    if (alive <= 1 || t >= PU.ROUND_MAX) w.over = true;
    return w;
  }
  function pushWinner(w) {            // index of the one left, -1 = a draw (nobody / time out with several)
    var l = -1, c = 0; for (var i = 0; i < w.balls.length; i++) if (w.balls[i].alive) { l = i; c++; }
    return c === 1 ? l : -1;
  }
  // ---------------------------------------------------------------- the practice bot (also the server tests' players)
  // It sees the rivals REACT ticks late, thinks every THINK ticks, aims with an error, sometimes makes a mistake, and reads the
  // telegraphs (a blinking tile, the edge, a beam, a gust) like a player. normal is beatable by a new player; hard is not easy.
  var BOT = {
    easy: { react: 16, think: [11, 20], aim: 0.7, mist: 0.25, brace: 0.2, jump: 0.3, margin: 1.0, aggr: 0.3, lead: 0, range: 4.5 },
    normal: { react: 11, think: [8, 15], aim: 0.48, mist: 0.14, brace: 0.4, jump: 0.6, margin: 1.4, aggr: 0.4, lead: 0.2, range: 5.5 },
    hard: { react: 4, think: [3, 7], aim: 0.12, mist: 0.03, brace: 0.9, jump: 0.92, margin: 1.8, aggr: 0.7, lead: 0.8, range: 7.5 }
  };
  function pushBot(w, i, mem, lvl, rnd) {
    var L = typeof lvl === 'object' ? lvl : BOT[lvl] || BOT.normal, me = w.balls[i]; if (!me || !me.alive) return null;
    var hist = mem.h || (mem.h = []);
    hist.push(w.balls.map(function (b) { return [b.x, b.y, b.vx, b.vy, b.alive]; })); while (hist.length > L.react + 1) hist.shift();
    var seen = hist[0], t = w.tick / PU.TPS, out = { brace: mem.br || 0, dash: null, jump: false };
    // beams: jump when the bar is about to reach me (once per beam, with a timing error; sometimes it just doesn't)
    mem.jb = mem.jb || {};
    for (var j = 0; j < w.beams.length; j++) {
      var B = w.beams[j], s = beamAt(B, t); if (s == null || mem.jb[j] === 2) continue;
      var gap = me.x * B.ux + me.y * B.uy - s - PU.BEAM_W / 2 - PU.R;
      if (mem.jb[j] == null) mem.jb[j] = rnd() < L.jump ? 1 : 2;
      var inHole = Math.abs(-me.x * B.uy + me.y * B.ux - B.gap) < PU.BEAM_GAP / 2 - PU.R - 0.1;
      if (inHole) continue;
      if (mem.jb[j] === 1 && gap > 0 && gap < PU.BEAM_V * (0.1 + rnd() * 0.12 + (1 - L.jump) * 0.12)) { out.jump = true; mem.jb[j] = 2; }
    }
    if (w.tick < (mem.next || 0)) return out;
    mem.next = w.tick + L.think[0] + Math.floor(rnd() * (L.think[1] - L.think[0] + 1));
    var tg = -1, best = 1e9, k;
    for (k = 0; k < seen.length; k++) if (k !== i && seen[k][4]) { var ddx = seen[k][0] - me.x, ddy = seen[k][1] - me.y, dd = ddx * ddx + ddy * ddy; if (dd < best) { best = dd; tg = k; } }
    // brace: a rival coming in fast, or a gust (now or telegraphed)
    var br = 0;
    if (tg >= 0) { var o = seen[tg], ox = me.x - o[0], oy = me.y - o[1], cl = (o[2] * ox + o[3] * oy) / Math.max(0.1, Math.sqrt(best)); if (cl > 5 && best < 10 && rnd() < L.brace) br = 1; }
    if ((gustAt(w, t) || gustAt(w, t + PU.GUST_WARN * 0.6)) && rnd() < L.brace) br = 1;
    // danger: where I'll be soon is no floor (the edge, a gap, a blinking tile, the burning rim)
    var r = Math.sqrt(me.x * me.x + me.y * me.y), ux = r > 1e-6 ? me.x / r : 1, uy = r > 1e-6 ? me.y / r : 0, la = 0.45;
    var danger = !puFloor(w, me.x + me.vx * la, me.y + me.vy * la, t + 0.6) || !puFloor(w, me.x + ux * L.margin, me.y + uy * L.margin, t + 0.8) || !puFloor(w, me.x, me.y, t + 1.0);
    if (danger) br = br || (rnd() < L.brace ? 1 : 0);
    out.brace = br; mem.br = br;
    if (me.cd > 0) return out;
    if (danger && rnd() >= L.mist) {    // back to safety: the direction whose point 2.4 m away stays floor longest, nearest the centre
      var bx = -me.x, by = -me.y, bs2 = -1e9;
      for (k = 0; k < 16; k++) {
        var px = me.x + D16[k][0] * 2.4, py = me.y + D16[k][1] * 2.4, sc = (puFloor(w, px, py, t + 1.2) ? 10 : 0) + (puFloor(w, px, py, t + 2.5) ? 4 : 0) - Math.sqrt(px * px + py * py) * 0.3;
        if (sc > bs2) { bs2 = sc; bx = D16[k][0]; by = D16[k][1]; }
      }
      out.dash = [bx, by]; return out;
    }
    if (tg >= 0 && Math.sqrt(best) < L.range && rnd() < L.aggr) {
      var T2 = seen[tg], ax = T2[0] + T2[2] * L.lead * 0.3 - me.x, ay = T2[1] + T2[3] * L.lead * 0.3 - me.y, er = (rnd() - 0.5) * 2 * L.aim;
      if (rnd() < L.mist) { var md = D16[Math.floor(rnd() * 16)]; out.dash = [md[0], md[1]]; return out; }   // a mistake: a dash the wrong way
      out.dash = [ax - er * ay, ay + er * ax];     // a small rotation by the aim error (no trig)
    }
    return out;
  }
  // Elo for one pair: [newA, newB]; s = 1 A won, 0 B won
  function elo(ra, rb, s, K) { var ea = 1 / (1 + Math.pow(10, (rb - ra) / 400)), d = Math.round(K * (s - ea)); return [ra + d, rb - d]; }

  return { mulberry: mulberry, fnv1a: fnv1a, dayKey: dayKey, GH: GH, TRACK_RE: TRACK_RE, laneX: laneX, trackIds: trackIds, ghostTrack: ghostTrack, ghostNew: ghostNew,
    ghostInput: ghostInput, ghostStep: ghostStep, ghostSy: ghostSy, ghostRun: ghostRun, encodeInputs: encodeInputs, decodeInputs: decodeInputs, ghostProblem: ghostProblem, hitBox: hitBox,
    PU: PU, D16: D16, pang: pang, pdir: pdir, tileIdx: tileIdx, tileCentre: tileCentre, ringsOf: ringsOf, beamDur: beamDur, pushArenaOf: pushArenaOf, pushSpawns: pushSpawns, pushPlan: pushPlan, pushLayout: pushLayout,
    platAt: platAt, sdR: sdR, edgeOf: edgeOf, floorAt: puFloor, tileFall: tileFall, beamAt: beamAt, gustAt: gustAt, tiltAt: tiltAt, hzLevel: hzLevel, hzOn: hzOn,
    pushNew: pushNew, pushClone: pushClone, pushDash: pushDash, pushJump: pushJump, pushStep: pushStep, pushWinner: pushWinner, BOT: BOT, pushBot: pushBot, elo: elo };
})();

if (typeof window !== 'undefined') window.ModesCore = ModesCore;

export { ModesCore };
