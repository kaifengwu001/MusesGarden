// Many lab stills in one browser, each with its own model, pose, moment, view and look: every muse from the same
// views for a contact sheet, or before and after a change to the rig (poses.mjs takes one model a run).
//   node batch.mjs <out-dir> '[["muse1","idle",2,"front","kind"],["tpose6","hang",0,"turn:30","clay","&raise=0"]]'
// Each item: model, pose, s, view, look, and optionally more hash. Poses, views and looks as in poses.mjs.
// Files: <model>-<pose>-<s>-<view>-<look>.png. env: BASE, DPR, EXTRA (more hash for every item).
import { findBase, open, lab, report } from './lib.mjs';

const [out, listJson] = process.argv.slice(2);
if (!listJson) throw new Error('usage: node batch.mjs <out-dir> <list-json>');
const base = await findBase();
const { browser, context, errors } = await open({ width: 752, height: 840 });
for (const [model, pose, t, view, look, extra = ''] of JSON.parse(listJson)) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  try {
    await lab(page, base, `model=${model}&look=${look}&pose=${pose}&t=${t}&view=${view}&size=630${extra}${process.env.EXTRA ?? ''}`);
  } catch (e) {
    errors.push(`${model} ${pose} not ready: ${e.message.split('\n')[0]}`);
  }
  const file = `${out}/${model}-${pose}-${t}-${view.replace(':', '')}-${look}.png`;
  await page.locator('#lab').screenshot({ path: file });
  console.log(file.split('/').pop());
  await page.close();
}
report(errors);
await browser.close();
