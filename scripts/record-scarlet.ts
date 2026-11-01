import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type {} from '../src/dev/harnessApi';

// Run the canyon dev server first, then: npx tsx scripts/record-scarlet.ts
// ffmpeg trims loading frames and encodes the real browser capture as an MP4.
const baseURL = process.env.SCARLET_URL ?? 'http://localhost:5227';
const output = resolve('environments/scarlet-sail-canyon/reference');
const rawOutput = resolve('test-results/scarlet-recordings');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceWorktreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
mkdirSync(output, { recursive: true });
mkdirSync(rawOutput, { recursive: true });
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

const browser = await chromium.launch({ args: process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tours = [
  { file: 'settlement-tour', stops: [
    { button: 'Shelter', seconds: 6 },
    { button: 'Three Sails', seconds: 6 },
    { button: 'Whole planet', seconds: 6 },
  ] },
  { file: 'native-life', stops: [
    { button: 'Observe Chalkstep', seconds: 6 },
    { button: 'Observe Fern Sifter', seconds: 6 },
    { button: 'Observe Dewwing', seconds: 6 },
    { button: 'Meet Pip', seconds: 4 },
  ] },
];
const captures = [];
try {
  for (const tour of tours) {
    const context = await browser.newContext({
      baseURL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
      recordVideo: { dir: rawOutput, size: { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    const video = page.video()!;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text());
    });
    // No frozen-time hash: wind, fauna, neighbours and camera travel stay live.
    await page.goto('/environments/scarlet-sail-canyon/#q=high&hud=0');
    await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 90_000 });
    await page.getByRole('button', { name: tour.stops[0].button, exact: true }).click();
    await page.evaluate(async () => window.__meadow?.settle());
    const captureStarted = Date.now();
    const chapters = [];
    for (const [index, stop] of tour.stops.entries()) {
      if (index > 0) await page.getByRole('button', { name: stop.button, exact: true }).click();
      chapters.push({ view: stop.button, startSeconds: (Date.now() - captureStarted) / 1000 });
      // Deliberate screen time for each live view, not a readiness check.
      await page.waitForTimeout(stop.seconds * 1000);
      if (stop.button === 'Whole planet') await page.screenshot({ path: resolve(output, 'checkpoint-planet.png') });
    }
    const duration = (Date.now() - captureStarted) / 1000;
    await context.close();
    if (errors.length) throw new Error(`Capture contained browser errors: ${errors.join('; ')}`);
    const rawPath = await video.path();
    const rawDuration = Number(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', rawPath,
    ], { encoding: 'utf8' }).trim());
    // The recorder's clock begins with its first frame, after newPage resolves.
    // Work backwards from the finished video, not from the page creation time.
    const trimStart = Math.max(0, rawDuration - duration);
    execFileSync('ffmpeg', [
      '-y', '-ss', trimStart.toFixed(3),
      '-i', rawPath, '-t', duration.toFixed(3), '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(output, `${tour.file}.mp4`),
    ], { stdio: 'ignore' });
    captures.push({ file: `${tour.file}.mp4`, durationSeconds: duration, chapters, browserErrors: errors });
    console.info(`Recorded ${tour.file}.mp4 (${duration.toFixed(1)} seconds)`);
  }
  writeFileSync(resolve(output, 'recordings.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), baseURL,
    sourceRevision, sourceWorktreeDirty,
    viewport: { width: 1280, height: 800 }, quality: 'high', frozenTime: false,
    captures,
  }, null, 2) + '\n');
} finally {
  await browser.close();
}
