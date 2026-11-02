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
    const sorted = (k: 'jsMs' | 'frameMs'): number[] => log.map((f) => f[k]).sort((a, b) => a - b);
    const js = sorted('jsMs');
    const frames = sorted('frameMs');
    const build = Math.max(...log.map((f) => f.buildMs));
    const p95 = (a: number[]): number => a[Math.floor(a.length * 0.95)];
    test.info().annotations.push({ type: 'scrub', description: `frame p95 ${p95(frames).toFixed(2)} ms, JS p95 ${p95(js).toFixed(2)} ms, max ${js.at(-1)!.toFixed(2)} ms, build slice max ${build.toFixed(2)} ms` });
    // Re-tiling as the planet grows is a backlog, which the queue catches up on after each frame (in a
    // task of its own, overlapping the GPU's work) with a slice that grows while frames keep time
    // (core/buildBudget.ts, to 8 ms on a desktop): the frames hold 60 fps (p95 16.7–16.8 ms on the
    // M1 Pro, as with iteration 13's 3.6 ms slice inside the frame), the frame's own JS stays well
    // within it, and the slice within its ceiling.
    expect(p95(frames)).toBeLessThan(20);
    expect(p95(js)).toBeLessThan(12.7);
    expect(build).toBeLessThan(8.6); // 8 ms, at most one short job step over
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

