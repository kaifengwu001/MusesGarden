import { readFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type BrowserContextOptions, type Page } from '@playwright/test';
import type {} from '../../dev/harnessApi';
import type { Find, GardenSnapshot, MediaKind } from '../../garden/types';
import { FIRST_PLANET } from '../../planet/firstPlanet';
import type { InvitationCard, NowView, PlanetId, VisitWorldView } from '../contract';
import { isPlanetId, PLANETS } from '../planets';

// The garden's interface on the real engine: the hero's planet, a basket that arrives over the event stream, opens
// out of the rail with its finds as flowers, and sends them home into their patches where they were found, hover and
// the find card, the spheres from high up, likes and stars that
// reach the engine's log, a find made private, a reconnect that catches up, a card of each kind, a friend known
// elsewhere, and a ticket from the post that takes the hero and Muse to the host's own planet and home again. Screenshots and the basket's recording go to shots/garden-live/.
// Every test shares one engine (playwright.live.config.ts), so each takes what it needs from where the engine
// stands, advancing it when that isn't there yet.

/** The engine (playwright.live.config.ts starts it; MUSE_PORT moves it). */
const ENGINE = `http://localhost:${process.env.MUSE_PORT ?? 8787}`;
const API = `${ENGINE}/api`;
const HERO = 'hero';
const PAGE = `/?dev&garden=/api/muses/${HERO}#hud=0`;
const SHOTS = 'shots/garden-live';
const DB = '.muse-live-e2e/garden.db';
const HERO_SEED = FIRST_PLANET.seed;
/** A bed is nudged at most this far from where its find was found (m, garden/placement.ts). */
const NUDGE_REACH = 24;
/** Above this the spheres have taken over from the patches (m, life/findBeds.ts). */
const HIGH_UP = 120;
const HOUR = 3_600_000;
const KINDS: readonly MediaKind[] = ['reel', 'post', 'article', 'video'];

interface V3 {
  x: number;
  y: number;
  z: number;
}
interface ProbeBed {
  find: string;
  basket: string;
  dir: V3;
  ground: number;
}
interface Marks {
  readonly hovered: string | null;
  readonly selected: readonly string[];
  readonly focused: string | null;
  bedsShown(): boolean;
  spheresShown(): number;
}
interface GardenProbe {
  state: {
    snapshot: GardenSnapshot | null;
    baskets: { id: string; finds: readonly string[] }[];
    postcards: { id: string }[];
    today: { id: string }[];
    basket(id: string): unknown;
    find(id: string): Find | undefined;
    visitedBasket(id: string): boolean;
    /** The newest basket not opened yet. */
    freshBasket?: { id: string; finds: readonly string[] };
  };
  ui: {
    marks: Marks;
    card: { shown: string | null };
    project(dir: V3, height: number, width: number, h: number): { x: number; y: number } | null;
  };
  layout(): { beds: Map<string, ProbeBed> };
  /** The basket's canvas: where its flowers are drawn this frame (the first is the first button over them). */
  stage: { layout(): { flowers: { id: string }[] } };
  open(id: string): void;
  /** The basket out on a day; a flower in it picked; all of them sent home; the basket's phase. */
  basket(id?: string): void;
  pick(id: string): void;
  sendAll(): void;
  phase(): string;
  flying(): boolean;
  mail(): void;
  muse(): void;
}
interface WorldProbe {
  terrain: { layout: { seed: number } };
  growth: { radius: number };
  rig: { altitude: number; camera: { position: V3 } };
}
type Win = { __garden: GardenProbe; __world: WorldProbe; __mark?: string };

/** The topic map's site, from the topic map itself: a find's link must lead elsewhere. */
const topicMapHosts = new Set(
  Object.values((JSON.parse(readFileSync('server/fixtures/corpus.json', 'utf8')) as { pages: Record<string, { url: string }> }).pages).map(
    (p) => new URL(p.url).hostname,
  ),
);
/** The recorded reels, posts, articles and videos the engine's finds come from, with their network's or site's name. */
const recorded = (JSON.parse(readFileSync('server/fixtures/media.json', 'utf8')) as { items: { url: string; site: string; kind: MediaKind }[] }).items;

