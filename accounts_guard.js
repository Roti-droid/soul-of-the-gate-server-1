// accounts_guard.js — 2.3.6 «Защита аккаунтов и наказания» (ops merged into the Accounts DO, see accounts.js).
//
//  * sessions: every device secret is a session {h: sha256(secret), k: kind, c: created, l: last seen, d: device hash, n: label};
//    secrets are compared in constant time; «выйти на всех устройствах» keeps only the current session.
//  * password: PBKDF2-SHA256 (WebCrypto, 100 000 iterations — the Workers maximum), 16-byte salt per account, constant-time
//    compare, ≥ 8 chars, common passwords refused, 5 wrong tries / 15 min per account and per IP. Never logged, never returned.
//  * brute force: persistent failure counters (table fails) for login codes, link codes, passwords and reset codes.
//  * punishments (terms.html §2): warn · suspend (online modes closed) · ban (account closed online) · perm. Reason + end on the server.
//  * ban evasion: accounts are linked by Telegram, Google and device id (table links); an account sharing a link with a
//    banned/suspended one inherits that punishment (god «lift» on it marks the pair as checked = exempt).
//  * consent: version + date of «Условия / Политика / 18+» on the account; online without the current version is refused.

// 2.3.12 the owner: env.OWNER_ID (secret) or env.OWNER_ID_ALT (a plain var in wrangler.toml — an account id is not a secret).
// Every owner check goes through here (profile/me, god auth, raid practice, the self-ban guards, the punishment skip).
export function isOwnerId(env, id) {
  if (!env || typeof id !== "string" || !id) return false;
  return (!!env.OWNER_ID && id === env.OWNER_ID) || (!!env.OWNER_ID_ALT && id === env.OWNER_ID_ALT);
}
export function ownerConfigured(env) { return !!(env && (env.OWNER_ID || env.OWNER_ID_ALT)); }

export const TERMS_VERSION = "2026-11-05";            // = the date at the top of public/terms.html
export const MAX_SESS = 8;
const PW_ITER = 100000;                                // Cloudflare Workers refuse PBKDF2 above 100 000
const PW_TRIES = 5, PW_WIN = 15 * 60;                  // per account and per IP
const LOGIN_IP_TRIES = 10, LOGIN_ALL_TRIES = 1000, LOGIN_WIN = 15 * 60;   // G-codes (30 bit)
const LINK_TG_TRIES = 5, LINK_ALL_TRIES = 200, LINK_WIN = 10 * 60;        // L-codes (40 bit)
const RESET_TRIES = 5, RESET_WIN = 15 * 60;            // P-codes (40 bit)
const PW_FRESH = 10 * 60;                              // a Google / reset sign-in lets the password be set without the old one
const SEEN_EVERY = 300;                                // session «last seen» is written at most every 5 min
const now = () => Math.floor(Date.now() / 1000);

export const termsV = (env) => (env && env.TERMS_VERSION) || TERMS_VERSION;
export const consentOn = (env) => !(env && env.CONSENT_ENFORCE === "0");

export function hex(bytes) { return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(""); }
function unhex(s) { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; }
export async function sha(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }

// constant time for equal-length strings (hex digests); length mismatch is not secret here
export function ctEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return d === 0;
}

