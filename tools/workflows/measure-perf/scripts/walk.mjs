// A live walk the way Kai uses the app: Auto quality (unless HASH sets q=), real time, the keyboard driving the
// camera, every frame recorded (wall-clock frame time, the app's JS ms, build ms, tier and render scale, build
// queue, grass in view), summarised by phase: load, walk, turn+walk, strafe, still.
//   node walk.mjs <target> [label]
// env: POSE (frame quaternion and zoom; default the meadow's standing view by its pond), HASH (extra hash keys,
//      e.g. "q=high"), DPR (2), W×H 1440×900. Frames over 25 ms are counted as hitches.
import { launch, openPage, quantile } from '../../drive-app/scripts/lib.mjs';

const [target, label = target] = process.argv.slice(2);
if (!target) {
  console.error('usage: node walk.mjs <target> [label]');
  process.exit(2);
}
const pose = process.env.POSE ?? '-0.426,0.3515,0.2406,0.7982,0.83';
const extra = process.env.HASH ? `&${process.env.HASH}` : '';
const browser = await launch();
const { page, errors } = await openPage(browser, target, {
  hash: `cam=wander&hud=0&pose=${pose}${extra}`,
  width: Number(process.env.W ?? 1440),
  height: Number(process.env.H ?? 900),
});
await page.evaluate(() => {
  window.__rec = [];
  window.__phase = 'load';
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const s = window.__meadow.stats();
    window.__rec.push([window.__phase, now - last, s.jsMs, s.buildMs, s.tier, s.renderScale ?? 1, s.buildQueue, s.grassInstances]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const phase = async (name, keys, ms) => {
  await page.evaluate((n) => (window.__phase = n), name);
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
};
await phase('load', [], 4000);
await phase('walk', ['KeyW'], 8000);
await phase('turn+walk', ['KeyW', 'ArrowLeft'], 4000);
await phase('strafe', ['KeyD'], 4000);
await phase('still', [], 5000);
const rec = await page.evaluate(() => window.__rec);
await browser.close();
console.log(`== ${label}`);
for (const ph of ['load', 'walk', 'turn+walk', 'strafe', 'still']) {
  const r = rec.filter((x) => x[0] === ph).slice(1);
  if (!r.length) continue;
  const f = r.map((x) => x[1]);
  const js = r.map((x) => x[2]);
  const build = r.map((x) => x[3]);
  const queue = r.map((x) => x[6]);
  const grass = r.map((x) => x[7]);
  const tiers = [...new Set(r.map((x) => `${x[4]}@${Number(x[5]).toFixed(2)}`))].join(' → ');
  console.log(
    `${ph.padEnd(10)} frames ${String(r.length).padStart(4)}  frame p50 ${quantile(f, 0.5).toFixed(1)} p90 ${quantile(f, 0.9).toFixed(1)} p99 ${quantile(f, 0.99).toFixed(1)} max ${Math.max(...f).toFixed(0)}  >25ms ${f.filter((x) => x > 25).length}` +
      `  js p50 ${quantile(js, 0.5).toFixed(1)} p95 ${quantile(js, 0.95).toFixed(1)}  build p95 ${quantile(build, 0.95).toFixed(1)}` +
      `  queue max ${Math.max(...queue)}  grass ${(Math.min(...grass) / 1e3).toFixed(0)}k–${(Math.max(...grass) / 1e3).toFixed(0)}k  tier ${tiers}`,
  );
}
if (errors.length) console.log('page errors:', errors.slice(0, 4));
