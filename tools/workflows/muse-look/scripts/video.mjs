// A video of Muse in the meadow, the camera following it from a fixed side (frameMuse with fixed:
// the homestead's bearing is "in front", so the shot doesn't swing as Muse turns). Records the page,
// trims the load off, and writes an mp4 (H.264, plays on Kai's phone) and a contact sheet.
//   node video.mjs <out-dir> <part> <s into it> <seconds> ['{"distance":7.5,"height":3.4,"azimuth":0.35}'] [nth]
// Out: <out-dir>/<part>-<s>.mp4 and <part>-<s>-sheet.png. env: BASE, DPR (default 1), W/H (default 960×600).
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { findBase, open, meadow, report, slug } from './lib.mjs';

const [out, part, s0, seconds, viewJson = '{}', nth = '0'] = process.argv.slice(2);
if (!seconds) throw new Error('usage: node video.mjs <out-dir> <part> <s> <seconds> [view-json] [nth]');
const [W, H] = [Number(process.env.W ?? 960), Number(process.env.H ?? 600)];
const base = await findBase();
const raw = join(out, `.raw-${Date.now()}`);
const born = Date.now();
const { browser, context, page, errors } = await open({ width: W, height: H, video: raw });
const parts = await meadow(page, base);
const found = parts.filter((p) => p.name === part)[Number(nth)];
if (!found) throw new Error(`no part "${part}" #${nth}`);
await page.evaluate(
  ([at, view]) => {
    const w = window.__world;
    w.muse.life.seek(w.clock.time, at);
    const follow = () => {
      w.frameMuse({ ...view, fixed: true });
      requestAnimationFrame(follow);
    };
    follow();
  },
  [found.start + Number(s0), JSON.parse(viewJson)],
);
// (the recording runs from the page's birth: everything before this moment is the load)
const from = (Date.now() - born) / 1000 + 0.3;
await page.waitForTimeout(Number(seconds) * 1000);
await context.close();
await browser.close();
const webm = readdirSync(raw).find((f) => f.endsWith('.webm'));
const name = `${slug(part)}-${s0}`;
const mp4 = join(out, `${name}.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', from.toFixed(2), '-i', join(raw, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
const rate = Math.min(4, 36 / Number(seconds)).toFixed(3);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `fps=${rate},scale=400:-1,tile=6x6`, '-frames:v', '1', join(out, `${name}-sheet.png`)]);
rmSync(raw, { recursive: true, force: true });
console.log(mp4, `(${seconds} s from ${part} + ${s0} s)`);
report(errors);
