// site.js — the official website of «Soul of the Gate / Душа Врат» (by fo4si) inside this worker.
//
//  Pages (one shell, public/site/index.html; client routing in public/site/site.js):
//    /  /chapters  /download  /news  /login  /account  /dev            (the web game itself moved to /play)
//  HTTP API (JSON; every write needs the header  x-sotg: 1  and a same-origin Origin):
//    GET  /site/api/me                      -> {ok, user: null | {id4, nick, owner}}, google: bool
//    POST /site/api/login  {kind:"session", id, secret}  the account of the web game in this browser (localStorage)
//                          {kind:"pw", login, pw}        nickname / ID + the account password (accounts_guard pw_login)
//                          {kind:"code", code}           G-XXXXXX from the bot (/login)
//                          {kind:"gpw", pw}              password step after «Войти через Google» (account has a password)
//    POST /site/api/logout
//    GET  /site/auth/google                 -> 302 Google (state "w…" + cookie); back via /auth/google/callback (index.js)
//    GET  /site/api/files                   -> published files (+ the built-in /CrystalRun.apk as Chapter 1 · Android)
//    POST /site/api/buy/:id                 -> payment hook (startCheckout); not connected yet -> 503 {code:"soon"}
//    GET  /dl/:id[/name]                    -> stream the file (paid: only with a purchase; the owner always)
//  Developer cabinet (OWNER ONLY, checked here on the server: isOwnerId on a re-verified account session):
//    GET    /site/api/dev/files
//    POST   /site/api/dev/files              {title, game, chapter, platform, version, notes, paid, price, filename, ctype, size}
//    PUT    /site/api/dev/files/:id/chunk/:n raw bytes (CHUNK bytes, the last one shorter), header x-chunk-sha256
//    POST   /site/api/dev/files/:id/finish
//    PATCH  /site/api/dev/files/:id         {title, game, chapter, platform, version, notes, paid, price, published}
//    DELETE /site/api/dev/files/:id
//
//  Storage: Durable Object «Site» (SQLite, Free plan): files are split into 1 MiB chunks (a SQLite row / value must stay < 2 MB),
//  metadata in `files`, purchases in `purchases` (stub until payments are connected), site sessions in `sess`.
//  A site session keeps the account session it was made from and re-checks it (Accounts «auth») on every request, so
//  «Выйти на всех устройствах» in the game also signs the website out.

import { accCall } from "./accounts.js";
import { isOwnerId, sha, hex, cleanLabel } from "./accounts_guard.js";
import { AUTH_URL, challenge, exchange, googleConfigured, redirectUri } from "./google.js";

export const CHUNK = 1024 * 1024;                 // 1 MiB per SQLite row
export const MAX_FILE = 200 * 1024 * 1024;        // 200 MB per file (chunked; each request is one chunk)
const MAX_FILES = 200;
const SESS_TTL = 30 * 24 * 3600;                  // site session: 30 days
const GSTATE_TTL = 600;                           // Google web state: 10 min
const PEND_TTL = 300;                             // Google -> password step: 5 min
const UPLOAD_TTL = 24 * 3600;                     // an unfinished upload is dropped after a day
const PLATFORMS = ["android", "pc", "other"];
const SITE_LABEL = "Сайт";
export const WEB_STATE_RE = /^w[0-9a-f]{40}$/;
const ID_RE = /^[0-9a-f]{16}$/;
const C_SESS = "sotg_s", C_GST = "sotg_g", C_PEND = "sotg_p";
const now = () => Math.floor(Date.now() / 1000);
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

// ------------------------------------------------------------------ payments hook (not connected yet)
// When Google Pay / Monobank is connected: return {url} (a checkout page) for {file, buyer}; the provider's webhook then calls
// siteCall(env, "purchase_add", {buyer, file_id, src, ref}) — the download endpoint already honours `purchases`.
export function paymentsConfigured(env) { return !!(env && env.PAY_PROVIDER); }
async function startCheckout(env, file, buyer) {    // eslint-disable-line no-unused-vars
  return null;                                     // TODO(payments): monobank / Google Pay checkout
}

