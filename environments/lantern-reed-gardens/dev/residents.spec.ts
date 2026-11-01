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
  rig: { poseString(): string };
}

async function open(page: Page, hash = 'q=high&t=12&hud=0'): Promise<void> {
  await page.goto(`/environments/lantern-reed-gardens/#${hash}`);
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
  await page.screenshot({ path: 'shots/lantern-reed-gardens/settlement.png' });
});

test('find, greet, rename and reload a resident without changing meadow storage', async ({ page }) => {
  await open(page, 'q=medium&hud=0');
  const original = 'meadow-preferences-untouched';
  await page.evaluate(value => localStorage.setItem('muses-garden.garden.v1', value), original);
  await page.getByRole('button', { name: 'Meet Luma', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop following', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.followingResident)).toBeNull();
  await page.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.residents.members[0].activity)).toMatch(/hello|greet|wave|waving/i);
  await page.getByRole('textbox', { name: 'Resident name' }).fill('Lumi');
  await page.getByRole('textbox', { name: 'Resident name' }).press('Tab');
  await expect(page.getByRole('button', { name: 'Meet Lumi', exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Meet Lumi', exact: true })).toBeVisible();
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

test('planet and garden views work on desktop and a narrow viewport', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Orbit', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/lantern-reed-gardens/planet.png' });
  await page.getByRole('button', { name: 'Causeway', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await page.screenshot({ path: 'shots/lantern-reed-gardens/causeway.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Meet Mallow', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  await expect(page.getByRole('button', { name: 'Say hello', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'shots/lantern-reed-gardens/mobile-resident.png' });
});


test('daylight and dusk warm the lanterns without breaking a shared view', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Causeway', exact: true }).click();
  const sample = async (): Promise<{ dusk: number; hash: string | undefined }> => page.evaluate(async () => {
    await window.__meadow?.settle();
    return { dusk: (window as unknown as { __world: { shared: { uLanternDusk: { value: number } } } }).__world.shared.uLanternDusk.value, hash: window.__meadow?.frameHash() };
  });
  await page.getByRole('button', { name: 'Daylight', exact: true }).click();
  const day = await sample();
  await expect(page.getByRole('button', { name: 'Daylight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'shots/lantern-reed-gardens/daylight.png' });
  await page.getByRole('button', { name: 'Dusk', exact: true }).click();
  const dusk = await sample();
  await expect(page.getByRole('button', { name: 'Dusk', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(day.dusk).toBe(0);
  expect(dusk.dusk).toBeGreaterThan(0.9);
  expect(dusk.hash).not.toBe(day.hash);
  await page.screenshot({ path: 'shots/lantern-reed-gardens/dusk.png' });
});

test('shared views restore pitch and stop following; an omitted pose restores the default', async ({ page }) => {
  await open(page);
  const pose = async (): Promise<string> => page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.rig.poseString());
  const initial = await pose();
  await page.getByRole('button', { name: 'Causeway', exact: true }).click();
  await page.evaluate(async () => window.__meadow?.settle());
  const causeway = await pose();
  const saved = await page.evaluate(() => window.__meadow!.getHash());
  expect(Number(causeway.split(',')[5])).not.toBe(0);
  await page.getByRole('button', { name: 'Orbit', exact: true }).click();
  await page.evaluate(async saved => { window.__meadow!.setHash(saved); await window.__meadow!.settle(); }, saved);
  expect(await pose()).toBe(causeway);
  await page.getByRole('button', { name: 'Meet Luma', exact: true }).click();
  await page.evaluate(async saved => { window.__meadow!.setHash(saved); await window.__meadow!.settle(); }, saved);
  expect(await pose()).toBe(causeway);
  expect(await page.evaluate(() => (window as unknown as { __world: WorldProbe }).__world.followingResident)).toBeNull();
  await page.evaluate(async () => { window.__meadow!.setHash('q=high&t=12&hud=0'); await window.__meadow!.settle(); });
  expect(await pose()).toBe(initial);
  expect(await page.evaluate(() => window.__meadow!.getHash())).not.toContain('pose=');
});

test('Reset stops active growth and bloom playback', async ({ page }) => {
  await open(page);
  const growth = page.getByRole('slider', { name: 'Growth', exact: true });
  const bloom = page.getByRole('slider', { name: 'Bloom', exact: true });
  const initial = [await growth.inputValue(), await bloom.inputValue()];
  await page.getByRole('button', { name: 'Grow', exact: true }).click();
  await page.getByRole('button', { name: 'Bloom', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grow', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bloom', exact: true })).toBeVisible();
  await page.evaluate(async () => window.__meadow!.settle());
  expect([await growth.inputValue(), await bloom.inputValue()]).toEqual(initial);
});
