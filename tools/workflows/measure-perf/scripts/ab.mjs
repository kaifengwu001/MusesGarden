// Two builds A/B in one browser, per view, in alternating rounds (the same heat and load for both): GPU-synced
// throughput of frames back to back (window.__meadow.benchmark), best and median of the rounds, in ms a frame.
//   node ab.mjs <targetA> <targetB> [tier] [labelA] [labelB]
// targets: URLs or build names from build-at.sh (served from disk); tier: low | medium | high (default high).
// env: VIEWS="name,…" or VIEWSFILE (views; fixed tilt/fov need __world: dev or probe builds), ROUNDS (8),
//      DPR (2), W×H 1440×900 (W, H).
import { applyView, launch, loadViews, openPage, quantile } from '../../drive-app/scripts/lib.mjs';

const [targetA, targetB, tier = 'high', labelA = targetA, labelB = targetB] = process.argv.slice(2);
if (!targetA || !targetB) {
  console.error('usage: node ab.mjs <targetA> <targetB> [tier] [labelA] [labelB]');
  process.exit(2);
}
const ROUNDS = Number(process.env.ROUNDS ?? 8);
const size = { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900), pausable: true };
const views = loadViews();
const browser = await launch();
const A = await openPage(browser, targetA, { ...size, hash: `hud=0&q=${tier}&t=12` });
const B = await openPage(browser, targetB, { ...size, hash: `hud=0&q=${tier}&t=12` });
const prepare = async (X, v) => {
  await X.page.evaluate(() => (window.__pause = true));
  const r = await applyView(X.page, v);
  await X.page.evaluate(() => window.__meadow.benchmark(8)); // warm
  return r;
};
const bench = (X) => X.page.evaluate(() => {
  window.__meadow.benchmark(4);
  return window.__meadow.benchmark(16);
});
const px = await A.page.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio]);
console.log(`${tier} at ${px[0]}×${px[1]}: ${labelA} vs ${labelB}, ms a frame, best / median of ${ROUNDS} alternating rounds`);
for (const v of views) {
  const ra = await prepare(A, v);
  const rb = await prepare(B, v);
  const ta = [];
  const tb = [];
  for (let r = 0; r < ROUNDS; r++) {
    if (r % 2) {
      tb.push(await bench(B));
      ta.push(await bench(A));
    } else {
      ta.push(await bench(A));
      tb.push(await bench(B));
    }
  }
  const a = { best: Math.min(...ta), median: quantile(ta, 0.5) };
  const b = { best: Math.min(...tb), median: quantile(tb, 0.5) };
  const note = ra.skipped || rb.skipped ? '  (tilt/fov not fixed: no __world)' : '';
  console.log(
    `${v.name.padEnd(17)} ${labelA} ${a.best.toFixed(2)} / ${a.median.toFixed(2)}   ${labelB} ${b.best.toFixed(2)} / ${b.median.toFixed(2)}   Δ best ${(b.best - a.best).toFixed(2)}, median ${(b.median - a.median).toFixed(2)}${note}`,
  );
}
for (const [label, X] of [[labelA, A], [labelB, B]]) if (X.errors.length) console.log(`${label} page errors:`, X.errors.slice(0, 4));
await browser.close();
