import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { areaOfRadius, growthForArea } from '../../../src/planet/growth';
import type { FrameStats } from '../../../src/dev/harnessApi';

const OUT = 'shots/violet-dunes/refinement';
const FROZEN_TIME = 12;
type Preset = 'homestead' | 'meadow' | 'muse';
type Species = 'dune-skipper' | 'seed-glider';

interface Direction {
  x: number;
  y: number;
  z: number;
  clone(): Direction;
  addScaledVector(vector: Direction, scale: number): Direction;
  normalize(): Direction;
}

interface Animal {
  id: string;
  kind: Species;
  dir: number[];
  height: number;
  groundHeight: number;
  clearance: number;
  walking: number;
  perched: number;
  feet: number;
  wings: number;
  finite: boolean;
  visible: boolean;
  maxFootPenetration?: number;
}

interface ProbeWorld {
  terrain: {
    radius: number;
    layout: { cottage: Direction; grain: Direction; homeBearing: Direction };
    height0(dir: Direction): number;
    sample(dir: Direction, out: { height: number; water: number; depth: number; clearing: number; wet: number }): { height: number; water: number; depth: number; clearing: number; wet: number };
  };
  landmarks: {
    instances: Array<{ kind: string; x: number; z: number; yaw: number; scale: number; seed: number }>;
    meshes: Array<{ visible: boolean }>;
    layer: { visibleInstances: number };
  };
  fauna: {
    species: Array<{ id: Species; count: number }>;
    snapshot(): Animal[];
  };
  rig: { setZoom(zoom: number, immediate: boolean): void; lookUp(angle: number, immediate: boolean): void };
}

interface SceneSnapshot {
  radius: number;
  ground: Array<{ height: number; water: number; depth: number; clearing: number; wet: number }>;
  kit: Record<string, number>;
  finitePlacements: boolean;
  visibleKitMeshes: number;
  streamedLandmarks: number;
  species: Array<{ id: Species; count: number }>;
  animals: Animal[];
}

interface ViewEvidence {
  image: string;
  renderImage: string;
  hashes: string[];
  stats: FrameStats;
  scene: SceneSnapshot;
}

async function inspectScene(page: Page): Promise<SceneSnapshot> {
  return page.evaluate(() => {
    const world = (window as unknown as { __world: ProbeWorld }).__world;
    if (!world) throw new Error('world probe missing');
    if (!world.fauna) throw new Error('native fauna system missing');
    const terrain = world.terrain;
    const layout = terrain.layout;
    const dirs = [
      layout.cottage,
      layout.cottage.clone().addScaledVector(layout.grain, 0.06).normalize(),
      layout.cottage.clone().addScaledVector(layout.grain, -0.06).normalize(),
      layout.cottage.clone().addScaledVector(layout.homeBearing, 0.1).normalize(),
      layout.cottage.clone().addScaledVector(layout.homeBearing, -0.1).normalize(),
    ];
    const ground = dirs.map((dir) => terrain.sample(dir, { height: 0, water: 0, depth: 0, clearing: 0, wet: 0 }));
    const kit: Record<string, number> = {};
    for (const instance of world.landmarks.instances) kit[instance.kind] = (kit[instance.kind] ?? 0) + 1;
    return {
      radius: terrain.radius,
      ground,
      kit,
      finitePlacements: world.landmarks.instances.every((p) => [p.x, p.z, p.yaw, p.scale, p.seed].every(Number.isFinite) && p.scale > 0),
      visibleKitMeshes: world.landmarks.meshes.filter((mesh) => mesh.visible).length,
      streamedLandmarks: world.landmarks.layer.visibleInstances,
      species: world.fauna.species.map((species) => ({ ...species })),
      animals: world.fauna.snapshot(),
    };
  });
}

