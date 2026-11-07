// Crystal Run («Кристальный забег») — player accounts, cloud saves, Telegram linking, season leaderboard.
//
// One Durable Object "Accounts" (SQLite). The Lobby (game WebSocket) and the Donate bot call it with
// internal POST requests: https://acc/<op>  body JSON  ->  JSON {ok:true,...} | {err:"<Russian text>"}.
// The Lobby only passes an account id after it verified the secret on that socket.

import { GUARD_SCHEMA, GUARD_COLUMNS, GuardMixin, GUARD_OPS, sessList, sessFind, devHash, cleanLabel, termsV, ctEq } from "./accounts_guard.js";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O, 0, I, 1
const DAY = 86400;
export const SEASON_EPOCH = Date.UTC(2026, 9, 20) / 1000; // 2026-10-20 00:00 UTC
export const SEASON_LEN = 14 * DAY;
export const DIFFS = ["easy", "normal", "hard"];
export const SCORE_MAX = 50000;
const SAVE_MAX_BYTES = 64 * 1024;
const SAVE_INTERVAL = 20;      // s between save_put per account
const SCORE_INTERVAL = 30;     // s between score submits per account
const NICK_CHANGES_PER_DAY = 3;
const CODE_TTL = 600;          // link / login codes: 10 min
const MAX_SECRETS = 8;         // devices per account
const TOP_N = 50;

const now = () => Math.floor(Date.now() / 1000);

function rand(n, alphabet = ALPHA) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x & 31]).join("");
}

function hex(bytes) {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha(s) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

export function seasonInfo(t = now()) {
  const s = Math.max(0, Math.floor((t - SEASON_EPOCH) / SEASON_LEN)) + 1;
  return { season: s, ends: SEASON_EPOCH + s * SEASON_LEN };
}

// ---- nicknames
const NICK_RE = /^[A-Za-z0-9_А-Яа-яЁёІіЇїЄєҐґ]{3,16}$/u;
const BAD = [
  // ru / ua
  "хуй", "хуе", "хуё", "хуя", "пизд", "ебан", "ебат", "ебал", "ебло", "уеб", "заеб", "выеб", "бляд", "блят", "бля",
  "сука", "суки", "сучк", "мудак", "мудил", "пидор", "пидар", "педик", "гандон", "залуп", "шлюх", "дроч", "манда",
  "хер", "жопа", "говн", "срать", "нацист", "гитлер", "даун",
  // en
  "fuck", "fuk", "shit", "bitch", "cunt", "dick", "cock", "pussy", "nigg", "fag", "whore", "slut", "asshole",
  "nazi", "hitler", "porn", "rape",
  // reserved
  "admin", "админ", "moder", "модер", "support", "поддержк", "official", "официальн", "crystalrun",
];
const TO_CYR = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
  "0": "о", "3": "з", "4": "ч", "6": "б", "і": "и", "ї": "и", "є": "е", "ё": "е", "ґ": "г" };
