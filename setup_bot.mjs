// Подключение Telegram-бота доната к Worker «Кристальный забег».
// Запускается из setup_bot.bat (Windows) или: node setup_bot.mjs
// 1) спрашивает токен бота и Telegram id админа, 2) кладёт их в секреты Worker,
// 3) заливает Worker, 4) включает webhook (Telegram -> Worker) и команды бота.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// line reader that also works with pasted / piped input (readline/promises drops buffered lines)
const lines = [], waiters = [];
let inputClosed = false;
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
rl.on("close", () => { inputClosed = true; while (waiters.length) waiters.shift()(null); });
function ask(prompt) {
  process.stdout.write(prompt);
  if (lines.length) return Promise.resolve(lines.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((res) => waiters.push(res));
}
async function question(prompt) {
  const l = await ask(prompt);
  if (l === null) fail("ввод закрыт.");
  return l.replace(/^\uFEFF/, "");
}
const isWin = process.platform === "win32";
const TG_API = process.env.CRYSTAL_TG_API || "https://api.telegram.org"; // override only for tests
process.chdir(dirname(fileURLToPath(import.meta.url))); // папка проекта: тут wrangler.toml

function fail(msg) {
  console.log("\nОШИБКА: " + msg);
  console.log("Сделай скриншот этого окна и пришли в чат.");
  process.exit(1);
}

async function tg(token, method, params) {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params || {}),
  });
  return res.json();
}

function wrangler(args, input) {
  const r = spawnSync(isWin ? "npx.cmd" : "npx", ["wrangler", ...args], {
    input, encoding: "utf8", shell: isWin, stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
  });
  const out = (r.stdout || "") + (r.stderr || "");
  return { ok: r.status === 0, out };
}

console.log("=== Подключение бота доната ===\n");
console.log("Нужен бот из @BotFather: /newbot -> имя -> username на ...bot -> он пришлёт токен.");
console.log("Включать Payments в BotFather НЕ нужно: звёзды (Stars) работают без этого.\n");

// 1. token
let token, me;
for (;;) {
  token = (await question("Вставь токен бота (вида 123456789:AA...): ")).trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) { console.log("Это не похоже на токен, попробуй ещё раз."); continue; }
  try {
    me = await tg(token, "getMe");
  } catch (e) {
    fail("нет связи с api.telegram.org: " + e.message);
  }
  if (me.ok) break;
  console.log("Telegram не принял токен (" + (me.description || "ошибка") + "). Проверь и вставь снова.");
}
const username = me.result.username;
console.log(`Бот найден: @${username}\n`);

// 2. admin id
console.log("Твой Telegram id (число) — для команд /stats, /gift, /refund.");
console.log("Узнать: напиши боту @userinfobot (или потом своему боту команду /myid). Можно оставить пустым.");
let admins = "";
for (;;) {
  admins = (await question("Telegram id админа (через запятую, если несколько): ")).trim().replace(/\s+/g, "");
  if (admins === "" || /^\d+(,\d+)*$/.test(admins)) break;
  console.log("Нужны только цифры, например 123456789");
}
const contact = (await question("Ник для вопросов о возврате, например @nick (можно пусто): ")).trim();
rl.close();

// 3. secrets (one version via `secret bulk`)
const secret = randomBytes(24).toString("base64url");
const secrets = { BOT_TOKEN: token, WEBHOOK_SECRET: secret, BOT_USERNAME: username, ADMIN_IDS: admins || "0" };
if (contact) secrets.SUPPORT_CONTACT = contact;
console.log("\n=== Сохраняю секреты в Cloudflare ===");
const put = wrangler(["secret", "bulk"], JSON.stringify(secrets)); // JSON via stdin: no temp file with the token
if (!put.ok) { console.log(put.out); fail("не удалось сохранить секреты (wrangler secret bulk)."); }
console.log("Секреты сохранены.");

// 4. deploy
console.log("\n=== Заливаю сервер (wrangler deploy) ===");
const dep = wrangler(["deploy"]);
console.log(dep.out.split("\n").filter((l) => /workers\.dev|Uploaded|Deployed|error|✘/i.test(l)).join("\n"));
if (!dep.ok) fail("wrangler deploy не прошёл.");
const m = dep.out.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/);
if (!m) fail("не нашёл адрес *.workers.dev в выводе wrangler deploy.");
const base = m[0];

// 5. webhook + commands
const path = "/tg/" + createHash("sha256").update("crystal-run-webhook:" + secret).digest("hex").slice(0, 32);
console.log("\n=== Включаю webhook ===");
// Telegram sometimes can't resolve a *.workers.dev address for a while right after deploy — retry with pauses.
// If Telegram's own DNS can't resolve the host, we resolve it here (DNS-over-HTTPS) and pass ip_address,
// which makes Telegram connect to that IP directly (TLS still uses the workers.dev name).
async function resolveIPv4(host) {
  for (const u of [`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, `https://dns.google/resolve?name=${host}&type=A`]) {
    try {
      const j = await (await fetch(u, { headers: { accept: "application/dns-json" } })).json();
      const a = (j.Answer || []).find((r) => r.type === 1);
      if (a) return a.data;
    } catch (e) { /* try next */ }
  }
  return null;
}
const hostName = new URL(base).hostname;
let wh = null, ip = null;
for (let attempt = 1; attempt <= 8; attempt++) {
  const params = {
    url: base + path, secret_token: secret, drop_pending_updates: true,
    allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  };
  if (ip) params.ip_address = ip;
  try {
    wh = await tg(token, "setWebhook", params);
  } catch (e) { wh = { ok: false, description: "нет связи с api.telegram.org: " + e.message }; }
  if (wh.ok) break;
  if (!ip && /resolve host/i.test(wh.description || "")) {
    ip = await resolveIPv4(hostName);
    if (ip) { console.log(`Telegram не может сам найти адрес сервера — подскажу ему IP ${ip} и попробую сразу.`); continue; }
  }
  console.log(`Попытка ${attempt}/8: Telegram пока не видит сервер (${wh.description || "ошибка"}). Жду 15 секунд...`);
  if (attempt < 8) await new Promise((r) => setTimeout(r, 15000));
}
if (!wh.ok) fail("setWebhook: " + (wh.description || "ошибка") + "\nПодожди 5 минут и запусти setup_bot.bat ещё раз.");
console.log("Webhook включён.");
await tg(token, "setMyCommands", { commands: [
  { command: "start", description: "Наборы кристаллов" },
  { command: "mycodes", description: "Мои коды" },
  { command: "paysupport", description: "Помощь с оплатой и возврат" },
  { command: "terms", description: "Условия" },
] });
let health = "";
try { health = await (await fetch(base + "/health")).text(); } catch (e) { /* ignore */ }
const info = await tg(token, "getWebhookInfo");

console.log("\nГОТОВО!");
console.log(`Бот:  https://t.me/${username}?start=donate   (напиши ему /start)`);
console.log(`Игра: ${base}/`);
console.log(`Сервер: ${health.trim() || "не ответил, проверь " + base + "/health"}`);
if (info.ok && info.result.last_error_message) console.log("Telegram пишет: " + info.result.last_error_message);
console.log("\nКнопка «Поддержать» в игре сама откроет этого бота.");
