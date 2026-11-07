/* Soul of the Gate — official site: client routing, chapters, downloads, news, sign-in, developer cabinet. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PAGES = { "/": "home", "/chapters": "chapters", "/download": "download", "/news": "news", "/login": "login", "/account": "account", "/dev": "dev" };
  var TITLES = { home: "Soul of the Gate — Душа Врат", chapters: "Главы · Soul of the Gate", download: "Скачать · Soul of the Gate",
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
    var page = PAGES[path.replace(/\/+$/, "") || "/"] || "home";
    if (push) history.pushState({}, "", path);
    var next = document.querySelector('.page[data-page="' + page + '"]');
    var prev = cur && cur !== next ? cur : null;
    var show = function () {
      document.querySelectorAll(".page").forEach(function (p) { p.hidden = p !== next; p.classList.remove("leaving"); });
      next.style.animation = "none"; void next.offsetWidth; next.style.animation = "";
      cur = next; document.title = TITLES[page];
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
    if (page === "download") loadFiles().then(renderFiles);
    if (page === "news") loadNews().then(function () { renderNews($("news"), 99); });
    if (page === "login") renderLogin();
    if (page === "account") renderAccount();
    if (page === "dev") renderDev();
  }

  // ---------------------------------------------------------------- chapters (1 is out; 2–10 are locked: never shown as released)
  function renderChapters(box, mini) {
    var h = "";
    for (var i = 1; i <= 10; i++) {
      var n = "ГЛАВА " + (i < 10 ? "0" + i : i);
      if (i === 1) {
        h += '<a class="ch open reveal" href="/download" data-link><span class="num">' + n + '</span><img src="/site/img/gate.svg" alt="">' +
          '<span class="name">Soul of the Gate — Chapter&nbsp;1</span><span class="st">ДОСТУПНА</span></a>';
      } else {
        h += '<div class="ch locked reveal" aria-label="Глава ' + i + ': скоро"><span class="num">' + n + '</span><img src="/site/img/locked.svg" alt="">' +
          '<span class="name">???</span><span class="st">СКОРО</span></div>';
      }
      if (mini && i === 6) break;
    }
    box.innerHTML = h;
    reveal();
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
    FILES.forEach(function (f) {
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
    loadDevFiles();
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
    for (var c = 65; c <= 90; c++) {
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
      seen[g.join("")] = 1; out[String.fromCharCode(c)] = g;
    }
    return out;
  })();
  // extra signs of the same hand: a full stop and the unknown
  GLYPH["."] = [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0];
  GLYPH["?"] = [0,1,1,1,0, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,1,0,0];
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

  // ---- tiny WebAudio beeper (muted by default)
  var SND = { on: lsGet(K_SND) === "1", ac: null, hum: null };
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
  function sndBtn() {
    var b = el("button", "e2-snd"); b.type = "button";
    var paint = function () { b.textContent = SND.on ? "♪ звук: вкл" : "♪ звук: выкл"; b.setAttribute("aria-pressed", SND.on ? "true" : "false"); };
    paint();
    b.addEventListener("click", function (e) { e.stopPropagation(); SND.on = !SND.on; lsSet(K_SND, SND.on ? "1" : "0"); paint(); if (SND.on) { ac(); beep(660, 0.08); } else humStop(); });
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

  // ---- the mini-game
  var E2 = null;
  function shardsOpen() {
    if (E2) return;
    var o = el("div", "e2"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Осколки Врат");
    o.innerHTML = '<div class="e2-wrap"><div class="e2-hud"><span class="e2-t">0,0 с</span><span class="e2-hp"></span><span class="e2-sp">✦ 0</span><span class="e2-best"></span></div>' +
      '<div class="e2-box"><canvas class="e2-cv" width="160" height="160"></canvas><div class="e2-scr"></div></div>' +
      '<div class="e2-bar"><span class="e2-help">стрелки / WASD · мышь · тяни пальцем</span></div></div>' +
      '<button class="e2-x" type="button" aria-label="Закрыть">✕</button>';
    document.body.appendChild(o);
    o.querySelector(".e2-bar").appendChild(sndBtn());
    var cv = o.querySelector(".e2-cv"), x = cv.getContext("2d"), scr = o.querySelector(".e2-scr");
    var hudT = o.querySelector(".e2-t"), hudHp = o.querySelector(".e2-hp"), hudSp = o.querySelector(".e2-sp"), hudB = o.querySelector(".e2-best");
    var F = 160, S = 2, ROUND = 40, sp = sprites();
    var st = null, raf = 0, last = 0, keys = {}, ptr = null, mouse = null, state = "menu";
    var best = Number(lsGet(K_BEST)) || 0;
    E2 = { o: o, close: close };

    function fit() {
      var aw = Math.min(innerWidth - 32, 560), ah = innerHeight - 190;
      S = Math.max(1, Math.floor(Math.min(aw, ah) / F));
      cv.width = cv.height = F * S; cv.style.width = cv.style.height = F * S + "px";
      x.imageSmoothingEnabled = false;
      if (state !== "play") draw(0);
    }
    function paintBest() { hudB.textContent = "рекорд " + best.toFixed(1).replace(".", ","); }
    function reset() {
      st = { t: 0, hp: 3, inv: 0, sparks: 0, hx: F / 2, hy: F * 0.72, sh: [], fx: [], spk: [], next: 0.4, nextSpk: 1.2, shake: 0,
        qAt: Math.random() < 1 / 8 ? 6 + Math.random() * 14 : -1, qDone: false, q: null };
    }
    function menu(html) { scr.innerHTML = html; scr.classList.add("on"); }
    function start() {
      reset(); state = "play"; scr.classList.remove("on"); scr.innerHTML = ""; beep(330, 0.09, "square", 0.05, 660);
      last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    }
    function score() { return st.t + st.sparks * 0.5; }
    function end(win) {
      state = "over"; cancelAnimationFrame(raf);
      var sc = score(), nb = sc > best + 1e-9;
      if (nb) { best = sc; lsSet(K_BEST, best.toFixed(2)); paintBest(); }
      beep(win ? 880 : 140, win ? 0.3 : 0.4, win ? "triangle" : "sawtooth", 0.05, win ? 1320 : 60);
      menu('<p class="e2-ttl">' + (win ? "ВРАТА ЗАТИХЛИ" : "ДУША ДРОГНУЛА") + "</p>" +
        '<p class="e2-big">' + sc.toFixed(1).replace(".", ",") + "</p>" +
        '<p class="e2-sub">' + st.t.toFixed(1).replace(".", ",") + " с · ✦ " + st.sparks + (nb ? ' · <b class="e2-new">новый рекорд</b>' : "") + "</p>" +
        '<button class="btn e2-go" type="button">ещё раз</button>');
      scr.querySelector(".e2-go").focus();
    }
    function sealed() {
      state = "file"; cancelAnimationFrame(raf); beep(98, 0.9, "sawtooth", 0.05, 49);
      if (score() > best) { best = score(); lsSet(K_BEST, best.toFixed(2)); paintBest(); }
      o.classList.add("e2-dim");
      menu('<div class="e2-file"><p class="e2-fnum">ЗАПИСЬ №░░ — НЕИЗВЕСТНО</p>' +
        '<button class="e2-q" type="button" aria-label="Вскрыть запись">' + glyphSvg("?", "e2-qg") + "</button>" +
        '<p class="e2-stamp">ЗАПЕЧАТАНО</p><p class="e2-sub">коснись, чтобы вскрыть</p></div>');
      var q = scr.querySelector(".e2-q"); q.focus();
      q.addEventListener("click", function (e) { e.stopPropagation(); close(true); dossier(); });
    }
    scr.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".e2-go"); if (b) { e.stopPropagation(); start(); }
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
      st.sh.push(s);
      if (t > 24 && Math.random() < 0.14) {          // a short rain line
        var gap = Math.floor(Math.random() * 5);
        for (var i = 0; i < 8; i++) if (Math.abs(i - gap) > 0) st.sh.push({ x: i * 20 + 7, y: -GH - i * 3, vx: 0, vy: 52 + k * 30, w: GW, h: GH, sz: 1, g: Math.floor(Math.random() * 26), flip: 0 });
      }
      st.next = Math.max(0.1, 0.42 - k * 0.32) * (0.7 + Math.random() * 0.6);
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
      if (!st.qDone && !st.q && ((st.qAt > 0 && st.t >= st.qAt) || st.t >= 30)) {
        st.qDone = true; var fromL = Math.random() < 0.5;
        st.q = { x: fromL ? 8 : F - 8 - GW * 2, y: -GH * 2, w: GW * 2, h: GH * 2, vx: fromL ? 9 : -9, vy: 16, ph: 0 };
        beep(233, 0.5, "sawtooth", 0.035, 117);
      }
      if (st.q) {
        var q = st.q; q.ph += dt; q.x += (q.vx + Math.sin(q.ph * 2.3) * 22) * dt; q.y += q.vy * dt;
        if (q.y > F + 4) st.q = null;
        else if (hit(pb, q)) { st.q = null; burst(st.hx, st.hy, "#ffffff", 16); return sealed(); }
      }
      for (i = st.fx.length - 1; i >= 0; i--) { var f = st.fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; f.l -= dt; if (f.l <= 0) st.fx.splice(i, 1); }
      if (st.t >= ROUND) { st.t = ROUND; paintHud(); return end(true); }
    }
    function px(cx, cy, c) { x.fillStyle = c; x.fillRect(Math.round(cx * S), Math.round(cy * S), S, S); }
    function draw(now) {
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#050505"; x.fillRect(0, 0, cv.width, cv.height);
      var ox = 0, oy = 0;
      if (st && st.shake > 0) { ox = Math.round((Math.random() - 0.5) * 4) * S; oy = Math.round((Math.random() - 0.5) * 4) * S; }
      x.setTransform(1, 0, 0, 1, ox, oy);
      // faint floor grid
      x.fillStyle = "#101010";
      for (var gy = 8; gy < F; gy += 16) for (var gx = 8; gx < F; gx += 16) x.fillRect(gx * S, gy * S, S, S);
      if (!st) return;
      var t = now / 1000, i;
      for (i = 0; i < st.spk.length; i++) {
        var p = st.spk[i], tw = (Math.sin(t * 9 + i) > 0) || p.l > 1.2 ? 1 : 0; if (p.l < 1.2 && !tw) continue;
        var c = "#ffe14a"; px(p.x, p.y, "#fff7c2"); px(p.x - 1, p.y, c); px(p.x + 1, p.y, c); px(p.x, p.y - 1, c); px(p.x, p.y + 1, c);
        if (Math.sin(t * 6 + i * 2) > 0.3) { px(p.x - 2, p.y, c); px(p.x + 2, p.y, c); px(p.x, p.y - 2, c); px(p.x, p.y + 2, c); }
      }
      for (i = 0; i < st.sh.length; i++) {
        var s = st.sh[i], img = (s.red ? sp.r : sp.w)[s.g];
        x.drawImage(img, Math.round(s.x * S), Math.round(s.y * S), s.w * S, s.h * S);
      }
      if (st.q) {
        var q = st.q, qx = Math.round(q.x * S), qy = Math.round(q.y * S), qw = q.w * S, qh = q.h * S, j = RM ? 0 : S;
        if (!RM && Math.random() < 0.5) { x.globalAlpha = 0.8; x.drawImage(sp.qr, qx - j, qy, qw, qh); x.drawImage(sp.qc, qx + j, qy + (Math.random() < 0.3 ? j : 0), qw, qh); x.globalAlpha = 1; }
        if (RM || Math.random() > 0.08) x.drawImage(sp.q, qx, qy, qw, qh);
        if (!RM) for (i = 0; i < 4; i++) px(q.x - 2 + Math.random() * (q.w + 4), q.y - 2 + Math.random() * (q.h + 4), Math.random() < 0.5 ? "#ff1e3c" : "#fff");
      }
      for (i = 0; i < st.fx.length; i++) { var f = st.fx[i]; x.globalAlpha = Math.min(1, f.l * 3); px(f.x, f.y, f.c); }
      x.globalAlpha = 1;
      // the soul
      if (!(st.inv > 0 && Math.floor(st.inv * 12) % 2)) {
        var hx = Math.round(st.hx) - 3, hy = Math.round(st.hy) - 3;
        x.shadowColor = "rgba(255,255,255,.7)"; x.shadowBlur = 6 * S;
        for (var r = 0; r < HEART.length; r++) for (var cc = 0; cc < 7; cc++) if (HEART[r][cc] === "#") px(hx + cc, hy + r, "#fff");
        x.shadowBlur = 0;
      }
      // time bar
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#222"; x.fillRect(0, cv.height - S, cv.width, S);
      x.fillStyle = "#fff"; x.fillRect(0, cv.height - S, Math.round(cv.width * st.t / ROUND), S);
    }
    function paintHud() {
      hudT.textContent = st.t.toFixed(1).replace(".", ",") + " с";
      hudHp.innerHTML = [0, 1, 2].map(function (i) { return '<i class="' + (i < st.hp ? "on" : "") + '"></i>'; }).join("");
      hudSp.textContent = "✦ " + st.sparks;
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
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (/^(Arrow|w$|a$|s$|d$)/.test(k)) { keys[k] = 1; mouse = null; e.preventDefault(); }
      if ((k === " " || k === "Enter") && state !== "play" && state !== "file" && document.activeElement && !document.activeElement.closest(".e2-snd,.e2-x")) { e.preventDefault(); start(); }
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
    function onVis() { if (document.hidden && state === "play") { state = "pause"; menu('<p class="e2-ttl">ПАУЗА</p><button class="btn e2-res" type="button">дальше</button>'); } }
    scr.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".e2-res")) { e.stopPropagation(); state = "play"; scr.classList.remove("on"); scr.innerHTML = ""; last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    o.querySelector(".e2-x").addEventListener("click", function () { close(); });
    document.addEventListener("keydown", onKey); document.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", onVis); addEventListener("resize", fit);
    document.body.classList.add("e2-lock");

    function close(quick) {
      if (!E2) return; E2 = null; state = "closed"; cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey); document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", fit);
      document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, quick || RM ? 0 : 300);
    }
    paintBest(); fit();
    menu('<p class="e2-ttl">ОСКОЛКИ ВРАТ</p><p class="e2-sub">уклоняйся от осколков шифра<br>собирай искры света ✦</p><button class="btn e2-go" type="button">начать</button>');
    requestAnimationFrame(function () { o.classList.add("on"); var b = scr.querySelector(".e2-go"); if (b) b.focus(); else o.focus(); });
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
  var DOS = null;
  function dossier() {
    if (DOS) return;
    lsSet(K_SEEN, "1"); footMark();
    var o = el("div", "e3"); o.tabIndex = -1; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Запись: неизвестно");
    o.innerHTML = '<canvas class="e3-noise" aria-hidden="true"></canvas><div class="e3-red" aria-hidden="true"></div>' +
      '<div class="e3-card"><p class="e3-head">ЗАПИСЬ №░░ · КОРОЛЕВСКАЯ СТРАЖА · ЛАБОРАТОРИЯ</p>' +
      '<div class="e3-body"><canvas class="e3-fig" width="72" height="112" role="img" aria-label="Фигура в белом халате, лицо зачёркнуто"></canvas>' +
      '<div class="e3-info"><p class="e3-row"><span class="e3-k">ИМЯ</span><span class="e3-name">██████</span></p>' +
      '<p class="e3-row"><span class="e3-k">СТАТУС</span><span>— не найден —</span></p>' +
      '<div class="e3-cipher" aria-label="Запись шифром Врат">' + lineSvg(LORE, "e3-g") + "</div>" +
      '<p class="e3-ru">Учёный королевской стражи. Имя стёрто.</p></div></div>' +
      '<p class="e3-foot">дело не подлежит восстановлению</p></div>';
    document.body.appendChild(o);
    var fig = o.querySelector(".e3-fig"), nm = o.querySelector(".e3-name"), noise = o.querySelector(".e3-noise"), nx = noise.getContext("2d");
    var seed = 9001, tick = 0, timer = 0, raf = 0, NAMES = ["██████", "█▓████", "██ ▒██", "▓█████", "░█▓█▒█", "██████"];
    drawFigure(fig, seed);
    function nsize() { noise.width = Math.ceil(innerWidth / 3); noise.height = Math.ceil(innerHeight / 3); }
    function static_() {
      var w = noise.width, h = noise.height, img = nx.createImageData(w, h), d = img.data;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() < 0.5 ? 0 : Math.random() * 70; d[i] = v * 1.25; d[i + 1] = v * 0.9; d[i + 2] = v * 0.9; d[i + 3] = 255; }
      nx.putImageData(img, 0, 0);
    }
    nsize(); static_();
    function frame() {
      if (!DOS) return;
      tick++;
      if (tick % 4 === 0) static_();
      if (tick % 7 === 0) { drawFigure(fig, seed + (Math.random() * 6 | 0)); fig.style.transform = Math.random() < 0.3 ? "translate(" + ((Math.random() * 3 | 0) - 1) + "px," + ((Math.random() * 3 | 0) - 1) + "px)" : ""; }
      if (tick % 18 === 0) nm.textContent = Math.random() < 0.7 ? NAMES[0] : NAMES[1 + (Math.random() * 4 | 0)];
      timer = setTimeout(function () { raf = requestAnimationFrame(frame); }, 1000 / 30);
    }
    DOS = { o: o };
    if (!RM) frame();
    humStart();
    var close = function () {
      if (!DOS) return; DOS = null; clearTimeout(timer); cancelAnimationFrame(raf); humStop();
      document.removeEventListener("keydown", onKey); removeEventListener("resize", nsize);
      document.body.classList.remove("e2-lock");
      o.classList.remove("on"); setTimeout(function () { o.remove(); }, RM ? 0 : 700);
    };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    o.addEventListener("click", function (e) { if (!e.target.closest(".e3-card")) close(); });
    document.addEventListener("keydown", onKey); addEventListener("resize", nsize);
    document.body.classList.add("e2-lock");
    requestAnimationFrame(function () { o.classList.add("on"); o.focus(); });
  }
  function footMark() {
    if (lsGet(K_SEEN) !== "1" || document.querySelector(".e3-mark")) return;
    var f = document.querySelector(".foot"); if (!f) return;
    var b = el("button", "e3-mark", glyphSvg("?", "e3-mg")); b.type = "button"; b.setAttribute("aria-label", "Запись №░░");
    b.addEventListener("click", dossier);
    f.appendChild(b);
  }
  footMark();

  // ---------------------------------------------------------------- start
  api("me").then(function (r) {
    ME = r.ok ? r.user : null; GOOGLE = !!(r && r.google);
    updateNav();
    go(location.pathname, false);
  });
})();