// ---------------------------------------------------------------- sessions
export function sessList(a) {
  let l; try { l = JSON.parse(a.secrets || "[]"); } catch (e) { l = []; }
  if (!Array.isArray(l)) l = [];
  return l.map((x) => (typeof x === "string" ? { h: x, k: "old", c: a.created_at || 0, l: 0 } : x)).filter((x) => x && typeof x.h === "string");
}
export function sessFind(list, h) {          // walks the whole list: the time does not depend on which entry matched
  let idx = -1;
  for (let i = 0; i < list.length; i++) { const m = ctEq(list[i].h, h); if (m && idx < 0) idx = i; }
  return idx;
}
export function cleanLabel(s) {
  if (typeof s !== "string") return null;
  const v = s.replace(/[^\p{L}\p{N} .,·()/_+-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return v || null;
}
export async function devHash(dev) {
  return typeof dev === "string" && /^[0-9a-f]{16,64}$/.test(dev) ? (await sha("dev:" + dev)).slice(0, 20) : null;
}

// ---------------------------------------------------------------- password
const COMMON = new Set(("12345678 123456789 1234567890 12345678910 87654321 11111111 00000000 88888888 12341234 11223344 " +
  "password password1 password123 passw0rd p@ssw0rd qwertyui qwertyuiop qwerty123 qwerty12 1q2w3e4r 1q2w3e4r5t 1qaz2wsx " +
  "zaq12wsx asdfghjk asdfghjkl zxcvbnm1 iloveyou sunshine princess football baseball welcome1 welcome123 admin123 " +
  "letmein1 monkey12 dragon12 trustno1 superman batman12 abc12345 abcd1234 aa123456 qwe12345 q1w2e3r4 123qweasd " +
  "123qwe123 qweasdzxc 1234qwer qwer1234 asdf1234 zxcv1234 minecraft fortnite roblox123 genshin1 crystalrun " +
  "soulofthegate душаврат йцукенгш йцукенгшщз пароль123 пароль12 пароль1234 привет123 qwertyuiop123 " +
  "11111111a 123123123 12121212 69696969 55555555 77777777 99999999 22222222 33333333 44444444 66666666 " +
  "computer internet starwars whatever freedom1 master12 shadow12 michael1 jennifer mustang1 access12 1234abcd").split(/\s+/));
export const PW_ERR = {
  short: "Пароль слишком короткий: нужно хотя бы 8 символов",
  long: "Пароль слишком длинный (больше 128 символов)",
  common: "Этот пароль слишком простой или очень частый. Придумайте другой",
  like_login: "Пароль не должен совпадать с ником или ID",
  wrong: "Неверный ник/ID или пароль",
  old: "Старый пароль не подошёл",
  need_old: "Введите старый пароль (или войдите через Google / получите код сброса в боте /resetpw)",
  rate: "Слишком много попыток. Попробуйте через {0} мин",
  none: "У аккаунта нет пароля",
  code: "Код сброса не найден или устарел. Получите новый в боте: /resetpw",
  bad: "Неверный пароль",
  pt_gone: "Вход устарел. Нажмите «Войти через Google» ещё раз.",
};
export function pwProblem(pw, a) {
  if (typeof pw !== "string") return "short";
  if ([...pw].length < 8) return "short";
  if (pw.length > 128) return "long";
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/u.test(pw)) return "common";
  const digits = "01234567890", abc = "abcdefghijklmnopqrstuvwxyz", kb = "qwertyuiopasdfghjklzxcvbnm";
  for (const seq of [digits, abc, kb, [...digits].reverse().join(""), [...abc].reverse().join("")]) if (seq.includes(low)) return "common";
  if (a && ((a.nick && low.includes(String(a.nick).toLowerCase()) && a.nick.length >= 3 && low.length - a.nick.length < 3) || low === String(a.id))) return "like_login";
  return null;
}
async function pbkdf2(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256);
  return hex(new Uint8Array(bits));
}
export async function pwHash(pw) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { pw: await pbkdf2(pw, salt, PW_ITER), salt, it: PW_ITER };
}
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
export async function pwCheck(a, pw) {      // always derives (unknown account / no password: a dummy) -> same time
  const has = !!(a && a.pw && a.pw_salt);
  const dk = await pbkdf2(typeof pw === "string" ? pw.slice(0, 128) : "", has ? a.pw_salt : DUMMY_SALT, has ? (a.pw_it || PW_ITER) : PW_ITER);
  return has && ctEq(dk, a.pw);
}