test.describe('colour', () => {
  test('under MSAA no pixel of the scene leaves the range of its colours', async ({ page }) => {
    // At DPR 1 the scene target carries MSAA. A pixel partly covered by a
    // sub-pixel triangle (a floret, a star's point edge-on) was shaded at its
    // centre, outside the triangle, and its per-vertex colour extrapolated to
    // −23…+49: black and hot specks that flickered on 1× screens.
    await open(page, 'cam=wander&q=high&hud=0&pose=-0.426,0.3515,0.2406,0.7982,0.83');
    const r = await page.evaluate(async () => {
      type Target = { width: number; depthBuffer: boolean };
      type Renderer = {
        getContext: () => WebGL2RenderingContext;
        getRenderTarget: () => Target | null;
        render: (scene: unknown, camera: unknown) => void;
        properties: { get: (t: Target) => { __webglFramebuffer: WebGLFramebuffer } };
      };
      const m = window.__meadow;
      if (!m) throw new Error('harness missing');
      const w = (window as unknown as { __world: { renderer: Renderer; scene: unknown } }).__world;
      m.setScale(1);
      await m.settle();
      const gl = w.renderer.getContext();
      // the scene target: the full-size target the world is drawn into
      const found: { target: Target | null } = { target: null };
      const render = w.renderer.render.bind(w.renderer);
      w.renderer.render = (scene, camera) => {
        const t = w.renderer.getRenderTarget();
        if (scene === w.scene && t && t.depthBuffer && t.width === gl.drawingBufferWidth) found.target = t;
        render(scene, camera);
      };
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = new Float32Array(W * H * 4);
      let low = Infinity;
      let high = -Infinity;
      // a few moments of the flowers' flutter
      for (const t of [3, 7.1, 11.6, 24.3]) {
        m.freeze(t);
        m.renderFrame();
        if (!found.target) throw new Error('scene target not found');
        gl.bindFramebuffer(gl.FRAMEBUFFER, w.renderer.properties.get(found.target).__webglFramebuffer);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (let i = 0; i < px.length; i += 4) {
          low = Math.min(low, px[i], px[i + 1], px[i + 2]);
          high = Math.max(high, px[i], px[i + 1], px[i + 2]);
        }
      }
      return { samples: m.stats().samples, low, high };
    });
    test.info().annotations.push({ type: 'colour', description: `MSAA ${r.samples}×, scene colours ${r.low.toFixed(3)} to ${r.high.toFixed(3)}` });
    expect(r.samples).toBeGreaterThan(0);
    expect(r.low).toBeGreaterThanOrEqual(0);
    expect(r.high).toBeLessThan(3);
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

test.describe('finds', () => {
  /** What these tests reach of the garden's dev probe (ui/garden/gardenUi.ts installProbe). */
  interface V3 {
    x: number;
    y: number;
    z: number;
    clone(): V3;
    set(x: number, y: number, z: number): V3;
    dot(v: V3): number;
  }
  interface GardenProbe {
    state: { snapshot?: unknown; receive(event: unknown): void; visit(basket: string): void };
    pins(shown: boolean): void;
    flying(): boolean;
    ui: {
      world: {
        terrain: { layout: { cottage: V3 }; sample(dir: V3, out: Record<string, number>): { water: number; clearing: number } };
        growth: { radius: number };
        warp: { k: number };
        rig: { camera: { position: V3 }; lookAlong(dir: V3, forward: V3): void };
      };
      project(dir: V3, height: number, width: number, height2: number): { x: number; y: number } | null;
      musePlace(): { dir: V3; ground: number };
      tap(x: number, y: number, width: number, height: number): boolean;
    };
    layout(): { beds: Map<string, { dir: V3; ground: number }> };
    beds: {
      meshes: Array<{ geometry: { attributes: Record<string, { array: ArrayBufferView }> } }>;
      spheres: { geometry: { attributes: Record<string, { array: ArrayBufferView }>; drawRange: { count: number } } };
    };
  }

  /** A garden with nothing in it yet, served in place of a backend. */
  const EMPTY = {
    muse: { name: 'Muse', soul: 'Quiet.', status: { home: true }, reach: 'shared' },
    interests: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `topic-${i}`, name: `Topic ${i}`, species: i % 4, variant: (i * 0.37) % 1, shared: true, since: '2026-10-01' })),
    friends: [],
    baskets: [],
    finds: [],
    postcards: [],
  };

  async function openEmpty(page: Page, hash: string): Promise<void> {
    await page.route('**/no-finds/garden', (route) => route.fulfill({ json: EMPTY }));
    await page.route('**/no-finds/garden/events', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 3600000\n\n' }));
    // (a URL that differs only in its hash would not load the page again)
    await page.goto('about:blank');
    await page.goto(`/?garden=/no-finds#${hash}`);
    await page.waitForFunction(() => window.__meadow?.isReady === true && (window as unknown as { __garden?: GardenProbe }).__garden?.state.snapshot !== undefined, undefined, { timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { __garden: GardenProbe }).__garden.pins(false));
  }

  /** A basket of `count` finds scattered over the planet's land, opened. */
  async function scatter(page: Page, count: number): Promise<number> {
    return page.evaluate((count) => {
      const g = (window as unknown as { __garden: GardenProbe }).__garden;
      const terrain = g.ui.world.terrain;
      const ground = { height: 0, water: 0, depth: 0, clearing: 0, wet: 0 };
      const basket = { id: 'scattered', day: '2026-10-30', finds: [] as string[] };
      const finds: unknown[] = [];
      let h = 7;
      const next = (): number => (h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296;
      while (finds.length < count) {
        const z = next() * 2 - 1;
        const a = next() * Math.PI * 2;
        const s = Math.sqrt(1 - z * z);
        const dir = terrain.layout.cottage.clone().set(s * Math.cos(a), s * Math.sin(a), z);
        // on land, clear of the cottage (as placement.ts lays beds out)
        if (terrain.sample(dir, ground).water < 1 || ground.clearing > 0.05) continue;
        const id = `scattered-${finds.length}`;
        basket.finds.push(id);
        finds.push({ id, basket: basket.id, topic: `topic-${finds.length % 8}`, media: { kind: 'post', url: 'https://example.com', source: 'Example' }, place: [dir.x, dir.y, dir.z] });
      }
      g.state.receive({ type: 'basket', basket, finds });
      g.state.visit(basket.id);
      return g.beds.spheres.geometry.drawRange.count;
    }, count);
  }

  async function steady(page: Page): Promise<{ drawCalls: number; triangles: number; submitted: number; gpuBytes: number; gpuFrameMs: number }> {
    await page.evaluate(async () => window.__meadow?.settle());
    return page.evaluate(() => {
      const m = window.__meadow;
      if (!m) throw new Error('harness missing');
      m.renderFrame();
      const s = m.stats();
      return { drawCalls: s.drawCalls, triangles: s.triangles, submitted: s.trianglesSubmitted, gpuBytes: s.gpuBytes, gpuFrameMs: m.benchmark(60) };
    });
  }

  test('400 finds add four draws of patches near the ground and one of spheres high up, stay in the memory budget, and fit their buffers in 1 MB', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const MB = 2 ** 20;
    const notes: string[] = [];
    for (const cam of ['wander', 'overview']) {
      await openEmpty(page, `q=high&hud=0&t=12&cam=${cam}`);
      const before = await steady(page);
      expect(await scatter(page, 400)).toBe(400);
      const after = await steady(page);
      notes.push(`${cam}: draw calls ${before.drawCalls} → ${after.drawCalls}, triangles ${before.triangles} → ${after.triangles} (submitted ${before.submitted} → ${after.submitted}), GPU ${(before.gpuBytes / MB).toFixed(2)} → ${(after.gpuBytes / MB).toFixed(2)} MB, GPU-bound frame ${before.gpuFrameMs.toFixed(2)} → ${after.gpuFrameMs.toFixed(2)} ms`);
      // near the ground the patches, one draw per species of flower (findBeds.ts); high up only the spheres
      expect(after.drawCalls - before.drawCalls, cam).toBeLessThanOrEqual(cam === 'wander' ? 4 : 1);
      expect(after.gpuBytes, cam).toBeLessThan(256 * MB);
    }
    const findBytes = await page.evaluate(() => {
      const { meshes, spheres } = (window as unknown as { __garden: GardenProbe }).__garden.beds;
      const buffers = [...meshes, spheres].flatMap((m) => Object.values(m.geometry.attributes).map((a) => a.array));
      return buffers.reduce((sum, b) => sum + b.byteLength, 0);
    });
    notes.push(`patches and spheres of 400 finds: ${(findBytes / 1e6).toFixed(3)} MB`);
    test.info().annotations.push({ type: 'finds', description: notes.join('; ') });
    expect(findBytes).toBeLessThanOrEqual(1_000_000);
    expect(errors).toEqual([]);
  });

  test('from far out every find shows one sphere at its true place, and those past the horizon none', async ({ page }) => {
    // no clouds and no Muse, which would stand in front of some finds where the planet is picked through them
    await openEmpty(page, 'q=high&hud=0&t=12&cam=overview&cc=0&mu=0');
    await page.evaluate(async () => window.__meadow?.settle());
    // the frame without finds, kept in the page to compare against
    const read = (): void => {
      const m = window.__meadow;
      const gl = document.querySelector('canvas')?.getContext('webgl2');
      if (!m || !gl) throw new Error('harness missing');
      m.renderFrame();
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      (window as unknown as { __frames: Uint8Array[] }).__frames = [...((window as unknown as { __frames?: Uint8Array[] }).__frames ?? []), px];
    };
    await page.evaluate(read);
    expect(await scatter(page, 400)).toBe(400);
    await page.evaluate(async () => window.__meadow?.settle());
    await page.evaluate(read);
    const seen = await page.evaluate(() => {
      const g = (window as unknown as { __garden: GardenProbe }).__garden;
      const m = window.__meadow;
      const [before, after] = (window as unknown as { __frames: Uint8Array[] }).__frames;
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2');
      if (!m || !canvas || !gl) throw new Error('harness missing');
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const R = g.ui.world.growth.radius;
      const camera = g.ui.world.rig.camera.position;
      /** The most the frame brightened (0–255) within 2 px of a point on screen, and how bright it was. */
      const rise = (x: number, y: number): { rise: number; was: number } => {
        let most = -255;
        let was = 0;
        const bx = Math.round((x * W) / w);
        const by = H - 1 - Math.round((y * H) / h);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const i = ((by + dy) * W + bx + dx) * 4;
            const luma = (p: Uint8Array): number => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
            most = Math.max(most, luma(after) - luma(before));
            was = Math.max(was, luma(before));
          }
        }
        return { rise: Math.round(most), was: Math.round(was) };
      };
      const finds = [...g.layout().beds.entries()].map(([id, bed]) => {
        const at = bed.dir.clone().set(bed.dir.x * (R + bed.ground), bed.dir.y * (R + bed.ground), bed.dir.z * (R + bed.ground));
        const toCamera = camera.clone().set(camera.x - at.x, camera.y - at.y, camera.z - at.z);
        const facing = bed.dir.dot(toCamera) / Math.hypot(toCamera.x, toCamera.y, toCamera.z);
        const screen = g.ui.project(bed.dir, bed.ground + 0.6, w, h);
        const hit = screen && m.pick((screen.x / w) * 2 - 1, 1 - (screen.y / h) * 2);
        const reach = hit ? Math.acos(Math.min(1, hit.dir[0] * bed.dir.x + hit.dir[1] * bed.dir.y + hit.dir[2] * bed.dir.z)) * R : Infinity;
        return { id, facing, screen, reach };
      });
      const onScreen = (s: { x: number; y: number } | null): s is { x: number; y: number } => s !== null && s.x > 4 && s.y > 4 && s.x < w - 4 && s.y < h - 4;
      // in sight: facing the camera, and the planet picked there is the find's own ground
      const visible = finds.filter((f) => f.facing > 0.1 && f.reach < 3 && onScreen(f.screen));
      const hidden = finds.filter((f) => f.facing < -0.05 && onScreen(f.screen));
      // a sphere is a few dozen pixels across: past the horizon, judge only where no other find's sphere might reach
      const near = finds.filter((f) => f.facing >= -0.05 && f.screen);
      const clear = hidden.filter((f) => near.every((v) => Math.hypot(v.screen!.x - f.screen!.x, v.screen!.y - f.screen!.y) > 0.025 * h));
      const report = (f: (typeof finds)[number]): { id: string; rise: number; was: number; facing: number; at: string } => ({
        id: f.id,
        ...rise(f.screen!.x, f.screen!.y),
        facing: Math.round(f.facing * 100) / 100,
        at: `${Math.round(f.screen!.x)},${Math.round(f.screen!.y)}`,
      });
      return { k: g.ui.world.warp.k, spheres: g.beds.spheres.geometry.drawRange.count, visible: visible.map(report), hidden: clear.map(report) };
    });
    test.info().annotations.push({ type: 'spheres', description: `${seen.spheres} spheres; ${seen.visible.length} finds in sight, dimmest brightened ${Math.min(...seen.visible.map((v) => v.rise)).toFixed(0)}; ${seen.hidden.length} past the horizon clear of others, brightest ${Math.max(...seen.hidden.map((v) => v.rise)).toFixed(0)}` });
    expect(Math.abs(seen.k)).toBeLessThan(1e-6);
    expect(seen.spheres).toBe(400);
    expect(seen.visible.length).toBeGreaterThan(100);
    expect(seen.hidden.length).toBeGreaterThan(10);
    expect(seen.visible.filter((v) => v.rise < 40)).toEqual([]);
    expect(seen.hidden.filter((v) => v.rise > 6)).toEqual([]);
  });

  test('from orbit Muse’s pin stands over its place as soon as the garden loads, and a tap on it flies to Muse', async ({ page }) => {
    await openEmpty(page, 'q=high&hud=0&t=12&cam=overview');
    await page.evaluate(() => {
      const g = (window as unknown as { __garden: GardenProbe }).__garden;
      g.pins(true);
      // still in orbit, over Muse, north up
      const d = g.ui.musePlace().dir;
      const n = Math.hypot(d.x * d.y, 1 - d.y * d.y, d.z * d.y);
      g.ui.world.rig.lookAlong(d, d.clone().set((-d.x * d.y) / n, (1 - d.y * d.y) / n, (-d.z * d.y) / n));
    });
    // a tap a little above the place, on the bubble
    const tapped = (): Promise<boolean> =>
      page.evaluate(() => {
        const g = (window as unknown as { __garden: GardenProbe }).__garden;
        const muse = g.ui.musePlace();
        const at = g.ui.project(muse.dir, muse.ground, innerWidth, innerHeight);
        return at !== null && g.ui.tap(at.x, at.y - 0.04 * innerHeight, innerWidth, innerHeight);
      });
    await expect.poll(tapped, { timeout: 5_000 }).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __garden: GardenProbe }).__garden.flying())).toBe(true);
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
