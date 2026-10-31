import { expect, test, type Page } from '@playwright/test';
import type {} from './harnessApi';

// Browser-side invariants (`npm run test:gpu`). CPU-side invariants live in
// src/dev/invariants/*.test.ts (Vitest).

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
}

async function settledHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const m = window.__meadow;
    if (!m) throw new Error('harness missing');
    await m.settle();
    return m.frameHash();
  });
}

test.describe('determinism', () => {
  const state = 'seed=412&q=high&hud=0&t=12';

  test('two loads of the same URL render an identical frame', async ({ page }) => {
    await open(page, state);
    const first = await settledHash(page);
    await page.goto('about:blank');
    await open(page, state);
    expect(await settledHash(page)).toBe(first);
  });

  test('a frozen frame is identical across re-renders', async ({ page }) => {
    await open(page, state);
    const a = await settledHash(page);
    const b = await page.evaluate(() => window.__meadow?.frameHash());
    expect(b).toBe(a);
  });

  test('growth scrub 0.3 → 0.7 → 0.3 returns the identical frame', async ({ page }) => {
    await open(page, `${state}&cam=wander`);
    const scrub = async (g: number): Promise<string> => {
      await page.evaluate((g) => window.__meadow?.set('world.growth', g), g);
      return settledHash(page);
    };
    const a = await scrub(0.3);
    const b = await scrub(0.7);
    const c = await scrub(0.3);
    expect(b).not.toBe(a);
    expect(c).toBe(a);
  });
});

test.describe('CPU and GPU agree', () => {
  test('terrain, water and the tiny-planet warp match their CPU mirrors', async ({ page }) => {
    await open(page, 'q=high&hud=0&t=12&cam=wander');
    await page.evaluate(async () => window.__meadow?.settle());
    const p = await page.evaluate(() => window.__meadow?.parity());
    expect(p?.samples).toBe(64);
    // m: the GPU reads the meadow from a half-float cube bake (texels ~0.5 m at
    // R 128, bilinear) where the CPU evaluates the noise exactly
    expect(p?.heightError).toBeLessThan(0.02);
    // m, near shores: distance to the shore is height over slope on both sides
    expect(p?.waterError).toBeLessThan(0.12);
    expect(p?.warpError).toBeLessThan(0.005); // m
  });

  test('picking hits the planet where it is drawn', async ({ page }) => {
    await open(page, 'q=high&hud=0&t=12');
    await page.evaluate(async () => window.__meadow?.settle());
    const centre = await page.evaluate(() => window.__meadow?.pick(0, 0));
    expect(centre).not.toBeNull();
    const sky = await page.evaluate(() => window.__meadow?.pick(0.98, 0.98));
    expect(sky).toBeNull();
  });
});

test.describe('growth', () => {
  test('scrubbing growth in real time stays within the frame budget', async ({ page }) => {
    await open(page, 'q=high&hud=0&cam=wander');
    await page.evaluate(async () => window.__meadow?.settle());
    // drive growth 0.1 → 0.6 over ~3 s, one step per animation frame
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const start = performance.now();
          const step = (): void => {
            const t = (performance.now() - start) / 3000;
            window.__meadow?.set('world.growth', 0.1 + 0.5 * Math.min(t, 1));
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
    );
    const log = (await page.evaluate(() => window.__meadow?.frameLog(160))) ?? [];
    expect(log.length).toBeGreaterThan(100);
    const js = log.map((f) => f.jsMs).sort((a, b) => a - b);
    const build = Math.max(...log.map((f) => f.buildMs));
    const p95 = js[Math.floor(js.length * 0.95)];
    test.info().annotations.push({ type: 'scrub', description: `JS p95 ${p95.toFixed(2)} ms, max ${js.at(-1)!.toFixed(2)} ms, build slice max ${build.toFixed(2)} ms` });
    // a desktop catching up on a backlog of tiles lets the frame's JS run to 5 ms (main.ts BACKLOG_FRAME_JS_MS);
    // the rest is submission (since iteration 13 the water mask's passes and the terrain's second draw:
    // about 0.05 ms, p95 5.3–5.5 ms on the M1 Pro, timed in 0.1 ms steps)
    expect(p95).toBeLessThan(5.6);
    expect(build).toBeLessThan(4.2); // the queue keeps to its 3.6 ms backlog slice (+ at most one short job step)
  });
});

