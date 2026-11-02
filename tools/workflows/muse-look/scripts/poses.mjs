// Muse's poses and moves on the spot in the lab (no stage), one still each, for a contact sheet:
// a move at a time into it, from a view, in a look.
//   node poses.mjs <out-dir> '[["pet",2],["sit",3,"persp:60"],["wave",1.2,"back"]]' [model] [look] [default-view]
// Poses: idle, walk, wave, day, hang (arms hung, nothing else moving: to compare the two arms), and the
// moves in museLab.ts's MOVES: bounce pet fluff yawn hopup perch hopdown plop sit rise lie sleep wake fish water stir.
// Views: front, left, right, back, turn:<deg>, persp:<deg> (a perspective camera round by deg; persp:35 is three-quarter).
// Looks: muse (default), clay, facet, rough (normal deviation heat: finds bumps), stretch, weights, raw, rawclay.
// env: BASE, EXTRA (more hash: e.g. "&wire=1", "&size=120" for the face as if far off, "&skin=dqs", "&raise=0").
import { findBase, open, lab, report } from './lib.mjs';

const [out, listJson, model = 'tpose6', look = 'muse', view = 'persp:25'] = process.argv.slice(2);
if (!listJson) throw new Error('usage: node poses.mjs <out-dir> <list-json> [model] [look] [view]');
const base = await findBase();
const { browser, context, errors } = await open({ width: 752, height: 840 });
for (const [pose, t, v = view] of JSON.parse(listJson)) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  try {
    await lab(page, base, `model=${model}&look=${look}&pose=${pose}&t=${t}&view=${v}&size=630${process.env.EXTRA ?? ''}`);
  } catch (e) {
    errors.push(`${pose} not ready: ${e.message.split('\n')[0]}`);
  }
  const file = `${out}/${pose}-${t}-${v.replace(':', '')}-${look}.png`;
  await page.locator('#lab').screenshot({ path: file });
  console.log(file.split('/').pop());
  await page.close();
}
report(errors);
await browser.close();
