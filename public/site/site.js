/* Soul of the Gate — official site: client routing, chapters, downloads, news, sign-in, developer cabinet. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PAGES = { "/": "home", "/chapters": "chapters", "/vcr": "vcr", "/download": "download", "/news": "news", "/login": "login", "/account": "account", "/dev": "dev" };
  var TITLES = { home: "Soul of the Gate — Душа Врат", chapters: "Главы · Soul of the Gate", vcr: "Видеомагнитофон · Soul of the Gate", download: "Скачать · Soul of the Gate",
    news: "Новости · Soul of the Gate", login: "Вход · Soul of the Gate", account: "Аккаунт · Soul of the Gate", dev: "Кабинет · Soul of the Gate" };
  var ME = null, GOOGLE = false, FILES = null, NEWS = null, cur = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function toast(t) { var x = $("toast"); x.textContent = t; x.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(function () { x.classList.remove("show"); }, 3200); }
  function size(n) { if (!n) return "—"; if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " КБ"; return (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0).replace(".", ",") + " МБ"; }
  function date(t) { if (!t) return ""; var d = new Date(t * 1000); return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear(); }
  function api(path, opt) {
    opt = opt || {};
    var h = { "x-sotg": "1" };
    if (opt.json !== undefined) h["content-type"] = "application/json";
    return fetch("/site/api/" + path, { method: opt.method || "GET", headers: h, credentials: "same-origin",
      body: opt.json !== undefined ? JSON.stringify(opt.json) : opt.body })
      .then(function (r) { return r.json().catch(function () { return { err: "Ошибка сервера" }; }).then(function (j) { j._s = r.status; return j; }); })
      .catch(function () { return { err: "Нет связи с сервером", _s: 0 }; });
  }

  // ---------------------------------------------------------------- router + transitions
  function go(path, push) {
    var page = PAGES[path.split("?")[0].replace(/\/+$/, "") || "/"] || "home";
    if (push) history.pushState({}, "", path);
    var next = document.querySelector('.page[data-page="' + page + '"]');
    var prev = cur && cur !== next ? cur : null;
    var show = function () {
      document.querySelectorAll(".page").forEach(function (p) { p.hidden = p !== next; p.classList.remove("leaving"); });
      next.style.animation = "none"; void next.offsetWidth; next.style.animation = "";
      cur = next; document.title = TITLES[page];
      if (page !== "vcr" && PARC) PARC.close();
      document.querySelectorAll(".nav a[data-page]").forEach(function (a) { a.classList.toggle("on", a.dataset.page === page || (page === "account" || page === "dev") && a.id === "navUser"); });
      if (push) window.scrollTo(0, 0);
      enter(page); reveal();
    };
    $("nav").classList.remove("open"); $("burger").setAttribute("aria-expanded", "false");
    if (prev && !RM) { prev.classList.add("leaving"); setTimeout(show, 200); } else show();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-link]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault(); go(a.getAttribute("href"), true);
  });
  window.addEventListener("popstate", function () { go(location.pathname, false); });
  $("burger").addEventListener("click", function () { var o = $("nav").classList.toggle("open"); this.setAttribute("aria-expanded", o ? "true" : "false"); });

  var io = "IntersectionObserver" in window && !RM ? new IntersectionObserver(function (es) {
    es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } });
  }, { rootMargin: "0px 0px -8% 0px" }) : null;
  function reveal() { document.querySelectorAll(".reveal:not(.in)").forEach(function (r) { if (io) io.observe(r); else r.classList.add("in"); }); }

  function enter(page) {
    if (page === "home") { renderChapters($("homeChapters"), true); loadNews().then(function () { renderNews($("homeNews"), 3); }); }
    if (page === "chapters") renderChapters($("chapters"), false);
    if (page === "vcr") archiveOpen(null, $("vcrHost"));
    if (page === "download") loadFiles().then(renderFiles);
    if (page === "news") loadNews().then(function () { renderNews($("news"), 99); });
    if (page === "login") renderLogin();
    if (page === "account") renderAccount();
    if (page === "dev") renderDev();
  }

  // ---------------------------------------------------------------- chapters (1 is out; 2–10 are locked: never shown as released)
  function renderChapters(box, mini) {
    // a chapter is open when chapter 1 (always) or when a published file exists for it; its name comes from that file's game
    var draw = function () {
      var by = {};
      (FILES || []).forEach(function (f) { var c = +f.chapter || 0; if (c >= 1 && c <= 10 && !by[c]) by[c] = f; });
      var h = "";
      for (var i = 1; i <= 10; i++) {
        var n = "ГЛАВА " + (i < 10 ? "0" + i : i), f = by[i];
        if (i === 1 || f) {
          var name = i === 1 ? "Soul of the Gate — Chapter&nbsp;1" : esc(f.game || "Soul of the Gate") + " — Chapter&nbsp;" + i;
          var paidOnly = f && (FILES || []).filter(function (x) { return +x.chapter === i; }).every(function (x) { return x.paid; });
          var st = paidOnly && i !== 1 ? '<span class="st paid">КУПИТЬ</span>' : '<span class="st">ДОСТУПНА</span>';
          h += '<a class="ch open reveal" href="/download?ch=' + i + '" data-link><span class="num">' + n + '</span><img src="/site/img/gate.svg" alt="">' +
            '<span class="name">' + name + '</span>' + st + '</a>';
        } else {
          h += '<div class="ch locked reveal" aria-label="Глава ' + i + ': скоро"><span class="num">' + n + '</span><img src="/site/img/locked.svg" alt="">' +
            '<span class="name">???</span><span class="st">СКОРО</span></div>';
        }
        if (mini && i === 6) break;
      }
      box.innerHTML = h;
      reveal();
    };
    draw();
    loadFiles().then(draw);
  }

  // ---------------------------------------------------------------- downloads
  function loadFiles() { return api("files").then(function (r) { FILES = r.ok ? r.files : []; if (!r.ok) FILES.err = r.err; }); }
  var PLAT = { android: "ANDROID", pc: "ПК", other: "ДРУГОЕ" };
  function fileRow(f) {
    var row = el("div", "frow");
    var meta = [];
    if (f.version) meta.push("версия " + esc(f.version));
    meta.push(size(f.size));
    if (f.created_at) meta.push(date(f.created_at));
    meta.push(esc(f.filename));
    row.innerHTML = '<span class="plat ' + esc(f.platform) + '">' + (PLAT[f.platform] || "ДРУГОЕ") + '</span>' +
      '<div><div class="ftitle">' + esc(f.title) + '</div><div class="fmeta">' + meta.map(function (m) { return "<span>" + m + "</span>"; }).join("") + '</div>' +
      (f.notes ? '<div class="fnotes">' + esc(f.notes) + '</div>' : "") + '</div>' +
      '<div class="fact">' + (f.paid ? '<span class="price">' + esc(f.price) + ' ГРН</span>' : '<span class="free">БЕСПЛАТНО</span>') + '</div>';
    var act = row.querySelector(".fact");
    if (!f.paid || (ME && ME.owner)) {
      var a = el("a", "btn btn-main btn-sm", f.paid ? "Скачать (вы владелец)" : "Скачать");
      a.href = f.url; a.setAttribute("download", f.filename);
      act.appendChild(a);
    } else {
      var b = el("button", "btn btn-sm off", "Купить · скоро");
      b.type = "button"; b.title = "Оплата через Google Pay / Monobank скоро появится";
      b.addEventListener("click", function () {
        api("buy/" + f.id, { method: "POST", json: {} }).then(function (r) {
          if (r.ok && r.url) location.href = r.url;
          else toast(r.code === "auth" ? "Сначала войдите в аккаунт" : "Оплата скоро появится");
        });
      });
      act.appendChild(b);
    }
    return row;
  }
  function renderFiles() {
    var box = $("files"); box.innerHTML = "";
    if (FILES.err) { box.innerHTML = '<p class="msg err">' + esc(FILES.err) + "</p>"; return; }
    if (!FILES.length) { box.innerHTML = '<p class="muted">Файлов пока нет.</p>'; return; }
    var groups = {}, order = [];
    var want = 0; try { want = +new URLSearchParams(location.search).get("ch") || 0; } catch (e) { /* old browser */ }
    var list = want ? FILES.filter(function (f) { return (+f.chapter || 0) === want; }) : FILES.slice();
    if (want && !list.length) { box.innerHTML = '<p class="muted">Для этой главы файлов пока нет.</p>'; return; }
    list.sort(function (a, b) { return (+a.chapter || 0) - (+b.chapter || 0); });
    if (want) { var all = el("a", "btn btn-sm", "← Все главы"); all.href = "/download"; all.setAttribute("data-link", ""); box.appendChild(all); }
    list.forEach(function (f) {
      var k = f.game + "|" + f.chapter;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(f);
    });
    order.forEach(function (k) {
      var g = el("div", "fgroup reveal"), f0 = groups[k][0];
      g.appendChild(el("h3", "", esc(f0.game) + (f0.chapter ? " · Глава " + esc(f0.chapter) : "")));
      groups[k].sort(function (a, b) { return ["android", "pc", "other"].indexOf(a.platform) - ["android", "pc", "other"].indexOf(b.platform); })
        .forEach(function (f) { g.appendChild(fileRow(f)); });
      box.appendChild(g);
    });
    reveal();
  }

  // ---------------------------------------------------------------- news (the game's own changelog)
  function loadNews() {
    if (NEWS) return Promise.resolve();
    return fetch("/site/news.json").then(function (r) { return r.json(); }).then(function (j) { NEWS = j.items || []; }).catch(function () { NEWS = []; });
  }
  function renderNews(box, n) {
    box.innerHTML = "";
    (NEWS || []).slice(0, n).forEach(function (it) {
      var d = el("article", "ni reveal");
      var li = (it.added || []).map(function (x) { return "<li>" + esc(x.ru) + "</li>"; }).join("") +
        (it.fixed || []).map(function (x) { return '<li class="fx">' + esc(x.ru) + "</li>"; }).join("");
      d.innerHTML = "<h3>Версия " + esc(it.v) + "<span>" + esc(it.date) + "</span></h3><ul>" + li + "</ul>";
      box.appendChild(d);
    });
    if (!box.children.length) box.innerHTML = '<p class="muted">Новостей пока нет.</p>';
    reveal();
  }

  // ---------------------------------------------------------------- sign-in
  var ERRS = { google_off: "Вход через Google пока не настроен.", google_gone: "Вход через Google устарел. Попробуйте ещё раз.",
    google_denied: "Вход через Google отменён.", google_token: "Google не подтвердил вход. Попробуйте ещё раз.",
    google_nolink: "К этому Google не привязан игровой аккаунт. Привяжите Google в игре: Профиль → «Привязать Google».",
    google_fail: "Не получилось войти через Google." };
  function localAcc() {
    try { var s = JSON.parse(localStorage.getItem("crystalRun.save.v2") || "null"); var a = s && s.acc; return a && a.id && a.secret ? a : null; } catch (e) { return null; }
  }
  function signedIn(u) {
    ME = u; updateNav();
    toast("Вы вошли" + (u.nick ? ": " + u.nick : ""));
    go(u.owner ? "/dev" : "/account", true);
  }
  function loginErr(t) { var e = $("loginErr"); e.textContent = t || ""; e.hidden = !t; }
  function renderLogin() {
    if (ME) { go(ME.owner ? "/dev" : "/account", false); history.replaceState({}, "", ME.owner ? "/dev" : "/account"); return; }
    var q = new URLSearchParams(location.search);
    loginErr(ERRS[q.get("err")] || "");
    $("gpwBox").hidden = q.get("step") !== "pw";
    $("gBox").hidden = !GOOGLE;
    var la = localAcc();
    $("localBox").hidden = !la;
    if (la) $("localNick").textContent = la.nick || "ID …" + String(la.id).slice(-4);
  }
  function doLogin(body, btn) {
    if (btn) btn.disabled = true;
    loginErr("");
    return api("login", { method: "POST", json: body }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.ok) signedIn(r.user); else loginErr(r.err || "Не получилось войти");
    });
  }
  $("localBtn").addEventListener("click", function () { var a = localAcc(); if (a) doLogin({ kind: "session", id: a.id, secret: a.secret }, this); });
  $("pwForm").addEventListener("submit", function (e) { e.preventDefault(); doLogin({ kind: "pw", login: this.login.value.trim(), pw: this.pw.value }, this.querySelector("button")); this.pw.value = ""; });
  $("codeForm").addEventListener("submit", function (e) { e.preventDefault(); doLogin({ kind: "code", code: this.code.value.trim() }, this.querySelector("button")); });
  $("gpwForm").addEventListener("submit", function (e) { e.preventDefault(); doLogin({ kind: "gpw", pw: this.pw.value }, this.querySelector("button")); this.pw.value = ""; });

  function updateNav() {
    var n = $("navUser");
    if (ME) { n.textContent = ME.owner ? "Кабинет" : (ME.nick || "Аккаунт"); n.href = ME.owner ? "/dev" : "/account"; }
    else { n.textContent = "Войти"; n.href = "/login"; }
  }
  function renderAccount() {
    var b = $("accBox");
    if (!ME) { b.innerHTML = '<p>Вы не вошли.</p><a class="btn btn-main" href="/login" data-link>Войти</a>'; return; }
    b.innerHTML = '<h3>' + esc(ME.nick || "Игрок") + '</h3><p class="muted">ID аккаунта: …' + esc(ME.id4) + "</p>" +
      (ME.owner ? '<p><a class="btn btn-main" href="/dev" data-link>Кабинет разработчика</a></p>' : "") +
      '<p><button class="btn" id="logoutBtn" type="button">Выйти</button></p>';
    $("logoutBtn").addEventListener("click", logout);
  }
  function logout() { api("logout", { method: "POST", json: {} }).then(function () { ME = null; updateNav(); toast("Вы вышли"); go("/", true); }); }

  // ---------------------------------------------------------------- developer cabinet (the server checks the owner on every call)
  function renderDev() {
    var gate = $("devGate"), body = $("devBody");
    if (!ME || !ME.owner) {
      body.hidden = true; gate.hidden = false;
      gate.innerHTML = ME ? '<h3>Нет доступа</h3><p class="muted">Кабинет только для разработчика игры.</p>'
        : '<h3>Нужен вход</h3><p class="muted">Войдите аккаунтом разработчика.</p><a class="btn btn-main" href="/login" data-link>Войти</a>';
      return;
    }
    gate.hidden = true; body.hidden = false;
    loadDevFiles(); devCipher();
  }
  function loadDevFiles() {
    var box = $("devFiles");
    api("dev/files").then(function (r) {
      box.innerHTML = "";
      if (!r.ok) { box.innerHTML = '<p class="msg err">' + esc(r.err) + "</p>"; return; }
      if (!r.files.length) { box.innerHTML = '<p class="muted">Загруженных файлов нет. Пока на сайте показывается встроенный CrystalRun.apk (Глава 1 · Android).</p>'; return; }
      r.files.forEach(function (f) { box.appendChild(devRow(f)); });
    });
  }
  function devRow(f) {
    var d = el("div", "df" + (f.published ? " pub" : ""));
    var st = f.status !== "ready" ? '<span class="badge up">НЕ ДОГРУЖЕН</span>' : f.published ? '<span class="badge on">ОПУБЛИКОВАН</span>' : '<span class="badge off">СКРЫТ</span>';
    d.innerHTML = '<div><div class="ftitle">' + st + esc(f.title) + '</div><div class="fmeta"><span>' + esc(f.game) + " · гл. " + esc(f.chapter) + " · " +
      (PLAT[f.platform] || "") + "</span><span>" + (f.version ? "v" + esc(f.version) : "без версии") + "</span><span>" + size(f.size) + "</span><span>" + date(f.created_at) +
      "</span><span>" + (f.paid ? esc(f.price) + " грн" : "бесплатно") + "</span><span>скачиваний: " + esc(f.downloads) + "</span></div></div>" +
      '<div class="acts"></div>';
    var acts = d.querySelector(".acts");
    var btn = function (t, cls, fn) { var b = el("button", "btn btn-sm " + (cls || ""), t); b.type = "button"; b.addEventListener("click", fn); acts.appendChild(b); return b; };
    if (f.status === "ready") {
      btn(f.published ? "Скрыть" : "Опубликовать", f.published ? "" : "btn-main", function () {
        api("dev/files/" + f.id, { method: "PATCH", json: { published: !f.published } }).then(function (r) { if (!r.ok) toast(r.err); loadDevFiles(); FILES = null; });
      });
      var a = el("a", "btn btn-sm", "Скачать"); a.href = "/dl/" + f.id + "/" + encodeURIComponent(f.filename); acts.appendChild(a);
    }
    btn("Изменить", "", function () { toggleEdit(d, f); });
    btn("Удалить", "", function () {
      if (!confirm("Удалить «" + f.title + "»? Это нельзя отменить.")) return;
      api("dev/files/" + f.id, { method: "DELETE" }).then(function (r) { toast(r.ok ? "Удалено" : r.err); loadDevFiles(); FILES = null; });
    });
    return d;
  }
  function toggleEdit(d, f) {
    var ex = d.querySelector(".edit");
    if (ex) { ex.remove(); return; }
    var e = el("form", "edit grid-form");
    e.innerHTML = '<label>Название<input name="title" maxlength="100"></label><label>Игра<input name="game" maxlength="60" list="games"></label>' +
      '<label>Глава<input name="chapter" type="number" min="0" max="99"></label><label>Платформа<select name="platform"><option value="android">Android (APK)</option><option value="pc">ПК</option><option value="other">Другое</option></select></label>' +
      '<label>Версия<input name="version" maxlength="30"></label><label>Цена, грн<input name="price" type="number" min="0" max="100000"></label>' +
      '<label class="row"><input type="checkbox" name="paid"> Платный</label><label class="full">Заметки<textarea name="notes" rows="3" maxlength="2000"></textarea></label>' +
      '<div class="full up-actions"><button class="btn btn-main btn-sm" type="submit">Сохранить</button></div>';
    ["title", "game", "chapter", "platform", "version", "price", "notes"].forEach(function (k) { e[k].value = f[k] == null ? "" : f[k]; });
    e.paid.checked = !!f.paid;
    e.addEventListener("submit", function (ev) {
      ev.preventDefault();
      api("dev/files/" + f.id, { method: "PATCH", json: { title: e.title.value, game: e.game.value, chapter: +e.chapter.value, platform: e.platform.value,
        version: e.version.value, price: +e.price.value || 0, paid: e.paid.checked, notes: e.notes.value } })
        .then(function (r) { toast(r.ok ? "Сохранено" : r.err); if (r.ok) { loadDevFiles(); FILES = null; } });
    });
    d.appendChild(e);
  }

  // chunked upload: 1 MiB pieces, SHA-256 of each checked by the server, 3 at a time, 4 tries each
  function hexOf(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function putChunk(id, n, blob) {
    return blob.arrayBuffer().then(function (ab) {
      return crypto.subtle.digest("SHA-256", ab).then(function (h) {
        return fetch("/site/api/dev/files/" + id + "/chunk/" + n, { method: "PUT", credentials: "same-origin",
          headers: { "x-sotg": "1", "x-chunk-sha256": hexOf(h), "content-type": "application/octet-stream" }, body: ab })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.err || "HTTP " + r.status); }); });
      });
    });
  }
  function upload(file, meta, onProg) {
    return api("dev/files", { method: "POST", json: Object.assign({}, meta, { filename: file.name, ctype: file.type, size: file.size }) }).then(function (r) {
      if (!r.ok) throw new Error(r.err || "Не получилось начать загрузку");
      var id = r.id, CH = r.chunk, total = r.nchunks, next = 0, done = 0;
      var worker = function () {
        if (next >= total) return Promise.resolve();
        var n = next++, blob = file.slice(n * CH, Math.min(file.size, (n + 1) * CH));
        var attempt = function (k) {
          return putChunk(id, n, blob).catch(function (e) { if (k >= 3) throw e; return new Promise(function (res) { setTimeout(res, 800 * (k + 1)); }).then(function () { return attempt(k + 1); }); });
        };
        return attempt(0).then(function () { done++; onProg(done / total); return worker(); });
      };
      return Promise.all([worker(), worker(), worker()]).then(function () { return api("dev/files/" + id + "/finish", { method: "POST", json: {} }); })
        .then(function (fr) { if (!fr.ok) throw new Error(fr.err || "Файл не собрался"); return id; });
    });
  }
  var upForm = $("upForm");
  $("upFile").addEventListener("change", function () {
    var f = this.files[0];
    $("dropText").textContent = f ? f.name + " · " + size(f.size) : "Выберите файл или перетащите его сюда (до 200 МБ)";
    if (f && !upForm.title.value) upForm.title.value = f.name.replace(/\.[a-z0-9]+$/i, "");
    if (f && /\.apk$/i.test(f.name)) upForm.platform.value = "android";
    else if (f && /\.(exe|msi|zip|7z)$/i.test(f.name)) upForm.platform.value = "pc";
  });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) { $("upFile").files = e.dataTransfer.files; $("upFile").dispatchEvent(new Event("change")); } });
  upForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var file = $("upFile").files[0];
    if (!file) { toast("Выберите файл"); return; }
    if (file.size > 200 * 1048576) { toast("Файл больше 200 МБ"); return; }
    var meta = { title: upForm.title.value, game: upForm.game.value, chapter: +upForm.chapter.value || 0, platform: upForm.platform.value,
      version: upForm.version.value, notes: upForm.notes.value, paid: upForm.paid.checked, price: +upForm.price.value || 0 };
    var pub = upForm.publish.checked, bar = $("upBar"), st = $("upStatus"), b = $("upBtn");
    b.disabled = true; bar.hidden = false; bar.firstChild.style.width = "0";
    st.textContent = "Загрузка… 0%";
    upload(file, meta, function (p) { bar.firstChild.style.width = Math.round(p * 100) + "%"; st.textContent = "Загрузка… " + Math.round(p * 100) + "%"; })
      .then(function (id) { return pub ? api("dev/files/" + id, { method: "PATCH", json: { published: true } }) : null; })
      .then(function () { st.textContent = "Готово!"; toast("Файл загружен"); upForm.reset(); $("dropText").textContent = "Выберите файл или перетащите его сюда (до 200 МБ)"; FILES = null; loadDevFiles(); })
      .catch(function (err) { st.textContent = "Ошибка: " + err.message; })
      .then(function () { b.disabled = false; setTimeout(function () { bar.hidden = true; }, 1500); });
  });

  // ---------------------------------------------------------------- pixel starfield (pauses when hidden; static with reduced motion)
  (function stars() {
    var c = $("stars"), x = c.getContext("2d"), S = [], w = 0, h = 0, dpr = 1;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1); w = innerWidth; h = innerHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      var n = Math.round(Math.min(140, w * h / 9000)); S = [];
      for (var i = 0; i < n; i++) S.push({ x: Math.random() * w, y: Math.random() * h, s: Math.random() < 0.15 ? 3 : Math.random() < 0.5 ? 2 : 1, p: Math.random() * 6.28, v: 0.4 + Math.random() * 1.4, dy: 0.03 + Math.random() * 0.12 });
    }
    function draw(t) {
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      for (var i = 0; i < S.length; i++) {
        var s = S[i], a = RM ? 0.6 : 0.25 + 0.75 * Math.abs(Math.sin(s.p + t * 0.001 * s.v));
        if (!RM) { s.y -= s.dy; if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; } }
        x.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")";
        x.fillRect(Math.round(s.x), Math.round(s.y), s.s, s.s);
        if (s.s === 3 && a > 0.85) { x.fillRect(Math.round(s.x) - 2, Math.round(s.y) + 1, 7, 1); x.fillRect(Math.round(s.x) + 1, Math.round(s.y) - 2, 1, 7); }
      }
      if (!RM && !document.hidden) requestAnimationFrame(draw);
    }
    resize(); addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !RM) requestAnimationFrame(draw); });
    requestAnimationFrame(draw);
  })();


  // ---------------------------------------------------------------- secret: type the name of a certain scientist, or tap the gate icon 5 times.
  // The message is written in the Gate cipher — an original pixel alphabet (4×5 glyphs, generated below); the key hides in the footer.
  var GW = 5, GH = 7;
  var GLYPH = (function () {      // rune-like: a stem, a top bar of varying length, two branches and sometimes a dot
    var out = {}, seen = {}, seed = 1337;
    function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return Math.floor(seed / 0x7fffffff * n); }
    var ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";   // the letters first (unchanged), then the same hand writes the digits
    for (var ci = 0; ci < ABC.length; ci++) {
      var g, k;
      do {
        g = []; for (k = 0; k < GW * GH; k++) g.push(0);
        var set = function (x, y) { if (x >= 0 && x < GW && y >= 0 && y < GH) g[y * GW + x] = 1; };
        var st = 1 + rnd(3), y, x;
        for (y = 0; y < GH; y++) set(st, y);
        var l = rnd(2) ? 0 : st, r = rnd(2) ? GW - 1 : st;
        for (x = l; x <= r; x++) set(x, 0);
        for (var br = 0; br < 2; br++) {
          var by = 2 + rnd(GH - 2), dir = rnd(2) ? 1 : -1, len = 1 + rnd(2);
          for (x = 1; x <= len; x++) set(st + dir * x, by);
          if (rnd(3) === 0) set(st + dir * len, by - 1);
        }
        if (rnd(3) === 0) set(rnd(2) ? 0 : GW - 1, GH - 1 - rnd(2) * 2);
      } while (seen[g.join("")]);
      seen[g.join("")] = 1; out[ABC[ci]] = g;
    }
    return out;
  })();
  // extra signs of the same hand: a full stop and the unknown
  GLYPH["."] = [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0];
  GLYPH["?"] = [0,1,1,1,0, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,1,0,0];
  GLYPH[","] = [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,1,0,0,0];
  GLYPH[":"] = [0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0];
  GLYPH["-"] = [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,1,1,1,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0];
  GLYPH["!"] = [0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,1,0,0];
  GLYPH["*"] = [0,0,0,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,0,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0];   // a spark of light
  GLYPH[">"] = [1,0,0,0,0, 1,1,0,0,0, 1,1,1,0,0, 1,1,1,1,0, 1,1,1,0,0, 1,1,0,0,0, 1,0,0,0,0];   // go
  function glyphSvg(ch, cls) {
    var g = GLYPH[ch]; if (!g) return '<span class="gsp"></span>';
    var r = "";
    for (var i = 0; i < GW * GH; i++) if (g[i]) r += '<rect x="' + (i % GW) + '" y="' + Math.floor(i / GW) + '" width="1" height="1"/>';
    return '<svg class="' + (cls || "gl") + '" viewBox="0 0 ' + GW + " " + GH + '" shape-rendering="crispEdges" aria-hidden="true">' + r + "</svg>";
  }
  (function key() {   // the faint key in the footer: letter → glyph
    var k = $("gateKey"); if (!k) return;
    var h = "";
    for (var c = 65; c <= 90; c++) { var ch = String.fromCharCode(c); h += "<span>" + ch + glyphSvg(ch, "gk") + "</span>"; }
    h += "<span>." + glyphSvg(".", "gk") + "</span>";
    k.innerHTML = h;
  })();
  var eggOpen = false;
  function egg() {
    if (eggOpen) return; eggOpen = true;
    var o = el("div", "egg"), msg = "TOBY DOG", h = "";
    for (var i = 0; i < msg.length; i++) h += msg[i] === " " ? '<span class="gsp"></span>' : '<span class="gw" style="animation-delay:' + (0.6 + i * 0.18).toFixed(2) + 's">' + glyphSvg(msg[i]) + "</span>";
    o.innerHTML = '<div class="egg-msg" role="img" aria-label="Шифр Врат">' + h + '</div><p class="egg-hint">* ...</p>' +
      '<button class="egg-q" type="button" aria-label="?">' + glyphSvg("?", "egg-qg") + "</button>" +
      '<button class="egg-x" type="button" aria-label="Закрыть">✕</button>';
    o.tabIndex = -1;
    document.body.appendChild(o);
    document.body.classList.add("glitching");
    setTimeout(function () { document.body.classList.remove("glitching"); }, RM ? 0 : 900);
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
    var close = function () {
      o.classList.remove("on"); eggOpen = false;
      document.removeEventListener("keydown", esc2);
      setTimeout(function () { o.remove(); }, RM ? 0 : 400);
    };
    var esc2 = function (e) { if (e.key === "Escape") close(); };
    var mc = [];
    var openedAt = Date.now();
    o.addEventListener("click", function (e) {
      if (Date.now() - openedAt < 600) return;   // the tap that opened it must not close it
      var t = e.target.closest ? e.target : e.target.parentNode;
      if (t.closest(".egg-x")) { close(); return; }
      if (t.closest(".egg-q")) { close(); shardsOpen(); return; }
      if (t.closest(".egg-msg")) {     // three clicks on the message open the door behind the door
        var n = Date.now(); mc = mc.filter(function (v) { return n - v < 1500; }); mc.push(n);
        if (mc.length >= 3) { close(); shardsOpen(); }
        return;
      }
      // only the ✕ closes it
    });
    document.addEventListener("keydown", esc2);
  }
  var typed = "";
  document.addEventListener("keydown", function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!e.key || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-6);
    if (typed === "gaster") { typed = ""; egg(); }
  });
  var taps = [];
  // 5 quick taps on the logo (gate icon OR the «SOUL OF THE GATE» text) or on the big gate on the home page.
  // Counted on pointerup so double-tap zoom / selection can't eat them; on the home page the logo doesn't navigate.
  function tapGate(e) {
    if (e.pointerType === "mouse" && e.button) return;
    var t = Date.now(); taps = taps.filter(function (x) { return t - x < 3000; }); taps.push(t);
    if (taps.length >= 5) { taps = []; egg(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll(".brand, .hero-gate img"), function (n) {
    n.addEventListener("pointerup", tapGate);
    n.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  });
  document.querySelector(".brand").addEventListener("click", function (e) {
    if (location.pathname === "/" || /index\.html$/.test(location.pathname)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------------------------------------------------------------- the egg inside the egg: «Осколки Врат» → a sealed file → the one whose name was erased.
  // Entry: in the cipher overlay click the message 3 times, or the faint flickering «?» glyph in its corner.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  var K_BEST = "sotg.shards.best", K_SND = "sotg.shards.snd", K_SEEN = "sotg.file0";
  var LORE = "HIS NAME WAS ERASED. HE WALKED THROUGH THE GATE. ONLY THE SOUL CAME BACK. HE IS STILL WATCHING.";

  // ---- tiny WebAudio beeper: on unless the visitor muted it once (the first sound always follows a tap)
  var SND = { on: lsGet(K_SND) !== "0", ac: null, hum: null, laugh: null };
  function ac() {
    if (!SND.ac) { try { var A = window.AudioContext || window.webkitAudioContext; SND.ac = A ? new A() : null; } catch (e) { SND.ac = null; } }
    if (SND.ac && SND.ac.state === "suspended") SND.ac.resume();
    return SND.ac;
  }
  function beep(f, d, type, vol, slide) {
    if (!SND.on) return; var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type || "square"; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function humStart() {
    if (!SND.on || SND.hum) return; var a = ac(); if (!a) return;
    var g = a.createGain(); g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.06, a.currentTime + 2);
    var o1 = a.createOscillator(), o2 = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain();
    o1.type = "sine"; o1.frequency.value = 46; o2.type = "triangle"; o2.frequency.value = 92.7;
    lfo.frequency.value = 0.23; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(a.destination); o1.start(); o2.start(); lfo.start();
    SND.hum = { g: g, o: [o1, o2, lfo] };
  }
  function humStop() {
    var h = SND.hum; if (!h) return; SND.hum = null;
    try { var t = SND.ac.currentTime; h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      h.o.forEach(function (o) { o.stop(t + 0.7); }); } catch (e) { /* already stopped */ }
  }
  // ---- the laugh from the dark: synthesized on the spot (saw + tritone square through two vowel formants,
  // a breathy noise onset, ring-mod buzz, a quantizing "crusher" and a short echo). Syllables speed up, then one long falling HA.
  var NOISE = null;
  function noiseBuf(a) {
    if (NOISE) return NOISE;
    var b = a.createBuffer(1, a.sampleRate | 0, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (NOISE = b);
  }
  function crushCurve(lv) { var n = 2048, c = new Float32Array(n); for (var i = 0; i < n; i++) { var v = i / (n - 1) * 2 - 1; c[i] = Math.round(v * lv) / lv; } return c; }
  function laughPlan() {      // times in seconds from the laugh's start; the face uses the same plan to move its mouth
    var out = [], t = 0, gap = 0.25;
    for (var i = 0; i < 9; i++) {
      out.push({ t: t, d: Math.max(0.07, gap * 0.8), v: i < 3 ? "e" : "a", st: i === 2 || i === 5, f: 150 * (1 + i * 0.05) * (1 + 0.12 * Math.sin(i * 2.3)) * (0.92 + Math.random() * 0.16) });
      t += gap; gap *= 0.85;
    }
    out.push({ t: t + 0.05, d: 0.6, v: "a", f: 240, dive: 1 });
    return out;
  }
  function laughPlay(plan, when, vol) {
    if (!SND.on) return; var a = ac(); if (!a) return; laughStop();
    try {
      var t0 = a.currentTime + when, last = plan[plan.length - 1], tEnd = t0 + last.t + last.d + 0.8;
      var out = a.createGain(); out.gain.value = vol || 0.55;
      var comp = a.createDynamicsCompressor(); out.connect(comp); comp.connect(a.destination);
      var bus = a.createGain(), ring = a.createGain(); ring.gain.value = 0.65;
      var rm = a.createOscillator(), rmg = a.createGain(); rm.type = "square"; rm.frequency.value = 53; rmg.gain.value = 0.35; rm.connect(rmg); rmg.connect(ring.gain);
      var crush = a.createWaveShaper(); crush.curve = crushCurve(7);
      var dl = a.createDelay(0.5), fb = a.createGain(), wet = a.createGain(); dl.delayTime.value = 0.13; fb.gain.value = 0.3; wet.gain.value = 0.35;
      bus.connect(ring); ring.connect(crush); crush.connect(out); crush.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(out);
      rm.start(t0); rm.stop(tEnd);
      var FM = { e: [530, 1850], a: [800, 1250] };
      var voice = function (vw, at, dur, f0, f1) {
        at = Math.max(a.currentTime + 0.01, at);
        var o1 = a.createOscillator(), o2 = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), lg2 = a.createGain(), g2 = a.createGain(), mix = a.createGain();
        o1.type = "sawtooth"; o2.type = "square";
        o1.frequency.setValueAtTime(f0, at); o1.frequency.exponentialRampToValueAtTime(f1, at + dur);
        o2.frequency.setValueAtTime(f0 * 1.414, at); o2.frequency.exponentialRampToValueAtTime(f1 * 1.414, at + dur);
        lfo.frequency.value = 10 + Math.random() * 5; lg.gain.value = f0 * 0.07; lg2.gain.value = f0 * 0.1;
        lfo.connect(lg); lg.connect(o1.frequency); lfo.connect(lg2); lg2.connect(o2.frequency);
        g2.gain.value = 0.25; o1.connect(mix); o2.connect(g2); g2.connect(mix);
        var b1 = a.createBiquadFilter(), b2 = a.createBiquadFilter(), b2g = a.createGain(), env = a.createGain();
        b1.type = b2.type = "bandpass"; b1.frequency.value = FM[vw][0]; b1.Q.value = 6; b2.frequency.value = FM[vw][1]; b2.Q.value = 9; b2g.gain.value = 0.7;
        mix.connect(b1); mix.connect(b2); b2.connect(b2g);
        env.gain.setValueAtTime(0.0001, at); env.gain.linearRampToValueAtTime(1, at + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        b1.connect(env); b2g.connect(env); env.connect(bus);
        var n = a.createBufferSource(), nb = a.createBiquadFilter(), ng = a.createGain();     // the breathy "h"
        n.buffer = noiseBuf(a); nb.type = "bandpass"; nb.frequency.value = 1800; nb.Q.value = 0.8;
        ng.gain.setValueAtTime(0.0001, at); ng.gain.linearRampToValueAtTime(0.35, at + 0.008); ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        n.connect(nb); nb.connect(ng); ng.connect(bus);
        [o1, o2, lfo].forEach(function (x) { x.start(at); x.stop(at + dur + 0.05); }); n.start(at, Math.random() * 0.5); n.stop(at + 0.06);
      };
      plan.forEach(function (sy) {
        var at = t0 + sy.t;
        if (sy.st) { voice(sy.v, at - 0.1, 0.03, sy.f * 1.1, sy.f); voice(sy.v, at - 0.055, 0.03, sy.f * 1.1, sy.f); }   // h-h-heh
        if (sy.dive) voice(sy.v, at, sy.d, sy.f, 62); else voice(sy.v, at, sy.d, sy.f * 1.12, sy.f * 0.84);
      });
      SND.laugh = { out: out };
      setTimeout(function () { if (SND.laugh && SND.laugh.out === out) SND.laugh = null; try { out.disconnect(); } catch (e) { /* gone */ } }, (tEnd - a.currentTime + 1) * 1000);
    } catch (e) { /* no audio */ }
  }
  function laughStop() {
    var L = SND.laugh; if (!L) return; SND.laugh = null;
    try { var t = SND.ac.currentTime; L.out.gain.cancelScheduledValues(t); L.out.gain.setValueAtTime(L.out.gain.value, t); L.out.gain.linearRampToValueAtTime(0, t + 0.08);
      setTimeout(function () { try { L.out.disconnect(); } catch (e) { /* gone */ } }, 250); } catch (e) { /* gone */ }
  }
  function sndBtn() {
    var b = el("button", "e2-snd"); b.type = "button";
    var paint = function () { b.innerHTML = '<span class="e2c">' + gl(SND.on ? "SOUND ON" : "SOUND OFF") + "</span>"; b.setAttribute("aria-label", SND.on ? "Звук: вкл" : "Звук: выкл"); b.setAttribute("aria-pressed", SND.on ? "true" : "false"); };
    paint();
    b.addEventListener("click", function (e) { e.stopPropagation(); SND.on = !SND.on; lsSet(K_SND, SND.on ? "1" : "0"); paint(); if (SND.on) { ac(); beep(660, 0.08); } else { humStop(); laughStop(); } });
    return b;
  }

  // ---- glyph sprites for the canvas
  function glyphCanvas(ch, color) {
    var g = GLYPH[ch], c = document.createElement("canvas"); c.width = GW; c.height = GH;
    var x = c.getContext("2d"); x.fillStyle = color;
    for (var i = 0; i < GW * GH; i++) if (g[i]) x.fillRect(i % GW, Math.floor(i / GW), 1, 1);
    return c;
  }
  var SPR = null;
  function sprites() {
    if (SPR) return SPR;
    SPR = { w: [], r: [], q: glyphCanvas("?", "#fff"), qr: glyphCanvas("?", "#ff1e3c"), qc: glyphCanvas("?", "#3cf0ff") };
    for (var c = 65; c <= 90; c++) { var ch = String.fromCharCode(c); SPR.w.push(glyphCanvas(ch, "#e9e9e9")); SPR.r.push(glyphCanvas(ch, "#ff5a6e")); }
    return SPR;
  }
  var HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
  function lineSvg(text, cls) {   // cipher text with words kept whole
    return text.split(" ").map(function (w) {
      var s = ""; for (var i = 0; i < w.length; i++) s += glyphSvg(w[i], cls); return '<span class="e2-word">' + s + "</span>";
    }).join("");
  }
  function gl(text) { return lineSvg(text, "eg"); }   // English source text → the Gate cipher, sized by font-size
  function playBtn(word, aria, cls) {
    return '<button class="' + cls + ' e2-play" type="button" aria-label="' + aria + '">' + glyphSvg(">", "eg e2-pg") + (word ? '<span class="e2c e2-pw">' + gl(word) + "</span>" : "") + "</button>";
  }
  // the soul: the owner's drawn heart (img/heart.png), preloaded; until it loads (or if it fails) the old pixel heart stands in
  var GIMG = new Image(), GOK = false;   // the grin from the intro, exported as a sprite (special seed only)
  GIMG.onload = function () { GOK = true; }; GIMG.decoding = "async"; GIMG.src = "/site/img/grin.png";
  var HIMG = new Image(), HOK = false;
  HIMG.onload = function () { HOK = true; }; HIMG.decoding = "async"; HIMG.src = "/site/img/heart.png";
  function beatScale(now, hp) {      // lub-dub; faster when the soul is weak
    var per = hp >= 3 ? 1.0 : hp === 2 ? 0.75 : 0.5, p = (now / 1000 % per) / per;
    var b = function (c, w) { var d = (p - c) / w; return Math.exp(-d * d); };
    return 1 + 0.11 * b(0.07, 0.05) + 0.06 * b(0.25, 0.045);
  }

  // ---- the mini-game
  var E2 = null;
  function heartSvg(cls) {   // the old pixel heart, as a fallback
    var r = "";
    for (var y = 0; y < HEART.length; y++) for (var xx = 0; xx < 7; xx++) if (HEART[y][xx] === "#") r += '<rect x="' + xx + '" y="' + y + '" width="1" height="1"/>';
    return '<svg class="' + cls + '" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true" fill="#fff">' + r + "</svg>";
  }
  function shardsOpen() {
    if (E2) return;
    var o = el("div", "e2"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Осколки Врат");
    o.innerHTML = '<div class="e2-wrap"><div class="e2-hud"><span class="e2-t e2c" aria-label="Время"></span><span class="e2-hp"></span><span class="e2-sp e2c" aria-label="Искры"></span><span class="e2-best e2c" aria-label="Рекорд"></span></div>' +
      '<div class="e2-box"><canvas class="e2-cv" width="160" height="160"></canvas><canvas class="e2-hv" aria-hidden="true"></canvas><div class="e2-scr"></div><div class="e2-tt" role="status" aria-live="polite"></div></div>' +
      '<div class="e2-bar"><span class="e2-help e2c" aria-label="Стрелки, WASD, мышь или палец">' + gl("MOVE: ARROWS OR DRAG") + "</span></div></div>" +
      '<button class="e2-x" type="button" aria-label="Закрыть">✕</button>';
    document.body.appendChild(o);
    o.querySelector(".e2-bar").appendChild(sndBtn());
    var cv = o.querySelector(".e2-cv"), x = cv.getContext("2d"), scr = o.querySelector(".e2-scr"), tt = o.querySelector(".e2-tt");
    var hv = o.querySelector(".e2-hv"), hx2 = hv.getContext("2d"), DPR = Math.min(3, window.devicePixelRatio || 1);
    var hudT = o.querySelector(".e2-t"), hudHp = o.querySelector(".e2-hp"), hudSp = o.querySelector(".e2-sp"), hudB = o.querySelector(".e2-best");
    var F = 160, S = 2, ROUND = 40, sp = sprites();
    var st = null, raf = 0, last = 0, keys = {}, ptr = null, mouse = null, state = "menu", FACE = null, gazeP = null;
    var best = Number(lsGet(K_BEST)) || 0, hudC = {};
    E2 = { o: o, close: close };

    function setG(node, key, text) { if (hudC[key] === text) return; hudC[key] = text; node.innerHTML = gl(text); }
    function fit() {
      var aw = Math.min(innerWidth - 32, 560), ah = innerHeight - 190;
      S = Math.max(1, Math.floor(Math.min(aw, ah) / F));
      cv.width = cv.height = F * S; cv.style.width = cv.style.height = F * S + "px";
      hv.width = hv.height = Math.round(F * S * DPR); hv.style.width = hv.style.height = F * S + "px";
      x.imageSmoothingEnabled = false;
      if (state !== "play") draw(0);
    }
    function paintBest() { setG(hudB, "b", "BEST " + best.toFixed(1)); }
    function reset() {
      // the «?» shard: exactly 1 round in 8, once, at a random moment 6–30 s; nothing else forces it.
      // One round in a million is the special seed: grinning faces fall instead of glyphs and a bleeding «?» always comes at 10–20 s.
      var sp1 = seedRoll();
      st = { t: 0, hp: 3, inv: 0, sparks: 0, hx: F / 2, hy: F * 0.72, sh: [], fx: [], spk: [], next: 0.4, nextSpk: 1.2, shake: 0, sp: sp1,
        qAt: sp1 ? 10 + cryptoBelow(10001) / 1000 : cryptoBelow(8) === 0 ? 6 + cryptoBelow(24001) / 1000 : -1, qDone: false, q: null };
      if (sp1) laughPlay(laughPlan(), 0.3, 0.12);
      // a cassette: rolled once per round (each tape its own odds), never in the very first round, never with the special seed
      var played = Number(lsGet(K_PLAYED)) || 0; lsSet(K_PLAYED, String(played + 1));
      var tid = !sp1 && (played >= 1 || TAPE_DROP) ? tapeRoll() : 0;
      st.tid = tid; st.tAt = tid ? (TAPE_DROP ? 2 : 5 + cryptoBelow(20001) / 1000) : -1; st.tape = null;
    }
    function gotTape(id) {
      var s = tstore(); if (!tapeHave(id)) { s.inv.push(id); tsave(); }
      burst(st.hx, st.hy, "#ff3a3a", 12); beep(523, 0.08, "square", 0.04, 784); setTimeout(function () { beep(784, 0.1, "square", 0.04, 1046); }, 90);
      tt.innerHTML = '<span class="e2c">' + gl("CASSETTE") + "</span><small>кассета</small>"; tt.classList.add("on");
      clearTimeout(tt.t); tt.t = setTimeout(function () { tt.classList.remove("on"); }, 2400);
    }
    function tapesBtn() { return '<button class="e2-tp" type="button" aria-label="Записи">' + casSvg("e2-tpg") + '<span class="e2c e2-pw">' + gl("TAPES") + "</span></button>"; }
    function menu(html) { scr.innerHTML = html; scr.classList.add("on"); }
    function start() {
      reset(); state = "play"; scr.classList.remove("on"); scr.innerHTML = ""; beep(330, 0.09, "square", 0.05, 660);
      last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    }

    // ---- the thing in the dark: an original pixel face (two eyes, a too-wide grin), drawn per pixel at 96×64 and scaled up
    function intro() {
      if (state === "intro") return;
      state = "intro"; scr.classList.remove("on"); scr.innerHTML = "";
      if (SND.on) ac();                 // inside the tap: unlock audio now
      var T = RM ? { dark: 0.25, eyes: 0.3, mouth: 0.3, laugh: 0.45, out: 1.5, end: 1.8 }
                 : { dark: 0.6, eyes: 0.6, mouth: 1.05, laugh: 1.7, out: 3.2, end: 3.7 };
      var plan = laughPlan(); laughPlay(plan, T.laugh);
      var fc = el("canvas", "e2-face"); fc.setAttribute("aria-hidden", "true"); o.appendChild(fc);
      var fx = fc.getContext("2d"), fd = Math.min(2, window.devicePixelRatio || 1);
      var fsize = function () { fc.width = Math.round(innerWidth * fd); fc.height = Math.round(innerHeight * fd); };
      fsize(); addEventListener("resize", fsize);
      var LW = 96, LH = 64, CX = 48, MW = 35, off = document.createElement("canvas"); off.width = LW; off.height = LH;
      var oc = off.getContext("2d"), img = oc.createImageData(LW, LH), d = img.data;
      var seed = 77, rr = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      var up = [], lo = [], xx, w, i;
      for (xx = CX - MW + 1; xx < CX + MW;) { w = 2 + Math.floor(rr() * 3); for (i = 0; i < w; i++) up[xx + i] = { c: xx + w / 2, hw: w / 2, h: 0.22 + rr() * 0.4 }; xx += w + (rr() < 0.35 ? 1 : 0); }
      for (xx = CX - MW + 2; xx < CX + MW;) { w = 2 + Math.floor(rr() * 3); for (i = 0; i < w; i++) lo[xx + i] = { c: xx + w / 2, hw: w / 2, h: 0.16 + rr() * 0.3 }; xx += w + (rr() < 0.5 ? 1 : 0); }
      var EYES = [{ x: 32, y: 18, rx: 10.5, ry: 6, a: 0.34 }, { x: 65, y: 17, rx: 8.5, ry: 5, a: -0.4 }];
      var gx = 0, gy = 0.6, t0 = performance.now(), fr = 0;
      var cl = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; }, ease = function (v) { v = cl(v); return v * v * (3 - 2 * v); };
      var put = function (k, r, g, b, m) { d[k] = r * m; d[k + 1] = g * m; d[k + 2] = b * m; d[k + 3] = 255; };
      function laughEnv(lt) {
        var e = 0; for (var j = 0; j < plan.length; j++) { var q = plan[j], u = (lt - q.t) / q.d; if (u >= 0 && u < 1) e = Math.max(e, 1 - u); }
        return e;
      }
      function pixels(t) {
        var k = RM ? ease((t - T.dark) / T.eyes) : ease((t - T.dark) / T.eyes) * (t > 1.42 && t < 1.5 ? 0.12 : 1);   // one slow blink
        var eA = RM ? k : cl((t - T.dark + 0.1) / 0.5);
        var rv = RM ? 1 : ease((t - T.mouth) / 0.7), mA = cl((t - T.mouth) / (RM ? 0.3 : 0.55));
        var op = 0.22 + 0.78 * ease((t - T.mouth - 0.1) / 0.6);
        if (!RM && t > T.laugh) op *= 0.72 + 0.4 * laughEnv(t - T.laugh);      // the jaw moves with the laugh
        d.fill(0);
        for (var y = 0; y < LH; y++) for (var x0 = 0; x0 < LW; x0++) {
          var px0 = x0 + 0.5, py = y + 0.5, idx = (y * LW + x0) * 4;
          if (eA > 0 && k > 0.02) for (var e = 0; e < 2; e++) {
            var E = EYES[e], dx = px0 - E.x, dy = py - E.y, ca = Math.cos(E.a), sa = Math.sin(E.a);
            var u = dx * ca + dy * sa, v = -dx * sa + dy * ca, nu = u / E.rx;
            if (nu <= -1 || nu >= 1) continue;
            var lim = E.ry * k * (1 - nu * nu) * (v < 0 ? 0.62 : 1);               // heavy upper lid
            if (Math.abs(v) >= lim) continue;
            var pu = gx * E.rx * 0.38, pv = gy * lim * 0.35;
            if (Math.abs(u - pu) < 0.95 && Math.abs(v - pv) < Math.max(1, lim * 0.8)) put(idx, 10, 0, 0, 1);  // a thin slit pupil
            else { var r2 = Math.sqrt(nu * nu + (v / E.ry) * (v / E.ry)); if (r2 < 0.42) put(idx, 255, 251, 232, eA); else if (r2 < 0.8) put(idx, 255, 205, 96, eA); else put(idx, 255, 58, 31, eA); }
          }
          if (mA <= 0) continue;
          var tt = (px0 - CX) / MW; if (tt <= -1 || tt >= 1 || Math.abs(tt) > rv) continue;
          var ut = 43 - 14 * tt * tt - 2.5 * tt, lt0 = 56 - 27.5 * tt * tt - 2.5 * tt, lw = ut + (lt0 - ut) * op;
          if (py <= ut - 0.6 || py >= lw + 0.6) continue;
          if (py <= ut || py >= lw) { put(idx, 120, 10, 18, mA * 0.8); continue; }      // a wet red lip line
          var th0 = lt0 - ut, a1 = up[x0], a2 = lo[x0], depth;
          if (a1) { depth = a1.h * th0 * (1 - Math.abs(px0 - a1.c) / a1.hw); if (py - ut < Math.min(depth, (lw - ut) * 0.62)) { put(idx, x0 === Math.floor(a1.c - a1.hw + 0.4) ? 178 : 238, x0 === Math.floor(a1.c - a1.hw + 0.4) ? 168 : 230, x0 === Math.floor(a1.c - a1.hw + 0.4) ? 134 : 200, mA); continue; } }
          if (a2) { depth = a2.h * th0 * (1 - Math.abs(px0 - a2.c) / a2.hw); if (lw - py < Math.min(depth, (lw - ut) * 0.5)) { put(idx, 214, 204, 170, mA); continue; } }
          var rr2 = (py - ut) / (lw - ut), edge = Math.min(rr2, 1 - rr2) * 2;
          put(idx, 78 - 64 * edge, 8 - 6 * edge, 16 - 12 * edge, mA);
        }
        oc.putImageData(img, 0, 0);
      }
      function paint(t) {
        var W = fc.width, H = fc.height;
        fx.setTransform(1, 0, 0, 1, 0, 0); fx.globalAlpha = 1; fx.shadowBlur = 0; fx.fillStyle = "#000"; fx.fillRect(0, 0, W, H);
        var S2 = Math.max(2, Math.floor(Math.min(W * 0.94 / LW, H * 0.6 / LH))), ox = Math.round((W - LW * S2) / 2), oy = Math.round(H * 0.42 - LH * S2 / 2);
        if (gazeP) {      // the eyes follow you
          var tx = cl(((gazeP.x * fd - ox) / S2 - CX) / (LW * 0.6) * 0.5 + 0.5) * 2 - 1, ty = cl(((gazeP.y * fd - oy) / S2 - 18) / (LH * 0.8) * 0.5 + 0.5) * 2 - 1;
          gx += (tx - gx) * 0.12; gy += (ty - gy) * 0.12;
        }
        pixels(t);
        var g = t > T.out ? 1 - cl((t - T.out) / (T.end - T.out)) : 1, jit = 0;
        if (!RM) {
          var hot = t > T.laugh && t < T.out ? 0.45 : 0.12;
          if (Math.random() < hot) { ox += (Math.random() < 0.5 ? -1 : 1) * S2; jit = 1; }
          if (Math.random() < hot * 0.5) oy += (Math.random() < 0.5 ? -1 : 1) * S2;
          if (Math.random() < 0.05) g *= 0.4;                                   // flicker
          fx.fillStyle = "rgba(255,255,255,0.05)";                              // grain
          for (var n = 0; n < 50; n++) fx.fillRect(Math.random() * W | 0, Math.random() * H | 0, S2, S2);
        }
        fx.imageSmoothingEnabled = false; fx.globalAlpha = g;
        fx.shadowColor = "rgba(255,40,24,0.6)"; fx.shadowBlur = S2 * 4;
        fx.drawImage(off, ox, oy, LW * S2, LH * S2);
        fx.shadowBlur = 0;
        if (!RM && (jit || t > T.out)) {                                         // torn scanlines + colour split
          var bands = t > T.out ? 10 : 3;
          for (var b = 0; b < bands; b++) {
            var sy = Math.random() * LH | 0, sh = 1 + (Math.random() * (t > T.out ? 8 : 3) | 0), sx = ((Math.random() - 0.5) * (t > T.out ? 24 : 8) | 0) * S2;
            fx.drawImage(off, 0, sy, LW, sh, ox + sx, oy + sy * S2, LW * S2, sh * S2);
          }
          if (t > T.out) { fx.globalCompositeOperation = "lighter"; fx.globalAlpha = g * 0.5; fx.drawImage(off, ox - 2 * S2, oy, LW * S2, LH * S2); fx.globalCompositeOperation = "source-over"; }
        }
        fx.globalAlpha = 1;
        fx.fillStyle = "rgba(0,0,0,0.35)";                                       // scanlines
        for (var yy = 0; yy < H; yy += 3 * fd) fx.fillRect(0, yy, W, fd);
      }
      var mv = function (e) { gazeP = { x: e.clientX, y: e.clientY }; };
      o.addEventListener("pointermove", mv); o.addEventListener("pointerdown", mv);
      FACE = { stop: function () { cancelAnimationFrame(fr); removeEventListener("resize", fsize); o.removeEventListener("pointermove", mv); o.removeEventListener("pointerdown", mv); fc.remove(); FACE = null; } };
      function step(now) {
        if (!FACE) return;
        var t = (now - t0) / 1000;
        if (t >= T.end) { FACE.stop(); start(); return; }
        paint(t); fr = requestAnimationFrame(step);
      }
      paint(0); fr = requestAnimationFrame(step);
    }

    function score() { return st.t + st.sparks * 0.5; }
    function end(win) {
      state = "over"; cancelAnimationFrame(raf);
      var sc = score(), nb = sc > best + 1e-9;
      if (nb) { best = sc; lsSet(K_BEST, best.toFixed(2)); paintBest(); }
      beep(win ? 880 : 140, win ? 0.3 : 0.4, win ? "triangle" : "sawtooth", 0.05, win ? 1320 : 60);
      menu('<div class="e2c e2-ttl" aria-label="' + (win ? "Врата затихли" : "Душа дрогнула") + '">' + gl(win ? "THE GATE IS SILENT" : "THE SOUL TREMBLED") + "</div>" +
        '<div class="e2c e2-big" aria-label="' + sc.toFixed(1) + '">' + gl(sc.toFixed(1)) + "</div>" +
        '<div class="e2c e2-sub">' + gl(st.t.toFixed(1) + " - " + sparkWord() + st.sparks) + "</div>" + (nb ? '<div class="e2c e2-new" aria-label="Новый рекорд">' + gl("NEW BEST!") + "</div>" : "") +
        '<div class="e2-row">' + playBtn("AGAIN", "Ещё раз", "e2-go") + tapesBtn() + "</div>");
      scr.querySelector(".e2-go").focus();
    }
    function toFootage() { state = "file"; cancelAnimationFrame(raf); close(true); footage(); }
    function sealed() {
      state = "file"; cancelAnimationFrame(raf); beep(98, 0.9, "sawtooth", 0.05, 49);
      if (score() > best) { best = score(); lsSet(K_BEST, best.toFixed(2)); paintBest(); }
      o.classList.add("e2-dim");
      menu('<div class="e2-file"><div class="e2c e2-fnum" aria-label="Запись неизвестна">' + gl("FILE ?? - UNKNOWN") + "</div>" +
        '<button class="e2-q" type="button" aria-label="Вскрыть запись">' + glyphSvg("?", "e2-qg") + "</button>" +
        '<div class="e2c e2-stamp" aria-label="Запечатано">' + gl("SEALED") + '</div><div class="e2c e2-sub">' + gl("TOUCH TO OPEN") + "</div></div>");
      // The whole card opens it (the text says «touch to open»), on pointerup: Android fires no 'click' for a tap made while the
      // steering finger is still down (two touches = not a tap), and a tap beside the small pulsing «?» used to do nothing.
      // Only a pointer that went DOWN on the card after it appeared counts, so the touch that collected the shard never opens it.
      var card = scr.querySelector(".e2-file"), q = scr.querySelector(".e2-q"), shownAt = performance.now(), fresh = {};
      q.focus({ preventScroll: true });
      var open = function () { if (state !== "file") return; state = "opening"; close(true); dossier(); };
      card.addEventListener("pointerdown", function (e) { if (performance.now() - shownAt > 200) { fresh[e.pointerId] = 1; e.preventDefault(); } });
      card.addEventListener("pointerup", function (e) {
        if (!fresh[e.pointerId]) return; delete fresh[e.pointerId];
        if (e.pointerType === "mouse" && e.button) return;
        e.preventDefault(); e.stopPropagation(); open();
      });
      card.addEventListener("pointercancel", function (e) { delete fresh[e.pointerId]; });
      card.addEventListener("click", function (e) { e.stopPropagation(); if (performance.now() - shownAt > 200) open(); });   // keyboard Enter/Space on the «?»
    }
    scr.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      if (e.target.closest(".e2-first")) { e.stopPropagation(); intro(); return; }
      if (e.target.closest(".e2-tp")) { e.stopPropagation(); var ps = state; state = "arch"; archiveOpen(function () { if (E2) { state = ps; var b0 = scr.querySelector(".e2-tp"); if (b0) b0.focus({ preventScroll: true }); } }); return; }
      var b = e.target.closest(".e2-go"); if (b) { e.stopPropagation(); start(); }
    });

    function spawn() {
      var t = st.t, k = Math.min(1, t / 34), big = Math.random() < 0.12 + k * 0.2, sz = big ? 2 : 1;
      var w = GW * sz, h = GH * sz, spd = 34 + k * 70 + Math.random() * 18, r = Math.random(), s;
      if (t > 12 && r < 0.18 + k * 0.12) {          // from the side
        var left = Math.random() < 0.5;
        s = { x: left ? -w : F, y: 6 + Math.random() * (F - h - 12), vx: (left ? 1 : -1) * spd * 0.9, vy: 0 };
      } else if (t > 18 && r < 0.42) {              // aimed at the soul
        var sx = 8 + Math.random() * (F - 16), dx = st.hx - sx, dy = st.hy + 20, d = Math.sqrt(dx * dx + dy * dy) || 1;
        s = { x: sx - w / 2, y: -h, vx: dx / d * spd * 1.05, vy: dy / d * spd * 1.05, red: 1 };
      } else {
        s = { x: Math.random() * (F - w), y: -h, vx: (Math.random() - 0.5) * 10, vy: spd };
      }
      s.w = w; s.h = h; s.sz = sz; s.g = Math.floor(Math.random() * 26); s.flip = 0;
      if (st.sp) faceify(s);
      st.sh.push(s);
      if (t > 24 && Math.random() < 0.14) {          // a short rain line
        var gap = Math.floor(Math.random() * 5);
        for (var i = 0; i < 8; i++) if (Math.abs(i - gap) > 0) { var rs = { x: i * 20 + 7, y: -GH - i * 3, vx: 0, vy: 52 + k * 30, w: GW, h: GH, sz: 1, g: Math.floor(Math.random() * 26), flip: 0 }; if (st.sp) faceify(rs); st.sh.push(rs); }
      }
      st.next = Math.max(0.1, 0.42 - k * 0.32) * (0.7 + Math.random() * 0.6);
    }
    function faceify(s) {          // the special seed: a grinning face (img/grin.png, 70×44) in place of a glyph, same centre
      var fw = s.sz === 2 ? 16 : 10, fh = Math.round(fw * 44 / 70), cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      s.face = 1; s.w = fw; s.h = fh; s.x = cx - fw / 2; s.y = s.vy > 0 && !s.vx ? -fh : cy - fh / 2; s.jt = Math.random() * 6;
    }
    function hit(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
    function burst(px, py, col, n) { for (var i = 0; i < n; i++) st.fx.push({ x: px, y: py, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, l: 0.35 + Math.random() * 0.3, c: col }); }

    function update(dt) {
      st.t += dt;
      // move the soul
      var v = 78, mx = 0, my = 0;
      if (keys.ArrowLeft || keys.a) mx -= 1; if (keys.ArrowRight || keys.d) mx += 1;
      if (keys.ArrowUp || keys.w) my -= 1; if (keys.ArrowDown || keys.s) my += 1;
      if (mx || my) { var n = Math.sqrt(mx * mx + my * my); st.hx += mx / n * v * dt; st.hy += my / n * v * dt; mouse = null; }
      else if (mouse) { st.hx += (mouse.x - st.hx) * Math.min(1, dt * 14); st.hy += (mouse.y - st.hy) * Math.min(1, dt * 14); }
      st.hx = Math.max(4, Math.min(F - 4, st.hx)); st.hy = Math.max(3, Math.min(F - 4, st.hy));
      var hb = { x: st.hx - 2, y: st.hy - 2, w: 4, h: 4 }, pb = { x: st.hx - 4, y: st.hy - 3, w: 8, h: 7 };
      // shards
      st.next -= dt; if (st.next <= 0) spawn();
      for (var i = st.sh.length - 1; i >= 0; i--) {
        var s = st.sh[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.flip -= dt;
        if (s.flip <= 0) { s.flip = 0.25 + Math.random() * 0.5; if (Math.random() < 0.35) s.g = Math.floor(Math.random() * 26); }
        if (s.y > F + 4 || s.x < -20 || s.x > F + 20) { st.sh.splice(i, 1); continue; }
        if (st.inv <= 0 && hit(hb, { x: s.x + 0.5, y: s.y + 0.5, w: s.w - 1, h: s.h - 1 })) {
          st.hp--; st.inv = 1.1; st.shake = RM ? 0 : 0.25; burst(st.hx, st.hy, "#ff1e3c", 10); beep(110, 0.18, "sawtooth", 0.06, 70);
          st.sh.splice(i, 1);
          if (st.hp <= 0) { paintHud(); return end(false); }
        }
      }
      st.inv -= dt; st.shake -= dt;
      // light sparks
      st.nextSpk -= dt;
      if (st.nextSpk <= 0) { st.spk.push({ x: 10 + Math.random() * (F - 20), y: 14 + Math.random() * (F - 28), l: 5.5, w: 5, h: 5 }); st.nextSpk = 1.6 + Math.random() * 1.6; }
      for (i = st.spk.length - 1; i >= 0; i--) {
        var p = st.spk[i]; p.l -= dt;
        if (hit(pb, { x: p.x - 2.5, y: p.y - 2.5, w: 5, h: 5 })) { st.sparks++; burst(p.x, p.y, "#ffe14a", 6); beep(1046, 0.07, "square", 0.04, 1568); st.spk.splice(i, 1); continue; }
        if (p.l <= 0) st.spk.splice(i, 1);
      }
      // the unknown shard
      if (!st.qDone && !st.q && st.qAt > 0 && st.t >= st.qAt) {
        st.qDone = true; var fromL = Math.random() < 0.5;
        st.q = { x: fromL ? 8 : F - 8 - GW * 2, y: -GH * 2, w: GW * 2, h: GH * 2, vx: fromL ? 9 : -9, vy: 16, ph: 0 };
        beep(233, 0.5, "sawtooth", 0.035, 117);
      }
      if (st.q) {
        var q = st.q; q.ph += dt; q.x += (q.vx + Math.sin(q.ph * 2.3) * 22) * dt; q.y += q.vy * dt;
        if (q.y > F + 4) st.q = null;
        else if (hit(pb, q)) { st.q = null; burst(st.hx, st.hy, st.sp ? "#ff1e3c" : "#ffffff", 16); return st.sp ? toFootage() : sealed(); }
      }
      if (st.tAt > 0 && !st.tape && st.t >= st.tAt) { st.tAt = -1; var fl = Math.random() < 0.5; st.tape = { x: fl ? 14 : F - 30, y: -10, w: 16, h: 10, vx: fl ? 7 : -7, vy: 17, ph: 0 }; beep(196, 0.25, "triangle", 0.035, 392); }
      if (st.tape) {
        var tp = st.tape; tp.ph += dt; tp.x += (tp.vx + Math.sin(tp.ph * 1.7) * 14) * dt; tp.y += tp.vy * dt;
        if (tp.y > F + 4) st.tape = null; else if (hit(pb, tp)) { st.tape = null; gotTape(st.tid); }
      }
      for (i = st.fx.length - 1; i >= 0; i--) { var f = st.fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; f.l -= dt; if (f.l <= 0) st.fx.splice(i, 1); }
      if (st.t >= ROUND) { st.t = ROUND; paintHud(); return end(true); }
    }
    function px(cx, cy, c) { x.fillStyle = c; x.fillRect(Math.round(cx * S), Math.round(cy * S), S, S); }
    // the soul on its own smooth high-DPI layer: the drawn heart, beating, squashing and flashing when hit
    function drawSoul(now, ox, oy) {
      hx2.setTransform(1, 0, 0, 1, 0, 0); hx2.clearRect(0, 0, hv.width, hv.height);
      if (!st) return;
      var blink = st.inv > 0 && Math.floor(st.inv * 12) % 2;
      var k = S * DPR, cx = (st.hx * S + ox) * DPR, cy = (st.hy + 0.4) * S * DPR + oy * DPR;
      if (!HOK) {     // fallback: the old pixel heart
        if (blink) return;
        var hx = Math.round(st.hx) - 3, hy = Math.round(st.hy) - 3;
        hx2.imageSmoothingEnabled = false; hx2.fillStyle = "#fff"; hx2.shadowColor = "rgba(255,255,255,.7)"; hx2.shadowBlur = 6 * k;
        for (var r = 0; r < HEART.length; r++) for (var c = 0; c < 7; c++) if (HEART[r][c] === "#") hx2.fillRect((hx + c) * k + ox * DPR, (hy + r) * k + oy * DPR, k, k);
        hx2.shadowBlur = 0; return;
      }
      var beat = RM ? 1 : beatScale(now, st.hp), sq = st.inv > 0.8 ? (st.inv - 0.8) / 0.3 : 0;
      var hH = 11.5 * k * beat, hW = hH * HIMG.width / HIMG.height;
      hx2.imageSmoothingEnabled = true; hx2.imageSmoothingQuality = "high";
      hx2.translate(cx, cy); hx2.scale(1 + 0.24 * sq, 1 - 0.24 * sq);
      hx2.globalAlpha = blink ? 0.35 : 1;
      hx2.shadowColor = "rgba(255,30,40," + (0.45 + 0.25 * (beat - 1) / 0.11) + ")"; hx2.shadowBlur = 5 * k;
      hx2.drawImage(HIMG, -hW / 2, -hH / 2, hW, hH);
      hx2.shadowBlur = 0;
      if (sq > 0) { hx2.globalCompositeOperation = "lighter"; hx2.globalAlpha = sq * 0.8; hx2.drawImage(HIMG, -hW / 2, -hH / 2, hW, hH); hx2.globalCompositeOperation = "source-over"; }
      hx2.globalAlpha = 1;
    }
    function draw(now) {
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = st && st.sp ? "#140204" : "#050505"; x.fillRect(0, 0, cv.width, cv.height);
      var ox = 0, oy = 0;
      if (st && st.shake > 0) { ox = Math.round((Math.random() - 0.5) * 4) * S; oy = Math.round((Math.random() - 0.5) * 4) * S; }
      x.setTransform(1, 0, 0, 1, ox, oy);
      // faint floor grid
      x.fillStyle = st && st.sp ? "#2a060b" : "#101010";
      for (var gy = 8; gy < F; gy += 16) for (var gx = 8; gx < F; gx += 16) x.fillRect(gx * S, gy * S, S, S);
      if (!st) { drawSoul(now, 0, 0); return; }
      var t = now / 1000, i;
      for (i = 0; i < st.spk.length; i++) {
        var p = st.spk[i], tw = (Math.sin(t * 9 + i) > 0) || p.l > 1.2 ? 1 : 0; if (p.l < 1.2 && !tw) continue;
        var c = "#ffe14a"; px(p.x, p.y, "#fff7c2"); px(p.x - 1, p.y, c); px(p.x + 1, p.y, c); px(p.x, p.y - 1, c); px(p.x, p.y + 1, c);
        if (Math.sin(t * 6 + i * 2) > 0.3) { px(p.x - 2, p.y, c); px(p.x + 2, p.y, c); px(p.x, p.y - 2, c); px(p.x, p.y + 2, c); }
      }
      for (i = 0; i < st.sh.length; i++) {
        var s = st.sh[i];
        if (s.face) {
          if (!GOK) { x.drawImage(sp.r[s.g], Math.round(s.x * S), Math.round(s.y * S), Math.round(s.h * S * GW / GH), s.h * S); continue; }
          var jx = RM ? 0 : Math.sin(t * 23 + s.jt) > 0.85 ? S : 0;
          x.shadowColor = "rgba(255,30,24,.75)"; x.shadowBlur = RM ? 0 : 3 * S;
          x.drawImage(GIMG, Math.round(s.x * S) + jx, Math.round(s.y * S), s.w * S, s.h * S); x.shadowBlur = 0;
          continue;
        }
        x.drawImage((s.red ? sp.r : sp.w)[s.g], Math.round(s.x * S), Math.round(s.y * S), s.w * S, s.h * S);
      }
      if (st.q) {
        var q = st.q, qx = Math.round(q.x * S), qy = Math.round(q.y * S), qw = q.w * S, qh = q.h * S, j = RM ? 0 : S;
        if (st.sp) {                // the bleeding one: red, smeared, dripping
          if (!RM) { x.globalAlpha = 0.6; x.drawImage(sp.qr, qx - 2 * j, qy + j, qw, qh); x.drawImage(sp.qr, qx + j, qy - j, qw, qh); x.globalAlpha = 1; }
          x.shadowColor = "rgba(255,0,30,.9)"; x.shadowBlur = RM ? 0 : 4 * S; x.drawImage(sp.qr, qx, qy, qw, qh); x.shadowBlur = 0;
          for (i = 0; i < 3; i++) { var dl = 2 + ((t * 6 + i * 2.7) % 7); x.fillStyle = "#a0001a"; x.fillRect(qx + (2 + i * 3) * S, qy + qh, S, Math.round(dl * S)); }
        } else {
        if (!RM && Math.random() < 0.5) { x.globalAlpha = 0.8; x.drawImage(sp.qr, qx - j, qy, qw, qh); x.drawImage(sp.qc, qx + j, qy + (Math.random() < 0.3 ? j : 0), qw, qh); x.globalAlpha = 1; }
        if (RM || Math.random() > 0.08) x.drawImage(sp.q, qx, qy, qw, qh);
        }
        if (!RM) for (i = 0; i < 4; i++) px(q.x - 2 + Math.random() * (q.w + 4), q.y - 2 + Math.random() * (q.h + 4), Math.random() < 0.5 ? "#ff1e3c" : "#fff");
      }
      if (st.tape) {             // the falling cassette, with a blinking red light
        var tp = st.tape; x.shadowColor = "rgba(255,40,40,.7)"; x.shadowBlur = RM ? 0 : 3 * S;
        x.drawImage(casCanvas(), Math.round(tp.x * S), Math.round(tp.y * S), tp.w * S, tp.h * S); x.shadowBlur = 0;
        if (RM || Math.sin(t * 8) > 0) px(tp.x + tp.w - 2, tp.y - 2, "#ff1e3c");
      }
      for (i = 0; i < st.fx.length; i++) { var f = st.fx[i]; x.globalAlpha = Math.min(1, f.l * 3); px(f.x, f.y, f.c); }
      x.globalAlpha = 1;
      drawSoul(now, ox, oy);
      // time bar
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#222"; x.fillRect(0, cv.height - S, cv.width, S);
      x.fillStyle = "#fff"; x.fillRect(0, cv.height - S, Math.round(cv.width * st.t / ROUND), S);
    }
    function paintHud() {
      setG(hudT, "t", (st ? st.t : 0).toFixed(1));
      var hp = st ? st.hp : 3;
      if (hudC.hp !== hp) { hudC.hp = hp; hudHp.innerHTML = [0, 1, 2].map(function (i) { return '<i class="' + (i < hp ? "on" : "") + '"></i>'; }).join(""); }
      setG(hudSp, "s", sparkWord() + (st ? st.sparks : 0));
    }
    function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (state !== "play") return;
      update(dt); if (state !== "play") { draw(now); return; }
      draw(now); paintHud();
      raf = requestAnimationFrame(loop);
    }
    // input
    function onKey(e) {
      if (state === "arch" || ARC || TP || WHYO || document.querySelector(".e6.on")) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (/^(Arrow|w$|a$|s$|d$)/.test(k)) { keys[k] = 1; mouse = null; e.preventDefault(); }
      if ((k === " " || k === "Enter") && state !== "play" && state !== "file" && state !== "intro" && document.activeElement && !document.activeElement.closest(".e2-snd,.e2-x,.e2-tp")) {
        e.preventDefault(); if (state === "menu") intro(); else start();
      }
    }
    function onKeyUp(e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; delete keys[k]; }
    function lp(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * F, y: (e.clientY - r.top) / r.height * F }; }
    cv.addEventListener("pointerdown", function (e) {
      if (state !== "play") return;
      e.preventDefault();
      if (e.pointerType !== "mouse") { ptr = { id: e.pointerId, p: lp(e) }; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } }
    });
    cv.addEventListener("pointermove", function (e) {
      if (state !== "play") return;
      if (e.pointerType === "mouse") { mouse = lp(e); return; }
      if (!ptr || ptr.id !== e.pointerId) return;
      var p = lp(e); st.hx += (p.x - ptr.p.x) * 1.15; st.hy += (p.y - ptr.p.y) * 1.15; ptr.p = p;   // relative drag: the finger never hides the soul
    });
    var up = function (e) { if (ptr && ptr.id === e.pointerId) ptr = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") mouse = null; });
    o.addEventListener("pointerdown", function (e) { gazeP = { x: e.clientX, y: e.clientY }; }, true);
    function onVis() { if (document.hidden && state === "play") { state = "pause"; menu('<div class="e2c e2-ttl" aria-label="Пауза">' + gl("PAUSE") + "</div>" + playBtn("", "Дальше", "e2-res")); } }
    scr.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".e2-res")) { e.stopPropagation(); state = "play"; scr.classList.remove("on"); scr.innerHTML = ""; last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    o.querySelector(".e2-x").addEventListener("click", function () { close(); });
    document.addEventListener("keydown", onKey); document.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", onVis); addEventListener("resize", fit);
    document.body.classList.add("e2-lock");

    function close(quick) {
      if (!E2) return; E2 = null; state = "closed"; cancelAnimationFrame(raf);
      if (FACE) FACE.stop(); laughStop();
      document.removeEventListener("keydown", onKey); document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", fit);
      document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, quick || RM ? 0 : 300);
    }
    paintBest(); paintHud(); fit();
    menu('<div class="e2c e2-ttl" aria-label="Осколки Врат">' + gl("SHARDS OF THE GATE") + "</div>" +
      '<div class="e2-heart">' + (HOK ? '<img src="/site/img/heart.png" alt="" draggable="false">' : heartSvg("e2-hpx")) + "</div>" +
      '<div class="e2c e2-sub" aria-label="Уклоняйся от осколков шифра, собирай искры света">' + gl("DODGE THE SHARDS") + "</div>" +
      '<div class="e2c e2-sub">' + gl("CATCH THE LIGHT *") + "</div>" +
      '<div class="e2-row">' + playBtn("", "Начать", "e2-first") + tapesBtn() + "</div>");
    var hi = scr.querySelector(".e2-heart img");
    if (hi) hi.addEventListener("error", function () { hi.parentNode.innerHTML = heartSvg("e2-hpx"); });
    else if (!HOK) HIMG.addEventListener("load", function () { var b = scr.querySelector(".e2-heart"); if (b && state === "menu") b.innerHTML = '<img src="/site/img/heart.png" alt="" draggable="false">'; });
    requestAnimationFrame(function () { o.classList.add("on"); var b = scr.querySelector(".e2-first"); if (b) b.focus({ preventScroll: true }); else o.focus(); });
  }
  // ---- «Шифр Врат» tool (owner cabinet only; pure front-end)
  var CI_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?:-!";
  var TRL = { "а": "a", "б": "b", "в": "v", "г": "g", "ґ": "g", "д": "d", "е": "e", "є": "ye", "ё": "yo", "ж": "zh", "з": "z", "и": "i", "і": "i", "ї": "yi", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "'": "", "’": "" };
  function ciPrep(src) {          // → { text: upper Latin the cipher can write, tr: was anything transliterated, bad: unsupported chars }
    var out = "", tr = false, bad = {};
    for (var i = 0; i < src.length; i++) {
      var ch = src[i], lo = ch.toLowerCase();
      if (TRL.hasOwnProperty(lo)) { var t = TRL[lo]; out += ch !== lo ? t.toUpperCase() : t; tr = true; continue; }
      if (/\s/.test(ch)) { out += " "; continue; }
      var up = ch.toUpperCase();
      if (CI_SET.indexOf(up) >= 0) out += up; else bad[ch] = 1;
    }
    return { text: out.toUpperCase().replace(/ {2,}/g, " ").trim(), tr: tr, bad: Object.keys(bad) };
  }
  function ciLines(text, max) { var lines = [], cur = ""; text.split(" ").forEach(function (w) { if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }); if (cur) lines.push(cur); return lines; }
  function ciPng(text) {
    var P = 6, lines = ciLines(text, 24), cw = (GW + 1) * P, lh = (GH + 4) * P, pad = 6 * P;
    var w = Math.max.apply(null, lines.map(function (l) { return l.length; })) * cw - P + pad * 2, h = lines.length * lh - 4 * P + pad * 2;
    var c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); var x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#fff";
    lines.forEach(function (l, li) { for (var i = 0; i < l.length; i++) { var g = GLYPH[l[i]]; if (!g) continue; for (var k = 0; k < GW * GH; k++) if (g[k]) x.fillRect(pad + i * cw + (k % GW) * P, pad + li * lh + Math.floor(k / GW) * P, P, P); } });
    return c;
  }
  function devCipher() {
    if ($("devCipher")) return;
    var b = el("div", "box dc"); b.id = "devCipher";
    var kb = "", tb = "";
    for (var i = 0; i < CI_SET.length; i++) {
      var ch = CI_SET[i];
      kb += '<button type="button" class="dc-k" data-c="' + esc(ch) + '" aria-label="' + esc(ch) + '">' + glyphSvg(ch, "dc-g") + "</button>";
      tb += '<div class="dc-t"><b>' + esc(ch) + "</b>" + glyphSvg(ch, "dc-g") + "</div>";
    }
    b.innerHTML = '<h3>Шифр Врат</h3>' +
      '<p class="muted dc-about">Простой шифр подстановки: у каждой латинской буквы, цифры и знака (. , ? : - !) своя нарисованная пиксельная руна 5×7. Ключ к буквам игроки находят в подвале сайта.</p>' +
      '<label class="dc-lbl">Зашифровать<textarea id="dcIn" rows="3" maxlength="600" placeholder="HE IS STILL WATCHING."></textarea></label>' +
      '<p class="dc-note" id="dcNote">Латиница A–Z, цифры, пробел и . , ? : - ! — кириллица переводится в латиницу автоматически.</p>' +
      '<div class="dc-prev e3-cipher" id="dcPrev" aria-live="polite"></div>' +
      '<div class="dc-acts"><button type="button" class="btn btn-sm" id="dcPng">Скопировать как картинку</button><button type="button" class="btn btn-sm" id="dcTxt">Скопировать текст</button></div>' +
      '<h4 class="dc-h">Расшифровать</h4><p class="muted dc-sub">Нажимайте руны — ниже появится текст.</p>' +
      '<div class="dc-out"><div class="dc-runes e3-cipher" id="dcRunes"></div><div class="dc-lat" id="dcLat">—</div></div>' +
      '<div class="dc-kb">' + kb + '<button type="button" class="dc-k dc-w" data-c=" ">ПРОБЕЛ</button><button type="button" class="dc-k dc-w" data-c="bs" aria-label="Стереть">⌫</button><button type="button" class="dc-k dc-w" data-c="clr">ОЧИСТИТЬ</button></div>' +
      '<h4 class="dc-h">Алфавит</h4><div class="dc-tab">' + tb + "</div>";
    $("devBody").appendChild(b);
    var inp = $("dcIn"), prev = $("dcPrev"), note = $("dcNote"), cur = { text: "" }, dec = "";
    var paint = function () {
      cur = ciPrep(inp.value);
      prev.innerHTML = cur.text ? lineSvg(cur.text, "e3-g dc-pg") : '<span class="muted">предпросмотр</span>';
      var n = [];
      if (cur.tr) n.push("Транслитерация: " + esc(cur.text));
      if (cur.bad.length) n.push("Нет руны для: " + esc(cur.bad.join(" ")) + " — пропущено");
      note.innerHTML = n.length ? n.join("<br>") : "Латиница A–Z, цифры, пробел и . , ? : - ! — кириллица переводится в латиницу автоматически.";
    };
    inp.addEventListener("input", paint); paint();
    $("dcTxt").addEventListener("click", function () {
      if (!cur.text) return toast("Пусто");
      var done = function () { toast("Текст скопирован"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cur.text).then(done, function () { inp.select(); toast("Не вышло — скопируйте вручную"); });
      else toast("Буфер обмена недоступен");
    });
    $("dcPng").addEventListener("click", function () {
      if (!cur.text) return toast("Пусто");
      var c = ciPng(cur.text);
      c.toBlob(function (blob) {
        if (!blob) return toast("Не удалось нарисовать");
        var dl = function () { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "shifr-vrat.png"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast("Картинка сохранена"); };
        try {
          if (navigator.clipboard && window.ClipboardItem) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function () { toast("Картинка скопирована"); dl(); }, dl);
          else dl();
        } catch (e) { dl(); }
      }, "image/png");
    });
    var runes = $("dcRunes"), lat = $("dcLat");
    b.querySelector(".dc-kb").addEventListener("click", function (e) {
      var k = e.target.closest(".dc-k"); if (!k) return;
      var c = k.getAttribute("data-c");
      if (c === "bs") dec = dec.slice(0, -1); else if (c === "clr") dec = ""; else if (dec.length < 300) dec += c;
      runes.innerHTML = dec ? lineSvg(dec, "e3-g dc-pg") : "";
      lat.textContent = dec || "—";
    });
  }
  // ---- the dossier: a figure in a lab coat, face scratched out, name redacted
  function drawFigure(c, seed) {
    var x = c.getContext("2d"), W = c.width, H = c.height;
    var r = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    x.clearRect(0, 0, W, H);
    var R = function (a, b, w, h, col) { x.fillStyle = col; x.fillRect(a, b, w, h); };
    // legs + shoes
    R(26, 94, 8, 14, "#1b1b1b"); R(38, 94, 8, 14, "#1b1b1b"); R(24, 107, 11, 3, "#000"); R(37, 107, 11, 3, "#000");
    // coat body: widens to the hem
    for (var y = 31; y < 98; y++) {
      var k = (y - 31) / 67, l = Math.round(20 - k * 6), rr = Math.round(52 + k * 6);
      R(l, y, rr - l, 1, "#e6e6e6"); R(rr - 3, y, 3, 1, "#b9b9b9"); R(l, y, 1, 1, "#9a9a9a");
    }
    R(14, 97, 44, 1, "#8d8d8d");
    // shirt + lapels
    for (y = 31; y < 56; y++) { var hw = Math.round((y - 31) * 0.28); R(36 - hw, y, hw * 2 + 1, 1, "#2a2a2a"); }
    R(35, 34, 2, 18, "#4a0d16");                                     // a dark tie
    for (y = 31; y < 58; y++) { var lw = Math.round((y - 31) * 0.3); R(36 - lw - 3, y, 2, 1, "#c4c4c4"); R(36 + lw + 2, y, 2, 1, "#c4c4c4"); }
    R(36, 58, 1, 39, "#9d9d9d");                                     // the opening
    R(38, 62, 1, 1, "#777"); R(38, 72, 1, 1, "#777"); R(38, 82, 1, 1, "#777");
    // pockets, pens, a guard badge
    R(22, 72, 9, 1, "#9d9d9d"); R(42, 72, 9, 1, "#9d9d9d");
    R(43, 40, 6, 1, "#a5a5a5"); R(44, 36, 1, 4, "#ff1e3c"); R(46, 37, 1, 3, "#5b7cff");
    R(24, 41, 5, 4, "#ffe14a"); R(25, 42, 3, 2, "#a8861a");
    // sleeves + hands
    R(12, 33, 8, 46, "#dcdcdc"); R(12, 33, 1, 46, "#9a9a9a"); R(52, 33, 8, 46, "#c9c9c9"); R(59, 33, 1, 46, "#9a9a9a");
    R(13, 79, 6, 5, "#bdbdbd"); R(53, 79, 6, 5, "#bdbdbd");
    // shoulders + neck + head
    R(18, 30, 36, 3, "#efefef"); R(32, 25, 8, 6, "#a9a9a9");
    for (y = 6; y < 27; y++) { var dy = (y - 16) / 10.5, wd = Math.round(Math.sqrt(Math.max(0, 1 - dy * dy)) * 9); R(36 - wd, y, wd * 2, 1, "#cfcfcf"); }
    // the face is gone: violent scribble, crossed out
    var line = function (x0, y0, x1, y1, col) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy2 = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, e = dx + dy2;
      x.fillStyle = col;
      for (var n = 0; n < 200; n++) { x.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; var e2 = 2 * e; if (e2 >= dy2) { e += dy2; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    };
    var px0 = 36 + (r() - 0.5) * 2, py0 = 16 + (r() - 0.5) * 2;
    for (var i = 0; i < 110; i++) {
      var a = r() * 6.283, d = 4 + r() * 9, b = a + 2 + r() * 2.5, d2 = 4 + r() * 9;
      line(px0 + Math.cos(a) * d, py0 + Math.sin(a) * d * 1.15, px0 + Math.cos(b) * d2, py0 + Math.sin(b) * d2 * 1.15, r() < 0.78 ? "#000" : r() < 0.6 ? "#5a5a5a" : "#7a0012");
    }
    for (i = 0; i < 3; i++) {   // the strike-out
      var o = (r() - 0.5) * 3;
      line(22 + o, 3 + i, 51 + o, 30 + i, "#c4001f"); line(51 - o, 3 + i, 22 - o, 30 + i, "#c4001f");
    }
    for (i = 0; i < 6; i++) { var yy = 5 + r() * 24; line(19 + r() * 4, yy, 50 + r() * 5, yy + (r() - 0.5) * 6, "#000"); }   // long angry strokes
    for (i = 0; i < 14; i++) { x.fillStyle = r() < 0.5 ? "#000" : "#3a3a3a"; x.fillRect(Math.round(20 + r() * 32), Math.round(28 + r() * 70), 1, 1 + Math.round(r() * 3)); }  // stains on the coat
  }
  // ---- the face that was scratched out, seen as it is (one flash frame in the special seed's footage). Original pixel portrait 72×112:
  // a gaunt pale head, hollow black sockets, a smile far too wide, the same lab coat.
  var K_EYE = "sotg.file0.eye";
  function cryptoBelow(n) {     // uniform integer in [0, n) from crypto.getRandomValues (rejection sampling: no modulo bias)
    try {
      var c = window.crypto || window.msCrypto, a = new Uint32Array(1), lim = 4294967296 - (4294967296 % n);
      do { c.getRandomValues(a); } while (a[0] >= lim);
      return a[0] % n;
    } catch (e) { return Math.floor(Math.random() * n); }
  }
  function seeHim() { try { return new URLSearchParams(location.search).get("seehim") === "1"; } catch (e) { return false; } }
  function seedRoll() { return seeHim() || cryptoBelow(1000000) === 0; }   // the special seed: exactly 1 round in 1 000 000
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var SKIN = ["#14100e", "#2c2420", "#4d433c", "#7a7068", "#a59c92", "#c9c1b6", "#e6e0d6", "#f6f2ea"];
  function drawSeen() {          // → an offscreen 72×112 canvas without the pupils
    var c = document.createElement("canvas"); c.width = 72; c.height = 112;
    var x = c.getContext("2d"), seed = 4111;
    var r = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var R = function (a, b, w, h, col) { x.fillStyle = col; x.fillRect(a, b, w, h); };
    R(0, 0, 72, 112, "#070606");
    for (var y = 0; y < 112; y++) for (var xx = 0; xx < 72; xx++) if (r() < 0.035) R(xx, y, 1, 1, r() < 0.5 ? "#100c0c" : "#0c0808");
    // the coat: narrow shoulders, collar up
    for (y = 63; y < 112; y++) {
      var k = Math.min(1, (y - 63) / 10), l = Math.round(31 - k * 23), rr = Math.round(41 + k * 23);
      R(l, y, rr - l, 1, "#dedede"); R(l, y, 2, 1, "#8e8e8e"); R(rr - 3, y, 3, 1, "#a9a9a9");
    }
    for (y = 63; y < 112; y++) { var hw = Math.round(Math.min(9, (y - 63) * 0.45)); R(36 - hw, y, hw * 2, 1, "#232020"); }   // dark shirt
    R(35, 66, 2, 46, "#4a0d16"); R(35, 66, 2, 2, "#2a0509");                                                                  // the tie
    for (y = 63; y < 112; y++) { var lw = Math.round(Math.min(10, (y - 63) * 0.5)); R(36 - lw - 4, y, 3, 1, "#c2c2c2"); R(36 + lw + 1, y, 3, 1, "#c2c2c2"); R(36 - lw - 4, y, 1, 1, "#777"); R(36 + lw + 3, y, 1, 1, "#777"); }
    R(12, 86, 7, 5, "#ffe14a"); R(13, 87, 5, 3, "#a8861a");                                                                   // the badge
    R(52, 84, 8, 1, "#9d9d9d"); R(53, 79, 1, 5, "#ff1e3c"); R(55, 80, 1, 4, "#5b7cff");                                       // pens
    for (var i = 0; i < 18; i++) R(Math.round(10 + r() * 52), Math.round(76 + r() * 34), 1, 1 + Math.round(r() * 2), r() < 0.5 ? "#5a1018" : "#3a3a3a");
    // the neck: thin, tendons
    for (y = 54; y < 66; y++) for (xx = 31; xx <= 41; xx++) {
      var nd = Math.abs(xx - 36) / 5.5, b = 0.5 - nd * 0.35 - (y > 61 ? 0.15 : 0) + ((xx === 34 || xx === 38) && y < 63 ? 0.12 : 0);
      x.fillStyle = SKIN[Math.max(0, Math.min(7, Math.floor(b * 7 + BAYER[(y & 3) * 4 + (xx & 3)] / 16)))]; x.fillRect(xx, y, 1, 1);
    }
    // the head: a long egg, jaw narrowing to a sharp chin
    var hw2 = function (y) {
      if (y < 8 || y > 57) return 0;
      if (y <= 30) return 14.5 * Math.sqrt(Math.max(0, 1 - Math.pow((30 - y) / 22.5, 2)));
      var t = (y - 30) / 27; return 14.5 * (1 - t * t * 0.62) * (y > 54 ? Math.sqrt((58 - y) / 4) : 1);
    };
    var eyeL = { x: 29.5, y: 31 }, eyeR = { x: 43.5, y: 31 };
    for (y = 8; y <= 57; y++) {
      var w = hw2(y);
      for (xx = Math.floor(36 - w); xx <= Math.ceil(36 + w - 1); xx++) {
        var nx = (xx + 0.5 - 36) / Math.max(1, w); if (Math.abs(nx) > 1) continue;
        var bb = 0.92 - nx * nx * 0.45 - (nx > 0 ? nx * 0.12 : 0);        // light from the upper left
        if (y < 14) bb -= (14 - y) * 0.03;
        var cheek = Math.abs(nx) > 0.42 && Math.abs(nx) < 0.92 && y > 36 && y < 52; if (cheek) bb -= 0.26 * Math.sin((Math.abs(nx) - 0.42) / 0.5 * Math.PI);   // hollow cheeks
        if (y > 18 && y < 26 && Math.abs(nx) > 0.75) bb -= 0.18;            // sunken temples
        [eyeL, eyeR].forEach(function (e) {                                 // the sockets: deep, wide, wet black
          var dx = (xx + 0.5 - e.x) / 5.6, dy = (y + 0.5 - e.y) / 4.6, d = dx * dx + dy * dy;
          if (d < 2.2) bb -= Math.max(0, 1.05 - d * 0.5) * 0.95;
        });
        if (y > 51) bb -= (y - 51) * 0.05;
        var lvl = Math.floor(Math.max(0, Math.min(0.999, bb)) * 7 + BAYER[(y & 3) * 4 + (xx & 3)] / 16);
        x.fillStyle = SKIN[Math.max(0, Math.min(7, lvl))]; x.fillRect(xx, y, 1, 1);
      }
    }
    // sockets' black cores
    [eyeL, eyeR].forEach(function (e) {
      for (var yy = -4; yy <= 4; yy++) for (var q = -5; q <= 5; q++) {
        var d = (q / 4.2) * (q / 4.2) + (yy / 3.2) * (yy / 3.2); if (d <= 1) R(Math.floor(e.x + q), Math.floor(e.y + yy), 1, 1, d < 0.6 ? "#000" : "#070505");
      }
    });
    // the nose: long, thin, a shadow down one side
    for (y = 32; y < 44; y++) { R(37, y, 1, 1, "#7a7068"); if (y > 36) R(38, y, 1, 1, "#4d433c"); }
    R(35, 44, 1, 1, "#1a1412"); R(38, 44, 1, 1, "#1a1412"); R(36, 44, 2, 1, "#a59c92");
    // the smile: thin, much too wide, corners cutting up into the cheeks
    for (xx = 20; xx <= 52; xx++) {
      var u = (xx - 36) / 16, my = Math.round(48.5 - u * u * 5.5 - Math.pow(Math.abs(u), 6) * 2);
      R(xx, my, 1, 1, Math.abs(u) > 0.93 ? "#4d433c" : "#120707");
      if (Math.abs(u) < 0.78) {                         // a sliver of teeth
        R(xx, my + 1, 1, 1, xx % 2 ? "#d9d2c0" : "#3a2a24");
        R(xx, my + 2, 1, 1, Math.abs(u) < 0.55 ? "#2a1a16" : "#4d433c");
      }
    }
    R(19, 41, 1, 2, "#4d433c"); R(53, 41, 1, 2, "#4d433c");   // creases
    // hair: thin, stringy, wet strands down the sides
    for (i = 0; i < 26; i++) {
      var sx = 22 + r() * 28, sy = 7 + r() * 4, len = 4 + r() * (sx < 26 || sx > 46 ? 30 : 8), dxs = (sx - 36) * 0.03;
      for (var s = 0; s < len; s++) { var ppx = Math.round(sx + dxs * s + Math.sin(s * 0.5 + i) * 0.6), ppy = Math.round(sy + s); if (hw2(ppy) && Math.abs(ppx + 0.5 - 36) < hw2(ppy) - 1.5 && ppy > 14 && ppy < 40 && Math.abs(ppx - 36) < 9) continue; R(ppx, ppy, 1, 1, r() < 0.7 ? "#1a1614" : "#2e2724"); }
    }
    return { c: c, eyes: [eyeL, eyeR] };
  }
  // ---- the special seed's ending: found camcorder footage (three.js, loaded only now), then the letter
  var THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js", threeP = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeP) return threeP;
    threeP = new Promise(function (res, rej) {
      var s = document.createElement("script"), to = setTimeout(function () { threeP = null; rej(new Error("timeout")); }, 9000);
      s.src = THREE_URL; s.async = true; s.crossOrigin = "anonymous";
      s.onload = function () { clearTimeout(to); if (window.THREE) res(window.THREE); else { threeP = null; rej(new Error("no THREE")); } };
      s.onerror = function () { clearTimeout(to); threeP = null; s.remove(); rej(new Error("load")); };
      document.head.appendChild(s);
    });
    return threeP;
  }
  // ---- typing: one deterministic rhythm drives both his fingers and the clicks
  var TYPE_DT = 0.12;
  function tHash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function typeKey(n) { return tHash(n) > 0.32 && Math.sin(n * TYPE_DT * 0.9) > -0.55 ? (tHash(n + 0.37) < 0.5 ? 0 : 1) : -1; }   // the hand that strikes in slot n (-1: none)
  function typeDip(t, k) { var n = Math.floor(t / TYPE_DT), f = t / TYPE_DT - n; return typeKey(n) === k ? Math.sin(Math.min(1, f * 1.7) * Math.PI) : 0; }
  function typeFinger(t, k) { return Math.floor(tHash(Math.floor(t / TYPE_DT) + k * 0.71) * 4); }
  function keyClick(a, out) {
    if (!a || !out) return;
    var t = a.currentTime, s = a.createBufferSource(), bf = a.createBiquadFilter(), g = a.createGain(), o = a.createOscillator(), og = a.createGain();
    s.buffer = noiseBuf(a); bf.type = "bandpass"; bf.frequency.value = 2600 + Math.random() * 1600; bf.Q.value = 2.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.type = "square"; o.frequency.setValueAtTime(420 + Math.random() * 80, t); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.02, t + 0.002); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    s.connect(bf); bf.connect(g); g.connect(out); o.connect(og); og.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.05); o.start(t); o.stop(t + 0.03);
  }
  // ---- the faceless one's hands and clothes (the seed footage and every tape)
  function mkHand(T, add, mat, hand, sd) {      // a gloved hand on the wrist: palm, four fingers, a thumb — joined to the sleeve
    hand.add(add(new T.CylinderGeometry(0.032, 0.037, 0.06, 16), mat, [0, 0.005, 0]));
    var palm = add(new T.SphereGeometry(1, 20, 14), mat, [0, -0.058, 0]); palm.scale.set(0.038, 0.05, 0.019); hand.add(palm);
    var f = [];
    for (var k = 0; k < 4; k++) { var fg = new T.Group(); fg.position.set(-0.026 + k * 0.0173, -0.1, 0); fg.add(add(new T.CapsuleGeometry(0.0088, 0.05 - Math.abs(k - 1.5) * 0.008, 4, 8), mat, [0, -0.03, 0])); hand.add(fg); f.push(fg); }
    var th = new T.Group(); th.position.set(-sd * 0.036, -0.045, 0.008); th.rotation.set(0.35, 0, -sd * 0.55); th.add(add(new T.CapsuleGeometry(0.0095, 0.038, 3, 6), mat, [0, -0.028, 0])); hand.add(th);
    return f;
  }
  function buildFig(T, add, M, o) {   // smooth: lathed body, capsule limbs, rounded joints (no visible seams)
    var g = new T.Group(), cm = o.cm, km = o.km;
    var lathe = function (pts, mat) { var gg = new T.LatheGeometry(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), 48); gg.scale(1, 1, 0.72); return add(gg, mat); };
    var legs = [-1, 1].map(function (sd) { var hip = new T.Group(); hip.position.set(sd * 0.1, 1.0, 0); g.add(hip);
      hip.add(add(new T.CapsuleGeometry(0.052, 0.86, 8, 16), o.dm, [0, -0.47, 0]));
      var shoe = add(new T.SphereGeometry(1, 18, 12), o.shm, [0, -0.965, 0.045]); shoe.scale.set(0.056, 0.04, 0.125); hip.add(shoe); return hip; });
    g.add(lathe(o.dress === "sweater" ? [[0.001, 0.9], [0.24, 0.9], [0.252, 0.95], [0.25, 1.02], [0.001, 1.06]]
      : [[0.001, 0.42], [0.335, 0.42], [0.335, 0.44], [0.315, 0.58], [0.295, 0.74], [0.27, 0.9], [0.25, 1.02], [0.001, 1.06]], cm));
    var torso = new T.Group(); torso.position.y = 1.02; g.add(torso);
    torso.add(lathe([[0.001, -0.05], [0.24, -0.045], [0.232, 0.1], [0.216, 0.3], [0.232, 0.5], [0.25, 0.64], [0.246, 0.72], [0.215, 0.78], [0.14, 0.815], [0.06, 0.83], [0.001, 0.83]], cm));
    var waist = add(new T.SphereGeometry(1, 32, 16), cm, [0, 0.0, 0]); waist.scale.set(0.245, 0.13, 0.178); torso.add(waist);   // a rounded waist: no gap when he leans
    var neck = new T.Group(); neck.position.y = 0.8; torso.add(neck);
    neck.add(add(new T.CylinderGeometry(0.044, 0.054, 0.18, 18), km, [0, 0.08, 0]));
    var head = add(new T.SphereGeometry(1, 40, 30), km, [0, 0.34, 0.02]); head.scale.set(0.12, 0.19, 0.14); neck.add(head);
    var arms = [-1, 1].map(function (sd) {
      var sh = new T.Group(); sh.position.set(sd * 0.25, 0.72, 0); torso.add(sh);
      sh.add(add(new T.SphereGeometry(0.064, 18, 12), cm, [0, -0.01, 0]));
      sh.add(add(new T.CapsuleGeometry(0.053, 0.42, 8, 16), cm, [0, -0.25, 0]));
      var e2 = new T.Group(); e2.position.y = -0.5; sh.add(e2);
      e2.add(add(new T.SphereGeometry(0.05, 16, 10), cm));
      e2.add(add(new T.CapsuleGeometry(0.046, 0.4, 8, 16), cm, [0, -0.23, 0]));
      var hand = new T.Group(); hand.position.y = -0.47; e2.add(hand);
      return { sh: sh, el: e2, hand: hand, f: mkHand(T, add, o.hm || km, hand, sd), sd: sd };
    });
    if (o.dress === "coat") dressCoat(T, add, M, g, torso, arms, cm);
    if (o.dress === "sweater") dressSweater(T, add, M, g, torso, arms, cm);
    return { g: g, legs: legs, torso: torso, neck: neck, head: head, arms: arms };
  }
  function dressCoat(T, add, M, root, torso, arms, cm) {   // an open lab coat: lapels, collar, pockets, cuffs, a dark shirt and tie
    var shirt = M({ color: 0x17181c, roughness: 0.85 }), tie = M({ color: 0x4d1218, roughness: 0.55 }), seam = M({ color: 0x7a776f, roughness: 1 }), pk = M({ color: 0xcdcac1, roughness: 0.95 });
    var put = function (par, geo, mat, pos, rot) { par.add(add(geo, mat, pos, rot)); };
    put(torso, new T.BoxGeometry(0.13, 0.46, 0.02), shirt, [0, 0.5, 0.166], [0.06, 0, 0]);
    put(torso, new T.BoxGeometry(0.034, 0.36, 0.012), tie, [0, 0.49, 0.18], [0.06, 0, 0]);
    put(torso, new T.BoxGeometry(0.046, 0.04, 0.02), tie, [0, 0.705, 0.172]);
    put(torso, new T.TorusGeometry(0.058, 0.014, 6, 16), shirt, [0, 0.79, 0], [Math.PI / 2, 0, 0]);
    put(torso, new T.TorusGeometry(0.085, 0.022, 6, 18), cm, [0, 0.77, -0.01], [Math.PI / 2 + 0.3, 0, 0]);
    put(root, new T.BoxGeometry(0.07, 0.6, 0.012), shirt, [0, 0.72, 0.214], [-0.11, 0, 0]);
    [-1, 1].forEach(function (sd) {
      put(torso, new T.BoxGeometry(0.07, 0.34, 0.024), cm, [sd * 0.075, 0.56, 0.18], [0.07, 0, -sd * 0.24]);
      put(torso, new T.BoxGeometry(0.006, 0.34, 0.026), seam, [sd * 0.043, 0.555, 0.184], [0.07, 0, -sd * 0.24]);
      put(root, new T.BoxGeometry(0.006, 0.6, 0.016), seam, [sd * 0.038, 0.72, 0.219], [-0.11, 0, 0]);
      put(root, new T.BoxGeometry(0.12, 0.11, 0.012), pk, [sd * 0.15, 0.66, 0.2], [-0.1, sd * 0.39, 0]);
      put(root, new T.BoxGeometry(0.124, 0.008, 0.016), seam, [sd * 0.15, 0.716, 0.202], [-0.1, sd * 0.39, 0]);
    });
    put(torso, new T.BoxGeometry(0.075, 0.07, 0.01), pk, [0.125, 0.56, 0.153], [0.06, 0.39, 0]);
    put(torso, new T.CylinderGeometry(0.006, 0.006, 0.09, 6), M({ color: 0x1a2a5a, roughness: 0.4 }), [0.11, 0.6, 0.16]);
    put(root, new T.BoxGeometry(0.006, 0.34, 0.012), seam, [0, 0.6, -0.236], [0.11, 0, 0]);
    put(root, new T.BoxGeometry(0.2, 0.035, 0.014), cm, [0, 0.98, -0.185], [0.05, 0, 0]);
    arms.forEach(function (a) { a.el.add(add(new T.CylinderGeometry(0.05, 0.053, 0.06, 12), cm, [0, -0.42, 0])); a.el.add(add(new T.CylinderGeometry(0.0535, 0.0535, 0.01, 12), seam, [0, -0.395, 0])); });
  }
  function dressSweater(T, add, M, root, torso, arms, cm) {   // home clothes: a knitted sweater (ribbed collar, cuffs and hem)
    var rib = M({ color: 0x2c3a2c, roughness: 1 });
    torso.add(add(new T.CylinderGeometry(0.062, 0.085, 0.1, 18, 1, true), rib, [0, 0.84, 0]));
    root.add(add(new T.CylinderGeometry(0.255, 0.26, 0.07, 20), rib, [0, 0.93, 0])); root.children[root.children.length - 1].scale.z = 0.72;
    arms.forEach(function (a) { a.el.add(add(new T.CylinderGeometry(0.044, 0.046, 0.06, 12), rib, [0, -0.43, 0])); });
  }
  // ---- a plain human skull, sculpted from a sphere: the sockets and the nose are deep cavities (darkened by depth), no cracks
  function skullGeo(T) {
    var bell = function (d) { return d < 1 ? Math.sqrt(1 - d * d) : 0; };
    function shade(g, fn) {
      var P = g.attributes.position, n = P.count, col = new Float32Array(n * 3), v = new T.Vector3();
      for (var i = 0; i < n; i++) { v.fromBufferAttribute(P, i); var r = fn(v.x, v.y, v.z); P.setXYZ(i, r[0], r[1], r[2]); col[i * 3] = r[3]; col[i * 3 + 1] = r[4]; col[i * 3 + 2] = r[5]; }
      g.setAttribute("color", new T.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
    }
    var bone = function (k, x, y) { var m = 0.94 + 0.06 * Math.sin(x * 37 + y * 23) * Math.sin(y * 41 - x * 13); return [0.8 * k * m, 0.76 * k * m, 0.65 * k * m]; };
    var c = shade(new T.SphereGeometry(1, 120, 90), function (x, y, z) {
      var X = x, Y = y, Z = z, cav = 0, tooth = 0;
      if (Y < 0) { X *= 1 - 0.3 * -Y; Z *= 1 - 0.08 * -Y; }
      if (Z < 0) Z *= 1.1;
      if (Z > 0.72) Z = 0.72 + (Z - 0.72) * 0.55;
      if (z > 0.3) {
        [-1, 1].forEach(function (sd) {
          var d = Math.hypot((x - sd * 0.36) / 0.27, (y - 0.03) / 0.23), b = bell(d);
          if (b) { Z -= b * 0.6; X -= sd * b * 0.05; cav = Math.max(cav, b); }
          X += sd * 0.07 * bell(Math.hypot((x - sd * 0.64) / 0.22, (y + 0.16) / 0.14)) * (x * sd > 0 ? 1 : 0);   // cheekbones
        });
        Z += 0.05 * bell(Math.hypot(x / 0.75, (y - 0.27) / 0.07));                          // brow ridge
        var nw = 0.045 + 0.075 * Math.min(1, Math.max(0, (-0.16 - y) / 0.2)), nd = bell(Math.hypot(x / nw, (y + 0.3) / 0.15));
        if (nd) { Z -= nd * 0.32; cav = Math.max(cav, nd * 0.95); }
        if (y < -0.5 && y > -0.68 && Math.abs(x) < 0.5) {                                      // the upper teeth
          Z += 0.035; tooth = 1; var gap = ((Math.atan2(x, z) + 2) * 11) % 1;
          if (gap < 0.16 || y < -0.66) cav = Math.max(cav, 0.75);
        }
        if (y <= -0.68) { Z *= 0.75; cav = Math.max(cav, 0.6); }
      }
      if (Math.abs(x) > 0.8 && y > -0.2 && y < 0.25 && z > -0.2) X *= 0.93;                    // temples
      var k = 1 - Math.pow(Math.min(1, cav * 1.7), 0.5) * 0.985, cl = tooth && cav < 0.5 ? [0.86, 0.82, 0.68] : bone(k, x, y);
      if (tooth && cav >= 0.5) cl = [0.05, 0.04, 0.03];
      return [X * 0.074, Y * 0.09 + 0.012, Z * 0.1, cl[0], cl[1], cl[2]];
    });
    var j = shade(new T.SphereGeometry(1, 72, 40), function (x, y, z) {
      var X = x * (1 - Math.max(0, -z) * 0.25), Y = y, Z = z, cav = 0, tooth = 0;
      if (Y > 0.15) Y = 0.15 + (Y - 0.15) * 0.3;
      Z += 0.12 * bell(Math.hypot(x / 0.4, (y + 0.6) / 0.35)) * (z > 0 ? 1 : 0);                 // chin
      if (y > 0.45 && z > 0.45 && Math.abs(x) < 0.55) { tooth = 1; Y += 0.12; var gap = ((Math.atan2(x, z) + 2) * 12) % 1; if (gap < 0.16) cav = 0.8; }
      if (z < -0.3) { Y *= 0.6; cav = Math.max(cav, 0.45); }
      var cl = tooth ? (cav ? [0.05, 0.04, 0.03] : [0.86, 0.82, 0.68]) : bone(1 - cav * 0.6, x, y);
      return [X * 0.058, Y * 0.03 - 0.02, Z * 0.055 + 0.045, cl[0], cl[1], cl[2]];
    });
    return { c: c, j: j };
  }
  function addKeys(T, add, M, scene, root, arms) {   // a keyboard desk with switches right under the fingertips (pose the arms first)
    root.updateMatrixWorld(true);
    var c = new T.Vector3(), p = new T.Vector3(), ys = 9, i, j;
    arms.forEach(function (a) { a.hand.localToWorld(p.set(0, -0.13, 0)); c.add(p); ys = Math.min(ys, p.y); });
    c.multiplyScalar(1 / arms.length);
    var g = new T.Group(); g.position.set(c.x, ys - 0.006, c.z); g.rotation.y = root.rotation.y; scene.add(g);
    var body = M({ color: 0x26282c, roughness: 0.6, metalness: 0.35 }), keyM = M({ color: 0xbab5a7, roughness: 0.7 }), dark = M({ color: 0x0e0f11, roughness: 0.5, metalness: 0.5 });
    g.add(add(new T.BoxGeometry(0.6, 0.035, 0.24), body, [0, -0.018, 0.02]));
    var kg = new T.BoxGeometry(0.028, 0.012, 0.028), km = new T.InstancedMesh(kg, keyM, 64), mx = new T.Matrix4(); km.castShadow = true; km.receiveShadow = true;
    for (i = 0; i < 4; i++) for (j = 0; j < 16; j++) km.setMatrixAt(i * 16 + j, mx.makeTranslation(-0.255 + j * 0.034, 0.004, -0.06 + i * 0.034));
    g.add(km);
    var h = Math.max(0.1, g.position.y - 0.04);
    g.add(add(new T.BoxGeometry(0.86, h, 0.52), dark, [0, -h / 2 - 0.036, 0.1]));
    var led = [new T.MeshBasicMaterial({ color: 0xff3030 }), new T.MeshBasicMaterial({ color: 0x40ff9a })];
    for (i = 0; i < 7; i++) { g.add(add(new T.CylinderGeometry(0.007, 0.007, 0.035, 6), keyM, [-0.24 + i * 0.08, 0.012, 0.11], [-0.5, 0, 0])); g.add(add(new T.BoxGeometry(0.012, 0.008, 0.012), led[i % 3 ? 1 : 0], [-0.24 + i * 0.08, 0.004, 0.08], null, 0)); }
    g.add(add(new T.BoxGeometry(0.03, 0.09, 0.03), keyM, [0.36, 0.03, 0.06], [0.4, 0, 0]));
    return g;
  }
  // sound: a low drone, heartbeat thumps, a distorted burst
  function ftSound() {
    var a = SND.on ? ac() : null, nodes = [], out = null;
    if (a) try {
      out = a.createGain(); out.gain.value = 0.0001; var comp = a.createDynamicsCompressor(); out.connect(comp); comp.connect(a.destination);
      out.gain.exponentialRampToValueAtTime(0.5, a.currentTime + 2);
      [41, 61.7, 82.3].forEach(function (f, i) { var o = a.createOscillator(), g = a.createGain(); o.type = i ? "triangle" : "sine"; o.frequency.value = f; g.gain.value = i ? 0.05 : 0.12; o.connect(g); g.connect(out); o.start(); nodes.push(o); });
      var n = a.createBufferSource(), nf = a.createBiquadFilter(), ng = a.createGain(); n.buffer = noiseBuf(a); n.loop = true; nf.type = "lowpass"; nf.frequency.value = 380; ng.gain.value = 0.05;
      n.connect(nf); nf.connect(ng); ng.connect(out); n.start(); nodes.push(n);
    } catch (e) { a = null; }
    return {
      key: function () { keyClick(a, out); },
      thump: function (v) {
        if (!a) return;
        [0, 0.17].forEach(function (d, i) {
          var t = a.currentTime + d, o = a.createOscillator(), g = a.createGain(); o.type = "sine";
          o.frequency.setValueAtTime(i ? 58 : 66, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((i ? 0.5 : 0.75) * v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
        });
      },
      burst: function (soft) {
        if (!a) return;
        var t = a.currentTime, n = a.createBufferSource(), o = a.createOscillator(), ws = a.createWaveShaper(), g = a.createGain(), cu = new Float32Array(1024);
        for (var i = 0; i < 1024; i++) { var v = i / 511.5 - 1; cu[i] = Math.tanh(v * 9); }
        ws.curve = cu; n.buffer = noiseBuf(a); o.type = "sawtooth"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.8);
        g.gain.setValueAtTime(soft ? 0.12 : 0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.4 : 0.9));
        n.connect(ws); o.connect(ws); ws.connect(g); g.connect(a.destination); n.start(t); n.stop(t + 1); o.start(t); o.stop(t + 1);
      },
      stop: function () {
        if (!a) return; var t = a.currentTime;
        try { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); } catch (e) { /* gone */ }
        nodes.forEach(function (x) { try { x.stop(t + 0.35); } catch (e) { /* gone */ } }); a = null;
      }
    };
  }
  var FT = null;
  function footage() {
    if (FT) return;
    var o = el("div", "e4"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Запись с камеры");
    o.innerHTML = '<div class="e4-view"></div><canvas class="e4-fx" aria-hidden="true"></canvas>' +
      '<div class="e4-osd" aria-hidden="true"><span class="e4-rec"><i></i>REC</span><span class="e4-ts"></span><span class="e4-bat">▮▮▯</span><span class="e4-tc"></span></div>' +
      '<button class="e4-x" type="button" aria-label="Пропустить">✕</button>';
    document.body.appendChild(o); document.body.classList.add("e2-lock");
    var view = o.querySelector(".e4-view"), fxc = o.querySelector(".e4-fx"), fx = fxc.getContext("2d"), ts = o.querySelector(".e4-ts"), tc = o.querySelector(".e4-tc");
    // timeline (s): lab → turn to the portal → zoom → the cut → black → the letter
    var TL = RM ? { turn: 3, zoom: 4, cut: 6.5, black: 7.1, end: 7.6 } : { turn: 6.2, zoom: 8.2, cut: 13, black: 14, end: 15 };
    var snd = ftSound(), t0 = 0, raf = 0, done = false, beatN = -1, keyN = -1, flashed = false, burst = false, impl = null;
    var SEEN = drawSeen().c, FREEZE = null;
    try { var fz = new URLSearchParams(location.search).get("ft"); if (seeHim() && fz) FREEZE = Math.max(0, parseFloat(fz) || 0); } catch (e) { /* old browser */ }   // owner preview: ?seehim=1&ft=4 holds that moment
    FT = { o: o };
    function osd(t) {
      var s = 11 * 3600 + 47 * 60 + 3 + Math.floor(t);
      ts.textContent = "PM " + ("0" + Math.floor(s / 3600 % 12)).slice(-2) + ":" + ("0" + Math.floor(s / 60 % 60)).slice(-2) + ":" + ("0" + s % 60).slice(-2) + "  ░░.░░.19░░";
      tc.textContent = "SP  0:" + ("0" + (12 + Math.floor(t / 60))).slice(-2) + ":" + ("0" + Math.floor(t % 60)).slice(-2);
    }
    function fsize() { fxc.width = Math.ceil(innerWidth / 2); fxc.height = Math.ceil(innerHeight / 2); if (impl && impl.size) impl.size(); }
    fsize(); addEventListener("resize", fsize);
    // the 2D layer on top: the flash frame, the tear and the black
    function overlay(t) {
      var W = fxc.width, H = fxc.height; fx.clearRect(0, 0, W, H);
      if (t >= TL.cut && t < TL.cut + 0.07 && !RM && FREEZE == null) {     // one frame of the face that was scratched out
        var k = Math.min(W / 72, H / 112) * 1.25; fx.imageSmoothingEnabled = false; fx.fillStyle = "#000"; fx.fillRect(0, 0, W, H);
        fx.drawImage(SEEN, (W - 72 * k) / 2, (H - 112 * k) / 2 + H * 0.12, 72 * k, 112 * k); flashed = true;
      }
      if (t >= TL.black) { fx.fillStyle = "#000"; fx.fillRect(0, 0, W, H); if (!RM) { fx.fillStyle = "rgba(255,255,255,.06)"; for (var n = 0; n < 120; n++) fx.fillRect(Math.random() * W | 0, Math.random() * H | 0, 1, 1); } }
    }
    function step(now) {
      if (done) return;
      if (!t0) t0 = now;
      var t = FREEZE != null ? FREEZE : (now - t0) / 1000;
      if (t >= TL.end) return finish();
      // heartbeat once the portal is in view
      if (FREEZE == null && t < TL.turn + 0.6) { var kn = Math.floor(t / TYPE_DT); if (kn !== keyN) { keyN = kn; if (typeKey(kn) >= 0) snd.key(); } }   // the keys under his fingers
      if (t > TL.turn) { var bn = Math.floor((t - TL.turn) / 0.86); if (bn !== beatN) { beatN = bn; snd.thump(Math.min(1, 0.4 + (t - TL.turn) / 6)); } }
      if (t >= TL.cut && !burst) { burst = true; snd.burst(RM); }
      if (impl) impl.frame(t, TL);
      overlay(t); osd(t);
      o.classList.toggle("e4-black", t >= TL.black);
      raf = requestAnimationFrame(step);
    }
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf); snd.stop(); if (impl) impl.dispose();
      removeEventListener("resize", fsize); document.removeEventListener("keydown", onKey);
      FT = null; o.remove(); letter();
    }
    var onKey = function (e) { if (e.key === "Escape") finish(); };
    o.querySelector(".e4-x").addEventListener("click", function (e) { e.stopPropagation(); finish(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
    var go = function (m) { if (done) { if (m) m.dispose(); return; } impl = m; impl.size(); raf = requestAnimationFrame(step); };
    loadThree().then(function (T) { var m; try { m = lab3d(T, view); } catch (e) { m = null; } go(m || lab2d(view)); }, function () { go(lab2d(view)); });
    return { finish: finish, seen: function () { return flashed; } };
  }

  // ---- the 3D lab: concrete, cables, a flickering lamp, dust, monitors; the faceless one at the console; the portal with the heart
  function lab3d(T, host) {
    var R = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    var DPR = Math.min(1.5, window.devicePixelRatio || 1);
    R.setPixelRatio(DPR); R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(R.domElement);
    var scene = new T.Scene(); scene.background = new T.Color(0x020203); scene.fog = new T.FogExp2(0x040506, 0.085);
    var cam = new T.PerspectiveCamera(55, 1, 0.05, 60);
    var RT = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType });
    var dispose = [];
    function canvasTex(w, h, fn, rep) {
      var c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h);
      var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.colorSpace = T.SRGBColorSpace; dispose.push(t); return t;
    }
    var concrete = function (x, w, h) {
      x.fillStyle = "#6d6a66"; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 9000; i++) { var v = 70 + Math.random() * 60 | 0; x.fillStyle = "rgba(" + v + "," + v + "," + (v - 4) + "," + (0.1 + Math.random() * 0.25) + ")"; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
      for (i = 0; i < 40; i++) { x.fillStyle = "rgba(20,18,16," + Math.random() * 0.25 + ")"; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 8 + Math.random() * 50, 4 + Math.random() * 30, Math.random() * 3, 0, 7); x.fill(); }
      x.strokeStyle = "rgba(30,28,26,.6)"; x.lineWidth = 2; for (i = 0; i < 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4 + 1); x.lineTo(w, i * h / 4 + 1); x.stroke(); }
    };
    var M = function (o) { var m = new T.MeshStandardMaterial(o); dispose.push(m); return m; };
    var add = function (geo, mat, pos, rot, sh) { var m = new T.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.castShadow = sh !== 0; m.receiveShadow = true; dispose.push(geo); return m; };
    var wallM = M({ map: canvasTex(256, 256, concrete, [4, 2]), roughness: 0.95, metalness: 0 });
    var floorM = M({ map: canvasTex(256, 256, concrete, [6, 6]), roughness: 0.8, metalness: 0.05, color: 0x8a8580 });
    // room
    var room = add(new T.BoxGeometry(9, 4.2, 8.5), wallM, [-0.5, 2.1, -1.4], null, 0); room.material = [wallM, wallM, wallM, floorM, wallM, wallM]; room.geometry.scale(-1, 1, 1); scene.add(room);
    // pipes and cables
    var pipeM = M({ color: 0x2a2724, roughness: 0.5, metalness: 0.7 }), cabM = M({ color: 0x0b0b0b, roughness: 0.6 });
    for (var i = 0; i < 3; i++) scene.add(add(new T.CylinderGeometry(0.07 + i * 0.02, 0.07 + i * 0.02, 9, 10), pipeM, [-2 + i * 0.35, 3.9 - i * 0.1, -1], [0, 0, Math.PI / 2]));
    var cable = function (pts, r) { var c = new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], p[1], p[2]); })); scene.add(add(new T.TubeGeometry(c, 48, r, 6), cabM)); };
    cable([[-3, 4, -2.2], [-1.5, 2.6, -2.1], [0, 3.4, -2.0], [1.6, 2.5, -2.2], [3, 4, -2.3]], 0.025);
    cable([[-2.4, 4, -1.4], [-1.2, 3.1, -1.6], [0.2, 3.7, -1.7]], 0.02);
    cable([[1.4, 0.02, -1.8], [0.4, 0.02, -0.4], [-1.4, 0.03, 0.3], [-2.6, 0.02, -1.4], [-3.3, 0.02, -2.6]], 0.03);
    cable([[1.0, 0.9, -2.0], [1.3, 0.3, -1.95], [1.6, 0.02, -1.6], [2.6, 0.02, -0.6]], 0.022);
    // console + monitors
    var metal = M({ color: 0x1d1f21, roughness: 0.55, metalness: 0.6 });
    scene.add(add(new T.BoxGeometry(2.2, 0.95, 0.8), metal, [0.8, 0.475, -1.9]));
    scene.add(add(new T.BoxGeometry(2.2, 0.06, 0.55), M({ color: 0x111214, roughness: 0.4, metalness: 0.5 }), [0.8, 0.97, -1.7], [0.25, 0, 0]));
    var scrC = document.createElement("canvas"); scrC.width = 128; scrC.height = 96; var scx = scrC.getContext("2d");
    var scrT = new T.CanvasTexture(scrC); scrT.colorSpace = T.SRGBColorSpace; dispose.push(scrT);
    function paintScr(t) {
      scx.fillStyle = "#020806"; scx.fillRect(0, 0, 128, 96);
      for (var y = 0; y < 12; y++) { scx.fillStyle = y === (t * 3 | 0) % 12 ? "#d0fff0" : "#3fbf9a"; var len = 20 + ((Math.sin(y * 7.1 + (t * 2 | 0)) + 1) * 45 | 0); for (var x0 = 4; x0 < len; x0 += 6) if (Math.sin(x0 * 3.3 + y + (t | 0)) > -0.4) scx.fillRect(x0, 4 + y * 7, 4, 4); }
      scx.strokeStyle = "#ff3a4a"; scx.beginPath(); for (var x1 = 0; x1 < 128; x1++) { var yy = 82 - Math.abs(Math.sin(x1 * 0.2 + t * 6)) * 8 * (x1 % 30 < 6 ? 1.6 : 0.3); x1 ? scx.lineTo(x1, yy) : scx.moveTo(x1, yy); } scx.stroke();
      scrT.needsUpdate = true;
    }
    paintScr(0);
    var scrM = new T.MeshBasicMaterial({ map: scrT, color: 0x9ad8c4 }); dispose.push(scrM);
    [[0.15, 1.42, -2.12, 0.25], [0.85, 1.48, -2.2, 0], [1.55, 1.42, -2.12, -0.25]].forEach(function (p) {
      var g = new T.Group(); g.position.set(p[0], p[1], p[2]); g.rotation.y = p[3];
      g.add(add(new T.BoxGeometry(0.62, 0.48, 0.32), metal, [0, 0, -0.17]));
      var sm = add(new T.PlaneGeometry(0.54, 0.4), scrM, [0, 0, 0.001], null, 0); sm.castShadow = false; g.add(sm); scene.add(g);
    });
    var monL = new T.PointLight(0x5fe0c0, 2.2, 3.2, 2); monL.position.set(0.85, 1.4, -1.75); scene.add(monL);
    // the lamp: a cone shade, a bulb, a shadowing spotlight that flickers
    var lamp = new T.Group(); lamp.position.set(0.55, 3.0, -1.05); scene.add(lamp);
    lamp.add(add(new T.CylinderGeometry(0.008, 0.008, 1.2, 4), cabM, [0, 0.6, 0]));
    lamp.add(add(new T.ConeGeometry(0.26, 0.24, 20, 1, true), M({ color: 0x2b2d2a, roughness: 0.6, metalness: 0.6, side: T.DoubleSide }), [0, -0.05, 0]));
    var bulbM = new T.MeshBasicMaterial({ color: 0xfff1c8 }); dispose.push(bulbM);
    lamp.add(add(new T.SphereGeometry(0.035, 12, 8), bulbM, [0, -0.1, 0], null, 0));
    var spot = new T.SpotLight(0xffe2b0, 22, 9, 0.62, 0.6, 1.6); spot.position.set(0.55, 2.86, -1.05); spot.target.position.set(0.75, 0, -1.4);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0008; scene.add(spot); scene.add(spot.target);
    scene.add(new T.HemisphereLight(0x1a2030, 0x050403, 0.25));
    // dust in the light
    var DN = 700, dpos = new Float32Array(DN * 3);
    for (i = 0; i < DN; i++) { var rr = Math.random() * 0.9, an = Math.random() * 6.283, hy = Math.random() * 2.8; dpos[i * 3] = 0.6 + Math.cos(an) * rr * (hy / 2.8 + 0.2); dpos[i * 3 + 1] = hy; dpos[i * 3 + 2] = -1.2 + Math.sin(an) * rr * (hy / 2.8 + 0.2); }
    var dg = new T.BufferGeometry(); dg.setAttribute("position", new T.BufferAttribute(dpos, 3)); dispose.push(dg);
    var dm = new T.PointsMaterial({ color: 0xffe9c0, size: 0.006, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending }); dispose.push(dm);
    scene.add(new T.Points(dg, dm));
    // the faceless one: very tall, very thin, hunched over the console, hands never still
    var coatM = M({ color: 0xe4e2db, roughness: 0.9 }), skinM = M({ color: 0xd4cfc6, roughness: 0.32, metalness: 0 }), darkM = M({ color: 0x141414, roughness: 0.8 }), gloveM = M({ color: 0x2a2c2f, roughness: 0.5 });
    var F0 = buildFig(T, add, M, { cm: coatM, km: skinM, dm: darkM, shm: M({ color: 0x070707, roughness: 0.35, metalness: 0.2 }), hm: gloveM, dress: "coat" });
    var fig = F0.g, torso = F0.torso, neck = F0.neck, arms = F0.arms; scene.add(fig);
    fig.position.set(0.72, 0, -1.02); fig.rotation.y = Math.PI + 0.55; torso.rotation.x = 0.42; neck.rotation.x = 0.25;
    // he types: the arms rest on a keyboard desk placed right under his fingertips
    function typePose(t) {
      arms.forEach(function (a, k) {
        var dip = RM ? 0 : typeDip(t, k);
        a.sh.rotation.x = -0.95 + (RM ? 0 : Math.sin(t * 0.5 + k) * 0.03); a.sh.rotation.z = a.sd * 0.12;
        a.el.rotation.x = -0.75 + dip * 0.07; a.hand.rotation.x = -0.25 - dip * 0.12; a.hand.rotation.z = 0;
        a.f.forEach(function (fg, j) { fg.rotation.x = 0.35 + (j === typeFinger(t, k) ? dip * 0.7 : 0); });
      });
    }
    typePose(0); addKeys(T, add, M, scene, fig, arms);
    // the portal: a glowing ring, a swirling inside, the heart beating in the middle
    var portal = new T.Group(); portal.position.set(-3.3, 1.75, -2.6); scene.add(portal);
    var ringM = new T.MeshStandardMaterial({ color: 0x220405, emissive: 0xd8200f, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.4 }); dispose.push(ringM);
    var ring = add(new T.TorusGeometry(1.15, 0.085, 20, 96), ringM, null, null, 0); portal.add(ring);
    var ring2 = add(new T.TorusGeometry(1.32, 0.022, 8, 96), ringM, null, null, 0); portal.add(ring2);
    var swM = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { uT: { value: 0 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec2 vUv;uniform float uT;float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}" +
        "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}" +
        "void main(){vec2 p=vUv-0.5;float r=length(p)*2.0,a=atan(p.y,p.x);float s=a*3.0/6.2832+r*2.2-uT*0.35;" +
        "float v=n(vec2(s*6.0,r*5.0-uT*0.6))*0.6+n(vec2(s*13.0,r*9.0))*0.4;float m=smoothstep(1.0,0.55,r);" +
        "vec3 c=mix(vec3(0.25,0.0,0.04),vec3(0.9,0.12,0.08),v*v)*m*(0.3+0.4*v)*smoothstep(0.08,0.5,r);c+=vec3(0.5,0.03,0.06)*smoothstep(0.85,1.0,r)*m*1.5;gl_FragColor=vec4(c,1.0);}" });
    dispose.push(swM);
    var disc = add(new T.CircleGeometry(1.12, 64), swM, [0, 0, -0.02], null, 0); disc.castShadow = false; portal.add(disc);
    var heartT = new T.TextureLoader().load("/site/img/heart.png"); heartT.colorSpace = T.SRGBColorSpace; dispose.push(heartT);
    var heartM = new T.MeshBasicMaterial({ map: heartT, transparent: true, color: 0xffd0d0, depthWrite: false }); dispose.push(heartM);
    var heart = add(new T.PlaneGeometry(0.5, 0.45), heartM, [0, 0, 0.05], null, 0); heart.castShadow = false; portal.add(heart);
    var pl = new T.PointLight(0xff2a1a, 6, 9, 1.6); pl.position.set(-3.0, 1.75, -2.1); scene.add(pl);
    // post: camcorder (aberration, grain, tracking, scanlines, focus, vignette, tone curve)
    var post = new T.ShaderMaterial({ uniforms: { tD: { value: RT.texture }, uT: { value: 0 }, uAb: { value: 0.006 }, uGr: { value: 0.12 }, uBl: { value: 0 }, uTear: { value: 0 }, uRed: { value: 0 }, uExp: { value: 1 }, uRes: { value: new T.Vector2(4, 4) } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
      fragmentShader: "varying vec2 vUv;uniform sampler2D tD;uniform float uT,uAb,uGr,uBl,uTear,uRed,uExp;uniform vec2 uRes;" +
        "float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}" +
        "vec3 sp(vec2 uv){vec2 o=uBl/uRes;vec3 c=texture2D(tD,uv).rgb*0.36;c+=texture2D(tD,uv+vec2(o.x,0.0)).rgb*0.16;c+=texture2D(tD,uv-vec2(o.x,0.0)).rgb*0.16;c+=texture2D(tD,uv+vec2(0.0,o.y)).rgb*0.16;c+=texture2D(tD,uv-vec2(0.0,o.y)).rgb*0.16;return c;}" +
        "void main(){vec2 uv=vUv;float fr=floor(uT*24.0);" +
        "float bd=step(0.982-uTear*0.4,h(vec2(floor(uv.y*48.0),fr)));uv.x+=bd*(h(vec2(fr,uv.y))-0.5)*(0.025+uTear*0.2);" +
        "uv.x+=sin(uv.y*30.0+uT*2.0)*0.0009;float trk=smoothstep(0.0,0.02,abs(fract(uv.y-uT*0.11)-0.5))*0.0+0.0;" +
        "vec2 d=uv-0.5;float ab=uAb*(0.5+dot(d,d)*3.0);vec3 c=vec3(sp(uv+d*ab).r,sp(uv).g,sp(uv-d*ab).b)*uExp;" +
        "c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);c=pow(clamp(c,0.0,1.0),vec3(1.0/2.2));" +
        "c=mix(c,vec3(dot(c,vec3(0.3,0.59,0.11))),0.25)*vec3(1.0,1.03,0.95);" +
        "float ln=step(0.995,h(vec2(floor(uv.y*260.0),fr)));c+=ln*0.22;c+=step(0.9985,h(vec2(floor(uv.y*90.0),fr*1.7)))*vec3(0.5);" +
        "c*=0.9+0.1*sin(uv.y*uRes.y*1.6);c+=(h(uv*uRes+fract(uT*7.0)*91.0)-0.5)*uGr;" +
        "c*=smoothstep(0.95,0.28,length(d*vec2(1.0,0.9)));c=mix(c,vec3(c.r*1.5+0.05,c.g*0.25,c.b*0.3),uRed);gl_FragColor=vec4(c,1.0);}",
      depthTest: false, depthWrite: false });
    dispose.push(post);
    var pScene = new T.Scene(), pCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), pq = new T.Mesh(new T.PlaneGeometry(2, 2), post); pScene.add(pq); dispose.push(pq.geometry);
    // the scare: the same smooth head, right in the lens
    var sc = new T.Group(); scene.add(sc); sc.visible = false;
    var sHead = add(new T.SphereGeometry(1, 40, 30), skinM, [0, 0, 0], null, 0); sHead.scale.set(0.12, 0.19, 0.14); sc.add(sHead);
    sc.add(add(new T.CylinderGeometry(0.04, 0.05, 0.3, 10), skinM, [0, -0.3, 0], null, 0));
    var sLight = new T.PointLight(0xffffff, 0, 2, 2); scene.add(sLight);
    var V = new T.Vector3(), look = new T.Vector3(), camA = new T.Vector3(-0.75, 1.58, 2.4), figHead = new T.Vector3(0.55, 1.95, -1.25), portC = portal.position.clone();
    function size() {
      var w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      R.setSize(w, h, false); R.domElement.style.width = w + "px"; R.domElement.style.height = h + "px";
      RT.setSize(Math.round(w * DPR), Math.round(h * DPR)); post.uniforms.uRes.value.set(w * DPR, h * DPR);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    var sm = function (a, b, v) { v = Math.max(0, Math.min(1, (v - a) / (b - a))); return v * v * (3 - 2 * v); };
    var flick = 1;
    function frame(t, TL) {
      var u = post.uniforms, still = RM ? 0 : 1;
      u.uT.value = t; swM.uniforms.uT.value = t;
      if ((t * 30 | 0) % 3 === 0) paintScr(t);
      // the lamp flickers
      if (!RM && Math.random() < 0.06) flick = Math.random() < 0.35 ? 0.08 : 0.6 + Math.random() * 0.4; else flick += (1 - flick) * 0.2;
      spot.intensity = 22 * (RM ? 1 : flick); bulbM.color.setScalar(RM ? 1 : 0.3 + flick * 0.7);
      lamp.rotation.z = Math.sin(t * 0.7) * 0.03 * still;
      // dust drifts
      var pa = dg.attributes.position.array; for (var i = 1; i < pa.length; i += 3) { pa[i] -= 0.0015 * still; if (pa[i] < 0) pa[i] = 2.8; } dg.attributes.position.needsUpdate = still === 1;
      // the hands at work: restless, wrong
      typePose(t);
      var tw = !RM && Math.sin(t * 1.3) > 0.97 ? 0.25 : 0;                                  // an occasional jerk of the head
      neck.rotation.z = Math.sin(t * 0.6) * 0.08 * still + tw; neck.rotation.y = sm(3.6, 4.4, t) * 0.5 * (1 - sm(5.2, 6, t)) * (RM ? 0 : 1);
      // the heart in the portal
      var p = (t % 0.86) / 0.86, b = Math.exp(-Math.pow((p - 0.05) / 0.05, 2)) * 0.16 + Math.exp(-Math.pow((p - 0.24) / 0.05, 2)) * 0.09;
      heart.scale.setScalar(1 + (RM ? 0 : b)); pl.intensity = (5 + b * 40) * (0.12 + 0.88 * sm(TL.turn - 0.5, TL.turn + 1.5, t)); ringM.emissiveIntensity = 1.3 + b * 3.5;
      ring.rotation.z = t * 0.2; ring2.rotation.z = -t * 0.33; ring2.position.x = (!RM && Math.random() < 0.04) ? 0.05 : 0;
      // the camera: handheld breathing, a turn, a slow zoom, the cut
      var br = still * 1, sx = Math.sin(t * 0.9) * 0.02 * br + (Math.random() - 0.5) * 0.006 * br, sy = Math.sin(t * 1.3) * 0.015 * br + (Math.random() - 0.5) * 0.005 * br;
      var turn = sm(TL.turn, TL.turn + 1.9, t), zoom = sm(TL.zoom, TL.cut - 0.2, t);
      cam.position.copy(camA).lerp(V.set(-1.6, 1.68, 0.9), turn * 0.6).lerp(V.set(-2.75, 1.74, -1.0), zoom * 0.45);
      cam.position.x += sx; cam.position.y += sy;
      look.copy(figHead).lerp(portC, turn); look.x += sx * 6; look.y += sy * 6;
      cam.fov = 52 - zoom * 8; cam.updateProjectionMatrix(); cam.lookAt(look);
      cam.rotation.z += Math.sin(t * 0.7) * 0.012 * br;
      u.uBl.value = RM ? 0 : (t < 1.6 ? 3.2 * (1 - sm(0.2, 1.6, t)) : 0) + (turn > 0 && turn < 1 ? 4 * Math.sin(turn * Math.PI) : 0) + (t > 4.8 && t < 5.6 ? 1.8 * Math.sin((t - 4.8) / 0.8 * Math.PI) : 0);
      u.uAb.value = 0.006 + zoom * 0.006; u.uRed.value = zoom * 0.15; u.uExp.value = 1.15; u.uGr.value = 0.13; u.uTear.value = 0;
      if (t >= TL.cut) {                       // hard cut: it is right here
        var k2 = t - TL.cut; sc.visible = true; fig.visible = true;
        cam.fov = 60; cam.updateProjectionMatrix(); cam.position.set(0, 1.6, 0); cam.rotation.set(0, 0, RM ? 0 : (Math.random() - 0.5) * 0.06);
        sc.position.set((RM ? 0 : (Math.random() - 0.5) * 0.02), 1.6 + (RM ? 0 : (Math.random() - 0.5) * 0.02), -0.52 + Math.min(0.1, k2 * 0.5));
        sc.rotation.set(0.1, RM ? 0 : Math.max(0, 1.3 - k2 * 18), RM ? 0 : Math.sin(k2 * 40) * 0.05);
        sLight.position.set(0.35, 1.9, -0.1); sLight.intensity = RM ? 0.8 : 0.9 + Math.random() * 0.9;
        spot.intensity = 0; pl.intensity = 0; monL.intensity = 0.4;
        u.uTear.value = RM ? 0 : 1; u.uAb.value = RM ? 0.01 : 0.05; u.uRed.value = RM ? 0.15 : 0.3; u.uGr.value = RM ? 0.15 : 0.3; u.uBl.value = 0;
      }
      R.setRenderTarget(RT); R.render(scene, cam); R.setRenderTarget(null); R.render(pScene, pCam);
    }
    return {
      size: size, frame: frame,
      dispose: function () { dispose.forEach(function (d) { try { d.dispose(); } catch (e) { /* gone */ } }); RT.dispose(); R.dispose(); try { R.forceContextLoss(); } catch (e) { /* gone */ } R.domElement.remove(); }
    };
  }
  // ---- if three.js could not load: the same shots, flat
  function lab2d(host) {
    var c = document.createElement("canvas"); host.appendChild(c); var x = c.getContext("2d"), W = 0, H = 0;
    function size() { W = c.width = Math.ceil(innerWidth / 2); H = c.height = Math.ceil(innerHeight / 2); c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; }
    function fig(cx, base, s) {
      x.fillStyle = "#cfcac0"; x.beginPath(); x.ellipse(cx, base - 205 * s, 13 * s, 20 * s, 0.3, 0, 7); x.fill();
      x.fillStyle = "#bdb9b0"; x.beginPath(); x.moveTo(cx - 22 * s, base - 170 * s); x.lineTo(cx + 26 * s, base - 165 * s); x.lineTo(cx + 36 * s, base - 40 * s); x.lineTo(cx - 34 * s, base - 40 * s); x.fill();
      x.fillStyle = "#111"; x.fillRect(cx - 12 * s, base - 40 * s, 8 * s, 40 * s); x.fillRect(cx + 6 * s, base - 40 * s, 8 * s, 40 * s);
    }
    function frame(t, TL) {
      var turn = Math.max(0, Math.min(1, (t - TL.turn) / 1.9)), zoom = Math.max(0, Math.min(1, (t - TL.zoom) / (TL.cut - TL.zoom)));
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#050505"; x.fillRect(0, 0, W, H);
      var ox = -turn * W * 0.9 + (RM ? 0 : Math.sin(t) * 3), fl = RM || Math.random() > 0.06 ? 1 : 0.3;
      x.translate(ox, RM ? 0 : Math.sin(t * 1.3) * 2);
      var g = x.createRadialGradient(W * 0.6, H * 0.25, 4, W * 0.6, H * 0.6, H * 0.8); g.addColorStop(0, "rgba(255,226,170," + 0.35 * fl + ")"); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = "#0e1a16"; x.fillRect(W * 0.42, H * 0.5, W * 0.4, H * 0.12); x.fillStyle = "#3fbf9a"; x.fillRect(W * 0.46, H * 0.42, W * 0.08, H * 0.07); x.fillRect(W * 0.6, H * 0.4, W * 0.1, H * 0.08);
      fig(W * 0.58, H * 0.92, H / 260);
      // the portal, to the left
      var pc = -W * 0.3 + W * 0.9 + W * 0.0, py = H * 0.45, pr = H * (0.28 + zoom * 0.35);
      x.save(); x.translate(-ox, 0); x.translate(-ox * 0 + (1 - turn) * -W, 0);
      var rg = x.createRadialGradient(W / 2, py, pr * 0.2, W / 2, py, pr); rg.addColorStop(0, "rgba(255,60,30,.5)"); rg.addColorStop(0.85, "rgba(120,0,20,.6)"); rg.addColorStop(1, "rgba(255,40,24,1)");
      x.fillStyle = rg; x.beginPath(); x.arc(W / 2, py, pr, 0, 7); x.fill();
      if (HOK) { var b = 1 + (RM ? 0 : Math.max(0, Math.sin((t % 0.86) / 0.86 * Math.PI * 4)) * 0.1), hh = pr * 0.45 * b; x.drawImage(HIMG, W / 2 - hh * HIMG.width / HIMG.height / 2, py - hh / 2, hh * HIMG.width / HIMG.height, hh); }
      x.restore(); void pc;
      if (t >= TL.cut) { x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.fillStyle = "#d4cfc6"; x.beginPath(); x.ellipse(W / 2 + (RM ? 0 : (Math.random() - 0.5) * 8), H * 0.55, W * 0.32, H * 0.6, 0, 0, 7); x.fill(); }
      x.setTransform(1, 0, 0, 1, 0, 0);
      if (!RM) { x.fillStyle = "rgba(255,255,255,.07)"; for (var n = 0; n < 300; n++) x.fillRect(Math.random() * W | 0, Math.random() * H | 0, 1, 1); }
      var v = x.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.85)"); x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
    return { size: size, frame: frame, dispose: function () { c.remove(); } };
  }
  // ---------------------------------------------------------------- «Записи»: found tapes on the same camcorder engine as the special seed.
  // A round may drop one unmarked cassette (each tape has its own odds, rolled once per round; never in the very first round).
  // The player learns which tape it is only by putting it into the VCR in the archive. Then it is filed into its numbered slot.
  // Owner preview: ?tape=N (1–10, or x) plays a tape (+&ft=<s> holds that moment), ?tapes=all opens every slot (nothing is saved),
  // ?tapes=drop drops a cassette 2 s into every round, ?why=1 plays the «why» scene.
  var K_TAPES = "sotg.tapes2", K_PLAYED = "sotg.shards.played", K_WHY = "sotg.why";
  var TAPES = [
    { k: "plans", en: "BLUEPRINTS", ru: "Чертежи", odds: 5, d: "14.02.19░░", tm: 83560, len: 12, cap: "THE RING MUST BE PERFECT. NO ONE ELSE MAY READ THIS.", line: "Плёнка №1. Почерк не установлен." },
    { k: "frame", en: "THE FRAME", ru: "Каркас", odds: 5, d: "02.04.19░░", tm: 5588, len: 12, cap: "THE FRAME HOLDS. MY HANDS DO NOT.", line: "Плёнка №2. Сварка шла всю ночь." },
    { k: "start", en: "FIRST START", ru: "Первый запуск", odds: 5, d: "░░.░░.19░░", tm: 79491, len: 11, cap: "FIRST START. THE LIGHT CAME BACK WRONG.", line: "Плёнка №3. Дата стёрта." },
    { k: "shadow", en: "THE SHADOW", ru: "Тень", odds: 20, d: "19.06.19░░", tm: 11762, len: 10, cap: "SOMETHING STOOD ON THE OTHER SIDE. IT WAS WAITING.", line: "Плёнка №4. В лаборатории был один человек." },
    { k: "voices", en: "VOICES", ru: "Голоса", odds: 20, d: "03.07.19░░", tm: 81005, len: 11, cap: "THEY STOPPED COMING. THE RADIO STILL CALLS THEIR NAMES.", line: "Плёнка №5. Стулья так и стоят.",
      subs: [[2.2, 4.6, "CAN YOU HEAR US"], [5.6, 7.8, "COME BACK"], [8.6, 10.4, "THE GATE IS NOT"]] },
    { k: "fall", en: "THE FALL", ru: "Приступ", odds: 100, d: "07.08.19░░", tm: 86310, len: 11, cap: "I FELL AGAIN. THE GATE KEPT BEATING WITHOUT ME.", line: "Плёнка №6. Камера пролежала на полу до утра." },
    { k: "family", en: "FAMILY", ru: "Семья", odds: 100, d: "21.08.19░░", tm: 2470, len: 11, cap: "I PROMISED TO COME HOME BEFORE THE GATE WAS DONE.", line: "Плёнка №7. Рисунок подписан детской рукой." },
    { k: "heart", en: "THE HEART", ru: "Сердце", odds: 500, d: "11.09.19░░", tm: 10933, len: 12, cap: "IT FORMED BY ITSELF. IT BEATS FASTER WHEN I AM NEAR.", line: "Плёнка №8. Что было в капсуле — не записано." },
    { k: "step", en: "THE STEP", ru: "Шаг", odds: 1000, d: "30.09.19░░", tm: 86381, len: 13.5, cap: "IT CALLED. I ANSWERED. DO NOT FOLLOW.", line: "Плёнка №9. Последняя из лаборатории." },
    { k: "beyond", en: "THE OTHER SIDE", ru: "По ту сторону", odds: 5000, d: "░░.░░.░░░░", tm: 0, len: 12, cap: "THE CAMERA WAS FOUND ON THE OTHER SIDE. THE LIGHT WAS STILL ROLLING.", line: "Плёнка №10. Найдена по ту сторону Врат." },
    { k: "x", en: "???", ru: "???", odds: 1000000, d: "░░.░░.░░░░", tm: 0, len: 9, cap: "WHY", line: "Плёнка ???. Не должна существовать." },
    { k: "invite", en: "INVITATION", ru: "Приглашение", odds: 1000000, d: "░░.11.19░░", tm: 80140, len: 14, keep: 1, cap: "THE LETTER CAME BEFORE DAWN. THE NAME WOULD NOT STAY STILL.", line: "Плёнка №0. Приглашение.",
      ltr: [9.9, 13.4] },
    { k: "end", en: "THE LAST TAPE", ru: "Последняя", odds: 0, d: "░░.░░.░░░░", tm: 0, len: 25, keep: 1, cap: "THE BODY WAS NEVER FOUND. THE COAT WAS STILL WARM.", line: "Плёнка №∞. Дата стёрта.",
      ltr: [0, 7.1], subs: [[16.2, 17.3, "HELP!"]] }
  ];
  var TX = 11, T0 = 12, TF = 13;    // «???» is the slot after №10; №0 (the invitation) opens the shelf; №∞ appears only after both secrets
  var SHELF = [T0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, TX, TF];
  function tnum(id) { return id === TX ? "???" : id === T0 ? "0" : id === TF ? "∞" : String(id); }
  function qp(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
  var TAPES_ALL = qp("tapes") === "all", TAPE_DROP = qp("tapes") === "drop";
  // the store: f = filed (numbered) tapes, inv = unmarked cassettes waiting in the tray (their ids are hidden from the player)
  var TSTORE = null;
  function tstore() {
    if (TSTORE) return TSTORE;
    var s = null; try { s = JSON.parse(lsGet(K_TAPES) || "null"); } catch (e) { s = null; }
    var ok = function (a) { return Array.isArray(a) ? a.filter(function (v, i) { return v >= 1 && v <= TAPES.length && (v | 0) === v && a.indexOf(v) === i; }) : []; };
    TSTORE = { f: ok(s && s.f), inv: ok(s && s.inv) };
    if (TAPES_ALL) TSTORE = { f: TAPES.map(function (_, i) { return i + 1; }), inv: [] };     // every slot, №∞ included
    return TSTORE;
  }
  function tsave() { if (!TAPES_ALL) lsSet(K_TAPES, JSON.stringify(tstore())); }
  function tapeHave(id) { var s = tstore(); return s.f.indexOf(id) >= 0 || s.inv.indexOf(id) >= 0; }
  function tapeRoll() {          // one roll per round: each tape its own odds; a tape already owned becomes nothing
    if (TAPE_DROP) { for (var i = 1; i < TX; i++) if (!tapeHave(i)) return i; return 0; }
    var r = cryptoBelow(1000000), acc = 0, ids = [T0, TX, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];     // the odds stay inside: never shown to the player
    for (var j = 0; j < ids.length; j++) { acc += 1000000 / TAPES[ids[j] - 1].odds; if (r < acc) return tapeHave(ids[j]) ? 0 : ids[j]; }
    return 0;
  }
  // №∞ never drops: once №0 and «???» are both on the shelf, it simply lies in the tray
  function finalCheck() { var s = tstore(); if (s.f.indexOf(T0) >= 0 && s.f.indexOf(TX) >= 0 && !tapeHave(TF)) { s.inv.push(TF); tsave(); return true; } return false; }
  function allTapes() { var s = tstore(); return TAPES.every(function (_, i) { return s.f.indexOf(i + 1) >= 0; }); }
  var CAS = ["################", "#..............#", "#.LLLLLLLLLLLL.#", "#.RRRRRRRRRRRR.#", "#.LgLLgLgLLgLL.#",
    "#..WWWWWWWWWW..#", "#..WooWWWWooW..#", "#..WWWWWWWWWW..#", "#...bbbbbbbb...#", "################"];
  var CASC = { "#": "#d6d6d6", ".": "#232323", L: "#e6dfcb", R: "#c4001f", g: "#3a3a3a", W: "#050505", o: "#bdbdbd", b: "#3c3c3c" }, CASCV = null;
  function casCanvas() {
    if (CASCV) return CASCV;
    var c = document.createElement("canvas"); c.width = 16; c.height = 10; var x = c.getContext("2d");
    CAS.forEach(function (r, y) { for (var i = 0; i < 16; i++) { x.fillStyle = CASC[r[i]]; x.fillRect(i, y, 1, 1); } });
    return (CASCV = c);
  }
  function casSvg(cls) {
    var r = "";
    CAS.forEach(function (row, y) { for (var i = 0; i < 16; i++) r += '<rect x="' + i + '" y="' + y + '" width="1" height="1" fill="' + CASC[row[i]] + '"/>'; });
    return '<svg class="' + cls + '" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">' + r + "</svg>";
  }
  // cipher glyphs painted into a 2D context (chalk, ink, the end card)
  function glyphText(x, text, x0, y0, p, col, jit) {
    x.fillStyle = col;
    for (var i = 0, cx = x0; i < text.length; i++, cx += (GW + 1) * p) {
      var g = GLYPH[text[i]]; if (!g) continue;
      for (var k = 0; k < GW * GH; k++) if (g[k]) x.fillRect(cx + (k % GW) * p + (jit ? (Math.random() - 0.5) * jit : 0), y0 + Math.floor(k / GW) * p + (jit ? (Math.random() - 0.5) * jit : 0), p, p);
    }
  }
  // sound: tape hiss and room tone, plus the events of each tape (synth only)
  function tapeSound() {
    var a = SND.on ? ac() : null, out = null, nodes = [], hum = null, roar = null;
    if (a) try {
      out = a.createGain(); out.gain.value = 0.0001; var comp = a.createDynamicsCompressor(); out.connect(comp); comp.connect(a.destination);
      out.gain.exponentialRampToValueAtTime(0.34, a.currentTime + 1.2);
      var n = a.createBufferSource(), hp = a.createBiquadFilter(), ng = a.createGain(); n.buffer = noiseBuf(a); n.loop = true; hp.type = "highpass"; hp.frequency.value = 2600; ng.gain.value = 0.03;
      n.connect(hp); hp.connect(ng); ng.connect(out); n.start(); nodes.push(n);
      var o = a.createOscillator(), og = a.createGain(); o.frequency.value = 46; og.gain.value = 0.08; o.connect(og); og.connect(out); o.start(); nodes.push(o);
    } catch (e) { a = null; }
    function noise(dur, f, q, vol, type, at) {
      if (!a) return; var t = a.currentTime + (at || 0), s = a.createBufferSource(), bf = a.createBiquadFilter(), g = a.createGain();
      s.buffer = noiseBuf(a); bf.type = type || "bandpass"; bf.frequency.value = f; bf.Q.value = q || 1;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bf); bf.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }
    function tone(f0, f1, dur, vol, type, at) {
      if (!a) return; var t = a.currentTime + (at || 0), o = a.createOscillator(), g = a.createGain(); o.type = type || "sine";
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    // ---- the warm house: a piano (decaying partials + a felt hammer), and the music that stops
    var pbus = null, dr = null;
    function piano(f, vol) {
      if (!a) return;
      if (!pbus) { pbus = a.createGain(); var plp = a.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.value = 3400; pbus.connect(plp); plp.connect(out); }
      var t = a.currentTime, dec = Math.max(1.1, 3.6 - Math.log2(f / 110) * 0.75);
      [[1, 1, "triangle"], [1.0016, 0.35, "sine"], [2.003, 0.38, "sine"], [3.007, 0.15, "sine"], [4.018, 0.06, "sine"]].forEach(function (q, i) {
        var o = a.createOscillator(), g = a.createGain(), d = dec / (1 + i * 0.7); o.type = q[2]; o.frequency.value = f * q[0];
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * q[1], t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.004, d / 4.5);
        o.connect(g); g.connect(pbus); o.start(t); o.stop(t + d + 0.3);
      });
      noise(0.035, Math.min(5200, f * 7), 1.4, vol * 0.16, "bandpass");
    }
    // ---- dread: a floor near infrasound, a minor-second shimmer, Shepard tones, an echo for drips and a broken music box
    function drInit() {
      if (dr || !a) return;
      dr = { g: a.createGain(), sh: [], lv: 0, wet: a.createGain() }; dr.g.gain.value = 0; dr.g.connect(out);
      [[31, 0.55, "sine"], [32.6, 0.5, "sine"], [43.8, 0.16, "sine"], [46.3, 0.12, "triangle"]].forEach(function (q) { var o = a.createOscillator(), g = a.createGain(); o.type = q[2]; o.frequency.value = q[0]; g.gain.value = q[1]; o.connect(g); g.connect(dr.g); o.start(); nodes.push(o); });
      var n = a.createBufferSource(), lp = a.createBiquadFilter(), ng = a.createGain(); n.buffer = noiseBuf(a); n.loop = true; lp.type = "lowpass"; lp.frequency.value = 75; ng.gain.value = 0.7; n.connect(lp); lp.connect(ng); ng.connect(dr.g); n.start(); nodes.push(n);
      var lfo = a.createOscillator(), lg = a.createGain(), hg = a.createGain(); lfo.frequency.value = 0.31; lg.gain.value = 0.008; hg.gain.value = 0.009; lfo.connect(lg); lg.connect(hg.gain); lfo.start(); nodes.push(lfo);
      [1174.7, 1244.5, 1661.2].forEach(function (f) { var o = a.createOscillator(); o.frequency.value = f; o.connect(hg); o.start(); nodes.push(o); }); hg.connect(dr.g);
      for (var i = 0; i < 6; i++) { var so = a.createOscillator(), sg = a.createGain(); so.frequency.value = 60; sg.gain.value = 0; so.connect(sg); sg.connect(dr.g); so.start(); nodes.push(so); dr.sh.push({ o: so, g: sg }); }
      var dl = a.createDelay(1), fb = a.createGain(), dlp = a.createBiquadFilter(); dl.delayTime.value = 0.37; fb.gain.value = 0.45; dlp.type = "lowpass"; dlp.frequency.value = 2400;
      dr.wet.gain.value = 0.6; dr.wet.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(out);
      dr.kill = function () { try { fb.disconnect(); dl.disconnect(); } catch (e) { /* gone */ } };
    }
    function dread(lv, t, shep) {
      if (!a) return; drInit();
      var now = a.currentTime; dr.g.gain.setTargetAtTime(lv * 0.55, now, lv > dr.lv ? 0.5 : 0.05); dr.lv = lv;
      dr.sh.forEach(function (q, i) { var ph = (t * 0.05 + i / 6) % 1; q.o.frequency.setTargetAtTime(55 * Math.pow(2, ph * 6), now, 0.03); q.g.gain.setTargetAtTime(Math.pow(Math.sin(Math.PI * ph), 2) * 0.05 * (shep || 0), now, 0.06); });
    }
    function box(f, vol, wob) {           // a music-box tine, sagging like a warped tape
      if (!a) return; drInit();
      var t = a.currentTime, o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(), g2 = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      o.frequency.value = f; o2.frequency.value = f * 4.17; lfo.frequency.value = 3.5 + Math.random() * 2.5; lg.gain.value = 12 + wob * 28;
      lfo.connect(lg); lg.connect(o.detune); lg.connect(o2.detune);
      o.detune.setValueAtTime(-wob * 20, t); o.detune.linearRampToValueAtTime(-wob * 110, t + 1.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.setTargetAtTime(0.0001, t + 0.005, 0.55);
      g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.003); g2.gain.setTargetAtTime(0.0001, t + 0.003, 0.09);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out); g.connect(dr.wet);
      [o, o2, lfo].forEach(function (x) { x.start(t); x.stop(t + 2.6); });
    }
    function drip() {
      if (!a) return; drInit();
      var t = a.currentTime, f = 1700 + Math.random() * 1100, o = a.createOscillator(), g = a.createGain();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.07);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(out); g.connect(dr.wet); o.start(t); o.stop(t + 0.2);
    }
    function swell(dur, vol) {             // a reversed swell: grows, then is cut off
      if (!a) return;
      var t = a.currentTime, g = a.createGain(), bf = a.createBiquadFilter(), src = a.createBufferSource();
      bf.type = "lowpass"; bf.frequency.setValueAtTime(200, t); bf.frequency.exponentialRampToValueAtTime(4200, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.3, t + dur); g.gain.setValueAtTime(vol || 0.3, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.025);
      src.buffer = noiseBuf(a); src.connect(bf);
      [98, 103.8, 138.6].forEach(function (f) { var o = a.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(bf); o.start(t); o.stop(t + dur + 0.05); });
      bf.connect(g); g.connect(out); src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.05);
    }
    function screech() {
      if (!a) return; var t = a.currentTime, bf = a.createBiquadFilter(), g = a.createGain(); bf.type = "bandpass"; bf.frequency.value = 3100; bf.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      [2870, 3015, 4410].forEach(function (f) { var o = a.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.12, t + 0.6); o.connect(bf); o.start(t); o.stop(t + 0.75); });
      bf.connect(g); g.connect(out); noise(0.4, 2400, 0.5, 0.25);
    }
    function shout() {                      // a muffled cry, no words: a voice through two formants and a hand over the mic
      if (!a) return; var t = a.currentTime, o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter(), vib = a.createOscillator(), vg = a.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(205, t); o.frequency.linearRampToValueAtTime(240, t + 0.12); o.frequency.linearRampToValueAtTime(170, t + 0.6);
      vib.frequency.value = 6; vg.gain.value = 6; vib.connect(vg); vg.connect(o.frequency);
      lp.type = "lowpass"; lp.frequency.value = 1100;
      [[750, 1], [1250, 0.6]].forEach(function (q) { var bp = a.createBiquadFilter(), bg = a.createGain(); bp.type = "bandpass"; bp.frequency.value = q[0]; bp.Q.value = 5; bg.gain.value = q[1]; o.connect(bp); bp.connect(bg); bg.connect(lp); });
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.setValueAtTime(0.5, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7); vib.start(t); vib.stop(t + 0.7); noise(0.6, 900, 0.6, 0.12);
    }
    var stat = null;
    function roarStat(lv) {      // radio static: band-limited noise
      if (!a) return;
      if (!stat) { stat = { s: a.createBufferSource(), f: a.createBiquadFilter(), g: a.createGain() }; stat.s.buffer = noiseBuf(a); stat.s.loop = true;
        stat.f.type = "bandpass"; stat.f.frequency.value = 1800; stat.f.Q.value = 0.6; stat.g.gain.value = 0; stat.s.connect(stat.f); stat.f.connect(stat.g); stat.g.connect(out); stat.s.start(); nodes.push(stat.s); }
      stat.g.gain.setTargetAtTime(lv * 0.25, a.currentTime, 0.05);
    }
    return {
      noise: noise, tone: tone, key: function () { keyClick(a, out); },
      piano: piano, damp: function () { if (a && pbus) pbus.gain.setTargetAtTime(0.0001, a.currentTime, 0.07); },
      dread: dread, box: box, drip: drip, swell: swell, screech: screech, shout: shout,
      knock: function () { tone(150, 70, 0.1, 0.7); noise(0.07, 420, 1, 0.6, "lowpass"); noise(0.025, 1900, 1, 0.18); },
      paper: function (d) { noise(d, 3600, 0.6, 0.07, "highpass"); noise(d * 0.8, 1200, 0.8, 0.04); },
      foot: function (v) { tone(95, 40, 0.09, 0.32 * v); noise(0.07, 650, 1, 0.22 * v, "lowpass"); },
      breath: function (v, inh) { noise(0.32, inh ? 1300 : 800, 0.9, 0.12 * v); },
      thump: function (v) { tone(66, 34, 0.24, 0.6 * v); tone(58, 34, 0.24, 0.42 * v, "sine", 0.17); },
      thud: function () { tone(90, 30, 0.5, 0.7); noise(0.35, 300, 0.7, 0.5, "lowpass"); noise(0.08, 2400, 1, 0.25); },
      pop: function () { noise(0.12, 3200, 0.8, 0.45); noise(0.5, 6000, 0.5, 0.12, "highpass", 0.05); tone(900, 120, 0.15, 0.12, "square"); },
      sting: function () {
        [233, 247, 349, 370].forEach(function (f) { tone(f, f * 0.94, 1.1, 0.16, "sawtooth"); });
        noise(0.9, 1800, 0.4, 0.5); tone(70, 40, 0.9, 0.6);
      },
      hum: function (lv) {
        if (!a) return;
        if (!hum) { hum = { o: [a.createOscillator(), a.createOscillator()], f: a.createBiquadFilter(), g: a.createGain() };
          hum.o[0].type = "sawtooth"; hum.o[0].frequency.value = 50; hum.o[1].type = "square"; hum.o[1].frequency.value = 100.6; hum.f.type = "lowpass"; hum.g.gain.value = 0;
          hum.o.forEach(function (o) { o.connect(hum.f); o.start(); nodes.push(o); }); hum.f.connect(hum.g); hum.g.connect(out); }
        var t = a.currentTime; hum.g.gain.setTargetAtTime(lv * 0.13, t, 0.05); hum.f.frequency.setTargetAtTime(160 + lv * 1400, t, 0.08);
        hum.o[0].frequency.setTargetAtTime(50 + lv * 18, t, 0.1);
      },
      roar: function (lv) {
        if (!a) return;
        if (!roar) { roar = { s: a.createBufferSource(), f: a.createBiquadFilter(), g: a.createGain() }; roar.s.buffer = noiseBuf(a); roar.s.loop = true;
          roar.f.type = "lowpass"; roar.g.gain.value = 0; roar.s.connect(roar.f); roar.f.connect(roar.g); roar.g.connect(out); roar.s.start(); nodes.push(roar.s); }
        var t = a.currentTime; roar.g.gain.setTargetAtTime(lv * 0.3, t, 0.08); roar.f.frequency.setTargetAtTime(120 + lv * 2600, t, 0.1);
      },
      whisper: function (vol, radio) {       // a breathy, broken «why»: noise + a low buzz through gliding formants (w → a → i)
        if (!a) return;
        var t = a.currentTime, dur = 1.0, src = a.createBufferSource(), bz = a.createOscillator(), bg = a.createGain(), mix = a.createGain(), og = a.createGain();
        var ws = a.createWaveShaper(), cu = new Float32Array(512), dl = a.createDelay(0.5), fb = a.createGain();
        for (var i = 0; i < 512; i++) { var v = i / 255.5 - 1; cu[i] = Math.tanh(v * (radio ? 6 : 2.5)); }
        src.buffer = noiseBuf(a); bz.type = "sawtooth"; bz.frequency.setValueAtTime(radio ? 140 : 92, t); bz.frequency.linearRampToValueAtTime(radio ? 120 : 66, t + dur);
        bg.gain.value = radio ? 0.12 : 0.22; bz.connect(bg); bg.connect(mix); src.connect(mix);
        [[300, 760, 680, 1], [640, 1220, 2250, 0.7], [2200, 2500, 3000, 0.35]].forEach(function (f) {
          var bp = a.createBiquadFilter(), g = a.createGain(); bp.type = "bandpass"; bp.Q.value = 9;
          bp.frequency.setValueAtTime(f[0], t); bp.frequency.linearRampToValueAtTime(f[1], t + 0.28); bp.frequency.linearRampToValueAtTime(f[2], t + 0.8);
          g.gain.value = f[3]; mix.connect(bp); bp.connect(g); g.connect(og);
        });
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol, t + 0.18); og.gain.setValueAtTime(vol, t + 0.55); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        ws.curve = cu; og.connect(ws); ws.connect(out); ws.connect(dl); dl.delayTime.value = 0.17; fb.gain.value = 0.35; dl.connect(fb); fb.connect(dl); fb.connect(out);
        src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.1); bz.start(t); bz.stop(t + dur + 0.1);
        setTimeout(function () { try { fb.disconnect(); dl.disconnect(); } catch (e) { /* gone */ } }, (dur + 2) * 1000);
      },
      scream: function () {
        [190, 201, 283, 299, 410].forEach(function (f) { tone(f, f * 0.7, 1.3, 0.2, "sawtooth"); });
        noise(1.2, 1500, 0.3, 0.75); noise(0.4, 5000, 0.5, 0.3, "highpass"); tone(80, 35, 1.1, 0.8);
      },
      stat: function (lv) { roarStat(lv); },
      stop: function () {
        if (!a) return; var t = a.currentTime;
        try { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); } catch (e) { /* gone */ }
        nodes.forEach(function (x) { try { x.stop(t + 0.35); } catch (e) { /* gone */ } });
        if (dr) setTimeout(dr.kill, 600); a = null;
      }
    };
  }
  function midiF(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // №0: a gentle waltz in F (original): [tape s, midi note, volume]; it breaks off at the knock
  var INV_PIANO = (function () {
    var B = 0.45, t0 = 0.6, r = [], at = function (bar, beat) { return t0 + (bar * 3 + beat) * B + (tHash(bar * 3 + beat) - 0.5) * 0.03; };
    [[41, [57, 60]], [38, [57, 62]], [34, [53, 62]], [36, [52, 58]]].forEach(function (h, bar) {
      r.push([at(bar, 0), h[0], 0.17]); [1, 2].forEach(function (bt) { if (bar === 3 && bt === 2) return; h[1].forEach(function (m) { r.push([at(bar, bt) + 0.01, m, 0.06]); }); });
    });
    [[0, 0, 72], [0, 2, 69], [1, 0, 74], [1, 1, 72], [1, 2, 69], [2, 0, 70], [2, 2, 74], [3, 0, 72], [3, 1, 67]].forEach(function (n) { r.push([at(n[0], n[1]), n[2], 0.15]); });
    return r;
  })();
  // №∞: the broken lullaby (original), each tine more warped than the last; it ends on a leading tone that never resolves
  var END_LULL = [[0.6, 76, 0.1], [1.15, 72, 0.15], [1.7, 74, 0.2], [2.3, 71, 0.3], [3.6, 72, 0.4], [4.1, 69, 0.55], [4.6, 70, 0.7], [5.2, 69, 0.9], [5.95, 64, 1.2], [6.6, 68, 1.6]];
  var sm01 = function (a, b, v) { v = Math.max(0, Math.min(1, (v - a) / (b - a))); return v * v * (3 - 2 * v); };
  function weldOn(t) { return t > 0.6 && t < 10.4 && t % 2.6 < 1.9 && !(t > 3.8 && t < 4.3); }
  var WHYD = { k: "why", ru: "почему", d: "░░.░░.░░░░", tm: 0, len: 11.6, subs: [[2.0, 3.3, "WHY..."], [4.4, 5.7, "WHY..."], [6.8, 8.1, "WHY..."]] };
  // what each tape sounds like, in tape seconds (the same for the 3D and the flat fallback)
  function tapeAudio(k, t, S, once) {
    if (k === "plans") { if (!RM && t > 1.8 && t < 6.5 && Math.random() < 0.05) S.noise(0.06 + Math.random() * 0.08, 3800, 2, 0.08); once("f1", t > 9.3, function () { S.tone(1800, 1700, 0.05, 0.05, "square"); }); }
    if (k === "frame") { if (weldOn(t) && Math.random() < 0.5) S.noise(0.05 + Math.random() * 0.06, 2200 + Math.random() * 3000, 0.7, 0.12 + Math.random() * 0.1); S.hum(weldOn(t) ? 0.15 : 0); }
    if ((k === "start" && t < 7.0 || k === "fall" && t < 4.0) && !RM) { var kn = Math.floor(t / TYPE_DT); once("k" + kn, typeKey(kn) >= 0, S.key); }
    if (k === "start") {
      S.hum(t < 7.8 ? sm01(2, 7.2, t) : 0);
      [7.2, 7.45, 7.7].forEach(function (p, i) { once("p" + i, t > p, S.pop); });
      once("d", t > (RM ? 8 : 8.9), S.thud);
    }
    if (k === "shadow") { S.hum(0.12); once("z", t > 5.4, function () { S.tone(2400, 2600, 0.6, 0.03, "square"); }); once("s", t > 7.8, S.sting); }
    if (k === "voices") {
      S.stat(0.18 + (Math.random() < 0.1 ? 0.2 : 0) + (t > 2 && t < 10.4 ? 0.1 : 0));
      [2.3, 3.5, 5.7, 6.6, 8.7].forEach(function (p, i) { once("w" + i, t > p, function () { S.whisper(0.22, true); }); });
      once("c", t > 6.2, function () { S.tone(320, 290, 0.5, 0.05, "square"); });
    }
    if (k === "fall") {
      S.hum(0.1); if (!RM && t > 0.8 && t < 4.4 && Math.random() < 0.08) S.noise(0.08, 500, 1, 0.12);
      once("d", t > (RM ? 4.6 : 5.4), S.thud);
      if (t > 5.8) { var b = Math.floor((t - 5.8) / 0.95); once("b" + b, true, function () { S.thump(Math.max(0.25, 0.8 - b * 0.06)); }); }
    }
    if (k === "family") { var tk = Math.floor(t); once("t" + tk, true, function () { S.noise(0.025, 4200, 4, 0.06); }); }
    if (k === "heart") {
      S.hum(0.07);
      if (t > 2.5) { var hb = Math.floor((t - 2.5) / Math.max(0.55, 0.9 - (t - 2.5) * 0.03)); once("h" + hb, true, function () { S.thump(Math.min(0.8, 0.25 + (t - 2.5) * 0.06)); }); }
      once("g", t > 9.6, function () { S.tone(2600, 2500, 0.5, 0.06); S.tone(2600, 2500, 0.5, 0.05, "sine", 0.22); });
    }
    if (k === "step") {
      S.roar(t < 10.8 ? 0.15 + sm01(0, 9.5, t) * 0.75 : t < 11 ? 0 : 0.08);
      if (t < 9.1) { var st = Math.floor(t / 0.62); once("st" + st, true, function () { S.tone(110, 50, 0.12, 0.25); S.noise(0.06, 700, 1, 0.12); }); }
      once("w", t > 9.2, function () { S.noise(1.4, 900, 0.3, 0.5); S.tone(220, 40, 1.4, 0.3, "sawtooth"); });
      if (t > 11) { var hb2 = Math.floor((t - 11) / 0.86); once("h" + hb2, true, function () { S.thump(0.7); }); }
    }
    if (k === "beyond") {
      S.roar(0.12 + sm01(9, 11.5, t) * 0.2); once("s0", t > 0, function () { S.noise(0.5, 2000, 0.4, 0.3); });
      if (!RM && Math.random() < 0.025) S.tone(1800 + Math.random() * 1400, 1700 + Math.random() * 1400, 1.4, 0.035);
      if (t > 1) { var bb = Math.floor((t - 1) / 1.1); once("b" + bb, true, function () { S.thump(0.22); }); }
    }
    if (k === "invite") {
      INV_PIANO.forEach(function (n, i) { once("p" + i, t > n[0], function () { S.piano(midiF(n[1]), n[2]); }); });
      [5.5, 5.95, 6.4].forEach(function (p, i) { once("k" + i, t > p, S.knock); });
      once("dm", t > 5.56, S.damp);
      S.dread(t < 6.5 ? 0 : t < 13.4 ? 0.14 + sm01(6.5, 12.5, t) * 0.3 : 0.55, t, 0.12 + sm01(9, 13, t) * 0.4);
      once("sl", t > 7.75, function () { S.paper(0.55); });
      once("fl", t > 8.8, function () { S.noise(0.07, 900, 0.8, 0.14, "lowpass"); S.paper(0.15); });
      once("dp", t > 9.3, S.drip); once("op", t > 9.75, function () { S.paper(0.35); });
      [[11.0, 83, 0.5], [11.6, 79, 0.8], [12.3, 78, 1.2]].forEach(function (n, i) { once("b" + i, t > n[0], function () { S.box(midiF(n[1]), 0.045, n[2]); }); });
      once("rs", t > 12.9, function () { S.swell(0.5, 0.22); });
    }
    if (k === "end") {
      S.dread(t < 7 ? 0.5 : t < 12.15 ? 0.3 : t < 13.4 ? 0.04 : t < 16 ? 0.95 : t < 17.4 ? 0.6 : t < 18.9 ? 0 : t < 23.4 ? 0.75 : 0.3, t, t < 7 ? 0.3 : t < 12.15 ? 1 : 0.5);
      END_LULL.forEach(function (n, i) { once("m" + i, t > n[0], function () { S.box(midiF(n[1]), 0.07, n[2]); }); });
      [1.3, 3.75, 5.4, 14.2, 20.3, 22.1].forEach(function (p, i) { once("d" + i, t > p, S.drip); });
      once("tr", t > 7.0, function () { S.noise(0.25, 1800, 0.4, 0.4); });
      if (t > 7.1 && t < 12.15) { var rn = Math.floor((t - 7.1) / 0.31); once("r" + rn, true, function () { S.foot(1); }); var bn = Math.floor((t - 7.1) / 0.45); once("br" + bn, true, function () { S.breath(1, bn % 2); }); }
      once("bang", t > 12.1, function () { S.thud(); S.noise(0.2, 1500, 0.5, 0.35); });
      once("sk", t > 13.45, function () { S.screech(); S.sting(); });
      if (t > 13.5 && t < 18.9) { var hb = Math.floor((t - 13.5) / 0.62); once("h" + hb, true, function () { S.thump(0.75); }); }
      if (t > 12.3 && t < 23.4) { var bb = Math.floor((t - 12.3) / 0.6); once("bb" + bb, true, function () { S.breath(0.7, bb % 2); }); }
      [16.2, 16.85].forEach(function (p, i) { once("s" + i, t > p, S.shout); });
      once("sw", t > 18.3, function () { S.swell(0.6, 0.35); });
      once("gone", t > 18.9, function () { S.thud(); S.screech(); });
      [[19.7, 76, 2.2], [20.4, 75, 2.8], [21.3, 70, 3.4]].forEach(function (n, i) { once("g" + i, t > n[0], function () { S.box(midiF(n[1]), 0.05, n[2]); }); });
      if (t > 20.6 && t < 23.4) { var on = Math.floor((t - 20.6) / 0.16); once("o" + on, tHash(on * 3.1) > 0.35, function () { S.foot(0.35 + sm01(20.6, 23, t) * 0.65); }); }
      if (t > 23.4) S.stat(0.75); else if (t > 20.6) S.stat(0);
    }
    if (k === "x") {
      S.stat(0.35 + Math.random() * 0.2);
      [1.6, 4.4, 7.0].forEach(function (p, i) { once("w" + i, t > p, function () { S.whisper(0.35, true); }); });
      [3.0, 6.2].forEach(function (p, i) { once("f" + i, t > p, function () { S.noise(0.3, 900, 0.3, 0.5); }); });
    }
    if (k === "why") {
      S.hum(0.05);
      WHYD.subs.forEach(function (s, i) { once("w" + i, t > s[0], function () { S.whisper(0.55); }); });
      S.roar(t > 7.6 && t < 9.4 ? sm01(7.6, 9.1, t) * 0.5 : t < 9.4 ? 0.04 : 0.1);
      once("s", t > 9.15, S.scream);
    }
  }
  // the two letters that are part of a tape (an HTML layer over the footage, under its grain)
  var END_LETTER = "I WILL NOT COME BACK. I DREAM OF THE ABYSS EVERY NIGHT. IT KNOWS MY NAME. I WILL NOT BE WHAT I AM NOW. DO NOT LOOK FOR MY BODY. MY PLACE IS WHERE IT BELONGS. FORGET ME.";
  function ltrHtml(kind) {
    if (kind === "invite") return '<div class="e4-ltr e4-ru"><div class="e4-paper"><p>Здравствуй, <span class="e4-gn" role="img" aria-label="имя не разобрать"></span>.</p>' +
      "<p>Мы приглашаем тебя вступить в&nbsp;Штаб королевских учёных.</p><p>Ждём тебя в&nbsp;лаборатории на&nbsp;рассвете.</p>" +
      '<p class="e4-sig" role="img" aria-label="Подпись шифром Врат">' + lineSvg("V.D.G.", "e4-sg") + "</p></div></div>";
    return '<div class="e4-ltr e4-ci"><div class="e4-paper"><div class="e4-lc" role="img" aria-label="Письмо шифром Врат">' + lineSvg(END_LETTER, "e4-lg") + "</div></div></div>";
  }
  var GLITCH = "█▓▒░#%&@¤§¶ΣЖЩЯ∆¿", GMARK = ["\u0336", "\u0334", "\u0337", "\u0489", "\u0352", ""];
  function glitchName() { var n = 5 + (Math.random() * 3 | 0), r = ""; for (var i = 0; i < n; i++) r += GLITCH[Math.random() * GLITCH.length | 0] + GMARK[Math.random() * GMARK.length | 0]; return r; }
  var TP = null;
  function tapePlay(id, after, why) {
    if (TP || FT) return;
    var TD = why ? WHYD : TAPES[id - 1]; if (!TD) return;
    var kind = TD.k;
    var o = el("div", "e4 e4-tape" + (why ? " e4-why" : "")); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", why ? "Почему" : "Запись №" + tnum(id) + " — " + TD.ru);
    o.innerHTML = '<div class="e4-view"></div>' + (TD.ltr ? ltrHtml(kind) : "") + '<canvas class="e4-fx" aria-hidden="true"></canvas>' +
      '<div class="e4-osd" aria-hidden="true"><span class="e4-rec"><i></i>' + (why ? "PLAY" : "REC") + '</span><span class="e4-ts"></span><span class="e4-bat">▮▯▯</span><span class="e4-tc"></span></div>' +
      '<button class="e4-x" type="button" aria-label="Пропустить">✕</button>';
    document.body.appendChild(o); document.body.classList.add("e2-lock");
    var view = o.querySelector(".e4-view"), fxc = o.querySelector(".e4-fx"), fx = fxc.getContext("2d"), ts = o.querySelector(".e4-ts"), tc = o.querySelector(".e4-tc");
    var LEN = RM && !TD.keep ? Math.round(TD.len * 0.65 * 10) / 10 : TD.len, SC = TD.len / LEN;   // (the two letter tapes keep their length: there is text to read)
    var ltr = o.querySelector(".e4-ltr"), gname = o.querySelector(".e4-gn"), gT = -1;   // reduced motion: the same tape, shorter
    var S = tapeSound(), t0 = 0, raf = 0, done = false, impl = null, fired = {}, FREEZE = null, order = null, stImg = null;
    var once = function (key, c, fn) { if (c && !fired[key]) { fired[key] = 1; fn(); } };
    if ((qp("tape") || qp("why")) && qp("ft")) FREEZE = Math.max(0, parseFloat(qp("ft")) || 0);
    TP = { o: o };
    function osd(t) {
      if (!TD.tm) { ts.textContent = "░░:░░:░░  " + TD.d; tc.textContent = "SP  ░:░░:" + ("0" + Math.floor(t % 60)).slice(-2); return; }
      var s = TD.tm + Math.floor(t), h = Math.floor(s / 3600) % 24;
      ts.textContent = (h < 12 ? "AM " : "PM ") + ("0" + (h % 12 || 12)).slice(-2) + ":" + ("0" + Math.floor(s / 60 % 60)).slice(-2) + ":" + ("0" + s % 60).slice(-2) + "  " + TD.d;
      tc.textContent = "SP  0:" + ("0" + (id * 7 + Math.floor(t / 60))).slice(-2) + ":" + ("0" + Math.floor(t % 60)).slice(-2);
    }
    function fsize() { fxc.width = Math.ceil(innerWidth / 2); fxc.height = Math.ceil(innerHeight / 2); order = null; if (impl && impl.size) impl.size(); }
    fsize(); addEventListener("resize", fsize);
    function centred(text, cy, p, col) { var tw = text.length * (GW + 1) * p - p; glyphText(fx, text, Math.round((fxc.width - tw) / 2), Math.round(cy - GH * p / 2), p, col, RM ? 0 : p * 0.25); }
    function overlay(t) {
      var W = fxc.width, H = fxc.height; fx.clearRect(0, 0, W, H);
      var black = kind === "step" && t >= 12.3 || kind === "shadow" && t >= 8.15;
      if (black) {
        fx.fillStyle = "#000"; fx.fillRect(0, 0, W, H);
        if (!RM) { fx.fillStyle = "rgba(255,255,255,.07)"; for (var q = 0; q < 160; q++) fx.fillRect(Math.random() * W | 0, Math.random() * H | 0, 1, 1); }
      }
      if (kind === "step" && t >= 12.3 && (RM || Math.random() > 0.06)) centred("TAPE END", H / 2, Math.max(1, Math.floor(Math.min(W / 60, H / 30))), "#e8e8e8");
      if (kind === "end" && t >= 23.4) {       // the tape cuts to static
        if (!stImg || stImg.width !== W) stImg = fx.createImageData(W, H);
        var sd = stImg.data; if (!RM || !stImg.done) { for (var q2 = 0; q2 < sd.length; q2 += 4) { var v2 = Math.random() < 0.5 ? 0 : Math.random() * 190; sd[q2] = sd[q2 + 1] = sd[q2 + 2] = v2; sd[q2 + 3] = 255; } stImg.done = 1; }
        fx.putImageData(stImg, 0, 0);
      }
      (TD.subs || []).forEach(function (s) {
        if (t < s[0] || t > s[1] || !RM && Math.random() < 0.05) return;
        centred(s[2], H * 0.8, Math.max(1, Math.min(3, Math.floor(W / (s[2].length * 6 + 10)))), kind === "voices" ? "rgba(200,255,220,.85)" : kind === "end" ? "rgba(255,240,230,.95)" : "rgba(235,225,225,.9)");
      });
      if (kind === "why" && t >= 9.55) {       // the screen floods with «?»
        var p = Math.max(2, Math.round(Math.min(W, H) / 70)), cw = (GW + 1) * p, ch = (GH + 2) * p, cols = Math.ceil(W / cw), rows = Math.ceil(H / ch), N = cols * rows;
        if (!order || order.length !== N) { order = []; for (var j = 0; j < N; j++) order.push(j); for (j = N - 1; j > 0; j--) { var r = Math.random() * (j + 1) | 0, tmp = order[j]; order[j] = order[r]; order[r] = tmp; } }
        var f = RM ? 1 : sm01(9.55, 10.3, t), m = Math.floor(N * f);
        fx.fillStyle = "rgba(0,0,0," + Math.min(1, f * 1.4) + ")"; fx.fillRect(0, 0, W, H);
        for (j = 0; j < m; j++) { var c = order[j]; glyphText(fx, "?", (c % cols) * cw + (RM ? 0 : (Math.random() - 0.5) * p), Math.floor(c / cols) * ch, p, j % 3 ? "#e6e6e6" : "#ff1e3c"); }
      }
      var endK = Math.max(0, 1 - (TD.len - t) / (kind === "why" ? 0.8 : 0.45));
      if (endK > 0 && kind !== "step") { fx.fillStyle = "rgba(0,0,0," + endK + ")"; fx.fillRect(0, 0, W, H); }
    }
    function step(now) {
      if (done) return;
      if (!t0) t0 = now;
      var t = FREEZE != null ? FREEZE : (now - t0) / 1000 * SC;     // tape seconds
      if (t >= TD.len) return finish();
      if (FREEZE == null) tapeAudio(kind, t, S, once);
      if (impl) impl.frame(t);
      overlay(t); osd(t);
      if (ltr) {        // the letter in the shot: fades in and out, sways a little in the hand
        var lv = sm01(TD.ltr[0] + (TD.ltr[0] ? 0.1 : 0.3), TD.ltr[0] + 0.9, t) * (1 - sm01(TD.ltr[1] - 0.5, TD.ltr[1], t));
        ltr.style.opacity = lv.toFixed(3); ltr.style.visibility = lv > 0.001 ? "visible" : "hidden";
        if (!RM) ltr.firstChild.style.transform = "translate(" + (Math.sin(t * 1.1) * 4).toFixed(1) + "px," + (Math.sin(t * 1.7) * 3 + (1 - lv) * 14).toFixed(1) + "px) rotate(" + (-1 + Math.sin(t * 0.8) * 0.6).toFixed(2) + "deg)";
        if (gname && (gT < 0 || !RM && t - gT > 0.07)) { gT = t; gname.textContent = glitchName(); }
      }
      raf = requestAnimationFrame(step);
    }
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf); S.stop(); if (impl) impl.dispose();
      removeEventListener("resize", fsize); document.removeEventListener("keydown", onKey);
      TP = null; o.remove(); if (!E2 && !ARC) document.body.classList.remove("e2-lock");
      if (why) { if (after) after(); } else tapeCard(id, after);
    }
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); finish(); } };
    o.querySelector(".e4-x").addEventListener("click", function (e) { e.stopPropagation(); finish(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
    var go = function (m) { if (done) { if (m) m.dispose(); return; } impl = m; impl.size(); raf = requestAnimationFrame(step); };
    if (kind === "x") go(tapeX(view));
    else loadThree().then(function (T) { var m; try { m = tape3d(T, view, kind); } catch (e) { m = null; } go(m || tape2d(view, kind)); }, function () { go(tape2d(view, kind)); });
    return { finish: finish };
  }
  // after a tape: its caption in the cipher + one vague Russian line
  function tapeCard(id, after) {
    var TD = TAPES[id - 1], num = tnum(id);
    var o = el("div", "e3 e3-letter e6"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Запись №" + num);
    o.innerHTML = '<div class="e3-red" aria-hidden="true"></div><div class="e3-card e6-card"><p class="e3-head">ЗАПИСЬ №' + num + (id === TX ? "" : " · " + esc(TD.ru.toUpperCase())) + "</p>" +
      '<div class="e3-cipher e6-text" aria-label="Подпись шифром Врат">' + lineSvg(TD.cap, "e3-g") + "</div>" +
      '<p class="e3-ru">' + esc(TD.line) + "</p>" +
      '<button class="e5-x" type="button" aria-label="Закрыть">✕</button></div>';
    document.body.appendChild(o); document.body.classList.add("e2-lock");
    var openedAt = performance.now(), shut = false;
    var close = function () {
      if (shut) return; shut = true; document.removeEventListener("keydown", onKey); if (!E2 && !ARC) document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 500);
      if (after) after();
    };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    o.addEventListener("click", function (e) { if (e.target.closest(".e5-x")) return close(); if (performance.now() - openedAt < 600) return; if (!e.target.closest(".e3-card")) close(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { o.classList.add("on"); var b = o.querySelector(".e5-x"); if (b) b.focus({ preventScroll: true }); });
  }
  // ---- the tapes in 3D: the same lab, the faceless one, the ring being built
  var TAPE_FS = "varying vec2 vUv;uniform sampler2D tD;uniform float uT,uAb,uGr,uBl,uTear,uRed,uExp,uK;uniform vec2 uRes;" +
    "float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}" +
    "vec3 sp(vec2 uv){vec2 o=uBl/uRes;vec3 c=texture2D(tD,uv).rgb*0.2;c+=texture2D(tD,uv+vec2(o.x,0.0)).rgb*0.1;c+=texture2D(tD,uv-vec2(o.x,0.0)).rgb*0.1;c+=texture2D(tD,uv+vec2(0.0,o.y)).rgb*0.1;c+=texture2D(tD,uv-vec2(0.0,o.y)).rgb*0.1;" +
    "c+=texture2D(tD,uv+o*0.7).rgb*0.1;c+=texture2D(tD,uv-o*0.7).rgb*0.1;c+=texture2D(tD,uv+vec2(o.x,-o.y)*0.7).rgb*0.1;c+=texture2D(tD,uv+vec2(-o.x,o.y)*0.7).rgb*0.1;return c;}" +
    "void main(){vec2 uv=vUv;float fr=floor(uT*24.0);" +
    "float bd=step(0.982-uTear*0.4,h(vec2(floor(uv.y*48.0),fr)));uv.x+=bd*(h(vec2(fr,uv.y))-0.5)*(0.025+uTear*0.2);" +
    "uv.x+=sin(uv.y*30.0+uT*2.0)*0.0009;float hs=smoothstep(0.03,0.0,uv.y);uv.x+=hs*(h(vec2(fr,floor(uv.y*300.0)))-0.5)*0.05;" +
    "vec2 d=uv-0.5;float ab=uAb*(0.5+dot(d,d)*3.0);vec3 c=vec3(sp(uv+d*ab+vec2(0.0015,0.0)).r,sp(uv).g,sp(uv-d*ab-vec2(0.0015,0.0)).b)*uExp;" +
    "c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);c=pow(clamp(c,0.0,1.0),vec3(1.0/2.2));" +
    "c=mix(c,vec3(dot(c,vec3(0.3,0.59,0.11))),0.28)*vec3(1.0,1.03,0.94);" +
    "float ln=step(0.995,h(vec2(floor(uv.y*260.0),fr)));c+=ln*0.2;c+=step(0.9985,h(vec2(floor(uv.y*90.0),fr*1.7)))*vec3(0.5);c+=hs*0.3*h(uv*uRes+fr);" +
    "c*=0.9+0.1*sin(uv.y*uRes.y*1.6);c+=(h(uv*uRes+fract(uT*7.0)*91.0)-0.5)*uGr;" +
    "c*=smoothstep(0.95,0.28,length(d*vec2(1.0,0.9)));c=mix(c,vec3(c.r*1.5+0.05,c.g*0.25,c.b*0.3),uRed);c*=uK;gl_FragColor=vec4(c,1.0);}";
  var DISC_FS = "varying vec2 vUv;uniform float uT,uI,uA,uSil;float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}" +
    "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}" +
    "void main(){vec2 p=vUv-0.5;float r=length(p)*2.0;if(r>1.0)discard;float a=atan(p.y,p.x);float s=a*3.0/6.2832+r*2.2-uT*0.35;" +
    "float v=n(vec2(s*6.0,r*5.0-uT*0.6))*0.6+n(vec2(s*13.0,r*9.0))*0.4;" +
    "vec3 c=mix(vec3(0.16,0.0,0.03),vec3(1.0,0.2,0.1),v*v)*(0.25+0.55*v);c+=vec3(0.6,0.05,0.06)*smoothstep(0.7,1.0,r);" +
    "c+=vec3(1.0,0.8,0.7)*smoothstep(0.75,0.0,r)*max(0.0,uI-1.0)*0.9;c*=min(uI,1.6);" +
    "vec2 q=p*2.9-vec2(0.08,-0.12);float hd=length((q-vec2(0.0,0.2))/vec2(0.075,0.1));" +
    "float w=q.y>-0.5?0.12-max(0.0,q.y-0.02)*1.6:0.075;float lg=q.y<-0.5?step(0.018,abs(q.x)):1.0;" +
    "float bo=smoothstep(0.012,-0.012,abs(q.x)-w)*step(-0.98,q.y)*step(q.y,0.1)*lg;" +
    "float sil=max(smoothstep(1.08,0.9,hd),bo);c=mix(c,vec3(0.0),sil*uSil*0.94);" +
    "gl_FragColor=vec4(c,uA*smoothstep(1.0,0.96,r));}";
  function tape3d(T, host, k) {
    var R = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    var DPR = Math.min(1.5, window.devicePixelRatio || 1);
    R.setPixelRatio(DPR); R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap; R.localClippingEnabled = true;
    host.appendChild(R.domElement);
    var scene = new T.Scene(); scene.background = new T.Color(0x020203); scene.fog = new T.FogExp2(0x07080b, 0.065);
    var cam = new T.PerspectiveCamera(52, 1, 0.03, 60);
    var RT = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType });
    var dispose = [], i;
    function canvasTex(w, h, fn, rep) {
      var c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h);
      var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; dispose.push(t); return t;
    }
    var concrete = function (x, w, h) {
      x.fillStyle = "#6d6a66"; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 9000; i++) { var v = 70 + Math.random() * 60 | 0; x.fillStyle = "rgba(" + v + "," + v + "," + (v - 4) + "," + (0.1 + Math.random() * 0.25) + ")"; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
      for (i = 0; i < 40; i++) { x.fillStyle = "rgba(20,18,16," + Math.random() * 0.25 + ")"; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 8 + Math.random() * 50, 4 + Math.random() * 30, Math.random() * 3, 0, 7); x.fill(); }
      x.strokeStyle = "rgba(30,28,26,.6)"; x.lineWidth = 2; for (i = 0; i < 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4 + 1); x.lineTo(w, i * h / 4 + 1); x.stroke(); }
    };
    var M = function (o) { var m = new T.MeshStandardMaterial(o); dispose.push(m); return m; };
    var add = function (geo, mat, pos, rot, sh) { var m = new T.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.castShadow = sh !== 0; m.receiveShadow = true; dispose.push(geo); return m; };
    var wallM = M({ map: canvasTex(256, 256, concrete, [4, 2]), roughness: 0.95 });
    var floorM = M({ map: canvasTex(256, 256, concrete, [6, 6]), roughness: 0.62, metalness: 0.08, color: 0x8a8580 });
    var room = add(new T.BoxGeometry(9, 4.2, 8.5), wallM, [-0.5, 2.1, -1.4], null, 0); room.material = [wallM, wallM, wallM, floorM, wallM, wallM]; room.geometry.scale(-1, 1, 1); scene.add(room);
    var metal = M({ color: 0x1d1f21, roughness: 0.55, metalness: 0.6 }), cabM = M({ color: 0x0b0b0b, roughness: 0.6 }), pipeM = M({ color: 0x2a2724, roughness: 0.5, metalness: 0.7 });
    for (i = 0; i < 3; i++) scene.add(add(new T.CylinderGeometry(0.07 + i * 0.02, 0.07 + i * 0.02, 9, 10), pipeM, [-2 + i * 0.35, 3.9 - i * 0.1, -1], [0, 0, Math.PI / 2]));
    var cable = function (pts, r) { var c = new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], p[1], p[2]); })); scene.add(add(new T.TubeGeometry(c, 48, r, 6), cabM)); };
    // a cold night window high on the left wall, and the moonlight through it
    var winM = new T.MeshBasicMaterial({ color: 0x3a4a66 }); dispose.push(winM);
    scene.add(add(new T.PlaneGeometry(1.6, 0.5), winM, [-4.97, 3.4, -1.6], [0, Math.PI / 2, 0], 0));
    for (i = 0; i < 4; i++) scene.add(add(new T.BoxGeometry(0.04, 0.5, 0.04), metal, [-4.95, 3.4, -2.2 + i * 0.4], null, 0));
    var moon = new T.DirectionalLight(0x8094c0, 0.5); moon.position.set(-6, 5.5, -0.6); moon.target.position.set(0.5, 0, -2.6);
    moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); var sc0 = moon.shadow.camera; sc0.left = -6; sc0.right = 6; sc0.top = 6; sc0.bottom = -6; sc0.far = 20;
    scene.add(moon); scene.add(moon.target);
    var hemi = new T.HemisphereLight(0x1c2232, 0x050403, 0.32); scene.add(hemi);
    // dust
    var DN = 900, dpos = new Float32Array(DN * 3);
    for (i = 0; i < DN; i++) { dpos[i * 3] = -4 + Math.random() * 7.5; dpos[i * 3 + 1] = Math.random() * 3.6; dpos[i * 3 + 2] = -5.2 + Math.random() * 7.5; }
    var dg = new T.BufferGeometry(); dg.setAttribute("position", new T.BufferAttribute(dpos, 3)); dispose.push(dg);
    var dm = new T.PointsMaterial({ color: 0xffe9c0, size: 0.007, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending }); dispose.push(dm);
    scene.add(new T.Points(dg, dm));
    // a hanging lamp
    var bulbs = [];
    function lamp(px, py, pz, tx, ty, tz, I, shadow) {
      var g = new T.Group(); g.position.set(px, py, pz); scene.add(g);
      g.add(add(new T.CylinderGeometry(0.008, 0.008, 1.2, 4), cabM, [0, 0.62, 0]));
      g.add(add(new T.ConeGeometry(0.26, 0.24, 20, 1, true), M({ color: 0x2b2d2a, roughness: 0.6, metalness: 0.6, side: T.DoubleSide }), [0, -0.05, 0]));
      var bm = new T.MeshBasicMaterial({ color: 0xfff1c8 }); dispose.push(bm);
      g.add(add(new T.SphereGeometry(0.035, 12, 8), bm, [0, -0.1, 0], null, 0));
      var s = new T.SpotLight(0xffe2b0, I, 10, 0.72, 0.65, 1.6); s.position.set(px, py - 0.14, pz); s.target.position.set(tx, ty, tz);
      if (shadow) { s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0008; }
      scene.add(s); scene.add(s.target);
      var L = { g: g, s: s, b: bm, I: I, f: 1, dead: false }; bulbs.push(L); return L;
    }
    function flickAll(p) { bulbs.forEach(function (L) { if (L.dead) { L.s.intensity = 0; L.b.color.setScalar(0.05); return; } if (!RM && Math.random() < p) L.f = Math.random() < 0.35 ? 0.06 : 0.55 + Math.random() * 0.4; else L.f += (1 - L.f) * 0.2; L.s.intensity = L.I * L.f; L.b.color.setScalar(0.25 + 0.75 * L.f); }); }
    // the faceless one (any material set: the coat, or the shadow)
    var coatM = M({ color: 0xe4e2db, roughness: 0.9 }), skinM = M({ color: 0xd4cfc6, roughness: 0.32 }), darkM = M({ color: 0x141414, roughness: 0.8 }), shoeM = M({ color: 0x070707, roughness: 0.35, metalness: 0.2 });
    var gloveM = M({ color: 0x2a2c2f, roughness: 0.5 });
    function mkFig(cm, km, dm2, shm, o) {     // the coat (or o.dress: "sweater" / "bare" for the shadow)
      o = o || {};
      var F = buildFig(T, add, M, { cm: cm, km: km, dm: dm2, shm: shm, hm: o.dress === "bare" ? km : o.dress === "sweater" ? km : gloveM, dress: o.dress || "coat" });
      scene.add(F.g); return F;
    }
    function restless(F, t, amp, k0) {        // the hands never quite still
      F.arms.forEach(function (a, k) { a.f.forEach(function (fg, j) { fg.rotation.x = 0.4 + Math.sin(t * 9 + j * 1.3 + k + (k0 || 0)) * 0.5 * amp; }); });
    }
    function console3(px, pz, ry) {
      var g = new T.Group(); g.position.set(px, 0, pz); g.rotation.y = ry || 0; scene.add(g);
      g.add(add(new T.BoxGeometry(1.8, 0.95, 0.8), metal, [0, 0.475, 0]));
      g.add(add(new T.BoxGeometry(1.8, 0.06, 0.55), M({ color: 0x111214, roughness: 0.4, metalness: 0.5 }), [0, 0.97, 0.2], [0.25, 0, 0]));
      var c = document.createElement("canvas"); c.width = 128; c.height = 96; var sx = c.getContext("2d"), tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; dispose.push(tex);
      var sm = new T.MeshBasicMaterial({ map: tex, color: 0x9ad8c4 }); dispose.push(sm);
      [[-0.55, 0.25], [0.05, 0], [0.62, -0.25]].forEach(function (p) {
        var m = new T.Group(); m.position.set(p[0], 1.42, -0.22); m.rotation.y = p[1]; g.add(m);
        m.add(add(new T.BoxGeometry(0.56, 0.44, 0.3), metal, [0, 0, -0.16])); var s = add(new T.PlaneGeometry(0.5, 0.37), sm, [0, 0, 0.001], null, 0); s.castShadow = false; m.add(s);
      });
      var light = new T.PointLight(0x5fe0c0, 1.8, 3, 2); light.position.set(px, 1.4, pz + 0.35); scene.add(light);
      return { tex: tex, mat: sm, light: light, paint: function (t, red) {
        sx.fillStyle = "#020806"; sx.fillRect(0, 0, 128, 96);
        for (var y = 0; y < 12; y++) { sx.fillStyle = y === (t * 3 | 0) % 12 ? "#d0fff0" : red ? "#bf3f3f" : "#3fbf9a"; var len = 20 + ((Math.sin(y * 7.1 + (t * 2 | 0)) + 1) * 45 | 0); for (var x0 = 4; x0 < len; x0 += 6) if (Math.sin(x0 * 3.3 + y + (t | 0)) > -0.4) sx.fillRect(x0, 4 + y * 7, 4, 4); }
        sx.strokeStyle = "#ff3a4a"; sx.beginPath(); for (var x1 = 0; x1 < 128; x1++) { var yy = 82 - Math.abs(Math.sin(x1 * 0.2 + t * 6)) * 8 * (x1 % 30 < 6 ? 1.6 : 0.3); if (x1) sx.lineTo(x1, yy); else sx.moveTo(x1, yy); } sx.stroke();
        tex.needsUpdate = true;
      } };
    }
    // the ring (tapes 2–6): arc < 2π while it is still being built
    var PZ = -3.8, PC = new T.Vector3(-0.5, 2.0, PZ), PRAD = 1.75, portal = null;
    function ring3(arc, open) {
      var g = new T.Group(); g.position.copy(PC); scene.add(g);
      var rm = new T.MeshStandardMaterial({ color: 0x2c2a27, emissive: 0xd8200f, emissiveIntensity: 0, roughness: 0.42, metalness: 0.78 }); dispose.push(rm);
      var ring = add(new T.TorusGeometry(PRAD, 0.13, 20, 140, arc), rm); if (arc < 6.28) ring.rotation.z = -0.5; g.add(ring);
      for (var k = 0; k < 28; k++) { var a = -0.5 + k / 28 * 6.283; if (a - -0.5 > arc) continue; var b = add(new T.BoxGeometry(0.1, 0.34, 0.34), metal, [Math.cos(a) * PRAD, Math.sin(a) * PRAD, 0], [0, 0, a]); g.add(b); }
      [-1, 1].forEach(function (sd) { g.add(add(new T.BoxGeometry(0.18, 1.2, 0.5), metal, [sd * 1.0, -1.45, 0], [0, 0, sd * 0.35])); });
      cable([[PC.x + 1.3, 0.02, PZ + 0.3], [0.8, 0.02, -2.4], [1.8, 0.03, -1.6], [3.2, 0.02, -2.2]], 0.035);
      cable([[PC.x - 1.2, 0.02, PZ + 0.2], [-2.2, 0.02, -2.4], [-1.4, 0.03, -1.0], [-3.6, 0.02, -0.4]], 0.03);
      cable([[PC.x + 0.4, 0.3, PZ + 0.1], [0.4, 0.02, -2.9], [1.2, 0.02, -0.4], [2.8, 0.02, 0.6]], 0.025);
      var P = { g: g, ring: ring, m: rm, disc: null, heart: null };
      if (open) {
        var dmat = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uI: { value: 0 }, uA: { value: 0 }, uSil: { value: 0 } },
          vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}", fragmentShader: DISC_FS });
        dispose.push(dmat); P.dm = dmat;
        P.disc = add(new T.PlaneGeometry(PRAD * 2 - 0.1, PRAD * 2 - 0.1), dmat, [0, 0, 0], null, 0); P.disc.castShadow = false; P.disc.receiveShadow = false; g.add(P.disc);
        var ht = new T.TextureLoader().load("/site/img/heart.png"); ht.colorSpace = T.SRGBColorSpace; dispose.push(ht);
        var hm = new T.MeshBasicMaterial({ map: ht, transparent: true, color: 0xffd0d0, depthWrite: false, opacity: 0 }); dispose.push(hm); P.hm = hm;
        P.heart = add(new T.PlaneGeometry(0.62, 0.56), hm, [0, 0, 0.04], null, 0); P.heart.castShadow = false; g.add(P.heart);
        P.pl = new T.PointLight(0xff2a1a, 0, 12, 1.5); P.pl.position.set(PC.x, PC.y, PZ + 0.8); scene.add(P.pl);
      }
      return P;
    }
    var beat = function (t) { var p = (t % 0.86) / 0.86; return Math.exp(-Math.pow((p - 0.05) / 0.05, 2)) * 0.16 + Math.exp(-Math.pow((p - 0.24) / 0.05, 2)) * 0.09; };
    // post
    var post = new T.ShaderMaterial({ uniforms: { tD: { value: RT.texture }, uT: { value: 0 }, uAb: { value: 0.006 }, uGr: { value: 0.12 }, uBl: { value: 0 }, uTear: { value: 0 }, uRed: { value: 0 }, uExp: { value: 1.15 }, uK: { value: 1 }, uRes: { value: new T.Vector2(4, 4) } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}", fragmentShader: TAPE_FS, depthTest: false, depthWrite: false });
    dispose.push(post);
    var pScene = new T.Scene(), pCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), pq = new T.Mesh(new T.PlaneGeometry(2, 2), post); pScene.add(pq); dispose.push(pq.geometry);
    var V = new T.Vector3(), V2 = new T.Vector3(), LK = new T.Vector3();
    function shoot(pos, look, fov, roll, amt, t) {      // handheld camera: breathing, micro-jitter, a little roll
      var h = RM ? 0 : amt, sx = Math.sin(t * 0.9) * 0.02 * h + (Math.random() - 0.5) * 0.005 * h, sy = Math.sin(t * 1.3) * 0.015 * h + (Math.random() - 0.5) * 0.004 * h;
      cam.position.set(pos.x + sx, pos.y + sy, pos.z); LK.copy(look); LK.x += sx * 5; LK.y += sy * 5;
      cam.fov = fov; cam.updateProjectionMatrix(); cam.lookAt(LK); cam.rotateZ((roll || 0) + Math.sin(t * 0.7) * 0.012 * h);
    }
    var lerpV = function (a, b, k) { return new T.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k); };
    var P3 = function (a) { return new T.Vector3(a[0], a[1], a[2]); };
    var D = {}, fig = null, u = post.uniforms;

    // ======== №1 «Чертежи»: the board, the measuring, the note
    if (k === "plans") {
      scene.fog.density = 0.05;
      var boardT = canvasTex(1024, 512, function (x, w, h) {
        x.fillStyle = "#1a221e"; x.fillRect(0, 0, w, h);
        for (var k = 0; k < 60; k++) { x.fillStyle = "rgba(210,220,210," + Math.random() * 0.05 + ")"; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 120, 10 + Math.random() * 40, Math.random() * 3, 0, 7); x.fill(); }
        x.strokeStyle = "rgba(235,236,228,.85)"; x.lineCap = "round";
        var circ = function (cx, cy, r, lw) { x.lineWidth = lw; x.beginPath(); for (var a = 0; a <= 6.3; a += 0.05) { var rr = r + (Math.random() - 0.5) * 1.6; if (a) x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else x.moveTo(cx + rr, cy); } x.stroke(); };
        circ(300, 250, 175, 4); circ(300, 250, 150, 3); circ(300, 250, 38, 2);
        x.lineWidth = 2; for (k = 0; k < 24; k++) { var a = k / 24 * 6.283; x.beginPath(); x.moveTo(300 + Math.cos(a) * 150, 250 + Math.sin(a) * 150); x.lineTo(300 + Math.cos(a) * (k % 2 ? 175 : 196), 250 + Math.sin(a) * (k % 2 ? 175 : 196)); x.stroke(); }
        x.setLineDash([10, 8]); x.beginPath(); x.moveTo(90, 250); x.lineTo(510, 250); x.moveTo(300, 40); x.lineTo(300, 460); x.stroke(); x.setLineDash([]);
        x.fillStyle = "rgba(230,60,60,.8)"; x.beginPath(); x.moveTo(300, 262); x.bezierCurveTo(270, 240, 280, 222, 300, 236); x.bezierCurveTo(320, 222, 330, 240, 300, 262); x.fill();   // a small heart in the centre
        x.strokeStyle = "rgba(235,236,228,.8)"; x.beginPath(); x.ellipse(760, 170, 150, 34, 0, 0, 7); x.stroke(); x.beginPath(); x.moveTo(660, 196); x.lineTo(640, 300); x.moveTo(860, 196); x.lineTo(880, 300); x.moveTo(600, 300); x.lineTo(920, 300); x.stroke();
        x.beginPath(); x.moveTo(610, 120); x.lineTo(910, 120); x.moveTo(610, 112); x.lineTo(610, 128); x.moveTo(910, 112); x.lineTo(910, 128); x.stroke();
        glyphText(x, "R 1.75", 650, 86, 4, "rgba(235,236,228,.85)", 1.2);
        glyphText(x, "NO GAP", 330, 300, 4, "rgba(235,236,228,.8)", 1.2);
        glyphText(x, "IT BEATS", 120, 455, 4, "rgba(235,236,228,.75)", 1.2);
        glyphText(x, "28 SEGMENTS", 600, 340, 4, "rgba(235,236,228,.8)", 1.2);
        glyphText(x, "ZERO POINT ?", 600, 390, 4, "rgba(235,236,228,.7)", 1.2);
        glyphText(x, "DO NOT LOOK THROUGH", 560, 450, 4, "rgba(235,236,228,.55)", 1.6);
      });
      var board = add(new T.PlaneGeometry(4.6, 2.3), M({ map: boardT, roughness: 0.92 }), [-0.5, 2.05, -5.6], null, 0); scene.add(board);
      scene.add(add(new T.BoxGeometry(4.75, 0.08, 0.1), M({ color: 0x2a1e14, roughness: 0.8 }), [-0.5, 0.88, -5.57]));
      scene.add(add(new T.BoxGeometry(4.75, 0.06, 0.06), M({ color: 0x2a1e14, roughness: 0.8 }), [-0.5, 3.21, -5.6]));
      var bpT = canvasTex(512, 360, function (x, w, h) {
        x.fillStyle = "#1c3d70"; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 1;
        for (var k = 0; k < w; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, h); x.stroke(); } for (k = 0; k < h; k += 16) { x.beginPath(); x.moveTo(0, k); x.lineTo(w, k); x.stroke(); }
        x.strokeStyle = "rgba(240,245,255,.9)"; x.lineWidth = 2; x.beginPath(); x.arc(200, 190, 120, 0, 7); x.stroke(); x.beginPath(); x.arc(200, 190, 104, 0, 7); x.stroke();
        x.strokeRect(360, 90, 110, 200); x.beginPath(); x.moveTo(360, 190); x.lineTo(470, 190); x.stroke();
        glyphText(x, "GATE - SHEET 4", 24, 20, 3, "rgba(240,245,255,.9)");
        x.fillStyle = "rgba(120,20,20,.35)"; x.beginPath(); x.ellipse(430, 320, 50, 20, 0.3, 0, 7); x.fill();
      });
      scene.add(add(new T.PlaneGeometry(1.15, 0.8), M({ map: bpT, roughness: 0.85 }), [1.15, 2.35, -5.58], [0, 0, 0.03], 0));
      scene.add(add(new T.PlaneGeometry(0.7, 0.5), M({ map: bpT, roughness: 0.85, color: 0xb0b8c8 }), [-2.45, 2.55, -5.585], [0, 0, -0.06], 0));
      // the desk, the note, a desk lamp
      scene.add(add(new T.BoxGeometry(1.6, 0.06, 0.8), M({ color: 0x2c2118, roughness: 0.7 }), [2.2, 0.82, -3.9]));
      [[-0.72, -0.34], [0.72, -0.34], [-0.72, 0.34], [0.72, 0.34]].forEach(function (p) { scene.add(add(new T.BoxGeometry(0.05, 0.8, 0.05), metal, [2.2 + p[0], 0.4, -3.9 + p[1]])); });
      var noteT = canvasTex(512, 360, function (x, w, h) {
        x.fillStyle = "#d8cfb8"; x.fillRect(0, 0, w, h);
        for (var k = 0; k < 1500; k++) { x.fillStyle = "rgba(90,70,40," + Math.random() * 0.08 + ")"; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        x.fillStyle = "rgba(120,80,40,.18)"; x.beginPath(); x.arc(400, 290, 48, 0, 7); x.fill();
        ["IF IT OPENS,", "IT WILL KNOW", "MY NAME."].forEach(function (l, k) { glyphText(x, l, 34, 40 + k * 70, 7, "#191820", 0.8); });
        x.strokeStyle = "#191820"; x.lineWidth = 3; x.beginPath(); x.arc(420, 120, 44, 0, 7); x.stroke();
      });
      D.note = add(new T.PlaneGeometry(0.34, 0.24), M({ map: noteT, roughness: 0.9 }), [2.0, 0.853, -3.85], [-Math.PI / 2, 0, 0.18], 0); scene.add(D.note);
      for (i = 0; i < 4; i++) scene.add(add(new T.PlaneGeometry(0.3, 0.42), M({ color: 0xbdb5a2, roughness: 0.95 }), [2.45 + i * 0.07, 0.852 - i * 0.0005, -3.95 + i * 0.03], [-Math.PI / 2, 0, 0.4 + i * 0.3], 0));
      var dl = new T.PointLight(0xffc27a, 1.6, 2.4, 1.8); dl.position.set(2.65, 1.22, -4.05); scene.add(dl);
      scene.add(add(new T.ConeGeometry(0.12, 0.14, 16, 1, true), M({ color: 0x3a2e22, roughness: 0.6, side: T.DoubleSide }), [2.65, 1.3, -4.05]));
      D.lamp = lamp(-0.6, 3.55, -4.1, -0.6, 1.6, -5.6, 20, true);
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.position.set(-1.25, 0, -4.95); fig.g.rotation.y = Math.PI + 0.12;
      var ruler = add(new T.BoxGeometry(0.02, 0.7, 0.012), M({ color: 0x9a8a60, roughness: 0.6 }), [0, -0.12, 0.02], [0, 0, 1.2]); fig.arms[1].hand.add(ruler);
      cable([[-4.5, 0.02, -5.4], [-3, 0.02, -4.4], [-1.8, 0.02, -4.2], [1.5, 0.02, -4.6]], 0.02);
      D.frame = function (t) {
        flickAll(0.03 + (t > 11.2 ? 0.4 : 0));
        if (t > 11.3 && !RM) D.lamp.f = Math.min(D.lamp.f, 0.15);
        var a = fig.arms[1], b = fig.arms[0], mv = Math.sin(t * 0.8);
        a.sh.rotation.set(-2.05 + mv * 0.12 * (RM ? 0 : 1), 0, 0.25); a.el.rotation.x = -0.35; a.hand.rotation.z = 0.2;
        b.sh.rotation.set(-0.15, 0, -0.1); b.el.rotation.x = -0.25; restless(fig, t, 0.6);
        fig.torso.rotation.x = 0.05; fig.neck.rotation.x = -0.15;
        fig.neck.rotation.y = RM ? 0 : sm01(5.0, 5.8, t) * 0.75 * (1 - sm01(6.6, 7.3, t));     // he half-turns toward the camera, then back
        fig.g.position.x = -1.25 + Math.sin(t * 0.35) * 0.08;
        var pan = sm01(0.3, 4.5, t), toDesk = sm01(7.0, 8.8, t), push = sm01(9.0, 11.5, t);
        var pos = lerpV([1.3, 1.62, -1.3], [0.7, 1.62, -1.7], pan).clone().lerp(V.set(1.95, 1.48, -3.05), toDesk).lerp(V.set(2.02, 1.32, -3.3), push);
        var look = lerpV([1.0, 2.05, -5.6], [-1.3, 1.95, -5.4], pan).clone().lerp(V.set(2.0, 0.86, -3.85), toDesk);
        shoot(pos, look, 50 - sm01(4.5, 6.8, t) * 8 - toDesk * 4 - push * 6, 0, 1, t);
        u.uBl.value = RM ? 0 : 3 * (1 - sm01(0, 1.6, t)) + 1.5 * Math.sin(Math.PI * sm01(2, 3.6, t)) + 4 * Math.sin(Math.PI * toDesk) + (t > 8.8 ? 2.6 * (1 - sm01(9.4, 10.3, t)) : 0);
        u.uExp.value = 1.25;
      };
    }
    // ======== №2 «Каркас»: the frame, the sparks
    if (k === "frame") {
      scene.fog.density = 0.075;
      portal = ring3(6.283 * 0.86, false);
      var W2 = new T.Vector3(PC.x + Math.cos(-0.5) * PRAD, PC.y + Math.sin(-0.5) * PRAD, PZ + 0.12);
      [-2.9, 1.9].forEach(function (x0) { for (var k = 0; k < 2; k++) scene.add(add(new T.CylinderGeometry(0.03, 0.03, 4.1, 6), pipeM, [x0 + k * 0.7, 2.05, PZ + 0.4])); [0.9, 2.1, 3.3].forEach(function (y) { scene.add(add(new T.CylinderGeometry(0.025, 0.025, 0.7, 6), pipeM, [x0 + 0.35, y, PZ + 0.4], [0, 0, Math.PI / 2])); scene.add(add(new T.BoxGeometry(0.75, 0.03, 0.4), M({ color: 0x3a2a1a, roughness: 0.9 }), [x0 + 0.35, y, PZ + 0.4])); }); });
      [[-3.4, -1.6], [-3.15, -1.4]].forEach(function (p) { scene.add(add(new T.CylinderGeometry(0.13, 0.13, 1.25, 14), M({ color: 0x4a1210, roughness: 0.5, metalness: 0.3 }), [p[0], 0.625, p[1]])); });
      for (i = 0; i < 7; i++) cable([[-4 + Math.random() * 7, 0.02, -5 + Math.random() * 2], [-2 + Math.random() * 4, 0.02, -3 + Math.random() * 2], [-3 + Math.random() * 6, 0.02, -1 + Math.random() * 2.5], [-4 + Math.random() * 7, 0.02, 1.5]], 0.018 + Math.random() * 0.02);
      for (i = 0; i < 3; i++) scene.add(add(new T.BoxGeometry(0.5, 0.06, 0.12), metal, [-1.6 + i * 1.3, 0.03, -2.3 + i * 0.4], [0, i, 0]));
      var work = new T.SpotLight(0xffa860, 10, 10, 0.7, 0.8, 1.6); work.position.set(-2.8, 0.35, -1.4); work.target.position.set(PC.x, 1.6, PZ); work.castShadow = true; work.shadow.mapSize.set(1024, 1024); scene.add(work); scene.add(work.target);
      scene.add(add(new T.BoxGeometry(0.3, 0.22, 0.2), metal, [-2.8, 0.25, -1.45], [0, 0.6, 0]));
      var wl = new T.PointLight(0xbcd6ff, 0, 9, 1.4); wl.position.copy(W2).add(V.set(0.1, 0.05, 0.25)); wl.castShadow = true; wl.shadow.mapSize.set(512, 512); wl.shadow.bias = -0.002; scene.add(wl);
      var hotM = new T.MeshBasicMaterial({ color: 0xffffff }); dispose.push(hotM); var hot = add(new T.SphereGeometry(0.025, 10, 8), hotM, null, null, 0); hot.position.copy(W2); scene.add(hot);
      var glowM = new T.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0 }); dispose.push(glowM); var glow = add(new T.SphereGeometry(0.06, 10, 8), glowM, null, null, 0); glow.position.copy(W2); scene.add(glow);
      var SN = 240, spos = new Float32Array(SN * 6), sv = [];
      for (i = 0; i < SN; i++) { sv.push({ p: new T.Vector3(0, -9, 0), v: new T.Vector3(), l: 0 }); }
      var sg = new T.BufferGeometry(); sg.setAttribute("position", new T.BufferAttribute(spos, 3)); dispose.push(sg);
      var smat = new T.LineBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }); dispose.push(smat);
      scene.add(new T.LineSegments(sg, smat));
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.position.set(1.62, 0, -3.18); fig.g.rotation.y = Math.atan2(W2.x - 1.62, W2.z + 3.18);
      var torch = new T.Group(); torch.position.set(0, -0.08, 0.01); fig.arms[0].hand.add(torch);      // the welding torch in his glove
      torch.add(add(new T.CylinderGeometry(0.016, 0.018, 0.16, 12), M({ color: 0x3a3226, roughness: 0.6 }), [0, -0.02, 0]));
      torch.add(add(new T.CylinderGeometry(0.007, 0.012, 0.12, 10), M({ color: 0x9a8a6a, roughness: 0.3, metalness: 0.9 }), [0, -0.14, 0.03], [0.5, 0, 0]));
      var mask = add(new T.BoxGeometry(0.2, 0.22, 0.03), M({ color: 0x15171a, roughness: 0.4, metalness: 0.3 }), [0, 0.34, 0.16], [-0.1, 0, 0]); fig.neck.add(mask);   // a welding visor over the blank face
      var last = 0, heat = 0;
      D.frame = function (t) {
        var dt = Math.min(0.05, Math.max(0, t - last)); last = t;
        var on = weldOn(t), fl = on ? (RM ? 0.8 : 0.35 + Math.random() * 0.65) : 0;
        heat = on ? 1 : Math.max(0, heat - dt * 0.6);
        wl.intensity = fl * (RM ? 9 : 14); hot.visible = on; glowM.opacity = heat * 0.9; portal.m.emissiveIntensity = heat * 0.4;
        if (on && !RM) for (var k = 0; k < 9; k++) { var s = sv[(Math.random() * SN) | 0]; s.p.copy(W2); s.v.set((Math.random() - 0.3) * 2.6, Math.random() * 2.2 - 0.3, Math.random() * 2.4); s.l = 0.6 + Math.random() * 0.9; }
        for (k = 0; k < SN; k++) {
          var q = sv[k];
          if (q.l > 0) { q.l -= dt; q.v.y -= 9.8 * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.01) { q.p.y = 0.01; q.v.y *= -0.3; q.v.x *= 0.6; q.v.z *= 0.6; } }
          var vis = q.l > 0 ? 1 : 0, j = k * 6;
          spos[j] = q.p.x; spos[j + 1] = vis ? q.p.y : -9; spos[j + 2] = q.p.z;
          spos[j + 3] = q.p.x - q.v.x * 0.025; spos[j + 4] = vis ? q.p.y - q.v.y * 0.025 : -9; spos[j + 5] = q.p.z - q.v.z * 0.025;
        }
        sg.attributes.position.needsUpdate = true;
        fig.arms.forEach(function (a, k) { a.sh.rotation.set(-1.45 + k * 0.15, 0, a.sd * -0.2); a.el.rotation.x = -0.5 + (on && !RM ? (Math.random() - 0.5) * 0.04 : 0); });
        restless(fig, t, 0.2); fig.torso.rotation.x = 0.18;
        fig.neck.rotation.y = RM ? 0 : sm01(10.7, 11.7, t) * 0.9; fig.neck.rotation.x = -0.2 + sm01(10.7, 11.7, t) * 0.15;
        var walk = sm01(0, 9, t), up = sm01(3.4, 5.2, t) * (1 - sm01(6.4, 8.2, t));
        var pos = lerpV([2.6, 1.55, 2.0], [0.95, 1.56, -0.7], walk);
        pos.y += RM ? 0 : Math.abs(Math.sin(t * 3.4)) * 0.025 * (1 - walk);
        var look = V.copy(PC).lerp(W2, sm01(1, 3, t)).lerp(V2.set(PC.x - 0.3, PC.y + PRAD, PZ), up);
        look = look.clone().lerp(W2, sm01(6.4, 8.2, t)); look.y += sm01(10.4, 11.8, t) * 0.4;
        shoot(pos, look, 54 + up * 6 - sm01(8, 11, t) * 10, 0, 1, t);
        u.uBl.value = RM ? 0 : (on ? 0.4 : 0) + 3 * Math.sin(Math.PI * sm01(3.4, 5.2, t)) * 0.5 + 2.5 * Math.sin(Math.PI * sm01(6.4, 8.2, t)) * 0.6;
        u.uExp.value = 1.3; u.uAb.value = 0.007;
      };
    }
    // ======== №3 «Первый запуск»
    if (k === "start") {
      scene.fog.density = 0.06;
      portal = ring3(6.283, true);
      var cons = console3(2.0, -3.05, -0.35);
      D.L = [lamp(-2.4, 3.55, -1.8, -2.4, 0, -2.4, 9, false), lamp(0, 3.55, -2.2, 0.2, 0, -2.6, 14, true), lamp(2.3, 3.55, -1.8, 2.0, 0, -2.6, 9, false)];
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.position.set(1.75, 0, -2.25); fig.g.rotation.y = Math.PI - 0.35;
      var pose3 = function (t, lv) { fig.torso.rotation.x = 0.35; fig.arms.forEach(function (a, k) { var dip = RM || t > 7.0 ? 0 : typeDip(t, k); a.sh.rotation.set(-0.85, 0, a.sd * 0.1); a.el.rotation.x = -0.75 + dip * 0.07 + (RM ? 0 : Math.sin(t * (3 + k)) * 0.012 * lv); a.hand.rotation.x = -0.3 - dip * 0.12;
        a.f.forEach(function (fg, j) { fg.rotation.x = 0.35 + (j === typeFinger(t, k) ? dip * 0.7 : 0) + (RM ? 0 : Math.sin(t * 9 + j + k) * 0.15 * lv); }); }); };
      pose3(0, 0); addKeys(T, add, M, scene, fig.g, fig.arms);
      cable([[2.0, 0.02, -2.8], [0.8, 0.02, -2.6], [PC.x + 1.2, 0.05, PZ + 0.25]], 0.04);
      D.frame = function (t) {
        var lv = sm01(2, 7.2, t), dead = t > 7.8, fl = RM ? 1 : (Math.random() < lv * 0.5 ? 0.3 + Math.random() * 0.9 : 1);
        if ((t * 30 | 0) % 3 === 0) cons.paint(t, lv > 0.6);
        portal.m.emissiveIntensity = dead ? 0.12 + 0.05 * Math.sin(t * 2) : lv * 2.4 * fl;
        portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = dead ? 0.15 : lv * 0.9 * fl; portal.dm.uniforms.uA.value = dead ? 0.15 : lv * 0.85;
        portal.pl.intensity = dead ? 0.6 : lv * 10 * fl;
        D.L.forEach(function (L, k) { var bt = 7.2 + k * 0.25; if (t > bt && !L.dead) { L.dead = true; } if (t > bt && t < bt + 0.06) { L.s.intensity = L.I * 5; L.b.color.setScalar(2); } });
        flickAll(lv * 0.25); D.L.forEach(function (L, k) { var bt = 7.2 + k * 0.25; if (t > bt && t < bt + 0.06) { L.s.intensity = L.I * 5; L.b.color.setScalar(2); } });
        cons.light.intensity = dead ? 0 : 1.8; cons.mat.color.setScalar(dead ? 0.02 : 1); moon.intensity = 0.45;
        pose3(t, lv); fig.neck.rotation.y = -0.6 * sm01(3.5, 4.5, t);   // he looks at the ring
        var pos = V.set(0.1, 1.45, 2.7), look = V2.set(0.4, 1.45, -3.2), roll = 0;
        if (t > 8.3) {          // the camera falls
          var f = RM ? 1 : sm01(8.3, 8.9, t), hitK = t > 8.9 && !RM ? Math.max(0, 1 - (t - 8.9) * 4) : 0;
          pos = V.set(0.1 + f * 0.3, 1.45 - f * 1.33 + (hitK ? (Math.random() - 0.5) * 0.06 * hitK : 0), 2.7 - f * 0.4);
          look = V2.set(0.15 - f * 0.6, 1.55 - f * 1.25, -3.2); roll = f * 1.45;
          u.uTear.value = hitK; u.uBl.value = RM ? 1.5 : 1.5 + hitK * 4;
        } else { u.uTear.value = t > 7.15 && !RM ? 0.5 : 0; u.uBl.value = 0; }
        shoot(pos, look, 58, roll, t > 8.3 ? 0.2 : 0.35, t);
        u.uExp.value = 1.25; u.uAb.value = 0.006 + lv * 0.01; u.uK.value = t > 9.6 ? Math.max(0, 1 - (t - 9.6) / 0.8) : 1;
      };
    }
    // ======== №4 «Тень»
    if (k === "shadow") {
      scene.fog.density = 0.07;
      portal = ring3(6.283, true); console3(2.4, -3.0, -0.45);
      D.l = lamp(0.6, 3.55, 1.2, 0.0, 0, -1.2, 5, true);
      var shade = M({ color: 0x050505, roughness: 1 });
      fig = mkFig(shade, shade, shade, shade, { dress: "bare" }); fig.g.scale.set(1, 1.12, 1); fig.g.visible = false; fig.g.position.set(0.95, 0, -2.05); fig.g.rotation.y = Math.atan2(-0.3 - 0.95, -0.9 + 2.05);
      D.frame = function (t) {
        var b = beat(t * 0.7);
        portal.m.emissiveIntensity = 0.55 + b * 1.5; portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = 0.6 + b; portal.dm.uniforms.uA.value = 0.96;
        portal.dm.uniforms.uSil.value = t < 6.0 ? 1 : 0; portal.pl.intensity = 3 + b * 10; flickAll(0.02);
        var appr = sm01(0, 3.0, t), look2 = sm01(6.5, 7.4, t) * (1 - sm01(7.4, 7.6, t)), whip = RM ? (t > 7.8 ? 1 : 0) : sm01(7.6, 7.8, t);
        var pos = lerpV([0.5, 1.62, 2.3], [-0.3, 1.66, -0.9], appr); pos.y += RM ? 0 : Math.abs(Math.sin(t * 3.2)) * 0.03 * (1 - appr);
        var look = V.copy(PC).add(V2.set(-1.6 * look2, -0.1, 0)).lerp(V2.set(0.95, 1.55, -2.05), whip);
        var zoom = sm01(3.0, 5.4, t) * (1 - sm01(6.4, 7.4, t));
        shoot(pos, look, 52 - zoom * 20 + whip * 4, 0, 1, t);
        var hunt = t > 5.4 && t < 6.5 ? Math.sin(Math.PI * (t - 5.4) / 1.1) : 0;
        u.uBl.value = RM ? hunt * 2 : 0.8 * zoom + hunt * 6 + (t < 1.2 ? 2.5 * (1 - t / 1.2) : 0);
        u.uExp.value = 1.25 - hunt * 0.35; u.uAb.value = 0.007 + zoom * 0.004;
        var sting = t >= 7.8 && t < 8.15; fig.g.visible = sting;
        u.uTear.value = sting && !RM ? 1 : 0; u.uRed.value = sting ? 0.25 : 0.05; u.uGr.value = sting ? 0.25 : 0.12;
        if (sting) { D.l.s.intensity = 0; portal.pl.intensity = 16; }
      };
    }
    // ======== №5 «Приступ»
    if (k === "fall") {
      scene.fog.density = 0.06;
      portal = ring3(6.283, true);
      var c5 = console3(1.6, -2.65, 0);
      D.l = lamp(1.4, 3.55, -1.4, 1.6, 0, -2.4, 12, true);
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.position.set(1.6, 0, -1.85); fig.g.rotation.y = Math.PI;
      fig.torso.rotation.x = 0.4; fig.arms.forEach(function (a) { a.sh.rotation.set(-0.9, 0, a.sd * 0.12); a.el.rotation.x = -0.72; a.hand.rotation.x = -0.3; });
      var kb5 = addKeys(T, add, M, scene, fig.g, fig.arms);
      var tripod = new T.Group(); tripod.position.set(2.6, 0, -1.65); scene.add(tripod);
      D.frame = function (t) {
        var b = beat(t), shake = sm01(0.5, 4.0, t), fall = RM ? (t > 4.6 ? 1 : 0) : sm01(4.2, 5.0, t), floor = t > (RM ? 4.6 : 5.4);
        if ((t * 30 | 0) % 3 === 0) c5.paint(t, true);
        portal.m.emissiveIntensity = 0.9 + b * 3; portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = 0.75 + b * 1.2; portal.dm.uniforms.uA.value = 1;
        portal.hm.opacity = 0.9; portal.heart.scale.setScalar(1 + (RM ? 0 : b)); portal.pl.intensity = (4 + b * 40) * (floor ? 3 : 0.6);
        var brown = !RM && shake > 0.3 && Math.random() < 0.08 * shake;
        D.l.I = 12 * (brown ? 0.15 : 1); flickAll(0.02 + shake * 0.06);
        if (floor) { D.l.s.intensity *= 0.35; c5.light.intensity = 0.5; }
        var tr = RM ? 0 : shake * (1 - fall);
        fig.arms.forEach(function (a, k) {       // typing, then the hands start to shake on the keys
          var dip = RM || t > 4.0 ? 0 : typeDip(t, k) * (1 - shake * 0.6);
          a.sh.rotation.set(-0.9 + (Math.random() - 0.5) * 0.05 * tr, 0, a.sd * 0.12 + (Math.random() - 0.5) * 0.04 * tr);
          a.el.rotation.x = -0.72 + dip * 0.07 + (Math.random() - 0.5) * 0.08 * tr; a.hand.rotation.z = (Math.random() - 0.5) * 0.3 * tr; a.hand.rotation.x = -0.3 - dip * 0.12 + (Math.random() - 0.5) * 0.2 * tr;
          a.f.forEach(function (fg, j) { fg.rotation.x = 0.35 + (j === typeFinger(t, k) ? dip * 0.7 : 0) + (RM ? 0 : Math.sin(t * 20 + j * 1.3 + k) * 0.4 * tr); });
        }); fig.torso.rotation.x = 0.4 + fall * 0.5; fig.neck.rotation.z = (RM ? 0 : (Math.random() - 0.5) * 0.15 * tr);
        fig.g.position.y = -fall * 1.3; fig.g.position.x = 1.6 + fall * 0.35; fig.g.rotation.z = -fall * 0.9; fig.g.visible = !floor;
        var pos, look, roll, fov;
        if (!floor) {
          var tip = RM ? 0 : sm01(4.8, 5.4, t);
          pos = lerpV([2.5, 1.32, -1.62], [2.4, 0.12, -0.6], tip); look = lerpV([1.62, 1.02, -2.2], [-0.5, 0.7, -3.8], tip); roll = tip * 1.5708; fov = 40 + tip * 16;
        } else { pos = V.set(2.4, 0.12, -0.6); look = V2.set(-0.5, 0.7, -3.8); roll = 1.5708; fov = 56; }
        var hitK = !RM && t > 5.4 ? Math.max(0, 1 - (t - 5.4) * 4) : 0;
        shoot(pos, look, fov, roll, floor ? 0 : 0.5 + shake, t);
        if (hitK) cam.position.y += (Math.random() - 0.5) * 0.04 * hitK;
        u.uTear.value = hitK; u.uBl.value = RM ? 0 : (floor ? 0.9 : shake * 0.6) + hitK * 3; u.uExp.value = 1.25; u.uRed.value = floor ? 0.08 : 0;
        u.uK.value = t > 10.2 ? Math.max(0, 1 - (t - 10.2) / 0.7) : 1;
      };
    }
    // ======== №6 «Шаг»
    if (k === "step") {
      scene.fog.density = 0.085; scene.fog.color.set(0x1a0806);
      portal = ring3(6.283, true);
      var beam = new T.SpotLight(0xffd6c4, 40, 14, 0.9, 0.5, 1.2); beam.position.set(PC.x, 1.4, PZ - 0.3); beam.target.position.set(PC.x, 0, 3); beam.castShadow = true; beam.shadow.mapSize.set(1024, 1024); beam.shadow.bias = -0.0008; scene.add(beam); scene.add(beam.target);
      var clip = [new T.Plane(new T.Vector3(0, 0, 1), -PZ)];
      [coatM, skinM, darkM, shoeM].forEach(function (m) { m.clippingPlanes = clip; });
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.rotation.y = Math.PI;
      fig.g.traverse(function (m) { if (m.material) m.material.clippingPlanes = clip; });
      moon.intensity = 0.2;
      D.frame = function (t) {
        var b = beat(t), z = 1.2 - Math.min(t, 9.6) * 0.53, ph = (1.2 - z) / 0.62 * Math.PI, walking = t < 9.6;
        fig.g.position.set(PC.x + Math.sin(ph * 0.5) * 0.02, z < -3.3 ? Math.min(0.28, (-3.3 - z) * 0.9) : 0, z);
        fig.legs[0].rotation.x = walking && !RM ? Math.sin(ph) * 0.42 : 0; fig.legs[1].rotation.x = walking && !RM ? -Math.sin(ph) * 0.42 : 0;
        fig.arms.forEach(function (a, k) { a.sh.rotation.set((RM ? 0 : (k ? 1 : -1) * Math.sin(ph) * 0.18) - 0.05, 0, a.sd * -0.08); a.el.rotation.x = -0.15; });
        restless(fig, t, 0.3); fig.torso.rotation.x = 0.08; fig.neck.rotation.x = -0.12;
        var open = 1 + sm01(0, 9, t) * 0.8;
        portal.m.emissiveIntensity = 2 + b * 3; portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = t > 11 ? 1.0 + b : open + b * 0.5; portal.dm.uniforms.uA.value = 1;
        portal.hm.opacity = t > 11 ? 1 : 0.35; portal.heart.scale.setScalar(1 + (RM ? 0 : b * 1.2));
        portal.pl.intensity = 14 + b * 30 + sm01(5, 9.5, t) * 30; beam.intensity = 30 + sm01(4, 9.5, t) * 60;
        var pos, look, fov = 58, roll = 0;
        if (t < 11) {
          var cz = Math.max(z + 1.6, PZ + 1.3) + (t > 9.3 ? -sm01(9.3, 10.8, t) * 0.6 : 0);
          pos = V.set(PC.x + 0.12, 0.62 + (RM ? 0 : Math.abs(Math.sin(ph)) * 0.04), cz);
          look = V2.set(PC.x, 0.75 + sm01(7.5, 9.5, t) * 1.0, cz - 2.6);
          roll = RM ? 0 : sm01(9.3, 10.8, t) * (Math.random() - 0.5) * 0.25;
        } else { pos = V.set(PC.x, PC.y, PZ + 1.35); look = V2.copy(PC); fov = 30; }
        shoot(pos, look, fov, roll, t < 11 ? 0.8 : 0.3, t);
        u.uExp.value = t < 11 ? 1.2 + sm01(6, 9.6, t) * 1.6 : 1.15;
        u.uTear.value = RM ? 0 : (t < 11 ? sm01(9.2, 10.8, t) : 0.15); u.uAb.value = 0.007 + sm01(8, 10.8, t) * 0.04; u.uRed.value = sm01(9.4, 10.8, t) * 0.35;
        u.uK.value = t > 10.8 && t < 11 ? 0 : 1; u.uBl.value = RM ? 0 : sm01(9.6, 10.8, t) * 3 + (t > 11 && t < 11.6 ? 3 * (1 - (t - 11) / 0.6) : 0);
      };
    }
    // ======== №5 «Голоса»: the empty lab, their chairs, the radio
    if (k === "voices") {
      scene.fog.density = 0.07;
      var fab = M({ color: 0x1c1d22, roughness: 0.9 }), wood = M({ color: 0x2c2118, roughness: 0.7 });
      var chairs = [];
      var chair = function (cx, cz, ry, coat) {
        var g = new T.Group(); g.position.set(cx, 0, cz); g.rotation.y = ry; scene.add(g);
        g.add(add(new T.BoxGeometry(0.48, 0.08, 0.46), fab, [0, 0.48, 0])); g.add(add(new T.BoxGeometry(0.44, 0.5, 0.06), fab, [0, 0.8, -0.22], [-0.08, 0, 0]));
        g.add(add(new T.CylinderGeometry(0.03, 0.03, 0.42, 8), metal, [0, 0.24, 0]));
        for (var s = 0; s < 5; s++) { var a = s / 5 * 6.283; g.add(add(new T.BoxGeometry(0.04, 0.03, 0.3), metal, [Math.sin(a) * 0.15, 0.04, Math.cos(a) * 0.15], [0, a, 0])); }
        if (coat) { g.add(add(new T.BoxGeometry(0.5, 0.62, 0.07), coatM, [0, 0.74, -0.27], [-0.1, 0, 0])); g.add(add(new T.BoxGeometry(0.09, 0.5, 0.06), coatM, [-0.27, 0.62, -0.25], [0, 0, 0.12])); }
        chairs.push(g); return g;
      };
      var desk = function (cx) {
        scene.add(add(new T.BoxGeometry(1.4, 0.05, 0.7), wood, [cx, 0.76, -2.45]));
        [[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]].forEach(function (p) { scene.add(add(new T.BoxGeometry(0.05, 0.75, 0.05), metal, [cx + p[0], 0.375, -2.45 + p[1]])); });
        scene.add(add(new T.BoxGeometry(0.46, 0.38, 0.36), metal, [cx - 0.25, 0.98, -2.6]));
        for (var p2 = 0; p2 < 3; p2++) scene.add(add(new T.PlaneGeometry(0.21, 0.3), M({ color: 0xbdb5a2, roughness: 0.95 }), [cx + 0.2 + p2 * 0.05, 0.786, -2.35], [-Math.PI / 2, 0, p2 * 0.4], 0));
      };
      [-2.7, -0.9, 0.9].forEach(function (cx, i) { desk(cx); chair(cx, -1.7, Math.PI + (i - 1) * 0.3, true); });
      var scr5 = document.createElement("canvas"); scr5.width = 64; scr5.height = 48; var s5 = scr5.getContext("2d"), st5 = new T.CanvasTexture(scr5); dispose.push(st5);
      var sm5 = new T.MeshBasicMaterial({ map: st5, color: 0x8899aa }); dispose.push(sm5);
      scene.add(add(new T.PlaneGeometry(0.38, 0.3), sm5, [-1.15, 0.98, -2.419], null, 0));
      var crt = new T.PointLight(0x8fa8c8, 0.8, 2.2, 2); crt.position.set(-1.15, 1.0, -2.1); scene.add(crt);
      // the radio
      var radio = new T.Group(); radio.position.set(1.2, 0.79, -2.5); radio.rotation.y = -0.25; scene.add(radio);
      radio.add(add(new T.BoxGeometry(0.46, 0.24, 0.17), M({ color: 0x3a2516, roughness: 0.55 }), [0, 0.12, 0]));
      var dialM = new T.MeshBasicMaterial({ color: 0xffa548 }); dispose.push(dialM);
      radio.add(add(new T.PlaneGeometry(0.16, 0.07), dialM, [0.1, 0.15, 0.086], null, 0));
      radio.add(add(new T.PlaneGeometry(0.16, 0.14), M({ color: 0x0c0c0c, roughness: 1 }), [-0.11, 0.12, 0.086], null, 0));
      radio.add(add(new T.CylinderGeometry(0.004, 0.004, 0.6, 4), metal, [0.18, 0.5, -0.05], [0, 0, -0.35]));
      var rl = new T.PointLight(0xff9a40, 1.2, 1.8, 2); rl.position.set(1.25, 1.0, -2.25); scene.add(rl);
      D.l = lamp(-0.9, 3.55, -1.3, -0.9, 0, -2.0, 13, true);
      D.frame = function (t) {
        flickAll(0.05);
        if ((t * 20 | 0) % 2 === 0) { for (var y = 0; y < 48; y += 2) { var v = Math.random() * 120 | 0; s5.fillStyle = "rgb(" + v + "," + v + "," + (v + 10) + ")"; s5.fillRect(0, y, 64, 2); } st5.needsUpdate = true; }
        crt.intensity = RM ? 0.7 : 0.5 + Math.random() * 0.4;
        var talk = TAPES[4].subs.some(function (s) { return t > s[0] && t < s[1]; });
        dialM.color.setRGB(1, 0.65, 0.28).multiplyScalar(talk && !RM ? 0.7 + Math.random() * 0.6 : 0.8); rl.intensity = talk ? 1.6 : 0.9;
        chairs[1].rotation.y = Math.PI + (RM ? 0.25 : sm01(6.2, 8.2, t) * 0.45);       // the middle chair turns, slowly, by itself
        var pan = sm01(0, 8, t), push = sm01(8.2, 10.8, t);
        var pos = lerpV([-2.9, 1.5, 0.7], [0.6, 1.42, -0.5], pan).clone().lerp(V.set(1.05, 1.08, -1.78), push);
        var look = lerpV([-2.7, 0.9, -2.2], [0.3, 0.85, -2.1], pan).clone().lerp(V2.set(1.2, 0.92, -2.5), push);
        if (t > 6.0 && t < 7.8) look.lerp(V2.set(-0.9, 0.7, -1.7), Math.sin(Math.PI * (t - 6) / 1.8) * 0.8);   // the camera catches the chair moving
        shoot(pos, look, 50 - push * 12, 0, 1, t);
        u.uBl.value = RM ? 0 : 2 * (1 - sm01(0, 1.4, t)) + 2.5 * Math.sin(Math.PI * push) * 0.6; u.uExp.value = 1.3;
      };
    }
    // ======== №7 «Семья»: the photograph with the faces burnt out, the child's drawing
    if (k === "family") {
      scene.fog.density = 0.05;
      var desk7 = add(new T.BoxGeometry(1.8, 0.05, 0.9), M({ color: 0x2f2318, roughness: 0.6 }), [0, 0.76, -2.2]); scene.add(desk7);
      var photoT = canvasTex(256, 320, function (x, w, h) {
        var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#8a7458"); g.addColorStop(1, "#4e3e2c"); x.fillStyle = g; x.fillRect(0, 0, w, h);
        for (var i = 0; i < 3000; i++) { x.fillStyle = "rgba(30,20,10," + Math.random() * 0.12 + ")"; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        [[70, 120, 1], [170, 135, 0.92], [122, 210, 0.55]].forEach(function (p) {      // three people: two grown, one small
          x.fillStyle = "#2e2318"; x.beginPath(); x.ellipse(p[0], p[1] + 105 * p[2], 34 * p[2], 80 * p[2], 0, 0, 7); x.fill();
          x.fillStyle = "#c9b28c"; x.beginPath(); x.ellipse(p[0], p[1], 20 * p[2], 25 * p[2], 0, 0, 7); x.fill();
          var b = x.createRadialGradient(p[0], p[1], 2, p[0], p[1], 32 * p[2]); b.addColorStop(0, "#000"); b.addColorStop(0.5, "#0a0503"); b.addColorStop(0.75, "#5a2a10"); b.addColorStop(1, "rgba(90,50,20,0)");
          x.fillStyle = b; x.beginPath(); x.arc(p[0], p[1], 32 * p[2], 0, 7); x.fill();              // the faces: burnt through
        });
        x.strokeStyle = "#e8dcc4"; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10);
      });
      var pf = new T.Group(); pf.position.set(-0.38, 0.785, -2.42); pf.rotation.set(-0.18, 0.35, 0); scene.add(pf);
      pf.add(add(new T.BoxGeometry(0.24, 0.3, 0.02), M({ color: 0x1a120c, roughness: 0.5 }), [0, 0.15, 0]));
      pf.add(add(new T.PlaneGeometry(0.2, 0.25), M({ map: photoT, roughness: 0.4 }), [0, 0.15, 0.011], null, 0));
      var drawT = canvasTex(512, 360, function (x, w, h) {
        x.fillStyle = "#e9e4d8"; x.fillRect(0, 0, w, h);
        var crayon = function (col, lw, pts) { x.strokeStyle = col; x.lineWidth = lw; x.lineCap = "round"; for (var r = 0; r < 3; r++) { x.beginPath(); pts.forEach(function (p, i) { var px = p[0] + (Math.random() - 0.5) * 4, py = p[1] + (Math.random() - 0.5) * 4; if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke(); } };
        var ring = []; for (var a = 0; a <= 6.4; a += 0.2) ring.push([300 + Math.cos(a) * 110, 160 + Math.sin(a) * 120]); crayon("#55575f", 9, ring);
        var heart = []; for (a = 0; a <= 6.3; a += 0.15) heart.push([300 + 16 * Math.pow(Math.sin(a), 3) * 2.6, 150 - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * 2.6]); crayon("#c8102e", 12, heart);
        x.fillStyle = "rgba(200,16,46,.55)"; x.beginPath(); heart.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.fill();
        [[70, 1], [120, 0.85], [165, 0.6]].forEach(function (f) { var fx0 = f[0], s = f[1]; crayon("#2a4aa8", 5, [[fx0, 230 - 70 * s], [fx0, 320 - 30 * s]]); crayon("#2a4aa8", 5, [[fx0 - 18 * s, 330], [fx0, 320 - 30 * s], [fx0 + 18 * s, 330]]); crayon("#2a4aa8", 5, [[fx0 - 22 * s, 270 - 40 * s], [fx0 + 22 * s, 270 - 40 * s]]); x.strokeStyle = "#2a4aa8"; x.lineWidth = 4; x.beginPath(); x.arc(fx0, 215 - 70 * s, 14 * s, 0, 7); x.stroke(); });
        crayon("#e0a020", 6, [[460, 40], [500, 40]]); x.fillStyle = "#e8b020"; x.beginPath(); x.arc(470, 60, 26, 0, 7); x.fill();
      });
      scene.add(add(new T.PlaneGeometry(0.34, 0.24), M({ map: drawT, roughness: 0.95 }), [0.28, 0.786, -2.1], [-Math.PI / 2, 0, -0.14], 0));
      scene.add(add(new T.CylinderGeometry(0.045, 0.04, 0.1, 16), M({ color: 0x6a1a14, roughness: 0.4 }), [0.62, 0.835, -2.45]));
      for (i = 0; i < 4; i++) scene.add(add(new T.PlaneGeometry(0.22, 0.12), M({ color: 0xd5ccb6, roughness: 0.9 }), [-0.1 + i * 0.05, 0.7865 + i * 0.0004, -1.98 - i * 0.02], [-Math.PI / 2, 0, 0.5 + i * 0.2], 0));
      scene.add(add(new T.CylinderGeometry(0.006, 0.006, 0.15, 6), M({ color: 0x111111 }), [0.05, 0.792, -2.3], [Math.PI / 2, 0, 0.9]));
      var dl7 = new T.PointLight(0xffc27a, 2.4, 2.8, 1.8); dl7.position.set(0.55, 1.25, -2.55); dl7.castShadow = true; dl7.shadow.mapSize.set(512, 512); scene.add(dl7);
      scene.add(add(new T.ConeGeometry(0.13, 0.15, 16, 1, true), M({ color: 0x3a2e22, roughness: 0.6, side: T.DoubleSide }), [0.55, 1.33, -2.55]));
      D.frame = function (t) {
        dl7.intensity = 2.4 * (t > 9.8 && !RM ? (Math.random() < 0.3 ? 0.2 : 0.7) : 1) * (1 - sm01(10.2, 10.9, t) * 0.8);
        var a = sm01(4.8, 7.0, t);
        var pos = lerpV([-0.15, 1.18, -1.75], [0.32, 1.12, -1.68], a); var look = lerpV([-0.38, 0.93, -2.42], [0.28, 0.79, -2.1], a);
        pos.x += Math.sin(t * 0.4) * 0.03;
        shoot(pos, look, 42 - sm01(0.5, 4.5, t) * 8 - sm01(7, 10, t) * 6, 0, 0.9, t);
        u.uBl.value = RM ? 0 : 3.5 * (1 - sm01(0.4, 1.8, t)) + 4 * Math.sin(Math.PI * a) + (t > 7 ? 1.5 * (1 - sm01(7.2, 8.2, t)) : 0); u.uExp.value = 1.3;
      };
    }
    // ======== №8 «Сердце»: a red heart of light forming in a glass capsule; he stares at it
    if (k === "heart") {
      scene.fog.density = 0.07;
      portal = ring3(6.283, true);
      var CP = new T.Vector3(0.7, 0, -2.0);
      scene.add(add(new T.CylinderGeometry(0.38, 0.42, 0.22, 28), metal, [CP.x, 0.11, CP.z]));
      scene.add(add(new T.CylinderGeometry(0.34, 0.34, 0.06, 28), metal, [CP.x, 1.27, CP.z]));
      var glass = new T.MeshStandardMaterial({ color: 0xa8c0d0, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false, side: T.DoubleSide }); dispose.push(glass);
      var gl8 = add(new T.CylinderGeometry(0.3, 0.3, 1.02, 32, 1, true), glass, [CP.x, 0.73, CP.z], null, 0); gl8.castShadow = false; scene.add(gl8);
      cable([[CP.x + 0.3, 0.05, CP.z], [1.5, 0.02, -2.6], [PC.x + 1.2, 0.04, PZ + 0.3]], 0.035);
      var ht8 = new T.TextureLoader().load("/site/img/heart.png"); ht8.colorSpace = T.SRGBColorSpace; dispose.push(ht8);
      var hm8 = new T.MeshBasicMaterial({ map: ht8, transparent: true, depthWrite: false, opacity: 0, color: 0xffb0b0 }); dispose.push(hm8);
      var hp8 = add(new T.PlaneGeometry(0.3, 0.27), hm8, [CP.x, 0.74, CP.z], null, 0); hp8.castShadow = false; scene.add(hp8);
      var PN = 260, ppos = new Float32Array(PN * 3), pseed = [];
      for (i = 0; i < PN; i++) pseed.push([Math.random() * 6.283, 0.05 + Math.random() * 0.22, Math.random() * 0.9 - 0.45, 0.5 + Math.random()]);
      var pg8 = new T.BufferGeometry(); pg8.setAttribute("position", new T.BufferAttribute(ppos, 3)); dispose.push(pg8);
      var pm8 = new T.PointsMaterial({ color: 0xff3a30, size: 0.012, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }); dispose.push(pm8);
      scene.add(new T.Points(pg8, pm8));
      var hl8 = new T.PointLight(0xff2a1a, 0, 5, 1.6); hl8.position.set(CP.x, 0.74, CP.z); scene.add(hl8);
      D.l = lamp(-0.6, 3.55, -0.8, 0.2, 0, -1.8, 6, true);
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.position.set(0.3, 0, -2.75); fig.g.rotation.y = Math.atan2(CP.x - 0.3, CP.z + 2.75);
      D.frame = function (t) {
        var form = sm01(1, 7, t), bt = 0.86 - sm01(6, 11, t) * 0.3, p = (t % bt) / bt, b = Math.exp(-Math.pow((p - 0.05) / 0.05, 2)) * 0.16 + Math.exp(-Math.pow((p - 0.24) / 0.05, 2)) * 0.09;
        portal.m.emissiveIntensity = 0.35 + b; portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = 0.35; portal.dm.uniforms.uA.value = 0.9; portal.pl.intensity = 1.5;
        flickAll(0.02); D.l.I = 6 * (1 - form * 0.5);
        for (var q = 0; q < PN; q++) {
          var s = pseed[q], a = s[0] + t * s[3] * 1.4, r = s[1] * (1 - form * 0.9), j = q * 3;
          ppos[j] = CP.x + Math.cos(a) * r; ppos[j + 1] = 0.74 + s[2] * (1 - form * 0.9) + Math.sin(t * 2 + q) * 0.01; ppos[j + 2] = CP.z + Math.sin(a) * r;
        }
        pg8.attributes.position.needsUpdate = true; pm8.opacity = 0.9 * (1 - sm01(6.5, 8.5, t) * 0.7);
        hm8.opacity = sm01(3, 7.5, t); hp8.scale.setScalar((0.6 + form * 0.4) * (1 + (RM ? 0 : b * 1.3))); hp8.lookAt(cam.position);
        hl8.intensity = form * (2 + b * 25);
        var reach = sm01(8.4, 10.2, t), arm = fig.arms[1];
        arm.sh.rotation.set(-0.15 - reach * 1.25, 0, 0.05 - reach * 0.25); arm.el.rotation.x = -0.2 - reach * 0.2; fig.arms[0].sh.rotation.set(-0.1, 0, -0.05); fig.arms[0].el.rotation.x = -0.15;
        restless(fig, t, 0.25 + reach * 0.6); fig.torso.rotation.x = 0.1; fig.neck.rotation.x = 0.15; fig.neck.rotation.z = RM ? 0 : Math.sin(t * 0.5) * 0.03;
        var push = sm01(0, 11, t);
        var pos = lerpV([2.0, 1.45, 0.6], [1.65, 1.32, -0.05], push);
        shoot(pos, V2.set(0.55, 1.05, -2.3), 62 - push * 8, 0, 1, t);
        u.uBl.value = RM ? 0 : 2.5 * (1 - sm01(0, 1.5, t)) + (t > 4.5 && t < 5.5 ? 2 * Math.sin(Math.PI * (t - 4.5)) : 0); u.uExp.value = 1.3; u.uRed.value = form * 0.06;
        u.uK.value = t > 11.3 ? Math.max(0, 1 - (t - 11.3) / 0.6) : 1;
      };
    }
    // ======== №10 «По ту сторону»: the camera lies in a crystal valley in the dark; a small light rolls away
    if (k === "beyond") {
      room.visible = false; moon.intensity = 0.06; hemi.intensity = 0.12; scene.background.set(0x010104); scene.fog.color.set(0x04040b); scene.fog.density = 0.075;
      var rockT = canvasTex(256, 256, function (x, w, h) { x.fillStyle = "#17161c"; x.fillRect(0, 0, w, h); for (var i = 0; i < 6000; i++) { var v = 10 + Math.random() * 40 | 0; x.fillStyle = "rgba(" + v + "," + v + "," + (v + 8) + ",.5)"; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [20, 20]);
      var gnd = add(new T.PlaneGeometry(60, 60, 60, 60), M({ map: rockT, roughness: 0.85, metalness: 0.1 }), [0, 0, -20], [-Math.PI / 2, 0, 0], 0);
      var gp = gnd.geometry.attributes.position; for (i = 0; i < gp.count; i++) { var gx = gp.getX(i), gy = gp.getY(i); gp.setZ(i, Math.max(0, Math.abs(gx) - 1.6) * 0.35 + Math.sin(gx * 1.3 + gy * 0.7) * 0.05); } gnd.geometry.computeVertexNormals(); scene.add(gnd);
      var cryM = [M({ color: 0x2c2350, emissive: 0x5b3cff, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0.3, flatShading: true }), M({ color: 0x1d3a4a, emissive: 0x2ad0ff, emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.3, flatShading: true })];
      var seedR = 7; var rr = function () { seedR = (seedR * 16807) % 2147483647; return (seedR - 1) / 2147483646; };
      for (i = 0; i < 70; i++) {
        var side = rr() < 0.5 ? -1 : 1, cz = 0.5 - rr() * 30, cx = side * (1.4 + rr() * 5 + Math.max(0, -cz) * 0.05), hgt = 0.4 + rr() * (1.6 + Math.abs(cx) * 0.4);
        var cr = add(new T.OctahedronGeometry(1, 0), cryM[rr() < 0.65 ? 0 : 1], [cx, hgt * 0.45 + Math.max(0, Math.abs(cx) - 1.6) * 0.35, cz], [rr() * 0.5 - 0.25, rr() * 3, side * (0.15 + rr() * 0.35)]);
        cr.scale.set(0.12 + rr() * 0.25, hgt, 0.12 + rr() * 0.25); scene.add(cr);
      }
      [[-2.5, 1.2, -4, 0x6a4cff], [2.8, 1.0, -9, 0x2ad0ff], [-3, 1.4, -15, 0x6a4cff]].forEach(function (p) { var l = new T.PointLight(p[3], 2.2, 7, 1.6); l.position.set(p[0], p[1], p[2]); scene.add(l); });
      var orbM = new T.MeshBasicMaterial({ color: 0xffe6dc }); dispose.push(orbM);
      var orb = add(new T.SphereGeometry(0.07, 16, 12), orbM, null, null, 0); scene.add(orb);
      var halo = new T.Mesh(new T.SphereGeometry(0.16, 16, 12), new T.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false })); dispose.push(halo.geometry, halo.material); scene.add(halo);
      var ol = new T.PointLight(0xffc8b8, 3, 5, 1.5); scene.add(ol);
      D.frame = function (t) {
        var roll = sm01(2, 11.5, t), oz = 0.2 - roll * 22, ox = Math.sin(roll * 9) * 0.35, oy = 0.07 + Math.abs(Math.sin(t * 5.5)) * 0.03 * (1 - roll);
        orb.position.set(ox, oy, oz); halo.position.copy(orb.position); ol.position.set(ox, oy + 0.15, oz);
        halo.scale.setScalar(1 + (RM ? 0 : Math.sin(t * 6) * 0.12)); ol.intensity = 3 + Math.sin(t * 6) * 0.6;
        var hunt = t > 5 && t < 6.2 ? Math.sin(Math.PI * (t - 5) / 1.2) : 0;
        shoot(V.set(0.15, 0.13, 1.6), V2.set(ox * 0.4, 0.35, -6), 50 - sm01(6, 10, t) * 10, 0.22, 0.15, t);
        u.uTear.value = RM ? 0 : (t < 0.6 ? 1 - t / 0.6 : 0) + (t > 10.6 ? sm01(10.6, 11.6, t) : 0); u.uBl.value = RM ? 0 : 2.5 * (1 - sm01(0.3, 1.6, t)) + hunt * 3;
        u.uExp.value = 1.45; u.uAb.value = 0.008; u.uK.value = t > 11.2 ? Math.max(0, 1 - (t - 11.2) / 0.7) : 1;
      };
    }
    // ======== №0 «Приглашение»: a warm little house at night, someone at the piano (seen only from behind); three knocks; the letter
    if (k === "invite") {
      room.visible = false; moon.intensity = 0.05; hemi.color.set(0x3a2a1c); hemi.groundColor.set(0x140a05); hemi.intensity = 1.1;
      scene.background.set(0x0b0705); scene.fog.color.set(0x120b07); scene.fog.density = 0.035; dm.color.set(0xffd9a0);
      var paper0 = function (x, w, h) {      // warm wallpaper: stripes and small flowers
        x.fillStyle = "#7a5634"; x.fillRect(0, 0, w, h);
        for (var i = 0; i < w; i += 32) { x.fillStyle = "rgba(255,220,160,.07)"; x.fillRect(i, 0, 14, h); x.fillStyle = "rgba(60,30,10,.12)"; x.fillRect(i + 14, 0, 2, h); }
        for (i = 0; i < 70; i++) { var fx0 = (i % 8) * 32 + 23, fy = ((i / 8) | 0) * 30 + (i % 2) * 15; x.fillStyle = "rgba(150,50,40,.45)"; x.beginPath(); x.arc(fx0, fy, 3, 0, 7); x.fill(); x.fillStyle = "rgba(90,110,60,.4)"; x.fillRect(fx0 - 1, fy + 3, 2, 6); }
        for (i = 0; i < 3000; i++) { x.fillStyle = "rgba(30,15,5," + Math.random() * 0.08 + ")"; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      };
      var planks = function (x, w, h) {
        for (var i = 0; i < 8; i++) { var v = 60 + Math.random() * 25 | 0; x.fillStyle = "rgb(" + (v + 40) + "," + (v + 10) + "," + (v - 20) + ")"; x.fillRect(0, i * h / 8, w, h / 8); x.fillStyle = "rgba(20,10,4,.6)"; x.fillRect(0, i * h / 8, w, 2); x.fillRect((i * 97) % w, i * h / 8, 2, h / 8); }
        for (i = 0; i < 400; i++) { x.strokeStyle = "rgba(40,20,8," + Math.random() * 0.2 + ")"; x.beginPath(); var yy = Math.random() * h; x.moveTo(Math.random() * w, yy); x.lineTo(Math.random() * w, yy + (Math.random() - 0.5) * 3); x.stroke(); }
      };
      var wpM = M({ map: canvasTex(256, 256, paper0, [5, 1.6]), roughness: 0.9 }), flM = M({ map: canvasTex(256, 256, planks, [3, 3]), roughness: 0.55 }), ceilM = M({ color: 0x5a4636, roughness: 1 });
      var house = add(new T.BoxGeometry(5.4, 2.6, 5.2), wpM, [0, 1.3, -0.4], null, 0); house.material = [wpM, wpM, ceilM, flM, wpM, wpM]; house.geometry.scale(-1, 1, 1); scene.add(house);
      var woodM = M({ color: 0x3b2114, roughness: 0.4, metalness: 0.05 }), wood2 = M({ color: 0x5a3520, roughness: 0.6 }), ivory = M({ color: 0xeee6d4, roughness: 0.35 }), ebony = M({ color: 0x0c0a09, roughness: 0.3 }), brass = M({ color: 0xb08a3a, roughness: 0.3, metalness: 0.9 });
      // wainscot
      [[0, 0.45, -2.98, 5.4, 0], [-2.68, 0.45, -0.4, 5.2, Math.PI / 2], [2.68, 0.45, -0.4, 5.2, Math.PI / 2]].forEach(function (w) { scene.add(add(new T.BoxGeometry(w[3], 0.9, 0.04), wood2, [w[0], w[1], w[2]], [0, w[4], 0], 0)); scene.add(add(new T.BoxGeometry(w[3], 0.05, 0.07), woodM, [w[0], 0.92, w[2]], [0, w[4], 0], 0)); });
      // the upright piano
      var pg = new T.Group(); pg.position.set(-0.5, 0, -2.66); scene.add(pg);
      pg.add(add(new T.BoxGeometry(1.5, 1.28, 0.55), woodM, [0, 0.64, 0]));
      pg.add(add(new T.BoxGeometry(1.56, 0.05, 0.6), woodM, [0, 1.3, 0]));
      pg.add(add(new T.BoxGeometry(1.46, 0.07, 0.3), woodM, [0, 0.735, 0.41]));
      pg.add(add(new T.BoxGeometry(1.38, 0.03, 0.17), ivory, [0, 0.785, 0.44]));
      for (var bk = 0; bk < 36; bk++) { var oc = bk % 5; pg.add(add(new T.BoxGeometry(0.014, 0.022, 0.1), ebony, [-0.67 + bk * 0.038 + (oc > 1 ? 0.012 : 0), 0.81, 0.405], null, 0)); }
      pg.add(add(new T.BoxGeometry(1.46, 0.2, 0.04), woodM, [0, 0.93, 0.29], [-0.12, 0, 0]));
      var sheet = add(new T.PlaneGeometry(0.52, 0.32), M({ color: 0xe9e0c8, roughness: 0.9 }), [0, 1.08, 0.3], [-0.22, 0, 0], 0); pg.add(sheet);
      [-0.7, 0.7].forEach(function (x0) { pg.add(add(new T.BoxGeometry(0.06, 0.7, 0.06), woodM, [x0, 0.35, 0.47])); });
      pg.add(add(new T.BoxGeometry(0.26, 0.2, 0.03), M({ color: 0x2a1a10, roughness: 0.6 }), [-0.45, 1.43, 0.05], [0, 0.2, 0]));   // a photo frame
      pg.add(add(new T.CylinderGeometry(0.05, 0.07, 0.22, 14), M({ color: 0x6a2a24, roughness: 0.4 }), [-0.15, 1.43, 0.08]));     // a vase
      // the lamp on the piano: the only warm light
      var shadeM = M({ color: 0xf2c287, emissive: 0xffa24a, emissiveIntensity: 0.9, roughness: 0.9, side: T.DoubleSide });
      pg.add(add(new T.CylinderGeometry(0.02, 0.06, 0.26, 10), brass, [0.48, 1.45, 0.05]));
      pg.add(add(new T.CylinderGeometry(0.11, 0.17, 0.2, 18, 1, true), shadeM, [0.48, 1.66, 0.05], null, 0));
      var warm = new T.PointLight(0xffa456, 13, 8, 1.4); warm.position.set(-0.02, 1.64, -2.55); warm.castShadow = true; warm.shadow.mapSize.set(1024, 1024); warm.shadow.bias = -0.002; scene.add(warm);
      var warm2 = new T.PointLight(0xff9a4a, 5, 7, 1.5); warm2.position.set(-2.1, 1.5, 0.9); scene.add(warm2);
      // a floor lamp, a shelf of books, a rug, a clock, a window with curtains
      scene.add(add(new T.CylinderGeometry(0.015, 0.015, 1.5, 8), brass, [-2.2, 0.75, 1.0])); scene.add(add(new T.CylinderGeometry(0.14, 0.22, 0.26, 18, 1, true), shadeM, [-2.2, 1.6, 1.0], null, 0));
      var shelf = new T.Group(); shelf.position.set(-2.5, 0, -1.1); shelf.rotation.y = Math.PI / 2; scene.add(shelf);
      shelf.add(add(new T.BoxGeometry(1.2, 1.9, 0.32), wood2, [0, 0.95, 0]));
      var bookC = [0x6a1f1a, 0x24364a, 0x3a4a2a, 0x7a5a2a, 0x4a2a3a, 0x202020];
      for (var r0 = 0; r0 < 4; r0++) for (var b0 = 0; b0 < 11; b0++) { var bh = 0.22 + tHash(r0 * 11 + b0) * 0.12; shelf.add(add(new T.BoxGeometry(0.075, bh, 0.22), M({ color: bookC[(r0 * 3 + b0) % 6], roughness: 0.8 }), [-0.5 + b0 * 0.095, 0.2 + r0 * 0.44 + bh / 2, 0.06], null, 0)); }
      var rugT = canvasTex(128, 128, function (x, w, h) { x.fillStyle = "#5a1a14"; x.fillRect(0, 0, w, h); x.strokeStyle = "#c08a4a"; x.lineWidth = 4; x.strokeRect(8, 8, w - 16, h - 16); x.strokeStyle = "#2a3a5a"; x.lineWidth = 3; x.strokeRect(20, 20, w - 40, h - 40); x.fillStyle = "#c08a4a"; x.beginPath(); x.moveTo(w / 2, 30); x.lineTo(w - 30, h / 2); x.lineTo(w / 2, h - 30); x.lineTo(30, h / 2); x.fill(); });
      scene.add(add(new T.PlaneGeometry(2.4, 1.6), M({ map: rugT, roughness: 1 }), [0.2, 0.004, -0.6], [-Math.PI / 2, 0, 0], 0));
      var clock = add(new T.CylinderGeometry(0.16, 0.16, 0.04, 24), ivory, [1.4, 1.95, -2.95], [Math.PI / 2, 0, 0], 0); scene.add(clock);
      var hand1 = add(new T.BoxGeometry(0.012, 0.11, 0.01), ebony, [1.4, 1.98, -2.92], null, 0); scene.add(hand1); var hand2 = add(new T.BoxGeometry(0.01, 0.08, 0.01), ebony, [1.4, 1.97, -2.92], [0, 0, 2], 0); scene.add(hand2);
      var winM0 = new T.MeshBasicMaterial({ color: 0x0d1a33 }); dispose.push(winM0);
      scene.add(add(new T.PlaneGeometry(0.9, 1.0), winM0, [-2.66, 1.55, 0.6], [0, Math.PI / 2, 0], 0));
      [-0.55, 0.55].forEach(function (dz) { scene.add(add(new T.BoxGeometry(0.05, 1.5, 0.32), M({ color: 0x6a1e1a, roughness: 1 }), [-2.62, 1.4, 0.6 + dz])); });
      // the front door: a brass mail slot
      var door = new T.Group(); door.position.set(2.66, 0, 0.6); scene.add(door);
      door.add(add(new T.BoxGeometry(0.06, 2.05, 0.92), wood2, [0, 1.025, 0]));
      [0.55, 1.55].forEach(function (y) { door.add(add(new T.BoxGeometry(0.075, 0.6, 0.7), woodM, [-0.005, y, 0])); });
      door.add(add(new T.BoxGeometry(0.03, 2.15, 0.08), woodM, [-0.02, 1.07, 0.5])); door.add(add(new T.BoxGeometry(0.03, 2.15, 0.08), woodM, [-0.02, 1.07, -0.5])); door.add(add(new T.BoxGeometry(0.03, 0.08, 1.08), woodM, [-0.02, 2.1, 0]));
      door.add(add(new T.SphereGeometry(0.035, 12, 8), brass, [-0.06, 1.0, -0.36]));
      door.add(add(new T.BoxGeometry(0.03, 0.07, 0.32), brass, [-0.05, 1.05, 0])); door.add(add(new T.BoxGeometry(0.035, 0.022, 0.26), ebony, [-0.055, 1.05, 0], null, 0));
      var coldM = new T.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }); dispose.push(coldM);
      var crack = add(new T.PlaneGeometry(0.07, 0.85), coldM, [2.6, 0.003, 0.6], [-Math.PI / 2, 0, 0], 0); scene.add(crack);   // cold light under the door
      var cold = new T.SpotLight(0x9ab8ff, 0, 5, 0.9, 0.8, 1.5); cold.position.set(2.75, 0.05, 0.6); cold.target.position.set(1.0, 0, 0.5); scene.add(cold); scene.add(cold.target);
      // the envelope
      var envT = canvasTex(128, 80, function (x, w, h) { x.fillStyle = "#e6dcc4"; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(120,100,70,.5)"; x.beginPath(); x.moveTo(0, 0); x.lineTo(w / 2, h * 0.55); x.lineTo(w, 0); x.stroke(); x.fillStyle = "#8a1418"; x.beginPath(); x.arc(w / 2, h * 0.55, 9, 0, 7); x.fill(); });
      var env = add(new T.BoxGeometry(0.13, 0.004, 0.23), M({ map: envT, roughness: 0.9 })); scene.add(env);
      // the one at the piano: younger, a sweater, his back to us (never his face)
      var swM = M({ color: 0x34452f, roughness: 1 }), jeans = M({ color: 0x1d2433, roughness: 0.9 }), hairM = M({ color: 0x1e140d, roughness: 0.85 });
      fig = mkFig(swM, skinM, jeans, shoeM, { dress: "sweater" }); fig.g.position.set(-0.5, -0.36, -1.72); fig.g.rotation.y = Math.PI; fig.g.scale.set(0.96, 0.97, 0.96);
      var hair = add(new T.SphereGeometry(1.07, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.72), hairM, [0, 0.06, -0.06], [-0.55, 0, 0]); fig.head.add(hair);
      fig.legs.forEach(function (l) { l.visible = false; }); fig.head.position.y = 0.35;
      [-1, 1].forEach(function (sd) {       // seated legs: thighs on the bench, shins down to the floor
        scene.add(add(new T.CapsuleGeometry(0.058, 0.4, 8, 16), jeans, [-0.5 + sd * 0.11, 0.62, -1.98], [Math.PI / 2, 0, 0]));
        scene.add(add(new T.CapsuleGeometry(0.05, 0.46, 8, 16), jeans, [-0.5 + sd * 0.11, 0.33, -2.2]));
        var sh0 = add(new T.SphereGeometry(1, 16, 10), shoeM, [-0.5 + sd * 0.11, 0.04, -2.26]); sh0.scale.set(0.055, 0.04, 0.12); scene.add(sh0);
      });
      var bench = new T.Group(); bench.position.set(-0.5, 0, -1.72); scene.add(bench);
      bench.add(add(new T.BoxGeometry(0.95, 0.07, 0.38), woodM, [0, 0.55, 0])); bench.add(add(new T.BoxGeometry(0.9, 0.04, 0.34), M({ color: 0x5a1a14, roughness: 1 }), [0, 0.6, 0]));
      [[-0.42, -0.15], [0.42, -0.15], [-0.42, 0.15], [0.42, 0.15]].forEach(function (q) { bench.add(add(new T.BoxGeometry(0.05, 0.52, 0.05), woodM, [q[0], 0.26, q[1]])); });
      var lastN = 0;
      D.frame = function (t) {
        // playing: hands on the keys, a soft sway; at the knock he stops, his hands lift and stay in the air
        var stop = sm01(5.5, 5.8, t), noteK = 0;
        INV_PIANO.forEach(function (n) { if (n[0] <= t) noteK = Math.max(noteK, 1 - Math.min(1, (t - n[0]) * 6)); });
        fig.torso.rotation.x = 0.13 - stop * 0.08 + (RM ? 0 : Math.sin(t * 1.4) * 0.025 * (1 - stop)); fig.torso.rotation.z = RM ? 0 : Math.sin(t * 0.7) * 0.03 * (1 - stop);
        fig.neck.rotation.x = -0.2 + (RM ? 0 : Math.sin(t * 1.4 + 0.5) * 0.04) * (1 - stop); fig.neck.rotation.y = stop * 0.18 * (1 - sm01(7.0, 8.0, t));
        fig.arms.forEach(function (a, k) {
          var sw = RM ? 0 : Math.sin(t * 2.2 + k * 1.7) * 0.06 * (1 - stop);
          a.sh.rotation.set(-0.3 - stop * 0.15, 0, a.sd * (-0.12 + sw)); a.el.rotation.x = -0.95 + (k ? noteK : 0) * 0.05 - stop * 0.2; a.hand.rotation.x = -0.35;
          a.f.forEach(function (fg, j) { fg.rotation.x = 0.35 + (RM ? 0 : Math.max(0, Math.sin(t * 7 + j * 1.9 + k)) * 0.5 * (1 - stop)); });
        });
        // the knock, the turn, the slot, the fall, the walk, the letter, then one look back: the bench is empty
        var knockK = 0; [5.5, 5.95, 6.4].forEach(function (p) { if (t > p && t < p + 0.15) knockK = 1 - (t - p) / 0.15; });
        var turn = sm01(6.6, 7.6, t), walk = sm01(8.95, 9.9, t), back = t > 13.4;
        var e = sm01(7.75, 8.4, t), f = sm01(8.4, 8.85, t);
        env.position.set(2.62 - e * 0.13 - f * 0.18, 1.05 - f * 1.045, 0.6 - f * 0.05); env.rotation.set(0, f * 0.35, -f * (RM ? 0 : 0.6) * (1 - f) * 3);
        env.visible = t > 7.75 && t < 13.4;
        coldM.opacity = sm01(6.4, 7.6, t) * 0.18 * (RM ? 1 : 0.85 + Math.random() * 0.15); cold.intensity = sm01(6.4, 8, t) * 2.2;
        warm.intensity = 13 * (1 - sm01(6.4, 13, t) * 0.55) * (!RM && t > 6.35 && t < 6.45 ? 0.3 : 1); warm2.intensity = 5 * (1 - sm01(6.4, 12, t) * 0.7); hemi.intensity = 1.1 * (1 - sm01(6.4, 12, t) * 0.6);
        shadeM.emissiveIntensity = 0.9 * warm.intensity / 13;
        hand1.rotation.z = -t * 0.02; fig.g.visible = !back;
        var pos = lerpV([1.55, 1.5, 1.25], [0.95, 1.45, 1.05], turn).clone().lerp(V2.set(1.7, 1.38, 0.85), walk);
        var look = lerpV([-0.55, 0.95, -2.3], [2.62, 1.05, 0.6], turn).clone().lerp(V2.set(2.25, 0.02, 0.55), Math.max(f * 0.7, walk));
        var fov = 64 - sm01(7.6, 8.2, t) * 16 + walk * 10;
        if (back) { pos = V2.set(1.5, 1.48, 1.2); look = new T.Vector3(-0.5, 0.8, -2.0); fov = 62; }
        shoot(pos, look, fov, 0, 0.7 + walk * 0.8, t);
        if (knockK && !RM) cam.position.x += (Math.random() - 0.5) * 0.012 * knockK;
        u.uExp.value = 1.45 - sm01(9.9, 13.4, t) * 0.4; u.uAb.value = 0.006 + sm01(6.5, 13, t) * 0.006; u.uGr.value = 0.11 + sm01(6.5, 13, t) * 0.06;
        u.uBl.value = RM ? 0 : 1.6 * (1 - sm01(0, 1.4, t)) + 3 * Math.sin(Math.PI * turn) + 2 * Math.sin(Math.PI * walk) + (back ? 0.6 : 0);
        u.uTear.value = RM ? 0 : (t > 13.4 && t < 13.55 ? 0.8 : 0); u.uRed.value = back ? 0.12 : 0;
        u.uK.value = t > 13.4 && t < 13.46 ? 0 : 1;
      };
    }
    // ======== №∞: the letter; a run down the corridor; he lies on the floor and his head is a skull; you look away; only the coat is left
    if (k === "end") {
      var X0 = 40;
      var cor = add(new T.BoxGeometry(2.4, 2.7, 16), wallM, [X0, 1.35, 0], null, 0); cor.material = [wallM, wallM, wallM, floorM, wallM, wallM]; cor.geometry.scale(-1, 1, 1); scene.add(cor);
      var tubeM = new T.MeshBasicMaterial({ color: 0xdfeeff }); dispose.push(tubeM);
      var tubes = [], CL = [];
      for (i = 0; i < 6; i++) { var tb = add(new T.BoxGeometry(0.12, 0.04, 1.1), tubeM, [X0, 2.66, 6 - i * 2.6], null, 0); scene.add(tb); tubes.push(tb); }
      [4.5, 0, -4.5].forEach(function (z) { var l = new T.PointLight(0xcfe2ff, 2.4, 7, 1.5); l.position.set(X0, 2.4, z); scene.add(l); CL.push(l); });
      for (i = 0; i < 8; i++) { var sd0 = i % 2 ? 1 : -1; scene.add(add(new T.BoxGeometry(0.06, 2.0, 0.9), M({ color: 0x1d1f22, roughness: 0.6, metalness: 0.4 }), [X0 + sd0 * 1.18, 1.0, 5.5 - i * 1.7], null, 0)); }
      for (i = 0; i < 2; i++) scene.add(add(new T.CylinderGeometry(0.05, 0.05, 16, 8), pipeM, [X0 - 0.9 + i * 0.25, 2.5, 0], [Math.PI / 2, 0, 0], 0));
      var hole = new T.MeshBasicMaterial({ color: 0x000000 }); dispose.push(hole);
      scene.add(add(new T.PlaneGeometry(1.0, 2.1), hole, [X0, 1.05, -7.985], null, 0));
      var hinge = new T.Group(); hinge.position.set(X0 - 0.5, 0, -7.95); scene.add(hinge);
      hinge.add(add(new T.BoxGeometry(1.0, 2.1, 0.05), M({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.5 }), [0.5, 1.05, 0]));
      hinge.add(add(new T.BoxGeometry(0.3, 0.2, 0.02), M({ color: 0x8a1a1a, roughness: 0.6 }), [0.5, 1.55, 0.03], null, 0));
      // the lab: the gate asleep, a console, a dead lamp; the doorway behind us
      portal = ring3(6.283, true); console3(2.4, -3.0, -0.45);
      D.l = lamp(-0.5, 3.55, -1.4, -0.5, 0, -1.9, 5, false);
      scene.add(add(new T.PlaneGeometry(1.2, 2.3), hole, [-0.3, 1.15, 2.84], [0, Math.PI, 0], 0));
      scene.add(add(new T.BoxGeometry(1.4, 0.1, 0.08), metal, [-0.3, 2.33, 2.8], null, 0));
      // the camcorder's own light
      var camL = new T.SpotLight(0xffe8c8, 0, 9, 0.36, 0.7, 1.8); camL.castShadow = true; camL.shadow.mapSize.set(1024, 1024); camL.shadow.bias = -0.0006; scene.add(camL); scene.add(camL.target);
      // the others' flashlights, with visible beams
      var FL = [-1.0, 0.4].map(function (x0) {
        var l = new T.SpotLight(0xfff6e8, 0, 14, 0.32, 0.5, 1.3); l.position.set(x0, 1.35, 2.7); scene.add(l); scene.add(l.target);
        var bg = new T.Group(); bg.position.copy(l.position); scene.add(bg);
        var cg = new T.ConeGeometry(0.55, 4, 20, 1, true); cg.translate(0, -2, 0); cg.rotateX(-Math.PI / 2);
        var bmM = new T.MeshBasicMaterial({ color: 0xfff1d8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }); dispose.push(bmM);
        bg.add(add(cg, bmM, null, null, 0));
        var fm = new T.MeshBasicMaterial({ color: 0xfff8ec, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }); dispose.push(fm);
        var flare = add(new T.CircleGeometry(0.035, 20), fm, null, null, 0), halo2 = add(new T.CircleGeometry(0.12, 24), fm, null, null, 0); flare.renderOrder = halo2.renderOrder = 5;
        scene.add(flare); scene.add(halo2); return { l: l, bg: bg, m: bmM, x0: x0, fl: flare, ha: halo2, fm: fm };
      });
      // him: the coat, lying on his back; where the face was, a bare skull
      var boneM = M({ color: 0xcfc6ad, roughness: 0.62 }), voidM = new T.MeshBasicMaterial({ color: 0x000000 }), toothM = M({ color: 0xd9d0b8, roughness: 0.4 }); dispose.push(voidM);
      coatM.color.set(0xb9b6ad); fig = mkFig(coatM, skinM, darkM, shoeM);
      var holder = new T.Group(); holder.position.set(-0.5, 0, -2.75); holder.rotation.y = Math.PI - 0.1; scene.add(holder); holder.add(fig.g);   // feet toward the gate, the head toward the door
      fig.g.position.set(0, 0.19, 0); fig.g.rotation.set(-Math.PI / 2, 0, 0.06);
      fig.head.visible = false; fig.neck.children[0].material = darkM;
      var sk = new T.Group(); sk.position.set(0, 0.34, 0.02); fig.neck.add(sk);
      var SG = skullGeo(T); dispose.push(SG.c, SG.j);
      var skM = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }); dispose.push(skM);
      sk.add(add(SG.c, skM));
      var jaw = new T.Group(); jaw.position.set(0, -0.062, 0.004); jaw.rotation.x = 0.16; sk.add(jaw);
      jaw.add(add(SG.j, skM));
      var eyeM = new T.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }); dispose.push(eyeM);
      [-1, 1].forEach(function (sd) { sk.add(add(new T.SphereGeometry(0.0045, 8, 6), eyeM, [sd * 0.0262, 0.015, 0.05], null, 0)); });   // something is still in there
      fig.arms.forEach(function (a) { a.sh.rotation.set(0, 0, a.sd * 0.55); a.el.rotation.set(-0.35, 0, 0); a.hand.rotation.set(0, 0, a.sd * 0.3); a.f.forEach(function (fg) { fg.rotation.x = 0.7; }); });
      fig.legs.forEach(function (l, i2) { l.rotation.z = (i2 ? 1 : -1) * 0.07; });
      var SKULL = new T.Vector3(-0.72, 0.2, -0.52), MID = new T.Vector3(-0.6, 0.1, -1.6);
      D.frame = function (t) {
        var pos, look, fov = 56, amt = 1, roll = 0, inLab = t >= 12.2;
        cor.visible = !inLab; room.visible = inLab;
        flickAll(inLab ? 0.08 : 0); D.l.I = 2.5;
        portal.m.emissiveIntensity = 0.25 + beat(t) * 0.8; portal.dm.uniforms.uT.value = t; portal.dm.uniforms.uI.value = 0.25; portal.dm.uniforms.uA.value = 0.6; portal.pl.intensity = 1.5 + beat(t) * 5;
        if (t < 7) { pos = V.set(X0, 1.5, 7.5); look = V2.set(X0, 1.5, 0); u.uK.value = 0; shoot(pos, look, fov, 0, 0, t); return; }
        if (!inLab) {           // the run
          var rz = 7.2 - (t - 7.0) * 2.75, ph = t * Math.PI * 2.9, bob = RM ? 0 : Math.abs(Math.sin(ph));
          tubes.forEach(function (tb, j) { tb.visible = RM || !(j === 2 && Math.sin(t * 23) > 0.2) ; });
          CL.forEach(function (l, j) { l.intensity = (RM ? 5 : (j === 1 && Math.sin(t * 23) > 0.2 ? 0.3 : 5)); });
          hinge.rotation.y = -sm01(11.85, 12.15, t) * 1.7;
          pos = V.set(X0 + (RM ? 0 : Math.sin(ph / 2) * 0.1), 1.52 + bob * 0.08, rz);
          look = V2.set(X0 + (RM ? 0 : Math.sin(ph / 2) * 0.3), 1.35 + bob * 0.05, rz - 4);
          roll = RM ? 0 : Math.sin(ph / 2) * 0.05; fov = 62; amt = 2.4;
          camL.intensity = 0; FL.forEach(function (F) { F.l.intensity = 0; F.m.opacity = 0; });
          shoot(pos, look, fov, roll, amt, t);
          u.uBl.value = RM ? 0 : 1.4 + bob * 1.2; u.uExp.value = 1.45; u.uTear.value = RM ? 0 : (t < 7.25 ? 1 : 0) + (t > 12.05 ? 1 : 0); u.uAb.value = 0.009;
          return;
        }
        var gone = t >= 18.9;
        // the body: skull — then nothing but the coat lying flat
        sk.visible = !gone; fig.neck.visible = !gone;
        fig.legs.forEach(function (l) { l.visible = !gone; }); fig.arms.forEach(function (a) { a.hand.visible = !gone; });
        fig.g.scale.set(1, 1, gone ? 0.16 : 1); fig.g.position.y = gone ? 0.03 : 0.19;
        jaw.rotation.x = 0.16 + (!RM && t > 15.2 && t < 15.5 ? 0.12 : 0);
        eyeM.opacity = t > 14.9 && t < 16.0 ? (RM ? 0.8 : 0.5 + Math.random() * 0.5) * sm01(14.9, 15.3, t) : 0;
        var enter = sm01(12.2, 13.0, t), down = sm01(12.9, 13.5, t), appr = sm01(13.5, 16.0, t);
        pos = lerpV([-0.3, 1.55, 2.4], [-0.45, 1.5, 1.05], enter).clone().lerp(V.set(-0.42, 1.0, -1.05), appr);
        look = lerpV([-0.5, 1.3, -2.5], [-0.6, 0.15, -1.2], down).clone().lerp(SKULL, appr);
        fov = 62 - appr * 22; amt = 1.2 + (1 - enter) * 1.5;
        if (t > 16.0 && t < 17.4) { var lr = (t - 16.0) / 1.4; look = V2.set(-0.5 + Math.sin(lr * Math.PI * 2) * 3.2, 1.2, -2.2); fov = 62; amt = 2.2; pos = V.set(-0.12, 1.25, -1.2); }
        if (t >= 17.4 && t < 18.9) { look = V2.set(-0.3, 1.3, 3); pos = V.set(-0.15, 1.4, -1.1); fov = 58; amt = 1.6; }
        if (gone) { var push = sm01(19.2, 21.5, t); pos = V.set(0.05, 1.5 - push * 0.15, -0.6); look = V2.copy(MID); fov = 64 - push * 8; amt = 1.5; }
        if (t > 21.5) { var tw = sm01(21.5, 22.2, t); look = look.clone().lerp(V2.set(-0.3, 1.3, 3), tw); fov = 60; amt = 2.4; }
        shoot(pos, look, fov, roll, amt, t);
        camL.position.copy(cam.position).add(V.set(0.22, 0.28, 0)); camL.target.position.copy(look); camL.intensity = 4.2 * (RM ? 1 : (Math.random() < 0.04 ? 0.4 : 1));
        // the others: flashlights through the doorway
        var come = sm01(20.8, 22.0, t);
        FL.forEach(function (F, j) {
          var tx = -0.5 + Math.sin(t * (1.3 + j * 0.7) + j * 2) * 1.2, tz = -1.6 + Math.cos(t * (1.1 + j * 0.5)) * 1.0;
          if (t > 21.8) { tx = cam.position.x + (j ? 0.35 : -0.35); tz = cam.position.z + 0.5; }
          F.l.position.set(F.x0 + come * 0.3, 1.35, 2.7 - come * 0.6); F.l.target.position.set(tx, 0, tz); F.l.intensity = come * 22;
          F.bg.position.copy(F.l.position); F.bg.lookAt(F.l.target.position); F.bg.visible = false;
          F.fl.position.copy(F.l.position); F.ha.position.copy(F.l.position); F.fl.lookAt(cam.position); F.ha.lookAt(cam.position); F.ha.scale.setScalar(1 + (RM ? 0 : Math.random() * 0.2)); F.fm.opacity = come * (t > 21.8 ? 0.45 : 0.2);
        });
        var glare = sm01(21.9, 22.6, t);
        var hit = t > 13.45 && t < 13.9 ? 1 - (t - 13.45) / 0.45 : t > 18.9 && t < 19.3 ? 1 - (t - 18.9) / 0.4 : 0;
        u.uBl.value = RM ? 0 : 1.2 * (1 - enter) + (t > 16 && t < 17.4 ? 2.5 : 0) + (t > 18.6 && t < 18.95 ? 4 : 0) + glare * 2;
        u.uTear.value = RM ? 0 : (t < 12.4 ? 1 : 0) + hit * 0.6 + (t > 23 ? sm01(23, 23.4, t) : 0);
        u.uAb.value = 0.008 + hit * 0.03 + appr * 0.004; u.uRed.value = gone ? 0.1 : appr * 0.06; u.uGr.value = 0.14 + hit * 0.15;
        u.uExp.value = 1.15 + glare * 0.6 - (t >= 17.4 && t < 18.9 ? 0.2 : 0);
      };
    }
    // ======== «почему»: a figure from behind in the dark, whispering; it turns, and comes
    if (k === "why") {
      scene.fog.density = 0.11; moon.intensity = 0.04; hemi.intensity = 0.08;
      var rim = new T.SpotLight(0xc8d4ff, 30, 8, 0.55, 0.7, 1.3); rim.position.set(0.2, 3.6, -4.0); rim.target.position.set(0, 1.2, -2.4); rim.castShadow = true; rim.shadow.mapSize.set(1024, 1024); scene.add(rim); scene.add(rim.target);
      var fill = new T.PointLight(0x8a6a5a, 0.7, 5, 2); fill.position.set(0, 1.6, 0.6); scene.add(fill);
      fig = mkFig(coatM, skinM, darkM, shoeM); fig.g.rotation.y = Math.PI;
      D.frame = function (t) {
        var turn = RM ? 0 : sm01(8.2, 9.0, t) * 0.9, snapped = t >= 9.0, lunge = RM ? (t > 9.1 ? 1 : 0) : sm01(9.1, 9.45, t);
        fig.g.rotation.y = snapped ? 0 : Math.PI - turn; fig.g.rotation.z = RM ? 0 : Math.sin(t * 0.8) * 0.025 * (1 - lunge);
        fig.g.position.set(0, 0, -2.4 + lunge * 2.05);
        fig.arms.forEach(function (a) { a.sh.rotation.set(-0.05 - lunge * 1.5, 0, a.sd * 0.05); a.el.rotation.x = -0.1 - lunge * 0.3; });
        restless(fig, t * (1 + lunge * 4), 0.4 + lunge); fig.torso.rotation.x = 0.06 + lunge * 0.3; fig.neck.rotation.z = RM ? 0 : Math.sin(t * 0.6) * 0.1 + (t > 2 && t < 8 && Math.sin(t * 1.7) > 0.96 ? 0.25 : 0);
        fig.neck.rotation.x = -0.1 - lunge * 0.4;
        shoot(V.set(0, 1.62, 1.2), V2.set(0, 1.5 + lunge * 0.3, -2.4 + lunge * 2), 46, 0, 0.6 + lunge * 2, t);
        u.uTear.value = RM ? 0 : (lunge > 0 && lunge < 1 ? 0.5 : snapped ? 0.2 : 0); u.uRed.value = snapped ? 0.2 : 0; u.uExp.value = 1.25 + lunge * 0.4; u.uGr.value = 0.15 + lunge * 0.2; u.uAb.value = 0.007 + lunge * 0.04;
        u.uBl.value = RM ? 0 : 1.5 * (1 - sm01(0, 1.5, t));
      };
    }
    function size() {
      var w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      R.setSize(w, h, false); R.domElement.style.width = w + "px"; R.domElement.style.height = h + "px";
      RT.setSize(Math.round(w * DPR), Math.round(h * DPR)); u.uRes.value.set(w * DPR, h * DPR);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    function frame(t) {
      u.uT.value = t; u.uK.value = 1; u.uTear.value = 0; u.uRed.value = 0; u.uGr.value = 0.13; u.uAb.value = 0.006;
      var pa = dg.attributes.position.array; if (!RM) { for (var k = 1; k < pa.length; k += 3) { pa[k] -= 0.0012; if (pa[k] < 0) pa[k] = 3.6; } dg.attributes.position.needsUpdate = true; }
      D.frame(t);
      R.setRenderTarget(RT); R.render(scene, cam); R.setRenderTarget(null); R.render(pScene, pCam);
    }
    return {
      size: size, frame: frame,
      dispose: function () { dispose.forEach(function (d) { try { d.dispose(); } catch (e) { /* gone */ } }); RT.dispose(); R.dispose(); try { R.forceContextLoss(); } catch (e) { /* gone */ } R.domElement.remove(); }
    };
  }
  // ---- the tapes, flat (three.js could not load)
  function tape2d(host, k) {
    var c = document.createElement("canvas"); host.appendChild(c); var x = c.getContext("2d"), W = 0, H = 0;
    function size() { W = c.width = Math.ceil(innerWidth / 2); H = c.height = Math.ceil(innerHeight / 2); c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; }
    function fig(cx, base, s, col) {
      x.fillStyle = col || "#cfcac0"; x.beginPath(); x.ellipse(cx, base - 205 * s, 13 * s, 20 * s, 0.1, 0, 7); x.fill();
      x.fillStyle = col || "#bdb9b0"; x.beginPath(); x.moveTo(cx - 22 * s, base - 170 * s); x.lineTo(cx + 22 * s, base - 170 * s); x.lineTo(cx + 34 * s, base - 40 * s); x.lineTo(cx - 34 * s, base - 40 * s); x.fill();
      x.fillStyle = col || "#111"; x.fillRect(cx - 12 * s, base - 40 * s, 8 * s, 40 * s); x.fillRect(cx + 4 * s, base - 40 * s, 8 * s, 40 * s);
    }
    function ring(cx, cy, r, glow, arc) {
      x.lineWidth = Math.max(3, r * 0.12); x.strokeStyle = glow > 0.05 ? "rgba(" + (60 + Math.min(1, glow) * 195 | 0) + ",30,16,1)" : "#2a2826";
      x.shadowColor = "rgba(255,40,20," + Math.min(1, glow) + ")"; x.shadowBlur = glow * 30; x.beginPath(); x.arc(cx, cy, r, -0.5, -0.5 + (arc || 6.3)); x.stroke(); x.shadowBlur = 0;
    }
    function heart(cx, cy, hh) { if (HOK) x.drawImage(HIMG, cx - hh * HIMG.width / HIMG.height / 2, cy - hh / 2, hh * HIMG.width / HIMG.height, hh); }
    function frame(t) {
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#050505"; x.fillRect(0, 0, W, H);
      var jx = RM ? 0 : Math.sin(t * 0.9) * 3, jy = RM ? 0 : Math.sin(t * 1.3) * 2, cx = W / 2 + jx, cy = H * 0.45 + jy, r = Math.min(W, H) * 0.32, b = Math.max(0, Math.sin((t % 0.86) / 0.86 * Math.PI * 4)) * 0.1, q;
      x.fillStyle = "#0c0c0b"; x.fillRect(0, H * 0.72 + jy, W, H);
      if (k === "plans") {
        x.fillStyle = "#1a221e"; x.fillRect(W * 0.08 + jx - t * 6, H * 0.2, W * 0.9, H * 0.38); x.strokeStyle = "rgba(230,230,220,.7)"; x.lineWidth = 2;
        x.beginPath(); x.arc(W * 0.35 + jx - t * 6, H * 0.39, H * 0.14, 0, 7); x.stroke();
        glyphText(x, "NO GAP", W * 0.55 + jx - t * 6, H * 0.3, 2, "rgba(230,230,220,.7)"); fig(W * 0.4 + jx - t * 6, H * 0.78, H / 300);
        if (t > 8) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.fillStyle = "#d8cfb8"; x.fillRect(W * 0.1, H * 0.3, W * 0.8, H * 0.35); ["IF IT OPENS,", "IT WILL KNOW", "MY NAME."].forEach(function (l, i) { glyphText(x, l, W * 0.15, H * 0.35 + i * H * 0.09, Math.max(1, W / 110 | 0), "#191820"); }); }
      } else if (k === "voices") {
        for (q = 0; q < 3; q++) { var chx = W * (0.2 + q * 0.3) - t * 4; x.fillStyle = "#16171b"; x.fillRect(chx - 20, H * 0.5, 40, 50); x.fillRect(chx - 22, H * 0.6, 44, 8); if (q !== 1) { x.fillStyle = "#8a8880"; x.fillRect(chx - 18, H * 0.5, 36, 40); } }
        x.fillStyle = "rgba(255,165,72," + (0.6 + Math.random() * 0.3) + ")"; x.fillRect(W * 0.78, H * 0.62, 26, 9);
      } else if (k === "family") {
        x.fillStyle = "#2f2318"; x.fillRect(0, H * 0.55, W, H); x.fillStyle = "#6e5a42"; x.fillRect(W * 0.18, H * 0.25, W * 0.3, H * 0.32);
        [[0.26, 0.33], [0.4, 0.34], [0.33, 0.42]].forEach(function (p) { x.fillStyle = "#000"; x.beginPath(); x.arc(W * p[0], H * p[1], W * 0.035, 0, 7); x.fill(); });
        x.fillStyle = "#e9e4d8"; x.fillRect(W * 0.55, H * 0.62, W * 0.35, H * 0.2); x.strokeStyle = "#55575f"; x.lineWidth = 3; x.beginPath(); x.arc(W * 0.72, H * 0.72, H * 0.07, 0, 7); x.stroke(); heart(W * 0.72, H * 0.72, H * 0.06);
      } else if (k === "beyond") {
        x.fillStyle = "#08070d"; x.fillRect(0, H * 0.55, W, H);
        for (q = 0; q < 14; q++) { var sx = (q % 2 ? 0.08 : 0.68) * W + (q * 37 % 60), sh = 30 + q * 7 % 50; x.fillStyle = q % 3 ? "#3a2c7a" : "#1d4f64"; x.beginPath(); x.moveTo(sx, H * 0.62); x.lineTo(sx + 9, H * 0.62 - sh); x.lineTo(sx + 18, H * 0.62); x.fill(); }
        var rk = Math.min(1, Math.max(0, (t - 2) / 9.5)), oz = 1 / (1 + rk * 12);
        x.fillStyle = "#fff0ea"; x.shadowColor = "#ff5a4a"; x.shadowBlur = 16; x.beginPath(); x.arc(W / 2 + Math.sin(rk * 9) * 20 * oz, H * 0.56 + 60 * oz, 2 + 8 * oz, 0, 7); x.fill(); x.shadowBlur = 0;
      } else if (k === "invite") {
        var wl = Math.max(0.45, 1 - Math.max(0, t - 6.4) * 0.08);
        x.fillStyle = "rgb(" + (70 * wl | 0) + "," + (44 * wl | 0) + "," + (24 * wl | 0) + ")"; x.fillRect(0, 0, W, H); x.fillStyle = "#2a160c"; x.fillRect(0, H * 0.72, W, H);
        if (t < 6.6 || t > 13.4) {
          x.fillStyle = "#24130a"; x.fillRect(W * 0.18 + jx, H * 0.38, W * 0.6, H * 0.36); x.fillStyle = "#e8e0cc"; x.fillRect(W * 0.2 + jx, H * 0.52, W * 0.56, H * 0.03);
          var gl2 = x.createRadialGradient(W * 0.7, H * 0.3, 2, W * 0.7, H * 0.3, H * 0.5); gl2.addColorStop(0, "rgba(255,170,90," + 0.5 * wl + ")"); gl2.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gl2; x.fillRect(0, 0, W, H);
          if (t < 13.4) fig(W * 0.48 + jx, H * 0.86, H / 330, "#2f3d2a");
        } else {
          x.fillStyle = "#4a2a16"; x.fillRect(W * 0.3 + jx, H * 0.12, W * 0.4, H * 0.62); x.fillStyle = "#b08a3a"; x.fillRect(W * 0.42 + jx, H * 0.42, W * 0.16, H * 0.02);
          x.fillStyle = "rgba(140,180,255,.35)"; x.fillRect(W * 0.3 + jx, H * 0.73, W * 0.4, 3);
          var ef = Math.min(1, Math.max(0, (t - 8.4) / 0.45)); if (t > 7.75) { x.fillStyle = "#e6dcc4"; x.fillRect(W * 0.45 + jx, H * (0.43 + ef * 0.35), W * 0.1, H * 0.02 + ef * H * 0.03); }
        }
      } else if (k === "end") {
        if (t >= 7 && t < 12.2) {
          var bob = RM ? 0 : Math.abs(Math.sin(t * 9)) * 6; x.strokeStyle = "#4a4e55"; x.lineWidth = 2;
          [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (q) { x.beginPath(); x.moveTo(q[0], q[1]); x.lineTo(W / 2, H / 2 + bob); x.stroke(); });
          for (q = 0; q < 6; q++) { var zz = ((t * 3 + q) % 6) / 6, sc2 = 1 - zz; x.fillStyle = "rgba(220,235,255," + sc2 + ")"; x.fillRect(W / 2 - 20 * sc2, H / 2 + bob - H * 0.45 * sc2, 40 * sc2, 3); }
        } else if (t >= 12.2) {
          var gone2 = t >= 18.9, lt = x.createRadialGradient(W / 2, H * 0.6, 4, W / 2, H * 0.6, H * 0.45); lt.addColorStop(0, "rgba(255,240,215,.35)"); lt.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = lt; x.fillRect(0, 0, W, H);
          x.fillStyle = "#d8d6cf"; x.beginPath(); x.ellipse(W / 2 + jx, H * 0.66, W * 0.12, H * (gone2 ? 0.12 : 0.17), 0, 0, 7); x.fill();
          if (!gone2) { x.fillStyle = "#e8e1cd"; x.beginPath(); x.ellipse(W / 2 + jx, H * 0.42, W * 0.07, H * 0.06, 0, 0, 7); x.fill(); x.fillStyle = "#000"; x.beginPath(); x.ellipse(W / 2 - W * 0.025 + jx, H * 0.415, W * 0.018, H * 0.016, 0, 0, 7); x.ellipse(W / 2 + W * 0.025 + jx, H * 0.415, W * 0.018, H * 0.016, 0, 0, 7); x.fill(); }
        }
      } else if (k === "why") {
        var ln = RM ? (t > 9.1 ? 1 : 0) : Math.min(1, Math.max(0, (t - 9.1) / 0.35));
        fig(W / 2 + (RM ? 0 : Math.sin(t * 0.8) * 2), H * (0.9 + ln * 0.9), H / (330 - ln * 260), "#2a2a30");
      } else {
        var lv = k === "start" ? Math.min(1, Math.max(0, (t - 2) / 5.2)) : k === "frame" ? 0 : k === "shadow" || k === "heart" ? 0.5 : 0.9;
        if (k === "start" && t > 7.8) lv = 0.08;
        ring(cx, cy, r, lv + (k === "fall" || k === "step" ? b * 3 : 0), k === "frame" ? 5.4 : 6.3);
        if (k !== "frame" && lv > 0.1) { var g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, k === "step" ? "rgba(255,230,210," + Math.min(1, t / 9) + ")" : "rgba(160,20,10,.5)"); g.addColorStop(1, "rgba(80,0,10,.6)"); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r * 0.93, 0, 7); x.fill(); }
        if (k === "shadow" && t < 6) fig(cx, cy + r * 0.6, r / 400, "#000");
        if (k === "shadow" && t >= 7.8 && t < 8.15) fig(W * 0.75, H * 0.95, H / 230, "#060606");
        if (k === "frame" && weldOn(t)) { x.fillStyle = "rgba(190,215,255,.9)"; x.beginPath(); x.arc(cx + r * 0.88, cy + r * 0.48, 4 + Math.random() * 4, 0, 7); x.fill(); for (q = 0; q < 20; q++) { x.fillStyle = "#ffc27a"; x.fillRect(cx + r * 0.88 + (Math.random() - 0.3) * 60, cy + r * 0.48 + Math.random() * 60, 2, 2); } }
        if (k === "frame" || k === "start" || k === "heart") fig(cx + r * 1.1, H * 0.78, H / 300);
        if (k === "heart") { x.strokeStyle = "rgba(170,200,220,.4)"; x.strokeRect(cx + r * 0.2, H * 0.48, r * 0.5, H * 0.26); heart(cx + r * 0.45, H * 0.6, H * 0.08 * Math.min(1, t / 7) * (1 + b)); }
        if (k === "fall" && t < 5) fig(W * 0.6, H * 0.8 + Math.max(0, t - 4.2) * H * 0.6, H / 260);
        if (k === "fall" || k === "step" && t > 11) heart(cx, cy, r * 0.4 * (1 + (RM ? 0 : b)));
        if (k === "step" && t < 9.6) fig(cx, H * 0.95 - t * H * 0.02, H / (230 + t * 30));
        if (k === "start" && t > 8.6) { x.fillStyle = "rgba(0,0,0," + Math.min(1, (t - 8.6) * 1.2) + ")"; x.fillRect(0, 0, W, H); }
      }
      if (k === "fall" && t > 5) { var tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; tmp.getContext("2d").drawImage(c, 0, 0); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.save(); x.translate(W / 2, H / 2); x.rotate(Math.PI / 2); x.drawImage(tmp, -W / 2, -H / 2); x.restore(); }
      x.setTransform(1, 0, 0, 1, 0, 0);
      if (!RM) { x.fillStyle = "rgba(255,255,255,.07)"; for (var nn = 0; nn < 300; nn++) x.fillRect(Math.random() * W | 0, Math.random() * H | 0, 1, 1); }
      var v = x.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.85)"); x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
    return { size: size, frame: frame, dispose: function () { c.remove(); } };
  }
  // ---- «???»: static, the cipher, the real face for a frame, WHY
  function tapeX(host) {
    var c = document.createElement("canvas"); host.appendChild(c); var x = c.getContext("2d"), W = 0, H = 0, img = null, SEEN = drawSeen().c;
    var words = ["WHY", "HE IS STILL WATCHING", "WHY", "LOOK", "?", "IT KNOWS", "WHY"];
    function size() { W = c.width = Math.ceil(innerWidth / 3); H = c.height = Math.ceil(innerHeight / 3); c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; c.style.imageRendering = "pixelated"; img = x.createImageData(W, H); }
    function frame(t) {
      var d = img.data, red = t > 6.2;
      if (RM && frame.done) { /* reduced motion: still noise */ } else {
        for (var i = 0; i < d.length; i += 4) { var v = Math.random() < 0.5 ? 0 : Math.random() * 150; d[i] = v * (red ? 1.3 : 1); d[i + 1] = v * (red ? 0.6 : 1); d[i + 2] = v * (red ? 0.6 : 1); d[i + 3] = 255; }
        frame.done = 1;
      }
      x.putImageData(img, 0, 0);
      if (!RM || (t * 2 | 0) % 2) for (var j = 0; j < 3; j++) { var w = words[(t * 3 + j * 2 | 0) % words.length], p = 1 + (j % 2); glyphText(x, w, (Math.sin(t * 3.1 + j * 2) * 0.4 + 0.3) * W, (j * 0.3 + 0.12) * H, p, j ? "rgba(255,255,255,.75)" : "rgba(255,40,60,.8)"); }
      var fl = RM ? (t > 3 && t < 3.3) : (t > 3 && t < 3.07 || t > 6.2 && t < 6.26);
      if (fl) { var k2 = Math.min(W / 72, H / 112) * 1.1; x.imageSmoothingEnabled = false; x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.drawImage(SEEN, (W - 72 * k2) / 2, (H - 112 * k2) / 2, 72 * k2, 112 * k2); }
      if (t > 7.2) { x.fillStyle = "rgba(0,0,0," + Math.min(0.92, (t - 7.2) * 1.5) + ")"; x.fillRect(0, 0, W, H); var pp = Math.max(2, Math.floor(W / 26)), tw = 3 * (GW + 1) * pp - pp; glyphText(x, "WHY", (W - tw) / 2 + (RM ? 0 : (Math.random() - 0.5) * 2), H / 2 - GH * pp / 2, pp, "#ff1e3c"); }
    }
    return { size: size, frame: frame, dispose: function () { c.remove(); } };
  }

  // ---- «почему»: the VCR's PLAY with nothing inside, or the empty last slot. At most once a minute; otherwise a «?» flickers.
  var WHYO = false;
  function whyGo(after, force) {
    var now = Date.now(), last = Number(lsGet(K_WHY)) || 0;
    if (WHYO || TP) return;
    if (!force && now - last < 60000 && now >= last) { qFlicker(); if (after) after(); return; }
    lsSet(K_WHY, String(now)); WHYO = true;
    tapePlay(0, function () { WHYO = false; if (after) after(); }, true);
  }
  function qFlicker() {
    var q = el("div", "e7-qf", glyphSvg("?", "e7-qfg")); q.setAttribute("aria-hidden", "true"); document.body.appendChild(q);
    setTimeout(function () { q.remove(); }, RM ? 300 : 520);
  }
  // ---- the archive: a VCR, a tray of unmarked cassettes, a shelf of numbered slots
  var ARC = null;
  function vcrSound(kind) {
    if (!SND.on) return; ac();
    if (kind === "in") { beep(1500, 0.03, "square", 0.025); setTimeout(function () { beep(70, 0.14, "square", 0.07, 42); beep(180, 0.6, "sawtooth", 0.012, 210); }, 120); }
    if (kind === "out") { beep(90, 0.1, "square", 0.05, 60); setTimeout(function () { beep(1200, 0.03, "square", 0.02); }, 90); }
    if (kind === "lit") beep(880, 0.12, "triangle", 0.03, 1320);
  }
  var PARC = null, ARCS = [], K_DIARY = "sotg.diary";
  function arcsRender() { ARCS.forEach(function (f) { f(); }); }
  // host: mount inline into a site page (the «Видеомагнитофон» section) instead of the full-screen overlay
  function archiveOpen(onClose, host) {
    var page = !!host;
    if (page ? PARC : ARC) return page ? PARC : ARC;
    finalCheck();
    var o = el("div", "e7" + (page ? " e7-page on" : "")); o.tabIndex = -1; o.setAttribute("role", page ? "region" : "dialog"); o.setAttribute("aria-label", "Записи");
    o.innerHTML = '<div class="e7-in"><div class="e7-hd"><span class="e2c e7-ttl">' + gl("RECORDS") + '</span><small>Записи</small>' +
      '<button class="e7-book" type="button" hidden aria-label="Дневник">' + bookSvg() + '<span>Дневник</span></button></div>' +
      '<div class="e7-vcr"><div class="e7-face"><span class="e7-brand e2c" aria-hidden="true">' + gl("GATE") + '</span>' +
      '<button class="e7-door" type="button" aria-label="Видеомагнитофон: вставить выбранную кассету"><i class="e7-flap"></i></button>' +
      '<div class="e7-lcd" aria-hidden="true"><span class="e7-lt">--:--</span><i class="e7-trk"></i></div>' +
      '<div class="e7-btns"><span class="e7-led" aria-hidden="true"></span><button class="e7-play" type="button" aria-label="Воспроизвести">' + glyphSvg(">", "eg") + "</button></div></div>" +
      '<div class="e7-feet" aria-hidden="true"><i></i><i></i></div></div>' +
      '<div class="e7-tray"><span class="e2c e7-lbl" aria-label="Неизвестные кассеты">' + gl("UNKNOWN") + '</span><div class="e7-cs"></div><p class="e7-hint"></p></div>' +
      '<div class="e7-shelf"></div></div>' + (page ? "" : '<button class="e7-x" type="button" aria-label="Закрыть">✕</button>');
    if (page) host.appendChild(o); else { document.body.appendChild(o); document.body.classList.add("e2-lock"); }
    var cs = o.querySelector(".e7-cs"), shelf = o.querySelector(".e7-shelf"), hint = o.querySelector(".e7-hint"), lcd = o.querySelector(".e7-lt"), vcr = o.querySelector(".e7-vcr"), door = o.querySelector(".e7-door"), book = o.querySelector(".e7-book");
    var sel = -1, busy = false, drag = null, noClick = 0, wait = 0;
    var me = { o: o, page: page };
    if (page) PARC = me; else ARC = me;
    function render(lit, born) {
      var s = tstore();
      var dOk = allTapes() || TAPES_ALL;
      if (dOk && book.hidden) { book.hidden = false; if (lsGet(K_DIARY) !== "1" && !TAPES_ALL) { lsSet(K_DIARY, "1"); book.classList.add("born"); setTimeout(function () { toast("Открыт дневник"); }, 300); } }
      cs.innerHTML = s.inv.map(function (_, i) { return '<button class="e7-c' + (i === sel ? " sel" : "") + '" type="button" data-i="' + i + '" aria-label="Кассета без подписи ' + (i + 1) + '">' + casSvg("e7-cg") + "</button>"; }).join("");
      hint.textContent = s.inv.length ? "Перетащите кассету в видеомагнитофон (или нажмите на неё, потом на магнитофон)" : "Кассет нет — они иногда выпадают в игре";
      var h = "";
      SHELF.forEach(function (id) {
        if (id === TF && !tapeHave(TF)) return;        // №∞ has no slot at all until it exists
        var TD = TAPES[id - 1], has = s.f.indexOf(id) >= 0 && wait !== id, num = id === TX ? "?" : id === T0 && !has ? "?" : tnum(id);
        h += '<button class="e7-slot' + (has ? " on" : "") + (id === TX ? " last" : "") + (id === T0 ? " first" : "") + (id === TF ? " fin" : "") + (lit === id ? " lit" : "") + (born === id ? " born" : "") + '" type="button" data-id="' + id + '" aria-label="Запись №' + (has || id === TF ? tnum(id) : "?") + (has && id !== TX ? " — " + TD.ru : " — не найдена") + '">' +
          "<b>№" + num + "</b>" + (has ? '<span class="e7-spine">' + casSvg("e7-sg") + '<span class="e2c">' + gl(id === TX ? "WHY" : TD.en) + "</span></span><small>" + esc(TD.ru) + "</small>" : '<span class="e7-q">???</span><small>???</small>') + "</button>";
      });
      shelf.innerHTML = h;
    }
    ARCS.push(render);
    render();
    book.addEventListener("click", function (e) { e.stopPropagation(); if (!busy) diaryOpen(); });
    function rectOf(e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function fly(from, to, done, after) {          // a cassette ghost flying to a target that is re-read every frame (it follows a scrolling shelf)
      var g = el("div", "e7-ghost", casSvg("e7-cg")); document.body.appendChild(g);
      var at = function () { return typeof to === "function" ? to() : to; };
      var put = function (x, y, r, sx, sy, op) { g.style.transform = "translate(" + (x - 32) + "px," + (y - 20) + "px) rotate(" + r + "deg) scale(" + sx + "," + sy + ")"; g.style.opacity = op; };
      put(from.x, from.y, -4, 1, 1, 1);
      if (RM) { var e0 = at(); put(e0.x, e0.y, 0, 1, 1, 1); setTimeout(function () { g.remove(); done(); }, 60); return g; }
      var t0 = 0, D1 = 460, D2 = after === "in" ? 260 : 0;
      requestAnimationFrame(function step(now) {
        if (!t0) t0 = now;
        var k = Math.min(1, (now - t0) / D1), e = 1 - Math.pow(1 - k, 3), b2 = at();
        if (k < 1) { put(from.x + (b2.x - from.x) * e, from.y + (b2.y - from.y) * e, -4 * (1 - e), 1, 1, 1); requestAnimationFrame(step); return; }
        var k2 = D2 ? Math.min(1, (now - t0 - D1) / D2) : 1;
        if (k2 < 1) { put(b2.x, b2.y + 14 * k2, 0, 1 - 0.08 * k2, 1 - 0.75 * k2, 1 - k2); requestAnimationFrame(step); return; }
        g.remove(); done();
      });
      return g;
    }
    function insert(from, spec) {             // spec: { inv: index } or { id }
      if (busy || TP) return; busy = true; sel = -1;
      var s = tstore(), id = spec.id || s.inv[spec.inv];
      if (spec.inv != null) { var src = cs.querySelector('[data-i="' + spec.inv + '"]'); if (src) src.style.visibility = "hidden"; }
      vcr.classList.add("open");
      fly(from, function () { return rectOf(door); }, function () {
        vcr.classList.remove("open"); vcr.classList.add("load"); vcrSound("in"); lcd.textContent = "LOAD";
        setTimeout(function () { lcd.textContent = "PLAY"; vcr.classList.add("play"); }, RM ? 100 : 650);
        setTimeout(function () {
          tapePlay(id, function () {
            var fresh = false;
            if (spec.inv != null) { var i2 = s.inv.indexOf(id); if (i2 >= 0) s.inv.splice(i2, 1); if (s.f.indexOf(id) < 0) { s.f.push(id); fresh = true; } tsave(); }
            // the slot stays empty until the cassette has flown into it (no early pop), and the rects are read after the scroll settles
            wait = fresh ? id : 0; vcr.classList.remove("play"); lcd.textContent = "EJECT"; vcrSound("out"); render();
            var slot = shelf.querySelector('[data-id="' + id + '"]'), from = rectOf(door);
            if (slot && !RM) slot.scrollIntoView({ block: "nearest", behavior: "smooth" });
            setTimeout(function () {
              fly(from, function () { var sl = shelf.querySelector('[data-id="' + id + '"]'); return sl ? rectOf(sl) : rectOf(door); }, function () {
                wait = 0; vcr.classList.remove("load"); lcd.textContent = "--:--"; render(id); vcrSound("lit"); busy = false;
                if (fresh) toast("Запись №" + tnum(id) + " — на полке");
                ARCS.forEach(function (f) { if (f !== render) f(); });
                if (fresh && finalCheck()) {           // both secrets are home: a new slot opens after «???», and its cassette lies in the tray
                  busy = true;
                  setTimeout(function () {
                    render(null, TF); busy = false; ARCS.forEach(function (f) { if (f !== render) f(); });
                    var ns = shelf.querySelector('[data-id="' + TF + '"]'); if (ns && !RM) ns.scrollIntoView({ block: "nearest", behavior: "smooth" });
                    vcrSound("lit"); toast("Появилась ещё одна запись");
                  }, RM ? 200 : 1400);
                }
              });
            }, RM ? 0 : 160);
          });
        }, RM ? 200 : 1150);
      }, "in");
    }
    function onTap(e) {
      if (Date.now() < noClick) return;
      var c = e.target.closest(".e7-c"), sl = e.target.closest(".e7-slot");
      if (c) { var i = Number(c.dataset.i); sel = sel === i ? -1 : i; render(); vcr.classList.toggle("want", sel >= 0); return; }
      if (sl) {
        var id = Number(sl.dataset.id);
        if (sl.classList.contains("on")) return insert(rectOf(sl), { id: id });
        if (id === TX) return whyGo();
        sl.classList.remove("nope"); void sl.offsetWidth; sl.classList.add("nope"); return;
      }
      if (e.target.closest(".e7-door")) { if (sel >= 0) { vcr.classList.remove("want"); insert(rectOf(cs.querySelector('[data-i="' + sel + '"]') || door), { inv: sel }); } return; }
      if (e.target.closest(".e7-play")) { if (!busy) whyGo(); return; }
      if (e.target.closest(".e7-x")) close();
    }
    o.addEventListener("click", onTap);
    // drag & drop (pointer): a cassette from the tray or a filed one from the shelf, into the VCR
    o.addEventListener("pointerdown", function (e) {
      var c = e.target.closest(".e7-c, .e7-slot.on"); if (!c || busy || e.button) return;
      drag = { el: c, x: e.clientX, y: e.clientY, id: e.pointerId, g: null };
    });
    o.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.g) { if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 10) return; drag.g = el("div", "e7-ghost drag", casSvg("e7-cg")); document.body.appendChild(drag.g); if (drag.el.classList.contains("e7-c")) drag.el.style.visibility = "hidden"; }
      e.preventDefault(); drag.g.style.transform = "translate(" + (e.clientX - 32) + "px," + (e.clientY - 30) + "px) rotate(-6deg) scale(1.1)";
      var r = vcr.getBoundingClientRect(); vcr.classList.toggle("want", e.clientX > r.left && e.clientX < r.right && e.clientY > r.top - 20 && e.clientY < r.bottom + 20);
    });
    var up = function (e) {
      if (!drag || drag.id !== e.pointerId) return; var d = drag; drag = null; if (!d.g) return;
      noClick = Date.now() + 350; var r = vcr.getBoundingClientRect(), over = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top - 20 && e.clientY < r.bottom + 20;
      vcr.classList.remove("want"); d.g.remove(); d.el.style.visibility = "";
      if (over && e.type === "pointerup") insert({ x: e.clientX, y: e.clientY - 10 }, d.el.classList.contains("e7-c") ? { inv: Number(d.el.dataset.i) } : { id: Number(d.el.dataset.id) });
    };
    o.addEventListener("pointerup", up); o.addEventListener("pointercancel", up);
    function close() {
      if ((page ? PARC : ARC) !== me || busy && !page) return;
      if (page) PARC = null; else ARC = null;
      document.removeEventListener("keydown", onKey); var ri = ARCS.indexOf(render); if (ri >= 0) ARCS.splice(ri, 1);
      if (page) { o.remove(); return; }
      if (!E2) document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 300);
      if (onClose) onClose();
    }
    me.close = close;
    var onKey = function (e) { if (!page && e.key === "Escape" && !TP && !document.querySelector(".e6.on, .e8")) close(); };
    document.addEventListener("keydown", onKey);
    if (!page) requestAnimationFrame(function () { o.classList.add("on"); o.focus({ preventScroll: true }); });
    return me;
  }
  try {
    var tq = qp("tape"), tn = tq === "x" ? TX : tq === "0" ? T0 : tq === "f" ? TF : parseInt(tq, 10);
    if (tn >= 1 && tn <= TAPES.length) setTimeout(function () { tapePlay(tn, null); }, 300);
    else if (qp("why") === "1") setTimeout(function () { whyGo(null, true); }, 300);
    else if (qp("diary") === "1") setTimeout(function () { diaryOpen(); }, 300);
  } catch (e) { /* old browser */ }
  // ---- «Дневник»: unlocked when every tape is on the shelf. Ten pages in his hand (the cipher only; no translation is shown).
  var DIARY = [
    "BEFORE DAWN A LETTER CAME FROM THE ROYAL SCIENTISTS. NO STAMP. THE NAME ON IT WOULD NOT STAY STILL. I SHOULD HAVE BURNED IT.",
    "THEY GAVE ME A RING TO BUILD. A DOOR WITH NO OTHER SIDE. YET. THE PLANS WERE ALREADY IN MY HAND WRITING.",
    "FIRST TEST. THE LIGHT CAME BACK WRONG. SOMETHING ON THE OTHER SIDE TOOK A BREATH.",
    "A SHADOW STANDS IN THE RING WHEN NO ONE LOOKS. IT DOES NOT MOVE. IT IS PATIENT.",
    "THE OTHERS STOPPED COMING. THE RADIO STILL SAYS THEIR NAMES. I ANSWER FOR THEM.",
    "I FELL AGAIN. I WOKE ON THE FLOOR AND MY HANDS HAD WRITTEN SYMBOLS I DO NOT KNOW.",
    "MY CHILD DREW THE GATE WITH A HEART INSIDE. I NEVER TOLD THEM ABOUT THE HEART.",
    "THE HEART FORMED BY ITSELF. RED. IT BEATS FASTER WHEN I AM AFRAID. IT IS HUNGRY.",
    "THE ABYSS SINGS TO ME EVERY NIGHT. EACH NIGHT THERE IS LESS OF ME TO HEAR IT. TOMORROW, ONE STEP.",
    "THE EXPERIMENT WORKED. I AM NO LONGER A MAN. I AM A VESSEL. THE SONG OF THE ABYSS EMPTIED ME, NIGHT BY NIGHT. THE LIGHTS YOU GATHER ARE NOT LIGHT. THEY ARE FEAR. I AM FED BY YOUR FEAR. THANK YOU FOR PLAYING."
  ];
  var K_FEAR = "sotg.fear";
  function sparkWord() { return lsGet(K_FEAR) === "1" ? "FEAR " : "* "; }
  function bookSvg() {
    var B = ["..########..", ".#RRRRRRRR#.", ".#RRRRRRRR#.", ".#RR####RR#.", ".#RR#..#RR#.", ".#RR####RR#.", ".#RRRRRRRR#.", ".#RRRRRRRR#.", ".#RRRRRRRR#.", ".#LLLLLLLL#.", "..########.."], C = { "#": "#cfc8b8", R: "#6a0e18", L: "#e8e0cc" }, r = "";
    B.forEach(function (row, y) { for (var i = 0; i < row.length; i++) if (C[row[i]]) r += '<rect x="' + i + '" y="' + y + '" width="1" height="1" fill="' + C[row[i]] + '"/>'; });
    return '<svg class="e7-bk" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">' + r + "</svg>";
  }
  var DIA = null;
  function diaryOpen() {
    if (DIA) return;
    var o = el("div", "e8"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Дневник");
    o.innerHTML = '<div class="e8-book"><div class="e8-page"></div><div class="e8-nav"><button class="e8-prev" type="button" aria-label="Предыдущая страница">' + glyphSvg(">", "eg") + '</button><span class="e8-no"></span>' +
      '<button class="e8-next" type="button" aria-label="Следующая страница">' + glyphSvg(">", "eg") + '</button></div></div><button class="e7-x e8-x" type="button" aria-label="Закрыть">✕</button>';
    document.body.appendChild(o); var hadLock = document.body.classList.contains("e2-lock"); document.body.classList.add("e2-lock");
    var pg = o.querySelector(".e8-page"), no = o.querySelector(".e8-no"), bk = o.querySelector(".e8-book"), i = 0, turning = false;
    DIA = { o: o };
    function fill(el2, k) { el2.innerHTML = '<p class="e8-d e2c" aria-hidden="true">' + gl(String(k + 1)) + '</p><div class="e8-t" role="img" aria-label="Запись шифром Врат">' + lineSvg(DIARY[k], "e8-g") + "</div>"; }
    function paint() {
      fill(pg, i); no.textContent = (i + 1) + " / " + DIARY.length;
      o.querySelector(".e8-prev").disabled = i === 0; o.querySelector(".e8-next").disabled = i === DIARY.length - 1;
      if (i === DIARY.length - 1) lsSet(K_FEAR, "1");
    }
    function turn(d) {
      var j = i + d; if (turning || j < 0 || j >= DIARY.length) return;
      if (RM || !pg.animate) { i = j; paint(); return; }
      turning = true;
      var leaf = el("div", "e8-page e8-leaf"); fill(leaf, i); bk.appendChild(leaf);      // the old page lifts and turns away; the next one is under it
      i = j; paint(); pageSound();
      var a = leaf.animate(d > 0 ? [{ transform: "perspective(1400px) rotateY(0deg)", filter: "brightness(1)" }, { transform: "perspective(1400px) rotateY(-100deg)", filter: "brightness(.45)", opacity: 0 }]
        : [{ transform: "perspective(1400px) rotateY(0deg)", filter: "brightness(1)" }, { transform: "perspective(1400px) rotateY(100deg)", filter: "brightness(.45)", opacity: 0 }],
        { duration: 620, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" });
      leaf.style.transformOrigin = d > 0 ? "0 50%" : "100% 50%";
      a.onfinish = function () { leaf.remove(); turning = false; };
    }
    function pageSound() { if (!SND.on) return; var a = ac(); if (!a) return; var t = a.currentTime, n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); n.buffer = noiseBuf(a); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); n.connect(f); f.connect(g); g.connect(a.destination); n.start(t); n.stop(t + 0.5); }
    paint();
    var close = function () { if (!DIA) return; DIA = null; document.removeEventListener("keydown", onKey); if (!hadLock) document.body.classList.remove("e2-lock"); o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 300); };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } if (e.key === "ArrowRight") turn(1); if (e.key === "ArrowLeft") turn(-1); };
    document.addEventListener("keydown", onKey);
    o.addEventListener("click", function (e) { if (e.target.closest(".e8-x")) return close(); if (e.target.closest(".e8-next")) return turn(1); if (e.target.closest(".e8-prev")) return turn(-1); if (!e.target.closest(".e8-book")) close(); });
    var sx = null; o.addEventListener("pointerdown", function (e) { sx = e.clientX; }); o.addEventListener("pointerup", function (e) { if (sx != null && Math.abs(e.clientX - sx) > 50) turn(e.clientX < sx ? 1 : -1); sx = null; });
    requestAnimationFrame(function () { o.classList.add("on"); o.focus({ preventScroll: true }); });
  }
  // ---- the letter: «ПИСЬМО №∞»
  var LETTER = "TO MY FAMILY. I DO NOT SLEEP ANYMORE. WHEN I DO, I DREAM OF THE GATE. A RED HEART IS BEATING INSIDE IT. IT CALLS ME BY A NAME I DO NOT REMEMBER. MY HANDS SHAKE. SOMETIMES I FALL AND WAKE UP HOURS LATER ON THE LAB FLOOR. THE OTHERS SAY I SPEAK IN SYMBOLS NOW. I THINK I AM BECOMING SOMETHING ELSE. IF I DIE, DO NOT LOOK FOR MY BODY. LOOK FOR THE LIGHT BEHIND THE GATE. - D.";
  var LTR = null;
  function letter() {
    if (LTR) return;
    lsSet(K_SEEN, "1"); lsSet(K_EYE, "1"); footMark();
    var o = el("div", "e3 e3-letter"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Письмо №∞");
    o.innerHTML = '<div class="e3-red" aria-hidden="true"></div><div class="e3-card e5-card"><p class="e3-head">ПИСЬМО №∞</p>' +
      '<div class="e3-cipher e5-text" aria-label="Письмо шифром Врат">' + lineSvg(LETTER, "e3-g e5-g") + "</div>" +
      '<p class="e3-ru">Письмо семье. Отправитель неизвестен.</p>' +
      '<p class="e3-row"><span class="e3-k">ОТ</span><span class="e3-name">██████</span></p>' +
      '<button class="e5-x" type="button" aria-label="Закрыть">✕</button></div>';
    document.body.appendChild(o); document.body.classList.add("e2-lock");
    var openedAt = performance.now();
    LTR = { o: o };
    var close = function () {
      if (!LTR) return; LTR = null; document.removeEventListener("keydown", onKey); document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 700);
    };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    o.addEventListener("click", function (e) { if (e.target.closest(".e5-x")) return close(); if (performance.now() - openedAt < 600) return; if (!e.target.closest(".e3-card")) close(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
  }
  var DOS = null;
  function seenFace(c, SN, gx, gy, t) {   // the rare dossier: his real face, pinpoint pupils that find you
    var x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 72, 112); x.drawImage(SN.c, 0, 0);
    SN.eyes.forEach(function (e) {
      var px = Math.round(e.x - 0.5 + gx * 2.2), py = Math.round(e.y - 0.5 + gy * 1.6);
      x.fillStyle = "rgba(255,30,50,.35)"; x.fillRect(px - 1, py, 3, 1); x.fillRect(px, py - 1, 1, 3);
      x.fillStyle = "#fff4f0"; x.fillRect(px, py, 1, 1);
    });
    if (Math.random() < 0.18) {   // a torn scanline
      var y0 = Math.random() * 112 | 0, h = 1 + (Math.random() * 4 | 0), sh = ((Math.random() * 7 | 0) - 3) || 2;
      x.drawImage(c, 0, y0, 72, h, sh, y0, 72, h);
    }
    if (Math.random() < 0.06) { x.fillStyle = "rgba(196,0,31,.35)"; x.fillRect(0, 0, 72, 112); }
  }
  function dossier(face) {
    if (DOS) return;
    if (face === undefined) face = cryptoBelow(1000000) === 0;   // exactly 1 opening in 1 000 000: the face is not scratched out
    lsSet(K_SEEN, "1"); footMark();
    var o = el("div", "e3" + (face ? " e3-seen" : "")); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Запись: неизвестно");
    o.innerHTML = '<canvas class="e3-noise" aria-hidden="true"></canvas><div class="e3-red" aria-hidden="true"></div>' +
      '<div class="e3-card"><p class="e3-head">ЗАПИСЬ №░░ · КОРОЛЕВСКАЯ СТРАЖА · ЛАБОРАТОРИЯ</p>' +
      '<div class="e3-body"><canvas class="e3-fig" width="72" height="112" role="img" aria-label="' + (face ? "Лицо. Оно смотрит на вас" : "Фигура в белом халате, лицо зачёркнуто") + '"></canvas>' +
      '<div class="e3-info"><p class="e3-row"><span class="e3-k">ИМЯ</span><span class="e3-name">██████</span></p>' +
      '<p class="e3-row"><span class="e3-k">СТАТУС</span><span>— не найден —</span></p>' +
      '<div class="e3-cipher" aria-label="Запись шифром Врат">' + lineSvg(LORE, "e3-g") + "</div>" +
      (face ? '<div class="e3-cipher e3-cx" aria-label="Запись шифром Врат">' + lineSvg("YOU WERE NOT SUPPOSED TO SEE ME.", "e3-g") + "</div>" : "") +
      '<p class="e3-ru">Учёный королевской стражи. Имя стёрто.</p>' + (face ? '<p class="e3-ru e3-rx">Ты не должен был этого видеть.</p>' : "") + "</div></div>" +
      '<p class="e3-foot">дело не подлежит восстановлению</p></div>';
    document.body.appendChild(o);
    var fig = o.querySelector(".e3-fig"), nm = o.querySelector(".e3-name"), noise = o.querySelector(".e3-noise"), nx = noise.getContext("2d");
    var seed = 9001, tick = 0, timer = 0, raf = 0, NAMES = ["██████", "█▓████", "██ ▒██", "▓█████", "░█▓█▒█", "██████"];
    var SN = face ? drawSeen() : null, gx = 0, gy = 0, tgx = 0, tgy = 0;
    if (face) {
      seenFace(fig, SN, 0, 0);
      o.addEventListener("pointermove", function (e) {
        var b = fig.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height * 0.28), m = Math.max(1, Math.hypot(dx, dy));
        tgx = dx / m * Math.min(1, m / 120); tgy = dy / m * Math.min(1, m / 120);
      });
    } else drawFigure(fig, seed);
    function nsize() { noise.width = Math.ceil(innerWidth / 3); noise.height = Math.ceil(innerHeight / 3); if (RM) static_(); }
    function static_() {
      var w = noise.width, h = noise.height, img = nx.createImageData(w, h), d = img.data, rr = 1.25, gg = 0.9;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() < (face ? 0.35 : 0.5) ? 0 : Math.random() * (face ? 150 : 70); if (face) { rr = 1.7; gg = 0.35; } d[i] = v * rr; d[i + 1] = v * gg; d[i + 2] = v * gg; d[i + 3] = 255; }
      nx.putImageData(img, 0, 0);
    }
    nsize(); static_();
    function frame() {
      if (!DOS) return;
      tick++;
      if (tick % (face ? 2 : 4) === 0) static_();
      if (face) {
        gx += (tgx - gx) * 0.12; gy += (tgy - gy) * 0.12;
        seenFace(fig, SN, gx, gy);
        fig.style.transform = Math.random() < 0.12 ? "translate(" + ((Math.random() * 5 | 0) - 2) + "px,0)" : "";
      } else if (tick % 7 === 0) { drawFigure(fig, seed + (Math.random() * 6 | 0)); fig.style.transform = Math.random() < 0.3 ? "translate(" + ((Math.random() * 3 | 0) - 1) + "px," + ((Math.random() * 3 | 0) - 1) + "px)" : ""; }
      if (tick % 18 === 0) nm.textContent = Math.random() < 0.7 ? NAMES[0] : NAMES[1 + (Math.random() * 4 | 0)];
      timer = setTimeout(function () { raf = requestAnimationFrame(frame); }, 1000 / 30);
    }
    DOS = { o: o };
    if (!RM) frame();
    humStart();
    var openedAt = performance.now();
    var close = function () {
      if (!DOS) return; DOS = null; clearTimeout(timer); cancelAnimationFrame(raf); humStop();
      document.removeEventListener("keydown", onKey); removeEventListener("resize", nsize);
      document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 700);
    };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    o.addEventListener("click", function (e) { if (performance.now() - openedAt < 600) return; if (!e.target.closest(".e3-card")) close(); });   // the opening tap never closes it
    document.addEventListener("keydown", onKey); addEventListener("resize", nsize);
    document.body.classList.add("e2-lock");
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
  }
  var EYE = '<svg class="e3-eg" viewBox="0 0 9 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h5v1H2zM1 1h1v1H1zM7 1h1v1H7zM0 2h1v1H0zM8 2h1v1H8zM1 3h1v1H1zM7 3h1v1H7zM2 4h5v1H2z" fill="currentColor"/><rect x="4" y="2" width="1" height="1" fill="#fff"/></svg>';
  function footMark() {
    if (lsGet(K_SEEN) !== "1") return;
    var b = document.querySelector(".e3-mark");
    if (!b) {
      var f = document.querySelector(".foot"); if (!f) return;
      b = el("button", "e3-mark", glyphSvg("?", "e3-mg")); b.type = "button"; b.setAttribute("aria-label", "Запись №░░");
      b.addEventListener("click", function () { if (b.classList.contains("e3-eye")) letter(); else dossier(); });
      f.appendChild(b);
    }
    if (lsGet(K_EYE) === "1" && !b.classList.contains("e3-eye")) { b.classList.add("e3-eye"); b.innerHTML = EYE; b.setAttribute("aria-label", "Письмо №∞"); }
  }
  footMark();
  // owner preview: ?dossier=face opens the rare dossier (his real face), ?dossier=1 the ordinary one
  try {
    var DQ = new URLSearchParams(location.search).get("dossier");
    if (DQ) setTimeout(function () { dossier(DQ === "face"); }, 400);
  } catch (e) { /* old browser */ }
  // owner preview: ?seehim=1&ft=<seconds> opens the special seed's footage frozen at that moment
  try {
    if (seeHim() && new URLSearchParams(location.search).get("ft")) setTimeout(footage, 300);
    else if (seeHim()) setTimeout(shardsOpen, 400);   // ?seehim=1 → straight into the mini-game, special seed forced
  } catch (e) { /* old browser */ }

  // ---------------------------------------------------------------- start
  api("me").then(function (r) {
    ME = r.ok ? r.user : null; GOOGLE = !!(r && r.google);
    updateNav();
    go(location.pathname, false);
  });
})();
