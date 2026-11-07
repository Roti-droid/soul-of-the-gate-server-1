// Crystal Run («Кристальный забег») — donations via Telegram Stars (XTR), inside the same Worker.
//
// Telegram -> POST /tg/<path> (webhook, secret header checked) -> Durable Object "Donate"
// (SQLite: payments + one-time codes). The game redeems codes over the WebSocket protocol:
// Lobby -> Donate.fetch("/redeem").
//
// Worker secrets/vars: BOT_TOKEN, WEBHOOK_SECRET, ADMIN_IDS ("1,2"), optional BOT_USERNAME,
// SUPPORT_CONTACT, DONATE_URL; TG_API_BASE only for tests (mock Telegram server).

import { accCall } from "./accounts.js";
import { currentPromo, parsePromoPayload, promoAt, promoSlot } from "./promo.js";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no O, 0, I, 1
const CURRENCY = "XTR";
const GAME = "Кристальный забег";

// limit: "once" — one purchase per Telegram user (bot) and one activation per game account (reward.once, checked at redeem);
//        "month" — one purchase per Telegram user per 30 days.
// reward: gems (💎), dark (тёмные кристаллы), skins / frames / trails (ids that exist in the game), pass (премиум-пропуск на аккаунт).
export const PRODUCTS = [
  { id: "starter", title: "Стартовый набор", description: "2500 💎 + 100 тёмных кристаллов + золотая рамка. Один раз на аккаунт",
    stars: 15, reward: { gems: 2500, dark: 100, frames: ["gold"], once: "starter" }, limit: "once" },
  { id: "handful", title: "Горсть кристаллов", description: "1000 💎 в игре «Кристальный забег»",
    stars: 25, reward: { gems: 1000 } },
  { id: "sack", title: "Мешок кристаллов", description: "6000 💎 в игре «Кристальный забег»",
    stars: 100, reward: { gems: 6000 } },
  { id: "royal", title: "Королевский набор", description: "15000 💎 + скин «Королевский» в игре «Кристальный забег»",
    stars: 250, reward: { gems: 15000, skins: ["royal"] } },
  { id: "founder", title: "Набор основателя", description: "3000 💎 + скин, рамка и шлейф «Основатель» в игре «Кристальный забег»",
    stars: 150, reward: { gems: 3000, skins: ["founder"] } },
  { id: "pass", title: "Премиум-пропуск", description: "Премиум-трек онлайн-сезона (награда на каждом уровне), +15% кристаллов за забег, " +
    "плашка «Премиум», скин, рамка и шлейф. Навсегда на игровом аккаунте",
    stars: 75, reward: { gems: 0, pass: true } },
  { id: "collector", title: "Набор коллекционера", description: "5000 💎 + скины «НЛО» и «Драконье яйцо»",
    stars: 199, reward: { gems: 5000, skins: ["ufo", "dragonegg"] } },
  { id: "wanderer", title: "Звёздный странник", description: "4000 💎 + новый скин «Звёздный странник» и шлейф «Млечный путь»",
    stars: 179, reward: { gems: 4000, skins: ["star_wanderer"], trails: ["milkyway"] } },
  { id: "dark_handful", title: "Горсть тьмы", description: "500 тёмных кристаллов для «Тёмной лавки»",
    stars: 30, reward: { gems: 0, dark: 500 } },
  { id: "dark_chest", title: "Сундук Тьмы", description: "2500 тёмных кристаллов + тёмный скин «Затмение»",
    stars: 120, reward: { gems: 0, dark: 2500, skins: ["d_eclipse"] } },
  { id: "monthly", title: "Набор месяца", description: "8000 💎 + 600 тёмных кристаллов. Можно купить раз в 30 дней",
    stars: 99, reward: { gems: 8000, dark: 600 }, limit: "month" },
];
export const SUPPORT = {
  title: "Поддержка автора",
  description: "Спасибо, что поддерживаете «Кристальный забег»! Без игровой награды.",
  amounts: [1, 10, 50, 100, 500],
};
const SKIN_NAMES = { royal: "Королевский", founder: "Основатель", ufo: "НЛО", dragonegg: "Драконье яйцо", star_wanderer: "Звёздный странник",
  d_eclipse: "Затмение" };
const MONTH = 30 * 86400;
const BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

const HOW_TO_REDEEM = "Как получить награду: откройте игру → <b>Магазин → Поддержать → Ввести код</b>, " +
  "вставьте код и нажмите «Активировать». Нужен интернет. Код одноразовый.";
const STATUS_RU = { new: "🟢 не использован", used: "✅ использован", revoked: "⛔ отозван" };

// ------------------------------------------------------------------ helpers