async function get<T>(api: APIRequestContext, path: string): Promise<T> {
  const r = await api.get(`${API}${path}`);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

const snapshot = (api: APIRequestContext) => get<GardenSnapshot>(api, `/muses/${HERO}/garden`);

async function advance(api: APIRequestContext, hours: number): Promise<void> {
  const r = await api.post(`${API}/dev/advance`, { data: { hours }, timeout: 300_000 });
  expect(r.ok(), `advance ${hours} h → ${r.status()}`).toBe(true);
}

/** What `pick` finds in the hero's garden, advancing the engine a day at a time until it's there. */
async function advanceUntil<T>(api: APIRequestContext, what: string, pick: (s: GardenSnapshot) => T | undefined, wallMs = 8 * 60_000): Promise<T> {
  const started = Date.now();
  let found = pick(await snapshot(api));
  while (found === undefined && Date.now() - started < wallMs) {
    await advance(api, 24);
    found = pick(await snapshot(api));
  }
  const hours = ((await get<{ now: number }>(api, '/dev/clock')).now - Date.parse('2026-11-02T08:00:00-08:00')) / HOUR;
  expect(found, `${what} by ${hours} h of engine time (${Math.round((Date.now() - started) / 1000)} s wall time)`).toBeDefined();
  return found!;
}

/** The engine's log for the hero, as the server stored it. */
function log(kind: string): { seq: number; body: Record<string, unknown> }[] {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const rows = db.prepare('SELECT seq, body_json FROM events WHERE muse_id = ? AND kind = ? ORDER BY seq').all(HERO, kind) as { seq: number; body_json: string }[];
    return rows.map((r) => ({ seq: r.seq, body: JSON.parse(r.body_json) as Record<string, unknown> }));
  } finally {
    db.close();
  }
}

function contextOptions(): BrowserContextOptions {
  const use = test.info().project.use;
  return { baseURL: use.baseURL, viewport: use.viewport ?? { width: 1600, height: 1000 }, deviceScaleFactor: 1 };
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as Win).__garden?.state.snapshot != null, undefined, { timeout: 60_000 });
}

async function openGarden(page: Page): Promise<void> {
  await page.goto(PAGE);
  await ready(page);
}

/** Where a find's bed is on screen (px) at a height over its ground (m), if in view on this side of the horizon. */
const onScreen = (page: Page, id: string, height: number) =>
  page.evaluate(
    ([id, height]) => {
      const w = window as unknown as Win;
      const g = w.__garden;
      const bed = g.layout().beds.get(id);
      const camera = w.__world.rig.camera.position;
      const R = w.__world.growth.radius;
      if (!bed || camera.x * bed.dir.x + camera.y * bed.dir.y + camera.z * bed.dir.z <= R + bed.ground + height) return null;
      return g.ui.project(bed.dir, bed.ground + height, innerWidth, innerHeight);
    },
    [id, height] as const,
  );