// ------------------------------------------------------------------ helpers
const J = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
});
function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(url, name, value, maxAge, path = "/") {
  const sec = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${sec}`;
}
const ipOf = (request) => request.headers.get("CF-Connecting-IP") || "local";
function sameOrigin(request, url, env) {
  if (request.headers.get("x-sotg") !== "1") return false;          // custom header: a cross-site form / simple request can't send it
  const o = request.headers.get("Origin");
  if (o && o !== url.origin && !(env.PUBLIC_ORIGIN && o === String(env.PUBLIC_ORIGIN).replace(/\/+$/, ""))) return false;
  const sfs = request.headers.get("Sec-Fetch-Site");
  return !sfs || sfs === "same-origin" || sfs === "none";
}
export function siteStub(env) { return env.SITE.get(env.SITE.idFromName("site")); }
export async function siteCall(env, op, body) {
  const r = await siteStub(env).fetch(`https://site/${op}`, { method: "POST", body: JSON.stringify(body || {}) });
  return r.json();
}
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanNotes(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, 2000);
}
function safeName(v) {
  const s = typeof v === "string" ? v.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return s && s !== "." && s !== ".." ? s : "file.bin";
}
function guessType(name, given) {
  const n = name.toLowerCase();
  if (n.endsWith(".apk")) return "application/vnd.android.package-archive";
  if (n.endsWith(".zip")) return "application/zip";
  if (n.endsWith(".exe") || n.endsWith(".msi")) return "application/octet-stream";
  if (n.endsWith(".7z")) return "application/x-7z-compressed";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".txt")) return "text/plain; charset=utf-8";
  return typeof given === "string" && /^[a-z]+\/[a-z0-9.+-]{1,80}$/i.test(given) && !/html|xml|javascript|svg/i.test(given)
    ? given : "application/octet-stream";
}
function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
// file metadata from the dev form (create / patch)
function cleanMeta(b, partial) {
  const m = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
  if (has("title")) m.title = cleanText(b.title, 100) || "Без названия";
  if (has("game")) m.game = cleanText(b.game, 60) || "Soul of the Gate";
  if (has("chapter")) { const c = Number(b.chapter); m.chapter = Number.isInteger(c) && c >= 0 && c <= 99 ? c : 0; }
  if (has("platform")) m.platform = PLATFORMS.includes(b.platform) ? b.platform : "other";
  if (has("version")) m.version = cleanText(b.version, 30);
  if (has("notes")) m.notes = cleanNotes(b.notes);
  if (has("paid")) m.paid = b.paid ? 1 : 0;
  if (has("price")) { const p = Math.round(Number(b.price)); m.price = Number.isFinite(p) && p >= 0 && p <= 100000 ? p : 0; }
  if (has("published") && partial) m.published = b.published ? 1 : 0;
  return m;
}

// ------------------------------------------------------------------ who is signed in (worker side)
// -> {sid, acc: {id, nick, ...}, owner} | null. The account session is re-checked with Accounts every time.
async function whoAmI(request, env) {
  const tok = cookies(request)[C_SESS];
  if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
  const s = await siteCall(env, "sess_get", { h: await sha(tok) });
  if (!s || !s.ok) return null;
  const a = await accCall(env, "auth", { id: s.acc_id, secret: s.secret });
  if (!a || !a.ok) { await siteCall(env, "sess_del", { h: await sha(tok) }); return null; }
  return { h: await sha(tok), acc: a, owner: isOwnerId(env, a.id) };
}
const pubUser = (w) => w ? { id4: String(w.acc.id).slice(-4), nick: w.acc.nick || null, owner: !!w.owner } : null;

async function newSession(env, url, acc, kind) {
  const tok = rnd(32);
  await siteCall(env, "sess_new", { h: await sha(tok), acc_id: acc.id, secret: acc.secret, kind });
  return setCookie(url, C_SESS, tok, SESS_TTL);
}

