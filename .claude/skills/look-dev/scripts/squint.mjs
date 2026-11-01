// The squint test, for any planet and any reference: the render and the reference, each shrunk to a coarse grid
// and blurred, compared per cell in CIE Lab (mean ΔE76), overall and by horizontal band, plus a composite (top: the
// reference and the render; bottom: both squinted and the ΔE heat map, blue close, red ΔE ≥ 40). Same method as
// the meadow's `npm run squint` (src/dev/squint.spec.ts), without its fixed still and view.
//   node squint.mjs <reference> <render.png | target> [out.png]
// render: a screenshot, or a target (a URL or a build name from build-at.sh) drawn at the reference's aspect from
//   PRESET (default vista) or POSE (frame quaternion and zoom), with HASH added to "q=high&hud=0&t=12".
// env: GRID (48x27, or 27x48 for a portrait reference), BANDS ("sky and far:0-9,middle:9-18,near:18-27", rows of
//      the grid; thirds by default), W (the render's width: 1448, or 720 for a portrait reference; its height follows
//      the reference's aspect).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { applyView, launch, openPage } from '../../drive-app/scripts/lib.mjs';

const [refPath, render, out = 'squint.png'] = process.argv.slice(2);
if (!refPath || !render) {
  console.error('usage: node squint.mjs <reference> <render.png | target> [out.png]');
  process.exit(2);
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const dataUrl = (path) => `data:${MIME[extname(path).toLowerCase()] ?? 'image/png'};base64,${readFileSync(path).toString('base64')}`;

const browser = await launch();
const work = await browser.newPage();
const ref = dataUrl(refPath);
const [rw, rh] = await work.evaluate(async (src) => {
  const im = new Image();
  im.src = src;
  await im.decode();
  return [im.naturalWidth, im.naturalHeight];
}, ref);
// the grid follows the reference's orientation (a portrait vista, like the terraces', is squinted 27 × 48)
const portrait = rh > rw;
const [GW, GH] = (process.env.GRID ?? (portrait ? '27x48' : '48x27')).split('x').map(Number);
const third = Math.round(GH / 3);
const BANDS = (process.env.BANDS ?? `top third:0-${third},middle third:${third}-${2 * third},bottom third:${2 * third}-${GH}`)
  .split(',')
  .map((b) => {
    const [name, rows] = b.split(':');
    const [y0, y1] = rows.split('-').map(Number);
    return [name, y0, y1];
  });

let shot;
if (existsSync(render)) shot = dataUrl(render);
else {
  const width = Number(process.env.W ?? (portrait ? 720 : 1448));
  const height = Math.round((width * rh) / rw);
  const X = await openPage(browser, render, { hash: `q=high&hud=0&t=12${process.env.HASH ? `&${process.env.HASH}` : ''}`, width, height, dpr: 1 });
  await X.page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
  await applyView(X.page, process.env.POSE ? { pose: process.env.POSE } : { preset: process.env.PRESET ?? 'vista' });
  shot = `data:image/png;base64,${(await X.page.screenshot()).toString('base64')}`;
  if (X.errors.length) console.log('page errors:', X.errors.slice(0, 3));
  await X.ctx.close();
}

const result = await work.evaluate(
  async ({ ref, shot, GW, GH, BANDS }) => {
    const load = async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      return im;
    };
    const [a0, b0] = await Promise.all([load(ref), load(shot)]);
    // squint: shrink to 4× the grid, average each 4×4 block, then a 3×3 binomial blur with clamped edges
    const squint = (im) => {
      const mid = document.createElement('canvas');
      mid.width = GW * 4;
      mid.height = GH * 4;
      const m = mid.getContext('2d', { willReadFrequently: true });
      m.imageSmoothingQuality = 'high';
      m.drawImage(im, 0, 0, mid.width, mid.height);
      const src = m.getImageData(0, 0, mid.width, mid.height).data;
      const box = new Float32Array(GW * GH * 3);
      for (let y = 0; y < GH * 4; y++)
        for (let x = 0; x < GW * 4; x++) for (let c = 0; c < 3; c++) box[((y >> 2) * GW + (x >> 2)) * 3 + c] += src[(y * GW * 4 + x) * 4 + c] / 16;
      const at = (x, y, c) => box[(Math.min(GH - 1, Math.max(0, y)) * GW + Math.min(GW - 1, Math.max(0, x))) * 3 + c];
      const out = new Uint8ClampedArray(GW * GH * 4);
      const w = [1, 2, 1];
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += w[i + 1] * w[j + 1] * at(x + i, y + j, c);
            out[(y * GW + x) * 4 + c] = s / 16;
          }
          out[(y * GW + x) * 4 + 3] = 255;
        }
      return out;
    };
    const lab = (r, g, b) => {
      const lin = (c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const [R, G, B] = [lin(r), lin(g), lin(b)];
      const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
      const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
      const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
      const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const a = squint(a0);
    const b = squint(b0);
    const diff = new Float32Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
      const p = lab(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]);
      const q = lab(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]);
      diff[i] = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    }
    const hex = (px, y0, y1) => {
      const sum = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = 0; x < GW; x++) for (let c = 0; c < 3; c++) sum[c] += px[(y * GW + x) * 4 + c];
      const n = (y1 - y0) * GW;
      return '#' + sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
    };
    const mean = (y0, y1) => {
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < GW; x++) s += diff[y * GW + x];
      return s / ((y1 - y0) * GW);
    };
    const W = 480;
    const H = Math.round((W * GH) / GW);
    const outC = document.createElement('canvas');
    outC.width = W * 3;
    outC.height = H * 2;
    const o = outC.getContext('2d');
    o.fillStyle = '#f4f1e8';
    o.fillRect(0, 0, outC.width, outC.height);
    o.drawImage(a0, 0, 0, W, H);
    o.drawImage(b0, W, 0, W, H);
    const grid = (px) => {
      const c = document.createElement('canvas');
      c.width = GW;
      c.height = GH;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), GW, GH), 0, 0);
      return c;
    };
    o.imageSmoothingEnabled = true;
    o.drawImage(grid(a), 0, H, W, H);
    o.drawImage(grid(b), W, H, W, H);
    const heat = new Uint8ClampedArray(GW * GH * 4);
    for (let i = 0; i < GW * GH; i++) {
      const t = Math.min(diff[i] / 40, 1);
      heat[i * 4] = 255 * t;
      heat[i * 4 + 1] = 255 * (1 - Math.abs(t - 0.5) * 2) * 0.8;
      heat[i * 4 + 2] = 255 * (1 - t);
      heat[i * 4 + 3] = 255;
    }
    o.imageSmoothingEnabled = false;
    o.drawImage(grid(heat), W * 2, H, W, H);
    o.font = '15px sans-serif';
    o.fillStyle = '#333';
    o.fillText(`squint ΔE ${mean(0, GH).toFixed(1)}`, W * 2 + 16, 28);
    BANDS.forEach(([name, y0, y1], k) => o.fillText(`${name}: ${mean(y0, y1).toFixed(1)}`, W * 2 + 16, 56 + k * 22));
    return {
      deltaE: mean(0, GH),
      bands: BANDS.map(([name, y0, y1]) => ({ name, reference: hex(a, y0, y1), render: hex(b, y0, y1), deltaE: mean(y0, y1) })),
      composite: outC.toDataURL('image/png').split(',')[1],
    };
  },
  { ref, shot, GW, GH, BANDS },
);
writeFileSync(out, Buffer.from(result.composite, 'base64'));
console.log(`squint ΔE ${result.deltaE.toFixed(2)} (${GW}×${GH} cells; composite ${out})`);
for (const b of result.bands) console.log(`  ${b.name.padEnd(24)} ΔE ${b.deltaE.toFixed(1).padStart(5)}   reference ${b.reference}   render ${b.render}`);
await browser.close();