test.describe('frames', () => {
  test('walking never drops a strip of grass from a frame, and a resize never blanks one', async ({ page }) => {
    // the frame each rAF callback belongs to (all callbacks of one frame share its timestamp)
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const w = window as unknown as { __frameT: number };
      w.__frameT = -1;
      window.requestAnimationFrame = (cb) => raf((t) => { w.__frameT = t; cb(t); });
    });
    await open(page, 'cam=wander&q=high&hud=0&pose=-0.426,0.3515,0.2406,0.7982,0.83');
    await page.evaluate(() => {
      type Tile = { count: number; pages: number[][] };
      type Layer = { tiles: Map<string, Tile>; update: (view: unknown) => void };
      const g = window as unknown as {
        __frameT: number;
        __frames: { frames: number; drops: number; blank: number; resizes: number };
        __world: { grass: { layer: Layer }; flowers: { layer: Layer }; scene: { onBeforeRender: () => void; onAfterRender: () => void }; renderer: { setSize: (...a: unknown[]) => unknown } };
      };
      const w = g.__world;
      const stats = { frames: 0, drops: 0, blank: 0, resizes: 0 };
      g.__frames = stats;
      const key = (t: Tile): string => t.pages.map((p) => p.join(',')).join('|');
      const layers = [w.grass.layer, w.flowers.layer];
      const atUpdate = new Map<Layer, Map<Tile, string>>();
      for (const layer of layers) {
        const update = layer.update.bind(layer);
        layer.update = (view) => {
          update(view);
          atUpdate.set(layer, new Map([...layer.tiles.values()].map((t) => [t, key(t)])));
        };
      }
      // a tile already showing blades whose pages move between the update (which decides what is drawn) and the draw
      let drawnT = -2;
      w.scene.onBeforeRender = () => {
        if (g.__frameT === drawnT) return;
        drawnT = g.__frameT;
        stats.frames++;
        for (const layer of layers) {
          for (const [t, before] of atUpdate.get(layer) ?? []) if (before.replace(/[|,]/g, '') !== '' && t.count > 0 && key(t) !== before) stats.drops++;
        }
      };
      // a resize in a frame after the scene was drawn throws the drawn frame away
      const setSize = w.renderer.setSize.bind(w.renderer);
      w.renderer.setSize = (...a) => {
        stats.resizes++;
        if (g.__frameT === drawnT) stats.blank++;
        return setSize(...a);
      };
      // and change the tier from inside a frame, after its draw, as the quality controller can
      let asked = false;
      w.scene.onAfterRender = () => {
        if (asked || stats.frames < 60) return;
        asked = true;
        queueMicrotask(() => window.__meadow?.set('quality.tier', 'medium'));
      };
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3000);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => (window as unknown as { __frames: { frames: number; drops: number; blank: number; resizes: number } }).__frames);
    test.info().annotations.push({ type: 'frames', description: `${s.frames} frames, ${s.resizes} resizes, ${s.blank} blank, ${s.drops} tile drops` });
    expect(s.frames).toBeGreaterThan(60);
    expect(s.resizes).toBeGreaterThan(0);
    expect(s.blank).toBe(0);
    expect(s.drops).toBe(0);
  });
});

test.describe('budgets', () => {
  test('first frame within 2 s', async ({ page }) => {
    await open(page, 'q=high');
    const stats = await page.evaluate(() => window.__meadow?.stats());
    expect(stats?.firstFrameMs).toBeLessThan(2000);
  });

  test('draw calls stay within budget in Overview and Wander', async ({ page }) => {
    for (const cam of ['overview', 'wander']) {
      await open(page, `q=high&hud=0&t=12&cam=${cam}`);
      await page.evaluate(async () => window.__meadow?.settle());
      await page.waitForTimeout(300);
      const stats = await page.evaluate(() => window.__meadow?.stats());
      expect(stats?.drawCalls, cam).toBeLessThanOrEqual(120);
    }
  });
});

test.describe('state', () => {
  test('the URL hash round-trips through the store', async ({ page }) => {
    await open(page, 'seed=77&g=0.42&ws=0.9&q=high&t=3');
    expect(await page.evaluate(() => window.__meadow?.getHash())).toBe('seed=77&g=0.42&ws=0.9&q=high&t=3');
  });

  test('setHash applies a full state and resets what it omits', async ({ page }) => {
    await open(page, 'seed=77&ws=0.9&q=high');
    await page.evaluate(() => window.__meadow?.setHash('#seed=5&q=high'));
    expect(await page.evaluate(() => window.__meadow?.getHash())).toBe('seed=5&q=high');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#seed=5&q=high');
  });
});

test.describe('not yet automated', () => {
  test.fixme('no LOD rings during a 10 s dolly: per-frame image deltas without ring-shaped spikes (crack-freeness is covered on the CPU in chunks.test.ts)', () => {});
});
