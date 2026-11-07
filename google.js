// «Войти через Google» / Google account linking — OAuth 2.0 Authorization Code + PKCE in the EXTERNAL browser.
// (Google blocks OAuth inside embedded WebViews, so the game only opens /auth/google/start?s=<state>
//  and then polls google_poll over its socket; see accounts.js google_* ops.)
//
//   GET /auth/google/start?s=<state>     -> 302 accounts.google.com (scope openid email profile, S256, state)
//   GET /auth/google/callback?code&state -> code exchange at oauth2.googleapis.com/token, id_token checks,
//                                           login: done page; link: a «Привязать …?» confirmation page (anti link-CSRF)
//   POST /auth/google/confirm | /auth/google/cancel  (form: state + one-time csrf token from that page,
//                                           Origin must be this worker) -> only now the Google gets linked.
//
// Secrets (wrangler secret put): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Without them everything answers
// «Google-вход не настроен» and the game hides its buttons (acc.google_on is not sent).
// Test-only vars: GOOGLE_TOKEN_URL (mock token endpoint), GOOGLE_REDIRECT_URI (otherwise <origin>/auth/google/callback).

import { G_ERR, accCall } from "./accounts.js";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const STATE_RE = /^[A-Z2-9]{24}$/;

export function googleConfigured(env) {
  return !!(env && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

export async function challenge(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function redirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || `${url.origin}/auth/google/callback`;
}

// The id_token comes straight from Google's token endpoint over TLS (our own back-channel request), so per
// OpenID Connect Core 3.1.3.7 the TLS server check replaces the signature check; the claims are still verified.
export function checkIdToken(idToken, clientId, t = Math.floor(Date.now() / 1000)) {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch (e) {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  if (!ISSUERS.includes(p.iss)) return null;
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(clientId)) return null;
  if (typeof p.exp !== "number" || p.exp < t - 60) return null;
  if (typeof p.sub !== "string" || !p.sub || p.sub.length > 255) return null;
  const email = typeof p.email === "string" && p.email_verified !== false && p.email_verified !== "false" ? p.email : null;
  return { sub: p.sub, email };
}

// ---- pages
const TXT = {
  ru: {
    done_link: ["Готово!", "Google привязан к вашему игровому аккаунту. Вернитесь в игру — прогресс теперь можно открыть на любом устройстве."],
    done_login: ["Готово!", "Вход выполнен. Вернитесь в игру — прогресс загрузится сам."],
    fail: "Не получилось",
    back: "Вернитесь в игру и попробуйте ещё раз.",
    close: "Эту вкладку можно закрыть.",
    off: "Google-вход не настроен",
    denied: "Вход через Google отменён.",
    token: "Google не подтвердил вход. Попробуйте ещё раз.",
    server: "Сервер временно недоступен, попробуйте позже.",
  },
  en: {
    done_link: ["Done!", "Google is now linked to your game account. Go back to the game — your progress can now be opened on any device."],
    done_login: ["Done!", "You are signed in. Go back to the game — your progress will load by itself."],
    fail: "Something went wrong",
    back: "Go back to the game and try again.",
    close: "You can close this tab.",
    off: "Google sign-in is not set up",
    denied: "Google sign-in was cancelled.",
    token: "Google did not confirm the sign-in. Please try again.",
    server: "The server is temporarily unavailable, please try later.",
    gone: "This Google sign-in has expired. Press the button in the game again.",
    taken: "This Google account is already linked to another game account. To open that account, use «Sign in with Google».",
    other: "Another Google account is already linked to this game account.",
    nolink: "No game account is linked to this Google account yet. First link Google in the game profile on your old device.",
    noacc: "Account not found",
    cancelled: "Linking cancelled",
    expired: "The link confirmation has expired. Press «Link Google» in the game again.",
    csrf: "The confirmation did not pass the check. Press «Link Google» in the game again.",
    origin: "The request did not pass the check. Press «Link Google» in the game again.",
    q_title: "Link Google?",
    q_text: (em, nick, id4) => `Link the Google account ${em || ""} to the game account ${nick ? `«${nick}» ` : ""}(ID ****${id4})?`.replace("  ", " "),
    q_warn: "If you did not press «Link Google» in the game just now, press «Cancel».",
    q_yes: "Link",
    q_no: "Cancel",
    q_ttl: (m) => `This page is valid for ${m} min.`,
    cancel_done: ["Linking cancelled", "Google was not linked. You can go back to the game."],
    // 2.3.7 the one «Sign in with Google» button
    done_pw: ["Almost done", "Go back to the game and enter your account password."],
    done_new: ["Done!", "The game account is ready and signed in with Google. Go back to the game."],
    need_pw: "This account has a password. Update the game to sign in with Google and enter the password.",
    c_title: "Create an account?",
    c_text: (em) => `Create a game account that signs in with Google ${em || ""}? The progress from this device will be kept in it.`.replace("  ", " "),
    c_warn: "If you did not press «Sign in with Google» in the game just now, press «Cancel».",
    c_yes: "Create",
    c_cancel: ["Cancelled", "No account was created. You can go back to the game."],
    l_title: "Sign in to the account?",
    l_text: (nick, dev, em) => `Sign in to the game account ${nick ? `«${nick}» ` : ""}on a new device${dev ? ` (${dev})` : ""}? Google: ${em || "—"}.`,
    l_warn: "If it was not you who pressed «Sign in with Google» in the game just now — close this page or press «Cancel».",
    l_yes: "Sign in",
    l_cancel: ["Sign-in cancelled", "The account was not opened on the new device. You can close this page."],
  },
};
Object.assign(TXT.ru, {
  origin: "Запрос не прошёл проверку. Нажмите «Привязать Google» в игре ещё раз.",
  q_title: "Привязать Google?",
  q_text: (em, nick, id4) => `Привязать Google-аккаунт ${em || ""} к игровому аккаунту ${nick ? `«${nick}» ` : ""}(ID ****${id4})?`.replace("  ", " "),
  q_warn: "Если ты не нажимал(а) «Привязать Google» в игре только что — нажми «Отмена».",
  q_yes: "Привязать",
  q_no: "Отмена",
  q_ttl: (m) => `Страница действует ${m} мин.`,
  cancel_done: ["Привязка отменена", "Google не привязан. Можно вернуться в игру."],
  done_pw: ["Почти готово", "Вернитесь в игру и введите пароль аккаунта."],
  done_new: ["Готово!", "Игровой аккаунт создан, вход — через Google. Вернитесь в игру."],
  c_title: "Создать аккаунт?",
  c_text: (em) => `Создать игровой аккаунт со входом через Google ${em || ""}? Прогресс с этого устройства сохранится в нём.`.replace("  ", " "),
  c_warn: "Если ты не нажимал(а) «Войти через Google» в игре только что — нажми «Отмена».",
  c_yes: "Создать",
  c_cancel: ["Отменено", "Аккаунт не создан. Можно вернуться в игру."],
  l_title: "Войти в аккаунт?",
  l_text: (nick, dev, em) => `Войти в игровой аккаунт ${nick ? `«${nick}» ` : ""}на новом устройстве${dev ? ` (${dev})` : ""}? Google: ${em || "—"}.`,
  l_warn: "Если это не вы нажали «Войти через Google» в игре только что — закройте страницу или нажмите «Отмена».",
  l_yes: "Войти",
  l_cancel: ["Вход отменён", "Аккаунт не открыт на новом устройстве. Страницу можно закрыть."],
});

function lang(request) {
  const al = (request.headers.get("Accept-Language") || "").trim().toLowerCase();
  return !al || /^(ru|uk|be)\b/.test(al) ? "ru" : "en";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// ok: true (green check) | false (red "!", adds «попробуйте ещё раз») | "info" (neutral, no retry hint)
// extra: raw HTML after the text (the confirm form); referrer: "same-origin" on the form page so the POST carries Origin
export function page(request, ok, title, text, status = 200, extra = "", referrer = "no-referrer") {
  const L = lang(request), T = TXT[L];
  const good = ok === true, info = ok === "info";
  const html = `<!doctype html><html lang="${L}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Soul of the Gate</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
background:radial-gradient(120% 80% at 50% 0%,#2a1f4d 0%,#120d24 55%,#07050f 100%);color:#efeaff;
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:420px;text-align:center;padding:32px 24px;border-radius:20px;
background:rgba(30,22,58,.78);border:1px solid rgba(170,140,255,.28);box-shadow:0 10px 40px rgba(0,0,0,.5)}
.ic{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;
font-size:34px;font-weight:700;background:${good ? "linear-gradient(135deg,#5ef0c0,#2fa8ff)" : info ? "linear-gradient(135deg,#ffd36e,#ff9f43)" : "linear-gradient(135deg,#ff7a8a,#c2408a)"};color:#120d24}
h1{margin:0 0 8px;font-size:24px}p{margin:0 0 10px;color:#cfc6ef}small{color:#8f86b3}
.brand{margin-top:18px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#a99be0}
.warn{margin:14px 0;padding:12px 14px;border-radius:12px;background:rgba(255,170,60,.12);border:1px solid rgba(255,170,60,.45);color:#ffd9a8;font-weight:600}
.btns{display:flex;gap:12px;margin:18px 0 12px}.btns form{flex:1;margin:0}
.btns button{width:100%;min-height:48px;border-radius:12px;font:600 17px/1.2 inherit;cursor:pointer;border:1px solid rgba(170,140,255,.45)}
.yes{background:linear-gradient(135deg,#5ef0c0,#2fa8ff);color:#120d24;border:0}.no{background:transparent;color:#efeaff}
</style></head><body><main class="card"><div class="ic">${good ? "&#10003;" : info ? "?" : "!"}</div>
<h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}${good || info ? "" : `<p>${esc(T.back)}</p>`}${extra ? "" : `<small>${esc(T.close)}</small>`}
<div class="brand">Soul of the Gate</div></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "referrer-policy": referrer, "x-frame-options": "DENY", "content-security-policy": CSP },
  });
}

function errPage(request, res, status = 400) {
  const L = lang(request), T = TXT[L];
  const text = L === "en" ? T[res.code] || T.server : res.err || TXT.ru.server;
  return page(request, false, T.fail, text, status);
}

// LINK mode after a verified id_token: ask the person in the browser before linking (anti link-CSRF)
function confirmPage(request, state, res) {
  const T = TXT[lang(request)];
  const id4 = String(res.id || "").slice(-4);
  const hid = `<input type="hidden" name="state" value="${esc(state)}"><input type="hidden" name="csrf" value="${esc(res.csrf)}">`;
  const mk = res.mode === "signin" && res.create;             // 2.3.7 «Создать аккаунт?» (signin with a new Google)
  const lg = !!res.login;                                    // 2.3.7 «Войти в аккаунт <ник> на новом устройстве?»
  const form = `<p class="warn">${esc(lg ? T.l_warn : mk ? T.c_warn : T.q_warn)}</p><div class="btns">` +
    `<form method="post" action="/auth/google/cancel">${hid}<button class="no" type="submit">${esc(T.q_no)}</button></form>` +
    `<form method="post" action="/auth/google/confirm">${hid}<button class="yes" type="submit">${esc(lg ? T.l_yes : mk ? T.c_yes : T.q_yes)}</button></form>` +
    `</div><small>${esc(T.q_ttl(Math.max(1, Math.round((res.ttl || 300) / 60))))}</small>`;
  if (lg) return page(request, "info", T.l_title, T.l_text(res.nick, res.label, res.google), 200, form, "same-origin");
  if (mk) return page(request, "info", T.c_title, T.c_text(res.google), 200, form, "same-origin");
  return page(request, "info", T.q_title, T.q_text(res.google, res.nick, id4), 200, form, "same-origin");
}

// the confirm/cancel POST must come from our own page: Origin = this worker (a missing / "null" Origin is refused)
function sameOrigin(request, env) {
  const o = request.headers.get("Origin");
  if (!o || o === "null") return false;
  const sfs = request.headers.get("Sec-Fetch-Site");
  if (sfs && sfs !== "same-origin") return false;
  const ok = new Set([new URL(request.url).origin]);
  if (env.PUBLIC_ORIGIN) ok.add(String(env.PUBLIC_ORIGIN).replace(/\/+$/, ""));
  return ok.has(o);
}

async function handleConfirm(request, env, cancel) {
  const T = TXT[lang(request)];
  if (!sameOrigin(request, env)) return page(request, false, T.fail, T.origin, 403);
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("application/x-www-form-urlencoded")) return page(request, false, T.fail, T.origin, 415);
  const raw = await request.text();
  if (raw.length > 4096) return page(request, false, T.fail, T.origin, 413);
  const f = new URLSearchParams(raw);
  const state = f.get("state") || "", csrf = f.get("csrf") || "";
  if (!STATE_RE.test(state)) return errPage(request, { code: "gone", err: G_ERR.gone });
  let res;
  try {
    res = await accCall(env, "google_confirm", { state, csrf, cancel: !!cancel });
  } catch (e) {
    console.log(`google confirm error: ${e && e.stack ? e.stack : e}`);
    return page(request, false, T.fail, T.server, 503);
  }
  if (!res.ok) {
    if (res.code === "cancelled") return page(request, "info", ...(res.login ? T.l_cancel : res.mode === "signin" ? T.c_cancel : T.cancel_done));
    return errPage(request, res, res.code === "csrf" ? 403 : res.code === "gone" || res.code === "expired" ? 400 : 409);
  }
  if (res.login) return page(request, true, ...T.done_login);
  if (res.mode === "signin") return page(request, true, ...T.done_new);
  return page(request, true, T.done_link[0], T.done_link[1]);
}

// ---- HTTP entry (index.js routes /auth/google/*)
export async function handleGoogle(request, env) {
  const url = new URL(request.url);
  const post = url.pathname === "/auth/google/confirm" || url.pathname === "/auth/google/cancel";
  if (post ? request.method !== "POST" : request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: post ? "POST" : "GET, HEAD" } });
  }
  const T = TXT[lang(request)];
  if (!googleConfigured(env) || !env.ACCOUNTS) return page(request, false, T.fail, T.off, 503);
  if (post) return handleConfirm(request, env, url.pathname === "/auth/google/cancel");

  if (url.pathname === "/auth/google/start") {
    const state = url.searchParams.get("s") || "";
    if (!STATE_RE.test(state)) return errPage(request, { code: "gone", err: G_ERR.gone });
    let res;
    try {
      res = await accCall(env, "google_begin", { state });
    } catch (e) {
      return page(request, false, T.fail, T.server, 503);
    }
    if (!res.ok) return errPage(request, res);
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, url), response_type: "code",
      scope: "openid email profile", state, code_challenge: await challenge(res.verifier), code_challenge_method: "S256",
      prompt: "select_account", access_type: "online",
    });
    return new Response(null, { status: 302, headers: { location: `${AUTH_URL}?${q}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  if (url.pathname === "/auth/google/callback") {
    const state = url.searchParams.get("state") || "";
    if (!STATE_RE.test(state)) return errPage(request, { code: "gone", err: G_ERR.gone });
    try {
      if (url.searchParams.get("error")) {                         // user pressed «Отмена» / access_denied
        const taken = await accCall(env, "google_take", { state });
        if (taken.ok) await accCall(env, "google_fail", { state, err: TXT.ru.denied, code: "denied" });
        return page(request, false, T.fail, T.denied, 200);
      }
      const code = url.searchParams.get("code") || "";
      if (!code || code.length > 2048) return errPage(request, { code: "gone", err: G_ERR.gone });
      const taken = await accCall(env, "google_take", { state });
      if (!taken.ok) return errPage(request, taken);
      const who = await exchange(env, url, code, taken.verifier);
      if (!who) {
        await accCall(env, "google_fail", { state, err: TXT.ru.token, code: "token" });
        return page(request, false, T.fail, T.token, 502);
      }
      const res = await accCall(env, "google_finish", { state, sub: who.sub, email: who.email });
      if (!res.ok) return errPage(request, res, 409);
      if (res.confirm) return confirmPage(request, state, res);   // link: nothing is linked until the POST confirm
      const [h, p] = res.mode === "signin" && res.pw ? T.done_pw : res.mode === "login" || res.mode === "signin" ? T.done_login : T.done_link;
      return page(request, true, h, p);
    } catch (e) {
      console.log(`google callback error: ${e && e.stack ? e.stack : e}`);
      return page(request, false, T.fail, T.server, 503);
    }
  }
  return new Response("Not found", { status: 404 });
}

export async function exchange(env, url, code, verifier) {
  let data;
  try {
    const res = await fetch(env.GOOGLE_TOKEN_URL || TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(env, url), grant_type: "authorization_code", code_verifier: verifier,
      }),
    });
    data = await res.json();
    if (!res.ok) {
      console.log(`google token: HTTP ${res.status} ${data && data.error}`);
      return null;
    }
  } catch (e) {
    console.log(`google token request failed: ${e}`);
    return null;
  }
  const who = checkIdToken(data && data.id_token, env.GOOGLE_CLIENT_ID);
  if (!who) console.log("google token: id_token rejected");
  return who;
}
