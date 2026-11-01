import { expect, test, type Page } from '@playwright/test';
import type { Vector3 } from 'three';
import type {} from '../../../src/dev/harnessApi';

interface Point { x: number; y: number; z: number }
interface ResidentProbe {
  id: string; name: string; activity: string;
  where: { dir: Vector3; height: number };
  muse: { mesh: { visible: boolean }; shadowMesh: { visible: boolean }; living: { action: { wave: number; walk: number } } };
}
interface WorldProbe {
  residents: { members: ResidentProbe[]; ready: Promise<void> };
  terrain: { height: (point: Point) => number; radius: number; layout: { seed: number }; cottageLocal: (dir: Vector3, out: { x: number; z: number }) => { x: number; z: number } };
  growth: { radius: number };
  scenery: { group: { children: unknown[] } };
  followingResident: string | null;
  season: 'snow' | 'rain';
  shared: { uSnowAmount: { value: number } };
  rig: { zoom: number; pitch: number; camera: { position: Vector3; aspect: number } };
  neighbourHomes: unknown[];
}

async function open(page: Page, hash = 'q=high&t=12&hud=0'): Promise<void> {
  await page.goto(`/environments/ukiyoe-pine-hamlet/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await page.evaluate(async () => window.__meadow?.settle());
}

test('a living settlement renders with two neighbours and Muse and no shader errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await open(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const probe = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    return {
      residents: w.residents.members.map(r => ({ id: r.id, visible: r.muse.mesh.visible, activity: r.activity, height: r.where.height, ground: w.terrain.height(r.where.dir) })),
      objects: w.scenery.group.children.length,
      homes: w.neighbourHomes.length,
      stats: window.__meadow?.stats(),
    };
  });
  expect(probe.residents).toHaveLength(2);
  expect(probe.objects).toBeGreaterThan(0);
  expect(probe.homes).toBe(2);
  for (const resident of probe.residents) {
    expect(resident.visible, resident.id).toBe(true);
    expect(Math.abs(resident.height - resident.ground), resident.id).toBeLessThan(0.03);
  }
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'renderer', description: JSON.stringify(probe.stats) });
  await page.screenshot({ path: 'shots/ukiyoe-pine-hamlet/settlement.png' });
});

test('find, greet, rename and reload a resident without changing meadow storage', async ({ page }) => {
  await open(page, 'q=medium&hud=0');
  const original = 'meadow-preferences-untouched';
  await page.evaluate(value => localStorage.setItem('muses-garden.garden.v1', value), original);
  await page.getByRole('button', { name: 'Meet Sumi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.residents.members[0].activity)).toMatch(/hello|greet|wave|waving/i);
  await page.getByRole('textbox', { name: 'Neighbour name' }).fill('Sumire');
  await page.getByRole('textbox', { name: 'Neighbour name' }).press('Tab');
  await expect(page.getByRole('button', { name: 'Meet Sumire', exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Meet Sumire', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('muses-garden.garden.v1'))).toBe(original);
});

test('residents remain grounded through growth and seed changes', async ({ page }) => {
  await open(page, 'q=medium&t=22&hud=0');
  for (const seed of [412, 5]) {
    for (const growth of [0, 1, 0.3]) {
      const residents = await page.evaluate(async ({ seed, growth }) => {
        const h = window.__meadow!;
        h.set('world.seed', seed);
        h.set('world.growth', growth);
        await h.settle();
        const w = (window as unknown as { __world: WorldProbe }).__world;
        return w.residents.members.map(r => ({ id: r.id, height: r.where.height, ground: w.terrain.height(r.where.dir), norm: Math.hypot(r.where.dir.x, r.where.dir.y, r.where.dir.z) }));
      }, { seed, growth });
      for (const r of residents) {
        expect(r.norm).toBeCloseTo(1, 5);
        expect(Number.isFinite(r.height)).toBe(true);
        expect(Math.abs(r.height - r.ground)).toBeLessThan(0.03);
      }
    }
  }
});

test('planet and hamlet views work on desktop and a narrow viewport', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Whole planet', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const orbit = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    return { zoom: w.rig.zoom, pitch: w.rig.pitch };
  });
  expect(orbit.zoom).toBe(0);
  expect(orbit.pitch).toBeCloseTo(0, 8);
  await page.screenshot({ path: 'shots/ukiyoe-pine-hamlet/planet.png' });
  await page.getByRole('button', { name: 'Bridge', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/ukiyoe-pine-hamlet/bridge.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Meet Mugi', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await expect(page.getByRole('button', { name: 'Say hello', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobile = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    const garden = (window as unknown as { __garden: { ui: { project: (dir: Vector3, height: number, width: number, screenHeight: number) => { x: number; y: number } | null } } }).__garden.ui;
    const resident = w.residents.members.find(member => member.id === 'mugi')!;
    const dir = resident.where.dir;
    return {
      head: garden.project(dir, resident.where.height + 1.65, innerWidth, innerHeight),
      feet: garden.project(dir, resident.where.height, innerWidth, innerHeight),
      distance: w.rig.camera.position.distanceTo(dir.clone().multiplyScalar(w.terrain.radius + resident.where.height + 0.8)),
      camera: w.terrain.cottageLocal(w.rig.camera.position.clone().normalize(), { x: 0, z: 0 }),
      controlsTop: document.querySelector('.hamlet-detail')!.getBoundingClientRect().top,
    };
  });
  expect(mobile.distance).toBeGreaterThan(4);
  expect(mobile.camera.z).toBeGreaterThan(6);
  expect(mobile.head).not.toBeNull();
  expect(mobile.feet).not.toBeNull();
  expect(mobile.head!.x).toBeGreaterThan(60);
  expect(mobile.head!.x).toBeLessThan(330);
  expect(mobile.head!.y).toBeGreaterThan(110);
  expect(mobile.feet!.y).toBeLessThan(mobile.controlsTop);
  expect(mobile.feet!.y - mobile.head!.y).toBeGreaterThan(90);
  test.info().annotations.push({ type: 'mobile framing', description: JSON.stringify(mobile) });
  await page.screenshot({ path: 'shots/ukiyoe-pine-hamlet/mobile-resident.png' });
});

test('following yields to both its stop button and garden navigation', async ({ page }) => {
  await open(page);
  const following = (): Promise<string | null> => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.followingResident);
  await page.getByRole('button', { name: 'Meet Sumi', exact: true }).click();
  await expect.poll(following).toBe('sumi');
  await page.getByRole('button', { name: 'Stop following', exact: true }).click();
  await expect.poll(following).toBeNull();
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect.poll(following).toBe('sumi');
  await page.getByRole('button', { name: 'Find Muse', exact: true }).click();
  await expect.poll(following).toBeNull();
});

test('a route preview preserves the invitation and restores the home seed', async ({ page }) => {
  await open(page, 'q=medium&t=12&seed=412&g=0.3&hud=0');
  const state = (): Promise<{ seed: number; radius: number; invitations: number }> => page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    const g = (window as unknown as { __garden: { state: { invitations: unknown[] } } }).__garden;
    return { seed: w.terrain.layout.seed, radius: w.growth.radius, invitations: g.state.invitations.length };
  });
  const before = await state();
  await page.getByRole('button', { name: 'Travel to other worlds', exact: true }).click();
  await page.getByRole('button', { name: 'Preview hamlet route for Mossy Hollow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return home', exact: true })).toBeVisible();
  const away = await state();
  expect(away.seed).not.toBe(before.seed);
  expect(away.radius).toBe(before.radius);
  expect(away.invitations).toBe(before.invitations);
  await page.getByRole('button', { name: 'Return home', exact: true }).click();
  await expect.poll(async () => (await state()).seed).toBe(before.seed);
  expect((await state()).invitations).toBe(before.invitations);
});


test('snow and rain change the complete scene and survive reload', async ({ page }) => {
  await open(page);
  const snow = await page.evaluate(() => window.__meadow!.frameHash());
  await page.getByRole('button', { name: 'Rain', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rain', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => window.__meadow?.settle());
  const rain = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    return { season: w.season, snow: w.shared.uSnowAmount.value, frame: window.__meadow!.frameHash() };
  });
  expect(rain.season).toBe('rain');
  expect(rain.snow).toBe(0);
  expect(rain.frame).not.toBe(snow);
  await page.screenshot({ path: 'shots/ukiyoe-pine-hamlet/rain.png' });
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('season=rain');
  await page.reload();
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Rain', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  expect(await page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.shared.uSnowAmount.value)).toBe(1);
});
