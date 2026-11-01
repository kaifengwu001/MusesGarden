// A labelled contact sheet of images, laid out by Chromium (no Python imaging on this machine's python3).
//   node sheet.mjs <out.png|out.jpg> [--cols 3] [--width 640] [--title "text"] <image | label=image>...
// Each tile is labelled with its file name, or with the label given as label=path.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const out = args.shift();
let cols = 3;
let width = 640;
let title = '';
const tiles = [];
while (args.length) {
  const a = args.shift();
  if (a === '--cols') cols = Number(args.shift());
  else if (a === '--width') width = Number(args.shift());
  else if (a === '--title') title = args.shift();
  else {
    const eq = a.indexOf('=');
    const [label, path] = eq > 0 && !a.startsWith('/') && !a.startsWith('.') ? [a.slice(0, eq), a.slice(eq + 1)] : [basename(a, extname(a)), a];
    tiles.push({ label, path });
  }
}
if (!out || !tiles.length) {
  console.error('usage: node sheet.mjs <out.png|out.jpg> [--cols 3] [--width 640] [--title text] <image | label=image>...');
  process.exit(2);
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cells = tiles
  .map(({ label, path }) => `<figure><figcaption>${esc(label)}</figcaption><img src="data:${MIME[extname(path).toLowerCase()] ?? 'image/png'};base64,${readFileSync(path).toString('base64')}"></figure>`)
  .join('');
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #faf8f0; font: 13px -apple-system, sans-serif; color: #333; }
  h1 { font-size: 15px; margin: 10px 12px 0; }
  main { display: grid; grid-template-columns: repeat(${cols}, ${width}px); gap: 8px; padding: 10px; width: max-content; }
  figure { margin: 0; } figcaption { padding: 2px 4px 4px; } img { width: ${width}px; display: block; }
</style>${title ? `<h1>${esc(title)}</h1>` : ''}<main>${cells}</main>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (width + 8) + 20, height: 100 } });
await page.setContent(html);
await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r))))));
const jpeg = /\.jpe?g$/i.test(out);
await page.screenshot({ path: out, fullPage: true, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 88 } : {}) });
await browser.close();
console.log(out);