function expectPopulatedDryScene(scene: SceneSnapshot, nearHome: boolean): void {
  expect(Number.isFinite(scene.radius), 'finite radius').toBe(true);
  expect(scene.finitePlacements, 'local kit has finite, positive placements').toBe(true);
  expect(scene.visibleKitMeshes, 'local kit is enabled').toBeGreaterThan(0);
  for (const kind of ['slab', 'block', 'wedge', 'reed', 'comb', 'tussock']) {
    expect(scene.kit[kind] ?? 0, `${kind} is represented in the authored patch`).toBeGreaterThan(0);
  }
  expect(scene.kit.reed, 'substantial sail-reed planting around the composed scene').toBeGreaterThanOrEqual(20);
  expect((scene.kit.comb ?? 0) + (scene.kit.tussock ?? 0), 'mixed low planting forms connected groups').toBeGreaterThanOrEqual(60);
  for (const sample of scene.ground) {
    expect(Object.values(sample).every(Number.isFinite), 'finite terrain sample').toBe(true);
    expect(sample.water, 'positive signed clearance from any shore').toBeGreaterThan(0);
    expect(sample.depth, 'dry terrain has no water depth').toBe(0);
  }
  for (const kind of ['dune-skipper', 'seed-glider'] as const) {
    const animals = scene.animals.filter((animal) => animal.kind === kind);
    expect(animals.length, `${kind} inhabitants exist`).toBeGreaterThan(0);
    expect(scene.species.find((species) => species.id === kind)?.count, `${kind} reported population matches its actual residents`).toBe(animals.length);
    if (nearHome) expect(animals.some((animal) => animal.visible), `${kind} is displayed at useful viewing distances`).toBe(true);
    for (const animal of animals) {
      expect(animal.finite, `${animal.id} has a finite animated transform`).toBe(true);
      expect([animal.height, animal.groundHeight, animal.clearance].every(Number.isFinite), `${animal.id} support samples are finite`).toBe(true);
      if (kind === 'dune-skipper') {
        expect(animal.feet, `${animal.id} has four walking feet`).toBe(4);
        expect(Math.abs(animal.clearance), `${animal.id} body root follows the terrain`).toBeLessThanOrEqual(0.02);
        expect(animal.maxFootPenetration, `${animal.id} feet do not enter the sand`).toBeLessThanOrEqual(0.02);
      }
      if (kind === 'seed-glider') expect(animal.wings, `${animal.id} has two wings`).toBe(2);
    }
  }
}