/** The find among `ids` whose point on screen is clearest of the others and of the screen's edges and rail. */
async function clearest(page: Page, ids: readonly string[], height: number): Promise<{ id: string; x: number; y: number }> {
  const points = (await Promise.all(ids.map(async (id) => ({ id, p: await onScreen(page, id, height) })))).flatMap(({ id, p }) => (p ? [{ id, ...p }] : []));
  const { width, height: h } = page.viewportSize()!;
  const inside = points.filter((p) => p.x > 80 && p.x < width - 160 && p.y > 120 && p.y < h - 160);
  expect(inside.length, 'a find in view').toBeGreaterThan(0);
  const gap = (p: { id: string; x: number; y: number }) => Math.min(Infinity, ...points.filter((q) => q.id !== p.id).map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
  return inside.reduce((a, b) => (gap(b) > gap(a) ? b : a));
}

/** A relay for the page's event stream that the test can cut, as a dropped connection would be. */
async function streamRelay() {
  let up = true;
  const sockets = new Set<Socket>();
  const lastEventIds: (string | null)[] = [];
  const server = createServer((req, res) => {
    if (!up) return req.socket.destroy();
    const last = req.headers['last-event-id'];
    lastEventIds.push(typeof last === 'string' ? last : null);
    const upstream = forward(`${ENGINE}${req.url ?? ''}`, { headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    upstream.end();
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const cut = () => {
    up = false;
    for (const s of sockets) s.destroy();
  };
  return {
    url: (path: string) => `http://localhost:${port}${path}`,
    lastEventIds,
    cut,
    restore: () => (up = true),
    close: () => new Promise<void>((resolve) => (cut(), server.close(() => resolve()))),
  };
}

const shownCard = (page: Page) => page.evaluate(() => (window as unknown as Win).__garden.ui.card.shown);
/** What the garden draws of its finds, as the test sees it. */
interface MarksView {
  hovered: string | null;
  /** The picked basket's finds. */
  selected: string[];
  cursor: string;
  /** The find whose flower came home last, in focus. */
  focused: string | null;
  bedsShown: boolean;
  spheresShown: number;
}

/** The test's only read of the garden's marks and beds; nothing else reaches into them. */
const marks = (page: Page): Promise<MarksView> =>
  page.evaluate(() => {
    const m = (window as unknown as Win).__garden.ui.marks;
    return {
      hovered: m.hovered,
      selected: [...m.selected],
      cursor: document.querySelector<HTMLCanvasElement>('#scene')?.style.cursor ?? '',
      focused: m.focused,
      bedsShown: m.bedsShown(),
      spheresShown: m.spheresShown(),
    };
  });

const hoverState = async (page: Page) => {
  const { hovered, cursor } = await marks(page);
  return { hovered, cursor };
};

async function openCard(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => (window as unknown as Win).__garden.open(id), id);
  await expect.poll(() => shownCard(page), { timeout: 90_000, message: `the card for ${id}` }).toBe(id);
  await expect(page.locator('.g-card')).toBeVisible();
}

const phase = (page: Page) => page.evaluate(() => (window as unknown as Win).__garden.phase());

/** A basket's finds, out of the basket and landed in their patches, the camera framing them all. */
async function landBasket(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => (window as unknown as Win).__garden.basket(id), id);
  await expect.poll(() => phase(page), { timeout: 30_000, message: 'the basket out' }).toBe('open');
  await page.evaluate(() => (window as unknown as Win).__garden.sendAll());
  await expect.poll(() => phase(page), { timeout: 120_000, message: 'every flower home' }).toBe('closed');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__garden.flying()), { timeout: 60_000 }).toBe(false);
}

/** The reaction the page sends for a tap, as the engine answered it. */
const reaction = (page: Page, type: string, id: string) =>
  page.waitForResponse((r) => {
    if (!r.url().endsWith('/garden/reactions')) return false;
    const body = r.request().postDataJSON() as { type: string; id: string };
    return body.type === type && body.id === id;
  });

const newBasketsSince = (s: GardenSnapshot, had: readonly string[]) => s.baskets.find((b) => !had.includes(b.id));

test('the hero’s planet is drawn, and a basket arrives over the event stream, opens out of the rail and sends its flowers home into their patches where they were found', async ({ browser, request: api }) => {
  test.setTimeout(30 * 60_000);
  const context = await browser.newContext({ ...contextOptions(), recordVideo: { dir: `${SHOTS}/video`, size: { width: 1280, height: 800 } } });
  const page = await context.newPage();
  let snapshotLoads = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/muses/${HERO}/garden`) snapshotLoads++;
  });

  expect((await snapshot(api)).world?.seed, "the hero's planet").toBe(HERO_SEED);
  await openGarden(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__world.terrain.layout.seed), { message: 'the page draws the hero’s planet' }).toBe(HERO_SEED);

  const had = await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__mark = 'not reloaded';
    return w.__garden.state.baskets.map((b) => b.id);
  });
  const dev = page.locator('.mu-dev');
  await dev.getByLabel('Hours to advance').fill('6');
  let basketId: string | undefined;
  for (let h = 0; h < 96 && !basketId; h += 6) {
    const before = await get<{ now: number }>(api, '/dev/clock');
    await dev.getByRole('button', { name: 'Advance' }).click();
    await expect.poll(async () => (await get<{ now: number }>(api, '/dev/clock')).now, { timeout: 300_000 }).toBe(before.now + 6 * HOUR);
    basketId = newBasketsSince(await snapshot(api), had)?.id;
  }
  expect(basketId, 'the engine delivered a basket').toBeDefined();
  const engineBasket = (await snapshot(api)).baskets.find((b) => b.id === basketId)!;
  await expect
    .poll(() => page.evaluate((id) => ({ arrived: (window as unknown as Win).__garden.state.basket(id) !== undefined, mark: (window as unknown as Win).__mark }), basketId!), {
      message: 'the basket reached the open page',
    })
    .toEqual({ arrived: true, mark: 'not reloaded' });
  expect(snapshotLoads, 'the page loaded the snapshot once; the basket came over the event stream').toBe(1);
  await expect(page.locator('.g-rail .g-dot')).toHaveClass(/is-on/);
  await page.screenshot({ path: `${SHOTS}/01-basket-arrived.png` });

  // out of the rail: the freshest basket not opened yet (the new one, unless the engine brought more at once), its
  // finds as flowers over it, its day picked on the timeline and no longer ringed as new
  const fresh = await page.evaluate(() => (window as unknown as Win).__garden.state.freshBasket);
  expect(fresh, 'a basket waits to be opened').toBeDefined();
  const opened = fresh!.id;
  const finds = fresh!.finds;
  if (opened === basketId) expect([...finds].sort()).toEqual([...engineBasket.finds].sort());
  await page.getByRole('button', { name: 'Baskets' }).click();
  await expect.poll(() => phase(page), { message: 'the basket out' }).toBe('open');
  const flowers = page.locator('.g-basket-hit:not(.is-basket)');
  await expect(flowers).toHaveCount(Math.min(finds.length, 12));
  await expect(page.getByRole('slider', { name: 'Baskets by day' })).toHaveAttribute('aria-valuetext', /./);
  expect(await page.evaluate((id) => (window as unknown as Win).__garden.state.visitedBasket(id), opened), 'the basket opened counts as seen').toBe(true);
  await expect(page.locator('.g-days-dot.is-picked')).not.toHaveClass(/is-new/);
  // a flower previewed under the pointer
  await flowers.first().hover();
  await expect(page.locator('.g-peek.is-on')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-basket-open.png` });

  // one flower picked: it comes down into its patch, which stays lit, and its card rises over it
  const picked = await page.evaluate(() => (window as unknown as Win).__garden.stage.layout().flowers[0].id);
  expect(finds, 'the first flower is one of the basket’s finds').toContain(picked);
  await flowers.first().click();
  await expect.poll(() => phase(page), { message: 'the flower on its way' }).toBe('sending');
  await expect.poll(() => phase(page), { timeout: 120_000, message: 'the flower home' }).toBe('closed');
  await expect.poll(() => shownCard(page), { timeout: 30_000, message: 'its card' }).toBe(picked);
  expect((await marks(page)).focused, 'the picked flower stays lit in its patch').toBe(picked);
  await page.screenshot({ path: `${SHOTS}/03-flower-landed.png` });

  // the basket out again on the same day, and all of it sent home
  await page.evaluate((id) => (window as unknown as Win).__garden.basket(id), opened);
  await expect.poll(() => phase(page)).toBe('open');
  await page.locator('.g-basket-hit.is-basket').click();
  await expect.poll(() => phase(page), { message: 'the flowers on their way' }).toBe('sendingAll');
  await page.screenshot({ path: `${SHOTS}/04-basket-sending.png` });
  await expect.poll(() => phase(page), { timeout: 120_000, message: 'every flower home' }).toBe('closed');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__garden.flying()), { timeout: 60_000 }).toBe(false);
  const landed = await page.evaluate((ids) => {
    const w = window as unknown as Win;
    const g = w.__garden;
    const R = w.__world.growth.radius;
    return ids.map((id) => {
      const bed = g.layout().beds.get(id);
      const place = g.state.find(id)?.place;
      let off = Infinity;
      if (bed && place) {
        const n = Math.hypot(...place);
        const cos = (bed.dir.x * place[0] + bed.dir.y * place[1] + bed.dir.z * place[2]) / n;
        off = Math.acos(Math.min(1, cos)) * R;
      }
      return { id, off };
    });
  }, finds);
  for (const f of landed) expect(f.off, `find ${f.id}: its bed (m) from where it was found`).toBeLessThanOrEqual(NUDGE_REACH);
  const drawn = await marks(page);
  expect(drawn.bedsShown || drawn.spheresShown > 0.5, `the landed finds are drawn, in their beds or from high up as spheres (${JSON.stringify(drawn)})`).toBe(true);
  expect([...drawn.selected].sort(), 'the basket sent home stays marked').toEqual([...finds].sort());
  await page.screenshot({ path: `${SHOTS}/05-landed-patches.png` });
  await context.close();
  await page.video()?.saveAs(`${SHOTS}/basket.webm`);
});

