import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CameraRig } from '../src/view/camera';
import type {} from '../src/dev/harnessApi';

// Start the canyon server, then run: npx tsx scripts/record-scarlet-review.ts
// Frozen world time isolates camera-dependent artifacts from wind and wildlife.
// Outputs are ignored review evidence; selected clips can be copied deliberately.
const baseURL = process.env.SCARLET_URL ?? 'http://localhost:5227';
const output = resolve(process.env.SCARLET_REVIEW_OUTPUT ?? 'shots/scarlet-sail-canyon/material-refinement/motion');
// Keep media outside Playwright's test-results cleanup directory.
const rawOutput = resolve(output, 'raw-video');
const viewport = { width: 1280, height: 800 };
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceWorktreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const trackedDiffSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { maxBuffer: 32 * 1024 * 1024 })).digest('hex');
mkdirSync(output, { recursive: true });
mkdirSync(rawOutput, { recursive: true });
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

interface WorldProbe {
  rig: CameraRig;
  followingResident: string | null;
  frameMuse(view: { height: number; distance: number; azimuth: number; at: number; fixed: boolean }): void;
}
interface View {
  id: string;
  button?: string;
  pose?: string;
  shelterDetail?: boolean;
  dx: number;
  dy: number;
}
const views: View[] = [
  { id: '01-shelter', shelterDetail: true, dx: 105, dy: 18 },
  { id: '02-floor-contact', pose: '-0.1975,0.0379,0.5902,0.7818,0.657', dx: 90, dy: 30 },
  { id: '03-understory', button: 'Observe Fern Sifter', dx: 85, dy: 12 },
  { id: '04-grove-rocks', button: 'Three Sails', dx: 110, dy: 25 },
  { id: '05-settlement', button: 'Shelter', dx: 110, dy: 15 },
  { id: '06-reported-terrace', pose: '0.1015,-0.1997,0.6176,0.754,0.647', dx: 90, dy: 18 },
  { id: '07-vegetation-distribution', pose: '-0.0859,-0.0242,0.6199,0.7796,0.624', dx: 110, dy: 20 },
  { id: '08-whole-planet', pose: '0.0537,0.1585,0.7644,0.6227,0', dx: 130, dy: 35 },
];

const requestedViews = process.env.SCARLET_REVIEW_VIEWS?.split(',');
const selectedViews = requestedViews ? views.filter(view => requestedViews.includes(view.id)) : views;
if (!selectedViews.length || requestedViews?.some(id => !views.some(view => view.id === id))) {
  throw new Error('SCARLET_REVIEW_VIEWS must contain known comma-separated view IDs');
}

async function placeView(page: Page, view: View): Promise<void> {
  await page.evaluate(async ({ pose }) => {
    const h = window.__meadow!;
    const w = (window as unknown as { __world: WorldProbe }).__world;
    w.followingResident = null;
    // URL poses omit pitch. Clear it explicitly before replaying a view, then
    // let the named view compute its exact pitch instead of round-tripping the
    // four-decimal URL quaternion. This uses existing dev APIs only.
    w.rig.lookUp(0);
    // Resetting a hash without cam defaults to wander. After a globe view,
    // that queued mode callback can overwrite the restored zero zoom.
    const mode=pose?.split(',').at(-1)==='0'?'overview':'wander';
    h.setHash(`cam=${mode}&q=high&t=12&hud=0${pose ? `&pose=${pose}` : ''}`);
    await h.settle();
  }, view);
  if (view.button) await page.getByRole('button', { name: view.button, exact: true }).click();
  if (view.shelterDetail) {
    await page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.frameMuse({
      height: 4.2, distance: 16, azimuth: 0.22, at: 0.6, fixed: true,
    }));
  }
  await page.evaluate(async () => { await window.__meadow!.settle(); });
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h = window.__meadow!;
    const rig = (window as unknown as { __world: WorldProbe }).__world.rig;
    const hash = h.frameHash();
    return {
      hash, state: h.getHash(), stats: h.stats(),
      camera: {
        matrixWorld: rig.camera.matrixWorld.toArray(),
        projection: rig.camera.projectionMatrix.toArray(),
        frame: rig.frame.toArray(), zoom: rig.zoom,
      },
    };
  });
}