// ---------------------------------------------------------------- punishments
export const PUN_TYPES = ["warn", "suspend", "ban", "perm"];
const RANK = { suspend: 1, ban: 2, perm: 3 };
export const GUARD_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS fails (k TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS fails_k ON fails (k, at)",
  `CREATE TABLE IF NOT EXISTS pun (n INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT NOT NULL, type TEXT NOT NULL, reason TEXT,
    at INTEGER NOT NULL, until INTEGER, by TEXT, lifted INTEGER, via TEXT, seen INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS pun_acc ON pun (acc)",
  "CREATE TABLE IF NOT EXISTS links (acc TEXT NOT NULL, k TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (acc, k))",
  "CREATE INDEX IF NOT EXISTS links_k ON links (k)",
];
export const GUARD_COLUMNS = ["pw TEXT", "pw_salt TEXT", "pw_it INTEGER", "pw_at INTEGER", "consent_v TEXT", "consent_at INTEGER",
  "consent_age INTEGER", "last_login TEXT"];

export const pubPun = (p) => (p ? { n: p.n, type: p.type, until: p.until == null ? null : p.until, reason: p.reason || null, at: p.at, evasion: !!p.via } : null);

// what an auth result allows. need: 'online' (raid, season, rankings, daily) | 'acc' (anything on the account)
export function gate(a, need, env) {
  const p = a && a.pun;
  if (p && (p.type === "ban" || p.type === "perm")) return { err: "banned", pun: p };
  if (need === "online" && p && p.type === "suspend") return { err: "suspended", pun: p };
  if (consentOn(env) && a && a.consent_v !== termsV(env)) return { err: "consent", terms_v: termsV(env) };
  return null;
}

// helpers mixed into Accounts (this = the DO)
export const GuardMixin = {
  failN(k, win) { return this.one("SELECT COUNT(*) AS n FROM fails WHERE k = ? AND at > ?", k, now() - win).n; },
  failAdd(...keys) {
    const t = now();
    for (const k of keys) this.sql.exec("INSERT INTO fails (k, at) VALUES (?, ?)", k, t);
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM fails WHERE at < ?", t - 86400);
  },
  failClr(k) { this.sql.exec("DELETE FROM fails WHERE k = ?", k); },
  failRetry(k, win) {
    const r = this.one("SELECT MIN(at) AS a FROM fails WHERE k = ? AND at > ?", k, now() - win);
    return Math.max(1, Math.ceil(((r && r.a ? r.a : now()) + win - now()) / 60));
  },
  link(acc, k) {
    if (!acc || !k) return;
    this.sql.exec("INSERT INTO links (acc, k, at) VALUES (?, ?, ?) ON CONFLICT (acc, k) DO UPDATE SET at = excluded.at", acc, k, now());
  },
  // the active blocking punishment (inherits a linked account's one = ban evasion); null if none
  punFor(accId) {
    const t = now();
    const rows = this.rows("SELECT * FROM pun WHERE acc = ? AND lifted IS NULL AND type IN ('suspend', 'ban', 'perm') AND (until IS NULL OR until > ?)", accId, t);
    if (rows.length) return rows.sort((x, y) => RANK[y.type] - RANK[x.type] || (y.until == null) - (x.until == null) || (y.until || 0) - (x.until || 0))[0];
    const ev = this.one(`SELECT p.*, l2.acc AS src FROM links l1 JOIN links l2 ON l2.k = l1.k AND l2.acc != l1.acc JOIN pun p ON p.acc = l2.acc
      WHERE l1.acc = ? AND p.lifted IS NULL AND p.via IS NULL AND p.type IN ('suspend', 'ban', 'perm') AND (p.until IS NULL OR p.until > ?)
      AND NOT EXISTS (SELECT 1 FROM pun e WHERE e.acc = l1.acc AND e.type = 'exempt' AND e.via = l2.acc AND e.lifted IS NULL)
      ORDER BY CASE p.type WHEN 'perm' THEN 3 WHEN 'ban' THEN 2 ELSE 1 END DESC LIMIT 1`, accId, t);
    if (!ev) return null;
    const reason = "Обход блокировки другого аккаунта" + (ev.reason ? ": " + ev.reason : "");
    this.sql.exec("INSERT INTO pun (acc, type, reason, at, until, by, via) VALUES (?, ?, ?, ?, ?, 'auto', ?)", accId, ev.type, reason.slice(0, 200), t, ev.until, ev.src);
    console.log(`account ${accId}: inherits ${ev.type} of ${ev.src} (shared link)`);
    return this.one("SELECT * FROM pun WHERE acc = ? ORDER BY n DESC LIMIT 1", accId);
  },
  warnsFor(accId) {
    return this.rows("SELECT n, reason, at FROM pun WHERE acc = ? AND type = 'warn' AND seen = 0 AND lifted IS NULL ORDER BY n", accId);
  },
  status(a) {
    return { pun: pubPun(this.punFor(a.id)), warn: this.warnsFor(a.id), consent_v: a.consent_v || null, terms_v: termsV(this.env), pw: !!a.pw };
  },
  // session check for the HTTP ops (/api/v2/acc/*): -> {a, list, idx, h} | null
  async sess(id, secret) {
    const h = typeof secret === "string" && secret.length <= 80 ? await sha(secret) : null;
    const a = this.acc(id);
    if (!a || !h) return null;
    const list = sessList(a), idx = sessFind(list, h);
    return idx < 0 ? null : { a, list, idx, h };
  },
  saveSess(id, list) { this.sql.exec("UPDATE accounts SET secrets = ? WHERE id = ?", JSON.stringify(list.slice(-MAX_SESS)), id); },
  // new device secret (login by code / Google / password / reset). Telegram gets a «new sign-in» note.
  async newSecretK(a, kind, meta = {}) {
    const secret = hex(crypto.getRandomValues(new Uint8Array(16)));
    const fresh = this.acc(a.id) || a;
    const list = sessList(fresh), t = now();
    const d = await devHash(meta.dev), n = cleanLabel(meta.label);
    const h = await sha(secret);
    list.push({ h, k: kind, c: t, l: t, d, n });
    this.saveSess(a.id, list);
    if (d) this.link(a.id, "d:" + d);
    if (kind !== "new") {
      this.sql.exec("UPDATE accounts SET last_login = ? WHERE id = ?", JSON.stringify({ at: t, k: kind, n, d, s: h.slice(0, 8) }), a.id);
      this.notifyLogin(fresh, n, kind);
    }
    return secret;
  },
  notifyLogin(a, label, kind) {
    const env = this.env;
    if (!a || a.tg_id == null || !env || !env.BOT_TOKEN) return;
    const how = { code: "по коду из бота", google: "через Google", pw: "по паролю", reset: "после сброса пароля" }[kind] || "";
    const text = `🔐 Вход в аккаунт${a.nick ? " " + a.nick : ""} с нового устройства${label ? " (" + label + ")" : ""} ${how}, ` +
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC.\nЕсли это были не вы — в игре: Профиль → «Устройства» → " +
      "«Выйти на всех устройствах», затем задайте новый пароль.";
    const base = (env.TG_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
    const p = fetch(`${base}/bot${env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: a.tg_id, text, disable_web_page_preview: true }) }).catch(() => null);
    try { this.ctx.waitUntil(p); } catch (e) { /* not available: fire and forget */ }
  },
  setPw(a, h) { this.sql.exec("UPDATE accounts SET pw = ?, pw_salt = ?, pw_it = ?, pw_at = ? WHERE id = ?", h.pw, h.salt, h.it, now(), a.id); },
};

