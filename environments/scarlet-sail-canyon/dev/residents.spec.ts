import { expect, test, type Page } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

interface Point { x: number; y: number; z: number }
interface ResidentProbe {
  id: string; name: string; activity: string;
  where: { dir: Point; height: number };
  muse: { mesh: { visible: boolean }; shadowMesh: { visible: boolean }; living: { action: { wave: number; walk: number } } };
}
interface WorldProbe {
  residents: { members: ResidentProbe[]; ready: Promise<void> };
  terrain: { height: (point: Point) => number; radius: number; layout: { seed: number } };
  growth: { radius: number };
  scenery: { group: { children: unknown[] } };
  followingResident: string | null;
}

async function open(page: Page, hash = 'q=high&t=12&hud=0'): Promise<void> {
  await page.goto(`/environments/scarlet-sail-canyon/#${hash}`);
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await page.evaluate(async () => window.__meadow?.settle());
}

test('a living settlement renders with all three residents and no shader errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await open(page);
  await page.getByRole('button', { name: 'Shelter', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const probe = await page.evaluate(() => {
    const w = (window as unknown as { __world: WorldProbe }).__world;
    return {
      residents: w.residents.members.map(r => ({ id: r.id, visible: r.muse.mesh.visible, activity: r.activity, height: r.where.height, ground: w.terrain.height(r.where.dir) })),
      objects: w.scenery.group.children.length,
      stats: window.__meadow?.stats(),
    };
  });
  expect(probe.residents).toHaveLength(3);
  expect(probe.objects).toBeGreaterThan(0);
  for (const resident of probe.residents) {
    expect(resident.visible, resident.id).toBe(true);
    expect(Math.abs(resident.height - resident.ground), resident.id).toBeLessThan(0.03);
  }
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'renderer', description: JSON.stringify(probe.stats) });
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/settlement.png' });
});

test('find, greet, rename and reload a resident without changing meadow storage', async ({ page }) => {
  await open(page, 'q=medium&hud=0');
  const original = 'meadow-preferences-untouched';
  await page.evaluate(value => localStorage.setItem('muses-garden.garden.v1', value), original);
  await page.getByRole('button', { name: 'Meet Pip', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.residents.members[0].activity)).toMatch(/hello|greet|wave|waving/i);
  await page.getByRole('textbox', { name: 'Resident name' }).fill('Pippa');
  await page.getByRole('textbox', { name: 'Resident name' }).press('Tab');
  await expect(page.getByRole('button', { name: 'Meet Pippa', exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Meet Pippa', exact: true })).toBeVisible();
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

test('planet and canyon views work on desktop and a narrow viewport', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Whole planet', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/planet.png' });
  await page.getByRole('button', { name: 'Three Sails', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/three-sails.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Meet Juniper', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await expect(page.getByRole('button', { name: 'Say hello', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'shots/scarlet-sail-canyon/mobile-resident.png' });
});

test('following yields to both its stop button and garden navigation', async ({ page }) => {
  await open(page);
  const following = (): Promise<string | null> => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.followingResident);
  await page.getByRole('button', { name: 'Meet Pip', exact: true }).click();
  await expect.poll(following).toBe('pip');
  await page.getByRole('button', { name: 'Stop following', exact: true }).click();
  await expect.poll(following).toBeNull();
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect.poll(following).toBe('pip');
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
  await page.getByRole('button', { name: 'Preview canyon route for Mossy Hollow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return home', exact: true })).toBeVisible();
  const away = await state();
  expect(away.seed).not.toBe(before.seed);
  expect(away.radius).toBe(before.radius);
  expect(away.invitations).toBe(before.invitations);
  await page.getByRole('button', { name: 'Return home', exact: true }).click();
  await expect.poll(async () => (await state()).seed).toBe(before.seed);
  expect((await state()).invitations).toBe(before.invitations);
});
