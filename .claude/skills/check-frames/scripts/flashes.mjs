// One-frame flashes in a frame sequence: pixels where a frame differs from both neighbours while the neighbours
// agree with each other (a blink, a missing patch, a speck that comes and goes), per frame and by screen band.
// Works on film.mjs output or on frames pulled from a screen recording:
//   ffmpeg -i rec.mov -vf fps=60,scale=960:-1 <dir>/f%04d.png
//   node flashes.mjs <dir> [--jump 28] [--back 10] [--top 5]
// Lists the frames with the most flashing pixels (look at those first) and the share by band, top to bottom.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const dir = args.shift();
const opt = { jump: 28, back: 10, top: 5 };
while (args.length) {
  const k = args.shift().replace(/^--/, '');
  opt[k] = Number(args.shift());
}
if (!dir) {
  console.error('usage: node flashes.mjs <dir> [--jump 28] [--back 10] [--top 5]');
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
if (files.length < 3) throw new Error(`need at least 3 frames in ${dir}`);
const browser = await chromium.launch();
const page = await browser.newPage();
// luminance at up to 480 px wide, kept in the page three frames at a time
await page.evaluate(() => {
  window.__lum = async (b64, mime) => {
    const im = new Image();
    im.src = `data:${mime};base64,${b64}`;
    await im.decode();
    const w = Math.min(480, im.width);
    const h = Math.round((im.height * w) / im.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    return { L, w, h };
  };
  window.__win = [];
});
const per = [];
const bands = [0, 0, 0, 0];
for (const f of files) {
  const r = await page.evaluate(
    async ({ b64, mime, jump, back }) => {
      const win = window.__win;
      win.push(await window.__lum(b64, mime));
      if (win.length > 3) win.shift();
      if (win.length < 3) return null;
      const [a, b, c] = win;
      const n = b.L.length;
      let flash = 0;
      const band = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const j = Math.min(Math.abs(b.L[i] - a.L[i]), Math.abs(b.L[i] - c.L[i]));
        if (j > jump && Math.abs(c.L[i] - a.L[i]) < back) {
          flash++;
          band[Math.min(3, Math.floor((Math.floor(i / b.w) / b.h) * 4))]++;
        }
      }
      return { share: (flash / n) * 100, band: band.map((x) => (x / n) * 100) };
    },
    { b64: readFileSync(join(dir, f)).toString('base64'), mime: /png$/i.test(f) ? 'image/png' : 'image/jpeg', jump: opt.jump, back: opt.back },
  );
  if (r) {
    per.push({ frame: f, share: r.share });
    r.band.forEach((x, k) => (bands[k] += x));
  }
}
await browser.close();
const mean = per.reduce((s, p) => s + p.share, 0) / per.length;
console.log(`${dir}: ${files.length} frames; flashing pixels per frame mean ${mean.toFixed(3)}%, max ${Math.max(...per.map((p) => p.share)).toFixed(3)}%`);
console.log(`by band, top to bottom: ${bands.map((x) => `${(x / per.length).toFixed(3)}%`).join(' ')}`);
console.log('frames with the most:');
for (const p of per.sort((x, y) => y.share - x.share).slice(0, opt.top)) console.log(`  ${p.frame}  ${p.share.toFixed(3)}%`);