const pwRate = (self, k) => ({ err: PW_ERR.rate.replace("{0}", self.failRetry(k, PW_WIN)), code: "rate" });

// ---------------------------------------------------------------- ops (this = Accounts DO)
export const GUARD_OPS = {
  // HTTP /api/v2/acc/status: punishment, warnings, consent, «new sign-in» note for this session
  async acc_status({ id, secret }) {
    const s = await this.sess(id, secret); if (!s) return { err: "Аккаунт не найден", code: "auth" };
    const out = this.status(s.a);
    let ll = null; try { ll = s.a.last_login ? JSON.parse(s.a.last_login) : null; } catch (e) { ll = null; }
    const me = s.list[s.idx];
    // another session signed in after this one was created (not this session's own sign-in, not the same device)
    if (ll && ll.at >= (me.c || 0) && ll.s !== String(me.h).slice(0, 8) && (!ll.d || ll.d !== me.d)) out.newdev = { at: ll.at, n: ll.n || null, k: ll.k };
    return { ok: true, ...out };
  },

  async sessions({ id, secret }) {
    const s = await this.sess(id, secret); if (!s) return { err: "Аккаунт не найден", code: "auth" };
    return { ok: true, rows: s.list.map((x, i) => ({ n: x.n || null, k: x.k || "old", c: x.c || null, l: x.l || null, cur: i === s.idx })).reverse() };
  },

  async logout_all({ id, secret }) {
    const s = await this.sess(id, secret); if (!s) return { err: "Аккаунт не найден", code: "auth" };
    const n = s.list.length - 1;
    this.saveSess(s.a.id, [s.list[s.idx]]);
    this.sql.exec("DELETE FROM codes WHERE acc_id = ?", s.a.id);   // pending login / link / reset codes die too
    console.log(`account ${s.a.id}: logout on all other devices (${n})`);
    return { ok: true, removed: n };
  },

  async consent({ id, secret, acc, v, terms, privacy, age }) {
    let a;
    if (acc) a = this.acc(acc);                       // internal (acc_new with consent)
    else { const s = await this.sess(id, secret); a = s && s.a; }
    if (!a) return { err: "Аккаунт не найден", code: "auth" };
    if (v !== termsV(this.env)) return { err: "Условия обновились. Откройте окно согласия ещё раз", code: "version", terms_v: termsV(this.env) };
    if (terms !== true || privacy !== true || age !== true) return { err: "Нужно отметить все три пункта", code: "boxes" };
    this.sql.exec("UPDATE accounts SET consent_v = ?, consent_at = ?, consent_age = 1 WHERE id = ?", v, now(), a.id);
    console.log(`account ${a.id}: consent ${v}`);
    return { ok: true, consent_v: v, at: now() };
  },

  async warn_ack({ id, secret }) {
    const s = await this.sess(id, secret); if (!s) return { err: "Аккаунт не найден", code: "auth" };
    this.sql.exec("UPDATE pun SET seen = 1 WHERE acc = ? AND type = 'warn' AND seen = 0", s.a.id);
    return { ok: true };
  },

  // ---- password
  async pw_set({ id, secret, old, pw, ip }) {
    const s = await this.sess(id, secret); if (!s) return { err: "Аккаунт не найден", code: "auth" };
    const a = s.a, me = s.list[s.idx], ka = "pw:acc:" + a.id, ki = "pw:ip:" + (ip || "?");
    const bad = pwProblem(pw, a); if (bad) return { err: PW_ERR[bad], code: bad };
    const fresh = (me.k === "google" || me.k === "reset") && now() - (me.c || 0) < PW_FRESH;
    if (a.pw && !fresh) {
      if (typeof old !== "string" || !old) return { err: PW_ERR.need_old, code: "need_old" };
      if (this.failN(ka, PW_WIN) >= PW_TRIES) return pwRate(this, ka);
      if (this.failN(ki, PW_WIN) >= PW_TRIES) return pwRate(this, ki);
      const ok = await pwCheck(this.acc(a.id), old);
      if (!ok) { this.failAdd(ka, ki); return { err: PW_ERR.old, code: "old" }; }
    }
    const h = await pwHash(pw);
    this.setPw(a, h);
    this.saveSess(a.id, [{ ...me }]);                        // every other device is signed out
    this.failClr(ka);
    console.log(`account ${a.id}: password ${a.pw ? "changed" : "set"}; other sessions closed (${s.list.length - 1})`);
    return { ok: true, removed: s.list.length - 1 };
  },

  // sign in on a new device: login = 12-hex account id or the nickname
  async pw_login({ login, pw, ip, dev, label }) {
    const ki = "pw:ip:" + (ip || "?");
    if (this.failN(ki, PW_WIN) >= PW_TRIES) return pwRate(this, ki);
    const lg = typeof login === "string" ? login.trim().slice(0, 32) : "";
    const a = /^[0-9a-f]{12}$/i.test(lg) ? this.acc(lg.toLowerCase()) : lg ? this.one("SELECT * FROM accounts WHERE nick_lc = ?", lg.toLowerCase()) : null;
    const ka = "pw:acc:" + (a ? a.id : "nick:" + lg.toLowerCase());
    if (this.failN(ka, PW_WIN) >= PW_TRIES) return pwRate(this, ka);
    const ok = await pwCheck(a, pw);
    if (!ok) { this.failAdd(ka, ki); return { err: PW_ERR.wrong, code: "wrong" }; }
    this.failClr(ka);
    const secret = await this.newSecretK(a, "pw", { dev, label });
    console.log(`account ${a.id}: signed in with the password on a new device`);
    const fresh = this.acc(a.id);
    return this.pub(fresh, { secret, ...this.status(fresh) });
  },

  // 2.3.7 «Войти через Google» -> password step on a new device: pt = the one-time token from google_poll{pw_need}.
  // Same budget as the password sign-in (5 wrong / 15 min per account and per IP), PBKDF2 + constant-time compare;
  // the token is spent only by the right password (or when it expires). The password is never logged.
  async google_pw({ pt, pw, ip, dev, label }) {
    const ki = "pw:ip:" + (ip || "?");
    const h = typeof pt === "string" && /^[0-9a-f]{32}$/.test(pt) ? "Q:" + await sha(pt) : null;
    if (this.failN(ki, PW_WIN) >= PW_TRIES) return pwRate(this, ki);
    const row = h ? this.one("SELECT * FROM codes WHERE key = ?", h) : null;
    const a = row && row.expires >= now() ? this.acc(row.acc_id) : null;
    if (!a) { if (row) this.sql.exec("DELETE FROM codes WHERE key = ?", h); return { err: PW_ERR.pt_gone, code: "gone" }; }
    const ka = "pw:acc:" + a.id;
    if (this.failN(ka, PW_WIN) >= PW_TRIES) return pwRate(this, ka);
    const ok = await pwCheck(a, pw);                         // always derives (no password any more: a dummy, then allowed)
    if (!ok && a.pw) {
      this.failAdd(ka, ki);
      const left = Math.max(0, PW_TRIES - this.failN(ka, PW_WIN));
      return left ? { err: `${PW_ERR.bad}. Осталось попыток: ${left}`, code: "wrong", left } : pwRate(this, ka);
    }
    if (!this.one("SELECT key FROM codes WHERE key = ?", h)) return { err: PW_ERR.pt_gone, code: "gone" };   // one time (after the await)
    this.sql.exec("DELETE FROM codes WHERE key = ?", h);
    this.failClr(ka);
    const secret = await this.newSecretK(a, "google", { dev, label });
    console.log(`account ${a.id}: google sign-in + password on a new device`);
    const fresh = this.acc(a.id);
    return this.pub(fresh, { mode: "signin", fresh: true, secret, ...this.status(fresh) });
  },

  // bot /resetpw (Telegram linked to the account = proof of ownership)
  pw_reset_code({ tg_id }) {
    const a = this.one("SELECT * FROM accounts WHERE tg_id = ?", tg_id);
    if (!a) return { err: "К этому Telegram не привязан аккаунт." };
    return { ok: true, code: this.makeCode("P", 8, a.id), nick: a.nick || null, id: a.id };
  },

  // game: «Сбросить пароль» with the P-code -> new password, every old session closed, this device signed in
  async pw_reset({ code, pw, ip, dev, label }) {
    const ki = "rs:ip:" + (ip || "?");
    if (this.failN(ki, RESET_WIN) >= RESET_TRIES || this.failN("rs:all", RESET_WIN) >= 300) return pwRate(this, ki);
    const c = cleanCodeP(code);
    const accId = c ? this.peekCode("P", c) : null;
    const a = accId ? this.acc(accId) : null;
    if (!a) { this.failAdd(ki, "rs:all"); return { err: PW_ERR.code, code: "code" }; }
    const bad = pwProblem(pw, a); if (bad) return { err: PW_ERR[bad], code: bad };   // the code stays valid for a better password
    this.takeCode("P", c);
    this.setPw(a, await pwHash(pw));
    this.saveSess(a.id, []);
    const secret = await this.newSecretK(this.acc(a.id), "reset", { dev, label });
    this.failClr("pw:acc:" + a.id);
    console.log(`account ${a.id}: password reset with a bot code; all sessions closed`);
    const fresh = this.acc(a.id);
    return this.pub(fresh, { secret, ...this.status(fresh) });
  },

  pw_clear({ to }) {
    const a = this.acc(to); if (!a) return { err: "not_found" };
    this.sql.exec("UPDATE accounts SET pw = NULL, pw_salt = NULL, pw_it = NULL, pw_at = NULL WHERE id = ?", a.id);
    return { ok: true, to: a.id };
  },

  // ---- punishments (god panel via Online; bot /appeal)
  pun_set({ to, type, until, reason, by }) {
    const a = this.acc(to); if (!a) return { err: "not_found" };
    if (!PUN_TYPES.includes(type)) return { err: "bad_type" };
    const t = now();
    let u = null;
    if (type === "suspend" || type === "ban") {
      if (!Number.isInteger(until) || until <= t || until > t + 3650 * 86400) return { err: "bad_until" };
      u = until;
    }
    const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : null;
    this.sql.exec("INSERT INTO pun (acc, type, reason, at, until, by) VALUES (?, ?, ?, ?, ?, ?)", a.id, type, why, t, u, typeof by === "string" ? by.slice(0, 20) : null);
    const p = this.one("SELECT * FROM pun WHERE acc = ? ORDER BY n DESC LIMIT 1", a.id);
    console.log(`account ${a.id}: punishment ${type}${u ? " until " + u : ""}`);
    return { ok: true, to: a.id, pun: pubPun(p), active: pubPun(this.punFor(a.id)) };
  },

  pun_lift({ to }) {
    const a = this.acc(to); if (!a) return { err: "not_found" };
    const rows = this.rows("SELECT * FROM pun WHERE acc = ? AND lifted IS NULL AND type != 'exempt'", a.id);
    const t = now();
    this.sql.exec("UPDATE pun SET lifted = ? WHERE acc = ? AND lifted IS NULL AND type != 'exempt'", t, a.id);
    for (const r of rows) if (r.via) this.sql.exec("INSERT INTO pun (acc, type, reason, at, by, via) VALUES (?, 'exempt', 'проверено владельцем', ?, 'god', ?)", a.id, t, r.via);
    console.log(`account ${a.id}: punishments lifted (${rows.length})`);
    return { ok: true, to: a.id, lifted: rows.length };
  },

  // accounts that share a Telegram / Google / device link with <to>
  linked({ to }) {
    const rows = this.rows("SELECT l2.acc AS acc, l1.k AS k FROM links l1 JOIN links l2 ON l2.k = l1.k AND l2.acc != l1.acc WHERE l1.acc = ? LIMIT 100", to);
    const by = {};
    for (const r of rows) (by[r.acc] = by[r.acc] || []).push(r.k.split(":")[0]);
    return { ok: true, rows: Object.keys(by).map((acc) => ({ acc, nick: (this.acc(acc) || {}).nick || null, via: [...new Set(by[acc])] })) };
  },

  // ban evasion confirmed by the owner: permanent ban of <to> and every linked account
  pun_evasion({ to, reason, by }) {
    const a = this.acc(to); if (!a) return { err: "not_found" };
    const ids = [a.id, ...GUARD_OPS.linked.call(this, { to: a.id }).rows.map((r) => r.acc)];
    const why = ("Обход бана" + (typeof reason === "string" && reason.trim() ? ": " + reason.trim() : "")).slice(0, 200);
    const t = now();
    for (const id of ids) {
      if (isOwnerId(this.env, id)) continue;
      this.sql.exec("INSERT INTO pun (acc, type, reason, at, by) VALUES (?, 'perm', ?, ?, ?)", id, why, t, typeof by === "string" ? by.slice(0, 20) : null);
    }
    console.log(`evasion: perm ban for ${ids.join(", ")}`);
    return { ok: true, banned: ids.filter((id) => !isOwnerId(this.env, id)) };
  },

  pun_get({ to, tg_id }) {
    const a = to ? this.acc(to) : tg_id != null ? this.one("SELECT * FROM accounts WHERE tg_id = ?", tg_id) : null;
    if (!a) return { err: "not_found" };
    const hist = this.rows("SELECT n, type, reason, at, until, by, lifted, via FROM pun WHERE acc = ? ORDER BY n DESC LIMIT 30", a.id);
    return { ok: true, id: a.id, nick: a.nick || null, active: pubPun(this.punFor(a.id)), hist, pw: !!a.pw, consent_v: a.consent_v || null,
      consent_at: a.consent_at || null, sessions: sessList(a).length, linked: GUARD_OPS.linked.call(this, { to: a.id }).rows };
  },
  // raid3 weekly fund (Online DO, internal): which of these accounts have an active punishment (suspend / ban / perm) now
  pun_many({ ids }) {
    const out = {};
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 5000)) if (typeof id === "string" && /^[0-9a-f]{12}$/.test(id)) out[id] = !!this.punFor(id);
    return { ok: true, pun: out };
  },
};

function cleanCodeP(raw) {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (typeof raw !== "string" || raw.length > 40) return null;
  let s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (s.length === 9 && s[0] === "P") s = s.slice(1);
  return s.length === 8 && [...s].every((ch) => ALPHA.includes(ch)) ? s : null;
}
