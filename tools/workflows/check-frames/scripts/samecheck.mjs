// Do two targets draw the same frame, pixel for pixel? Settled views at frozen time, per tier, the render scale
// pinned to 1 after freezing, each frame rendered twice and read back from the drawing buffer. One page at a
// time (a page that settles while another loads can drop its scale and fake a difference).
//   node samecheck.mjs <targetA> <targetB> [tier…]      (tiers default: high)
// targets: URLs (dev servers, published pages) or build names from build-at.sh. Check a target against itself
// first: it must come out identical, or the comparison means nothing.
// env: VIEWS / VIEWSFILE, DPR (2; DPR=1 turns MSAA on, as on Kai's 1× external screens), W×H 1440×900, T (12),
//      CROPS=<dir>: for each differing view, A and B cropped round the differences and zoomed ×ZOOM (4).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyView, frozenFrame, launch, loadViews, openPage, pagePixels, rgbaToPng } from '../../drive-app/scripts/lib.mjs';

const [a, b, ...tierArgs] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node samecheck.mjs <targetA> <targetB> [tier…]');
  process.exit(2);
}
const tiers = tierArgs.length ? tierArgs : ['high'];
const T = Number(process.env.T ?? 12);
const ZOOM = Number(process.env.ZOOM ?? 4);
const CROPS = process.env.CROPS;
if (CROPS) mkdirSync(CROPS, { recursive: true });
const views = loadViews();
const size = { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900), pausable: true };
const browser = await launch();

// every view of one target: its frames (RGBA, rows bottom to top) and what was drawn
const shootAll = async (target, tier) => {
  const X = await openPage(browser, target, { ...size, hash: `hud=0&q=${tier}&t=${T}` });
  await X.page.evaluate(() => (window.__pause = true));
  const frames = [];
  for (const v of views) {
    const view = await applyView(X.page, v);
    const f = await frozenFrame(X.page, T);
    frames.push({ ...f, skipped: view.skipped, px: await pagePixels(X.page) });
  }
  return { X, frames };
};

for (const tier of tiers) {
  const A = await shootAll(a, tier);
  const fa = A.frames;
  const errorsA = A.X.errors;
  // (keep A's page for encoding crops only when they are asked for)
  if (!CROPS) await A.X.ctx.close();
  const B = await shootAll(b, tier);
  for (let k = 0; k < views.length; k++) {
    const v = views[k];
    const ra = fa[k];
    const rb = B.frames[k];
    const notes = [];
    if (ra.scale !== 1 || rb.scale !== 1) notes.push(`render scale ${ra.scale}/${rb.scale}, not 1`);
    if (ra.skipped || rb.skipped) notes.push('tilt/fov not fixed (no __world)');
    if (ra.width !== rb.width || ra.height !== rb.height) {
      console.log(`${tier.padEnd(7)} ${v.name.padEnd(17)} sizes differ: ${ra.width}×${ra.height} against ${rb.width}×${rb.height}`);
      continue;
    }
    if (ra.hash === rb.hash) {
      console.log(`${tier.padEnd(7)} ${v.name.padEnd(17)} identical${notes.length ? `  (${notes.join('; ')})` : ''}`);
      continue;
    }
    const { width: W, height: H } = ra;
    const STEPS = [4, 16, 64];
    const over = STEPS.map(() => 0);
    let diff = 0;
    let maxd = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, mx = 0, my = 0;
    for (let i = 0; i < ra.px.length; i += 4) {
      const d = Math.max(Math.abs(ra.px[i] - rb.px[i]), Math.abs(ra.px[i + 1] - rb.px[i + 1]), Math.abs(ra.px[i + 2] - rb.px[i + 2]));
      if (!d) continue;
      diff++;
      const p = i / 4;
      const x = p % W;
      const y = H - 1 - Math.floor(p / W); // top-down
      if (d > maxd) [maxd, mx, my] = [d, x, y];
      for (let s = 0; s < STEPS.length; s++) if (d > STEPS[s]) over[s]++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    console.log(
      `${tier.padEnd(7)} ${v.name.padEnd(17)} DIFFER: ${diff} px of ${W * H} (max Δ ${maxd}; ${STEPS.map((s, i) => `Δ>${s} ${over[i]}`).join(', ')}) in x ${x0}–${x1}, y ${y0}–${y1}${notes.length ? `  (${notes.join('; ')})` : ''}`,
    );
    if (CROPS) {
      // round the whole difference when it is small, else round its strongest pixel
      const cw = Math.min(W, 320);
      const ch = Math.min(H, 200);
      const small = x1 - x0 < cw && y1 - y0 < ch;
      const cx = small ? (x0 + x1) / 2 : mx;
      const cy = small ? (y0 + y1) / 2 : my;
      const crop = { x: Math.max(0, Math.min(W - cw, Math.round(cx - cw / 2))), y: Math.max(0, Math.min(H - ch, Math.round(cy - ch / 2))), w: cw, h: ch, zoom: ZOOM };
      const name = `${tier}-${v.name.replace(/[^a-z0-9]+/gi, '_')}`;
      for (const [label, f] of [['A', ra], ['B', rb]]) writeFileSync(join(CROPS, `${name}-${label}.png`), await rgbaToPng(B.X.page, f.px, W, H, crop));
      console.log(`        crops: ${join(CROPS, name)}-A.png, -B.png (x ${crop.x}, y ${crop.y}, ${cw}×${ch} ×${ZOOM})`);
    }
  }
  for (const [label, errs] of [[a, errorsA], [b, B.X.errors]]) if (errs.length) console.log(`${label} page errors:`, errs.slice(0, 4));
  if (CROPS) await A.X.ctx.close();
  await B.X.ctx.close();
}
await browser.close();
