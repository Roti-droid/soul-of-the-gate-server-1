// node site_news.mjs <game src/news.js> [max live version]   (run AFTER public/CrystalRun.apk is in place: its size goes into news.json too)
// -> public/site/news.json (the website «Новости»: the game's own changelog, newest first)
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(process.argv[2] || "/home/claude/game3d/src/news.js", "utf8");
const m = /var NEWS = (\[[\s\S]*?\n\]);/.exec(src);
if (!m) throw new Error("NEWS array not found");
// optional 2nd arg: the newest game version that is live (e.g. 2.3.13) — newer (beta) entries are left out
const vnum = (v) => String(v).split(".").map((x) => parseInt(x, 10) || 0).reduce((a, x) => a * 1000 + x, 0);
const MAXV = process.argv[3] ? vnum(process.argv[3]) : Infinity;
const NEWS = vm.runInNewContext("(" + m[1] + ")", {}).filter((n) => vnum(n.v) <= MAXV);
const pick = (l) => (l || []).map((x) => ({ ru: x.ru, en: x.en || x.ru }));
const apkPath = new URL("./public/CrystalRun.apk", import.meta.url);
const apk = existsSync(apkPath) ? { size: statSync(apkPath).size } : null;
const out = { apk, at: new Date().toISOString().slice(0, 10), items: NEWS.slice(0, 12).map((n) => ({ v: n.v, date: n.date, added: pick(n.added), fixed: pick(n.fixed) })) };
writeFileSync(new URL("./public/site/news.json", import.meta.url), JSON.stringify(out));
console.log("news.json:", out.items.length, "entries, latest", out.items[0].v);
