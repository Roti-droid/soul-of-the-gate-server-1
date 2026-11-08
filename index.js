// Crystal Run («Кристальный забег») — online multiplayer server for Cloudflare Workers.
//
// Same JSON protocol as server.py (Python). One Durable Object "Lobby" holds every socket,
// the quick-match queue and the rooms. It uses the WebSocket Hibernation API: per-socket data
// lives in socket attachments and rooms/queue in the DO's SQLite storage, so nothing is lost
// when the object hibernates between messages.

import { Donate, botConfigured, handleWebhook, normalizeCode, peekViaDO, redeemViaDO } from "./donate.js";

import { Accounts, DIFFS, SCORE_MAX, accCall } from "./accounts.js";
// 2.3.6 account protection: punishments / consent gate for online modes, password sign-in
import { gate, cleanLabel } from "./accounts_guard.js";
const ONLINE_T = new Set(["quick", "create", "join", "score"]);   // closed while suspended / banned / without consent
function blkText(g) {
  if (!g) return null;
  if (g.err === "consent") return "Чтобы играть онлайн, примите Условия использования (окно согласия в игре)";
  const p = g.pun || {}, d = p.until ? new Date(p.until * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
  const what = g.err === "banned" ? (p.type === "perm" ? "Аккаунт заблокирован навсегда" : "Аккаунт заблокирован") : "Онлайн-режимы закрыты для аккаунта";
  return what + (d ? " до " + d : "") + (p.reason ? ". Причина: " + p.reason : "") + ". Обжаловать: бот, команда /appeal";
}
const cleanDev = (v) => (typeof v === "string" && /^[0-9a-f]{16,64}$/.test(v) ? v : null);
function cleanConsent(x) {
  if (!x || typeof x !== "object") return null;
  return { v: typeof x.v === "string" ? x.v.slice(0, 20) : null, terms: x.terms === true, privacy: x.privacy === true, age: x.age === true };
}

import { Online, handleOnline } from "./online.js";

import { googleConfigured, handleGoogle } from "./google.js";

import { Match, RaidHub, handleRaid3 } from "./raid3.js";

import { Chest3, handleChest3 } from "./chest3.js";

import { Creator, handleCreator } from "./creator.js";   // «Создать»: player levels, «Искры автора», author shop, battles
// 2.3.12 «Режимы»: ghost race + push duel (modes.js)
import { ModesHub, PushMatch, handleModes } from "./modes.js";

// the official website (site.js): pages at / /chapters /download ..., the web game at /play, files + developer cabinet
import { Site, handleSite, WEB_STATE_RE } from "./site.js";

export { Donate, Accounts, Online, Match, RaidHub, Chest3, ModesHub, PushMatch, Creator, Site };

// website pages (one shell: public/site/index.html, client-side routing)
const SITE_PAGES = new Set(["/", "/chapters", "/vcr", "/download", "/news", "/login", "/account", "/dev"]);
// query keys a link to the WEBSITE may carry; any other key on "/" (?debug, ?nopro, ?tgWebApp…) is a game deep link -> /play
const SITE_QUERY = /^(lang|utm_[a-z]+|fbclid|gclid|yclid|ref|from|err|step)$/;
function gameDeepLink(url) {
  for (const k of url.searchParams.keys()) if (!SITE_QUERY.test(k)) return true;
  return false;
}
async function staticAsset(env, request, url, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, url), { method: request.method === "HEAD" ? "HEAD" : "GET", headers: request.headers }));
  return res;
}

const NAME_MAX = 16;
const DEFAULT_NAME = "Игрок";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O, 0, I, 1
const STATE_MAX_PER_SEC = 30;
const MSG_MAX_PER_SEC = 60;
const MAX_MESSAGE_CHARS = 4096;
const OK_TEXT = "Crystal Run server OK\n";
const MAX_SAVE_MESSAGE_CHARS = 80000; // save_put carries up to 64 KB of JSON
const AUTH_MAX_PER_MIN = 10;      // acc_new/acc_auth/acc_login/link_start/google_start per connection
const AUTH_MAX_PER_MIN_IP = 30;
const REDEEM_MAX_PER_MIN = 5;      // per connection
const REDEEM_MAX_PER_MIN_IP = 20;  // per IP (brute force through many connections)
const REDEEM_ERRORS = {
  not_found: "Код не найден",
  used: "Код уже использован",
  revoked: "Код отозван",
  not_configured: "Донат пока не настроен",
  broken: "Код повреждён, напишите в поддержку бота",
  db_error: "Сервер доната временно недоступен, попробуйте позже",
  need_acc: "Этот код привязывается к игровому аккаунту. Дождитесь входа в аккаунт (Профиль) и попробуйте ещё раз — код не потрачен",
  once: "Этот набор можно получить только один раз на аккаунт. Код не потрачен — его можно вернуть через /paysupport в боте",
};

// ------------------------------------------------------------------ Worker entry