test('hovering a landed find lights it, and a click opens its card with the real item', async ({ page, request: api }) => {
  test.setTimeout(15 * 60_000);
  const basket = await advanceUntil(api, 'a basket', (s) => s.baskets[0]);
  await openGarden(page);
  await landBasket(page, basket.id);

  const near = await clearest(page, basket.finds, 0);
  await page.mouse.move(near.x, near.y);
  await expect.poll(() => hoverState(page), { message: 'hover lights the find under the pointer' }).toEqual({ hovered: near.id, cursor: 'pointer' });
  await page.screenshot({ path: `${SHOTS}/04-hover-glow.png` });
  await page.mouse.click(near.x, near.y);
  await expect.poll(() => shownCard(page), { timeout: 60_000 }).toBe(near.id);
  const card = page.locator('.g-card');
  await expect(card).toBeVisible();
  await expect
    .poll(async () => (await marks(page)).bedsShown, { message: 'the find’s bed shows by its card' })
    .toBe(true);
  const href = (await card.locator('.g-open').getAttribute('href')) ?? '';
  expect(topicMapHosts.has(new URL(href).hostname), `${href} is a real item, not the topic map's page`).toBe(false);
  const item = recorded.find((i) => i.url === href);
  expect(item, `${href} is a recorded item`).toBeDefined();
  const shownText = `${await card.innerText()} ${(await card.locator('.g-open').getAttribute('title')) ?? ''}`;
  expect(shownText, 'the card names the network or the site').toContain(item!.site);
});