async function capture(page: Page, name: string): Promise<ViewEvidence> {
  const rendered = await page.evaluate(async () => {
    const m = window.__meadow;
    if (!m) throw new Error('harness missing');
    m.freeze(12);
    m.setScale(1);
    await m.settle();
    await m.settle();
    // Consecutive draws use identical camera, time and completed build state.
    const hashes = [m.frameHash(), m.frameHash(), m.frameHash()];
    return { hashes, stats: m.stats() };
  });
  expect(new Set(rendered.hashes).size, `${name} frozen redraws are deterministic`).toBe(1);
  expect(rendered.stats.frozen).toBe(true);
  expect(rendered.stats.time).toBe(FROZEN_TIME);
  expect(rendered.stats.renderScale).toBe(1);
  expect(rendered.stats.drawCalls, `${name} draws an actual scene`).toBeGreaterThan(0);
  expect(rendered.stats.triangles, `${name} has visible geometry`).toBeGreaterThan(0);
  const scene = await inspectScene(page);
  expectPopulatedDryScene(scene, !name.startsWith('planet-'));
  const image = `${OUT}/${name}.png`;
  await page.locator('#scene').screenshot({ path: image });
  // Save the renderer's pixels as well as the app-context screenshot. This
  // makes material comparison possible without UI covering the landscape.
  const png = await page.evaluate(() => {
    window.__meadow?.renderFrame();
    return document.querySelector<HTMLCanvasElement>('#scene')!.toDataURL('image/png');
  });
  const renderImage = `${OUT}/${name}-render.png`;
  writeFileSync(renderImage, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  return { image, renderImage, ...rendered, scene };
}

test('native orchard ecology and material views survive distance and growth', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrors.push(message.text());
    if (/shader|WebGL|GL_INVALID|THREE\.|framebuffer|ReferenceError|TypeError/i.test(message.text())) errors.push(message.text());
  });
  const evidence: Record<string, ViewEvidence> = {};
  const growthParity: Record<string, ReturnType<NonNullable<typeof window.__meadow>['parity']>> = {};
  try {
    await page.goto(`/environments/violet-dunes/#q=high&hud=0&t=${FROZEN_TIME}`);
    await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 120_000 });
    await page.evaluate(async () => document.fonts.ready);
    await expect(page.locator('#scene')).toBeVisible();
    for (const [name, preset] of [['shelter', 'homestead'], ['survey', 'meadow'], ['muse', 'muse']] as const satisfies ReadonlyArray<readonly [string, Preset]>) {
      await test.step(name, async () => {
        await page.evaluate((view) => window.__meadow?.preset(view), preset);
        evidence[name] = await capture(page, name);
      });
    }

    for (const [name, label] of [['dune-skipper', 'Dune skippers'], ['seed-glider', 'Seed gliders']] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      evidence[name] = await capture(page, name);
    }

    // The same full-globe framing is restored after each growth change, so a
    // carried close-up pitch cannot hide the small or the large planet.
    for (const radius of [40, 128, 400, 128]) {
      const name = radius === 128 && evidence['planet-R128'] ? 'planet-R128-return' : `planet-R${radius}`;
      const growth = growthForArea(areaOfRadius(radius), Math.round(areaOfRadius(40)), Math.round(areaOfRadius(400)));
      await test.step(name, async () => {
        await page.evaluate(async (growth) => {
          const m = window.__meadow;
          if (!m) throw new Error('harness missing');
          m.set('world.growth', growth);
          await m.settle();
          m.preset('homestead');
          await m.settle();
          await m.settle();
        }, growth);
        const parity = await page.evaluate(() => window.__meadow?.parity());
        if (!parity) throw new Error('parity probe missing');
        growthParity[name] = parity;
        expect(parity.samples, `${name} GPU sample coverage`).toBe(64);
        expect(parity.heightError, `${name} CPU/GPU ground agreement`).toBeLessThan(0.02);
        expect(parity.waterError, `${name} dry-shore agreement`).toBeLessThan(0.12);
        expect(parity.warpError, `${name} CPU/GPU warp agreement`).toBeLessThan(0.005);
        await page.evaluate(async () => {
          const m = window.__meadow;
          if (!m) throw new Error('harness missing');
          const world = (window as unknown as { __world: ProbeWorld }).__world;
          world.rig.setZoom(0, true);
          world.rig.lookUp(0, true);
          await m.settle();
        });
        evidence[name] = await capture(page, name);
        expect(evidence[name].scene.radius).toBeCloseTo(radius, 2);
        const pick = await page.evaluate(() => window.__meadow?.pick(0, 0));
        expect(pick, `${name} centre picks the displayed globe`).not.toBeNull();
        expect(pick?.dir.every(Number.isFinite), `${name} picking returns a finite direction`).toBe(true);
      });
    }
    expect(evidence['planet-R128-return'].hashes[0], 'growth reversal restores the same complete planet').toBe(evidence['planet-R128'].hashes[0]);
    expect(errors, 'runtime and shader errors').toEqual([]);
  } finally {
    writeFileSync(`${OUT}/evidence.json`, `${JSON.stringify({ frozenTime: FROZEN_TIME, renderScale: 1, errors, consoleErrors, growthParity, views: evidence }, null, 2)}\n`);
  }
});

// A compact visual framing search, using the world's own camera function.
// Captures are reviewed against the concept; they are not acceptance assertions.
test('camera composition review', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto('/environments/violet-dunes/#q=high&hud=0&t=12');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 120_000 });
  const views = [
    { name: 'A', height: 5, distance: 24, azimuth: -0.6, at: [5, 1, 3] },
    { name: 'B', height: 7, distance: 27, azimuth: -0.6, at: [5, 1, 3] },
    { name: 'C', height: 5, distance: 24, azimuth: -0.45, at: [5, 1, 3] },
  ];
  for (const view of views) {
    await page.evaluate(async (view) => {
      const w = (window as unknown as { __world: { frameHome(view: unknown, immediate: boolean): void } }).__world;
      w.frameHome(view, true);
      await window.__meadow?.settle();
      await window.__meadow?.settle();
    }, view);
    await page.locator('#scene').screenshot({ path: `${OUT}/camera-${view.name}.png` });
  }
});