function featOff() { return new Response(JSON.stringify({ err: "unknown" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } }); }
export default {
  async fetch(request, env) {
    const upgrade = request.headers.get("Upgrade") || "";
    // 2.4 weekly online raid (raid3.js): its own WebSocket path + /api/v2/raid3/* — checked before the Lobby catch-all
    if (request.url.includes("/api/v2/raid3/")) { const u = new URL(request.url); if (u.pathname.startsWith("/api/v2/raid3/")) return handleRaid3(request, env); }
    // «Создать» (creator.js): player levels, «Искры автора», author shop, battles
    // 2.3.12 release: «Создать» and «Режимы» are unfinished — OFF unless the var CREATOR_ON / MODES_ON = "1" (off = 404, not routed)
    if (request.url.includes("/api/v2/creator/")) { const u = new URL(request.url); if (u.pathname.startsWith("/api/v2/creator/")) return env.CREATOR_ON === "1" ? handleCreator(request, env) : featOff(); }
    // «Кристальная капсула» (chest3.js): random skin for crystals, rolled on the server
    if (request.url.includes("/api/v2/chest3/")) { const u = new URL(request.url); if (u.pathname.startsWith("/api/v2/chest3/")) return handleChest3(request, env); }
    if (request.url.includes("/api/v2/modes/")) { const u = new URL(request.url); if (u.pathname.startsWith("/api/v2/modes/")) return env.MODES_ON === "1" ? handleModes(request, env) : featOff(); }
    // 1) WebSocket on ANY path (old APKs use wss://host/) -> Durable Object
    if (upgrade.toLowerCase() === "websocket") {
      const stub = env.LOBBY.get(env.LOBBY.idFromName("lobby"));
      return stub.fetch(request);
    }
    const url = new URL(request.url);
    // Telegram donate bot webhook (POST /tg/<secret path>)
    if (url.pathname.startsWith("/tg/")) return handleWebhook(request, env);
    // 2.2 online & seasons HTTP API (online.js)
    if (url.pathname.startsWith("/api/v2/")) return handleOnline(request, env);
    // website: API, downloads, website Google sign-in (its own "w…" state through the same registered callback)
    if (url.pathname.startsWith("/site/api/") || url.pathname.startsWith("/dl/") || url.pathname === "/site/auth/google" ||
        (url.pathname === "/auth/google/callback" && WEB_STATE_RE.test(url.searchParams.get("state") || ""))) return handleSite(request, env);
    // «Войти через Google» in the external browser (google.js)
    if (url.pathname.startsWith("/auth/google/")) return handleGoogle(request, env);
    // 2) health check: /health always; "/" too for non-browser probes (curl, python) as before
    if (url.pathname === "/health" || url.pathname === "/healthz" || (url.pathname === "/" && isProbe(request)) || !env.ASSETS) {
      return okText();
    }
    // 3) the web game lives at /play (public/index.html); old game deep links to "/" (game query keys) go there too.
    //    Telegram Mini App / installed PWA launches of "/" carry only a #fragment -> the site page forwards them (public/site/index.html)
    let res;
    if (url.pathname === "/play/" || url.pathname === "/index.html") return Response.redirect(new URL("/play" + url.search, url).toString(), 301);
    if (url.pathname === "/" && gameDeepLink(url)) return Response.redirect(new URL("/play" + url.search, url).toString(), 302);
    if (url.pathname === "/site" || url.pathname === "/site/" || url.pathname === "/site/index.html") return Response.redirect(new URL("/", url).toString(), 301);
    if (url.pathname === "/play") res = await staticAsset(env, request, url, "/");
    else if (SITE_PAGES.has(url.pathname) || url.pathname === "/chapters/" || url.pathname === "/download/") res = await staticAsset(env, request, url, "/site/");
    else res = await env.ASSETS.fetch(request);   // everything else -> static files from ./public
    const out = new Response(res.body, res);
    const type = out.headers.get("content-type") || "";
    out.headers.set("cache-control", !res.ok ? "no-store" : type.includes("text/html") || type.includes("manifest") || url.pathname.endsWith(".json")
      ? "public, max-age=0, must-revalidate" : "public, max-age=86400");
    out.headers.set("x-content-type-options", "nosniff");
    out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    return out; // no X-Frame-Options: Telegram Web opens Mini Apps in an iframe
  },
};

function okText() {
  return new Response(OK_TEXT, {
    headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
  });
}

// a request to "/" that is not a browser / link-preview bot (no text/html in Accept, no browser-like UA)
function isProbe(request) {
  const accept = request.headers.get("Accept") || "";
  const ua = request.headers.get("User-Agent") || "";
  if (accept.includes("text/html")) return false;
  return !/mozilla|bot|telegram|facebook|whatsapp|discord|vk|slack|twitter|preview|crawler|spider/i.test(ua);
}

// ------------------------------------------------------------------ helpers

function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

function newSeed() {
  return randInt(2 ** 31 - 1) + 1; // 1 .. 2^31-1
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return DEFAULT_NAME;
  // like Python: keep printable chars, collapse whitespace, max 16 code points
  let s = raw.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "").replace(/[^\S ]|[   -   　]/gu, "");
  s = s.trim().split(/\s+/).filter(Boolean).join(" ");
  s = Array.from(s).slice(0, NAME_MAX).join("").trim();
  return s || DEFAULT_NAME;
}

function num(v, lo, hi) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(Math.max(v, lo), hi);
}

function intNum(v, lo = 0, hi = 1e9) {
  const x = num(v, lo, hi);
  return x === null ? null : Math.trunc(x);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function rateOk(times, limit, now, windowMs = 1000) {
  while (times.length && now - times[0] >= windowMs) times.shift();
  if (times.length >= limit) return false;
  times.push(now);
  return true;
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Python's json emits NaN/Infinity; treat them as null so the message is validated (and dropped) normally
    if (/\b(NaN|Infinity)\b/.test(raw)) {
      try {
        return JSON.parse(raw.replace(/-?\bInfinity\b|\bNaN\b/g, "null"));
      } catch (e2) { /* fall through */ }
    }
    return undefined;
  }
}

