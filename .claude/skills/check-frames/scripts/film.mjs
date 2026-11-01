// Film a view over frozen time steps (one screenshot per step), for motion that stutters, swims, flickers or pops:
// cloud shadows crossing the ground, wind sheen, a fade, an LOD hand-over.
//   node film.mjs <target> <outDir> ['{"view":"standing 4.3 m","t0":20,"dt":0.0333,"n":60}']
// options: view (a name in $VIEWSFILE) or hash/preset/pose/tilt/fov; t0 (s), dt (s a frame, 1/30 by default),
//   n (frames), w×h (960×600), dpr (1), clip {x,y,width,height}. Frames are f000.png….
// Then: flashes.mjs <outDir> counts one-frame flashes; sheet.mjs lays frames out;
//   ffmpeg -framerate 30 -i <outDir>/f%03d.png -pix_fmt yuv420p <out>.mp4 makes a clip to watch or send.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyView, launch, loadViews, openPage } from '../../drive-app/scripts/lib.mjs';

const [target, out, json = '{}'] = process.argv.slice(2);
if (!target || !out) {
  console.error('usage: node film.mjs <target> <outDir> [json]');
  process.exit(2);
}
const o = { t0: 20, dt: 1 / 30, n: 60, w: 960, h: 600, dpr: 1, ...JSON.parse(json) };
const view = o.view ? loadViews().find((v) => v.name === o.view) : o;
if (!view) throw new Error(`no view named ${o.view}`);
mkdirSync(out, { recursive: true });
const browser = await launch();
const { page, errors } = await openPage(browser, target, { hash: `hud=0&q=high&t=${o.t0}${o.hash ? `&${o.hash}` : ''}`, width: o.w, height: o.h, dpr: o.dpr, pausable: true });
await page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
await page.evaluate(() => (window.__pause = true));
await applyView(page, view);
for (let i = 0; i < o.n; i++) {
  await page.evaluate((t) => {
    const m = window.__meadow;
    m.freeze(t);
    m.renderFrame();
  }, o.t0 + i * o.dt);
  await page.screenshot({ path: join(out, `f${String(i).padStart(3, '0')}.png`), clip: o.clip });
}
console.log(`${o.n} frames in ${out} (t ${o.t0}…${(o.t0 + (o.n - 1) * o.dt).toFixed(3)} s)${errors.length ? `  page errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
