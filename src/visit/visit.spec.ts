import { expect, test, type Page } from '@playwright/test';

// A visit on a ticket, on Lantern Reed Gardens, against the sample backend (playwright.visit.config.ts). The sample
// ticket (inv-wren-hero-1) was used 23 h 40 after the sample backend's clock starts, so the tests move that clock on:
// a day to stand inside the visit, then two hours more, past its end. They run in order, on one backend.

const API = `http://localhost:${process.env.VISIT_API_PORT ?? 8812}`;
const VISIT = '/environments/lantern-reed-gardens/?visit=inv-wren-hero-1&as=hero&garden=/api/muses/hero';
const HOME = /\/\?garden=%2Fapi%2Fmuses%2Fhero$/;

interface PlantState {
  readonly id: string;
  readonly public: boolean;
  readonly placed: boolean;
  readonly water: number | null;
}

interface VisitState {
  readonly phase: 'visiting' | 'ended' | 'unreachable';
  readonly planet: string;
  readonly invitation: string;
  readonly together: boolean;
  readonly left: number | null;
  readonly banner: string | null;
  readonly ended: string | null;
  readonly home: string | null;
  readonly host: { readonly museId: string; readonly look: string } | null;
  readonly guest: { readonly museId: string; readonly shown: boolean; readonly apart: number | null } | null;
  readonly plants: readonly PlantState[];
  readonly card: string | null;
}

interface VisitProbe {
  readonly ready: Promise<void>;
  state(): VisitState;
  open(id: string): void;
  flying(): boolean;
}

async function arrive(page: Page): Promise<VisitState> {
  await page.waitForFunction(() => (window as unknown as { __visit?: unknown }).__visit !== undefined, undefined, { timeout: 90_000 });
  await page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.ready);
  return page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.state());
}

test.describe.configure({ mode: 'serial' });

test('the sample visit on Lantern: both Muses together, every plant on dry ground, a public find’s card, the same visit after a reload', async ({ page, request }) => {
  expect((await request.post(`${API}/api/dev/advance`, { data: { hours: 24 } })).ok()).toBe(true);
  await page.goto(VISIT);
  const s = await arrive(page);
  expect(s).toMatchObject({ phase: 'visiting', planet: 'lantern-reed-gardens', invitation: 'inv-wren-hero-1', together: true, ended: null });
  expect(s.banner).toMatch(/^Visiting Wren’s planet 1 h \d\d left Return home$/);
  expect(s.host).toMatchObject({ museId: 'wren', look: 'muse8' });
  expect(s.guest).toMatchObject({ museId: 'hero', shown: true });
  expect(s.guest?.apart, 'the guest at its host’s side').toBeGreaterThan(0.3);
  expect(s.guest?.apart).toBeLessThan(3);
  expect(s.home).toMatch(HOME);
  expect(s.plants.map((p) => [p.id, p.public, p.placed])).toEqual([
    ['w-lichen', true, true],
    ['w-private', false, true],
  ]);
  for (const p of s.plants) expect(p.water, `${p.id} grows on dry ground`).toBeGreaterThan(0);

  await page.evaluate(() => (window as unknown as { __visit: VisitProbe }).__visit.open('w-lichen'));
  await page.waitForFunction(() => (window as unknown as { __visit: VisitProbe }).__visit.state().card === 'w-lichen', undefined, { timeout: 30_000 });
  const card = page.locator('.visit .g-card');
  await expect(card).toContainText('Wren’s garden');
  await expect(card).toContainText('the stump of a fence post overgrown with lichen');
  await expect(page.locator('.visit .g-like')).toBeHidden();
  await expect(page.locator('.visit .g-card-share')).toBeHidden();

  await page.reload();
  const again = await arrive(page);
  expect(again).toMatchObject({ phase: 'visiting', invitation: 'inv-wren-hero-1', together: true });
  // (the sample backend's clock stands still in fast-forward: the same visit counts down from the same end)
  expect(Math.abs((again.left ?? 0) - (s.left ?? 0)), 'the same visit, not a fresh 2 h').toBeLessThan(60_000);
});

/** The garden at home, its post open on the tickets. */
async function post(page: Page): Promise<void> {
  await page.goto('/?garden=/api/muses/hero');
  await page.waitForFunction(() => {
    const w = window as unknown as { __meadow?: { isReady: boolean }; __garden?: unknown };
    return w.__meadow?.isReady === true && w.__garden !== undefined;
  }, undefined, { timeout: 90_000 });
  await page.evaluate(() => (window as unknown as { __garden: { travel(): void } }).__garden.travel());
}

test('a ticket the backend turns down keeps the owner home, and says why', async ({ page }) => {
  await page.route('**/api/muses/hero/garden/reactions', (route) =>
    route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'this invitation is used' }) }),
  );
  await post(page);
  await page.getByRole('button', { name: 'Travel to Lantern Reed Gardens' }).click();
  await expect(page.locator('.g-toast')).toContainText('This ticket has been used already');
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByRole('button', { name: 'Travel to Lantern Reed Gardens' }), 'the ticket is back in the post').toBeVisible();
});

test('boarding the sample ticket in the garden goes to the host’s planet, on this visit', async ({ page }) => {
  await post(page);
  const used = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/muses/hero/garden/reactions'));
  await page.getByRole('button', { name: 'Travel to Lantern Reed Gardens' }).click();
  expect((await used).postDataJSON()).toEqual({ type: 'use-invitation', id: 'inv-wren-hero-1' });
  await page.waitForURL(/\/environments\/lantern-reed-gardens\/\?visit=inv-wren-hero-1&as=hero&garden=%2Fapi%2Fmuses%2Fhero$/, { timeout: 30_000 });
  expect((await arrive(page)).phase).toBe('visiting');
});

test('Return home ends the trip and goes to the guest’s own planet', async ({ page }) => {
  await page.goto(VISIT);
  await arrive(page);
  const returned = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/visits/inv-wren-hero-1/return?as=hero'));
  await page.getByRole('button', { name: 'Return home' }).first().click();
  expect((await (await returned).response())?.status()).toBe(200);
  await page.waitForURL(HOME, { timeout: 30_000 });
});

test('a visit that has ended says so, and goes home on its own', async ({ page, request }) => {
  expect((await request.post(`${API}/api/dev/advance`, { data: { hours: 2 } })).ok()).toBe(true);
  await page.goto(VISIT);
  const s = await arrive(page);
  expect(s.phase).toBe('ended');
  expect(s.ended).toContain('Your visit has ended');
  await expect(page.locator('.visit-ended')).toBeVisible();
  await page.waitForURL(HOME, { timeout: 30_000 });
});

test('a visit is no visit without its ticket: the page is the world as ever', async ({ page }) => {
  await page.goto('/environments/lantern-reed-gardens/');
  await page.waitForFunction(() => (window as unknown as { __meadow?: { isReady: boolean } }).__meadow?.isReady === true, undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as unknown as { __visit?: VisitProbe }).__visit === undefined)).toBe(true);
  await expect(page.locator('.visit')).toHaveCount(0);
  await expect(page.locator('.controlbar')).toBeVisible();
});
