import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { WebGLRenderer } from 'three';
import type {} from '../../../src/dev/harnessApi';
import type { World } from '../world';
import { DETAIL_VIEWS } from './detailViews';

const REPORTED_POSE = '0.1045,-0.3585,0.6614,0.6505,0.83';
const VIEWS = ['reported', 'home', 'bridge', 'pine', 'steps', 'plum', 'cedar', 'roof', 'water'] as const;
type View = typeof VIEWS[number];
type Season = 'snow' | 'rain';

/**
 * Pixel evidence complements the authored-surface ownership tests. Stable
 * z-fighting can repeat exactly, so a frozen hash alone is not a clearance.
 * The small camera sweep exposes changing visibility; its conservative flash
 * bound catches patches disappearing for one frame, not every moving ink edge.
 */
async function inspectView(page: Page, view: View, season: Season) {
  return page.evaluate(async ({ view, season, reportedPose, details }) => {
    const m = window.__meadow!;
    const w = (window as unknown as { __world: World }).__world;
    const renderer = (w as unknown as { renderer: WebGLRenderer }).renderer;
    w.setSeason(season);
    if (view === 'reported') {
      w.rig.lookUp(0, true);
      w.rig.applyPose(reportedPose);
      w.markPosed();
    } else if (view === 'pine') {
      const capture = w as unknown as { frameLocal(view: { at: readonly number[]; height: number; distance: number; azimuth: number }, immediate: boolean): void };
      capture.frameLocal({ at: [-9, 6.6, -3], height: 7.2, distance: 13, azimuth: 0.6 }, true);
      w.markPosed();
    } else if (view === 'home' || view === 'bridge') w.cameraPreset(view);
    else {
      const capture = w as unknown as { frameLocal(view: { at: readonly number[]; height: number; distance: number; azimuth: number }, immediate: boolean): void };
      capture.frameLocal(details[view], true);
      w.markPosed();
    }
    m.freeze(12);
    // Freeze first: otherwise the adaptive controller can undo the pinned scale.
    m.setScale(1);
    await m.settle();
    m.renderFrame();
    m.renderFrame();

    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = width * height;
    const read = (): Uint8Array => {
      m.renderFrame();
      const rgba = new Uint8Array(pixels * 4);
      // Read in the same task as the draw: preserveDrawingBuffer is false.
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return rgba;
    };
    const delta = (a: Uint8Array, b: Uint8Array) => {
      let changed = 0, over16 = 0, max = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d > 0) changed++;
        if (d > 16) over16++;
        max = Math.max(max, d);
      }
      return { changed, over16, max };
    };
    const png = (): string => renderer.domElement.toDataURL('image/png');
    const reference = read();
    const referencePng = png();
    const redraws = Array.from({ length: 3 }, () => delta(reference, read()));

    // Average to the check-frames film analysis resolution. Moving one-pixel
    // contour lines should not be mistaken for a whole material flashing.
    const sampleWidth = 480;
    const sampleHeight = Math.round(height * sampleWidth / width);
    const luminance = (rgba: Uint8Array): Float32Array => {
      const lum = new Float32Array(sampleWidth * sampleHeight);
      for (let y = 0; y < sampleHeight; y++) for (let x = 0; x < sampleWidth; x++) {
        const x0 = Math.floor(x * width / sampleWidth), x1 = Math.floor((x + 1) * width / sampleWidth);
        const y0 = Math.floor(y * height / sampleHeight), y1 = Math.floor((y + 1) * height / sampleHeight);
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          sum += rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722;
        }
        lum[y * sampleWidth + x] = sum / ((x1 - x0) * (y1 - y0));
      }
      return lum;
    };
    const initialFrame = w.rig.frame.clone(), up = w.rig.up.clone(), zoom = w.rig.zoom;
    const windowFrames: Float32Array[] = [];
    const frames = [];
    // Rig yaw rotates its focus over the planet, moving the camera as well as
    // turning it. Match the new close views' projected motion to the historical
    // 13m pine view; a fixed panorama increment over-translates a 3.8m detail.
    // Historical cameras and every stability threshold remain unchanged.
    const detailDistance = view in details ? details[view as keyof typeof details].distance : 13;
    const yawStep = 0.003 * Math.min(1, detailDistance / 13);
    for (let index = 0; index < 9; index++) {
      const yaw = (index - 4) * yawStep;
      const q = initialFrame.clone().premultiply(initialFrame.clone().setFromAxisAngle(up, yaw));
      w.rig.applyPose([q.x, q.y, q.z, q.w, zoom].join(','));
      await m.settle();
      m.renderFrame();
      m.renderFrame();
      const rgba = read();
      const image = png();
      const repeat = delta(rgba, read());
      const lum = luminance(rgba);
      let sum = 0, sum2 = 0, adjacent = 0;
      const previous = windowFrames.at(-1);
      for (let i = 0; i < lum.length; i++) {
        sum += lum[i]; sum2 += lum[i] * lum[i];
        if (previous) adjacent += Math.abs(lum[i] - previous[i]);
      }
      const mean = sum / lum.length;
      const deviation = Math.sqrt(Math.max(0, sum2 / lum.length - mean * mean));
      windowFrames.push(lum);
      if (windowFrames.length > 3) windowFrames.shift();
      let flashShare = 0;
      if (windowFrames.length === 3) {
        const [a, b, c] = windowFrames;
        for (let i = 0; i < lum.length; i++) {
          if (Math.min(Math.abs(b[i] - a[i]), Math.abs(b[i] - c[i])) > 28 && Math.abs(c[i] - a[i]) < 10) flashShare++;
        }
        flashShare /= lum.length;
      }
      frames.push({ index, yaw, pose: w.rig.poseString(), repeat, mean, deviation, adjacentMeanDelta: adjacent / lum.length, flashShare, image });
    }
    const stats = m.stats();
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    const state = {
      time: stats.time, frozen: stats.frozen, renderScale: stats.renderScale,
      renderer: String(gl.getParameter(debugRenderer?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    };
    return { width, height, view, season, state, referencePng, redraws, frames };
  }, { view, season, reportedPose: REPORTED_POSE, details: DETAIL_VIEWS });
}