async function moveSlowly(page: Page, dx: number, dy: number): Promise<void> {
  const steps = 36;
  let previous = 0;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const ease = t * t * (3 - 2 * t);
    const amount = ease - previous;
    // Drive the existing rig's drag API directly. A slowly starting pointer
    // gesture can cross the app's hold timer and bloom/pet instead of moving;
    // those interactions change resident poses even while time is frozen.
    await page.evaluate(({ dx, dy }) => {
      const w = (window as unknown as { __world: WorldProbe }).__world;
      w.rig.drag(dx, dy, window.innerWidth, window.innerHeight);
    }, { dx: dx * amount, dy: dy * amount });
    previous = ease;
    // Deliberate recording cadence, not a readiness wait.
    await page.waitForTimeout(33);
  }
}

const browser = await chromium.launch({ args: process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
  baseURL, viewport, deviceScaleFactor: 1,
  recordVideo: { dir: rawOutput, size: viewport },
});
const page = await context.newPage();
const video = page.video()!;
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text());
});
const chapters = [];
try {
  await page.goto('/environments/scarlet-sail-canyon/#q=high&t=12&hud=0');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 90_000 });
  await placeView(page, selectedViews[0]);
  const captureStarted = Date.now();
  for (const [index, view] of selectedViews.entries()) {
    if (index) await placeView(page, view);
    const startSeconds = (Date.now() - captureStarted) / 1000;
    const before = await snapshot(page);
    const repeated = await snapshot(page);
    await page.screenshot({ path: resolve(output, `${view.id}-before.png`) });
    await page.waitForTimeout(400);
    await moveSlowly(page, view.dx, view.dy);
    await page.waitForTimeout(200);
    const midpoint = await snapshot(page);
    await moveSlowly(page, -view.dx, -view.dy);
    await page.waitForTimeout(400);
    // Reverse pointer motion is not a mathematical inverse of spherical
    // camera motion. Reapply the same full view for the reproducibility check.
    await placeView(page, view);
    const returned = await snapshot(page);
    await page.screenshot({ path: resolve(output, `${view.id}-returned.png`) });
    await page.waitForTimeout(400);
    chapters.push({
      view: view.id, startSeconds, endSeconds: (Date.now() - captureStarted) / 1000,
      dragPixels: [view.dx, view.dy], before, repeated, midpoint, returned,
      cameraMoved: JSON.stringify(before.camera) !== JSON.stringify(midpoint.camera),
      staticHashMatches: before.hash === repeated.hash,
      returnedHashMatches: before.hash === returned.hash,
      returnedCameraMatches: JSON.stringify(before.camera) === JSON.stringify(returned.camera),
    });
    console.info(`${view.id}: static=${before.hash === repeated.hash}, returned=${before.hash === returned.hash}`);
  }
  const duration = (Date.now() - captureStarted) / 1000;
  await context.close();
  const rawPath = await video.path();
  const rawDuration = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', rawPath,
  ], { encoding: 'utf8' }).trim());
  // Playwright starts its recording clock after page creation; trim from the end.
  const trimStart = Math.max(0, rawDuration - duration);
  const clip = resolve(output, 'frozen-camera-motion.mp4');
  execFileSync('ffmpeg', [
    '-y', '-ss', trimStart.toFixed(3), '-i', rawPath, '-t', duration.toFixed(3), '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-threads', '2',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip,
  ], { stdio: 'ignore' });
  writeFileSync(resolve(output, 'motion-review.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), baseURL, sourceRevision, sourceBranch, sourceWorktreeDirty, trackedDiffSha256,
    viewport, quality: 'high', frozenTime: 12, durationSeconds: duration,
    clip, browserErrors: errors, chapters,
    scope: `${selectedViews.length} authored views on this browser/GPU, moved through the existing camera drag API without triggering world interactions. Matching fixed-view hashes establish reproducibility; visual review of the moving clip is still required. This does not prove absence of overlap at every camera or world seed.`,
  }, null, 2) + '\n');
  const failed = chapters.some(chapter => !chapter.cameraMoved || !chapter.staticHashMatches || !chapter.returnedHashMatches);
  if (errors.length || failed) process.exitCode = 1;
  console.info(`Recorded ${clip} (${duration.toFixed(1)} seconds); browser errors: ${errors.length}`);
} finally {
  await context.close();
  await browser.close();
}
