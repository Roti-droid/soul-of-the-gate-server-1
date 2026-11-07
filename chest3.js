// chest3.js — «Душа Врат»: «Кристальная капсула» / «Тёмная капсула» — a random skin for in-game crystals (never for stars).
//
//   GET  /api/v2/chest3/info                                    -> {ok, cfg}   prices, weights, pools, guarantee (no auth)
//   POST /api/v2/chest3/state {id, secret}                      -> {ok, pity:{normal,dark}, won:[skin], log:[…last 30]}
//   POST /api/v2/chest3/open  {id, secret, kind, nonce, owned:[skin ids], wallet}
//        -> {ok, nonce, kind, skin, rarity, price, guaranteed, pity, pityN, opens}     (repeat:true = this nonce was already opened)
//        |  {err:'poor'|'all'|'kind'|'nonce'|'bad'|'auth'|'rate'|'not_configured', refund?:true}
//
// Fair by construction:
//   * no duplicates: the pool is every skin of that capsule minus what the player owns (the list the game sends) minus every skin
//     this account has ever won from a capsule (kept here) — so a skin is never paid for twice;
//   * everything owned → 'all' (nothing charged, the game refunds its escrow);
//   * guarantee: at most PITY_N-1 opens in a row below «Эпический» — the next one is epic or better (counter kept here);
//   * the roll is crypto.getRandomValues on the server; the roll, the guarantee counter, the won list and the journal row are
//     written in ONE storage transaction keyed by (account, nonce): a retry with the same nonce returns the same reward,
//     never a second roll and never a second charge.
//   * crystals live in the player's save (as everywhere in this game): the game takes the price into an escrow BEFORE it asks,
//     applies the reward when the answer comes and refunds the escrow only on a definite «no» (poor / all / kind…).
//
// The same tables + algorithm run in the game (src/chest3.js, block CORE) for players without an account;
// test/test_chest3.mjs checks that both copies agree.

import { accCall } from "./accounts.js";
import { gate } from "./accounts_guard.js";   // 2.3.6: suspended / banned / no consent -> capsules closed

// ------------------------------------------------------------------ config (keep in sync with src/chest3.js CORE)
export const RARITIES = ["common", "rare", "epic", "legendary"];
export const WEIGHTS = { common: 50, rare: 32, epic: 14, legendary: 4 };
export const CHEST = {
  normal: { price: 800, cur: "coins", pityN: 10, pool: {
    common: ["fire", "toxic", "gold", "neon", "candy", "soccer"],
    rare: ["earth", "disco", "galaxy", "donut", "lava", "pumpkin"],
    epic: ["aurora", "hexdrone", "d20", "miniplanet", "plasma", "gyro", "cybereye"],
    legendary: ["void", "comet_s", "ufo", "dragonegg"] } },
  dark: { price: 350, cur: "dark", pityN: 5, pool: {
    common: ["d_obsidian"],
    rare: ["d_eclipse", "d_voideye"],
    epic: ["d_chains"],
    legendary: ["d_shadowflame"] } },
};
const EPIC_UP = { epic: 1, legendary: 1 };

// odds for one player: the weights of the rarities that still have something to give, renormalised to 100 %.
// guaranteed = this open is the guaranteed one (only epic+ count), if anything epic+ is left.
export function odds(kind, exclude, since) {
  const c = CHEST[kind]; if (!c) return null;
  const ex = exclude instanceof Set ? exclude : new Set(exclude || []);
  const left = {}; let any = 0, epicLeft = 0;
  for (const r of RARITIES) { left[r] = c.pool[r].filter((s) => !ex.has(s)); any += left[r].length; if (EPIC_UP[r]) epicLeft += left[r].length; }
  const guaranteed = (since || 0) >= c.pityN - 1 && epicLeft > 0;
  let tot = 0; const w = {};
  for (const r of RARITIES) { w[r] = left[r].length && (!guaranteed || EPIC_UP[r]) ? WEIGHTS[r] : 0; tot += w[r]; }
  const pct = {};
  for (const r of RARITIES) pct[r] = tot ? (w[r] * 100) / tot : 0;
  return { left, pct, w, tot, any, guaranteed, epicLeft };
}

// rnd() -> [0, 1). Returns null when nothing is left.
export function roll(kind, exclude, since, rnd) {
  const o = odds(kind, exclude, since); if (!o || !o.any) return null;
  let x = rnd() * o.tot, rar = null;
  for (const r of RARITIES) { if (!o.w[r]) continue; rar = r; if (x < o.w[r]) break; x -= o.w[r]; }
  const list = o.left[rar];
  const skin = list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
  const up = !!EPIC_UP[rar];
  return { skin, rarity: rar, guaranteed: o.guaranteed, pity: up ? 0 : (since || 0) + 1 };
}

export function cryptoRnd() {
  const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 4294967296;
}

