// Screenshots of the app through headless Chromium on Metal, one fresh page per shot.
//   node look.mjs <target> <shots> [outDir]
// target: a URL (http://localhost:5198, a published page) or a build name made by build-at.sh.
// shots: "views" (every view of $VIEWSFILE, the meadow's by default; VIEWS="a,b" picks some), a JSON file, or
//   inline JSON: [{ name, hash?, preset?, pose?, tilt?, fov?, turn?, w?, h?, dpr?, t?, wait?, js? }]
//   hash is added to the base hash; js is evaluated in the page after the view settles and its result printed.
// env: DPR (1), W (1600), H (1000), Q (tier, high), T (frozen time, 12; T=live leaves time running),
//      UI=1 keeps the interface on (hidden by default), HUD=1 shows the perf HUD.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyView, launch, loadViews, openPage } from './lib.mjs';

const [target, spec, out = '.'] = process.argv.slice(2);
if (!target || !spec) {
  console.error('usage: node look.mjs <target> <views | shots.json | inline JSON> [outDir]');
  process.exit(2);
}
const shots = spec === 'views' ? loadViews() : JSON.parse(existsSync(spec) ? readFileSync(spec, 'utf8') : spec);
mkdirSync(out, { recursive: true });
const env = process.env;
const browser = await launch();
for (const s of shots) {
  const file = join(out, `${s.name.replace(/[^a-z0-9.-]+/gi, '_')}.png`);
  const t = s.t ?? env.T ?? 12;
  const hash = [`hud=${env.HUD === '1' ? 1 : 0}`, `q=${env.Q ?? 'high'}`, t === 'live' ? '' : `t=${t}`, s.hash ?? ''].filter(Boolean).join('&');
  let opened;
  try {
    opened = await openPage(browser, target, { hash, width: s.w ?? Number(env.W ?? 1600), height: s.h ?? Number(env.H ?? 1000), dpr: s.dpr ?? Number(env.DPR ?? 1) });
    const { page } = opened;
    if (env.UI !== '1') await page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
    const view = await applyView(page, s);
    if (view.skipped) console.log(`${s.name}: tilt/fov not fixed (no window.__world in this build)`);
    if (s.js) console.log(s.name, JSON.stringify(await page.evaluate(s.js)));
    await page.waitForTimeout(s.wait ?? 300);
    await page.screenshot({ path: file });
    console.log(`${s.name}: ${file}${opened.errors.length ? `  ERRORS ${opened.errors.slice(0, 4).join(' | ')}` : ''}`);
  } catch (e) {
    console.log(`${s.name}: FAILED ${String(e.message ?? e).split('\n')[0]}${opened?.errors.length ? `  page errors: ${opened.errors.slice(0, 4).join(' | ')}` : ''}`);
  } finally {
    await opened?.ctx.close();
  }
}
await browser.close();
