import { expect, test, type Page } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

interface FramePressure { intervalMs: number; frames: number }
type PressureWindow = Window & { __lanternFramePressure: FramePressure };

test.use({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });

/** Throttle real RAF delivery, without changing the app's clock, controller or stats. */
async function installFramePressure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as PressureWindow;
    const state = w.__lanternFramePressure = { intervalMs: 0, frames: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const scheduled = new Map<number, number>();
    let nextId = 0;
    let lastDelivered = -Infinity;
    window.requestAnimationFrame = (callback) => {
      const id = ++nextId;
      const deliver = (now: number): void => {
        // Every callback belonging to one browser frame sees the same timestamp.
        // Deliver them together; otherwise a test/UI RAF could starve the renderer.
        if (state.intervalMs > 0 && now !== lastDelivered && now - lastDelivered < state.intervalMs) {
          scheduled.set(id, raf(deliver));
          return;
        }
        scheduled.delete(id);
        if (now !== lastDelivered) {
          lastDelivered = now;
          if (state.intervalMs > 0) state.frames++;
        }
        callback(now);
      };
      scheduled.set(id, raf(deliver));
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const pending = scheduled.get(id);
      if (pending !== undefined) cancel(pending);
      scheduled.delete(id);
    };
  });
}

async function pressureFrames(page: Page, count: number): Promise<void> {
  const target = await page.evaluate(count => {
    const state = (window as PressureWindow).__lanternFramePressure;
    state.intervalMs = 80;
    return state.frames + count;
  }, count);
  await page.waitForFunction(target => (window as PressureWindow).__lanternFramePressure.frames >= target, target, { timeout: 15_000 });
}

async function resolution(page: Page) {
  return page.evaluate(() => {
    const h = window.__meadow!;
    const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
    return { ...h.stats(), bufferWidth: canvas.width, bufferHeight: canvas.height, frames: h.frameLog(30) };
  });
}

test('live High keeps the full drawing-buffer resolution under slow frames, while Auto can adapt', async ({ page }) => {
  test.setTimeout(90_000);
  await installFramePressure(page);
  // No frozen-time URL parameter: a frozen capture would mask the original bug.
  await page.goto('/environments/lantern-reed-gardens/#q=high&hud=0&cam=overview');
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  const before = await resolution(page);
  expect(before.frozen).toBe(false);

  await pressureFrames(page, 45);
  const high = await resolution(page);
  expect(high.frozen).toBe(false);
  expect(high.time).toBeGreaterThan(before.time + 1);
  // Verify that sustained, non-stall slow frames actually reached the app.
  expect(high.frames.filter(f => f.frameMs >= 60 && f.frameMs <= 250).length).toBeGreaterThanOrEqual(20);
  expect(high.tierChoice).toBe('high');
  expect(high.renderScale).toBe(1);
  expect(high.width).toBe(high.bufferWidth);
  expect(high.height).toBe(high.bufferHeight);
  expect(high.pixelRatio).toBe(2);

  await page.evaluate(() => window.__meadow!.set('quality.tier', 'auto'));
  await page.waitForFunction(() => {
    const s = window.__meadow!.stats();
    return s.tierChoice === 'auto' && s.renderScale < 1 && s.width < document.querySelector<HTMLCanvasElement>('#scene')!.width;
  }, undefined, { timeout: 15_000 });
  const auto = await resolution(page);
  expect(auto.frozen).toBe(false);
  expect(auto.renderScale).toBeLessThan(1);
  expect(auto.width).toBeLessThan(auto.bufferWidth);

  // Returning from a reduced Auto view must restore and retain full resolution.
  await page.evaluate(() => window.__meadow!.set('quality.tier', 'high'));
  await pressureFrames(page, 35);
  const restored = await resolution(page);
  expect(restored.tierChoice).toBe('high');
  expect(restored.frozen).toBe(false);
  expect(restored.renderScale).toBe(1);
  expect(restored.width).toBe(restored.bufferWidth);
  expect(restored.height).toBe(restored.bufferHeight);
  test.info().annotations.push({ type: 'live-resolution', description: `High ${high.width}×${high.height} @${high.renderScale}; Auto @${auto.renderScale.toFixed(2)}; restored High ${restored.width}×${restored.height} @${restored.renderScale}` });
});
