// What does each part cost? Variants of one build (a pass skipped, a mesh hidden, only one thing drawn, a shader
// piece stubbed) timed against the build as it is, per view, in interleaved rounds, best of the rounds.
//   node variants.mjs <target> <variants.json | inline JSON> [tier]
// variants: [{ name, apply: "<js>", undo: "<js>" }]: apply runs in the page before a variant's frames and undo
//   after; both see window.__world (a dev or probe build) and these helpers, which hold after the app's own update
//   (it re-shows some meshes itself every frame, so a plain visible = false does not stick):
//     __v.hide.add(obj)            hidden (a mesh or a group: everything under it)
//     __v.only = new Set([obj])    every other mesh of the main scene hidden
//     __v.skip.add(scene)          that scene's render calls skipped (a whole pass: __world.clouds.mirrorScene)
//     __v.reset()                  all undone (the usual undo)
//   [{"name":"no clouds","apply":"__v.hide.add(__world.clouds.mesh)","undo":"__v.reset()"},
//    {"name":"no cloud mirror pass","apply":"__v.skip.add(__world.clouds.mirrorScene)","undo":"__v.reset()"}]
// Check a variant changed the picture (look.mjs with the same apply in js) before trusting its Δ. A hidden thing's
// saving understates its cost when what was behind it now draws (hidden-surface removal on this GPU), so time
// "only X" variants too; a stubbed shader piece needs a patched material copy (onBeforeCompile), not a hide.
// env: VIEWS / VIEWSFILE, ROUNDS (5), DPR (2), W×H 1440×900.
import { existsSync, readFileSync } from 'node:fs';
import { applyView, launch, loadViews, openPage } from '../../drive-app/scripts/lib.mjs';

const [target, spec, tier = 'high'] = process.argv.slice(2);
if (!target || !spec) {
  console.error('usage: node variants.mjs <target> <variants.json | inline JSON> [tier]');
  process.exit(2);
}
const variants = JSON.parse(existsSync(spec) ? readFileSync(spec, 'utf8') : spec);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const browser = await launch();
const { page, errors } = await openPage(browser, target, {
  hash: `hud=0&q=${tier}&t=12`,
  width: Number(process.env.W ?? 1440),
  height: Number(process.env.H ?? 900),
  pausable: true,
});
await page.evaluate(() => {
  window.__pause = true;
  const w = window.__world;
  if (!w) throw new Error('variants need window.__world: a dev server or a probe build (build-at.sh)');
  const v = (window.__v = { hide: new Set(), skip: new Set(), only: null });
  v.reset = () => {
    v.hide.clear();
    v.skip.clear();
    v.only = null;
  };
  const within = (o, set) => {
    for (let p = o; p; p = p.parent) if (set.has(p)) return true;
    return false;
  };
  // what was hidden last frame is shown again before the app's update, then hidden again after it
  const hidden = new Set();
  const update = w.update.bind(w);
  w.update = (...a) => {
    for (const o of hidden) o.visible = true;
    hidden.clear();
    const r = update(...a);
    if (v.hide.size || v.only)
      w.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (within(o, v.hide) || (v.only && !within(o, v.only))) {
          o.visible = false;
          hidden.add(o);
        }
      });
    return r;
  };
  const render = w.renderer.render.bind(w.renderer);
  w.renderer.render = (scene, camera) => {
    if (!v.skip.has(scene)) render(scene, camera);
  };
});
const time = (v) =>
  page.evaluate((v) => {
    if (v) (0, eval)(v.apply);
    window.__meadow.benchmark(4);
    const ms = window.__meadow.benchmark(16);
    if (v) (0, eval)(v.undo);
    return ms;
  }, v);
console.log(`${tier}: ms a frame, best of ${ROUNDS} interleaved rounds; Δ against the build as it is`);
for (const view of loadViews()) {
  await applyView(page, view);
  await page.evaluate(() => window.__meadow.benchmark(8));
  const base = [];
  const by = variants.map(() => []);
  for (let r = 0; r < ROUNDS; r++) {
    base.push(await time(null));
    for (let i = 0; i < variants.length; i++) by[i].push(await time(variants[i]));
  }
  const b = Math.min(...base);
  console.log(`${view.name.padEnd(17)} as built ${b.toFixed(2)}`);
  variants.forEach((v, i) => {
    const m = Math.min(...by[i]);
    console.log(`  ${v.name.padEnd(28)} ${m.toFixed(2)}  Δ ${(m - b).toFixed(2)}`);
  });
}
if (errors.length) console.log('page errors:', errors.slice(0, 4));
await browser.close();
