// Taps and holds on the lab's stage, stepped frame by frame (paused, → steps a thirtieth), so a
// reaction can be caught at exact moments: at a part of the day, a script of taps, holds, let-gos
// and shots, each at a time (s) after the start.
//   node labtouch.mjs <out-dir> <part> <s into it> '[["tap",0],["shot",0.6,"a"],["hold",1,1],["shot",2.5,"b"],["letGo",4],["shot",4.5,"c"]]' [round,up,dist]
// hold's third value is the side Muse's head tilts to (+1 its left). Shots: touch-<part>-<tag>.png.
// env: BASE, DPR (default 1), MODEL (default tpose6).
import { findBase, open, lab, report, slug } from './lib.mjs';

const [out, part, s0, scriptJson, view = '0,12,2.8'] = process.argv.slice(2);
if (!scriptJson) throw new Error('usage: node labtouch.mjs <out-dir> <part> <s> <script-json> [round,up,dist]');
const script = JSON.parse(scriptJson);
const [round, up, dist] = view.split(',').map(Number);
const base = await findBase();
const { browser, page, errors } = await open({ width: 900, height: 700 });
await lab(page, base, `model=${process.env.MODEL ?? 'tpose6'}&live=1&pause=1&t=0`);
await page.waitForFunction(() => window.museStage, undefined, { timeout: 30000 });
await page.addStyleTag({ content: 'div { display: none !important; }' });
const names = await page.evaluate(() => window.museStage.names);
const n = names.find((x) => x.name === part);
if (!n) throw new Error(`no part "${part}"`);
// the lab clock starts at 0, the day seeked so that 0 is s0 into the part; stepped with the arrow key
await page.evaluate((d) => window.museStage.seek(0, d), n.start + Number(s0));
let t = 0;
const step = async (to) => {
  while (t + 1 / 60 < to) {
    const k = Math.min(Math.round((to - t) * 30), 15);
    for (let i = 0; i < k; i++) await page.keyboard.press('ArrowRight');
    t += k / 30;
  }
};
await page.waitForTimeout(200);
await page.evaluate(([r, u, d]) => window.museStage.frame((r * Math.PI) / 180, (u * Math.PI) / 180, d), [round, up, dist]);
for (const [what, at, arg] of script) {
  await step(at);
  if (what === 'tap') await page.evaluate((x) => window.museStage.tap(x), t);
  else if (what === 'hold') await page.evaluate(([x, side]) => window.museStage.hold(x, side), [t, arg ?? 1]);
  else if (what === 'letGo') await page.evaluate((x) => window.museStage.letGo(x), t);
  else if (what === 'shot') {
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/touch-${slug(part)}-${arg}.png` });
    console.log('shot', arg, 't', t.toFixed(2));
  }
}
report(errors);
await browser.close();