// ------------------------------------------------------------------ HTTP entry (index.js)
export async function handleSite(request, env) {
  const url = new URL(request.url);
  const p = url.pathname, m = request.method;
  if (!env.SITE) return J({ err: "Сайт не настроен" }, 503);
  try {
    if (p === "/auth/google/callback") return await googleCallback(request, env, url);
    if (p === "/site/auth/google") return await googleStart(request, env, url);
    if (p.startsWith("/dl/")) return await download(request, env, url);
    if (!p.startsWith("/site/api/")) return J({ err: "not found" }, 404);
    const r = p.slice("/site/api/".length);
    const write = m !== "GET" && m !== "HEAD";
    if (write && !sameOrigin(request, url, env)) return J({ err: "Запрос отклонён", code: "origin" }, 403);

    if (r === "me" && m === "GET") {
      const w = await whoAmI(request, env);
      return J({ ok: true, user: pubUser(w), google: googleConfigured(env), pay: paymentsConfigured(env) });
    }
    if (r === "login" && m === "POST") return await login(request, env, url);
    if (r === "logout" && m === "POST") {
      const tok = cookies(request)[C_SESS];
      if (tok && /^[0-9a-f]{64}$/.test(tok)) await siteCall(env, "sess_del", { h: await sha(tok) });
      return J({ ok: true }, 200, { "set-cookie": setCookie(url, C_SESS, "", 0) });
    }
    if (r === "files" && m === "GET") return await publicFiles(env, url);
    let mm;
    if ((mm = /^buy\/([0-9a-z-]{1,40})$/.exec(r)) && m === "POST") {
      const w = await whoAmI(request, env);
      const f = await siteCall(env, "file_get", { id: mm[1] });
      if (!f.ok || !f.file.published || !f.file.paid) return J({ err: "Файл не найден" }, 404);
      if (!w) return J({ err: "Сначала войдите", code: "auth" }, 401);
      const co = paymentsConfigured(env) ? await startCheckout(env, f.file, w.acc.id) : null;
      if (!co) return J({ err: "Оплата скоро появится", code: "soon" }, 503);
      return J({ ok: true, url: co.url });
    }
    if (r.startsWith("dev/")) {
      const w = await whoAmI(request, env);
      if (!w) return J({ err: "Сначала войдите", code: "auth" }, 401);
      if (!w.owner) return J({ err: "Только для разработчика", code: "forbidden" }, 403);
      return await dev(request, env, url, r.slice(4), m);
    }
    return J({ err: "not found" }, 404);
  } catch (e) {
    console.log(`site error: ${e && e.stack ? e.stack : e}`);
    return J({ err: "Ошибка сервера" }, 500);
  }
}

async function readJson(request, max = 8192) {
  const t = await request.text();
  if (t.length > max) return null;
  try { const o = JSON.parse(t); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
}

async function login(request, env, url) {
  const b = await readJson(request);
  if (!b) return J({ err: "Неверный запрос" }, 400);
  const ip = ipOf(request), label = cleanLabel(SITE_LABEL);
  let res, kind = b.kind, clearPend = false;
  if (kind === "session") {
    if (typeof b.id !== "string" || typeof b.secret !== "string" || b.id.length > 40 || b.secret.length > 80) return J({ err: "Аккаунт не найден" }, 400);
    res = await accCall(env, "auth", { id: b.id, secret: b.secret });
    if (res && res.ok) res.secret = b.secret;      // the same account session as the game in this browser
  } else if (kind === "pw") {
    res = await accCall(env, "pw_login", { login: String(b.login || "").slice(0, 32), pw: String(b.pw || "").slice(0, 200), ip, label });
  } else if (kind === "code") {
    res = await accCall(env, "login", { code: String(b.code || "").slice(0, 20), ip, label });
  } else if (kind === "gpw") {
    const pt = cookies(request)[C_PEND];
    const pend = pt && /^[0-9a-f]{64}$/.test(pt) ? await siteCall(env, "pend_get", { h: await sha(pt) }) : null;
    if (!pend || !pend.ok) return J({ err: "Вход через Google устарел. Нажмите «Войти через Google» ещё раз.", code: "gone" }, 400);
    res = await accCall(env, "pw_login", { login: pend.acc_id, pw: String(b.pw || "").slice(0, 200), ip, label });
    if (res && res.ok) { await siteCall(env, "pend_del", { h: await sha(pt) }); clearPend = true; }
  } else return J({ err: "Неверный запрос" }, 400);
  if (!res || !res.ok || !res.secret) return J({ err: (res && res.err) || "Не получилось войти", code: (res && res.code) || "fail" }, 401);
  const headers = new Headers({ "set-cookie": await newSession(env, url, res, kind) });
  if (clearPend) headers.append("set-cookie", setCookie(url, C_PEND, "", 0));
  const owner = isOwnerId(env, res.id);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify({ ok: true, user: { id4: res.id.slice(-4), nick: res.nick || null, owner } }), { headers });
}

