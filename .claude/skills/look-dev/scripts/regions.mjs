// Colours measured from an image region by region, the way the meadow's palette rows were graded against its
// reference ("median colours per region"): per region the median colour, and the colours at the 10th, 50th and 90th
// percentile of lightness (shade, mid, light: a palette row's columns), as hex and Lab. With a second image (a render
// of the same composition), the same regions side by side and their ΔE76.
//   node regions.mjs <image> [other-image] [--grid 3x3 | --regions regions.json] [--out swatches.png]
// regions.json: [{ "name": "far meadow", "x": 0, "y": 0.35, "w": 1, "h": 0.15 }], in fractions of the image.
// Pick regions that are one material each (a band of far meadow, the lake, a cloud's lit side), not mixtures.
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const images = [];
let grid = '3x3';
let regionsFile = null;
let out = null;
while (args.length) {
  const a = args.shift();
  if (a === '--grid') grid = args.shift();
  else if (a === '--regions') regionsFile = args.shift();
  else if (a === '--out') out = args.shift();
  else images.push(a);
}
if (!images.length || images.length > 2) {
  console.error('usage: node regions.mjs <image> [other-image] [--grid 3x3 | --regions regions.json] [--out swatches.png]');
  process.exit(2);
}
let regions;
if (regionsFile) regions = JSON.parse(readFileSync(regionsFile, 'utf8'));
else {
  const [gx, gy] = grid.split('x').map(Number);
  regions = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) regions.push({ name: `r${j}c${i}`, x: i / gx, y: j / gy, w: 1 / gx, h: 1 / gy });
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const srcs = images.map((p) => `data:${MIME[extname(p).toLowerCase()] ?? 'image/png'};base64,${readFileSync(p).toString('base64')}`);
const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ srcs, regions, swatches }) => {
    const lab = ([r, g, b]) => {
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
    const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const ims = [];
    for (const s of srcs) {
      const im = new Image();
      im.src = s;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);
      ims.push({ c, g, w: c.width, h: c.height });
    }
    const measure = (img, r) => {
      const x0 = Math.floor(r.x * img.w);
      const y0 = Math.floor(r.y * img.h);
      const w = Math.max(1, Math.floor(r.w * img.w));
      const h = Math.max(1, Math.floor(r.h * img.h));
      const d = img.g.getImageData(x0, y0, w, h).data;
      const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
      const px = [];
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) px.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
      const median = [0, 1, 2].map((k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1]);
      const byL = px.map((p) => [lab(p)[0], p]).sort((a, b) => a[0] - b[0]);
      const at = (f) => {
        // the mean colour of the pixels within ±3 % of the lightness percentile
        const lo = Math.max(0, Math.floor((f - 0.03) * byL.length));
        const hi = Math.min(byL.length, Math.ceil((f + 0.03) * byL.length));
        const s = [0, 0, 0];
        for (let i = lo; i < hi; i++) for (let k = 0; k < 3; k++) s[k] += byL[i][1][k];
        return s.map((v) => v / Math.max(1, hi - lo));
      };
      return { median, shade: at(0.1), mid: at(0.5), light: at(0.9) };
    };
    const rows = regions.map((r) => {
      const m = ims.map((img) => measure(img, r));
      const row = { name: r.name, a: m[0] };
      if (m[1]) {
        row.b = m[1];
        const [p, q] = [lab(m[0].median), lab(m[1].median)];
        row.dE = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      }
      return row;
    });
    let sheet = null;
    if (swatches) {
      // per region: each image's crop, then its shade · mid · light · median swatches
      const cw = 220;
      const rowsH = regions.map((r) => Math.round((cw * (r.h * ims[0].h)) / (r.w * ims[0].w)));
      const H = rowsH.reduce((s, v) => s + Math.min(v, 160) + 26, 0);
      const out = document.createElement('canvas');
      out.width = ims.length * (cw + 4 * 34 + 20) + 10;
      out.height = H + 10;
      const o = out.getContext('2d');
      o.fillStyle = '#faf8f0';
      o.fillRect(0, 0, out.width, out.height);
      o.font = '12px sans-serif';
      let y = 6;
      regions.forEach((r, k) => {
        const h = Math.min(rowsH[k], 160);
        o.fillStyle = '#333';
        o.fillText(`${r.name}${rows[k].dE !== undefined ? `  ΔE ${rows[k].dE.toFixed(1)}` : ''}`, 6, y + 12);
        ims.forEach((img, i) => {
          const x = 6 + i * (cw + 4 * 34 + 20);
          o.drawImage(img.c, r.x * img.w, r.y * img.h, r.w * img.w, r.h * img.h, x, y + 18, cw, h);
          const m = i === 0 ? rows[k].a : rows[k].b;
          ['shade', 'mid', 'light', 'median'].forEach((key, j) => {
            o.fillStyle = hex(m[key]);
            o.fillRect(x + cw + 6 + j * 34, y + 18, 30, Math.min(h, 40));
          });
        });
        y += h + 26;
      });
      sheet = out.toDataURL('image/png').split(',')[1];
    }
    return { rows: rows.map((r) => ({ ...r, a: Object.fromEntries(Object.entries(r.a).map(([k, v]) => [k, hex(v)])), b: r.b && Object.fromEntries(Object.entries(r.b).map(([k, v]) => [k, hex(v)])), labA: lab(r.a.median).map((v) => v.toFixed(1)).join(' ') })), sheet };
  },
  { srcs, regions, swatches: Boolean(out) },
);
await browser.close();
for (const r of res.rows) {
  const a = `median ${r.a.median}  shade ${r.a.shade} mid ${r.a.mid} light ${r.a.light}  (Lab ${r.labA})`;
  console.log(`${r.name.padEnd(16)} ${a}`);
  if (r.b) console.log(`${''.padEnd(16)} ${`median ${r.b.median}  shade ${r.b.shade} mid ${r.b.mid} light ${r.b.light}`}  ΔE ${r.dE.toFixed(1)}`);
}
if (out) {
  writeFileSync(out, Buffer.from(res.sheet, 'base64'));
  console.log(`swatches: ${out}`);
}
