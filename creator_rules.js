// creator_rules.js — «Создать» (level constructor): the level schema, catalogue, solver, completion rules, weekly themes and
// the «Магазин автора» price list. The block CORE is an exact copy of the game's src/creator_core.js (test/test_creator.mjs
// compares them) — edit both together.
const C = (function () {
  /*CORE{*/
  var VER = 1, H = 1, MAXLEN = 3000, MINLEN = 300, MAXIT = 400, MAXJSON = 12288;
  var GRAV = 40, JUMP_V = 13.2, JUMP_T = 2 * 13.2 / 40, SLIDE_T = 0.7, LANE_T = 0.15;
  var SPD = { easy: { start: 12, max: 27, ramp: 3400 }, normal: { start: 14, max: 35, ramp: 2400 }, hard: { start: 19, max: 45, ramp: 1500 } };
  var ENVS = ['road', 'air', 'water'], WORLDS = ['classic', 'A', 'B', 'C'], MUSIC = ['auto', 'calm', 'drive', 'dark'], BOSSES = ['none', 'warden'];
  // pass: '' = must be in another lane; 'h' = high in a jump; 'ha' = any airborne; 's' = sliding. ob = the game's obstacle type.
  // p: [min, max, default] of the one parameter. wide: all three lanes. set: a set piece. sweep: m swept toward the player (moving).
  var KINDS = {
    low: { ob: 1, pass: 'h', depth: 0.45, ru: 'Барьер', en: 'Barrier', cat: 'h' },
    bar: { ob: 2, pass: 's', depth: 0.2, ru: 'Перекладина', en: 'Bar', cat: 'h' },
    blk: { ob: 3, pass: '', depth: 0, p: [2, 14, 3], pn: 'len', ru: 'Блок', en: 'Block', cat: 'h' },
    crt: { ob: 10, pass: '', depth: 1.4, ru: 'Ящик', en: 'Crate', cat: 'h' },
    spk: { ob: 11, pass: 'h', depth: 1.6, ru: 'Шипы', en: 'Spikes', cat: 'h' },
    pit: { ob: 4, pass: 'ha', depth: 0, p: [2, 5, 3], pn: 'len', ru: 'Яма', en: 'Pit', cat: 'h' },
    trn: { ob: 9, pass: '', depth: 12, sweep: 46, ru: 'Поезд', en: 'Train', cat: 'm' },
    saw: { ob: 53, pass: 'h', depth: 0, p: [1, 3, 1], pn: 'n', ru: 'Пилы', en: 'Saws', cat: 'm' },
    las: { ob: 7, pass: '', depth: 0.25, timed: true, p: [0, 7, 0], pn: 'ph', ru: 'Лазер', en: 'Laser', cat: 'm' },
    prs: { ob: 68, pass: '', depth: 1.5, timed: true, p: [0, 7, 0], pn: 'ph', ru: 'Пресс', en: 'Press', cat: 'm' },
    lsw: { ob: 67, pass: 'h', depth: 0.4, wide: true, timed: true, p: [0, 1, 0], pn: 'fin', ru: 'Лазерная волна', en: 'Laser sweep', cat: 'm' },
    gat: { ob: 13, pass: '', depth: 0.3, wide: true, p: [0, 2, 1], pn: 'open', ru: 'Ворота', en: 'Gates', cat: 'm' },
    gey: { ob: 51, launch: true, depth: 2, ru: 'Гейзер', en: 'Geyser', cat: 'm' },
    bst: { ob: 12, soft: true, depth: 3.2, ru: 'Ускоритель', en: 'Boost', cat: 'b' },
    jet: { set: 'jet', span: 320, ru: 'Ранец', en: 'Jetpack', cat: 'm' },
    tun: { set: 'tun', p: [30, 240, 90], pn: 'len', ru: 'Тоннель', en: 'Tunnel', cat: 'm' },
    mag: { pup: 'mag', ru: 'Магнит', en: 'Magnet', cat: 'b' },
    shd: { pup: 'shd', ru: 'Щит', en: 'Shield', cat: 'b' },
    mul: { pup: 'mul', ru: '×2', en: '×2', cat: 'b' },
    cry: { cry: true, p: [1, 12, 5], pn: 'n', ru: 'Кристаллы', en: 'Crystals', cat: 'c' }
  };
  var TOP = ['v', 'title', 'env', 'world', 'music', 'boss', 'len', 'spd', 'coins', 'it'];
  var CRY_STEP = 2.6;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clean(s) { return String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, '').replace(/\s+/g, ' ').trim(); }
  function speedAt(spd, d) { var s = SPD[spd] || SPD.normal; return s.start + (s.max - s.start) * (1 - Math.exp(-Math.max(0, d) / s.ramp)); }
  function depthOf(k, p) {
    var K = KINDS[k];
    if (k === 'blk' || k === 'pit') return p;
    if (k === 'saw') return p * 1.42 + 0.2;
    return K.depth || 0;
  }
  function param(k, p) { var K = KINDS[k]; return K.p ? (p == null ? K.p[2] : p) : 0; }
  // footprint of a hazard: lanes bitmask, [lo, hi] metres, pass rule ('' / 'h' / 'ha' / 's')
  function foot(e) {
    var k = e[0], K = KINDS[k], p = param(k, e[3]), at = e[2];
    if (!K || K.set || K.pup || K.cry || K.soft || K.launch) return null;
    var d = depthOf(k, p), lo = at - d / 2, hi = at + d / 2, lanes = K.wide ? 7 : (1 << e[1]), pass = K.pass;
    if (K.sweep) lo = at - K.sweep - d / 2;
    if (k === 'lsw') pass = p ? 's' : 'h';
    if (k === 'gat') lanes = 7 & ~(1 << p);
    return { lanes: lanes, lo: lo, hi: hi, pass: pass, k: k, at: at, free: !!(K.timed || K.sweep) };
  }
  function err(errs, i, code, extra) { var e = { i: i, code: code }; if (extra) for (var x in extra) e[x] = extra[x]; errs.push(e); }
  // strict schema → {lvl, errs}; lvl = a fresh clean copy (items sorted by distance)
  function schema(raw) {
    var errs = [], out = {};
    if (!isObj(raw)) { err(errs, -1, 'not_object'); return { errs: errs }; }
    for (var k in raw) if (own(raw, k) && TOP.indexOf(k) < 0) err(errs, -1, 'unknown_field', { f: String(k).slice(0, 24) });
    if (raw.v !== VER) err(errs, -1, 'bad_version');
    out.v = VER;
    var t = typeof raw.title === 'string' ? clean(raw.title) : '';
    if (t.length < 1 || t.length > 32) err(errs, -1, 'bad_title'); out.title = t.slice(0, 32);
    [['env', ENVS], ['world', WORLDS], ['music', MUSIC], ['boss', BOSSES], ['spd', ['easy', 'normal', 'hard']], ['coins', ['auto', 'man']]].forEach(function (f) {
      if (f[1].indexOf(raw[f[0]]) < 0) err(errs, -1, 'bad_' + f[0]); out[f[0]] = raw[f[0]];
    });
    if (typeof raw.len !== 'number' || raw.len % 10 !== 0 || raw.len < MINLEN || raw.len > MAXLEN) err(errs, -1, 'bad_len'); out.len = raw.len;
    if (!Array.isArray(raw.it) || raw.it.length > MAXIT) { err(errs, -1, 'bad_items'); return { errs: errs }; }
    out.it = [];
    for (var i = 0; i < raw.it.length; i++) {
      var e = raw.it[i];
      if (!Array.isArray(e) || e.length < 3 || e.length > 4) { err(errs, i, 'bad_item'); continue; }
      var kk = e[0], K = typeof kk === 'string' && own(KINDS, kk) ? KINDS[kk] : null;
      if (!K) { err(errs, i, 'unknown_kind'); continue; }
      var lane = e[1], at = e[2], p = e.length > 3 ? e[3] : null;
      if (lane !== 0 && lane !== 1 && lane !== 2) { err(errs, i, 'bad_lane'); continue; }
      if (K.wide || K.set) lane = 1;
      if (typeof at !== 'number' || !isFinite(at) || Math.round(at * 10) !== at * 10 || at < 20 || at > out.len - 15) { err(errs, i, 'bad_at'); continue; }
      if (p != null && (!K.p || typeof p !== 'number' || Math.floor(p) !== p || p < K.p[0] || p > K.p[1])) { err(errs, i, 'bad_param'); continue; }
      var c = [kk, lane, at]; if (K.p) c.push(param(kk, p));
      out.it.push(c);
    }
    out.it.sort(function (a, b) { return a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]); });
    return { lvl: out, errs: errs };
  }
  // level rules (after the schema): set pieces, overlap / closed rows, crystals; + solve()
  function validate(raw, opt) {
    opt = opt || {};
    var s = schema(raw), errs = s.errs;
    if (!s.lvl) return { ok: false, errs: errs };
    var L = s.lvl, it = L.it, i, j, haz = 0, fps = [];
    if (opt.size != null && opt.size > MAXJSON) err(errs, -1, 'too_big');
    for (i = 0; i < it.length; i++) {
      var e = it[i], K = KINDS[e[0]], f = foot(e);
      if (f) { f.i = i; fps.push(f); haz++; }
      if (K.set === 'jet') {
        if (L.len - e[2] < K.span + 20) err(errs, i, 'jet_end');
        for (j = 0; j < it.length; j++) if (j !== i && it[j][2] > e[2] - 30 && it[j][2] < e[2] + K.span && !KINDS[it[j][0]].cry) { err(errs, j, 'in_jet'); }
      }
      if (K.set === 'tun') {
        var tend = e[2] + e[3];
        if (tend > L.len - 10) err(errs, i, 'tun_end');
        for (j = 0; j < it.length; j++) { var kj = KINDS[it[j][0]]; if (it[j][2] > e[2] - 4 && it[j][2] < tend + 4 && (kj.launch || kj.soft || kj.set)) if (j !== i) err(errs, j, 'in_tunnel'); }
      }
      if (K.launch) {   // the whole flight + landing stays clear (all lanes)
        var v = speedAt(L.spd, e[2]), lo = e[2] + 1.5, hi = e[2] + v * 1.3 + 3;
        for (j = 0; j < it.length; j++) { var fj = foot(it[j]); if (fj && fj.hi > lo && fj.lo < hi) err(errs, j, 'gey_land'); }
      }
    }
    if (haz < 3) err(errs, -1, 'too_few');
    // the game's footprint rules (patterns.js PatCtx.ob): no two hazards in one lane overlap; never all three lanes hard
    for (i = 0; i < fps.length; i++) for (j = i + 1; j < fps.length; j++) {
      var a = fps[i], b = fps[j];
      if (!(a.lo < b.hi + 0.6 && b.lo < a.hi + 0.6)) continue;
      if (a.lanes & b.lanes) err(errs, fps[j].i, 'overlap', { with: fps[i].i });
      // 2.3.14: no 'closed' row rule — crates can be jumped, lasers timed, trains met where they really are: solve() decides
    }
    var sol = null;
    if (!errs.length) { sol = solve(L, opt.path, opt); if (!sol.ok) err(errs, sol.i, 'blocked', { at: sol.at, why: sol.why }); }
    return { ok: !errs.length, errs: errs, lvl: L, sol: sol, hazards: haz };
  }
  // ---------------------------------------------------------------- reachability
  // state index: lane * 65 + m; m = 0 run, 1..32 jump progress, 33..64 slide progress (progress in 1/32 of the move)
  // ---------------------------------------------------------------- 2.3.14 reachability = the game's physics, exactly
  // Owner: «иногда проходимо, я могу пройти, а мне пишут непроходимо». The 2.3.12 solver rounded the jump to whole 1/32 steps per
  // metre (a jump took 32 m at 35 m/s instead of 23), held the lane you leave for 0.15 s (the game: ≈ 0.055 s), forbade a lane
  // change over ANY hazard, treated crates / lasers as walls, trains as a 52 m wall and ran the 'closed' rule — all false «no».
  // Now: the game's own constants (PHY, checked against the game at load by creator_play.js), the game's speed curve with its
  // easing from 0.7 × start (Runner.update), the ball's vertical motion integrated like the game (jump, slide, fast drop +
  // slide, the squash spring), every hazard's own hit test (obstacles.js / lasers.js / saws.js / rework.js) as a condition
  // on the ball's height and top, timed hazards by the clock (lasers fire, presses slam at the time you get there), trains
  // where you actually meet them. Grid SH = 0.5 m; a cell is passable only if the condition holds over the WHOLE cell (no
  // sampling luck) ± one frame. The search keeps every reachable (lane, move, progress) state per cell — a full BFS.
  var PHY = { GRAV: 40, JUMP_V: 13.2, SLIDE_T: 0.7, SLIDE_SY: 0.42, R: 0.72, LANE_W: 2.1, LANE_K: 17, SPD_K: 1.5, START_K: 0.7, ZS: 0.54,
    TRAIN_V: 6, TRAIN_TRIG: 95, LAS_CYC: 2.4, LAS_CH: 0.6, LAS_ON: 0.8, PR_CYC: 2.2, SAW_PITCH: 1.42, SAW_R: 0.7, SAW_Y: 0.97, LOCK_T: 0.12 };
  var SH = 0.5, SDT = 1 / 240, TEPS = 1 / 60, TSAFE = 0.08, LEAVE_T = 0.06, NOPE = 99, NEG = -99;
  function simBall(mode) {   // y / top over time (240 Hz, the game's order: height, then the squash spring)
    var y = 0, vy = 0, gr = true, sy = 1, sv = 0, sl = 0, out = { y: [], top: [], land: -1, end: 0 }, n = Math.round(1.3 / SDT);
    if (mode === 'j') { vy = PHY.JUMP_V; gr = false; sv = 7; } else { sl = PHY.SLIDE_T; }
    for (var i = 0; i <= n; i++) {
      out.y.push(y); out.top.push(y + 2 * PHY.R * sy);
      if (!gr) { vy -= PHY.GRAV * SDT; y += vy * SDT; if (y <= 0) { var imp = Math.min(1, Math.max(0, -vy / 26)); y = 0; vy = 0; gr = true; sv -= 4 + 6 * imp; if (out.land < 0) out.land = (i + 1) * SDT; } }
      if (sl > 0) sl -= SDT;
      var tsy = sl > 0 ? PHY.SLIDE_SY : 1; sv += ((tsy - sy) * 300 - sv * 18) * SDT; sy += sv * SDT; sy = Math.min(1.45, Math.max(0.35, sy));
    }
    out.end = mode === 'j' ? out.land : PHY.SLIDE_T + 0.22;
    return out;
  }
  var TJ = simBall('j'), TS = simBall('s'), TOPG = 2 * PHY.R * 1.13, YMAXJ = PHY.JUMP_V * PHY.JUMP_V / (2 * PHY.GRAV);
  function tabRange(tb, a, b, o) {
    var i0 = Math.floor(a / SDT), i1 = Math.ceil(b / SDT), n = tb.y.length;
    o.yMin = 1e9; o.topMax = -1e9; o.yMax = -1e9;
    for (var i = i0; i <= i1; i++) {
      var y, tp; if (i < 0) { y = 0; tp = 2 * PHY.R; } else if (i >= n) { y = 0; tp = TOPG; } else { y = tb.y[i]; tp = tb.top[i]; }
      if (y < o.yMin) o.yMin = y; if (y > o.yMax) o.yMax = y; if (tp > o.topMax) o.topMax = tp;
    }
    return o;
  }
  // the game's speed / clock along the track: tb[c + 1] = time at the boundary after cell c (position (c + 0.5) · SH); v[c]
  function profile(L) {
    var S = SPD[L.spd] || SPD.normal, n = Math.ceil((L.len + 30) / SH) + 4, tb = new Float64Array(n + 2), vv = new Float32Array(n + 1);
    var sp = S.start * PHY.START_K, tr = 0, tm = 0, c = 0, k = 1 - Math.exp(-PHY.SPD_K * SDT);
    while (c < n + 1) {
      sp += (speedAt(L.spd, tr) - sp) * k; var nt = tr + sp * SDT;
      while (c < n + 1 && (c - 0.5) * SH <= nt) { var bp = (c - 0.5) * SH; tb[c] = bp <= tr ? tm : tm + (bp - tr) / sp; vv[c] = sp; c++; }
      tr = nt; tm += SDT;
    }
    tb[n + 1] = tb[n] + SH / sp;
    return { n: n, tb: tb, v: vv, at: function (c) { return tb[Math.max(0, Math.min(n + 1, c + 1))]; } };   // at(c) = time when the ball leaves cell c
  }
  function pressY(t) { if (t < 1.0) return 2.9; if (t < 1.45) return 2.9 - (t - 1.0) * 0.4; if (t < 1.58) return Math.max(0, 2.72 * (1 - (t - 1.45) / 0.13)); if (t < 1.95) return 0; return 2.9 * (t - 1.95) / 0.25; }
  // hit tests as «safe if top ≤ A or y ≥ B» over a z-window; Y_OVER = the height a pass record calls 'h' for that kind
  var Y_OVER = { low: 0.78, spk: 0.72, saw: PHY.SAW_Y, crt: 1.4, pit: 0.12, lsw: 0.54, las: 2.0 };
  function hitSpec(e) {
    var k = e[0], p = param(k, e[3]), at = e[2], ZS = PHY.ZS, w = function (half) { return [at - half, at + half]; };
    switch (k) {
      case 'low': return { win: w(0.225 + ZS), A: NEG, B: 0.78 };
      case 'bar': return { win: w(0.1 + ZS), A: 0.95, B: 2.4 };
      case 'blk': return { win: w(p / 2 + ZS), A: NEG, B: NOPE };
      case 'crt': return { win: w(0.7 + ZS), A: NEG, B: 1.4 };
      case 'spk': return { win: w(0.8 + ZS), A: NEG, B: 0.72 };
      case 'pit': return { win: w(Math.max(0, p / 2 - 0.25)), A: NEG, B: 0.12 };
      case 'trn': return { train: true, A: NEG, B: NOPE };
      case 'saw': return { win: w((p - 1) / 2 * PHY.SAW_PITCH + PHY.SAW_R + PHY.R * 0.6), A: NEG, B: PHY.SAW_Y };
      case 'las': return { win: w(0.125 + ZS), laser: p / 8 * PHY.LAS_CYC, A: NEG, B: 2.0 };
      case 'prs': return { win: w(0.75 + ZS), press: p / 8 * PHY.PR_CYC };
      case 'lsw': return { win: w(0.2 + ZS), A: p ? 1.26 : NEG, B: p ? 1.46 : 0.54 };
      case 'gat': return { win: w(0.15 + ZS), door: p };
      case 'bst': return { win: w(1.6 + ZS), A: NEG, B: 0.4, boost: true };   // a boost pad changes the speed: the line goes around / over it
    }
    return null;
  }
  // per lane per cell: list of [A, B, item index]; extra = hazards the game itself adds (jetpack ground patterns), same format
  function buildReq(L, P, extra) {
    var n = P.n, Q = [new Array(n), new Array(n), new Array(n)];
    function put(l, c, A, B, i) { if (c < 0 || c >= n) return; (Q[l][c] || (Q[l][c] = [])).push([A, B, i]); }
    function span(lo, hi) { return [Math.ceil((lo - SH / 2) / SH - 1e-9), Math.floor((hi + SH / 2) / SH + 1e-9)]; }
    var list = [];
    L.it.forEach(function (e, i) { var s = hitSpec(e); if (s) list.push({ e: e, s: s, i: i, lanes: KINDS[e[0]].wide ? 7 : 1 << e[1] }); });
    (extra || []).forEach(function (x) { list.push({ e: null, s: x, i: -1 - (x.i || 0), lanes: x.lanes }); });
    list.forEach(function (h) {
      var s = h.s, c, l, cc;
      if (s.train || s.mv) {        // a train runs toward you once you are TRIG m away: blocked only where you really meet it
        var at = s.mv ? s.at : h.e[2], V = s.mv ? s.mv[0] : PHY.TRAIN_V, TR = s.mv ? s.mv[1] : PHY.TRAIN_TRIG, half = (s.mv ? s.half : 6) + PHY.ZS;
        var cTrig = Math.max(0, Math.floor((at - TR) / SH)), tTrig = (at - TR) <= 0 ? 0 : P.at(cTrig - 1);
        for (c = Math.max(0, cTrig - 2); c < n; c++) {
          var t0 = P.at(c - 1), t1 = P.at(c), wd0 = at - V * Math.max(0, t0 - TEPS - tTrig), wd1 = at - V * Math.max(0, t1 + TEPS - tTrig);
          var lo = c * SH - SH / 2 - wd0, hi = c * SH + SH / 2 - wd1;
          if (hi >= -half && lo <= half) for (l = 0; l < 3; l++) if (h.lanes & (1 << l)) put(l, c, NEG, NOPE, h.i);
          if (lo > half) break;
        }
        return;
      }
      cc = span(s.win[0], s.win[1]);
      for (c = cc[0]; c <= cc[1]; c++) {
        var ta = P.at(c - 1) - TSAFE, tz = P.at(c) + TSAFE;
        if (s.laser != null) {        // fires LAS_CH..LAS_CH + LAS_ON of every LAS_CYC (lasers.js lzPhase, rn.time from the start)
          var fire = false;
          for (var tt = ta; tt <= tz + 1e-9 && !fire; tt += 0.01) { var ph = ((tt + s.laser) % PHY.LAS_CYC + PHY.LAS_CYC) % PHY.LAS_CYC; if (ph >= PHY.LAS_CH && ph < PHY.LAS_CH + PHY.LAS_ON) fire = true; }
          if (fire) for (l = 0; l < 3; l++) if (h.lanes & (1 << l)) put(l, c, s.A, s.B, h.i);
        } else if (s.press != null) { // the head's bottom over this cell's time: safe if the top stays under it, or above it + 0.7
          var bMin = 9, bMax = -9;
          for (var tp = ta; tp <= tz + 1e-9; tp += 0.01) { var by = pressY(((tp + s.press) % PHY.PR_CYC + PHY.PR_CYC) % PHY.PR_CYC); bMin = Math.min(bMin, by); bMax = Math.max(bMax, by); }
          for (l = 0; l < 3; l++) if (h.lanes & (1 << l)) put(l, c, bMin + 0.05, bMax + 0.7, h.i);
        } else if (s.door != null) {  // rework.js: the shutters of the closed lanes reach the road; the open one rolls up to 2.67 m
          for (l = 0; l < 3; l++) put(l, c, l === s.door ? 2.85 * 0.92 + 0.05 : NEG, 2.95, h.i);
        } else for (l = 0; l < 3; l++) if (h.lanes & (1 << l)) put(l, c, s.A, s.B, h.i);
      }
    });
    return Q;
  }
  function solve(L, wantPath, opt) {
    opt = opt || {};
    var P = profile(L), n = Math.min(P.n, Math.ceil((L.len + 1) / SH) + 1), Q = buildReq(L, P, opt.extra), vmax = 0, i, c;
    for (c = 0; c < n; c++) vmax = Math.max(vmax, P.v[c]);
    var KJ = Math.ceil(TJ.end * vmax / SH) + 3, KS = Math.ceil(TS.end * vmax / SH) + 3, KF = Math.ceil(0.12 * vmax / SH) + 2;
    var J0 = 1, S0 = 1 + KJ, F0 = 1 + KJ + KS, NM = F0 + KF, NS = 3 * NM;
    var cur = new Uint8Array(NS), nxt = new Uint8Array(NS), par = wantPath ? new Uint16Array(n * NS) : null;
    var pr = { yMin: 0, yMax: 0, topMax: 0 }, ban = opt.ban || null;
    // pose of move-state m at cell c: [yMin, topMax] over the whole cell (± one frame)
    function pose(c, m, o) {
      if (m === 0) { o.yMin = 0; o.yMax = 0; o.topMax = TOPG; return o; }
      if (m >= F0) { o.yMin = 0; o.yMax = YMAXJ; o.topMax = YMAXJ + 2 * PHY.R * 1.45; return o; }
      var k = m < S0 ? m - J0 + 1 : m - S0 + 1, ts = P.at(c - k), a = P.at(c - 1) - ts - TEPS, b = P.at(c) - ts + TEPS;
      return tabRange(m < S0 ? TJ : TS, a, b, o);
    }
    var dS = new Int32Array(NM).fill(-1), dV = new Int32Array(NM), mY = new Float32Array(NM), mT = new Float32Array(NM), mS = new Int32Array(NM).fill(-1);
    function fits(l, c, m) {
      if (ban && ban[l] && ban[l][c]) return false;
      var q = Q[l][c]; if (!q) return true;
      if (mS[m] === c) { pr.yMin = mY[m]; pr.topMax = mT[m]; } else { pose(c, m, pr); mS[m] = c; mY[m] = pr.yMin; mT[m] = pr.topMax; }
      for (var j = 0; j < q.length; j++) if (!(pr.topMax <= q[j][0] || pr.yMin >= q[j][1])) return false;
      return true;
    }
    function over(c, m) {   // a jump / slide whose whole cell lies past its end → back on the ground
      if (m === 0 || m >= F0) return false;
      var k = m < S0 ? m - J0 + 1 : m - S0 + 1, ts = P.at(c - k);
      return P.at(c - 1) - ts - TEPS >= (m < S0 ? TJ.end : TS.end) || k >= (m < S0 ? KJ : KS);
    }
    function natural(c, m) {   // the move state one cell later with no new input
      if (m === 0) return 0;
      if (m >= F0) return m > F0 ? m - 1 : S0;
      var nm = m + 1; if ((m < S0 && nm >= S0) || (m >= S0 && nm >= F0)) return 0;
      return over(c + 1, nm) ? 0 : nm;
    }
    function dropCells(c, m) {  // «down» in a jump: vy = min(vy, −26) → lands, then slides (Runner.action 'D')
      var k = m - J0 + 1, ts = P.at(c - k), td = P.at(c) - ts, y0 = Math.max(0, PHY.JUMP_V * td - PHY.GRAV * td * td / 2), vy = Math.min(PHY.JUMP_V - PHY.GRAV * td, -26);
      var tf = (vy + Math.sqrt(vy * vy + 2 * PHY.GRAV * y0)) / PHY.GRAV, t0 = P.at(c), j = 0;
      while (j < KF - 1 && P.at(c + j) - t0 < tf + TEPS) j++;
      return Math.max(1, j);
    }
    var opts = [], nextQ = new Int32Array(n + 1); nextQ[n] = 1e9;     // first cell ≥ c with any condition (pruning below)
    for (c = n - 1; c >= 0; c--) nextQ[c] = (Q[0][c] || Q[1][c] || Q[2][c]) ? c : nextQ[c + 1];
    cur[1 * NM] = 1;
    var lastOk = 0;
    for (c = 0; c < n - 1; c++) {
      nxt.fill(0);
      var any = false, wl = 0; while (wl < 12 && P.at(c + wl) < P.at(c) + LEAVE_T + TEPS) wl++;   // cells the ball still touches the old lane
      for (var st = 0; st < NS; st++) {
        if (!cur[st]) continue;
        var ln = (st / NM) | 0, m = st - ln * NM;
        // a move in progress with nothing on the road until it is surely over is no better than rolling in that lane
        if (m && cur[ln * NM] && nextQ[c] > c + (m < S0 ? KJ : KS + KF) + 2) continue;
        opts.length = 0;
        var nat = natural(c, m); opts.push(nat);
        var lock = P.at(c) < PHY.LOCK_T + TEPS;                                  // Runner.reset: inputLock 0.12 s
        if (!lock && (m === 0 || (m >= S0 && m < F0))) { opts.push(J0); opts.push(S0); }       // jump / slide from the ground (a slide can be jumped out of or renewed)
        if (!lock && m >= J0 && m < S0 && nat !== 0) { if (dS[m] !== c) { dS[m] = c; dV[m] = dropCells(c, m); } opts.push(F0 + dV[m] - 1); }  // fast drop
        for (var q = 0; q < opts.length; q++) {
          var nm = opts[q];
          for (var dl = lock ? 0 : -1; dl <= (lock ? 0 : 1); dl++) {
            var nl = ln + dl; if (nl < 0 || nl > 2) continue;
            var ns = nl * NM + nm; if (nxt[ns]) continue;
            if (!fits(nl, c + 1, nm)) continue;
            if (dl) {           // the lane you leave: still there for LEAVE_T (damp 17 → |dx| < 1.27 for ≈ 0.055 s)
              var okL = true, mm = nm;
              for (var w = 1; w <= wl && okL; w++) { if (!fits(ln, c + w, mm)) okL = false; mm = natural(c + w, mm); }
              if (!okL) continue;
            }
            nxt[ns] = 1; any = true; if (par) par[(c + 1) * NS + ns] = st + 1;
          }
        }
      }
      if (!any) return fail(c);
      var tsw = cur; cur = nxt; nxt = tsw; lastOk = c + 1;
    }
    var out = { ok: true, H: SH };
    if (par) {
      var end = -1; for (var e2 = 0; e2 < 3 && end < 0; e2++) { var pref = [1, 0, 2][e2] * NM; if (cur[pref]) end = pref; }
      for (var e3 = 0; e3 < NS && end < 0; e3++) if (cur[e3]) end = e3;
      var path = new Int16Array(lastOk + 1), x = end;
      for (c = lastOk; c >= 0; c--) { path[c] = x; if (c > 0) x = par[c * NS + x] - 1; }
      var lane = new Int8Array(lastOk + 1), py = new Float32Array(lastOk + 1), pk = new Int8Array(lastOk + 1), acts = [];
      for (c = 0; c <= lastOk; c++) {
        var z = path[c], lz = (z / NM) | 0, mz = z - lz * NM; lane[c] = lz;
        pk[c] = mz === 0 ? 0 : mz < S0 ? 1 : mz < F0 ? 2 : 3;
        if (pk[c] === 1 || pk[c] === 2) { var kk = mz < S0 ? mz - J0 + 1 : mz - S0 + 1, tm = P.at(c) - SH / 2 / P.v[c] - P.at(c - kk); py[c] = (mz < S0 ? TJ : TS).y[Math.max(0, Math.min(TJ.y.length - 1, Math.round(tm / SDT)))] || 0; }
        if (c > 0) {
          var zp = path[c - 1], lp = (zp / NM) | 0, mp = zp - lp * NM, dpos = Math.round((c - 0.5) * SH * 100) / 100;
          if (lz !== lp) acts.push({ d: dpos, a: lz < lp ? 'L' : 'R' });
          if (mz === J0) acts.push({ d: dpos, a: 'U' });
          else if (mz === S0 && !(mp >= F0)) acts.push({ d: dpos, a: 'D' });
          else if (mz >= F0 && mp < F0) acts.push({ d: dpos, a: 'D' });
        }
      }
      out.lane = lane; out.py = py; out.pk = pk; out.acts = acts; out.path = lane;
    }
    return out;
    function fail(c0) {   // the exact metre + the hazard + why: every lane walled, or no move fits the timing
      var d = Math.round(c0 * SH * 2) / 2, walls = 0, bi = -1, best = 1e9;
      for (var l = 0; l < 3; l++) {
        var wall = false;
        for (var cc = c0; cc <= Math.min(n - 1, c0 + 2); cc++) { var qq = Q[l][cc]; if (!qq) continue; for (var j = 0; j < qq.length; j++) { if (qq[j][0] <= NEG && qq[j][1] > YMAXJ) wall = true; if (qq[j][2] >= 0 && Math.abs(L.it[qq[j][2]][2] - d) < best) { best = Math.abs(L.it[qq[j][2]][2] - d); bi = qq[j][2]; } } }
        if (wall) walls++;
      }
      return { ok: false, at: d, i: bi, why: walls === 3 ? 'wall3' : 'timing' };
    }
  }
  // the pass record an honest run makes on a solver line (tests; the game records the real ball)
  function poseLetter(e, y, top, sliding) { var k = e[0], yo = k === 'lsw' ? (param(k, e[3]) ? 1.46 : 0.54) : Y_OVER[k] != null ? Y_OVER[k] : 0.78; if (y >= yo) return 'h'; if (sliding && top <= 0.95) return 's'; if (k === 'lsw' && param(k, e[3]) && top <= 1.26) return 's'; return y > 0.12 ? 'a' : 'g'; }
  function recOf(L, sol) {
    var out = '';
    L.it.forEach(function (e) { if (!foot(e)) return; var c = Math.round(e[2] / SH), y = sol.py[c] || 0, sl = sol.pk[c] === 2; out += sol.lane[Math.min(sol.lane.length - 1, c)] + poseLetter(e, y + (sol.pk[c] === 1 ? 0 : 0), sl ? 0.6 : 1.44, sl); });
    return out;
  }
  // ---------------------------------------------------------------- coins along the line (coins: 'auto')
  function autoCoins(L, sol) {
    var out = [], d, last = -99;
    if (!sol || !sol.lane) return out;
    for (d = 30; d < L.len - 20; d += CRY_STEP) {
      var c = Math.round(d / SH); if (c >= sol.lane.length) break;
      if (Math.floor(d / 60) % 3 === 2) continue;           // breathing gaps
      var y = 0.75; if (sol.pk[c] === 1) y = Math.max(0.75, sol.py[c] + 0.5); else if (sol.pk[c] === 2) y = 0.45;
      if (d - last < CRY_STEP - 0.01) continue;
      out.push([sol.lane[c], Math.round(d * 10) / 10, Math.round(y * 100) / 100]); last = d;
    }
    return out;
  }
  function coinsMax(L) {
    var n = L.coins === 'auto' ? Math.ceil(L.len / CRY_STEP) : 0;
    for (var i = 0; i < L.it.length; i++) if (L.it[i][0] === 'cry') n += L.it[i][3];
    return n + 40;                                         // + crystals the game's own jetpack sections lay
  }
  // ---------------------------------------------------------------- completion (server-authoritative)
  function expectT(L) { var t = 0; for (var d = 0; d < L.len; d += 5) t += 5 / speedAt(L.spd, d); return t; }
  // rec = one char pair per hazard in level order: lane digit + pose ('g' ground, 'a' low air, 'h' high air, 's' slide)
  function hazards(L) { var a = []; for (var i = 0; i < L.it.length; i++) { var f = foot(L.it[i]); if (f) a.push(f); } return a; }
  function passCheck(L, run) {
    if (!run || typeof run !== 'object') return 'bad_run';
    var t = run.t, rec = run.rec, cry = run.cry;
    if (typeof t !== 'number' || !isFinite(t)) return 'bad_number';
    var et = expectT(L);
    if (t < et * 0.72) return 'too_fast';
    if (t > 5400) return 'bad_time';
    if (cry != null && (typeof cry !== 'number' || Math.floor(cry) !== cry || cry < 0 || cry > coinsMax(L))) return 'bad_crystals';
    var hz = hazards(L);
    if (typeof rec !== 'string' || rec.length !== hz.length * 2 || !/^([0-2][gahs])*$/.test(rec)) return 'bad_rec';
    // 2.3.14: the letter is the client's claim about THIS hazard ('h' = above its own hit height: spikes 0.72, barrier 0.78,
    // saws 0.97, crate 1.4 …; 's' = under it); crates can be jumped; a lane change takes the game ≈ 0.03–0.07 s, not 0.12 s
    var PB = { g: 1, a: 2, h: 4, s: 8 }, OKP = { low: 4, bar: 8, blk: 0, crt: 4, spk: 4, pit: 6, saw: 4, lsw: 4, gat: 0 }, prevLane = 1, prevAt = 0;
    for (var i = 0; i < hz.length; i++) {
      var lane = +rec[i * 2], pose = PB[rec[i * 2 + 1]], f = hz[i], at = f.at, need = f.k === 'lsw' ? (f.pass === 's' ? 12 : 4) : OKP[f.k] || 0;
      if (!f.free && (f.lanes & (1 << lane)) && !(need & pose)) return 'rec_hit';   // timed / moving hazards: lane timing can't be checked here
      var v = speedAt(L.spd, at) + 9, dt = Math.max(0, (at - prevAt) / (v * 1.05)), can = 1 + Math.floor(dt / 0.03);
      if (Math.abs(lane - prevLane) > can) return 'rec_lane';
      prevLane = lane; prevAt = at;
    }
    return null;
  }
  // ✦ for the player who completed someone else's level (first completion only) and for its author
  function reward(L, hz) {
    var k = { easy: 0.75, normal: 1, hard: 1.5 }[L.spd] || 1;
    return { player: Math.max(4, Math.min(15, Math.round((3 + L.len / 250 + (hz || 0) / 10) * k))), author: 2 };
  }
  var CAPS = { playerDay: 100, levelsDay: 10, authorDay: 60, publishDay: 5, publishGapS: 120, reportsHide: 5 };
  // ---------------------------------------------------------------- «Битвы авторов»: weekly themes (week 1 = Monday 2026-11-02 UTC)
  var BATTLE_EPOCH = Date.UTC(2026, 10, 2) / 1000;
  function count(L, ks) { var n = 0; for (var i = 0; i < L.it.length; i++) if (ks.indexOf(L.it[i][0]) >= 0) n++; return n; }
  var THEMES = [
    { id: 'saws', ru: 'Пильная фабрика: 6+ рядов пил', en: 'Saw factory: 6+ saw rows', ok: function (L) { return count(L, ['saw']) >= 6; } },
    { id: 'trains', ru: 'Вокзал: 5+ поездов', en: 'Rail yard: 5+ trains', ok: function (L) { return count(L, ['trn']) >= 5; } },
    { id: 'sky', ru: 'Над облаками: дорога в небе', en: 'Above the clouds: a sky road', ok: function (L) { return L.env === 'air'; } },
    { id: 'sea', ru: 'Морской путь: дорога по воде', en: 'Sea lane: a road on water', ok: function (L) { return L.env === 'water'; } },
    { id: 'short', ru: 'Коротко и жарко: до 600 м, 25+ преград', en: 'Short and hot: ≤ 600 m, 25+ hazards', ok: function (L) { return L.len <= 600 && hazards(L).length >= 25; } },
    { id: 'lasers', ru: 'Лазерный ритм: 8+ лазеров и прессов', en: 'Laser rhythm: 8+ lasers and presses', ok: function (L) { return count(L, ['las', 'lsw', 'prs']) >= 8; } },
    { id: 'gates', ru: 'Лабиринт ворот: 5+ ворот', en: 'Gate maze: 5+ gates', ok: function (L) { return count(L, ['gat']) >= 5; } },
    { id: 'nojump', ru: 'Без прыжков: только полосы и подкаты', en: 'No jumps: lanes and slides only', ok: function (L) { var h = hazards(L); for (var i = 0; i < h.length; i++) if (h[i].pass === 'h' || h[i].pass === 'ha') return false; return h.length >= 12; } }
  ];
  function weekOf(t) { return Math.floor((t - BATTLE_EPOCH) / 604800) + 1; }
  function themeOf(week) { var n = THEMES.length; return THEMES[((week - 1) % n + n) % n]; }
  // ---------------------------------------------------------------- «Магазин автора»
  var SHOP = [
    { id: 'au_forge', type: 'skin', price: 400, ru: 'Кузнец уровней', en: 'Level Smith' },
    { id: 'au_prism', type: 'skin', price: 650, ru: 'Призма автора', en: 'Creator Prism' },
    { id: 'au_blueprint', type: 'skin', price: 900, ru: 'Чертёж', en: 'Blueprint' },
    { id: 'au_spark', type: 'trail', price: 250, ru: 'Искры', en: 'Sparks' },
    { id: 'au_ink', type: 'trail', price: 350, ru: 'Чернила', en: 'Ink' },
    { id: 'au_frame', type: 'frame', price: 300, ru: 'Рамка автора', en: 'Creator frame' },
    { id: 'ct_blueprint', type: 'ctheme', price: 150, ru: 'Тема «Синька»', en: 'Theme «Blueprint»' },
    { id: 'ct_neon', type: 'ctheme', price: 150, ru: 'Тема «Неон»', en: 'Theme «Neon»' },
    { id: 'ct_paper', type: 'ctheme', price: 150, ru: 'Тема «Бумага»', en: 'Theme «Paper»' },
    { id: 'b_builder', type: 'badge', price: 100, ru: 'Значок «Строитель»', en: 'Badge «Builder»' },
    { id: 'b_architect', type: 'badge', price: 500, ru: 'Значок «Архитектор»', en: 'Badge «Architect»' },
    { id: 'b_legend', type: 'badge', price: 1500, ru: 'Значок «Легенда»', en: 'Badge «Legend»' },
    { id: 'b_battle1', type: 'badge', price: -1, ru: 'Значок «Победитель битвы»', en: 'Badge «Battle winner»' },
    { id: 'b_battle2', type: 'badge', price: -1, ru: 'Значок «Серебро битвы»', en: 'Badge «Battle silver»' },
    { id: 'b_battle3', type: 'badge', price: -1, ru: 'Значок «Бронза битвы»', en: 'Badge «Battle bronze»' }
  ];
  var BATTLE_PRIZE = [{ sparks: 300, badge: 'b_battle1' }, { sparks: 150, badge: 'b_battle2' }, { sparks: 75, badge: 'b_battle3' }];
  function shopItem(id) { for (var i = 0; i < SHOP.length; i++) if (SHOP[i].id === id) return SHOP[i]; return null; }
  var API = { VER: VER, H: H, MAXLEN: MAXLEN, MINLEN: MINLEN, MAXIT: MAXIT, MAXJSON: MAXJSON, SPD: SPD, ENVS: ENVS, WORLDS: WORLDS, MUSIC: MUSIC, BOSSES: BOSSES,
    KINDS: KINDS, TOP: TOP, speedAt: speedAt, depthOf: depthOf, param: param, foot: foot, schema: schema, validate: validate, solve: solve,
    autoCoins: autoCoins, coinsMax: coinsMax, expectT: expectT, hazards: hazards, passCheck: passCheck, reward: reward, CAPS: CAPS,
    THEMES: THEMES, BATTLE_EPOCH: BATTLE_EPOCH, weekOf: weekOf, themeOf: themeOf, SHOP: SHOP, BATTLE_PRIZE: BATTLE_PRIZE, shopItem: shopItem, JUMP_T: JUMP_T, PHY: PHY, SH: SH, profile: profile, hitSpec: hitSpec, recOf: recOf, poseLetter: poseLetter, Y_OVER: Y_OVER };
  /*}CORE*/
  return API;
})();
export default C;
export const { KINDS, SHOP, THEMES, CAPS, BATTLE_PRIZE, validate, schema, solve, passCheck, reward, hazards, coinsMax, expectT, weekOf, themeOf, shopItem, BATTLE_EPOCH, MAXJSON } = C;