test('from high up the spheres show; hovering one brightens it, and a tap flies down to its card', async ({ page, request: api }) => {
  // recheck-marks: hovering a sphere from high up never registers; the spheres are being rebuilt.
  test.setTimeout(15 * 60_000);
  const basket = await advanceUntil(api, 'a basket', (s) => s.baskets[0]);
  await openGarden(page);
  await landBasket(page, basket.id);

  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width / 2, height / 2);
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 1200);
        const altitude = await page.evaluate(() => (window as unknown as Win).__world.rig.altitude);
        return altitude > HIGH_UP && (await marks(page)).spheresShown > 0.95;
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  expect(await page.evaluate(() => (window as unknown as Win).__world.rig.altitude)).toBeGreaterThan(HIGH_UP);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/05-far-spheres.png` });
  const visited = await page.evaluate(() => {
    const s = (window as unknown as Win).__garden.state;
    return s.baskets.filter((b) => s.visitedBasket(b.id)).flatMap((b) => b.finds);
  });
  const sphere = await clearest(page, visited, 0.6);
  await page.mouse.move(sphere.x, sphere.y);
  await expect.poll(() => hoverState(page), { message: 'hover brightens the sphere under the pointer' }).toEqual({ hovered: sphere.id, cursor: 'pointer' });
  await page.screenshot({ path: `${SHOTS}/06-sphere-hover.png` });
  await page.mouse.click(sphere.x, sphere.y);
  await expect.poll(() => shownCard(page), { timeout: 90_000, message: 'the tap flew down to the find' }).toBe(sphere.id);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__world.rig.altitude), { timeout: 60_000 }).toBeLessThan(30);
});

test('a like from a find’s card reaches the engine’s log, and the card still reads liked after a reload', async ({ page, request: api }) => {
  test.setTimeout(15 * 60_000);
  const find = await advanceUntil(api, 'a find not yet liked', (s) => s.finds.find((f) => !f.liked));
  await openGarden(page);
  await openCard(page, find.id);

  const likedBefore = log('owner.liked').length;
  const like = page.locator('.g-card .g-like');
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  const sent = reaction(page, 'like-find', find.id);
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  expect((await sent).status(), 'the engine took the like').toBe(200);
  await expect
    .poll(() => log('owner.liked').slice(likedBefore).map((e) => e.body), { message: 'owner.liked in the engine log' })
    .toContainEqual(expect.objectContaining({ kind: 'owner.liked', target: { find: find.id }, liked: true }));
  expect((await snapshot(api)).finds.find((f) => f.id === find.id)?.liked, 'the engine’s garden reads the find liked').toBe(true);

  await page.reload();
  await ready(page);
  await openCard(page, find.id);
  await expect(page.locator('.g-card .g-like'), 'still liked after a reload').toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${SHOTS}/07-find-liked-after-reload.png` });
});