// ---- Google on the website: our own state ("w" + 40 hex) through the SAME registered callback /auth/google/callback
async function googleStart(request, env, url) {
  if (!googleConfigured(env)) return Response.redirect(new URL("/login?err=google_off", url).toString(), 302);
  const state = "w" + rnd(20), verifier = rnd(32);
  await siteCall(env, "gst_new", { id: state, verifier });
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, url), response_type: "code", scope: "openid email profile",
    state, code_challenge: await challenge(verifier), code_challenge_method: "S256", prompt: "select_account", access_type: "online",
  });
  return new Response(null, { status: 302, headers: { location: `${AUTH_URL}?${q}`, "cache-control": "no-store", "referrer-policy": "no-referrer",
    "set-cookie": setCookie(url, C_GST, state, GSTATE_TTL, "/auth/google") } });
}

async function googleCallback(request, env, url) {
  const back = (q, cookieList = []) => {
    const h = new Headers({ location: new URL(q, url).toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    h.append("set-cookie", setCookie(url, C_GST, "", 0, "/auth/google"));
    for (const c of cookieList) h.append("set-cookie", c);
    return new Response(null, { status: 302, headers: h });
  };
  const state = url.searchParams.get("state") || "";
  if (!WEB_STATE_RE.test(state) || !googleConfigured(env)) return back("/login?err=google_gone");
  if (cookies(request)[C_GST] !== state) return back("/login?err=google_gone");   // the flow must finish in the browser that began it
  const st = await siteCall(env, "gst_take", { id: state });
  if (!st.ok) return back("/login?err=google_gone");
  if (url.searchParams.get("error")) return back("/login?err=google_denied");
  const code = url.searchParams.get("code") || "";
  if (!code || code.length > 2048) return back("/login?err=google_gone");
  const who = await exchange(env, url, code, st.verifier);
  if (!who) return back("/login?err=google_token");
  const res = await accCall(env, "web_google", { sub: who.sub, email: who.email, label: SITE_LABEL });
  if (res && res.ok && res.pw_need) {
    const pt = rnd(32);
    await siteCall(env, "pend_new", { h: await sha(pt), acc_id: res.id });
    return back("/login?step=pw", [setCookie(url, C_PEND, pt, PEND_TTL)]);
  }
  if (!res || !res.ok || !res.secret) return back("/login?err=" + (res && res.code === "nolink" ? "google_nolink" : "google_fail"));
  return back(isOwnerId(env, res.id) ? "/dev" : "/account", [await newSession(env, url, res, "google")]);
}

// ---- files
function builtinApk(size) {
  return { id: "builtin-apk", builtin: true, title: "Soul of the Gate — Глава 1", game: "Soul of the Gate", chapter: 1, platform: "android",
    version: null, notes: "", filename: "CrystalRun.apk", size: size || null, paid: 0, price: 0, created_at: null, url: "/CrystalRun.apk" };
}
const pubFile = (f) => ({ id: f.id, title: f.title, game: f.game, chapter: f.chapter, platform: f.platform, version: f.version || null,
  notes: f.notes || "", filename: f.filename, size: f.size, paid: f.paid, price: f.price, created_at: f.created_at,
  url: `/dl/${f.id}/${encodeURIComponent(f.filename)}` });

async function apkSize(env, url) {
  if (!env.ASSETS) return null;
  try {
    // the size is written next to the news at build time (site_news.mjs); the asset server does not always send Content-Length
    const r = await env.ASSETS.fetch(new Request(new URL("/site/news.json", url)));
    const j = r.ok ? await r.json() : null;
    const n = Number(j && j.apk && j.apk.size);
    return n > 0 ? n : null;
  } catch (e) { return null; }
}

async function publicFiles(env, url) {
  const res = await siteCall(env, "files_list", { all: false });
  const files = (res.files || []).map(pubFile);
  // the APK shipped with the worker is Chapter 1 · Android until the developer publishes his own free Chapter 1 Android file
  const own = files.some((f) => f.chapter === 1 && f.platform === "android" && !f.paid && /soul of the gate|душа врат/i.test(f.game));
  if (!own) files.unshift({ ...builtinApk(await apkSize(env, url)), version: env.SITE_APK_VERSION || null });
  return J({ ok: true, files }, 200, { "cache-control": "public, max-age=30" });
}

async function download(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const mm = /^\/dl\/([0-9a-f]{16})(?:\/[^/]*)?$/.exec(url.pathname);
  if (!mm) return new Response("Not found", { status: 404 });
  const f = await siteCall(env, "file_get", { id: mm[1] });
  if (!f.ok || f.file.status !== "ready") return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const file = f.file;
  let w = null;
  if (!file.published || file.paid) w = await whoAmI(request, env);
  const owner = !!(w && w.owner);
  if (!file.published && !owner) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (file.paid && !owner) {
    const bought = w ? await siteCall(env, "purchase_has", { buyer: w.acc.id, file_id: file.id }) : null;
    if (!bought || !bought.ok) {
      return J({ err: w ? "Этот файл платный — сначала купите его" : "Этот файл платный — войдите и купите его", code: "paid" }, w ? 402 : 401);
    }
  }
  const r = await siteStub(env).fetch(`https://site/stream?id=${file.id}`, { method: request.method });
  const h = new Headers(r.headers);
  h.set("content-type", file.ctype);
  h.set("content-disposition", contentDisposition(file.filename));
  h.set("content-length", String(file.size));
  h.set("cache-control", file.paid || !file.published ? "private, no-store" : "public, max-age=300");
  h.set("x-content-type-options", "nosniff");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: h });
  if (file.published && !owner) await siteCall(env, "dl_count", { id: file.id }).catch(() => null);
  // FixedLengthStream: the browser gets a real Content-Length (download progress), not a chunked body
  const { readable, writable } = new FixedLengthStream(file.size);
  r.body.pipeTo(writable).catch((e) => console.log(`site download ${file.id} cut: ${e}`));
  return new Response(readable, { status: 200, headers: h });
}

