// Film the room furnishing itself (src/dev/hutFilm.ts) frame by frame into an mp4: Muse's hut through the cutaway,
// empty but for Muse bouncing in its middle, each piece of furniture coming into being behind a glowing blue edge.
// Every frame is drawn at its own moment (the film is closed-form in time), averaging `samples` renders over the
// shutter (motion blur, smooth edges), piped into ffmpeg (H.264, yuv420p, faststart: plays on a phone).
//   node furnish.mjs <out.mp4> [w h] [fps] [samples] [from to]
//   node furnish.mjs out.mp4 1920 1080 30 12        the shot as it is
//   node furnish.mjs out.mp4 960 540 30 1           a quick look
//   STILLS=dir node furnish.mjs '' 1920 1080 30 12 0 6 '[0,1,2,3,4,5]'   stills at those moments (s) instead
// env: BASE (dev server; else :5198, else :5173), DPR (default 1: MSAA on), CRF (default 16), SHUTTER (share of a
//      frame the shutter is open, default 0.5), T0 (world time the film starts at, default 40), LOOK (JSON: the
//      edge's look, hut.ts FilmLook), FRAMES=dir (also keep every frame as a png).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, openPage } from '../../drive-app/scripts/lib.mjs';
import { findBase, report } from './lib.mjs';

const [out, w = '1920', h = '1080', fps = '30', samples = '1', from = '', to = '', moments = ''] = process.argv.slice(2);
if (!out && !process.env.STILLS) throw new Error('usage: node furnish.mjs <out.mp4> [w h] [fps] [samples] [from to]');
const base = await findBase();
const dpr = Number(process.env.DPR ?? 1);
const browser = await launch();
const { page, errors } = await openPage(browser, base, { width: Number(w), height: Number(h), dpr, pausable: true, hash: `t=${process.env.T0 ?? 40}&q=high&hud=0` });
await page.addStyleTag({ content: '#ui, .lil-gui { display: none !important; }' });
await page.addScriptTag({ type: 'module', content: "import { hutFilm } from '/src/dev/hutFilm.ts'; window.hutFilmLoaded = true;" });
await page.waitForFunction(() => window.hutFilmLoaded === true && window.hutFilm, undefined, { timeout: 60000 });
const options = { t0: Number(process.env.T0 ?? 40), ...(process.env.LOOK ? { look: JSON.parse(process.env.LOOK) } : {}) };
await page.evaluate((o) => window.hutFilm.start(o), options);
// (the app's own loop held from here: only the film draws)
await page.evaluate(() => (window.__pause = true));
const length = await page.evaluate(() => window.hutFilm.length);
const rate = Number(fps);
const shutter = Number(process.env.SHUTTER ?? 0.5) / rate;
const n = Number(samples);
const draw = async (t) => {
  await page.evaluate(() => window.__meadow.settle());
  await page.evaluate(([t, n, s]) => window.hutFilm.frame(t, n, s), [t, n, shutter]);
  return page.screenshot({ type: 'png' });
};
const started = Date.now();
if (process.env.STILLS) {
  mkdirSync(process.env.STILLS, { recursive: true });
  for (const t of JSON.parse(moments || '[0,1,2,3,4,5]')) {
    const file = `${process.env.STILLS}/t${Number(t).toFixed(2)}.png`;
    writeFileSync(file, await draw(Number(t)));
    console.log(file);
  }
} else {
  const t0 = from === '' ? 0 : Number(from);
  const t1 = to === '' ? length : Number(to);
  const frames = Math.round((t1 - t0) * rate);
  const scale = dpr !== 1 ? ['-vf', `scale=${w}:${h}:flags=lanczos`] : [];
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(rate), '-i', '-', ...scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  if (process.env.FRAMES) mkdirSync(process.env.FRAMES, { recursive: true });
  for (let i = 0; i < frames; i++) {
    const t = t0 + i / rate;
    const png = await draw(t);
    if (process.env.FRAMES) writeFileSync(`${process.env.FRAMES}/f${String(i).padStart(4, '0')}.png`, png);
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (i % 30 === 0) console.log(`frame ${i}/${frames}  t ${t.toFixed(2)} s  ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on('close', r));
  console.log(out, `${frames} frames at ${rate} fps, ${n} samples, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
report(errors);
await browser.close();