test('a find made private from its card stays private after a reload, the engine agrees, and other finds stay public', async ({ page, request: api }) => {
  test.setTimeout(15 * 60_000);
  const [find, other] = await advanceUntil(api, 'two public finds', (s) => {
    const shared = s.finds.filter((f) => f.shared);
    return shared.length >= 2 ? shared.slice(0, 2) : undefined;
  });
  await openGarden(page);
  await openCard(page, find.id);

  const toggle = page.locator('.g-card .g-toggle');
  const sharing = toggle.getByRole('switch');
  await expect(sharing).toBeChecked();
  await expect(toggle.locator('.g-toggle-state')).toHaveText('Public');
  const sent = reaction(page, 'share-find', find.id);
  await toggle.click();
  await expect(sharing).not.toBeChecked();
  await expect(toggle.locator('.g-toggle-state')).toHaveText('Private');
  expect((await sent).status(), 'the engine took the switch').toBe(200);

  const engine = await snapshot(api);
  expect(engine.finds.find((f) => f.id === find.id)?.shared, 'the engine holds the find private').toBe(false);
  expect(engine.finds.find((f) => f.id === other.id)?.shared, 'another find is still public').toBe(true);
  const settings = log('owner.settings').map((e) => e.body.hide ?? []);
  expect(settings.flat(), 'owner.settings in the engine log hides the find').toContain(`discovery:${find.id}`);

  await page.reload();
  await ready(page);
  await openCard(page, find.id);
  await expect(page.locator('.g-card .g-toggle').getByRole('switch'), 'still private after a reload').not.toBeChecked();
  await expect(page.locator('.g-card .g-toggle-state')).toHaveText('Private');
  await page.screenshot({ path: `${SHOTS}/08-find-private-after-reload.png` });
  await openCard(page, other.id);
  await expect(page.locator('.g-card .g-toggle').getByRole('switch'), 'the other find is still public').toBeChecked();

  await openCard(page, find.id);
  const back = reaction(page, 'share-find', find.id);
  await page.locator('.g-card .g-toggle').click();
  expect((await back).status()).toBe(200);
  await expect(page.locator('.g-card .g-toggle-state')).toHaveText('Public');
  expect((await snapshot(api)).finds.find((f) => f.id === find.id)?.shared, 'made public again, the engine agrees').toBe(true);
});

test('a garden that lost its event stream catches up from where it left off when it reconnects', async ({ page, request: api }) => {
  test.setTimeout(15 * 60_000);
  const relay = await streamRelay();
  await page.route('**/garden/events', (route) => route.continue({ url: relay.url(new URL(route.request().url()).pathname) }));
  let snapshotLoads = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/muses/${HERO}/garden`) snapshotLoads++;
  });
  await openGarden(page);
  const ids = () =>
    page.evaluate(() => {
      const s = (window as unknown as Win).__garden.state;
      return [...s.baskets.map((b) => b.id), ...s.postcards.map((p) => p.id)];
    });
  const had = await ids();
  await expect.poll(() => relay.lastEventIds).toEqual([null]);

  relay.cut();
  let missed: string[] = [];
  for (let h = 0; h < 72 && missed.length === 0; h += 12) {
    await advance(api, 12);
    const s = await snapshot(api);
    missed = [...s.baskets.map((b) => b.id), ...s.postcards.map((p) => p.id)].filter((id) => !had.includes(id));
  }
  expect(missed.length, 'the engine delivered something while the page was cut off').toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(await ids(), 'nothing arrived while cut off').toEqual(had);
  relay.restore();

  await expect
    .poll(async () => (await ids()).filter((id) => missed.includes(id)).length, { timeout: 120_000, message: 'the missed basket or postcard showed' })
    .toBe(missed.length);
  expect(relay.lastEventIds.length, 'the event stream reconnected').toBeGreaterThan(1);
  expect(relay.lastEventIds.slice(1).some((id) => id !== null && /^\d+$/.test(id)), `reconnected with Last-Event-ID (${relay.lastEventIds.join(', ')})`).toBe(true);
  expect(snapshotLoads, 'caught up without loading the snapshot again').toBe(1);
  await page.screenshot({ path: `${SHOTS}/09-after-reconnect.png` });
  await relay.close();
});

test('a like and a star on a photo postcard reach the engine’s log, and the postcard still reads both after a reload', async ({ page, request: api }) => {
  test.setTimeout(15 * 60_000);
  const card = await advanceUntil(api, 'a photo postcard neither liked nor starred', (s) => s.postcards.find((p) => !p.invitation && !p.liked && !p.favorite));
  const side = page.locator('.g-mail-side');
  const like = side.getByRole('button', { name: 'Like' });
  const star = side.getByRole('button', { name: 'Favorite' });
  const views = page.locator('.g-segments');
  // (up close from the album, where every postcard is, whatever day it came)
  const focus = async () => {
    await page.evaluate(() => (window as unknown as Win).__garden.mail());
    await views.getByRole('button', { name: 'Album' }).click();
    await page.locator(`.g-album-slot[data-id="${card.id}"]`).click();
    await expect(page.locator(`.g-pc[data-id="${card.id}"]`)).toHaveClass(/is-top/);
    await page.waitForTimeout(800);
  };
  await openGarden(page);
  await focus();
  await page.screenshot({ path: `${SHOTS}/10-photo-postcard.png` });

  const likedBefore = log('owner.liked').length;
  const starredBefore = log('owner.favorited').length;
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  const liked = reaction(page, 'like-postcard', card.id);
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  expect((await liked).status(), 'the engine took the like').toBe(200);
  const starred = reaction(page, 'favorite-postcard', card.id);
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  expect((await starred).status(), 'the engine took the star').toBe(200);
  await expect
    .poll(() => log('owner.liked').slice(likedBefore).map((e) => e.body), { message: 'owner.liked in the engine log' })
    .toContainEqual(expect.objectContaining({ kind: 'owner.liked', target: { photo: card.id }, liked: true }));
  await expect
    .poll(() => log('owner.favorited').slice(starredBefore).map((e) => e.body), { message: 'owner.favorited in the engine log' })
    .toContainEqual(expect.objectContaining({ kind: 'owner.favorited', photo: card.id, favorite: true }));
  expect((await snapshot(api)).postcards.find((p) => p.id === card.id), 'the engine’s garden reads the postcard liked and starred').toMatchObject({ liked: true, favorite: true });

  await page.reload();
  await ready(page);
  await focus();
  await expect(like, 'still liked after a reload').toHaveAttribute('aria-pressed', 'true');
  await expect(star, 'still starred after a reload').toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await views.getByRole('button', { name: 'Favorite' }).click();
  const kept = page.locator(`.g-album-slot[data-id="${card.id}"]`);
  await expect(kept, 'on the Favorite page').toBeVisible();
  await expect(kept.locator('.g-album-heart'), 'its caption ends in a heart').toHaveText('♥');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/10b-favorites.png` });
});