export function publicCfg() {
  return { weights: WEIGHTS, rarities: RARITIES, kinds: Object.fromEntries(Object.entries(CHEST).map(([k, c]) => [k, { price: c.price, cur: c.cur, pityN: c.pityN, pool: c.pool }])) };
}

// ------------------------------------------------------------------ HTTP entry (index.js routes /api/v2/chest3/* here)
const ACC_RE = /^[0-9a-f]{12}$/;
const SKIN_RE = /^[a-z0-9_]{1,24}$/;
const NONCE_RE = /^[a-z0-9]{8,32}$/;
const BODY_MAX = 16384;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

export async function handleChest3(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" } });
  const url = new URL(request.url);
  const op = url.pathname.replace(/^\/api\/v2\/chest3\//, "");
  if (op === "info") return json({ ok: true, cfg: publicCfg() });
  if (!["state", "open"].includes(op)) return json({ err: "unknown" }, 404);
  if (request.method !== "POST") return json({ err: "method" }, 405);
  if (!env.CHEST3) return json({ err: "not_configured" }, 503);
  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ err: "bad" }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ err: "bad" }, 400); }
  if (!b || typeof b !== "object" || typeof b.id !== "string" || !ACC_RE.test(b.id) || typeof b.secret !== "string" || b.secret.length > 64) return json({ err: "auth" }, 401);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const stub = env.CHEST3.get(env.CHEST3.idFromName("chest3"));
  // the DO rate-limits auth per IP before it asks Accounts
  const res = await stub.fetch("https://chest3/" + op, { method: "POST", headers: { "content-type": "application/json", "x-internal": "chest3", "x-ip": ip }, body: JSON.stringify(b) });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

// ------------------------------------------------------------------ Durable Object: guarantee counters, won skins, journal
const nowS = () => Math.floor(Date.now() / 1000);
const OPEN_GAP_MS = 700;      // one open per account per 0.7 s (the animation alone is longer)
const AUTH_PER_MIN_IP = 120;

