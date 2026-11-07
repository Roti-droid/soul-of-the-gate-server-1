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
      else if (a.pass === '' && b.pass === '' && ((a.lanes | b.lanes) === 7)) err(errs, fps[j].i, 'closed', { with: fps[i].i });
    }
    var sol = null;
    if (!errs.length) { sol = solve(L, opt.path); if (!sol.ok) err(errs, sol.i, 'blocked', { at: sol.at }); }
    return { ok: !errs.length, errs: errs, lvl: L, sol: sol, hazards: haz };
  }
  // ---------------------------------------------------------------- reachability
  // state index: lane * 65 + m; m = 0 run, 1..32 jump progress, 33..64 slide progress (progress in 1/32 of the move)
  var NS = 3 * 65, PJ = 32;
  function poseOf(m) {
    if (m === 0) return 1;                                 // g
    if (m <= PJ) { var f = m / PJ; return f > 0.14 && f < 0.86 ? 4 : 2; }   // h / a
    var fs = (m - PJ) / PJ; return fs > 0.12 && fs < 0.95 ? 8 : 1;          // s / g
  }
  var PASSBITS = { '': 0, h: 4, ha: 6, s: 8 };
  function solve(L, wantPath) {
    var n = Math.ceil(L.len / H) + 1, allow = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)], busy = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    var i, l, s, d;
    for (l = 0; l < 3; l++) allow[l].fill(15);
    for (i = 0; i < L.it.length; i++) {
      var f = foot(L.it[i]); if (!f) continue;
      var a = Math.max(0, Math.floor(f.lo / H)), b = Math.min(n - 1, Math.ceil(f.hi / H)), pb = PASSBITS[f.pass];
      for (l = 0; l < 3; l++) if (f.lanes & (1 << l)) for (s = a; s <= b; s++) { allow[l][s] &= pb; busy[l][s] = 1; }
    }
    var pre = [new Uint16Array(n + 1), new Uint16Array(n + 1), new Uint16Array(n + 1)];   // prefix sums of «something here»
    for (l = 0; l < 3; l++) for (s = 0; s < n; s++) pre[l][s + 1] = pre[l][s] + busy[l][s];
    var cur = new Uint8Array(NS), nxt = new Uint8Array(NS), par = wantPath ? new Uint8Array(n * NS) : null, POSE = new Uint8Array(65), leave = [0, 0, 0];
    for (var pm = 0; pm < 65; pm++) POSE[pm] = poseOf(pm);
    cur[1 * 65] = 1;
    var lastOk = 0;
    for (s = 0; s < n - 1; s++) {
      d = s * H;
      var v = speedAt(L.spd, d), dj = Math.max(1, Math.round(PJ * H / (v * JUMP_T))), ds = Math.max(1, Math.round(PJ * H / (v * SLIDE_T)));
      var win = Math.max(1, Math.ceil(v * LANE_T / H)), wEnd = Math.min(n, s + 1 + win);
      for (l = 0; l < 3; l++) leave[l] = pre[l][wEnd] - pre[l][s + 1] === 0;
      var A0 = allow[0][s + 1], A1 = allow[1][s + 1], A2 = allow[2][s + 1];
      nxt.fill(0);
      var any = false;
      for (var st = 0; st < NS; st++) {
        if (!cur[st]) continue;
        var ln = (st / 65) | 0, m = st - ln * 65, nopt, o0, o1 = -1, o2 = -1;
        if (m === 0) { o0 = 0; o1 = dj; o2 = PJ + ds; }
        else if (m <= PJ) o0 = m + dj > PJ ? 0 : m + dj;
        else o0 = m - PJ + ds > PJ ? 0 : m + ds;
        for (var q = 0; q < 3; q++) {
          var nm = q === 0 ? o0 : q === 1 ? o1 : o2; if (nm < 0) continue;
          var pz = POSE[nm];
          for (var dl = -1; dl <= 1; dl++) {
            var nl = ln + dl; if (nl < 0 || nl > 2) continue;
            if (dl && !leave[ln]) continue;                 // leaving a lane: it is clear while the ball crosses over
            if (!((nl === 0 ? A0 : nl === 1 ? A1 : A2) & pz)) continue;
            var ns = nl * 65 + nm;
            if (!nxt[ns]) { nxt[ns] = 1; any = true; if (par) par[(s + 1) * NS + ns] = st; }
          }
        }
      }
      if (!any) {
        var bi = -1; for (i = 0; i < L.it.length; i++) { var fb = foot(L.it[i]); if (fb && fb.lo <= d + 2 && fb.hi >= d - 2) { bi = i; break; } }
        return { ok: false, at: Math.round(d), i: bi };
      }
      var t = cur; cur = nxt; nxt = t; lastOk = s + 1;
    }
    var out = { ok: true };
    if (par) {   // one passable line: lane + move per metre (prefer ending on the ground in the middle)
      var end = -1, pref = [65, 0, 130];
      for (var e2 = 0; e2 < 3 && end < 0; e2++) if (cur[pref[e2]]) end = pref[e2];
      for (var e3 = 0; e3 < NS && end < 0; e3++) if (cur[e3]) end = e3;
      var path = new Array(lastOk + 1), x = end;
      for (s = lastOk; s >= 0; s--) { path[s] = x; if (s > 0) x = par[s * NS + x]; }
      out.path = path.map(function (z) { var lz = (z / 65) | 0, mz = z - lz * 65; return lz * 100 + mz; });
    }
    return out;
  }
  // ---------------------------------------------------------------- coins along the line (coins: 'auto')
  function autoCoins(L, path) {
    var out = [], d, last = -99;
    if (!path) return out;
    for (d = 30; d < L.len - 20; d += CRY_STEP) {
      var s = Math.round(d / H); if (s >= path.length) break;
      var z = path[s], lane = (z / 100) | 0, m = z % 100;
      if (Math.floor(d / 60) % 3 === 2) continue;           // breathing gaps
      var y = 0.75; if (m > 0 && m <= PJ) { var f = m / PJ, t = f * JUMP_T; y = Math.max(0.75, JUMP_V * t - GRAV * t * t / 2 + 0.5); }
      if (m > PJ) y = 0.45;
      if (d - last < CRY_STEP - 0.01) continue;
      out.push([lane, Math.round(d * 10) / 10, Math.round(y * 100) / 100]); last = d;
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
    var PB = { g: 1, a: 2, h: 4, s: 8 }, prevLane = 1, prevAt = 0;
    for (var i = 0; i < hz.length; i++) {
      var lane = +rec[i * 2], pose = PB[rec[i * 2 + 1]], f = hz[i], at = f.at;
      if (!f.free && (f.lanes & (1 << lane)) && !(PASSBITS[f.pass] & pose)) return 'rec_hit';   // timed / moving hazards: lane timing can't be checked here
      var v = speedAt(L.spd, at), dt = Math.max(0, (at - prevAt) / (v * 1.3)), can = 1 + Math.floor(dt / (LANE_T * 0.8));
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
    THEMES: THEMES, BATTLE_EPOCH: BATTLE_EPOCH, weekOf: weekOf, themeOf: themeOf, SHOP: SHOP, BATTLE_PRIZE: BATTLE_PRIZE, shopItem: shopItem, JUMP_T: JUMP_T, PJ: PJ };
  /*}CORE*/
  return API;
})();
export default C;
export const { KINDS, SHOP, THEMES, CAPS, BATTLE_PRIZE, validate, schema, solve, passCheck, reward, hazards, coinsMax, expectT, weekOf, themeOf, shopItem, BATTLE_EPOCH, MAXJSON } = C;