export function generateCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const s = Array.from(b, (x) => CODE_ALPHABET[x & 31]).join(""); // 256 % 32 == 0 -> uniform
  return `CR-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeCode(raw) {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (s.length !== 10 || !s.startsWith("CR")) return null;
  return `CR-${s.slice(2, 6)}-${s.slice(6)}`;
}

export function normalizeReward(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("награда должна быть объектом");
  const gems = r.gems === undefined ? 0 : r.gems;
  const skins = r.skins === undefined ? [] : r.skins;
  if (!Number.isInteger(gems) || gems < 0) throw new Error("gems должно быть целым >= 0");
  if (!Array.isArray(skins) || !skins.every((s) => typeof s === "string" && s)) throw new Error("skins: список строк");
  const out = { ...r, gems, skins };
  if (out.pass !== undefined && out.pass !== true) delete out.pass;
  if (out.dark !== undefined && (!Number.isInteger(out.dark) || out.dark < 0)) throw new Error("dark должно быть целым >= 0");
  if (out.dark === 0) delete out.dark;
  if (out.once !== undefined && !(typeof out.once === "string" && /^[a-z0-9_]{1,32}$/.test(out.once))) delete out.once;
  for (const k of ["frames", "trails"]) {
    if (out[k] !== undefined && !(Array.isArray(out[k]) && out[k].every((x) => typeof x === "string" && /^[a-z0-9_]{1,32}$/.test(x)))) delete out[k];
  }
  return out;
}

function parseStoredReward(text) {
  try {
    return normalizeReward(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

export function parseGiftReward(text) {
  text = (text || "").trim();
  if (!text) throw new Error("пусто");
  if (text.startsWith("{")) return normalizeReward(JSON.parse(text));
  const parts = text.split(/\s+/);
  if (!/^\d+$/.test(parts[0])) throw new Error("число кристаллов");
  const r = { gems: parseInt(parts[0], 10), skins: [] };
  for (const p of parts.slice(1)) {
    for (const s of p.split(",").filter(Boolean)) {
      if (s === "pass") { r.pass = true; continue; }
      if (!/^[a-z0-9_]{1,32}$/.test(s)) throw new Error("id скина: латиница/цифры/_");
      r.skins.push(s);
    }
  }
  return normalizeReward(r);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtReward(reward) {
  const r = normalizeReward(reward);
  const parts = [];
  if (r.gems) parts.push(`${r.gems} 💎`);
  if (r.dark) parts.push(`${r.dark} тёмных кристаллов`);
  for (const s of r.skins) parts.push(`скин «${SKIN_NAMES[s] || s}»`);
  if (r.frames && r.frames.length) parts.push("рамка");
  if (r.trails && r.trails.length) parts.push("шлейф");
  if (r.pass) parts.push("Премиум-пропуск");
  return parts.join(" + ") || "без награды";
}

function fmtTime(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

const now = () => Math.floor(Date.now() / 1000);

export async function webhookPath(secret) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("crystal-run-webhook:" + secret));
  return "/tg/" + Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export function botConfigured(env) {
  return !!(env.BOT_TOKEN && env.WEBHOOK_SECRET);
}

// Worker-level handler for /tg/* ; returns a Response
export async function handleWebhook(request, env) {
  if (!botConfigured(env)) return new Response("not found", { status: 404 });
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== await webhookPath(env.WEBHOOK_SECRET)) {
    return new Response("not found", { status: 404 });
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const body = await request.text();
  if (body.length > 1_000_000) return new Response("too large", { status: 413 });
  const stub = env.DONATE.get(env.DONATE.idFromName("donate"));
  return stub.fetch("https://donate/update", { method: "POST", body });
}

// used by Lobby for {"t":"redeem"}: returns {status, reward}
export async function redeemViaDO(env, code, usedBy) {
  const stub = env.DONATE.get(env.DONATE.idFromName("donate"));
  const res = await stub.fetch("https://donate/redeem", { method: "POST", body: JSON.stringify({ code, usedBy }) });
  if (!res.ok) return { status: "db_error" };
  return res.json();
}

// Lobby: look at a code without using it (account checks happen before the code is spent): {status, reward}
export async function peekViaDO(env, code) {
  const stub = env.DONATE.get(env.DONATE.idFromName("donate"));
  const res = await stub.fetch("https://donate/peek", { method: "POST", body: JSON.stringify({ code }) });
  if (!res.ok) return { status: "db_error" };
  return res.json();
}

// ------------------------------------------------------------------ Durable Object

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS codes (
    code TEXT PRIMARY KEY, reward TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    user_id INTEGER, source TEXT NOT NULL, product TEXT, charge_id TEXT, created_at INTEGER NOT NULL,
    used_at INTEGER, used_by TEXT, revoked_at INTEGER, note TEXT)`,
  "CREATE INDEX IF NOT EXISTS codes_user ON codes(user_id)",
  `CREATE TABLE IF NOT EXISTS payments (
    charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, username TEXT, product TEXT NOT NULL,
    stars INTEGER NOT NULL, payload TEXT, code TEXT, created_at INTEGER NOT NULL, refunded_at INTEGER)`,
  "CREATE INDEX IF NOT EXISTS payments_code ON payments(code)",
];