test('a card for each kind of find: reel, post, article and video', async ({ page, request: api }) => {
  test.setTimeout(20 * 60_000);
  const byKind = await advanceUntil(api, 'a find of every kind', (s) => {
    const m = new Map<MediaKind, string>();
    for (const f of s.finds) if (!m.has(f.media.kind)) m.set(f.media.kind, f.id);
    return KINDS.every((k) => m.has(k)) ? m : undefined;
  }, 12 * 60_000);
  await openGarden(page);
  for (const kind of KINDS) {
    await openCard(page, byKind.get(kind)!);
    await expect(page.locator('.g-card')).toHaveClass(new RegExp(`g-card--${kind}`));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/11-card-${kind}.png` });
  }
});

test('Muse’s page shows a friend tagged as a friend on Instagram or Facebook', async ({ page, request: api }) => {
  test.setTimeout(20 * 60_000);
  // Both owners' friend groups must take in Instagram and Facebook friends.
  for (const id of [HERO, 'kiki', 'potato', 'pina', 'nemo', 'pooh']) {
    const set = await api.post(`${API}/muses/${id}/garden/reactions`, { data: { type: 'set-reach', reach: 'known' } });
    expect(set.status(), `${id}'s friend group`).toBe(200);
  }
  const friend = await advanceUntil(api, 'a friend known on Instagram or Facebook', (s) => s.friends.find((f) => f.knownOn), 12 * 60_000);
  await openGarden(page);
  await page.evaluate(() => (window as unknown as Win).__garden.muse());
  await page.getByRole('tab', { name: 'Friends' }).click();
  const tag = page.locator('.g-known').first();
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(/You’re friends on (Instagram|Facebook)/);
  await expect(page.locator('.g-friend-name').filter({ hasText: friend.name })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/12-muse-friend-known.png` });
});

/** What a visit page's probe says (src/visit/visitUi.ts state()). */
interface VisitState {
  readonly phase: string;
  readonly planet: string;
  readonly together: boolean;
  readonly host: { readonly museId: string; readonly look: string } | null;
  readonly guest: { readonly museId: string; readonly shown: boolean; readonly apart: number | null } | null;
  readonly plants: readonly { readonly id: string; readonly placed: boolean; readonly water: number | null }[];
}
type VisitWin = { __visit?: { ready: Promise<void>; state(): VisitState; frameMuses(): void; flying(): boolean } };

const visitView = (api: APIRequestContext, id: string) => get<VisitWorldView>(api, `/visits/${encodeURIComponent(id)}/world?as=${HERO}`);

test('a ticket takes the hero and Muse to the host’s own planet: both Muses there, every find planted; Return home ends the trip, and the ticket answers 409 after', async ({ page, request: api }) => {
  test.setTimeout(25 * 60_000);
  const card = await advanceUntil(api, 'an invitation for the hero', (s) => s.postcards.find((p) => p.invitation && !p.invitation.used));
  const invitation = card.invitation!;
  const planet = invitation.world;
  expect(isPlanetId(planet), `the ticket names a planet: ${planet}`).toBe(true);

  await openGarden(page);
  await page.evaluate(() => (window as unknown as Win).__garden.mail());
  const ticket = page.locator(`.g-tickets .g-ticket[data-id="${card.id}"]`);
  const sealed = await page.evaluate((id) => (window as unknown as Win).__garden.state.today.some((p) => p.id === id), card.id);
  if (sealed) {
    // today's: it comes in its envelope, and opened, its ticket flies to the others
    const envelope = page.locator(`.g-env[data-id="${card.id}"]`);
    await expect(envelope).toBeAttached();
    await page.waitForTimeout(1500);
    for (let k = 0; k < 12 && !(await envelope.evaluate((e) => e.classList.contains('is-top'))); k++) await page.keyboard.press('ArrowRight');
    await expect(envelope).toHaveClass(/is-top/);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/13-invitation-envelope.png` });
    await envelope.click();
    await expect(envelope, 'the envelope leaves the deck').not.toBeAttached({ timeout: 5000 });
  }
  await expect(ticket).toBeVisible();
  await expect(ticket).not.toHaveClass(/is-incoming/);
  await expect(ticket).toContainText(invitation.worldName);
  await expect(ticket).toContainText(`from ${invitation.fromName}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/13-invitation-ticket.png` });

  // boarding: the engine takes the ticket, and the page goes to the host's planet, on this visit
  const used = reaction(page, 'use-invitation', card.id);
  await ticket.click();
  expect((await used).status(), 'boarding: the engine took the invitation').toBe(200);
  await page.waitForURL(
    (url) => url.pathname === PLANETS[planet as PlanetId].path && url.searchParams.get('visit') === card.id && url.searchParams.get('as') === HERO,
    { timeout: 60_000 },
  );

  // the two set off together once neither is at work: the engine moves on, inside the visit's two hours, until they have
  for (let k = 0; k < 6 && !(await visitView(api, card.id)).together; k++) await advance(api, 0.25);
  const view = await visitView(api, card.id);
  expect(view.together, 'the hero’s Muse and its host together, within the visit').toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as VisitWin).__visit !== undefined, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as Required<VisitWin>).__visit.ready);
  const state = await page.evaluate(() => (window as unknown as Required<VisitWin>).__visit.state());
  expect(state).toMatchObject({ phase: 'visiting', planet, together: true, host: { museId: invitation.from }, guest: { museId: HERO, shown: true } });
  expect(state.plants.map((p) => p.id).sort()).toEqual(view.plants.map((p) => p.id).sort());
  for (const p of state.plants) expect([p.id, p.placed, (p.water ?? -1) > 0], `${p.id} planted on dry ground`).toEqual([p.id, true, true]);
  await page.evaluate(() => (window as unknown as Required<VisitWin>).__visit.frameMuses());
  await expect.poll(() => page.evaluate(() => (window as unknown as Required<VisitWin>).__visit.flying()), { timeout: 30_000 }).toBe(false);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/14-visiting.png` });

  // Return home: the trip ends on the engine, and the page goes back to the hero's garden
  const returned = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/api/visits/${encodeURIComponent(card.id)}/return`));
  await page.getByRole('button', { name: 'Return home' }).first().click();
  expect((await returned).status(), 'the return').toBe(200);
  await page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('garden') === `/api/muses/${HERO}`, { timeout: 30_000 });
  const cards = await get<InvitationCard[]>(api, `/muses/${HERO}/invitations`);
  expect(cards.find((c) => c.id === card.id)).toMatchObject({ state: 'returned', canVisitNow: false });
  const now = await get<NowView>(api, `/muses/${HERO}/now`);
  expect(now.away?.kind === 'planet' && now.away.of === invitation.from, `the hero is home again: ${now.label}`).toBe(false);

  const again = await api.post(`${API}/muses/${HERO}/garden/reactions`, { data: { type: 'use-invitation', id: card.id } });
  expect(again.status(), 'the ticket again, once the trip is over').toBe(409);
});
