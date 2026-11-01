import { readFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type BrowserContextOptions, type Page } from '@playwright/test';
import type {} from '../../dev/harnessApi';
import type { Find, GardenSnapshot, MediaKind } from '../../garden/types';

// The garden's interface on the real engine: the hero's planet, a basket that arrives over the event stream and
// flies its finds to where they were found, hover and the find card, the spheres from high up, a like that reaches
// the engine's log, an invitation used once, and a reconnect that catches up. Screenshots and the basket flight's
// recording go to shots/garden-live/.

const API = 'http://localhost:8787/api';
const HERO = 'hero';
const PAGE = `/?dev&garden=/api/muses/${HERO}#hud=0`;
const SHOTS = 'shots/garden-live';
const DB = '.muse-live-e2e/garden.db';
const HERO_SEED = 1031;
/** A bed is nudged at most this far from where its find was found (m, garden/placement.ts). */
const NUDGE_REACH = 24;
/** Above this the spheres have taken over from the specimens (m, life/findForms.ts). */
const HIGH_UP = 120;
const HOUR = 3_600_000;

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
  hovered: string | null;
  index: Map<string, number>;
  lit: { x: number; y: number; z: number; w: number };
  specimens: { visible: boolean };
  spheresShown(): number;
}
interface GardenProbe {
  state: {
    snapshot: GardenSnapshot | null;
    baskets: { id: string; finds: readonly string[] }[];
    postcards: { id: string }[];
    basket(id: string): unknown;
    find(id: string): Find | undefined;
    visitedBasket(id: string): boolean;
  };
  ui: {
    marks: Marks;
    basketFlight: { active: boolean; waiting(id: string): boolean };
    beds: { now: number; slot(id: string): number | undefined; beds: { x: number }[] };
    card: { shown: string | null };
    project(dir: V3, height: number, width: number, h: number): { x: number; y: number } | null;
  };
  layout(): { beds: Map<string, ProbeBed> };
  open(id: string): void;
  basket(id?: string): void;
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

async function openGarden(page: Page): Promise<void> {
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as Win).__garden?.state.snapshot != null, undefined, { timeout: 60_000 });
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
    const upstream = forward(`http://localhost:8787${req.url ?? ''}`, { headers: req.headers }, (r) => {
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
const hoverState = (page: Page) =>
  page.evaluate(() => {
    const marks = (window as unknown as Win).__garden.ui.marks;
    const canvas = document.querySelector<HTMLCanvasElement>('#scene');
    return { hovered: marks.hovered, lit: marks.lit.x, cursor: canvas?.style.cursor ?? '' };
  });

test('a basket from the engine flies to where its finds were found, and a like from the card reaches the engine', async ({ browser, request: api }) => {
  test.setTimeout(30 * 60_000);
  const opts = contextOptions();
  const flightContext = await browser.newContext({ ...opts, recordVideo: { dir: `${SHOTS}/video`, size: { width: 1280, height: 800 } } });
  const page = await flightContext.newPage();
  let snapshotLoads = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/muses/${HERO}/garden`) snapshotLoads++;
  });

  const first = await snapshot(api);
  expect(first.world?.seed, "the hero's planet").toBe(HERO_SEED);
  await openGarden(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__world.terrain.layout.seed), { message: 'the page draws the hero’s planet' }).toBe(HERO_SEED);

  // a basket arrives over the event stream, with the page left as it is
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
    basketId = (await snapshot(api)).baskets.find((b) => !had.includes(b.id))?.id;
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
  await page.getByRole('button', { name: 'Baskets' }).click();
  const newest = page.locator('.g-day').first();
  await expect(newest).toHaveClass(/is-fresh/);
  await page.screenshot({ path: `${SHOTS}/01-basket-arrived.png` });

  // opening it: the finds fly to their beds, unplanted until each lands
  await newest.locator('.g-day-row').click();
  const finds = engineBasket.finds;
  await expect.poll(() => page.evaluate((ids) => ids.filter((id) => (window as unknown as Win).__garden.ui.basketFlight.waiting(id)).length, finds), { message: 'finds in flight' }).toBeGreaterThan(0);
  await expect(page.locator('.g-fly-find.is-leaving').first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/02-basket-mid-flight.png` });
  await expect(page.locator('.g-fly')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__garden.flying()), { timeout: 60_000 }).toBe(false);
  const landed = await page.evaluate((ids) => {
    const w = window as unknown as Win;
    const g = w.__garden;
    const R = w.__world.growth.radius;
    return ids.map((id) => {
      const bed = g.layout().beds.get(id);
      const place = g.state.find(id)?.place;
      const slot = g.ui.beds.slot(id);
      let off = Infinity;
      if (bed && place) {
        const n = Math.hypot(...place);
        const cos = (bed.dir.x * place[0] + bed.dir.y * place[1] + bed.dir.z * place[2]) / n;
        off = Math.acos(Math.min(1, cos)) * R;
      }
      return {
        id,
        waiting: g.ui.basketFlight.waiting(id),
        planted: slot !== undefined && g.ui.beds.beds[slot].x <= g.ui.beds.now,
        grown: g.ui.marks.index.has(id),
        off,
      };
    });
  }, finds);
  for (const f of landed) {
    expect(f, `find ${f.id} landed and planted`).toMatchObject({ waiting: false, planted: true, grown: true });
    expect(f.off, `find ${f.id}: its bed (m) from where it was found`).toBeLessThanOrEqual(NUDGE_REACH);
  }
  const drawn = await page.evaluate(() => {
    const w = window as unknown as Win;
    return { altitude: w.__world.rig.altitude, specimens: w.__garden.ui.marks.specimens.visible, spheres: w.__garden.ui.marks.spheresShown() };
  });
  expect(drawn.specimens || drawn.spheres > 0.5, `the landed finds are drawn, as specimens or from high up as spheres (${JSON.stringify(drawn)})`).toBe(true);
  await page.screenshot({ path: `${SHOTS}/03-landed-specimens.png` });
  const storage = await flightContext.storageState();
  await flightContext.close();
  await page.video()?.saveAs(`${SHOTS}/basket-flight.webm`);

  const context = await browser.newContext({ ...opts, storageState: storage });
  const garden = await context.newPage();
  await openGarden(garden);
  await garden.evaluate((id) => (window as unknown as Win).__garden.basket(id), basketId!);
  await expect(garden.locator('.g-fly')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(() => garden.evaluate(() => (window as unknown as Win).__garden.flying()), { timeout: 60_000 }).toBe(false);

  // hover over a landed find, then open its card
  const near = await clearest(garden, finds, 0);
  await garden.mouse.move(near.x, near.y);
  const lit = await garden.evaluate((id) => (window as unknown as Win).__garden.ui.marks.index.get(id), near.id);
  await expect.poll(() => hoverState(garden), { message: 'hover lights the find under the pointer' }).toEqual({ hovered: near.id, lit, cursor: 'pointer' });
  await garden.screenshot({ path: `${SHOTS}/04-hover-glow.png` });
  await garden.mouse.click(near.x, near.y);
  await expect.poll(() => shownCard(garden), { timeout: 60_000 }).toBe(near.id);
  const card = garden.locator('.g-card');
  await expect(card).toBeVisible();
  await expect
    .poll(() => garden.evaluate(() => (window as unknown as Win).__garden.ui.marks.specimens.visible), { message: 'the find’s specimen stands by its card' })
    .toBe(true);
  const href = (await card.locator('.g-open').getAttribute('href')) ?? '';
  expect(topicMapHosts.has(new URL(href).hostname), `${href} is a real item, not the topic map's page`).toBe(false);
  const item = recorded.find((i) => i.url === href);
  expect(item, `${href} is a recorded item`).toBeDefined();
  const shownText = `${await card.innerText()} ${(await card.locator('.g-open').getAttribute('title')) ?? ''}`;
  expect(shownText, 'the card names the network or the site').toContain(item!.site);

  // from high up the spheres show; hovering one brightens it, and a tap flies down to its card
  await garden.keyboard.press('Escape');
  await expect.poll(() => shownCard(garden)).toBeNull();
  const { width, height } = garden.viewportSize()!;
  await garden.mouse.move(width / 2, height / 2);
  await expect
    .poll(
      async () => {
        await garden.mouse.wheel(0, 1200);
        return garden.evaluate(() => {
          const w = window as unknown as Win;
          return w.__world.rig.altitude > 120 && w.__garden.ui.marks.spheresShown() > 0.95;
        });
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  const altitude = await garden.evaluate(() => (window as unknown as Win).__world.rig.altitude);
  expect(altitude).toBeGreaterThan(HIGH_UP);
  await garden.waitForTimeout(1500);
  await garden.screenshot({ path: `${SHOTS}/05-far-spheres.png` });
  const visited = await garden.evaluate(() => {
    const s = (window as unknown as Win).__garden.state;
    return s.baskets.filter((b) => s.visitedBasket(b.id)).flatMap((b) => b.finds);
  });
  const sphere = await clearest(garden, visited, 0.6);
  await garden.mouse.move(sphere.x, sphere.y);
  const sphereLit = await garden.evaluate((id) => (window as unknown as Win).__garden.ui.marks.index.get(id), sphere.id);
  await expect.poll(() => hoverState(garden), { message: 'hover brightens the sphere under the pointer' }).toEqual({ hovered: sphere.id, lit: sphereLit, cursor: 'pointer' });
  await garden.screenshot({ path: `${SHOTS}/06-sphere-hover.png` });
  await garden.mouse.click(sphere.x, sphere.y);
  await expect.poll(() => shownCard(garden), { timeout: 90_000, message: 'the tap flew down to the find' }).toBe(sphere.id);
  await expect.poll(() => garden.evaluate(() => (window as unknown as Win).__world.rig.altitude), { timeout: 60_000 }).toBeLessThan(30);

  // a like from the card reaches the engine's log, and still reads liked after a reload
  const likedBefore = log('owner.liked').length;
  const like = garden.locator('.g-card .g-like');
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => log('owner.liked').slice(likedBefore).map((e) => e.body), { message: 'owner.liked in the engine log' })
    .toContainEqual(expect.objectContaining({ kind: 'owner.liked', target: { find: sphere.id }, liked: true }));
  expect((await snapshot(api)).finds.find((f) => f.id === sphere.id)?.liked).toBe(true);
  await garden.reload();
  await openGarden(garden);
  await garden.evaluate((id) => (window as unknown as Win).__garden.open(id), sphere.id);
  await expect.poll(() => shownCard(garden), { timeout: 90_000 }).toBe(sphere.id);
  await expect(garden.locator('.g-card .g-like')).toHaveAttribute('aria-pressed', 'true');

  // a card for each kind the run produced
  const byKind = new Map<MediaKind, string>();
  for (const f of (await snapshot(api)).finds) if (!byKind.has(f.media.kind)) byKind.set(f.media.kind, f.id);
  for (const [kind, id] of byKind) {
    await garden.evaluate((id) => (window as unknown as Win).__garden.open(id), id);
    await expect.poll(() => shownCard(garden), { timeout: 90_000 }).toBe(id);
    await expect(garden.locator('.g-card')).toHaveClass(new RegExp(`g-card--${kind}`));
    await garden.waitForTimeout(800);
    await garden.screenshot({ path: `${SHOTS}/07-card-${kind}.png` });
  }

  // Muse's page: a friend tagged as known on Instagram or Facebook, if Muse has one
  await garden.keyboard.press('Escape');
  await garden.evaluate(() => (window as unknown as Win).__garden.muse());
  await garden.getByRole('tab', { name: 'Friends' }).click();
  if ((await garden.locator('.g-known').count()) > 0) await garden.screenshot({ path: `${SHOTS}/08-muse-friend-known.png` });
  test.info().annotations.push({ type: 'kinds', description: [...byKind.keys()].join(', ') });
  await context.close();
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

test('an invitation reaches the hero: Travel now works once, and a second use after its two hours answers 409', async ({ page, request: api }) => {
  test.setTimeout(20 * 60_000);
  const started = Date.now();
  const invitation = async () => (await snapshot(api)).postcards.find((p) => p.invitation && !p.invitation.used);
  let card = await invitation();
  for (let step = 0; !card && step < 10 && Date.now() - started < 8 * 60_000; step++) {
    await advance(api, 24);
    card = await invitation();
  }
  const hours = ((await get<{ now: number }>(api, '/dev/clock')).now - Date.parse('2026-11-02T08:00:00-08:00')) / HOUR;
  expect(card, `an invitation for the hero by ${hours} h of engine time (${Math.round((Date.now() - started) / 1000)} s wall time)`).toBeDefined();
  test.info().annotations.push({ type: 'invitation', description: `${card!.id} at ${hours} h, ${Math.round((Date.now() - started) / 1000)} s wall time` });

  await openGarden(page);
  await expect(page.locator('.g-ticket')).toHaveClass(/has-invite/);
  await page.evaluate(() => (window as unknown as Win).__garden.mail());
  const envelope = page.locator(`.g-env[data-id="${card!.id}"]`);
  await expect(envelope).toBeAttached();
  await page.waitForTimeout(1500);
  // (a tap on the envelope where it lies in the stack, under the postcards on top of it)
  await envelope.dispatchEvent('click');
  await expect(envelope).toHaveClass(/is-focus/);
  await expect(envelope).toHaveClass(/is-open/);
  const travel = envelope.getByRole('button', { name: 'Travel now' });
  await expect(travel).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/10-invitation-postcard.png` });
  const used = page.waitForResponse((r) => r.url().endsWith('/garden/reactions') && (r.request().postDataJSON() as { type: string }).type === 'use-invitation');
  await travel.click();
  const first = await used;
  expect(first.status(), 'Travel now: the engine took the invitation').toBe(200);
  expect((first.request().postDataJSON() as { id: string }).id).toBe(card!.id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/11-visiting.png` });

  await advance(api, 3);
  const again = await api.post(`${API}/muses/${HERO}/garden/reactions`, { data: { type: 'use-invitation', id: card!.id } });
  expect(again.status(), 'a second use after the two hours').toBe(409);
});