// ---- developer cabinet (the caller is the owner — checked in handleSite)
async function dev(request, env, url, r, m) {
  let mm;
  if (r === "files" && m === "GET") return J(await siteCall(env, "files_list", { all: true }));
  if (r === "files" && m === "POST") {
    const b = await readJson(request);
    if (!b) return J({ err: "Неверный запрос" }, 400);
    const size = Number(b.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE) return J({ err: `Размер файла: от 1 байта до ${MAX_FILE / 1048576} МБ` }, 400);
    const filename = safeName(b.filename);
    const meta = { ...cleanMeta(b, false), filename, ctype: guessType(filename, b.ctype), size };
    return J(await siteCall(env, "file_new", meta));
  }
  if ((mm = /^files\/([0-9a-f]{16})\/chunk\/(\d{1,4})$/.exec(r)) && m === "PUT") {
    const len = Number(request.headers.get("content-length"));
    if (!Number.isInteger(len) || len <= 0 || len > CHUNK) return J({ err: "Неверный кусок файла" }, 400);
    const want = request.headers.get("x-chunk-sha256") || "";
    if (!/^[0-9a-f]{64}$/.test(want)) return J({ err: "Нет контрольной суммы куска" }, 400);
    const buf = await request.arrayBuffer();           // ≤ 1 MiB; a plain buffer to the object (no half-read stream on a refusal)
    if (buf.byteLength !== len) return J({ err: "Неверный кусок файла" }, 400);
    const res = await siteStub(env).fetch(`https://site/chunk?id=${mm[1]}&n=${mm[2]}&sha=${want}`, { method: "PUT", body: buf });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if ((mm = /^files\/([0-9a-f]{16})\/finish$/.exec(r)) && m === "POST") return J(await siteCall(env, "file_finish", { id: mm[1] }));
  if ((mm = /^files\/([0-9a-f]{16})$/.exec(r)) && m === "PATCH") {
    const b = await readJson(request);
    if (!b) return J({ err: "Неверный запрос" }, 400);
    return J(await siteCall(env, "file_patch", { id: mm[1], meta: cleanMeta(b, true) }));
  }
  if ((mm = /^files\/([0-9a-f]{16})$/.exec(r)) && m === "DELETE") return J(await siteCall(env, "file_del", { id: mm[1] }));
  return J({ err: "not found" }, 404);
}

// ------------------------------------------------------------------ Durable Object
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, title TEXT NOT NULL, game TEXT NOT NULL, chapter INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL, version TEXT, notes TEXT, filename TEXT NOT NULL, ctype TEXT NOT NULL, size INTEGER NOT NULL,
    nchunks INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploading', downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chunks (file_id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file_id, n))`,
  // stub until payments are connected: a row = this buyer (account id) may download this paid file
  `CREATE TABLE IF NOT EXISTS purchases (buyer TEXT NOT NULL, file_id TEXT NOT NULL, at INTEGER NOT NULL, src TEXT, ref TEXT,
    PRIMARY KEY (buyer, file_id))`,
  `CREATE TABLE IF NOT EXISTS sess (h TEXT PRIMARY KEY, acc_id TEXT NOT NULL, secret TEXT NOT NULL, kind TEXT, created INTEGER NOT NULL,
    expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gst (id TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pend (h TEXT PRIMARY KEY, acc_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
];

export class Site {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
  }
  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.rows(q, ...b)[0] || null; }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    try {
      if (op === "chunk" && request.method === "PUT") return await this.putChunk(url, request);
      if (op === "stream") return this.stream(url);
      const fn = Object.prototype.hasOwnProperty.call(SITE_OPS, op) ? SITE_OPS[op] : null;
      if (!fn) return Response.json({ err: "unknown op" }, { status: 404 });
      return Response.json(await fn.call(this, (await request.json()) || {}));
    } catch (e) {
      console.log(`site ${op} error: ${e && e.stack ? e.stack : e}`);
      return Response.json({ err: "Ошибка сервера" }, { status: 500 });
    }
  }

  gc() {
    const t = now();
    this.sql.exec("DELETE FROM sess WHERE expires < ?", t);
    this.sql.exec("DELETE FROM gst WHERE expires < ?", t);
    this.sql.exec("DELETE FROM pend WHERE expires < ?", t);
    for (const f of this.rows("SELECT id FROM files WHERE status = 'uploading' AND updated_at < ?", t - UPLOAD_TTL)) this.drop(f.id);
  }
  drop(id) {
    this.sql.exec("DELETE FROM chunks WHERE file_id = ?", id);
    this.sql.exec("DELETE FROM files WHERE id = ?", id);
  }

  async putChunk(url, request) {
    const id = url.searchParams.get("id") || "", n = Number(url.searchParams.get("n")), want = url.searchParams.get("sha") || "";
    const buf = new Uint8Array(await request.arrayBuffer());
    const f = ID_RE.test(id) ? this.one("SELECT * FROM files WHERE id = ?", id) : null;
    if (!f) return Response.json({ err: "Файл не найден" }, { status: 404 });
    if (f.status !== "uploading") return Response.json({ err: "Файл уже загружен" }, { status: 409 });
    if (!Number.isInteger(n) || n < 0 || n >= f.nchunks) return Response.json({ err: "Неверный номер куска" }, { status: 400 });
    const expect = n === f.nchunks - 1 ? f.size - CHUNK * (f.nchunks - 1) : CHUNK;
    if (buf.byteLength !== expect) return Response.json({ err: `Кусок ${n}: ${buf.byteLength} байт, ждали ${expect}` }, { status: 400 });
    const got = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
    if (got !== want) return Response.json({ err: `Кусок ${n} повреждён при передаче (контрольная сумма)`, code: "sha" }, { status: 400 });
    this.sql.exec("INSERT INTO chunks (file_id, n, data) VALUES (?, ?, ?) ON CONFLICT (file_id, n) DO UPDATE SET data = excluded.data",
      id, n, buf.buffer);
    this.sql.exec("UPDATE files SET updated_at = ? WHERE id = ?", now(), id);
    return Response.json({ ok: true, n });
  }

  stream(url) {
    const id = url.searchParams.get("id") || "";
    const f = ID_RE.test(id) ? this.one("SELECT id, nchunks, size FROM files WHERE id = ? AND status = 'ready'", id) : null;
    if (!f) return new Response("Not found", { status: 404 });
    let n = 0;
    const self = this;
    const body = new ReadableStream({
      pull(ctrl) {
        if (n >= f.nchunks) { ctrl.close(); return; }
        const row = self.one("SELECT data FROM chunks WHERE file_id = ? AND n = ?", f.id, n);
        n++;
        if (!row) { ctrl.error(new Error("chunk missing")); return; }
        ctrl.enqueue(new Uint8Array(row.data));
      },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { "content-length": String(f.size) } });
  }
}

const SITE_OPS = {
  // sessions
  sess_new({ h, acc_id, secret, kind }) {
    this.gc();
    const t = now();
    this.sql.exec("INSERT INTO sess (h, acc_id, secret, kind, created, expires) VALUES (?, ?, ?, ?, ?, ?)", h, acc_id, secret, kind || null, t, t + SESS_TTL);
    // at most 10 site sessions per account
    const old = this.rows("SELECT h FROM sess WHERE acc_id = ? ORDER BY created DESC LIMIT -1 OFFSET 10", acc_id);
    for (const o of old) this.sql.exec("DELETE FROM sess WHERE h = ?", o.h);
    return { ok: true };
  },
  sess_get({ h }) {
    const s = typeof h === "string" ? this.one("SELECT * FROM sess WHERE h = ?", h) : null;
    if (!s || s.expires < now()) return { err: "none" };
    return { ok: true, acc_id: s.acc_id, secret: s.secret };
  },
  sess_del({ h }) { this.sql.exec("DELETE FROM sess WHERE h = ?", String(h)); return { ok: true }; },
  // Google web states + the password step
  gst_new({ id, verifier }) { this.gc(); this.sql.exec("INSERT INTO gst (id, verifier, expires) VALUES (?, ?, ?)", id, verifier, now() + GSTATE_TTL); return { ok: true }; },
  gst_take({ id }) {
    const g = typeof id === "string" ? this.one("SELECT * FROM gst WHERE id = ?", id) : null;
    if (g) this.sql.exec("DELETE FROM gst WHERE id = ?", id);
    if (!g || g.expires < now()) return { err: "gone" };
    return { ok: true, verifier: g.verifier };
  },
  pend_new({ h, acc_id }) { this.gc(); this.sql.exec("INSERT INTO pend (h, acc_id, expires) VALUES (?, ?, ?)", h, acc_id, now() + PEND_TTL); return { ok: true }; },
  pend_get({ h }) {
    const p = typeof h === "string" ? this.one("SELECT * FROM pend WHERE h = ?", h) : null;
    return p && p.expires >= now() ? { ok: true, acc_id: p.acc_id } : { err: "gone" };
  },
  pend_del({ h }) { this.sql.exec("DELETE FROM pend WHERE h = ?", String(h)); return { ok: true }; },

  // files
  files_list({ all }) {
    const q = all ? "SELECT * FROM files ORDER BY created_at DESC"
      : "SELECT * FROM files WHERE published = 1 AND status = 'ready' ORDER BY chapter ASC, platform ASC, created_at DESC";
    return { ok: true, files: this.rows(q), chunk: CHUNK };
  },
  file_get({ id }) {
    const f = typeof id === "string" && ID_RE.test(id) ? this.one("SELECT * FROM files WHERE id = ?", id) : null;
    return f ? { ok: true, file: f } : { err: "Файл не найден" };
  },
  file_new(m) {
    this.gc();
    if (this.one("SELECT COUNT(*) AS n FROM files").n >= MAX_FILES) return { err: "Слишком много файлов — удалите старые" };
    const id = rnd(8), t = now(), nchunks = Math.ceil(m.size / CHUNK);
    this.sql.exec(`INSERT INTO files (id, title, game, chapter, platform, version, notes, filename, ctype, size, nchunks, paid, price,
      published, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'uploading', ?, ?)`,
    id, m.title, m.game, m.chapter, m.platform, m.version || null, m.notes || "", m.filename, m.ctype, m.size, nchunks, m.paid, m.price, t, t);
    return { ok: true, id, chunk: CHUNK, nchunks };
  },
  file_finish({ id }) {
    const f = typeof id === "string" && ID_RE.test(id) ? this.one("SELECT * FROM files WHERE id = ?", id) : null;
    if (!f) return { err: "Файл не найден" };
    if (f.status === "ready") return { ok: true, file: f };
    const st = this.one("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM chunks WHERE file_id = ?", id);
    if (st.n !== f.nchunks || st.bytes !== f.size) return { err: `Загружено ${st.n} из ${f.nchunks} кусков`, code: "incomplete", have: st.n };
    this.sql.exec("UPDATE files SET status = 'ready', updated_at = ? WHERE id = ?", now(), id);
    return { ok: true, file: this.one("SELECT * FROM files WHERE id = ?", id) };
  },
  file_patch({ id, meta }) {
    const f = typeof id === "string" && ID_RE.test(id) ? this.one("SELECT * FROM files WHERE id = ?", id) : null;
    if (!f) return { err: "Файл не найден" };
    const keys = ["title", "game", "chapter", "platform", "version", "notes", "paid", "price", "published"].filter((k) => meta && k in meta);
    if (meta && meta.published === 1 && f.status !== "ready") return { err: "Файл ещё не загружен до конца" };
    for (const k of keys) this.sql.exec(`UPDATE files SET ${k} = ? WHERE id = ?`, meta[k], id);
    this.sql.exec("UPDATE files SET updated_at = ? WHERE id = ?", now(), id);
    return { ok: true, file: this.one("SELECT * FROM files WHERE id = ?", id) };
  },
  file_del({ id }) {
    if (typeof id !== "string" || !ID_RE.test(id) || !this.one("SELECT id FROM files WHERE id = ?", id)) return { err: "Файл не найден" };
    this.drop(id);
    this.sql.exec("DELETE FROM purchases WHERE file_id = ?", id);
    return { ok: true };
  },
  dl_count({ id }) { this.sql.exec("UPDATE files SET downloads = downloads + 1 WHERE id = ?", String(id)); return { ok: true }; },

  // purchases (payments hook: the future provider webhook calls purchase_add)
  purchase_has({ buyer, file_id }) {
    return this.one("SELECT 1 AS x FROM purchases WHERE buyer = ? AND file_id = ?", String(buyer), String(file_id)) ? { ok: true } : { err: "none" };
  },
  purchase_add({ buyer, file_id, src, ref }) {
    if (typeof buyer !== "string" || !buyer || typeof file_id !== "string" || !ID_RE.test(file_id)) return { err: "bad" };
    this.sql.exec("INSERT OR IGNORE INTO purchases (buyer, file_id, at, src, ref) VALUES (?, ?, ?, ?, ?)", buyer, file_id, now(),
      typeof src === "string" ? src.slice(0, 20) : null, typeof ref === "string" ? ref.slice(0, 100) : null);
    return { ok: true };
  },
};
