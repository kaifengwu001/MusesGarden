import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type {} from '../../dev/harnessApi';
import type { BasketView, MuseId, NowView, Page as ApiPage, PhotoView, WorldView } from '../contract';

// The overlay on the real engine: fast-forward the clock through the dev API, act the way an owner would in the
// page, and assert what changed. Screenshots for a human eye go to shots/muse-live/.

const API = 'http://localhost:8787/api';
const SHOTS = 'shots/muse-live';
const HERO = 'hero';

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function open(page: Page, muse: string): Promise<void> {
  await page.goto(`/?muse=${muse}&dev#hud=0`);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
  await expect(page.locator('.mu-status .mu-name').first()).not.toHaveText('');
}

async function get<T>(api: APIRequestContext, path: string): Promise<T> {
  const r = await api.get(`${API}${path}`);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

async function post(api: APIRequestContext, path: string, body?: unknown): Promise<void> {
  const r = await api.post(`${API}${path}`, body === undefined ? {} : { data: body });
  expect(r.ok(), `POST ${path} → ${r.status()} ${await r.text()}`).toBe(true);
}

const advance = (api: APIRequestContext, hours: number) => post(api, '/dev/advance', { hours });
const now = (api: APIRequestContext, muse = HERO) => get<NowView>(api, `/muses/${muse}/now`);

/** The overlay opens the mailbox by itself when an invitation is waiting; only click it open when it isn't. */
async function openMailbox(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
  const mailbox = page.locator('.mu-mailbox');
  if (!(await mailbox.isVisible())) await page.locator('.mu-dock').getByRole('button', { name: /Mailbox/ }).click();
  await expect(mailbox).toBeVisible();
}

/** Whether the world drew the 3D Muse this frame (dev builds expose the world). */
const museDrawn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __world?: { muse: { mesh: { visible: boolean } } } }).__world?.muse.mesh.visible ?? null);

/** The camera to Muse (M in the meadow), then a moment for the glide and the body to load. */
async function toMuse(page: Page): Promise<void> {
  await page.locator('#scene').focus();
  await page.keyboard.press('m');
  await page.waitForTimeout(3500);
}

/** Advance an hour at a time until `done` holds, or fail after `maxHours`. */
async function until<T>(api: APIRequestContext, maxHours: number, done: () => Promise<T | null>): Promise<T> {
  for (let h = 0; h <= maxHours; h++) {
    const v = await done();
    if (v !== null) return v;
    await advance(api, 1);
  }
  throw new Error(`not reached within ${maxHours} simulated hours`);
}

