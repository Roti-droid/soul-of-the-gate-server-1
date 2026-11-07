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
      '<div class="e2-box"><canvas class="e2-cv" width="160" height="160"></canvas><canvas class="e2-hv" aria-hidden="true"></canvas><div class="e2-scr"></div></div>' +
      '<div class="e2-bar"><span class="e2-help e2c" aria-label="Стрелки, WASD, мышь или палец">' + gl("MOVE: ARROWS OR DRAG") + "</span></div></div>" +
      '<button class="e2-x" type="button" aria-label="Закрыть">✕</button>';
    document.body.appendChild(o);
    o.querySelector(".e2-bar").appendChild(sndBtn());
    var cv = o.querySelector(".e2-cv"), x = cv.getContext("2d"), scr = o.querySelector(".e2-scr");
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
    }
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
        '<div class="e2c e2-sub">' + gl(st.t.toFixed(1) + " - * " + st.sparks) + "</div>" + (nb ? '<div class="e2c e2-new" aria-label="Новый рекорд">' + gl("NEW BEST!") + "</div>" : "") +
        playBtn("AGAIN", "Ещё раз", "e2-go"));
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
      setG(hudSp, "s", "* " + (st ? st.sparks : 0));
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
      if ((k === " " || k === "Enter") && state !== "play" && state !== "file" && state !== "intro" && document.activeElement && !document.activeElement.closest(".e2-snd,.e2-x")) {
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
      playBtn("", "Начать", "e2-first"));
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
    var snd = ftSound(), t0 = 0, raf = 0, done = false, beatN = -1, flashed = false, burst = false, impl = null;
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
    var coatM = M({ color: 0xc9c7bf, roughness: 0.88 }), skinM = M({ color: 0xd4cfc6, roughness: 0.32, metalness: 0 }), darkM = M({ color: 0x141414, roughness: 0.8 });
    var fig = new T.Group(); fig.position.set(0.72, 0, -1.02); fig.rotation.y = Math.PI + 0.55; scene.add(fig);
    var lathe = function (pts, mat, sx, sz) { var g = new T.LatheGeometry(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), 28); g.scale(sx || 1, 1, sz || 0.72); return add(g, mat); };
    fig.add(add(new T.CylinderGeometry(0.05, 0.045, 1.0, 10), darkM, [-0.1, 0.5, 0])); fig.add(add(new T.CylinderGeometry(0.05, 0.045, 1.0, 10), darkM, [0.1, 0.5, 0]));
    fig.add(lathe([[0.001, 0.42], [0.34, 0.42], [0.3, 0.7], [0.25, 1.02], [0.001, 1.06]], coatM));
    var torso = new T.Group(); torso.position.y = 1.02; torso.rotation.x = 0.42; fig.add(torso);
    torso.add(lathe([[0.001, -0.05], [0.25, -0.04], [0.22, 0.3], [0.25, 0.68], [0.2, 0.78], [0.06, 0.82], [0.001, 0.82]], coatM));
    var neck = new T.Group(); neck.position.y = 0.8; neck.rotation.x = 0.25; torso.add(neck);
    neck.add(add(new T.CylinderGeometry(0.04, 0.05, 0.26, 10), skinM, [0, 0.12, 0]));
    var head = add(new T.SphereGeometry(1, 32, 24), skinM, [0, 0.42, 0.02]); head.scale.set(0.12, 0.19, 0.14); neck.add(head);
    var arms = [-1, 1].map(function (sd) {
      var sh = new T.Group(); sh.position.set(sd * 0.25, 0.72, 0); torso.add(sh);
      sh.add(add(new T.CapsuleGeometry(0.05, 0.42, 4, 10), coatM, [0, -0.25, 0]));
      var el2 = new T.Group(); el2.position.y = -0.5; sh.add(el2);
      el2.add(add(new T.CapsuleGeometry(0.042, 0.4, 4, 10), coatM, [0, -0.23, 0]));
      var hand = new T.Group(); hand.position.y = -0.47; el2.add(hand);
      hand.add(add(new T.BoxGeometry(0.06, 0.09, 0.025), skinM, [0, -0.04, 0]));
      var fingers = [];
      for (var f = 0; f < 4; f++) { var fg = new T.Group(); fg.position.set(-0.024 + f * 0.016, -0.085, 0); fg.add(add(new T.CapsuleGeometry(0.006, 0.1 - Math.abs(f - 1.5) * 0.012, 2, 5), skinM, [0, -0.055, 0])); hand.add(fg); fingers.push(fg); }
      return { sh: sh, el: el2, hand: hand, f: fingers, sd: sd };
    });
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
      arms.forEach(function (a, k) {
        var ph = t * (3.1 + k * 0.7) + k * 2;
        a.sh.rotation.x = -0.95 + Math.sin(ph * 0.5) * 0.08 * still; a.sh.rotation.z = a.sd * 0.12;
        a.el.rotation.x = -0.75 + Math.sin(ph) * 0.18 * still + (Math.sin(t * 13 + k) > 0.92 ? 0.12 : 0) * still;
        a.hand.rotation.x = -0.3 + Math.sin(ph * 1.7) * 0.25 * still; a.hand.rotation.z = Math.sin(ph * 0.9) * 0.3 * still;
        a.f.forEach(function (fg, j) { fg.rotation.x = 0.4 + Math.sin(t * 9 + j * 1.3 + k) * 0.6 * still; });
      });
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
    function nsize() { noise.width = Math.ceil(innerWidth / 3); noise.height = Math.ceil(innerHeight / 3); if (RM) static_(); }
    function static_() {
      var w = noise.width, h = noise.height, img = nx.createImageData(w, h), d = img.data, rr = 1.25, gg = 0.9;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() < 0.5 ? 0 : Math.random() * 70; d[i] = v * rr; d[i + 1] = v * gg; d[i + 2] = v * gg; d[i + 3] = 255; }
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
  // owner preview: ?seehim=1&ft=<seconds> opens the special seed's footage frozen at that moment
  try { if (seeHim() && new URLSearchParams(location.search).get("ft")) setTimeout(footage, 300); } catch (e) { /* old browser */ }

  // ---------------------------------------------------------------- start
  api("me").then(function (r) {
    ME = r.ok ? r.user : null; GOOGLE = !!(r && r.google);
    updateNav();
    go(location.pathname, false);
  });
})();
