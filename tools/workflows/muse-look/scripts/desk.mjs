// Film Momo at its desk (museLab.html#desk=1, src/dev/museDesk.ts) frame by frame into an mp4: every frame drawn
// at its own moment (the scene is closed-form in time), averaging `samples` renders over the shutter for motion blur,
// soft shadows and smooth edges, piped straight into ffmpeg (H.264, yuv420p, faststart: plays on a phone).
//   node desk.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]
//   node desk.mjs out.mp4 1920 1080 30 16                      the film as it is
//   node desk.mjs out.mp4 960 540 30 1                         a quick look
//   node desk.mjs out.mp4 1920 1080 30 16 '' '' '&beats=3,10,12.5,13.4,16.2,19.6,25.5'
//                                                               other beats: ramp,frantic,stop,lid,phones,unwind,end (s)
//   '&hi=0' leaves out its glance at you at the start.
// env: BASE (dev server; else :5198, else :5173), DPR (default 1; 2 renders at twice the size and scales down),
//      CRF (default 16), SHUTTER (share of a frame the shutter is open, default 0.5).
// Stills of moments instead: open the page and call window.museDesk.frame(t, samples, shutter) yourself.
import { spawn } from 'node:child_process';
import { findBase, open, report } from './lib.mjs';

const [out, w = '1920', h = '1080', fps = '30', samples = '1', from = '', to = '', extra = ''] = process.argv.slice(2);
if (!out) throw new Error('usage: node desk.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]');
const base = await findBase();
const dpr = Number(process.env.DPR ?? 1);
const { browser, page, errors } = await open({ width: Number(w), height: Number(h), dpr });
await page.goto(`${base}/src/dev/museLab.html#desk=1&t=0${extra}`);
await page.waitForFunction(() => window.museLabReady === true && window.museDesk, undefined, { timeout: 120000 });
const length = await page.evaluate(() => window.museDesk.length);
const t0 = from === '' ? 0 : Number(from);
const t1 = to === '' ? length : Number(to);
const rate = Number(fps);
const frames = Math.round((t1 - t0) * rate);
const shutter = Number(process.env.SHUTTER ?? 0.5) / rate;
const scale = dpr !== 1 ? ['-vf', `scale=${w}:${h}:flags=lanczos`] : [];
const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(rate), '-i', '-', ...scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const started = Date.now();
for (let i = 0; i < frames; i++) {
  const t = t0 + i / rate;
  await page.evaluate(([t, n, s]) => window.museDesk.frame(t, n, s), [t, Number(samples), shutter]);
  const png = await page.screenshot({ type: 'png' });
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (i % 90 === 0) console.log(`frame ${i}/${frames}  t ${t.toFixed(2)} s  ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on('close', r));
console.log(out, `${frames} frames at ${rate} fps, ${samples} samples, ${((Date.now() - started) / 1000).toFixed(0)} s`);
report(errors);
await browser.close();