export class Donate {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
    this.admins = new Set(String(env.ADMIN_IDS || "").split(/[,\s]+/).filter(Boolean).map(Number));
    this.api = (env.TG_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
  }

  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.rows(q, ...b)[0] || null; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/redeem") {
        const { code, usedBy } = await request.json();
        return Response.json(this.redeem(code, usedBy));
      }
      if (path === "/peek") {
        const { code } = await request.json();
        return Response.json(this.peek(code));
      }
      if (path === "/update") {
        await this.onUpdate(await request.json());
        return new Response("ok");
      }
    } catch (e) {
      console.log(`donate error: ${e && e.stack ? e.stack : e}`);
      return new Response("error", { status: 500 }); // Telegram retries; payment handling is idempotent
    }
    return new Response("not found", { status: 404 });
  }

  // ---- storage
  insertCode(reward, userId, source, product = null, chargeId = null, note = null) {
    const json = JSON.stringify(normalizeReward(reward));
    for (let i = 0; i < 20; i++) {
      const code = generateCode();
      if (this.one("SELECT code FROM codes WHERE code = ?", code)) continue;
      this.sql.exec("INSERT INTO codes (code, reward, status, user_id, source, product, charge_id, created_at, note) " +
        "VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?)", code, json, userId, source, product, chargeId, now(), note);
      return code;
    }
    throw new Error("could not generate a unique code");
  }

  recordPayment(chargeId, userId, username, product, stars, payload, reward) {
    return this.ctx.storage.transactionSync(() => {
      const ex = this.one("SELECT code FROM payments WHERE charge_id = ?", chargeId);
      if (ex) return { code: ex.code, isNew: false };
      const code = reward ? this.insertCode(reward, userId, "payment", product, chargeId) : null;
      this.sql.exec("INSERT INTO payments (charge_id, user_id, username, product, stars, payload, code, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", chargeId, userId, username, product, stars, payload, code, now());
      return { code, isNew: true };
    });
  }

  peek(raw) {
    const code = normalizeCode(raw);
    if (!code) return { status: "not_found" };
    const row = this.one("SELECT status, reward, source FROM codes WHERE code = ?", code);
    if (!row) return { status: "not_found" };
    if (row.status === "used") return { status: "used" };
    if (row.status === "revoked") return { status: "revoked" };
    if (row.status !== "new") return { status: "not_found" };
    const reward = parseStoredReward(row.reward);
    // paid: bought with Stars — the 2.3.6 god «откат» never takes it back (except payment fraud)
    return reward ? { status: "ok", code, reward, paid: row.source === "payment" } : { status: "broken" };
  }

  // purchase limits per Telegram user -> null (ok) | Russian reason
  limitProblem(userId, p) {
    if (!p || !p.limit || userId == null) return null;
    const live = "user_id = ? AND product = ? AND refunded_at IS NULL";
    if (p.limit === "once" && this.one(`SELECT charge_id FROM payments WHERE ${live}`, userId, p.id)) {
      return `«${p.title}» можно купить только один раз.`;
    }
    if (p.limit === "month") {
      const last = this.one(`SELECT MAX(created_at) AS t FROM payments WHERE ${live}`, userId, p.id);
      if (last && last.t && now() - last.t < MONTH) return `«${p.title}» снова будет доступен ${fmtTime(last.t + MONTH)}.`;
    }
    return null;
  }

  redeem(raw, usedBy) {
    const code = normalizeCode(raw);
    if (!code) return { status: "not_found" };
    return this.ctx.storage.transactionSync(() => {
      const row = this.one("SELECT status, reward FROM codes WHERE code = ?", code);
      if (!row) return { status: "not_found" };
      if (row.status === "used") return { status: "used" };
      if (row.status === "revoked") return { status: "revoked" };
      if (row.status !== "new") return { status: "not_found" };
      const reward = parseStoredReward(row.reward);
      if (!reward) return { status: "broken" };
      this.sql.exec("UPDATE codes SET status = 'used', used_at = ?, used_by = ? WHERE code = ? AND status = 'new'",
        now(), String(usedBy || "").slice(0, 64), code);
      console.log(`redeem ${code} by ${usedBy}: ok`);
      return { status: "ok", code, reward };
    });
  }

  revokeCode(code) {
    const row = this.one("SELECT status FROM codes WHERE code = ?", code);
    if (!row) return null;
    this.sql.exec("UPDATE codes SET status = 'revoked', revoked_at = ? WHERE code = ?", now(), code);
    return row.status;
  }

  markRefunded(chargeId) {
    const pay = this.one("SELECT * FROM payments WHERE charge_id = ?", chargeId);
    if (!pay) return { pay: null, prev: null };
    if (!pay.refunded_at) this.sql.exec("UPDATE payments SET refunded_at = ? WHERE charge_id = ?", now(), chargeId);
    const prev = pay.code ? this.revokeCode(pay.code) : null;
    return { pay: this.one("SELECT * FROM payments WHERE charge_id = ?", chargeId), prev };
  }

  findPayment(ref) {
    const code = normalizeCode(ref);
    if (code) {
      const p = this.one("SELECT * FROM payments WHERE code = ?", code);
      if (p) return p;
    }
    return this.one("SELECT * FROM payments WHERE charge_id = ?", ref);
  }

  // ---- Telegram API
  async tg(method, params) {
    try {
      const res = await fetch(`${this.api}/bot${this.env.BOT_TOKEN}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params || {}),
      });
      const data = await res.json();
      if (!data.ok) console.log(`tg ${method} failed: ${data.description}`);
      return data;
    } catch (e) {
      console.log(`tg ${method} error: ${e}`);
      return { ok: false, description: String(e) };
    }
  }

  say(chatId, text, extra) {
    return this.tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  }

  isAdmin(user) { return !!user && this.admins.has(user.id); }

  menuKb() {
    const rows = [];
    const pr = currentPromo(this.env);
    if (pr && BY_ID[pr.id]) {
      rows.push([{ text: `🔥 Акция: ${BY_ID[pr.id].title} — ${pr.stars}⭐ вместо ${BY_ID[pr.id].stars}⭐`, callback_data: "promo" }]);
    }
    return this.menuRows(rows);
  }

  menuRows(rows) {
    rows.push(...PRODUCTS.map((p) => [{ text: `${p.title} — ${fmtReward(p.reward)} · ${p.stars}⭐`, callback_data: `buy:${p.id}` }]));
    rows.push([{ text: `💜 ${SUPPORT.title}`, callback_data: "support" }]);
    rows.push([{ text: "🎟 Мои коды", callback_data: "mycodes" }]);
    return { inline_keyboard: rows };
  }

  // the current promo: invoice at the promo price (or a «акция закончилась» note)
  promoInvoice(chatId) {
    const pr = currentPromo(this.env);
    const p = pr && BY_ID[pr.id];
    if (!p) return this.say(chatId, "Сейчас акций нет. Все наборы: /start");
    const left = Math.max(1, Math.round((pr.ends - now()) / 3600));
    return this.tg("sendInvoice", {
      chat_id: chatId, title: ("Акция: " + p.title).slice(0, 32),
      description: (`Скидка: ${pr.stars}⭐ вместо ${p.stars}⭐ (ещё ~${left} ч). ` + p.description).slice(0, 255),
      payload: `q:${p.id}:${pr.slot}`, currency: CURRENCY, provider_token: "",
      prices: [{ label: p.title.slice(0, 32), amount: pr.stars }],
    });
  }

  menuText(first = true) {
    return (first ? `Привет! Это бот поддержки игры «${GAME}» 💎\n\n` : "") +
      "Выберите набор — оплата звёздами Telegram (⭐). После оплаты бот пришлёт <b>код</b>, " +
      "который нужно ввести в игре: <b>Магазин → Поддержать → Ввести код</b>.";
  }

  // strict (pre_checkout): a promo invoice is valid only while its slot is the current promo
  resolvePayload(payload, strict = false) {
    if (payload.startsWith("p:")) {
      const p = BY_ID[payload.slice(2)];
      if (p) return { product: p.id, stars: p.stars, reward: p.reward, p };
    } else if (payload.startsWith("q:")) {
      const q = parsePromoPayload(payload);
      const pr = q ? promoAt(q.slot) : null;
      const p = q ? BY_ID[q.id] : null;
      if (!pr || !p || pr.id !== q.id) return null;
      if (strict && (q.slot !== promoSlot() || !currentPromo(this.env))) return { expired: true };
      return { product: p.id, stars: pr.stars, reward: p.reward, p, promo: q.slot };
    } else if (payload.startsWith("s:")) {
      const a = Number(payload.slice(2));
      if (SUPPORT.amounts.includes(a)) return { product: "support", stars: a, reward: null };
    }
    return null;
  }

  async invoice(chatId, p, userId = chatId) {
    const lim = this.limitProblem(userId, p);
    if (lim) return this.say(chatId, `${esc(lim)}\nДругие наборы: /start`);
    return this.tg("sendInvoice", {
      chat_id: chatId, title: p.title.slice(0, 32), description: p.description.slice(0, 255),
      payload: `p:${p.id}`, currency: CURRENCY, provider_token: "",
      prices: [{ label: p.title.slice(0, 32), amount: p.stars }],
    });
  }

  supportInvoice(chatId, amount) {
    return this.tg("sendInvoice", {
      chat_id: chatId, title: SUPPORT.title, description: SUPPORT.description, payload: `s:${amount}`,
      currency: CURRENCY, provider_token: "", prices: [{ label: SUPPORT.title, amount }],
    });
  }

  async notifyAdmins(text) {
    for (const id of this.admins) await this.say(id, text);
  }

  myCodesText(userId) {
    const rows = this.rows("SELECT * FROM codes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20", userId);
    if (!rows.length) return "У вас пока нет кодов. Выбрать набор: /start";
    const lines = [`<b>Ваши коды</b> (последние ${rows.length}):`];
    for (const r of rows) {
      lines.push(`<code>${r.code}</code> — ${esc(fmtReward(JSON.parse(r.reward)))} — ${STATUS_RU[r.status] || r.status}`);
    }
    return lines.concat(["", HOW_TO_REDEEM]).join("\n");
  }

  // ---- updates
  async onUpdate(u) {
    await this.ensureCommands();
    if (u.pre_checkout_query) return this.onPreCheckout(u.pre_checkout_query);
    if (u.callback_query) return this.onCallback(u.callback_query);
    const m = u.message;
    if (!m || !m.from || !m.chat) return;
    if (m.successful_payment) return this.onPaid(m);
    if (m.refunded_payment) return this.onRefunded(m);
    if (typeof m.text === "string" && m.text.startsWith("/")) return this.onCommand(m);
    if (m.chat.type === "private" && typeof m.text === "string") {
      return this.say(m.chat.id, this.menuText(false), { reply_markup: this.menuKb() });
    }
  }

  async onPreCheckout(q) {
    const item = this.resolvePayload(q.invoice_payload || "", true);
    if (item && item.expired) {
      return this.tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok: false,
        error_message: "Акция закончилась. Текущие наборы и акции: /start" });
    }
    const lim = item && item.p ? this.limitProblem(q.from && q.from.id, item.p) : null;
    if (lim) return this.tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok: false, error_message: lim });
    if (!item || q.currency !== CURRENCY || q.total_amount !== item.stars) {
      console.log(`pre_checkout reject user=${q.from && q.from.id} payload=${q.invoice_payload} amount=${q.total_amount}`);
      return this.tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok: false,
        error_message: "Этот счёт устарел. Откройте меню заново: /start" });
    }
    return this.tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok: true });
  }

  async onCallback(cq) {
    const chatId = cq.message && cq.message.chat ? cq.message.chat.id : cq.from.id;
    const data = cq.data || "";
    if (data.startsWith("buy:")) {
      const p = BY_ID[data.slice(4)];
      if (!p) return this.tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Этого набора больше нет", show_alert: true });
      await this.tg("answerCallbackQuery", { callback_query_id: cq.id });
      return this.invoice(chatId, p, cq.from.id);
    }
    if (data.startsWith("sup:")) {
      const a = Number(data.slice(4));
      if (!SUPPORT.amounts.includes(a)) return this.tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Неверная сумма", show_alert: true });
      await this.tg("answerCallbackQuery", { callback_query_id: cq.id });
      return this.supportInvoice(chatId, a);
    }
    await this.tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (data === "support") {
      return this.say(chatId, "💜 Сколько звёзд отправить автору? Игровой награды нет — это просто спасибо за игру.", {
        reply_markup: { inline_keyboard: [SUPPORT.amounts.map((a) => ({ text: `${a}⭐`, callback_data: `sup:${a}` })),
          [{ text: "« Назад", callback_data: "menu" }]] },
      });
    }
    if (data === "promo") return this.promoInvoice(chatId);
    if (data === "mycodes") return this.say(chatId, this.myCodesText(cq.from.id));
    if (data === "menu") return this.say(chatId, this.menuText(false), { reply_markup: this.menuKb() });
  }

  async onPaid(m) {
    const sp = m.successful_payment;
    const user = m.from;
    const item = this.resolvePayload(sp.invoice_payload || "");
    const product = item ? (item.promo != null ? "promo:" + item.product : item.product) : String(sp.invoice_payload || "?").slice(0, 40);
    const reward = item ? item.reward : null;
    const { code, isNew } = this.recordPayment(sp.telegram_payment_charge_id, user.id, user.username || null,
      product, sp.total_amount, sp.invoice_payload || "", reward);
    console.log(`payment ${sp.telegram_payment_charge_id} user=${user.id} product=${product} stars=${sp.total_amount} code=${code} new=${isNew}`);
    if (code) {
      await this.say(m.chat.id, `Спасибо за поддержку! 💎\n\nВаш код: <code>${code}</code>\nНаграда: ${esc(fmtReward(reward))}\n\n` +
        `${HOW_TO_REDEEM}\n\nВсе ваши коды: /mycodes`);
    } else if (item) {
      await this.say(m.chat.id, "💜 Спасибо огромное за поддержку автора! Каждая звезда помогает делать «Кристальный забег» лучше.");
    } else {
      await this.say(m.chat.id, "Оплата получена, но этот набор уже изменился. Автор выдаст награду вручную — напишите /paysupport.");
    }
    if (isNew) {
      const who = user.username ? "@" + user.username : String(user.id);
      await this.notifyAdmins(`⭐ Оплата: ${esc(who)} — ${esc(product)}, ${sp.total_amount}⭐` +
        (code ? `, код <code>${code}</code>` : "") + `\ncharge: <code>${esc(sp.telegram_payment_charge_id)}</code>`);
    }
  }

  async onRefunded(m) {
    const rp = m.refunded_payment;
    const { pay, prev } = this.markRefunded(rp.telegram_payment_charge_id);
    console.log(`refunded_payment ${rp.telegram_payment_charge_id}: code status was ${prev}`);
    if (pay && pay.code) await this.say(m.chat.id, `Возврат ${rp.total_amount}⭐ оформлен. Код <code>${pay.code}</code> отозван.`);
    await this.notifyAdmins(`↩️ Возврат ${rp.total_amount}⭐ (Telegram), charge <code>${esc(rp.telegram_payment_charge_id)}</code>` +
      (pay && pay.code ? `, код ${pay.code} был ${prev}` : ""));
  }

  async onCommand(m) {
    const [head, ...rest] = m.text.trim().split(/\s+/);
    const cmd = head.slice(1).split("@")[0].toLowerCase();
    const args = rest.join(" ");
    const chat = m.chat.id;
    const admin = this.isAdmin(m.from);
    switch (cmd) {
      case "start": {
        const arg = args.trim().toLowerCase();
        if (arg.startsWith("link_")) return this.cmdLink(m, arg.slice(5));
        await this.say(chat, this.menuText(), { reply_markup: this.menuKb() });
        if (arg.startsWith("buy_") && BY_ID[arg.slice(4)]) await this.invoice(chat, BY_ID[arg.slice(4)], m.from.id);
        if (arg === "promo") await this.promoInvoice(chat);
        return;
      }
      case "menu": case "donate": case "shop":
        return this.say(chat, this.menuText(false), { reply_markup: this.menuKb() });
      case "mycodes": case "codes":
        return this.say(chat, this.myCodesText(m.from.id));
      case "login":
        return this.cmdLogin(m);
      case "resetpw": case "password":
        return this.cmdResetPw(m);
      case "appeal":
        return this.cmdAppeal(m, args);
      case "myid":
        return this.say(chat, `Ваш Telegram id: <code>${m.from.id}</code>`);
      case "paysupport": case "refund_help": case "terms": {
        const contact = this.env.SUPPORT_CONTACT ? esc(this.env.SUPPORT_CONTACT) : "автору игры";
        if (cmd === "terms") {
          return this.say(chat, "<b>Условия</b>\n\n• Оплата — звёздами Telegram (⭐), это добровольная поддержка игры.\n" +
            "• За оплату набора бот выдаёт одноразовый код; награда появляется в игре после ввода кода.\n" +
            "• Покупки цифровые. Возврат — пока код не использован (см. /paysupport).\n" +
            "• «Поддержка автора» — пожертвование без игровой награды.\n\n" +
            "Полные условия (покупки, возврат, как не попасться на обман): " + new URL("/terms.html", this.env.PUBLIC_URL || "https://crystal-run-server.ken729710.workers.dev").href);
        }
        return this.say(chat, "<b>Возврат и помощь с оплатой</b>\n\n" +
          "• Оплата идёт звёздами Telegram (⭐), награда — одноразовый код для игры.\n" +
          "• Если код не активируется, проверьте, что ввели его без ошибок и что в игре есть интернет. Свои коды: /mycodes.\n" +
          "• Возврат звёзд возможен, пока код <b>не использован</b> в игре. После возврата код отзывается.\n" +
          `• Чтобы попросить возврат, напишите ${contact} и укажите код из /mycodes.\n` +
          "• После активации кода награда уже выдана, поэтому вернуть звёзды за использованный код нельзя (кроме технических ошибок).\n\n" +
          "<b>Аккаунт</b>\n• Забыли пароль: /resetpw (если Telegram привязан к аккаунту) или «Войти через Google» → Профиль → Пароль.\n" +
          `• Telegram не привязан — напишите ${contact}: ник, ID аккаунта и чем можете подтвердить, что аккаунт ваш (покупки, дата создания).\n` +
          "• Не согласны с наказанием: /appeal и текст.");
      }
    }
    if (!admin) return; // admin commands are silently ignored for everyone else
    switch (cmd) {
      case "admin":
        return this.say(chat, "<b>Команды администратора</b>\n/stats — статистика\n/gift 1000 [royal] [pass] — подарочный код\n" +
          "/refund CR-XXXX-XXXX [force] — вернуть звёзды и отозвать код\n/revoke CR-XXXX-XXXX — отозвать код без возврата\n" +
          "/code CR-XXXX-XXXX — информация о коде");
      case "stats": return this.cmdStats(chat);
      case "gift": {
        let reward;
        try { reward = parseGiftReward(args); } catch (e) {
          return this.say(chat, "Формат: <code>/gift 1000</code>, <code>/gift 15000 royal</code>, <code>/gift 0 pass</code> " +
            "или <code>/gift {\"gems\":500,\"skins\":[\"royal\"]}</code>");
        }
        const code = this.insertCode(reward, null, "gift", null, null, `gift by ${m.from.id}`);
        console.log(`gift code ${code} by admin ${m.from.id}`);
        return this.say(chat, `🎁 Подарочный код: <code>${code}</code>\nНаграда: ${esc(fmtReward(reward))}`);
      }
      case "refund": return this.cmdRefund(chat, args.split(/\s+/).filter(Boolean), m.from.id);
      case "revoke": {
        const code = normalizeCode(args);
        const prev = code ? this.revokeCode(code) : null;
        if (prev === null) return this.say(chat, "Код не найден. Формат: <code>/revoke CR-XXXX-XXXX</code> (без возврата звёзд; для возврата — /refund).");
        return this.say(chat, `⛔ Код <code>${code}</code> отозван (был: ${prev}).`);
      }
      case "code": {
        const code = normalizeCode(args);
        const r = code ? this.one("SELECT * FROM codes WHERE code = ?", code) : null;
        if (!r) return this.say(chat, "Код не найден.");
        return this.say(chat, `<code>${r.code}</code>: ${STATUS_RU[r.status] || r.status}\nНаграда: ${esc(fmtReward(JSON.parse(r.reward)))}\n` +
          `Источник: ${r.source}, создан ${fmtTime(r.created_at)}\nПользователь: ${r.user_id || "—"}\n` +
          `Использован: ${r.used_at ? `${fmtTime(r.used_at)}, ${esc(r.used_by || "")}` : "—"}`);
      }
    }
  }

  // ---- game accounts (Accounts DO)
  async cmdLink(m, code) {
    if (!this.env.ACCOUNTS) return this.say(m.chat.id, "Аккаунты пока не настроены.");
    const r = await accCall(this.env, "tg_link", { code, tg_id: m.from.id, tg_name: m.from.username || null });
    if (r.err) return this.say(m.chat.id, esc(r.err));
    return this.say(m.chat.id, `✅ Аккаунт <b>${esc(r.nick || "без ника")}</b> привязан.\n\n` +
      "Чтобы войти с другого устройства: отправьте сюда /login и введите код в игре.");
  }

  async cmdLogin(m) {
    if (!this.env.ACCOUNTS) return this.say(m.chat.id, "Аккаунты пока не настроены.");
    const r = await accCall(this.env, "tg_login", { tg_id: m.from.id });
    if (r.err) {
      return this.say(m.chat.id, esc(r.err) + "\nСначала привяжите аккаунт в игре: кнопка «Привязать Telegram».");
    }
    return this.say(m.chat.id, `🔑 Код для входа${r.nick ? ` в аккаунт <b>${esc(r.nick)}</b>` : ""}: <code>G-${r.code}</code>\n` +
      "Действует 10 минут, один раз. Введите его в игре при входе в аккаунт через Telegram. Никому не пересылайте этот код.");
  }

  // 2.3.6: password reset — the Telegram linked to the account is the proof of ownership
  async cmdResetPw(m) {
    if (!this.env.ACCOUNTS) return this.say(m.chat.id, "Аккаунты пока не настроены.");
    if (m.chat.type && m.chat.type !== "private") return this.say(m.chat.id, "Эта команда работает только в личном чате с ботом.");
    const r = await accCall(this.env, "pw_reset_code", { tg_id: m.from.id });
    if (r.err) return this.say(m.chat.id, esc(r.err) + "\nЕсли аккаунт привязан к Google — войдите через Google и задайте пароль в профиле. Иначе: /paysupport.");
    return this.say(m.chat.id, `🔐 Код сброса пароля${r.nick ? ` для <b>${esc(r.nick)}</b>` : ""}: <code>P-${r.code}</code>\n` +
      "Действует 10 минут, один раз. В игре: Профиль → «Пароль» → «Сбросить по коду из бота».\n" +
      "После сброса все другие устройства выйдут из аккаунта. Никому не пересылайте этот код — поддержка его никогда не спрашивает.");
  }

  // 2.3.6: appeal against a punishment -> the admins get the text + the account's punishment card
  async cmdAppeal(m, args) {
    const text = String(args || "").trim().slice(0, 800);
    if (text.length < 10) return this.say(m.chat.id, "Напишите после команды, почему наказание стоит снять, например:\n<code>/appeal Я не пользовался читами, рекорд поставлен честно</code>");
    this.appealAt = this.appealAt || new Map();
    const last = this.appealAt.get(m.from.id) || 0;
    if (Date.now() - last < 3600 * 1000) return this.say(m.chat.id, "Апелляция уже отправлена. Новую можно отправить через час.");
    this.appealAt.set(m.from.id, Date.now());
    let card = "аккаунт не привязан к этому Telegram";
    if (this.env.ACCOUNTS) {
      try {
        const r = await accCall(this.env, "pun_get", { tg_id: m.from.id });
        if (r && r.ok) card = `аккаунт <code>${r.id}</code> ${esc(r.nick || "")}; активное: ${r.active ? esc(r.active.type + (r.active.until ? " до " + fmtTime(r.active.until) : "") + (r.active.reason ? " · " + r.active.reason : "")) : "нет"}`;
      } catch (e) { /* keep the default */ }
    }
    const who = `${esc(m.from.first_name || "")}${m.from.username ? " @" + esc(m.from.username) : ""} (tg ${m.from.id})`;
    for (const id of this.admins) await this.say(id, `⚖️ <b>Апелляция</b> от ${who}\n${card}\n\n${esc(text)}`);
    return this.say(m.chat.id, "✅ Апелляция отправлена. Ответ придёт сюда, обычно в течение 3 дней.");
  }

  async ensureCommands() {
    if (this.commandsChecked) return;
    this.commandsChecked = true;
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const row = this.one("SELECT v FROM meta WHERE k = 'commands_v'");
    if (row && row.v === "3") return;
    const r = await this.tg("setMyCommands", { commands: [
      { command: "start", description: "Наборы кристаллов" },
      { command: "mycodes", description: "Мои коды" },
      { command: "login", description: "Вход в игровой аккаунт на новом устройстве" },
      { command: "resetpw", description: "Сбросить пароль игрового аккаунта" },
      { command: "appeal", description: "Обжаловать наказание" },
      { command: "paysupport", description: "Помощь с оплатой и возврат" },
      { command: "terms", description: "Условия" },
    ] });
    if (r.ok) this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('commands_v', '3')");
  }

  async cmdStats(chat) {
    const n = (q, ...b) => Object.values(this.one(q, ...b))[0] || 0;
    const live = "refunded_at IS NULL";
    const lines = ["<b>Статистика доната</b>",
      `Оплат: ${n(`SELECT COUNT(*) FROM payments WHERE ${live}`)}, звёзд: ${n(`SELECT COALESCE(SUM(stars),0) FROM payments WHERE ${live}`)}⭐ ` +
      `(за 24 ч: ${n(`SELECT COALESCE(SUM(stars),0) FROM payments WHERE ${live} AND created_at >= ?`, now() - 86400)}⭐), ` +
      `покупателей: ${n(`SELECT COUNT(DISTINCT user_id) FROM payments WHERE ${live}`)}`,
      `Возвратов: ${n("SELECT COUNT(*) FROM payments WHERE refunded_at IS NOT NULL")} ` +
      `(${n("SELECT COALESCE(SUM(stars),0) FROM payments WHERE refunded_at IS NOT NULL")}⭐)`];
    for (const r of this.rows(`SELECT product, COUNT(*) n, SUM(stars) s FROM payments WHERE ${live} GROUP BY product ORDER BY s DESC`)) {
      lines.push(`• ${esc(r.product)}: ${r.n} шт., ${r.s}⭐`);
    }
    const st = Object.fromEntries(this.rows("SELECT status, COUNT(*) n FROM codes GROUP BY status").map((r) => [r.status, r.n]));
    lines.push(`Коды: новых ${st.new || 0}, использовано ${st.used || 0}, отозвано ${st.revoked || 0}; ` +
      `подарочных всего ${n("SELECT COUNT(*) FROM codes WHERE source = 'gift'")}`);
    const bal = await this.tg("getMyStarBalance", {});
    if (bal.ok && bal.result) lines.push(`Баланс бота: ${bal.result.amount}⭐`);
    return this.say(chat, lines.join("\n"));
  }

  async cmdRefund(chat, args, adminId) {
    if (!args.length) {
      return this.say(chat, "Формат: <code>/refund CR-XXXX-XXXX</code> или <code>/refund &lt;charge_id&gt;</code>. " +
        "Если код уже использован, добавьте <code>force</code>.");
    }
    const pay = this.findPayment(args[0]);
    if (!pay) return this.say(chat, "Оплата не найдена.");
    if (pay.refunded_at) return this.say(chat, `Эта оплата уже возвращена ${fmtTime(pay.refunded_at)}.`);
    const codeRow = pay.code ? this.one("SELECT * FROM codes WHERE code = ?", pay.code) : null;
    if (codeRow && codeRow.status === "used" && !args.slice(1).includes("force")) {
      return this.say(chat, `⚠️ Код <code>${pay.code}</code> уже использован в игре (${esc(codeRow.used_by || "?")}). Награда выдана. ` +
        `Чтобы всё равно вернуть звёзды: <code>/refund ${pay.code} force</code>`);
    }
    const r = await this.tg("refundStarPayment", { user_id: pay.user_id, telegram_payment_charge_id: pay.charge_id });
    if (!r.ok) return this.say(chat, `Telegram отказал в возврате: ${esc(r.description || "ошибка")}`);
    const { prev } = this.markRefunded(pay.charge_id);
    console.log(`refund ${pay.charge_id} by admin ${adminId}, code ${pay.code} (was ${prev})`);
    await this.say(chat, `↩️ Возвращено ${pay.stars}⭐ пользователю ${pay.user_id}.` +
      (pay.code ? ` Код <code>${pay.code}</code> отозван (был: ${prev}).` : ""));
    await this.say(pay.user_id, `↩️ Вам вернули ${pay.stars}⭐.` + (pay.code ? ` Код <code>${pay.code}</code> больше не действует.` : ""));
  }
}