// ------------------------------------------------------------------ Durable Object

export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ttlMs = Math.max(1, Number(env.ROOM_TTL_SEC || 600)) * 1000;
    this.rate = new Map(); // id -> {state: [], msg: []}  (in memory only; resetting on hibernation is harmless)
    this.sql.exec("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.rooms = new Map();
    for (const row of this.sql.exec("SELECT data FROM rooms").toArray()) {
      const room = JSON.parse(row.data);
      this.rooms.set(room.code, room);
    }
    const q = this.sql.exec("SELECT v FROM meta WHERE k = 'queue'").toArray();
    this.queue = q.length ? JSON.parse(q[0].v) : [];
    const bu = this.sql.exec("SELECT v FROM meta WHERE k = 'bot_username'").toArray();
    this.botUsername = bu.length ? bu[0].v : null;
    this.redeemByIp = new Map(); // ip -> [times]
    this.authByIp = new Map();   // ip -> [times]
    this.cleanupOrphans();
  }

  // link for the game's «Поддержать» button (welcome.donate); null when the bot is not set up
  async donateUrl() {
    const env = this.env;
    if (env.DONATE_URL) return env.DONATE_URL;
    const name = await this.botName();
    return name ? `https://t.me/${name}?start=donate` : null;
  }

  async botName() {
    if (!botConfigured(this.env)) return null;
    return (this.env.BOT_USERNAME || "").replace(/^@/, "") || this.botUsername || await this.fetchBotUsername();
  }

  // ---- accounts helpers
  // re-read the attachment after an await (other messages may have changed it meanwhile), then update
  patch(c, fields) {
    const cur = this.fromWs(c.ws) || c;
    Object.assign(cur, fields);
    Object.assign(c, fields);
    this.store(cur);
  }

  errRe(c, msg, re) {
    this.send(c, { t: "error", msg, re });
  }

  authRateOk(c) {
    const t = Date.now();
    let r = this.rate.get(c.id);
    if (!r) this.rate.set(c.id, (r = { state: [], msg: [] }));
    if (!r.auth) r.auth = [];
    let ip = this.authByIp.get(c.addr);
    if (!ip) this.authByIp.set(c.addr, (ip = []));
    if (this.authByIp.size > 5000) this.authByIp.clear();
    return rateOk(r.auth, AUTH_MAX_PER_MIN, t, 60000) && rateOk(ip, Number(this.env.AUTH_IP_PER_MIN) || AUTH_MAX_PER_MIN_IP, t, 60000);   // env: tests only
  }

  async acc(c, op, body, re) {
    if (!this.env.ACCOUNTS) { this.errRe(c, "Аккаунты пока не настроены", re); return null; }
    let res;
    try {
      res = await accCall(this.env, op, body);
    } catch (e) {
      console.log(`accounts call ${op} failed: ${e}`);
      res = { err: "Сервер аккаунтов временно недоступен, попробуйте позже" };
    }
    if (res.err) { this.errRe(c, res.err, re); return null; }
    return res;
  }

  needAcc(c, re) {
    if (c.acc) return true;
    this.errRe(c, "Нужно войти в аккаунт", re);
    return false;
  }

  sendAcc(c, res, withSecret) {
    const m = { t: "acc", id: res.id, nick: res.nick, linked: !!res.linked, tg: res.tg || null };
    // Google sign-in: only announced when the secrets are set (the game hides its buttons otherwise)
    if (googleConfigured(this.env)) { m.google_on = true; m.google = res.google || null; }
    if (withSecret) m.secret = res.secret;
    if (res.pass) m.pass = true;   // premium pass on the account (2.3)
    // 2.3.6: punishment (type, until, reason), unseen warnings, consent version, has a password
    if (res.terms_v) { m.pun = res.pun || null; m.warn = res.warn || []; m.consent_v = res.consent_v || null; m.terms_v = res.terms_v; m.pw = !!res.pw; }
    this.send(c, m);
  }

  setAccount(c, res) {
    const gn = gate(res, "nick", this.env);   // 07.11: a suspension scoped to «смена ника» (other punishments leave the nick alone, as before)
    const f = { acc: res.id, nick: res.nick || null, blk: blkText(gate(res, "online", this.env)), nb: gn && gn.pun && Array.isArray(gn.pun.scope) && gn.pun.scope.includes("nick") ? gn.text : null };
    if (res.nick) f.name = res.nick;
    this.patch(c, f);
    console.log(`account ${res.id} on ${c.id}${res.nick ? " (" + res.nick + ")" : ""}`);
  }

  async fetchBotUsername() {
    if (this.getMeTried && Date.now() - this.getMeTried < 600000) return null;
    this.getMeTried = Date.now();
    try {
      const base = (this.env.TG_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
      const res = await fetch(`${base}/bot${this.env.BOT_TOKEN}/getMe`);
      const data = await res.json();
      if (data.ok && data.result && data.result.username) {
        this.botUsername = data.result.username;
        this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('bot_username', ?)", this.botUsername);
        return this.botUsername;
      }
    } catch (e) {
      console.log(`getMe failed: ${e}`);
    }
    return null;
  }

  // ---- storage
  saveRoom(room) {
    this.rooms.set(room.code, room);
    this.sql.exec("INSERT OR REPLACE INTO rooms (code, data) VALUES (?, ?)", room.code, JSON.stringify(room));
  }

  deleteRoom(code) {
    this.rooms.delete(code);
    this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  saveQueue() {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('queue', ?)", JSON.stringify(this.queue));
  }

  // after a restart (deploy, eviction) sockets may be gone without a close event
  cleanupOrphans() {
    const live = (id) => this.ctx.getWebSockets(id).length > 0;
    const q = this.queue.filter(live);
    if (q.length !== this.queue.length) {
      this.queue = q;
      this.saveQueue();
    }
    for (const room of [...this.rooms.values()]) {
      const alive = room.players.filter((p) => live(p.id));
      if (alive.length === room.players.length) continue;
      this.deleteRoom(room.code);
      for (const p of alive) {
        const c = this.client(p.id);
        if (c && c.room === room.code) {
          c.room = null;
          this.store(c);
          if (room.players.length === 2) this.send(c, { t: "peer_left" });
        }
      }
      console.log(`room ${room.code} closed: orphaned after restart`);
    }
  }

  // ---- clients (data lives in the socket attachment)
  client(id) {
    const ws = this.ctx.getWebSockets(id)[0];
    if (!ws) return null;
    return this.fromWs(ws);
  }

  fromWs(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return null;
    return { ws, ...a };
  }

  store(c) {
    const { ws, ...a } = c;
    try {
      ws.serializeAttachment(a);
    } catch (e) { /* socket already closed */ }
  }

  info(c) {
    return { id: c.id, name: c.name };
  }

  tag(c) {
    return `${c.id}(${c.name})`;
  }

  send(c, msg) {
    if (!c) return;
    try {
      c.ws.send(JSON.stringify(msg));
    } catch (e) { /* closed */ }
  }

  sendId(id, msg) {
    this.send(this.client(id), msg);
  }

  error(c, msg) {
    this.send(c, { t: "error", msg });
  }

  newId() {
    for (;;) {
      const b = new Uint8Array(3);
      crypto.getRandomValues(b);
      const id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      if (this.ctx.getWebSockets(id).length === 0) return id;
    }
  }

  newCode() {
    for (;;) {
      let s = "";
      for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  roomInfo(room) {
    return { t: "room", code: room.code, players: room.players, host: room.host };
  }

  // ---- WebSocket lifecycle
  async fetch(request) {
    const pair = new WebSocketPair();
    const [clientSide, serverSide] = Object.values(pair);
    let origin = null;
    try { origin = new URL(request.url).origin; } catch (e) { /* keep null */ }
    this.accept(serverSide, request.headers.get("CF-Connecting-IP") || "?", origin);
    return new Response(null, { status: 101, webSocket: clientSide });
  }

  accept(ws, addr, origin) {
    const id = this.newId();
    this.ctx.acceptWebSocket(ws, [id]);
    ws.serializeAttachment({ id, name: DEFAULT_NAME, hello: false, room: null, queued: false, addr, origin });
    console.log(`connect ${id} from ${addr} (${this.ctx.getWebSockets().length} online)`);
  }

  async webSocketMessage(ws, raw) {
    const c = this.fromWs(ws);
    if (!c) return;
    try {
      await this.handle(c, raw);
    } catch (e) {
      console.log(`error handling message from ${c.id}: ${e && e.stack ? e.stack : e}`);
      this.error(c, "Ошибка сервера");
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    await this.dropSocket(ws);
    try {
      ws.close(1000, "bye");
    } catch (e) { /* already closed */ }
  }

  async webSocketError(ws, err) {
    await this.dropSocket(ws);
  }

  async dropSocket(ws) {
    const c = this.fromWs(ws);
    if (!c || c.gone) return;
    c.gone = true;
    this.store(c);
    this.rate.delete(c.id);
    this.removeFromQueue(c);
    this.leaveRoom(c, "disconnected");
    console.log(`disconnect ${this.tag(c)}`);
  }

  // ---- message dispatch
  async handle(c, raw) {
    if (typeof raw !== "string") return this.error(c, "Ожидается текстовое сообщение JSON");
    if (raw.length > MAX_MESSAGE_CHARS && (raw.length > MAX_SAVE_MESSAGE_CHARS || !raw.includes('"save_put"'))) {
      return this.error(c, "Неверный формат сообщения");
    }
    const msg = parseMessage(raw);
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return this.error(c, "Неверный формат сообщения");
    const t = msg.t;
    const handler = typeof t === "string" && Object.prototype.hasOwnProperty.call(HANDLERS, t) ? HANDLERS[t] : null;
    if (!handler) return this.error(c, "Неизвестная команда");
    let r = this.rate.get(c.id);
    if (!r) this.rate.set(c.id, (r = { state: [], msg: [] }));
    const now = Date.now();
    if (t === "state") {
      if (!rateOk(r.state, STATE_MAX_PER_SEC, now)) return;
    } else if (!rateOk(r.msg, MSG_MAX_PER_SEC, now)) return;
    if (!c.hello && t !== "hello" && t !== "ping") return this.error(c, "Сначала нужно представиться (hello)");
    if (c.blk && ONLINE_T.has(t)) return t === "score" ? this.errRe(c, c.blk, "score") : this.error(c, c.blk);
    return handler.call(this, c, msg);
  }

  // ---- rooms / queue
  removeFromQueue(c) {
    if (!c.queued) return;
    this.queue = this.queue.filter((id) => id !== c.id);
    this.saveQueue();
    c.queued = false;
    this.store(c);
  }

  leaveRoom(c, reason = "left") {
    const code = c.room;
    if (!code) return;
    c.room = null;
    this.store(c);
    const room = this.rooms.get(code);
    if (!room) return;
    this.deleteRoom(code);
    const other = room.players.find((p) => p.id !== c.id);
    const oc = other ? this.client(other.id) : null;
    if (oc && oc.room === code) {
      oc.room = null;
      this.store(oc);
      this.send(oc, { t: "peer_left" });
      console.log(`room ${code} closed: ${this.tag(c)} ${reason}, ${this.tag(oc)} notified`);
    } else {
      console.log(`room ${code} closed: ${this.tag(c)} ${reason} (empty)`);
    }
  }

  leaveAll(c, reason) {
    this.removeFromQueue(c);
    this.leaveRoom(c, reason);
  }

  newRoom(host, isPrivate) {
    return {
      code: this.newCode(), players: [this.info(host)], host: host.id, private: isPrivate,
      phase: "lobby", seed: 0, dead: [], scores: {}, rematch: [], idleSince: Date.now(), matches: 0,
    };
  }

  startMatch(room) {
    room.phase = "playing";
    room.seed = newSeed();
    room.dead = [];
    room.scores = {};
    room.rematch = [];
    room.matches += 1;
    this.saveRoom(room);
    const msg = { t: "start", seed: room.seed, countdown: 3, players: room.players };
    console.log(`match start room ${room.code} #${room.matches} seed=${room.seed}: ` +
      room.players.map((p) => `${p.id}(${p.name})`).join(" vs "));
    for (const p of room.players) this.sendId(p.id, msg);
  }

  finishMatch(room) {
    room.phase = "result";
    this.saveRoom(room);
    const scores = room.players.map((p) => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 }));
    let winner = null;
    if (scores.length === 2 && scores[0].score !== scores[1].score) {
      winner = scores[0].score > scores[1].score ? scores[0].id : scores[1].id;
    }
    console.log(`match result room ${room.code}: ` + scores.map((s) => `${s.id}=${s.score}`).join(", ") +
      ` winner=${winner}`);
    for (const p of room.players) this.sendId(p.id, { t: "result", scores, winner });
  }

  // ---- idle room expiry (alarm)
  async scheduleAlarm() {
    let next = null;
    for (const room of this.rooms.values()) {
      if (room.players.length === 1) {
        const at = room.idleSince + this.ttlMs;
        if (next === null || at < next) next = at;
      }
    }
    const cur = await this.ctx.storage.getAlarm();
    if (next === null) {
      if (cur !== null) await this.ctx.storage.deleteAlarm();
    } else if (cur === null || cur > next || cur < Date.now() - 60000) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async alarm() {
    const now = Date.now();
    const minutes = Math.max(1, Math.round(this.ttlMs / 60000));
    for (const room of [...this.rooms.values()]) {
      if (room.players.length === 1 && now - room.idleSince >= this.ttlMs) {
        this.deleteRoom(room.code);
        const c = this.client(room.players[0].id);
        if (c && c.room === room.code) {
          c.room = null;
          this.store(c);
          this.error(c, `Комната закрыта: соперник не подключился за ${minutes} мин`);
        }
        console.log(`room ${room.code} expired (idle, ${room.players[0].id})`);
      }
    }
    await this.scheduleAlarm();
  }
}

// ------------------------------------------------------------------ handlers (this = Lobby)

const HANDLERS = {
  async hello(c, msg) {
    c.name = c.nick || sanitizeName(msg.name);
    if (!c.hello) {
      c.hello = true;
      console.log(`hello ${this.tag(c)} v=${msg.v}`);
    }
    this.store(c);
    const welcome = { t: "welcome", id: c.id };
    const url = await this.donateUrl();
    if (url) welcome.donate = url;
    this.send(c, welcome);
  },

  quick(c) {
    if (c.queued) return this.send(c, { t: "wait" });
    this.leaveRoom(c);
    while (this.queue.length) {
      const oid = this.queue.shift();
      const oc = oid === c.id ? null : this.client(oid);
      if (!oc || !oc.queued || oc.gone) continue;
      oc.queued = false;
      const room = this.newRoom(oc, false);
      room.players.push(this.info(c));
      oc.room = room.code;
      c.room = room.code;
      this.store(oc);
      this.store(c);
      this.saveQueue();
      console.log(`quick match: room ${room.code} ${this.tag(oc)} + ${this.tag(c)}`);
      return this.startMatch(room);
    }
    this.queue.push(c.id);
    this.saveQueue();
    c.queued = true;
    this.store(c);
    console.log(`queue: ${this.tag(c)} waiting (${this.queue.length} in queue)`);
    this.send(c, { t: "wait" });
  },

  async create(c) {
    this.leaveAll(c);
    const room = this.newRoom(c, true);
    this.saveRoom(room);
    c.room = room.code;
    this.store(c);
    console.log(`room ${room.code} created by ${this.tag(c)} (${this.rooms.size} rooms)`);
    this.send(c, this.roomInfo(room));
    await this.scheduleAlarm();
  },

  async join(c, msg) {
    if (typeof msg.code !== "string") return this.error(c, "Комната не найдена");
    const code = msg.code.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || !room.private) return this.error(c, "Комната не найдена");
    if (c.room === code) return this.send(c, this.roomInfo(room));
    if (room.players.length >= 2) return this.error(c, "Комната заполнена");
    this.leaveAll(c);
    if (this.rooms.get(code) !== room || room.players.length >= 2) return this.error(c, "Комната не найдена");
    room.players.push(this.info(c));
    this.saveRoom(room);
    c.room = code;
    this.store(c);
    console.log(`room ${code}: ${this.tag(c)} joined`);
    const info = this.roomInfo(room);
    for (const p of room.players) this.sendId(p.id, info);
    this.startMatch(room);
    await this.scheduleAlarm();
  },

  leave(c) {
    this.leaveAll(c);
  },

  state(c, msg) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || room.phase !== "playing" || room.dead.includes(c.id)) return;
    const d = num(msg.d, 0, 1e7);
    const lane = num(msg.lane, 0, 2);
    const y = num(msg.y === undefined ? 0 : msg.y, -50, 500);
    const score = intNum(msg.score === undefined ? 0 : msg.score);
    const gems = intNum(msg.gems === undefined ? 0 : msg.gems);
    const alive = msg.alive === undefined ? true : msg.alive;
    if (d === null || lane === null || y === null || score === null || gems === null || typeof alive !== "boolean") return;
    const other = room.players.find((p) => p.id !== c.id);
    if (other) {
      this.sendId(other.id, { t: "peer", id: c.id, d: round3(d), lane: round3(lane), y: round3(y), score, gems, alive });
    }
  },

  dead(c, msg) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || room.phase !== "playing" || room.dead.includes(c.id)) return;
    let score = intNum(msg.score === undefined ? 0 : msg.score);
    if (score === null) score = 0;
    room.dead.push(c.id);
    room.scores[c.id] = score;
    this.saveRoom(room);
    console.log(`room ${room.code}: ${this.tag(c)} crashed, score=${score}`);
    const other = room.players.find((p) => p.id !== c.id);
    if (other) this.sendId(other.id, { t: "peer_dead", id: c.id, score });
    if (room.players.length === 2 && room.players.every((p) => room.dead.includes(p.id))) this.finishMatch(room);
  },

  rematch(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || room.phase !== "result" || room.players.length !== 2) return;
    if (room.rematch.includes(c.id)) return;
    room.rematch.push(c.id);
    this.saveRoom(room);
    if (room.players.every((p) => room.rematch.includes(p.id))) {
      console.log(`room ${room.code}: rematch`);
      this.startMatch(room);
    } else {
      const other = room.players.find((p) => p.id !== c.id);
      if (other) this.sendId(other.id, { t: "peer_rematch" });
    }
  },

  ping(c, msg) {
    this.send(c, { t: "pong", ts: msg.ts === undefined ? null : msg.ts });
  },

  // ---------------- accounts / cloud save / Telegram link / leaderboard
  async acc_new(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "acc_new");
    const res = await this.acc(c, "new", { consent: cleanConsent(msg && msg.consent), dev: cleanDev(msg && msg.dev), label: cleanLabel(msg && msg.label) }, "acc_new");
    if (!res) return;
    this.setAccount(c, res);
    this.sendAcc(c, res, true);
  },

  async acc_auth(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "acc_auth");
    if (typeof msg.id !== "string" || typeof msg.secret !== "string" || msg.id.length > 40 || msg.secret.length > 80) {
      return this.errRe(c, "Аккаунт не найден", "acc_auth");
    }
    const res = await this.acc(c, "auth", { id: msg.id, secret: msg.secret, dev: cleanDev(msg.dev), label: cleanLabel(msg.label) }, "acc_auth");
    if (!res) return;
    this.setAccount(c, res);
    this.sendAcc(c, res, false);
  },

  async acc_login(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "acc_login");
    const res = await this.acc(c, "login", { code: msg.code, ip: c.addr, dev: cleanDev(msg.dev), label: cleanLabel(msg.label) }, "acc_login");
    if (!res) return;
    this.setAccount(c, res);
    this.sendAcc(c, res, true);
  },

  // 2.3.6 «Войти по паролю»: login = nickname or the 12-hex account id. The password is never logged or sent back.
  async acc_pw_login(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "acc_pw_login");
    if (typeof msg.login !== "string" || typeof msg.pw !== "string" || msg.login.length > 40 || msg.pw.length > 200) return this.errRe(c, "Неверный ник/ID или пароль", "acc_pw_login");
    const res = await this.acc(c, "pw_login", { login: msg.login, pw: msg.pw, ip: c.addr, dev: cleanDev(msg.dev), label: cleanLabel(msg.label) }, "acc_pw_login");
    if (!res) return;
    this.setAccount(c, res);
    this.sendAcc(c, res, true);
  },

  // 2.3.6 «Сбросить пароль»: the P-code from the bot (/resetpw) + a new password -> this device signed in, all others signed out
  async acc_pw_reset(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "acc_pw_reset");
    if (typeof msg.code !== "string" || typeof msg.pw !== "string" || msg.code.length > 40 || msg.pw.length > 200) return this.errRe(c, "Код сброса не найден или устарел", "acc_pw_reset");
    const res = await this.acc(c, "pw_reset", { code: msg.code, pw: msg.pw, ip: c.addr, dev: cleanDev(msg.dev), label: cleanLabel(msg.label) }, "acc_pw_reset");
    if (!res) return;
    this.setAccount(c, res);
    this.sendAcc(c, res, true);
  },

  async nick_set(c, msg) {
    if (!this.needAcc(c, "nick_set")) return;
    if (c.nb) return this.errRe(c, c.nb, "nick_set");
    const res = await this.acc(c, "nick", { acc: c.acc, nick: msg.nick }, "nick_set");
    if (!res) return;
    this.patch(c, { nick: res.nick, name: res.nick });
    this.send(c, { t: "nick_ok", nick: res.nick });
  },

  async save_put(c, msg) {
    if (!this.needAcc(c, "save_put")) return;
    if (msg.ch) return this.errRe(c, "Читы на устройстве: облачное сохранение не обновлено", "save_put");   // 2.3.12: a cheated save never reaches the account
    const res = await this.acc(c, "save_put", { acc: c.acc, v: msg.v, data: msg.data }, "save_put");
    if (!res) return;
    if (res.conflict) return this.send(c, { t: "save_conflict", v: res.v, data: res.data });
    if (res.rate) return this.send(c, { t: "save_wait", retry: res.retry });
    this.send(c, { t: "save_ok", v: res.v });
  },

  async save_get(c) {
    if (!this.needAcc(c, "save_get")) return;
    const res = await this.acc(c, "save_get", { acc: c.acc }, "save_get");
    if (res) this.send(c, { t: "save", v: res.v, data: res.data });
  },

  async link_start(c) {
    if (!this.needAcc(c, "link_start")) return;
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "link_start");
    const bot = await this.botName();
    if (!bot) return this.errRe(c, "Telegram-бот пока не настроен", "link_start");
    const res = await this.acc(c, "link_start", { acc: c.acc }, "link_start");
    if (res) this.send(c, { t: "link", code: `L-${res.code}`, url: `https://t.me/${bot}?start=link_${res.code}` });
  },

  // «Войти через Google» / «Привязать Google»: the game opens url in the external browser and polls with p
  async google_start(c, msg) {
    const mode = msg.mode === "login" || msg.mode === "link" || msg.mode === "signin" ? msg.mode : null;   // 2.3.7: signin
    if (!mode) return this.errRe(c, "Неверный режим", "google_start");
    if (mode === "link" && !this.needAcc(c, "google_start")) return;
    if (!googleConfigured(this.env)) return this.errRe(c, "Google-вход не настроен", "google_start");
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "google_start");
    const origin = (this.env.PUBLIC_ORIGIN || c.origin || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(origin)) return this.errRe(c, "Ошибка сервера", "google_start");
    const res = await this.acc(c, "google_start", { mode, acc: c.acc || null, label: cleanLabel(msg.label) }, "google_start");
    if (res) this.send(c, { t: "google", mode, url: `${origin}/auth/google/start?s=${res.state}`, p: res.poll });
  },

  async google_poll(c, msg) {
    if (typeof msg.p !== "string" || msg.p.length > 40) return this.errRe(c, "Вход через Google устарел. Нажмите кнопку в игре ещё раз.", "google_poll");
    const res = await this.acc(c, "google_poll", { poll: msg.p, dev: cleanDev(msg.dev), label: cleanLabel(msg.label), acc: c.acc || null }, "google_poll");
    if (!res) return;
    // stage "confirm": link mode, Google verified, waiting for «Привязать» on the browser page (game: «Подтверди привязку в браузере»)
    if (res.pending) return this.send(c, res.stage ? { t: "google_wait", stage: res.stage } : { t: "google_wait" });
    // 2.3.7 signin: the account has a password and this device is new -> the game asks for it (google_pw{pt, pw})
    if (res.pw_need) return this.send(c, { t: "google_pw_need", pt: res.pt, ttl: res.ttl, nick: res.nick || null, google: res.google || null });
    this.send(c, { t: "google_done", mode: res.mode, google: res.google || null, fresh: !!res.secret, made: !!res.made, pw: !!res.pw });
    if (res.mode === "signin") {
      if (res.secret) { this.setAccount(c, res); this.sendAcc(c, res, true); } else if (c.acc === res.id) this.sendAcc(c, res, false);
    } else if (res.mode === "login") {
      this.setAccount(c, res);
      this.sendAcc(c, res, true);
    } else if (c.acc === res.id) this.sendAcc(c, res, false);
  },

  // 2.3.7 password step after «Войти через Google» (google_pw_need): pt + password -> this device signed in.
  // Limits: per connection/IP (authRateOk) + 5 wrong / 15 min per account and per IP (accounts_guard.js). Never logged.
  async google_pw(c, msg) {
    if (!this.authRateOk(c)) return this.errRe(c, "Слишком много попыток. Подождите минуту", "google_pw");
    if (typeof msg.pt !== "string" || typeof msg.pw !== "string" || msg.pt.length > 64 || msg.pw.length > 200) return this.errRe(c, "Неверный пароль", "google_pw");
    const res = await this.acc(c, "google_pw", { pt: msg.pt, pw: msg.pw, ip: c.addr, dev: cleanDev(msg.dev), label: cleanLabel(msg.label) }, "google_pw");
    if (!res) return;
    this.send(c, { t: "google_done", mode: "signin", google: res.google || null, fresh: true, pw: true });
    this.setAccount(c, res);
    this.sendAcc(c, res, true);
  },

  async score(c, msg) {
    if (!this.needAcc(c, "score")) return;
    if (msg.ch) return this.errRe(c, "Читы в этой сессии: результат не засчитан", "score");   // 2.3.12: no leaderboard for cheated runs
    const diff = msg.diff;
    if (!DIFFS.includes(diff)) return this.errRe(c, "Неверная сложность", "score");
    const m = msg.m;
    if (!Number.isInteger(m) || m < 0 || m > SCORE_MAX) return this.errRe(c, "Недопустимый результат", "score");
    const seed = Number.isInteger(msg.seed) ? msg.seed : null;
    const room = c.room ? this.rooms.get(c.room) : null;
    if (room && room.phase === "playing") return this.send(c, { t: "score_ok", diff, new: false, reason: "online" });
    const res = await this.acc(c, "score", { acc: c.acc, diff, m, seed }, "score");
    if (!res) return;
    const out = { t: "score_ok", season: res.season, diff, new: !!res.new };
    if (res.m !== undefined) out.m = res.m;
    if (res.rate) out.reason = "rate";
    this.send(c, out);
  },

  async top(c, msg) {
    if (!DIFFS.includes(msg.diff)) return this.errRe(c, "Неверная сложность", "top");
    const res = await this.acc(c, "top", { acc: c.acc || null, diff: msg.diff }, "top");
    if (res) this.send(c, { t: "top", season: res.season, ends: res.ends, diff: res.diff, rows: res.rows, me: res.me });
  },

  async redeem(c, msg) {
    const t = Date.now();
    let r = this.rate.get(c.id);
    if (!r) this.rate.set(c.id, (r = { state: [], msg: [] }));
    if (!r.redeem) r.redeem = [];
    let ipTimes = this.redeemByIp.get(c.addr);
    if (!ipTimes) this.redeemByIp.set(c.addr, (ipTimes = []));
    if (!rateOk(r.redeem, REDEEM_MAX_PER_MIN, t, 60000) || !rateOk(ipTimes, REDEEM_MAX_PER_MIN_IP, t, 60000)) {
      console.log(`redeem rate limit: ${this.tag(c)} from ${c.addr}`);
      return this.error(c, "Слишком много попыток. Подождите минуту");
    }
    if (this.redeemByIp.size > 5000) this.redeemByIp.clear();
    if (!botConfigured(this.env) || !this.env.DONATE) return this.error(c, REDEEM_ERRORS.not_configured);
    const code = normalizeCode(msg.code);
    if (!code) return this.error(c, REDEEM_ERRORS.not_found);
    // pass / one-per-account bundles go to the game account: check it BEFORE the code is spent
    let peek;
    try {
      peek = await peekViaDO(this.env, code);
    } catch (e) {
      console.log(`redeem peek error: ${e}`);
      peek = { status: "db_error" };
    }
    if (peek.status !== "ok") {
      console.log(`redeem ${code} by ${this.tag(c)}: ${peek.status}`);
      return this.error(c, REDEEM_ERRORS[peek.status] || REDEEM_ERRORS.db_error);
    }
    const rw = peek.reward || {};
    const needAcc = !!this.env.ACCOUNTS && (rw.pass === true || typeof rw.once === "string");
    let acc = c.acc || null;
    for (let i = 0; needAcc && !acc && i < 30; i++) {   // acc_auth of this connection may still be on its way
      await new Promise((ok) => setTimeout(ok, 100));
      const cur = this.fromWs(c.ws);
      acc = (cur && cur.acc) || null;
    }
    if (needAcc && !acc) return this.error(c, REDEEM_ERRORS.need_acc);
    if (needAcc && rw.once) {
      let oc;
      try { oc = await accCall(this.env, "once_check", { acc, key: rw.once }); } catch (e) { oc = { err: "db" }; }
      if (oc.err) return this.error(c, REDEEM_ERRORS.db_error);
      if (oc.used) return this.error(c, REDEEM_ERRORS.once);
    }
    let res;
    try {
      res = await redeemViaDO(this.env, code, `${c.id}:${c.name}` + (acc ? `:${acc}` : ""));
    } catch (e) {
      console.log(`redeem error: ${e}`);
      res = { status: "db_error" };
    }
    console.log(`redeem ${code} by ${this.tag(c)}: ${res.status}`);
    if (res.status === "ok" && needAcc) {
      try {
        if (rw.pass) await accCall(this.env, "pass_grant", { acc, src: code });
        if (rw.once) await accCall(this.env, "once_mark", { acc, key: rw.once });
      } catch (e) {
        console.log(`redeem ${code}: account grant failed: ${e}`);   // the code is spent: the owner can /gift or god «pass»
      }
    }
    if (res.status === "ok" && (acc || c.acc) && this.env.ONLINE) {   // 2.3.6 rewards journal (god «откат»; paid codes are kept)
      try {
        const st = this.env.ONLINE.get(this.env.ONLINE.idFromName("online"));
        await st.fetch("https://online/guard/internal", { method: "POST", headers: { "content-type": "application/json", "x-internal": "guard" },
          body: JSON.stringify({ op: "journal", acc: acc || c.acc, src: "code", ref: code, reward: res.reward, paid: !!peek.paid }) });
      } catch (e) { console.log(`redeem ${code}: journal failed: ${e}`); }
    }
    if (res.status === "ok") return this.send(c, { t: "redeemed", code, reward: res.reward, ...(needAcc ? { acc } : {}) });
    this.error(c, REDEEM_ERRORS[res.status] || REDEEM_ERRORS.db_error);
  },
};
