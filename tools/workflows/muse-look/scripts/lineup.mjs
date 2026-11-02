// The muses in two rows (museLab.html#lineup=1): a still of the rows, then taps and holds on them through real
// mouse events (a tap: a wave, or a bounce if it waved lately; a hold: petted), each shot, or filmed as an mp4
// plus a contact sheet. A muse is its place in the rows (0 the original Muse, then muse0 … muse12, the back row
// first) or its name ("muse5", "tpose6").
//   node lineup.mjs <out> ['[["tap",0,1.2],["hold",4,2.2],["shot","a"]]'] [--video]
// Steps: ["tap", i, wait-s], ["hold", i, hold-s] (still held after: shoot it, then let go), ["letgo", wait-s],
// ["wait", s], ["shot", name]. Default: the row, a tap, a hold and a second tap. env: BASE, DPR (default 1).
import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import { findBase, open, report } from './lib.mjs';

const [out, stepsJson, flag] = process.argv.slice(2);
if (!out) throw new Error('usage: node lineup.mjs <out> [steps-json] [--video]');
const video = flag === '--video' || stepsJson === '--video';
const steps = JSON.parse(stepsJson && stepsJson !== '--video' ? stepsJson : '[["shot","row"],["tap","tpose6",1.1],["shot","wave"],["hold","muse5",2.2],["shot","pet"],["letgo",0.3],["tap","tpose6",0.5],["shot","bounce"]]');
const base = await findBase();
const { browser, context, page, errors } = await open({ width: 1600, height: 900, video: video ? out : null });
const t0 = Date.now();
await page.goto(`${base}/src/dev/museLab.html#lineup=1`);
await page.waitForFunction(() => window.museLabReady === true, undefined, { timeout: 120000 });
const ready = (Date.now() - t0) / 1000;
console.log(`ready in ${ready.toFixed(1)} s`);
await page.waitForTimeout(1500);
const at = (i) => page.evaluate((k) => window.museLineup.where(k), i);
for (const [kind, a, b] of steps) {
  if (kind === 'shot') {
    await page.screenshot({ path: `${out}/${a}.png` });
    console.log(`${a}.png`);
  } else if (kind === 'wait') await page.waitForTimeout(a * 1000);
  else if (kind === 'letgo') {
    await page.mouse.up();
    await page.waitForTimeout((a ?? 0.5) * 1000);
  } else if (kind === 'tap') {
    const p = await at(a);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout((b ?? 1) * 1000);
  } else if (kind === 'hold') {
    const p = await at(a);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout((b ?? 2) * 1000);
  }
}
await page.mouse.up();
await context.close();
await browser.close();
if (video) {
  const webm = readdirSync(out).filter((f) => f.endsWith('.webm')).map((f) => `${out}/${f}`).pop();
  renameSync(webm, `${out}/lineup.webm`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(ready + 0.3), '-i', `${out}/lineup.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', `${out}/lineup.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(ready + 0.3), '-i', `${out}/lineup.webm`, '-vf', 'fps=1.2,scale=600:-1,tile=4x6', '-frames:v', '1', `${out}/lineup-sheet.png`]);
  console.log('lineup.mp4, lineup-sheet.png');
}
report(errors);
