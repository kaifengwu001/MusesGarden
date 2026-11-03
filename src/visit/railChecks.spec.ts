import { expect, type Page } from '@playwright/test';

// The visit's rail as a visitor finds it on any planet (visitUi.ts), for visit.spec.ts and worlds.visit.spec.ts (this
// file holds no tests of its own): the guest's Muse with where it is, Find Muse and the host's home, each bringing
// the camera in from orbit to the two Muses or to the host's home; and none of the garden's basket, post or tickets.

interface Body {
  readonly where: { readonly dir: { readonly x: number; readonly y: number; readonly z: number }; readonly height: number };
}

interface Probe {
  readonly __visit: { flying(): boolean };
  readonly __world: {
    readonly rig: { setZoom(z: number, immediate?: boolean): void; readonly camera: { readonly position: { readonly x: number; readonly y: number; readonly z: number } } };
    readonly growth: { readonly radius: number };
    readonly muse: Body;
    readonly visitors: readonly Body[];
    readonly terrain: { readonly layout: { readonly cottage: { readonly x: number; readonly y: number; readonly z: number } }; height(dir: unknown): number };
  };
}

/** How far the camera is (m) from the two Muses' middle, or from the host's home (its house, or the host there, whichever is nearer). */
function reach(page: Page, to: 'pair' | 'home'): Promise<number> {
  return page.evaluate((to) => {
    const { __world: w } = window as unknown as Probe;
    const R = w.growth.radius;
    const c = w.rig.camera.position;
    const point = (dir: Body['where']['dir'], height: number) => [dir.x, dir.y, dir.z].map((v) => v * (R + height));
    const from = (p: number[]) => Math.hypot(c.x - p[0], c.y - p[1], c.z - p[2]);
    const host = point(w.muse.where.dir, w.muse.where.height);
    if (to === 'home') {
      const house = w.terrain.layout.cottage;
      return Math.min(from(host), from(point(house, w.terrain.height(house))));
    }
    const guest = w.visitors[0] ? point(w.visitors[0].where.dir, w.visitors[0].where.height) : host;
    return from(host.map((v, k) => (v + guest[k]) / 2));
  }, to);
}

/** The rail on a visit to `host`'s planet, both Muses together: what it shows, and that each button brings the camera in. */
export async function checkRail(page: Page, host: string): Promise<void> {
  const rail = page.locator('.visit .g-rail');
  await expect(rail).toBeVisible();
  const status = rail.locator('.g-portrait .g-status');
  await expect(status).toHaveText(`Visiting ${host}’s planet`);
  // its pill holds its words (a world's own copy of the garden's stylesheet once pinned it narrower), on the screen
  const fit = await status.evaluate((s) => ({ box: s.getBoundingClientRect(), words: s.scrollWidth, width: s.clientWidth }));
  expect(fit.width, 'the status pill is as wide as its words').toBeGreaterThanOrEqual(fit.words);
  expect(fit.box.left, 'the status stays on the screen').toBeGreaterThanOrEqual(0);
  expect(fit.box.right).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await expect(page.locator('.g-basketbtn, .g-postbox, .g-tickets, .g-ticket'), 'none of the garden’s basket, post or tickets').toHaveCount(0);
  const buttons = [
    { name: `${host}’s home`, to: 'home', near: 100 },
    { name: 'Find Muse', to: 'pair', near: 30 },
  ] as const;
  for (const { name, to, near } of buttons) {
    // out to orbit first, so that coming in is plain
    await page.waitForFunction(() => !(window as unknown as Probe).__visit.flying(), undefined, { timeout: 30_000 });
    await page.evaluate(() => (window as unknown as Probe).__world.rig.setZoom(0, true));
    await page.waitForTimeout(400);
    const far = await reach(page, to);
    expect(far, `${name}: from orbit`).toBeGreaterThan(2 * near);
    await rail.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => reach(page, to), { message: `${name} brings the camera in`, timeout: 15_000 }).toBeLessThan(near);
  }
}
