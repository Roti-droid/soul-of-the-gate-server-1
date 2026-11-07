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
   Rating: Elo (K 32 duel, 16 per pair in a 4-player match). */
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
    TPS: 30, LANE_W: 2.2, R: 0.55, V0: 11, VMAX: 23, ACC: 0.42, VHIT: 4, STUN: 8, JUMP_V: 8.6, GRAV: 27, DIVE_V: -15,
    SLIDE_T: 17, SLIDE_SY: 0.5, LAT_V: 12, BOOST: 1.6, VOVER: 3, MAX_TICKS: 30 * 240, MAX_INPUTS: 3000,
    WALL_H: 0.9, WALL_D: 0.7, GATE_H: 2.6, BAR_Y0: 0.8, BAR_Y1: 1.5, BAR_D: 0.4, GEM_R: 0.36, GEM_Y: 0.6, GEM_HI: 1.7,
    TRACKS: [null, { len: 600, k: 0.0 }, { len: 1000, k: 0.35 }, { len: 1500, k: 0.7 }],   // 3 daily tracks: short / middle / long
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
    while (z < len - 34) {
      var hard = Math.min(1, z / len * 0.8 + T0.k * 0.5), p = r(), kind;
      if (p < 0.30) kind = 'wall'; else if (p < 0.44) kind = 'wall2'; else if (p < 0.62) kind = 'bar'; else if (p < 0.78) kind = 'gate'; else kind = 'gem';
      if (kind === last && kind !== 'wall') kind = 'wall';
      var l = Math.floor(r() * 3), gap;
      if (kind === 'wall' || kind === 'wall2') {
        var ls = kind === 'wall' ? [l] : [0, 1, 2].filter(function (x) { return x !== l; });
        ls.forEach(function (q) { boxes.push({ k: 'wall', z0: z, z1: z + GH.WALL_D, x0: laneX(q) - 1.0, x1: laneX(q) + 1.0, y0: 0, y1: GH.WALL_H }); });
        marks.push({ k: kind, z: z, lanes: ls }); gap = 15;
      } else if (kind === 'gate') {
        [0, 1, 2].forEach(function (q) { if (q !== l) boxes.push({ k: 'gate', z0: z, z1: z + GH.WALL_D, x0: laneX(q) - 1.1, x1: laneX(q) + 1.1, y0: 0, y1: GH.GATE_H }); });
        marks.push({ k: 'gate', z: z, open: l }); gap = 18;
      } else if (kind === 'bar') {
        boxes.push({ k: 'bar', z0: z, z1: z + GH.BAR_D, x0: -3.3, x1: 3.3, y0: GH.BAR_Y0, y1: GH.BAR_Y1 });
        marks.push({ k: 'bar', z: z }); gap = 17;
      } else {
        var hi = r() < 0.4;
        for (var g = 0; g < 3; g++) gems.push({ z: z + g * 3.2, x: laneX(l), y: hi ? GH.GEM_HI : GH.GEM_Y, i: gems.length });
        marks.push({ k: 'gem', z: z, lane: l, hi: hi }); gap = 13;
      }
      last = kind;
      z += gap + Math.floor(r() * (14 - hard * 8));
    }
    boxes.sort(function (a, b) { return a.z0 - b.z0; });
    return { id: id, seed: seed, len: len, boxes: boxes, gems: gems, marks: marks };
  }
  // the ball's collider is the ellipsoid it is drawn as: semi-axes (R·sx, R·sy, R·sx), sx = 1/√sy (the slide squash keeps volume)
  function ghostSy(b) { return b.slide > 0 ? GH.SLIDE_SY : 1; }
  function hitBox(x, y, z, sy, bx) {   // ellipsoid (centre x, y + R·sy, z) vs box: scale into the unit-sphere space, exact
    var sx = 1 / Math.sqrt(sy), rx = GH.R * sx, ry = GH.R * sy, cy = y + ry;
    var px = Math.max(bx.x0, Math.min(x, bx.x1)), py = Math.max(bx.y0, Math.min(cy, bx.y1)), pz = Math.max(bx.z0, Math.min(z, bx.z1));
    var dx = (px - x) / rx, dy = (py - cy) / ry, dz = (pz - z) / rx;
    return dx * dx + dy * dy + dz * dz < 1 - 1e-9;
  }
  function anyHit(tr, b, x, y, z, sy) {
    var bs = tr.boxes;
    for (var i = b.bi; i < bs.length; i++) { var q = bs[i]; if (q.z0 > z + 2) break; if (q.z1 < z - 2) continue; if (hitBox(x, y, z, sy, q)) return q; }
    return null;
  }
  function floorAt(tr, b, x, z) {     // the top the ball stands on: the road (0) or a wall under its centre
    var bs = tr.boxes, f = 0;
    for (var i = b.bi; i < bs.length; i++) { var q = bs[i]; if (q.z0 > z + 1) break; if (q.k === 'wall' && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) f = Math.max(f, q.y1); }
    return f;
  }
  function ghostNew(tr) { return { tr: tr, tick: 0, z: 0, x: 0, y: 0, vy: 0, lane: 1, v: GH.V0, slide: 0, stun: 0, hits: 0, gems: 0, got: {}, bi: 0, blk: 0, done: false, fin: 0 }; }
  function ghostInput(b, act) {
    var sy = ghostSy(b), gr = b.y <= floorAt(b.tr, b, b.x, b.z) + 1e-6;
    if (act === 'L' && b.lane > 0) b.lane -= 1;
    else if (act === 'R' && b.lane < 2) b.lane += 1;
    else if (act === 'U') { if (gr) { b.slide = 0; if (!anyHit(b.tr, b, b.x, b.y, b.z, 1)) b.vy = GH.JUMP_V; else b.slide = 1; } }
    else if (act === 'D') { if (!gr) b.vy = Math.min(b.vy, GH.DIVE_V); else b.slide = GH.SLIDE_T; }
    return sy;
  }
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
    if (ny <= fl) { ny = fl; b.vy = 0; }
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
    if (b.stun > 0) b.stun -= 1;
    else if (b.v < GH.VMAX) b.v = Math.min(GH.VMAX, b.v + GH.ACC * dt * (1 + (GH.VMAX - b.v) / GH.VMAX));
    else if (b.v > GH.VMAX) b.v = Math.max(GH.VMAX, b.v - 2 * dt);
    var z0 = b.z, nz = z0 + b.v * dt;
    if (anyHit(tr, b, b.x, b.y, nz, sy)) {          // stop at the contact (bisection, 14 halvings ≈ 0.1 mm)
      var lo = z0, hi = nz;
      for (var k = 0; k < 14; k++) { var mid = (lo + hi) / 2; if (anyHit(tr, b, b.x, b.y, mid, sy)) hi = mid; else lo = mid; }
      nz = lo; b.v = GH.VHIT; if (!b.blk) b.hits += 1; b.stun = GH.STUN; b.blk = 1;
    } else b.blk = 0;
    b.z = nz;
    // crystals
    var gs = tr.gems;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i]; if (g.z > b.z + 2) break; if (g.z < b.z - 2 || b.got[g.i]) continue;
      var ex = g.x - b.x, ey = g.y - (b.y + GH.R * sy), ez = g.z - b.z, rr = GH.R + GH.GEM_R;
      if (ex * ex + ey * ey + ez * ez < rr * rr) { b.got[g.i] = 1; b.gems += 1; b.v = Math.min(GH.VMAX + GH.VOVER, b.v + GH.BOOST); }
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
    return { done: b.done, ms: b.fin, ticks: b.tick, hits: b.hits, gems: b.gems, frames: fr, used: j };
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
  var PU = {
    TPS: 30, R: 0.62, DASH_V: 10.5, DASH_CD: 24, FRICT: 1.25, BRACE_FRICT: 3.4, BRACE_MASS: 2.6, BRACE_DASH: 0.5, VMAX: 17, REST: 0.92,
    RINGS: [3.4, 5.4, 7.4, 9.4],          // outer radius of ring 0 (centre disc) … ring 3 (the edge at the start)
    DROP_AT: [24, 34, 44],                // s of the round: ring 3, 2, 1 fall (warning WARN s before)
    WARN: 2.4, BUMP_AT: 8, PILLAR_AT: 15, RISE: 0.9, ROUND_MAX: 62, WIN_ROUNDS: 2, COUNT: 3, BETWEEN: 2.6,
    BUMP_R: 0.75, BUMP_KICK: 7, BUMP_E: 1.0, PILLAR_R: 0.6, PILLAR_E: 0.35
  };
  function pushSpawns(n) {            // start places on a circle of 4.6 m (deterministic, no trig at run time)
    var P4 = [[-4.6, 0], [4.6, 0], [0, -4.6], [0, 4.6]];
    return n === 2 ? [P4[0], P4[1]] : P4.slice(0, n);
  }
  // the hazards of one round from the match seed + round number: bumpers on ring 2, pillars on rings 1–2 (never on a spawn)
  function pushLayout(seed, round, n) {
    var r = mulberry((seed ^ Math.imul(round + 1, 0x9E3779B1)) >>> 0 || 1), hz = [], sp = pushSpawns(n);
    function free(x, y, rad) {
      for (var i = 0; i < hz.length; i++) { var dx = hz[i].x - x, dy = hz[i].y - y, m = hz[i].r + rad + 1.4; if (dx * dx + dy * dy < m * m) return false; }
      for (var j = 0; j < sp.length; j++) { var ex = sp[j][0] - x, ey = sp[j][1] - y; if (ex * ex + ey * ey < 2.2 * 2.2) return false; }
      return x * x + y * y > 1.4 * 1.4;
    }
    // positions from a table of unit directions (16 compass points) — no trig, identical everywhere
    var D = [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
      [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827]];
    function place(kind, cnt, rMin, rMax, rad, at) {
      for (var t = 0, got = 0; t < 60 && got < cnt; t++) {
        var d = D[Math.floor(r() * 16)], rr = rMin + r() * (rMax - rMin), x = d[0] * rr, y = d[1] * rr;
        var ring = 0; while (ring < 3 && rr >= PU.RINGS[ring]) ring++;
        var ok = true; for (var q = 0; q < 4; q++) if (Math.abs(rr - PU.RINGS[q]) < rad + 0.15) ok = false;   // stands on one ring's tiles, never across a seam
        if (ok && free(x, y, rad)) { hz.push({ k: kind, x: x, y: y, r: rad, at: at + got * 0.6, ring: ring }); got++; }
      }
    }
    place('bump', n > 2 ? 3 : 2, 4.0, 6.6, PU.BUMP_R, PU.BUMP_AT);
    place('pillar', n > 2 ? 3 : 2, 2.2, 6.4, PU.PILLAR_R, PU.PILLAR_AT);
    return hz;
  }
  // the edge radius at round time t (s): ring k falls at DROP_AT; returns {r, ring (outer ring index alive), warn: ring about to fall or -1}
  function pushEdge(t) {
    var ring = 3, warn = -1;
    for (var i = 0; i < PU.DROP_AT.length; i++) { if (t >= PU.DROP_AT[i]) ring = 2 - i; else if (t >= PU.DROP_AT[i] - PU.WARN && warn < 0) warn = 3 - i; }
    return { r: PU.RINGS[ring], ring: ring, warn: warn };
  }
  function pushNew(n, seed, round) {
    var sp = pushSpawns(n), balls = [];
    for (var i = 0; i < n; i++) balls.push({ i: i, x: sp[i][0], y: sp[i][1], vx: 0, vy: 0, brace: 0, cd: 12, alive: 1, fellAt: -1, lastHit: -1 });
    return { n: n, seed: seed, round: round, tick: 0, balls: balls, hz: pushLayout(seed, round, n), over: false };
  }
  function pushDash(w, i, dx, dy) {   // a swipe: direction (any length); null if on cooldown / gone
    var b = w.balls[i]; if (!b || !b.alive || b.cd > 0) return false;
    var l = Math.sqrt(dx * dx + dy * dy); if (!(l > 1e-6)) return false;
    var k = PU.DASH_V * (b.brace ? PU.BRACE_DASH : 1) / l;
    b.vx += dx * k; b.vy += dy * k; b.cd = PU.DASH_CD;
    return true;
  }
  // solid from the moment it starts to rise (it grows out of the floor and pushes a ball off its spot — never through it)
  function hzOn(h, t, edgeRing) { return t >= h.at && h.ring <= edgeRing; }
  function pushStep(w) {
    if (w.over) return w;
    var dt = 1 / PU.TPS, t = w.tick * dt, ed = pushEdge(t), bs = w.balls, n = bs.length, i, j;
    for (i = 0; i < n; i++) {
      var b = bs[i]; if (!b.alive) continue;
      if (b.cd > 0) b.cd -= 1;
      var f = b.brace ? PU.BRACE_FRICT : PU.FRICT, k = Math.max(0, 1 - f * dt);
      b.vx *= k; b.vy *= k;
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (sp > PU.VMAX) { b.vx *= PU.VMAX / sp; b.vy *= PU.VMAX / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    // ball ↔ ball, masses by brace, restitution REST
    for (var pass = 0; pass < 8; pass++) {   // contacts are solved together a few times: a ball between a rival and a pillar ends up touching both, inside neither
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var a = bs[i], c = bs[j]; if (!a.alive || !c.alive) continue;
      var dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy, m = 2 * PU.R;
      if (d2 >= m * m) continue;
      var d = Math.sqrt(d2), nx = d > 1e-9 ? dx / d : 1, ny = d > 1e-9 ? dy / d : 0;
      var ma = a.brace ? PU.BRACE_MASS : 1, mc = c.brace ? PU.BRACE_MASS : 1, inv = 1 / ma + 1 / mc, pen = m - d;
      a.x -= nx * pen * (1 / ma) / inv; a.y -= ny * pen * (1 / ma) / inv; c.x += nx * pen * (1 / mc) / inv; c.y += ny * pen * (1 / mc) / inv;
      var rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rv < 0) {
        var jj = -(1 + PU.REST) * rv / inv;
        a.vx -= jj * nx / ma; a.vy -= jj * ny / ma; c.vx += jj * nx / mc; c.vy += jj * ny / mc;
        a.lastHit = c.i; c.lastHit = a.i;
      }
    }
    // ball ↔ hazards (solid circles of infinite mass; a hazard rising under a ball pushes it out)
    for (i = 0; i < n; i++) {
      var q = bs[i]; if (!q.alive) continue;
      for (j = 0; j < w.hz.length; j++) {
        var h = w.hz[j]; if (!hzOn(h, t, ed.ring)) continue;
        var ex = q.x - h.x, ey = q.y - h.y, e2 = ex * ex + ey * ey, mm = PU.R + h.r;
        if (e2 >= mm * mm) continue;
        var e = Math.sqrt(e2), ux = e > 1e-9 ? ex / e : 1, uy = e > 1e-9 ? ey / e : 0;
        q.x = h.x + ux * mm; q.y = h.y + uy * mm;
        var vn = q.vx * ux + q.vy * uy;
        if (h.k === 'bump') { var nv = Math.max(PU.BUMP_KICK, -vn * PU.BUMP_E, vn); q.vx += (nv - vn) * ux; q.vy += (nv - vn) * uy; h.hitT = w.tick; }   // a spring: out at ≥ BUMP_KICK
        else if (vn < 0) { q.vx -= (1 + PU.PILLAR_E) * vn * ux; q.vy -= (1 + PU.PILLAR_E) * vn * uy; }
      }
    }
    }
    // the edge: the centre off the floor = falls (the floor is exactly the drawn tiles of the alive rings)
    for (i = 0; i < n; i++) { var o = bs[i]; if (o.alive && o.x * o.x + o.y * o.y > ed.r * ed.r) { o.alive = 0; o.fellAt = w.tick; } }
    w.tick += 1;
    var alive = 0; for (i = 0; i < n; i++) alive += bs[i].alive;
    if (alive <= 1 || t >= PU.ROUND_MAX) w.over = true;
    return w;
  }
  function pushWinner(w) {            // index of the one left, -1 = a draw (nobody / time out with several)
    var l = -1, c = 0; for (var i = 0; i < w.balls.length; i++) if (w.balls[i].alive) { l = i; c++; }
    return c === 1 ? l : -1;
  }
  // Elo for one pair: [newA, newB]; s = 1 A won, 0 B won
  function elo(ra, rb, s, K) { var ea = 1 / (1 + Math.pow(10, (rb - ra) / 400)), d = Math.round(K * (s - ea)); return [ra + d, rb - d]; }

  return { mulberry: mulberry, fnv1a: fnv1a, dayKey: dayKey, GH: GH, TRACK_RE: TRACK_RE, laneX: laneX, trackIds: trackIds, ghostTrack: ghostTrack, ghostNew: ghostNew,
    ghostInput: ghostInput, ghostStep: ghostStep, ghostSy: ghostSy, ghostRun: ghostRun, encodeInputs: encodeInputs, decodeInputs: decodeInputs, ghostProblem: ghostProblem, hitBox: hitBox,
    PU: PU, pushSpawns: pushSpawns, pushLayout: pushLayout, pushEdge: pushEdge, pushNew: pushNew, pushDash: pushDash, pushStep: pushStep, pushWinner: pushWinner, hzOn: hzOn, elo: elo };
})();

if (typeof window !== 'undefined') window.ModesCore = ModesCore;

export { ModesCore };
