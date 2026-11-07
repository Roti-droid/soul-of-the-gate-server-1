// node og_shot.cjs <game.html> <out.png> — renders a 1200x630 Open Graph preview from the real game
// (needs Playwright; used by build_web.py at build time, not needed for deploy)
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const [src, out] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5 });
  await p.goto('file://' + path.resolve(src));
  await p.waitForTimeout(2500);
  await p.click('#bPlay').catch(() => {});
  await p.waitForTimeout(3500);
  const shot = (await p.screenshot()).toString('base64');
  const card = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<html><body style="margin:0;width:1200px;height:630px;overflow:hidden;font-family:DejaVu Sans,sans-serif;
    background:radial-gradient(circle at 75% 50%,#3b1f86 0%,#120c2a 60%);color:#fff;display:flex;align-items:center">
    <div style="flex:1;padding-left:80px">
      <div style="font-size:84px;font-weight:800;line-height:1;color:#aaf6ff;text-shadow:0 0 24px #4de8ff">Кристальный</div>
      <div style="font-size:84px;font-weight:800;line-height:1.1;color:#ff7ae0;text-shadow:0 0 24px #ff4fd8">забег</div>
      <div style="font-size:32px;margin-top:34px;opacity:.9">Неоновый 3D-раннер · онлайн</div>
      <div style="font-size:26px;margin-top:14px;opacity:.7">Играй в браузере или в Telegram</div>
    </div>
    <img src="data:image/png;base64,${shot}" style="height:590px;margin-right:90px;border-radius:34px;border:4px solid #7fe9ff;box-shadow:0 0 50px #4de8ff88">
  </body></html>`);
  await card.screenshot({ path: out });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
