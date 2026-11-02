// The lab's stage (museLab.html#model=tpose6&live=1: Muse's ~4-minute day on a round lawn, museLife.ts),
// paused, headless: moments of the day framed on Muse from chosen angles.
//   node stage.mjs <out-dir> --list
//   node stage.mjs <out-dir> '[["bench",3,20,12,2.6],["bench",3,200,12,2.6,"back"]]' [w h]
// Each moment: [part, s into it, round° (0 = in front of Muse), up°, distance (m), tag?].
// For Kai's bar, look from in front (0), three-quarter (35–45), side (90) and back (180).
// env: BASE, DPR (default 1), MODEL (default tpose6), EXTRA (more hash, e.g. "&look=clay").
import { findBase, open, lab, report, slug } from './lib.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: node stage.mjs <out-dir> --list | <moments-json> [w h]');
const listOnly = process.argv[3] === '--list';
const moments = listOnly ? [] : JSON.parse(process.argv[3] ?? '[]');
const [w, h] = [Number(process.argv[4] ?? 900), Number(process.argv[5] ?? 700)];
const base = await findBase();
const { browser, page, errors } = await open({ width: w, height: h });
await lab(page, base, `model=${process.env.MODEL ?? 'tpose6'}&live=1&pause=1${process.env.EXTRA ?? ''}`);
await page.waitForFunction(() => window.museStage, undefined, { timeout: 30000 });
await page.addStyleTag({ content: 'div { display: none !important; }' });
const names = await page.evaluate(() => window.museStage.names);
if (listOnly) for (const n of names) console.log(`${n.name.padEnd(18)} at ${n.start.toFixed(1)} s`);
for (const [name, s, round, up, dist, tag] of moments) {
  const n = names.find((x) => x.name === name);
  if (!n) {
    console.log(`no part "${name}" (try --list)`);
    continue;
  }
  await page.evaluate((d) => window.museStage.seek(2, d), n.start + s);
  await page.waitForTimeout(250);
  await page.evaluate(([r, u, d]) => window.museStage.frame((r * Math.PI) / 180, (u * Math.PI) / 180, d), [round, up, dist]);
  await page.waitForTimeout(250);
  const file = `${out}/${slug(name)}-${s}${tag ? '-' + tag : `-r${round}`}.png`;
  await page.screenshot({ path: file });
  console.log(file.split('/').pop());
}
report(errors);
await browser.close();