for (const dpr of [1, 2]) test.describe(`frame stability at DPR ${dpr}`, () => {
  test.use({ viewport: { width: 960, height: 600 }, deviceScaleFactor: dpr });

  for (const season of ['snow', 'rain'] as const) test(`${season}: reported pose and close surface details remain stable`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|webgl|context.?lost/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`/environments/ukiyoe-pine-hamlet/#q=high&hud=0&t=12&cam=wander&pose=${REPORTED_POSE}`);
    await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 90_000 });

    for (const view of VIEWS) {
      const evidence = await inspectView(page, view, season);
      const directory = join('shots/ukiyoe-pine-hamlet/flicker', `dpr-${dpr}`, season, view);
      mkdirSync(directory, { recursive: true });
      const save = (name: string, data: string): void => writeFileSync(join(directory, name), Buffer.from(data.split(',')[1], 'base64'));
      save('reference.png', evidence.referencePng);
      // Retain beginning/middle/end visual evidence; all nine frames still
      // participate in the unchanged pixel/motion assertions below.
      for (const frame of evidence.frames) if (frame.index % 4 === 0) save(`f${String(frame.index).padStart(3, '0')}.png`, frame.image);
      const metrics = { ...evidence, referencePng: undefined, frames: evidence.frames.map(({ image: _image, ...frame }) => frame) };
      writeFileSync(join(directory, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
      await test.info().attach(`${season}-${view}-dpr-${dpr}`, { path: join(directory, 'reference.png'), contentType: 'image/png' });
      const flash = Math.max(...evidence.frames.map(frame => frame.flashShare));
      test.info().annotations.push({ type: 'flicker', description: `${season}/${view} DPR${dpr}: frozen redraws ${evidence.redraws.map(r => r.changed).join('/')} px, largest isolated-frame share ${(flash * 100).toFixed(3)}%` });

      expect(evidence.width).toBe(960 * dpr);
      expect(evidence.height).toBe(600 * dpr);
      expect(evidence.state).toMatchObject({ time: 12, frozen: true, renderScale: 1 });
      for (const repeat of evidence.redraws) expect(repeat, `${season}/${view} changed at a frozen pose`).toEqual({ changed: 0, over16: 0, max: 0 });
      for (const frame of evidence.frames) {
        expect(frame.repeat, `${season}/${view} sweep ${frame.index} changed without camera motion`).toEqual({ changed: 0, over16: 0, max: 0 });
        expect(frame.deviation, 'a blank frame must not count as stable').toBeGreaterThan(12);
        expect(frame.adjacentMeanDelta, 'a small camera movement should not replace a large part of the frame').toBeLessThan(8);
        expect(frame.flashShare, 'a large patch disappeared and returned in one frame').toBeLessThan(0.015);
      }
    }
    expect(errors).toEqual([]);
  });
});
