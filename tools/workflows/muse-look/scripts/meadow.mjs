// Muse in the meadow, headless: seek its life to moments of its day and screenshot each, framed by
// the M key (as Kai sees it) or by a given view.
//   node meadow.mjs <out-dir> --list                                 the parts of its day (names, counts, first start)
//   node meadow.mjs <out-dir> '[["bench",3],["fish",20,1],["nap",30,0,{"distance":3,"height":1.2,"azimuth":0.5}]]' [w h]
// Each moment: [part name, s into it, nth occurrence (default 0), view for world.frameMuse (default: press M)].
// A view: { distance, height, azimuth, at } in meters/radians (MUSE_VIEW in world.ts is the default framing).
// env: BASE (dev server), DPR (default 1), ZOOM (wheel steps in after framing), HOURS (how far its day is written, default 3).
import { findBase, open, meadow, listParts, report, slug } from './lib.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: node meadow.mjs <out-dir> --list | <moments-json> [w h]');
const listOnly = process.argv[3] === '--list';
const moments = listOnly ? [] : JSON.parse(process.argv[3] ?? '[["look about",2]]');
const [w, h] = [Number(process.argv[4] ?? 1200), Number(process.argv[5] ?? 750)];
const base = await findBase();
const { browser, page, errors } = await open({ width: w, height: h });
const parts = await meadow(page, base);
if (listOnly) listParts(parts);
for (const [name, s, nth = 0, view] of moments) {
  const found = parts.filter((p) => p.name === name)[nth];
  if (!found) {
    console.log(`no part "${name}" #${nth} (try --list)`);
    continue;
  }
  await page.evaluate((at) => {
    const w = window.__world;
    w.muse.life.seek(w.clock.time, at);
  }, found.start + s);
  await page.waitForTimeout(150);
  if (view) await page.evaluate((v) => window.__world.frameMuse(v), view);
  else await page.keyboard.press('m');
  await page.waitForTimeout(1200);
  const zoom = Number(process.env.ZOOM ?? 0);
  if (zoom) {
    await page.mouse.move(w / 2, h / 2);
    for (let i = 0; i < zoom; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(60);
    }
  }
  await page.waitForTimeout(900);
  const file = `${out}/meadow-${slug(name)}-${s}${nth ? '-' + nth : ''}.png`;
  await page.screenshot({ path: file });
  const where = await page.evaluate(() => {
    const m = window.__world.muse;
    const l = m.living;
    return `home ${m.home} drawn ${m.drawn} moves ${l.action.moves.map((x) => x.kind).join(',') || '-'} walk ${l.action.walk.toFixed(2)}`;
  });
  console.log(file.split('/').pop(), '|', where);
}
console.log('server', base);
report(errors);
await browser.close();
