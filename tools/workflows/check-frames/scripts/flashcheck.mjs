// The meadow's two flickers counted at their source during a live walk (needs window.__world: a dev or probe build):
//  - blank frames: the canvas resized after the scene was drawn in the same frame (the drawn frame is thrown away)
//  - patch drops: a grass or flower tile whose pages changed between the visibility pass and the draw
// The camera is driven from script the same way in every build: forward at 4.6 m/s, then turning, then sideways.
//   node flashcheck.mjs <target> [label]
// env: HASH (the start; default standing by the meadow's pond on High), DPR (2), W×H 1440×900.
// It hooks World internals (grass.layer, flowers.layer, tiles, scene, renderer.setSize): a new planet needs its own
// hooks, but the idea carries: count the bad event where it happens, not in screenshots.
import { launch, openPage } from '../../drive-app/scripts/lib.mjs';

const [target, label = target] = process.argv.slice(2);
if (!target) {
  console.error('usage: node flashcheck.mjs <target> [label]');
  process.exit(2);
}
const hash = process.env.HASH ?? 'cam=wander&hud=0&q=high&pose=-0.426,0.3515,0.2406,0.7982,0.83';
const browser = await launch();
// the frame each rAF callback belongs to (all callbacks of one frame share its timestamp)
const frameClock = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frameT = -1;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      window.__frameT = t;
      cb(t);
    });
};
const { page, errors } = await openPage(browser, target, { hash, width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900), init: [frameClock] });
await page.evaluate(() => {
  const w = window.__world;
  if (!w) throw new Error('needs window.__world (a dev or probe build)');
  const stats = { frames: 0, blankFrames: 0, resizes: 0, patchDrops: 0, tilesDropped: 0 };
  window.__fc = stats;
  let drawnT = -2;
  const layers = [w.grass.layer, w.flowers.layer];
  const snap = new Map();
  for (const layer of layers) {
    const update = layer.update.bind(layer);
    layer.update = (view) => {
      update(view);
      const m = new Map();
      for (const t of layer.tiles.values()) m.set(t, JSON.stringify(t.pages));
      snap.set(layer, m);
    };
  }
  w.scene.onBeforeRender = () => {
    if (window.__frameT === drawnT) return; // the mirror and the other passes of the same frame
    drawnT = window.__frameT;
    stats.frames++;
    let dropped = 0;
    for (const layer of layers) {
      const m = snap.get(layer);
      if (!m) continue;
      for (const t of layer.tiles.values()) {
        const before = m.get(t);
        // only tiles that were showing blades: a new tile arriving a frame late is not a drop
        if (before !== undefined && /\d/.test(before) && t.count > 0 && before !== JSON.stringify(t.pages)) dropped++;
      }
    }
    if (dropped) {
      stats.patchDrops++;
      stats.tilesDropped += dropped;
    }
  };
  const r = w.renderer;
  const setSize = r.setSize.bind(r);
  r.setSize = (...a) => {
    stats.resizes++;
    if (window.__frameT === drawnT) stats.blankFrames++;
    return setSize(...a);
  };
  const rig = w.rig;
  window.__drive = { ahead: 0, across: 0, turn: 0 };
  let last = performance.now();
  const step = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const d = window.__drive;
    const R = w.growth.radius;
    if (d.ahead || d.across || d.turn) {
      rig.axes(rig.frameTarget);
      if (d.ahead) rig.rotate(rig.right, -(d.ahead * dt) / R);
      if (d.across) rig.rotate(rig.forward, (d.across * dt) / R);
      if (d.turn) rig.rotate(rig.up, d.turn * dt);
      rig.glideT = 1;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
const drive = async (d, ms) => {
  await page.evaluate((d) => Object.assign(window.__drive, d), d);
  await page.waitForTimeout(ms);
  await page.evaluate(() => Object.assign(window.__drive, { ahead: 0, across: 0, turn: 0 }));
};
await page.waitForTimeout(3000);
await drive({ ahead: 4.6 }, 8000);
await drive({ ahead: 4.6, turn: 0.9 }, 4000);
await drive({ across: 4.6 }, 4000);
await page.waitForTimeout(5000);
const s = await page.evaluate(() => ({ ...window.__fc, scale: window.__meadow.stats().renderScale, tier: window.__meadow.stats().tier }));
console.log(`${label.padEnd(20)} frames ${s.frames}  resizes ${s.resizes}  blank frames ${s.blankFrames}  frames with a patch drop ${s.patchDrops} (${s.tilesDropped} tiles)  ended ${s.tier}@${Number(s.scale).toFixed(2)}`);
if (errors.length) console.log('page errors:', errors.slice(0, 4));
await browser.close();