export class Chest3 {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS st (acc TEXT PRIMARY KEY, pity_normal INTEGER NOT NULL DEFAULT 0, pity_dark INTEGER NOT NULL DEFAULT 0,
      opens INTEGER NOT NULL DEFAULT 0, won TEXT NOT NULL DEFAULT '[]', at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS log (acc TEXT NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, skin TEXT NOT NULL, rarity TEXT NOT NULL,
      price INTEGER NOT NULL, cur TEXT NOT NULL, guar INTEGER NOT NULL, pity INTEGER NOT NULL, wallet INTEGER, at INTEGER NOT NULL, PRIMARY KEY (acc, nonce))`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS log_acc ON log (acc, at)");
    this.authOk = new Map();   // "id:secret" -> until (ms)
    this.hits = new Map();     // "ip" -> [count, windowStart]
    this.lastOpen = new Map(); // acc -> ms
  }
  one(q, ...b) { return this.sql.exec(q, ...b).toArray()[0] || null; }
  limit(k, n, sec) {
    const t = Date.now(), h = this.hits.get(k);
    if (!h || t - h[1] > sec * 1000) { this.hits.set(k, [1, t]); if (this.hits.size > 20000) this.hits.clear(); return true; }
    return ++h[0] <= n;
  }
  async who(b, ip) {
    const key = b.id + ":" + b.secret, c = this.authOk.get(key);
    if (c && c.until > Date.now()) return c.g || true;
    if (!this.limit("auth:" + ip, AUTH_PER_MIN_IP, 60)) return null;
    let r; try { r = await accCall(this.env, "auth", { id: b.id, secret: b.secret }); } catch (e) { r = null; }
    if (!r || !r.ok) return false;
    const g = gate(r, "online", this.env);
    if (!g) { this.authOk.set(key, { until: Date.now() + 60 * 1000 }); if (this.authOk.size > 20000) this.authOk.clear(); }   // blocked: asked again (a lift acts at once)
    return g || true;
  }
  stOf(acc) {
    const s = this.one("SELECT * FROM st WHERE acc = ?", acc);
    let won = []; try { won = s ? JSON.parse(s.won) : []; } catch (e) { won = []; }
    return { pity: { normal: s ? s.pity_normal : 0, dark: s ? s.pity_dark : 0 }, opens: s ? s.opens : 0, won: Array.isArray(won) ? won : [] };
  }
  logOf(acc, n = 30) {
    return this.sql.exec("SELECT nonce, kind, skin, rarity, price, guar, at FROM log WHERE acc = ? ORDER BY at DESC, rowid DESC LIMIT ?", acc, n).toArray()
      .map((r) => ({ nonce: r.nonce, kind: r.kind, skin: r.skin, rarity: r.rarity, price: r.price, guaranteed: !!r.guar, at: r.at }));
  }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    if (op === "guard_revoke" && request.headers.get("x-internal") === "guard") {   // 2.3.6 god «откат» (Online DO only)
      let g; try { g = await request.json(); } catch (e) { return json({ err: "bad" }, 400); }
      if (typeof g.acc !== "string" || !ACC_RE.test(g.acc) || !Number.isInteger(g.from)) return json({ err: "bad" }, 400);
      const until = Number.isInteger(g.until) ? g.until : nowS();
      const rows = this.sql.exec("SELECT nonce, skin, price, at FROM log WHERE acc = ? AND at >= ? AND at <= ? ORDER BY at", g.acc, g.from, until).toArray();
      const s = this.stOf(g.acc), gone = new Set(rows.map((r) => r.skin));
      if (rows.length) this.sql.exec("UPDATE st SET won = ? WHERE acc = ?", JSON.stringify(s.won.filter((x) => !gone.has(x))), g.acc);
      return json({ ok: true, rows });
    }
    if (request.headers.get("x-internal") !== "chest3") return json({ err: "forbidden" }, 403);
    let b; try { b = await request.json(); } catch (e) { return json({ err: "bad" }, 400); }
    const ip = request.headers.get("x-ip") || "local";
    const who = await this.who(b, ip);
    if (who === null) return json({ err: "rate" }, 429);
    if (!who) return json({ err: "auth" }, 401);
    if (who.err) return json({ err: who.err, pun: who.pun || null, terms_v: who.terms_v }, 403);
    try {
      if (op === "state") { const s = this.stOf(b.id); return json({ ok: true, pity: s.pity, opens: s.opens, won: s.won, log: this.logOf(b.id), cfg: publicCfg() }); }
      if (op === "open") return this.open(b);
    } catch (e) {
      console.log("chest3 " + op + " error: " + (e && e.stack ? e.stack : e));
      return json({ err: "server" }, 500);
    }
    return json({ err: "unknown" }, 404);
  }
  open(b) {
    const acc = b.id;
    if (b.ch) return json({ err: "cheat_session" }, 403);   // 2.3.12: cheats used this session — the game rolls locally, nothing kept on the account
    if (typeof b.nonce !== "string" || !NONCE_RE.test(b.nonce)) return json({ err: "nonce" }, 400);
    // the same nonce again (lost answer, app killed mid-open): the same reward, nothing rolled or charged twice
    const was = this.one("SELECT * FROM log WHERE acc = ? AND nonce = ?", acc, b.nonce);
    if (was) {
      const s = this.stOf(acc), c = CHEST[was.kind];
      return json({ ok: true, repeat: true, nonce: was.nonce, kind: was.kind, skin: was.skin, rarity: was.rarity, price: was.price, cur: was.cur,
        guaranteed: !!was.guar, pity: s.pity[was.kind], pityN: c ? c.pityN : 0, opens: s.opens });
    }
    const kind = b.kind, c = CHEST[kind];
    if (!c) return json({ err: "kind" }, 400);
    if (!Array.isArray(b.owned) || b.owned.length > 600 || b.owned.some((x) => typeof x !== "string" || !SKIN_RE.test(x))) return json({ err: "bad" }, 400);
    const wallet = Number(b.wallet);
    if (!Number.isFinite(wallet) || wallet < 0) return json({ err: "bad" }, 400);
    const t = Date.now(), last = this.lastOpen.get(acc) || 0;
    if (t - last < OPEN_GAP_MS) return json({ err: "rate", retry: OPEN_GAP_MS - (t - last) }, 429);
    const s = this.stOf(acc), ex = new Set([...b.owned, ...s.won]);
    const since = s.pity[kind] || 0;
    const o = odds(kind, ex, since);
    if (!o.any) return json({ err: "all", refund: true });
    if (wallet < c.price) return json({ err: "poor", refund: true, price: c.price });
    const r = roll(kind, ex, since, cryptoRnd);
    const won = s.won.concat([r.skin]).slice(-200);
    const at = nowS();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO log (acc, nonce, kind, skin, rarity, price, cur, guar, pity, wallet, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        acc, b.nonce, kind, r.skin, r.rarity, c.price, c.cur, r.guaranteed ? 1 : 0, r.pity, Math.floor(wallet), at);
      this.sql.exec(`INSERT INTO st (acc, pity_normal, pity_dark, opens, won, at) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT (acc) DO UPDATE SET pity_${kind} = ?, opens = opens + 1, won = ?, at = ?`,
        acc, kind === "normal" ? r.pity : 0, kind === "dark" ? r.pity : 0, JSON.stringify(won), at, r.pity, JSON.stringify(won), at);
    });
    this.lastOpen.set(acc, t); if (this.lastOpen.size > 20000) this.lastOpen.clear();
    console.log(`chest3 ${acc} ${kind} -> ${r.skin} (${r.rarity}${r.guaranteed ? ", guaranteed" : ""})`);
    return json({ ok: true, nonce: b.nonce, kind, skin: r.skin, rarity: r.rarity, price: c.price, cur: c.cur, guaranteed: r.guaranteed, pity: r.pity, pityN: c.pityN, opens: s.opens + 1 });
  }
}