test('the owner checks live behaviour on the real engine', async ({ page, request: api }) => {
  const muses = await get<{ museId: MuseId; name: string }[]>(api, '/muses');
  expect(muses.map((m) => m.museId)).toContain(HERO);
  const heroName = muses.find((m) => m.museId === HERO)?.name ?? '';

  await test.step('the overlay shows the live garden, not samples', async () => {
    await open(page, HERO);
    await expect(page.locator('.mu-status .mu-name').first()).toHaveText(heroName);
    await expect(page.locator('.mu-status .mu-tag')).toBeHidden();
    await shot(page, '01-start');
  });

  await test.step('Muse moves on as time passes', async () => {
    const before = await now(api);
    const changed = await until(api, 12, async () => {
      const n = await now(api);
      return n.since !== before.since ? n : null;
    });
    await page.reload();
    await page.waitForFunction(() => window.__meadow?.isReady === true);
    await expect(page.locator('.mu-status .mu-label').first()).toHaveText(changed.label);
    await shot(page, '02-moved-on');
  });

  await test.step('work puts the laptop out in place, and Muse picks up where it was', async () => {
    const travelling = await until(api, 24, async () => {
      const n = await now(api);
      return n.activity === 'travel' && !n.working && n.path ? n : null;
    });
    await page.reload();
    await page.waitForFunction(() => window.__meadow?.isReady === true);
    await toMuse(page);
    expect(await museDrawn(page), 'the 3D Muse is drawn out on its planet').toBe(true);
    await shot(page, '03a-muse-out-on-the-planet');
    await page.locator('.mu-dev').getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('.mu-status .mu-label').first()).toHaveText('Working (laptop out)');
    await toMuse(page);
    await shot(page, '03b-muse-laptop-out');
    const working = await now(api);
    expect(working.working).toBe(true);
    expect(working.activity).toBe('travel');
    expect(working.since).toBe(travelling.since);
    expect(working.path?.at(-1)?.dir).toEqual(travelling.path?.at(-1)?.dir);
    await shot(page, '03-working-in-place');
    await advance(api, 2);
    expect((await now(api)).since, 'two hours of work later, the same trip').toBe(travelling.since);
    await page.locator('.mu-dev').getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('.mu-status .mu-label').first()).not.toHaveText('Working (laptop out)');
    expect((await now(api)).working).toBe(false);
  });

  await test.step('at rest, the 3D Muse is home on its terrace', async () => {
    await until(api, 24, async () => ((await now(api)).activity === 'rest' ? true : null));
    await page.reload();
    await page.waitForFunction(() => window.__meadow?.isReady === true);
    await toMuse(page);
    expect(await museDrawn(page), 'the 3D Muse is drawn at home').toBe(true);
    await shot(page, '03c-muse-at-home');
  });

  await test.step('when Muse is beyond or away, there is no following it', async () => {
    const away = await until(api, 96, async () => {
      const n = await now(api);
      return n.away ? n : null;
    });
    expect(away.path).toBeNull();
    await page.reload();
    await page.waitForFunction(() => window.__meadow?.isReady === true);
    const status = page.locator('.mu-status').first();
    await expect(status.locator('.mu-label')).toHaveText(away.label);
    await expect(status.getByRole('button', { name: 'Follow' })).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(await museDrawn(page), 'no 3D Muse while it is away').toBe(false);
    await shot(page, '04-away-no-follow');
  });

  await test.step('baskets arrive with history, and Show on planet glides to the object', async () => {
    await until(api, 7 * 24, async () => {
      const b = await get<ApiPage<BasketView, string>>(api, `/muses/${HERO}/baskets?limit=1`);
      return b.next ? b : null;
    });
    await page.reload();
    await page.waitForFunction(() => window.__meadow?.isReady === true);
    const mailbox = page.locator('.mu-mailbox');
    await openMailbox(page);
    await expect(mailbox.locator('.mu-basket').first()).toBeVisible();
    const firstCards = await mailbox.locator('.mu-basket').first().locator('.mu-card').count();
    expect(firstCards).toBeGreaterThan(0);
    expect(firstCards).toBeLessThanOrEqual(7);
    const served = await get<ApiPage<BasketView, string>>(api, `/muses/${HERO}/baskets`);
    await expect(mailbox.locator('.mu-basket')).toHaveCount(served.items.length);
    await expect(mailbox.getByRole('button', { name: 'Earlier baskets' })).toHaveCount(served.next ? 1 : 0);
    await shot(page, '05-mailbox-baskets');
    const show = mailbox.getByRole('button', { name: /^Show .* on the planet$/ }).first();
    const label = ((await show.getAttribute('aria-label')) ?? (await show.textContent()) ?? '').replace(/^Show (.*) on the planet$/, '$1');
    await show.click();
    await page.waitForTimeout(2500);
    const glint = page.locator(`.mu-pins button.mu-plant[aria-label="${label}"]`);
    await expect(glint).toHaveClass(/mu-glow/);
    await shot(page, '06-show-on-planet');
    await page.keyboard.press('Escape');
    const photos = await get<ApiPage<PhotoView, string>>(api, `/muses/${HERO}/photos?limit=5`);
    expect(photos.items.length).toBeGreaterThan(0);
  });

  await test.step('every collected object has a glint; hover previews it, a click opens its card without touching the canvas', async () => {
    const world = await get<WorldView>(api, `/muses/${HERO}/world`);
    const glints = page.locator('.mu-pins button.mu-plant');
    await expect(glints).toHaveCount(world.plants.length);
    const anchors = new Set(world.plants.map((p) => p.dir.map((x) => x.toFixed(6)).join(',')));
    expect(anchors.size, 'no two objects share an anchor').toBe(world.plants.length);
    const reachable = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.mu-pins button.mu-plant:not(.mu-off)')];
      const top = buttons.find((b) => {
        const r = b.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b;
      });
      return top?.getAttribute('aria-label') ?? null;
    });
    expect(reachable, 'some object on screen is reachable by the pointer').not.toBeNull();
    const visible = page.locator(`.mu-pins button.mu-plant[aria-label="${reachable ?? ''}"]`).first();
    await expect(visible).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __canvasDowns: number };
      w.__canvasDowns = 0;
      document.querySelector('#scene')?.addEventListener('pointerdown', () => w.__canvasDowns++);
    });
    const name = (await visible.getAttribute('aria-label')) ?? '';
    await visible.hover();
    await expect(page.locator('.mu-preview')).toContainText(name);
    await shot(page, '07-object-hover');
    await visible.click();
    const card = page.locator('.mu-object');
    await expect(card).toBeVisible();
    const plant = world.plants.find((p) => p.preview.title === name);
    expect(plant).toBeDefined();
    const href = await card.getByRole('link', { name: 'Open ↗' }).getAttribute('href');
    expect(href).toMatch(/^https:\/\//);
    expect(await page.evaluate(() => (window as unknown as { __canvasDowns: number }).__canvasDowns)).toBe(0);
    await shot(page, '08-object-card');
    await page.keyboard.press('Escape');
  });
});
