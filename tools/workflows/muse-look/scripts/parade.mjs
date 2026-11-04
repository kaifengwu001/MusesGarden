// Film the muses' parade (museLab.html#parade=1, src/dev/museParade.ts) frame by frame into an mp4: the muses one
// after another on match cuts, walking then waving, the camera once round. Every frame is drawn at its own moment (the
// scene is closed-form in time), averaging `samples` renders over the shutter for motion blur, soft shadows and smooth
// edges, piped straight into ffmpeg (H.264, yuv420p, faststart: plays on a phone).
//   node parade.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]
//   node parade.mjs out.mp4 1920 1080 30 16                    the shot as it is (7 s)
//   node parade.mjs out.mp4 960 540 30 1                       a quick look
//   node parade.mjs out.mp4 1920 1080 30 16 '' '' '&order=tpose6,muse3,muse7&length=3'
//                                                               other muses, or another length (each muse on for length / their number)
//   '&wave=<s>' moves the wave's start, '&look=0' leaves out its turning to you, '&cam=<round°>,<up°>,<m>' holds the camera.
//   STILLS=<dir> writes each frame as a png there instead (with the mp4 left out): stills of moments, e.g. from to = 3.4 3.6.
// env: BASE (dev server; else :5198, else :5173), DPR (default 1; 2 renders at twice the size and scales down),
//      CRF (default 16), SHUTTER (share of a frame the shutter is open, default 0.5).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findBase, open, report } from './lib.mjs';

const [out, w = '1920', h = '1080', fps = '30', samples = '1', from = '', to = '', extra = ''] = process.argv.slice(2);
if (!out) throw new Error('usage: node parade.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]');
const base = await findBase();
const dpr = Number(process.env.DPR ?? 1);
const stills = process.env.STILLS;
const { browser, page, errors } = await open({ width: Number(w), height: Number(h), dpr });
await page.goto(`${base}/src/dev/museLab.html#parade=1&t=0${extra}`);
// (fourteen muses rigged at once, each in a worker of its own: a minute or two)
await page.waitForFunction(() => window.museLabReady === true && window.museParade, undefined, { timeout: 300000 });
const length = await page.evaluate(() => window.museParade.length);
const t0 = from === '' ? 0 : Number(from);
const t1 = to === '' ? length : Number(to);
const rate = Number(fps);
const frames = Math.round((t1 - t0) * rate);
const shutter = Number(process.env.SHUTTER ?? 0.5) / rate;
const scale = dpr !== 1 ? ['-vf', `scale=${w}:${h}:flags=lanczos`] : [];
const ffmpeg = stills
  ? null
  : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(rate), '-i', '-', ...scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
if (stills) mkdirSync(stills, { recursive: true });
// (frames grabbed straight from the compositor: about twice as fast as page.screenshot, the same pixels)
const cdp = await page.context().newCDPSession(page);
const started = Date.now();
for (let i = 0; i < frames; i++) {
  const t = t0 + i / rate;
  await page.evaluate(([t, n, s]) => window.museParade.frame(t, n, s), [t, Number(samples), shutter]);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  const png = Buffer.from(data, 'base64');
  if (stills) writeFileSync(`${stills}/f${String(i).padStart(4, '0')}-t${t.toFixed(3)}.png`, png);
  else if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (i % 30 === 0) console.log(`frame ${i}/${frames}  t ${t.toFixed(2)} s  ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
if (ffmpeg) {
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on('close', r));
}
console.log(stills ?? out, `${frames} frames at ${rate} fps, ${samples} samples, ${((Date.now() - started) / 1000).toFixed(0)} s`);
report(errors);
await browser.close();
