#!/usr/bin/env python3
"""Build the web release of «Кристальный забег» for the Cloudflare Worker.

    python3 build_web.py path/to/game.html [--base-url https://crystal-run-server.ken729710.workers.dev]

Produces public/index.html (game + injected web/Telegram snippets), public/manifest.json,
public/icon-192.png, icon-512.png, apple-touch-icon.png, favicon.png, favicon.ico and
public/og-image.png (kept if it already exists; regenerate with --og to re-render).
The game source is never edited: everything is injected into the copy.
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "public")
THEME = "#120c2a"
TITLE = "Кристальный забег"
DESC = "Неоновый 3D-раннер: собирай кристаллы, уворачивайся от препятствий и соревнуйся онлайн. Играй прямо в браузере или в Telegram."

HEAD_SNIPPET = r"""
<!-- web-release: injected by build_web.py -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="{title}">
<meta name="description" content="{desc}">
<link rel="manifest" href="manifest.json">
<link rel="icon" type="image/png" sizes="32x32" href="favicon.png">
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{base}/">
<meta property="og:image" content="{base}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script>
/* Telegram Mini App: load the SDK only when opened inside Telegram; silent everywhere else */
(function () {{
  try {{
    var h = String(location.hash) + String(location.search), inTg = false;
    if (/tgWebApp(Data|Version|Platform)=/.test(h) || window.TelegramWebviewProxy || /Telegram/i.test(navigator.userAgent)) inTg = true;
    try {{ if (sessionStorage.getItem('__telegram__initParams')) inTg = true; }} catch (e) {{}}
    if (!inTg || !/^https?:$/.test(location.protocol)) return;
    try {{  // first_name from launch params (hash or SDK's sessionStorage copy) -> default player name
      var lp = String(location.hash).replace(/^#/, '');
      if (!/tgWebAppData=/.test(lp)) {{ try {{ lp = JSON.parse(sessionStorage.getItem('__telegram__initParams') || '{{}}'); lp = lp && lp.tgWebAppData ? 'tgWebAppData=' + encodeURIComponent(lp.tgWebAppData) : ''; }} catch (e) {{ lp = ''; }} }}
      var m = /(?:^|&)tgWebAppData=([^&]*)/.exec(lp);
      if (m) {{
        var um = /(?:^|&)user=([^&]*)/.exec(decodeURIComponent(m[1]));
        var fu = um && JSON.parse(decodeURIComponent(um[1]));
        var fn = fu && fu.first_name && String(fu.first_name).replace(/\s+/g, ' ').trim().slice(0, 16);
        if (fn) window.__crTgName = fn;
      }}
    }} catch (e) {{}}
    var done = false, s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js'; s.async = true;
    var to = setTimeout(function () {{ done = true; }}, 6000);
    s.onerror = function () {{ done = true; clearTimeout(to); }};
    s.onload = function () {{
      if (done) return; done = true; clearTimeout(to);
      var go = function () {{
        try {{
          var tg = window.Telegram && window.Telegram.WebApp;
          if (!tg || !tg.initData) return;
          var at = function (v) {{ return tg.isVersionAtLeast && tg.isVersionAtLeast(v); }};
          tg.ready(); tg.expand();
          if (at('7.7') && tg.disableVerticalSwipes) tg.disableVerticalSwipes();
          if (at('6.1')) {{ tg.setHeaderColor('{theme}'); tg.setBackgroundColor('{theme}'); }}
          if (at('7.10') && tg.setBottomBarColor) tg.setBottomBarColor('{theme}');
          var u = tg.initDataUnsafe && tg.initDataUnsafe.user, f = u && u.first_name;
          var inp = document.getElementById('inName');
          if (f && inp && !inp.value) {{  // game saves this field on connect
            f = String(f).replace(/\s+/g, ' ').trim().slice(0, 16);
            if (f) inp.value = f;
          }}
        }} catch (e) {{}}
      }};
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    }};
    document.head.appendChild(s);
  }} catch (e) {{}}
}})();
</script>
<script>
/* web-release (1): before the game reads its save, point the online server at this host
   (wss:// on https, ws:// on http) unless the player chose another server. file:// / APK: untouched. */
(function () {{
  try {{
    if (!/^https?:$/.test(location.protocol) || !location.host) return;
    var KEY = 'crystalRun.save.v2', fixed = {fixed};
    var def = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    var isDefault = function (v) {{
      return !v || fixed.indexOf(v) >= 0 || /^wss:\/\/crystal-run-server\.[a-z0-9-]+\.workers\.dev\/?$/i.test(v);
    }};
    var raw = localStorage.getItem(KEY), sv = null;
    try {{ sv = raw ? JSON.parse(raw) : {{}}; }} catch (e) {{ sv = null; }}
    if (!sv || typeof sv !== 'object') return;
    var changed = false;
    if (isDefault(sv.server) && sv.server !== def) {{ sv.server = def; changed = true; }}
    var tgName = window.__crTgName;
    if (tgName && !sv.name) {{ sv.name = tgName; changed = true; }}
    if (changed) localStorage.setItem(KEY, JSON.stringify(sv));
  }} catch (e) {{}}
}})();
</script>
"""



def inject(html, base):
    fixed = sorted(set(re.findall(r"SAVE\.server\s*=\s*'(wss?://[^']+)'", html))
                   | {"wss://crystal-run-server.ken729710.workers.dev", "ws://localhost:8765"})
    head = HEAD_SNIPPET.format(title=TITLE, desc=DESC, base=base.rstrip("/"), theme=THEME, fixed=json.dumps(fixed))
    if 'name="theme-color"' not in html:
        head = '<meta name="theme-color" content="%s">' % THEME + head
    m = re.search(r"<meta\s+charset=[^>]*>", html[:4096], re.I) or re.search(r"<head[^>]*>", html, re.I)
    if not m:
        raise SystemExit("no <head> in game html")
    html = html[:m.end()] + head + html[m.end():]
    return html


def crystal(size):
    from PIL import Image, ImageDraw, ImageFilter
    S = size * 4
    img = Image.new("RGBA", (S, S), THEME)
    bg = ImageDraw.Draw(img)
    for r in range(S // 2, 0, -max(1, S // 128)):  # radial violet glow
        t = r / (S / 2)
        c = (int(18 + 70 * (1 - t)), int(12 + 20 * (1 - t)), int(42 + 120 * (1 - t)), 255)
        bg.ellipse([S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r], fill=c)
    cx, cy = S / 2, S / 2
    w, top, mid, bot = S * 0.30, S * 0.16, S * 0.40, S * 0.86
    pts = [(cx, top), (cx + w, mid), (cx, bot), (cx - w, mid)]
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(pts, fill=(80, 230, 255, 200))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.06))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    facets = [
        ([(cx, top), (cx + w, mid), (cx, mid)], (170, 250, 255)),
        ([(cx, top), (cx, mid), (cx - w, mid)], (110, 220, 255)),
        ([(cx - w, mid), (cx, mid), (cx, bot)], (70, 140, 255)),
        ([(cx, mid), (cx + w, mid), (cx, bot)], (150, 90, 255)),
    ]
    for poly, col in facets:
        d.polygon(poly, fill=col)
    lw = max(2, S // 90)
    d.line(pts + [pts[0]], fill=(235, 255, 255), width=lw, joint="curve")
    d.line([(cx - w, mid), (cx + w, mid)], fill=(235, 255, 255), width=lw)
    d.line([(cx, top), (cx, bot)], fill=(220, 250, 255), width=max(1, lw // 2))
    sp = S * 0.05  # sparkle
    sx, sy = cx + w * 0.75, top + S * 0.06
    d.polygon([(sx, sy - sp), (sx + sp * 0.25, sy), (sx, sy + sp), (sx - sp * 0.25, sy)], fill="white")
    d.polygon([(sx - sp, sy), (sx, sy - sp * 0.25), (sx + sp, sy), (sx, sy + sp * 0.25)], fill="white")
    return img.resize((size, size), Image.LANCZOS)


def og_fallback(path):
    """Pillow-only preview (used when there is no Playwright screenshot)."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (1200, 630), THEME)
    d = ImageDraw.Draw(img)
    for y in range(630):
        t = y / 630
        d.line([(0, y), (1200, y)], fill=(int(18 + 40 * t), int(12 + 4 * t), int(42 + 60 * t)))
    c = crystal(420).convert("RGB")
    img.paste(c, (720, 105))
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    f1, f2 = ImageFont.truetype(font, 84), ImageFont.truetype(font, 34)
    d.text((70, 190), "Кристальный", font=f1, fill=(170, 250, 255))
    d.text((70, 290), "забег", font=f1, fill=(255, 122, 224))
    d.text((74, 420), "Неоновый 3D-раннер · онлайн", font=f2, fill=(220, 220, 255))
    img.save(path, optimize=True)


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    base = "https://crystal-run-server.ken729710.workers.dev"
    if "--base-url" in args:
        i = args.index("--base-url"); base = args[i + 1]; del args[i:i + 2]
    force_og = "--og" in args
    args = [a for a in args if a != "--og"]
    src = args[0]
    os.makedirs(PUB, exist_ok=True)
    with open(src, encoding="utf-8") as f:
        html = f.read()
    if "web-release: injected" in html:
        raise SystemExit("input already contains the web injection — pass the original game html")
    out = inject(html, base)
    with open(os.path.join(PUB, "index.html"), "w", encoding="utf-8") as f:
        f.write(out)
    for n, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png"), (32, "favicon.png")):
        crystal(n).convert("RGB").save(os.path.join(PUB, name), optimize=True)
    crystal(64).save(os.path.join(PUB, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    manifest = {
        "name": TITLE, "short_name": TITLE, "description": DESC, "lang": "ru",
        "start_url": "./play", "scope": "./", "display": "fullscreen", "orientation": "portrait",
        "background_color": THEME, "theme_color": THEME,
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    with open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    og = os.path.join(PUB, "og-image.png")
    if force_og or not os.path.exists(og):
        shot = os.path.join(HERE, "og_shot.cjs")
        ok = False
        if os.path.exists(shot):
            import subprocess
            r = subprocess.run(["node", shot, os.path.abspath(src), og], cwd=HERE)
            ok = r.returncode == 0 and os.path.exists(og)
        if not ok:
            og_fallback(og)
    print("built", os.path.join(PUB, "index.html"), "(%d bytes) from %s" % (len(out.encode()), src))


if __name__ == "__main__":
    main()