const TO_LAT = { "а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "к": "k", "м": "m", "о": "o", "р": "p", "т": "t",
  "х": "x", "у": "y", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

export function nickProblem(nick) {
  if (typeof nick !== "string" || !NICK_RE.test(nick)) return "Недопустимый ник";
  const low = nick.toLowerCase().replace(/_/g, "");
  const cyr = Array.from(low, (ch) => TO_CYR[ch] || ch).join("");
  const lat = Array.from(low, (ch) => TO_LAT[ch] || ch).join("");
  const badSet = BAD.map((w) => w.replace(/ё/g, "е"));
  for (const v of [low, cyr.replace(/ё/g, "е"), lat]) {
    for (const w of badSet) if (v.includes(w)) return "Недопустимый ник";
  }
  return null;
}

// ---- Durable Object
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, secrets TEXT NOT NULL, nick TEXT, nick_lc TEXT UNIQUE, nick_day INTEGER, nick_n INTEGER,
    tg_id INTEGER UNIQUE, tg_name TEXT, save_v INTEGER NOT NULL DEFAULT 0, save_data TEXT, save_at INTEGER,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS codes (key TEXT PRIMARY KEY, acc_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS scores (season INTEGER NOT NULL, diff TEXT NOT NULL, acc_id TEXT NOT NULL,
    m INTEGER NOT NULL, seed INTEGER, at INTEGER NOT NULL, PRIMARY KEY (season, diff, acc_id))`,
  "CREATE INDEX IF NOT EXISTS scores_rank ON scores (season, diff, m DESC, at)",
  // Google sign-in (OAuth in the external browser): one-time states, 10 min
  `CREATE TABLE IF NOT EXISTS gstates (id TEXT PRIMARY KEY, poll TEXT NOT NULL UNIQUE, mode TEXT NOT NULL,
    acc_id TEXT, verifier TEXT NOT NULL, expires INTEGER NOT NULL, phase INTEGER NOT NULL DEFAULT 0, res TEXT)`,
];
// columns added after v3 (ALTER TABLE ... ADD COLUMN cannot be UNIQUE -> separate unique index)
// pass: premium pass on the account (1 = on; set by a redeemed pass code, the legacy check or the owner); pass_src: where from;
// once: JSON list of one-per-account bundles already activated (e.g. ["starter"])
const ADD_COLUMNS = ["google_sub TEXT", "google_email TEXT", "pass INTEGER", "pass_at INTEGER", "pass_src TEXT", "once TEXT"];
// old saves with SAVE.pass (bought before the pass moved to the account) are accepted until this time (env PASS_LEGACY_UNTIL overrides)
export const PASS_LEGACY_UNTIL = Date.UTC(2027, 0, 1) / 1000;
// gstates columns for the link confirmation step (anti link-CSRF): verified Google sub + masked email wait here
// until the browser POSTs /auth/google/confirm with the one-time token (only its SHA-256 is stored)
const G_ADD_COLUMNS = ["csub TEXT", "cemail TEXT", "csrf TEXT", "cexp INTEGER", "clabel TEXT"];   // clabel: 2.3.7 device label for «Войти в аккаунт …?»
// gstates.phase: 0 new · 1 callback in progress · 2 done (res ready for google_poll) · 3 waiting for the browser confirm
const G_NEW = 0, G_TAKEN = 1, G_DONE = 2, G_CONFIRM = 3;
const CONFIRM_TTL = 300;       // the «Привязать?» page: 5 min
export const PT_TTL = 300;     // 2.3.7 Google sign-in -> password step: the pending token lives 5 min (table codes, key "Q:<sha256>")

export class Accounts {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
    let have = null;
    try {
      have = new Set(this.sql.exec("PRAGMA table_info(accounts)").toArray().map((r) => r.name));
    } catch (e) { /* PRAGMA not allowed: just try the ALTERs */ }
    for (const q of GUARD_SCHEMA) this.sql.exec(q);   // 2.3.6 accounts_guard.js: fails, pun, links
    for (const col of [...ADD_COLUMNS, ...GUARD_COLUMNS]) {
      if (have && have.has(col.split(" ")[0])) continue;
      try { this.sql.exec(`ALTER TABLE accounts ADD COLUMN ${col}`); } catch (e) { /* already there */ }
    }
    let gHave = null;
    try {
      gHave = new Set(this.sql.exec("PRAGMA table_info(gstates)").toArray().map((r) => r.name));
    } catch (e) { /* see above */ }
    for (const col of G_ADD_COLUMNS) {
      if (gHave && gHave.has(col.split(" ")[0])) continue;
      try { this.sql.exec(`ALTER TABLE gstates ADD COLUMN ${col}`); } catch (e) { /* already there */ }
    }
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS accounts_google ON accounts (google_sub)");
    this.scoreAt = new Map();  // acc -> last score submit (memory only; reset on eviction is harmless)
    this.linkFails = new Map(); // tg_id -> [times]
    this.topCache = new Map();  // "season:diff" -> {at, rows}
    this.gTtl = Math.max(1, Number(env && env.GOOGLE_STATE_TTL_SEC) || CODE_TTL); // Google states: 10 min (tests: shorter)
    this.cTtl = Math.max(1, Number(env && env.GOOGLE_CONFIRM_TTL_SEC) || CONFIRM_TTL); // link confirm page: 5 min
  }

  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.rows(q, ...b)[0] || null; }

  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
    if (!fn) return Response.json({ err: "unknown op" }, { status: 404 });
    try {
      const body = await request.json();
      return Response.json(await fn.call(this, body || {}));
    } catch (e) {
      console.log(`accounts ${op} error: ${e && e.stack ? e.stack : e}`);
      return Response.json({ err: "Ошибка сервера" });
    }
  }

  acc(id) {
    return typeof id === "string" ? this.one("SELECT * FROM accounts WHERE id = ?", id) : null;
  }

  pub(a, extra) {
    return { ok: true, id: a.id, nick: a.nick || null, linked: a.tg_id != null,
      tg: a.tg_name ? "@" + a.tg_name : null, google: a.google_sub ? a.google_email || "Google" : null, pass: !!a.pass, ...extra };
  }

  async newSecret(a, kind = "code", meta = {}) { return this.newSecretK(a, kind, meta); }   // 2.3.6: sessions (accounts_guard.js)

  // Google flow finished: keep the result for the game's google_poll
  gDone(g, res) {
    this.sql.exec("UPDATE gstates SET phase = ?, res = ?, csub = NULL, csrf = NULL WHERE id = ?", G_DONE, JSON.stringify(res), g.id);
    return res;
  }

  // link mode: can Google <sub> be linked to the flow's account? -> {a} | error code
  gLinkCheck(g, sub) {
    const a = this.acc(g.acc_id);
    if (!a) return { code: "noacc" };
    const owner = this.one("SELECT id FROM accounts WHERE google_sub = ?", sub);
    if (owner && owner.id !== a.id) return { code: "taken" };
    if (a.google_sub && a.google_sub !== sub) return { code: "other" };
    return { a };
  }

  // 2.3.7 sign-in into an EXISTING account without a password on a new device: never straight from the callback (somebody may
  // have sent their own «Войти через Google» URL; the victim's Google would open the victim's account in the sender's game).
  // The browser shows «Войти в аккаунт <ник> на новом устройстве <устройство>?» with a one-time token (POST /auth/google/confirm).
  gLoginConfirm(g, owner, sub, masked, csrf, csrfHash) {
    const t = now();
    this.sql.exec("UPDATE gstates SET phase = ?, csub = ?, cemail = ?, csrf = ?, cexp = ?, expires = MAX(expires, ?) WHERE id = ?",
      G_CONFIRM, sub, masked, csrfHash, t + this.cTtl, t + this.cTtl, g.id);
    return { ok: true, mode: g.mode, confirm: true, login: true, csrf, ttl: this.cTtl, id: owner.id, nick: owner.nick || null,
      label: g.clabel || null, google: masked || owner.google_email || null };
  }

  // 2.3.7 «Создать аккаунт?» confirmed: Google -> the device's current account (if it has no Google yet) or a new account
  gSigninCreate(g) {
    const owner = this.one("SELECT * FROM accounts WHERE google_sub = ?", g.csub);
    if (owner) return this.gDone(g, { ok: true, mode: "signin", login: true, id: owner.id, nick: owner.nick || null });   // «Войти в аккаунт?» (or linked meanwhile)
    const cur = g.acc_id ? this.acc(g.acc_id) : null;
    let id = cur && !cur.google_sub ? cur.id : null, made = false;
    try {
      if (id) this.sql.exec("UPDATE accounts SET google_sub = ?, google_email = ? WHERE id = ? AND google_sub IS NULL", g.csub, g.cemail, id);
      else {
        id = hex(crypto.getRandomValues(new Uint8Array(6))); made = true;
        this.sql.exec("INSERT INTO accounts (id, secrets, created_at, google_sub, google_email) VALUES (?, '[]', ?, ?, ?)", id, now(), g.csub, g.cemail);
      }
    } catch (e) {
      return this.gDone(g, gErr("taken")); // UNIQUE race
    }
    this.link(id, "g:" + g.csub);
    console.log(`account ${id}: google sign-in, ${made ? "new account" : "google attached to the device account"}`);
    const a = this.acc(id);
    return this.gDone(g, { ok: true, mode: "signin", id, nick: (a && a.nick) || null, made, google: g.cemail || "Google" });
  }

  makeCode(prefix, len, accId) {
    const t = now();
    this.sql.exec("DELETE FROM codes WHERE expires < ? OR (acc_id = ? AND key LIKE ?)", t, accId, prefix + ":%");
    for (;;) {
      const code = rand(len);
      if (this.one("SELECT key FROM codes WHERE key = ?", `${prefix}:${code}`)) continue;
      this.sql.exec("INSERT INTO codes (key, acc_id, expires) VALUES (?, ?, ?)", `${prefix}:${code}`, accId, t + CODE_TTL);
      return code;
    }
  }

  peekCode(prefix, code) {        // like takeCode, but the code stays (P-code: kept for a better password)
    const row = this.one("SELECT * FROM codes WHERE key = ?", `${prefix}:${code}`);
    return row && row.expires >= now() ? row.acc_id : null;
  }

  // 2.3.6: brute-force budget for one-time codes (persistent; per IP and for everybody) -> null | error text
  codeRate(kind, ip) {
    const L = { lg: [10, 1000, 900], lk: [5, 200, 600] }[kind];
    const ki = kind + ":ip:" + (ip || "?");
    if (this.failN(ki, L[2]) >= L[0] || this.failN(kind + ":all", L[2]) >= L[1]) {
      return `Слишком много неверных кодов. Попробуйте через ${this.failRetry(ki, L[2])} мин.`;
    }
    return null;
  }

  takeCode(prefix, code) {
    const key = `${prefix}:${code}`;
    const row = this.one("SELECT * FROM codes WHERE key = ?", key);
    if (!row) return null;
    this.sql.exec("DELETE FROM codes WHERE key = ?", key);
    return row.expires >= now() ? row.acc_id : null;
  }
}

// "irina@gmail.com" -> "i***@gmail.com" (only the masked form is stored)
Object.assign(Accounts.prototype, GuardMixin);

export function maskEmail(email) {
  if (typeof email !== "string" || email.length > 254) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return Array.from(email.slice(0, at).toLowerCase())[0] + "***" + email.slice(at).toLowerCase();
}

export const G_ERR = {
  gone: "Вход через Google устарел. Нажмите кнопку в игре ещё раз.",
  taken: "Этот Google-аккаунт уже привязан к другому игровому аккаунту. Чтобы открыть тот аккаунт, нажмите «Войти через Google».",
  other: "К этому игровому аккаунту уже привязан другой Google-аккаунт.",
  nolink: "К этому Google-аккаунту не привязан игровой аккаунт. Сначала привяжите Google в профиле игры на старом устройстве.",
  noacc: "Аккаунт не найден",
  cancelled: "Привязка отменена",
  expired: "Подтверждение привязки устарело. Нажмите «Привязать Google» в игре ещё раз.",
  csrf: "Подтверждение не прошло проверку. Нажмите «Привязать Google» в игре ещё раз.",
  // 2.3.7 «Войти через Google» + password step
  need_pw: "Для этого аккаунта задан пароль. Обновите игру, чтобы войти через Google и ввести пароль.",
  pw_gone: "Вход устарел. Нажмите «Войти через Google» ещё раз.",
};
const gErr = (code) => ({ err: G_ERR[code], code });

function cleanCode(raw, prefix, len) {
  if (typeof raw !== "string" || raw.length > 40) return null;
  let s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (s.length === len + 1 && s[0] === prefix) s = s.slice(1);
  return s.length === len && [...s].every((ch) => ALPHA.includes(ch)) ? s : null;
}

const OPS = {
  // 2.3.6: consent {v, terms, privacy, age} (the game's consent window) and dev (random device id) are optional
  async new({ consent, dev, label } = {}) {
    const id = hex(crypto.getRandomValues(new Uint8Array(6)));
    const secret = hex(crypto.getRandomValues(new Uint8Array(16)));
    const t = now(), d = await devHash(dev);
    this.sql.exec("INSERT INTO accounts (id, secrets, created_at) VALUES (?, ?, ?)", id,
      JSON.stringify([{ h: await sha(secret), k: "new", c: t, l: t, d, n: cleanLabel(label) }]), t);
    if (d) this.link(id, "d:" + d);
    if (consent && typeof consent === "object") await GUARD_OPS.consent.call(this, { acc: id, ...consent });
    console.log(`account ${id} created`);
    const a = this.acc(id);
    return this.pub(a, { secret, ...this.status(a) });
  },

  // every secret is checked against every session of the account in constant time (accounts_guard.js)
  // raid: the raid hub's anti-abuse limits (raid3.js) also get rd = {sdev: this session's device hash, devs: the device hashes of
  // all sessions, created}. Only the hash (accounts_guard.js devHash) leaves, never the raw device id.
  async auth({ id, secret, dev, label, raid }) {
    const s = typeof id === "string" && id.length <= 40 ? await this.sess(id, secret) : null;
    if (!s) return { err: "Аккаунт не найден" };
    const me = s.list[s.idx], t = now();
    if (t - (me.l || 0) > 300 || (dev && !me.d)) {          // «last seen» + the device of an old session
      me.l = t;
      if (!me.d) { const d = await devHash(dev); if (d) { me.d = d; this.link(s.a.id, "d:" + d); } }
      if (!me.n && label) me.n = cleanLabel(label);
      this.saveSess(s.a.id, s.list);
    }
    const out = this.pub(s.a, this.status(s.a));
    if (raid) out.rd = { sdev: me.d || null, devs: [...new Set(s.list.map((x) => x.d).filter(Boolean))].slice(0, 8), created: s.a.created_at || 0 };
    return out;
  },

  nick({ acc, nick }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    nick = typeof nick === "string" ? nick.trim() : nick;
    const bad = nickProblem(nick);
    if (bad) return { err: bad };
    const lc = nick.toLowerCase();
    if (a.nick === nick) return { ok: true, nick };
    const owner = this.one("SELECT id FROM accounts WHERE nick_lc = ?", lc);
    if (owner && owner.id !== a.id) return { err: "Ник занят" };
    const day = Math.floor(now() / DAY);
    const n = a.nick_day === day ? a.nick_n || 0 : 0;
    if (n >= NICK_CHANGES_PER_DAY) return { err: "Ник можно менять не больше 3 раз в день" };
    try {
      this.sql.exec("UPDATE accounts SET nick = ?, nick_lc = ?, nick_day = ?, nick_n = ? WHERE id = ?",
        nick, lc, day, n + 1, a.id);
    } catch (e) {
      return { err: "Ник занят" }; // UNIQUE race
    }
    this.topCache.clear();
    console.log(`account ${a.id} nick -> ${nick}`);
    return { ok: true, nick };
  },

  save_put({ acc, v, data }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    if (!Number.isSafeInteger(v) || v < 1) return { err: "Неверная версия сохранения" };
    const json = JSON.stringify(data === undefined ? null : data);
    if (new TextEncoder().encode(json).length > SAVE_MAX_BYTES) return { err: "Сохранение слишком большое (больше 64 КБ)" };
    if (v <= a.save_v) return { conflict: true, v: a.save_v, data: a.save_data ? JSON.parse(a.save_data) : null };
    const t = now();
    if (a.save_at && t - a.save_at < SAVE_INTERVAL) return { rate: true, retry: SAVE_INTERVAL - (t - a.save_at) };
    this.sql.exec("UPDATE accounts SET save_v = ?, save_data = ?, save_at = ? WHERE id = ?", v, json, t, a.id);
    return { ok: true, v };
  },

  save_get({ acc }) {
    const a = this.one("SELECT save_v, save_data FROM accounts WHERE id = ?", acc);
    if (!a) return { err: "Аккаунт не найден" };
    return { ok: true, v: a.save_v, data: a.save_data ? JSON.parse(a.save_data) : null };
  },

  link_start({ acc }) {
    if (!this.acc(acc)) return { err: "Аккаунт не найден" };
    return { ok: true, code: this.makeCode("L", 4, acc) };
  },

  // bot: /start link_XXXX
  tg_link({ code, tg_id, tg_name }) {
    const busy = this.codeRate("lk", "tg" + tg_id);          // persistent: per Telegram user and for everybody
    if (busy) return { err: busy };
    const c = cleanCode(code, "L", 4);
    const accId = c ? this.takeCode("L", c) : null;
    const a = accId ? this.acc(accId) : null;
    if (!a) {
      this.failAdd("lk:ip:tg" + tg_id, "lk:all");
      return { err: "Код привязки не найден или устарел. Получите новый в игре." };
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE accounts SET tg_id = NULL, tg_name = NULL WHERE tg_id = ? AND id != ?", tg_id, a.id);
      this.sql.exec("UPDATE accounts SET tg_id = ?, tg_name = ? WHERE id = ?", tg_id, tg_name || null, a.id);
    });
    this.link(a.id, "t:" + tg_id);
    console.log(`account ${a.id} linked to tg ${tg_id}`);
    return { ok: true, id: a.id, nick: a.nick || null };
  },

  // bot: /login
  tg_login({ tg_id }) {
    const a = this.one("SELECT * FROM accounts WHERE tg_id = ?", tg_id);
    if (!a) return { err: "К этому Telegram не привязан аккаунт." };
    return { ok: true, code: this.makeCode("G", 6, a.id), nick: a.nick || null };
  },

  // game: acc_login
  async login({ code, ip, dev, label }) {
    const busy = this.codeRate("lg", ip);
    if (busy) return { err: busy };
    const c = cleanCode(code, "G", 6);
    const accId = c ? this.takeCode("G", c) : null;
    const a = accId ? this.acc(accId) : null;
    if (!a) { this.failAdd("lg:ip:" + (ip || "?"), "lg:all"); return { err: "Код входа не найден или устарел" }; }
    const secret = await this.newSecret(a, "code", { dev, label });
    console.log(`account ${a.id} logged in on a new device`);
    return this.pub(this.acc(a.id), { secret, ...this.status(a) });
  },

  // ---- Google sign-in. Lobby: google_start -> {state, poll}; the state goes into the browser URL,
  // the poll token stays in the game. Worker /auth/google/*: google_begin -> google_take -> google_finish|google_fail.
  // 2.3.7 mode "signin" (the one «Войти через Google» button): an account with this Google -> sign in (+ password step
  // when it has a password and this socket is not already signed in to it); no account yet -> the browser asks
  // «Создать аккаунт?» and the device's current account (or a new one) gets this Google. "login" stays for old clients.
  google_start({ mode, acc, label }) {
    if (mode !== "link" && mode !== "login" && mode !== "signin") return { err: "Неверный режим" };
    if (mode === "link" && !this.acc(acc)) return gErr("noacc");
    if (acc && !this.acc(acc)) acc = null;
    const t = now();
    this.sql.exec("DELETE FROM gstates WHERE expires < ?", t - this.gTtl);
    // one pending flow per account; a new «Привязать Google» also kills an unconfirmed old confirm page
    if (acc) this.sql.exec("DELETE FROM gstates WHERE acc_id = ? AND phase IN (?, ?)", acc, G_NEW, G_CONFIRM);
    const state = rand(24), poll = rand(24);
    const verifier = hex(crypto.getRandomValues(new Uint8Array(32))); // PKCE: 64 chars [0-9a-f]
    this.sql.exec("INSERT INTO gstates (id, poll, mode, acc_id, verifier, expires, clabel) VALUES (?, ?, ?, ?, ?, ?, ?)",
      state, poll, mode, acc || null, verifier, t + this.gTtl, cleanLabel(label));
    return { ok: true, state, poll };
  },

  // the website (site.js) «Войти через Google»: only INTO an account that already has this Google (no create, no link).
  // An account with a password -> pw_need (the site then asks the password and uses pw_login), like the game's password step.
  async web_google({ sub, email, label }) {
    const a = typeof sub === "string" && sub && sub.length <= 255 ? this.one("SELECT * FROM accounts WHERE google_sub = ?", sub) : null;
    if (!a) return gErr("nolink");
    if (a.pw) return { ok: true, pw_need: true, id: a.id, nick: a.nick || null };
    const secret = await this.newSecretK(a, "google", { label });
    return this.pub(this.acc(a.id), { secret });
  },

  // /auth/google/start (may be opened again while the flow is not finished)
  google_begin({ state }) {
    const g = typeof state === "string" ? this.one("SELECT * FROM gstates WHERE id = ?", state) : null;
    if (!g || g.phase !== G_NEW || g.expires < now()) return gErr("gone");
    return { ok: true, verifier: g.verifier, mode: g.mode };
  },

  // /auth/google/callback: one time only
  google_take({ state }) {
    const g = typeof state === "string" ? this.one("SELECT * FROM gstates WHERE id = ?", state) : null;
    if (!g || g.phase !== G_NEW || g.expires < now()) return gErr("gone");
    this.sql.exec("UPDATE gstates SET phase = ? WHERE id = ?", G_TAKEN, state);
    return { ok: true, verifier: g.verifier, mode: g.mode };
  },

  google_fail({ state, err, code }) {
    this.sql.exec("UPDATE gstates SET phase = ?, res = ? WHERE id = ? AND phase IN (?, ?)", G_DONE, JSON.stringify({ err, code }),
      String(state), G_NEW, G_TAKEN);
    return { ok: true };
  },

  async google_finish({ state, sub, email }) {
    // all awaits first: the checks and writes below then run without other requests interleaving
    const csrf = hex(crypto.getRandomValues(new Uint8Array(32))), csrfHash = await sha(csrf);
    const g = typeof state === "string" ? this.one("SELECT * FROM gstates WHERE id = ?", state) : null;
    if (!g || g.phase !== G_TAKEN) return gErr("gone");
    if (typeof sub !== "string" || !sub || sub.length > 255) return this.gDone(g, gErr("gone"));
    const masked = maskEmail(email);
    const owner = this.one("SELECT * FROM accounts WHERE google_sub = ?", sub);
    if (g.mode === "signin" && owner) {
      if (masked && masked !== owner.google_email) this.sql.exec("UPDATE accounts SET google_email = ? WHERE id = ?", masked, owner.id);
      this.link(owner.id, "g:" + sub);
      console.log(`account ${owner.id}: google sign-in`);
      if (!owner.pw && owner.id !== g.acc_id) return this.gLoginConfirm(g, owner, sub, masked, csrf, csrfHash);   // no password: the browser confirms
      // pw: only the page text («введите пароль в игре»); google_poll decides with the polling socket's account
      return this.gDone(g, { ok: true, mode: "signin", id: owner.id, nick: owner.nick || null, pw: !!owner.pw && owner.id !== g.acc_id });
    }
    if (g.mode === "signin") {
      // no account with this Google: never create/attach straight from the callback (somebody may have sent this
      // URL from their own game). The browser confirms «Создать аккаунт?» with a one-time token, like the link page.
      const cur = g.acc_id ? this.acc(g.acc_id) : null;
      const t = now();
      this.sql.exec("UPDATE gstates SET phase = ?, csub = ?, cemail = ?, csrf = ?, cexp = ?, expires = MAX(expires, ?) WHERE id = ?",
        G_CONFIRM, sub, masked, csrfHash, t + this.cTtl, t + this.cTtl, g.id);
      const guest = !cur || cur.google_sub || (cur.tg_id == null && !cur.pw);
      return { ok: true, mode: "signin", confirm: true, create: guest, csrf, ttl: this.cTtl, id: cur && !cur.google_sub ? cur.id : "",
        nick: cur && !cur.google_sub ? cur.nick || null : null, google: masked || null };
    }
    if (g.mode === "login") {
      if (!owner) return this.gDone(g, gErr("nolink"));
      if (owner.pw && owner.id !== g.acc_id) return this.gDone(g, gErr("need_pw"));   // old client: no password step
      if (owner.id !== g.acc_id) {
        if (masked && masked !== owner.google_email) this.sql.exec("UPDATE accounts SET google_email = ? WHERE id = ?", masked, owner.id);
        return this.gLoginConfirm(g, owner, sub, masked, csrf, csrfHash);   // 2.3.7: old clients too (they show «Подтверди … в браузере»)
      }
      if (masked && masked !== owner.google_email) this.sql.exec("UPDATE accounts SET google_email = ? WHERE id = ?", masked, owner.id);
      this.link(owner.id, "g:" + sub);
      console.log(`account ${owner.id}: google login`);
      return this.gDone(g, { ok: true, mode: "login", id: owner.id, nick: owner.nick || null });
    }
    // LINK: never link straight from the callback. Someone may have sent the victim their own «Привязать Google»
    // URL; the victim's Google would end up on the sender's game account. Park the verified identity and let the
    // browser confirm with a one-time token (POST /auth/google/confirm) that only this page received.
    const chk = this.gLinkCheck(g, sub);
    if (chk.code) return this.gDone(g, gErr(chk.code));
    const a = chk.a;
    const t = now();
    this.sql.exec("UPDATE gstates SET phase = ?, csub = ?, cemail = ?, csrf = ?, cexp = ?, expires = MAX(expires, ?) WHERE id = ?",
      G_CONFIRM, sub, masked, csrfHash, t + this.cTtl, t + this.cTtl, g.id);
    return { ok: true, mode: "link", confirm: true, csrf, ttl: this.cTtl, id: a.id, nick: a.nick || null, google: masked || null };
  },

  // POST /auth/google/confirm | /auth/google/cancel: state + the one-time token from the confirm page
  async google_confirm({ state, csrf, cancel }) {
    const h = typeof csrf === "string" && /^[0-9a-f]{64}$/.test(csrf) ? await sha(csrf) : null; // await first (see google_finish)
    const g = typeof state === "string" ? this.one("SELECT * FROM gstates WHERE id = ?", state) : null;
    if (!g || g.phase !== G_CONFIRM || !g.csrf) return gErr("gone");
    if (!h || !ctEq(h, g.csrf)) return { err: G_ERR.csrf, code: "csrf" };   // 2.3.6: constant time   // wrong token: the state stays as it was
    if (!(g.cexp >= now())) return this.gDone(g, gErr("expired"));
    if (cancel) {
      console.log(`google link cancelled in the browser (account ${g.acc_id})`);
      const own = g.mode !== "link" && g.csub ? this.one("SELECT id FROM accounts WHERE google_sub = ?", g.csub) : null;
      return this.gDone(g, g.mode !== "link" ? { err: "Вход через Google отменён", code: "cancelled", mode: g.mode, login: !!own } : gErr("cancelled"));
    }
    if (g.mode === "signin") return this.gSigninCreate(g);
    if (g.mode === "login") {                                  // old client, «Войти в аккаунт?» confirmed
      const owner = this.one("SELECT * FROM accounts WHERE google_sub = ?", g.csub);
      if (!owner) return this.gDone(g, gErr("nolink"));
      if (owner.pw && owner.id !== g.acc_id) return this.gDone(g, gErr("need_pw"));
      return this.gDone(g, { ok: true, mode: "login", login: true, id: owner.id, nick: owner.nick || null });
    }
    const chk = this.gLinkCheck(g, g.csub);                  // re-check: things may have changed in the meantime
    if (chk.code) return this.gDone(g, gErr(chk.code));
    try {
      this.sql.exec("UPDATE accounts SET google_sub = ?, google_email = ? WHERE id = ?", g.csub, g.cemail, chk.a.id);
    } catch (e) {
      return this.gDone(g, gErr("taken")); // UNIQUE race
    }
    this.link(chk.a.id, "g:" + g.csub);
    console.log(`account ${chk.a.id} linked to google (confirmed)`);
    return this.gDone(g, { ok: true, mode: "link", id: chk.a.id, nick: chk.a.nick || null, google: g.cemail || "Google" });
  },

  // game: google_poll{p} -> pending | the account (login: with a new device secret) | err. Result is given once.
  // acc: the polling socket's account (its secret was checked by the Lobby) = this device is already trusted
  async google_poll({ poll, dev, label, acc }) {
    const g = typeof poll === "string" && poll.length <= 40 ? this.one("SELECT * FROM gstates WHERE poll = ?", poll) : null;
    if (!g) return gErr("gone");
    if (g.phase === G_CONFIRM) {
      if (!(g.cexp >= now())) { this.sql.exec("DELETE FROM gstates WHERE id = ?", g.id); return gErr("expired"); }
      return { ok: true, pending: true, stage: "confirm" };   // the game: «Подтверди привязку в браузере»
    }
    if (g.phase !== G_DONE) {
      if (g.expires < now()) { this.sql.exec("DELETE FROM gstates WHERE id = ?", g.id); return gErr("gone"); }
      return { ok: true, pending: true };
    }
    this.sql.exec("DELETE FROM gstates WHERE id = ?", g.id);
    if (!cleanLabel(label) && g.clabel) label = g.clabel;   // 2.3.7: the label shown on «Войти в аккаунт …?» (google_start) -> sessions / Telegram note
    const res = JSON.parse(g.res || "{}");
    if (!res.ok) return { err: res.err || G_ERR.gone, code: res.code || "gone" };
    const a = this.acc(res.id);
    if (!a) return gErr("noacc");
    if (res.mode === "signin") {
      if (acc && acc === a.id) return this.pub(a, { mode: "signin", fresh: false, ...this.status(a) });   // already signed in here
      if (a.pw) {                                                // password step: a one-time pending token, then google_pw
        const pt = hex(crypto.getRandomValues(new Uint8Array(16))), t = now();
        this.sql.exec("DELETE FROM codes WHERE expires < ?", t);
        this.sql.exec("INSERT INTO codes (key, acc_id, expires) VALUES (?, ?, ?)", "Q:" + await sha(pt), a.id, t + PT_TTL);
        return { ok: true, mode: "signin", pw_need: true, pt, ttl: PT_TTL, id: a.id, nick: a.nick || null, google: a.google_email || "Google" };
      }
      const secret = await this.newSecret(a, "google", { dev, label });
      const f = this.acc(a.id);
      return this.pub(f, { mode: "signin", fresh: true, made: !!res.made, secret, ...this.status(f) });
    }
    if (res.mode === "login") {
      if (a.pw && acc !== a.id) return gErr("need_pw");
      const secret = await this.newSecret(a, "google", { dev, label }); return this.pub(this.acc(a.id), { mode: "login", secret, ...this.status(a) });
    }
    return this.pub(a, { mode: "link" });
  },

  // ---- premium pass (Lobby after a pass code; Online for season claims / profile; god panel)
  pass_get({ acc }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    return { ok: true, pass: !!a.pass };
  },

  pass_grant({ acc, src, on }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    const v = on === false ? 0 : 1;
    this.sql.exec("UPDATE accounts SET pass = ?, pass_at = ?, pass_src = ? WHERE id = ?", v, now(),
      typeof src === "string" ? src.slice(0, 40) : null, a.id);
    console.log(`account ${a.id} pass -> ${v} (${src})`);
    return { ok: true, pass: !!v };
  },

  // a save from before 2.3.x has SAVE.pass = true (the old local pass). Accepted only if the account's CLOUD save
  // (uploaded by the game earlier) says so too, and only until PASS_LEGACY_UNTIL.
  pass_legacy({ acc }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    if (a.pass) return { ok: true, pass: true };
    const until = Number(this.env && this.env.PASS_LEGACY_UNTIL) || PASS_LEGACY_UNTIL;
    if (now() > until) return { err: "Перенос старого пропуска закрыт. Напишите в поддержку бота", code: "closed" };
    let data = null;
    try { data = a.save_data ? JSON.parse(a.save_data) : null; } catch (e) { data = null; }
    const save = data && typeof data === "object" ? (data.save && typeof data.save === "object" ? data.save : data) : null;
    if (!save || save.pass !== true) return { err: "В облачном сохранении нет пропуска", code: "no_save" };
    this.sql.exec("UPDATE accounts SET pass = 1, pass_at = ?, pass_src = 'legacy' WHERE id = ?", now(), a.id);
    console.log(`account ${a.id} pass -> 1 (legacy save)`);
    return { ok: true, pass: true, legacy: true };
  },

  once_check({ acc, key }) {
    const a = this.acc(acc);
    if (!a) return { err: "Аккаунт не найден" };
    let list = [];
    try { list = JSON.parse(a.once || "[]"); } catch (e) { list = []; }
    return { ok: true, used: Array.isArray(list) && list.includes(key) };
  },

  once_mark({ acc, key }) {
    const a = this.acc(acc);
    if (!a || typeof key !== "string" || !/^[a-z0-9_]{1,32}$/.test(key)) return { err: "Аккаунт не найден" };
    let list = [];
    try { list = JSON.parse(a.once || "[]"); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (!list.includes(key)) list.push(key);
    this.sql.exec("UPDATE accounts SET once = ? WHERE id = ?", JSON.stringify(list.slice(-50)), a.id);
    return { ok: true };
  },

  score({ acc, diff, m, seed }) {
    const { season } = seasonInfo();
    const t = now();
    const last = this.scoreAt.get(acc);
    if (last && t - last < SCORE_INTERVAL) return { ok: true, season, diff, rate: true, new: false };
    this.scoreAt.set(acc, t);
    if (this.scoreAt.size > 20000) this.scoreAt.clear();
    const prev = this.one("SELECT m FROM scores WHERE season = ? AND diff = ? AND acc_id = ?", season, diff, acc);
    if (prev && prev.m >= m) return { ok: true, season, diff, m: prev.m, new: false };
    this.sql.exec("INSERT INTO scores (season, diff, acc_id, m, seed, at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (season, diff, acc_id) DO UPDATE SET m = excluded.m, seed = excluded.seed, at = excluded.at",
      season, diff, acc, m, seed, t);
    this.topCache.delete(`${season}:${diff}`);
    return { ok: true, season, diff, m, new: true };
  },

  // 2.3.6 god «откат»: season leaderboard places set in [from, until] are removed
  scores_drop({ acc, from, until }) {
    if (!this.acc(acc) || !Number.isInteger(from)) return { err: "not_found" };
    const u = Number.isInteger(until) ? until : now();
    const n = this.one("SELECT COUNT(*) AS n FROM scores WHERE acc_id = ? AND at >= ? AND at <= ?", acc, from, u).n;
    this.sql.exec("DELETE FROM scores WHERE acc_id = ? AND at >= ? AND at <= ?", acc, from, u);
    this.topCache.clear();
    return { ok: true, removed: n };
  },

  top({ acc, diff }) {
    const { season, ends } = seasonInfo();
    const key = `${season}:${diff}`;
    let cached = this.topCache.get(key);
    if (!cached || Date.now() - cached.at > 30000) {
      const rows = this.rows("SELECT a.nick AS nick, s.m AS m FROM scores s JOIN accounts a ON a.id = s.acc_id " +
        "WHERE s.season = ? AND s.diff = ? ORDER BY s.m DESC, s.at ASC LIMIT ?", season, diff, TOP_N)
        .map((r) => ({ nick: r.nick || "Игрок", m: r.m }));
      cached = { at: Date.now(), rows };
      this.topCache.set(key, cached);
    }
    let me = null;
    if (acc) {
      const mine = this.one("SELECT m, at FROM scores WHERE season = ? AND diff = ? AND acc_id = ?", season, diff, acc);
      if (mine) {
        const above = this.one("SELECT COUNT(*) AS n FROM scores WHERE season = ? AND diff = ? AND (m > ? OR (m = ? AND at < ?))",
          season, diff, mine.m, mine.m, mine.at).n;
        me = { rank: above + 1, m: mine.m };
      }
    }
    return { ok: true, season, ends, diff, rows: cached.rows, me };
  },
};

for (const k of Object.keys(GUARD_OPS)) OPS[k] = GUARD_OPS[k];   // 2.3.6 password / sessions / consent / punishments

export function accountsStub(env) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName("accounts"));
}

export async function accCall(env, op, body) {
  const res = await accountsStub(env).fetch(`https://acc/${op}`, { method: "POST", body: JSON.stringify(body) });
  return res.json();
}
