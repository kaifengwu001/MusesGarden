import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GardenEvent, GardenSnapshot } from '../../src/garden/types';
import type { Instant, MuseId } from '../../src/muse/contract';
import { seedCast } from '../cli/run';
import { lifePolicy } from '../domain/policy/index';
import { FIXTURES_DIR, loadCast } from '../fixtures/cast';
import { buildGarden } from '../engine/compose';
import { createApp, type Garden } from './app';
import { fakeCommands, fakeQueries, type FakeCommands } from './fake';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const HERO = 'hero' as MuseId;

let server: Server | undefined;
let base = '';
const streams: AbortController[] = [];

async function serve(garden: Garden): Promise<void> {
  const s = createServer(createApp(garden));
  server = s;
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const c of streams.splice(0)) c.abort();
  const s = server;
  server = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise((resolve) => s.close(resolve));
});

/** The real engine with the cast seeded, as `npm run serve` starts it. */
async function engineGarden(): Promise<Garden> {
  const cast = loadCast();
  const garden = buildGarden({ db: null, mind: 'heuristic', hero: HERO, start: START, clock: 'fast-forward', roles: new Map(cast.members.map((m) => [m.id, m.role])) });
  const work = `${FIXTURES_DIR}work-3weeks.json`;
  await seedCast(garden.engine, lifePolicy, { cast: `${FIXTURES_DIR}cast.json`, work, start: START, hours: 0 });
  return {
    queries: garden.views,
    commands: garden.commands,
    now: () => garden.engine.now(),
    subscribe: (museId, after, send) => garden.views.subscribeGarden(museId, after, send),
  };
}

interface Frame {
  readonly id: number;
  readonly event: GardenEvent;
  readonly lines: readonly string[];
}

/** An open event stream, read frame by frame. */
async function listen(path: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  streams.push(controller);
  const res = await fetch(base + path, { headers, signal: controller.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const frames: Frame[] = [];
  let buffer = '';
  async function until(done: (frames: readonly Frame[]) => boolean): Promise<readonly Frame[]> {
    while (!done(frames)) {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no such frame among ${frames.map((f) => f.event.type).join(', ')}`)), 3000);
      });
      const { value } = await Promise.race([reader.read(), late]).finally(() => clearTimeout(timer));
      buffer += value ?? '';
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const lines = buffer.slice(0, end).split('\n').filter((l) => !l.startsWith(':'));
        buffer = buffer.slice(end + 2);
        if (lines.length === 0) continue;
        const field = (name: string) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
        frames.push({ id: Number(field('id')), event: JSON.parse(field('data') ?? 'null') as GardenEvent, lines });
      }
    }
    return frames;
  }
  return { res, frames, until };
}

async function post(path: string, body: unknown) {
  const res = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
  const json: unknown = await res.json();
  return { status: res.status, body: json };
}

describe('the garden over HTTP on the engine', () => {
  it('serves the snapshot of a known Muse only', async () => {
    const garden = await engineGarden();
    await garden.commands.advance(48);
    await serve(garden);
    const res = await fetch(`${base}/api/muses/hero/garden`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(garden.queries.garden(HERO, garden.now()))));
    expect((await fetch(`${base}/api/muses/nobody/garden`)).status).toBe(404);
  });

  it('streams a basket as the clock moves, and a reconnect with Last-Event-ID replays what it missed', async () => {
    await serve(await engineGarden());
    const live = await listen('/api/muses/hero/garden/events');
    expect(live.res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const [first] = await live.until((f) => f.length > 0);
    expect(first.event.type).toBe('status');

    expect((await post('/api/dev/advance', { hours: 48 })).status).toBe(200);
    const frames = await live.until((f) => f.some((x) => x.event.type === 'basket'));
    for (const f of frames) {
      expect(f.lines.every((l) => l.startsWith('id: ') || l.startsWith('data: ')), 'unnamed data frames').toBe(true);
      expect(Number.isInteger(f.id)).toBe(true);
    }
    const basket = frames.find((f) => f.event.type === 'basket')!;
    const snapshot = (await (await fetch(`${base}/api/muses/hero/garden`)).json()) as GardenSnapshot;
    if (basket.event.type === 'basket') expect(snapshot.baskets).toContainEqual(basket.event.basket);

    const again = await listen('/api/muses/hero/garden/events', { 'last-event-id': String(basket.id - 1) });
    const replayed = await again.until((f) => f.some((x) => x.event.type === 'status'));
    expect(replayed[0]).toEqual(basket);
    expect(replayed.at(-1)?.event).toEqual({ type: 'status', status: snapshot.muse.status });
  });

  it('keeps likes, stars and private finds: each shows in the next snapshot and reaches an open garden', async () => {
    const garden = await engineGarden();
    await garden.commands.advance(48);
    await serve(garden);
    const before = garden.queries.garden(HERO, garden.now())!;
    const [liked, hidden] = before.finds;
    const [card, starred] = before.postcards.filter((p) => !p.invitation);
    expect([liked.liked, liked.shared, hidden.liked, hidden.shared, card.liked, starred.favorite]).toEqual([false, true, false, true, false, false]);
    const live = await listen('/api/muses/hero/garden/events');
    await live.until((f) => f.length > 0);

    for (const reaction of [
      { type: 'like-find', id: liked.id, liked: true },
      { type: 'share-find', id: hidden.id, shared: false },
      { type: 'like-postcard', id: card.id, liked: true },
      { type: 'favorite-postcard', id: starred.id, favorite: true },
    ]) {
      expect(await post('/api/muses/hero/garden/reactions', reaction)).toEqual({ status: 200, body: { ok: true } });
    }

    const snapshot = (await (await fetch(`${base}/api/muses/hero/garden`)).json()) as GardenSnapshot;
    expect(snapshot.finds.find((f) => f.id === liked.id)).toMatchObject({ liked: true, shared: true });
    expect(snapshot.finds.find((f) => f.id === hidden.id)).toMatchObject({ liked: false, shared: false });
    expect(snapshot.postcards.find((p) => p.id === card.id)).toMatchObject({ liked: true, favorite: false });
    expect(snapshot.postcards.find((p) => p.id === starred.id)).toMatchObject({ liked: false, favorite: true });
    const frames = (await live.until((f) => f.filter((x) => x.event.type === 'postcard').length >= 2)).map((f) => f.event);
    const baskets = frames.flatMap((e) => (e.type === 'basket' ? [e] : []));
    expect(baskets.map((e) => e.basket.id)).toEqual([liked.basket, hidden.basket]);
    expect(baskets.at(-1)?.finds).toEqual(snapshot.finds.filter((f) => f.basket === hidden.basket));
    expect(frames.filter((e) => e.type === 'postcard')).toEqual([card, starred].map((c) => ({ type: 'postcard', postcard: snapshot.postcards.find((p) => p.id === c.id) })));
  });

  it('refuses a Last-Event-ID that is not a log seq', async () => {
    await serve(await engineGarden());
    const res = await fetch(`${base}/api/muses/hero/garden/events`, { headers: { 'last-event-id': 'yesterday' } });
    expect(res.status).toBe(400);
  });
});

describe('reactions from the garden', () => {
  let commands: FakeCommands;
  async function serveFake() {
    commands = fakeCommands();
    await serve({ queries: fakeQueries(), commands, now: () => commands.clock().now, subscribe: () => () => undefined });
  }

  it.each<[string, unknown, unknown]>([
    ['like-find', { type: 'like-find', id: 'd-pigment', liked: true }, { name: 'like', args: ['hero', { find: 'd-pigment' }, true] }],
    ['like-postcard', { type: 'like-postcard', id: 'p-hangout-1', liked: false }, { name: 'like', args: ['hero', { photo: 'p-hangout-1' }, false] }],
    ['favorite-postcard', { type: 'favorite-postcard', id: 'p-hangout-1', favorite: true }, { name: 'favorite', args: ['hero', 'p-hangout-1', true] }],
    ['share-interest', { type: 'share-interest', id: 'Pigment', shared: true }, { name: 'setHidden', args: ['hero', 'topic:Pigment', false] }],
    ['keep-interest', { type: 'share-interest', id: 'Sen no Rikyū', shared: false }, { name: 'setHidden', args: ['hero', 'topic:Sen no Rikyū', true] }],
    ['share-find', { type: 'share-find', id: 'd-pigment', shared: true }, { name: 'setHidden', args: ['hero', 'discovery:d-pigment', false] }],
    ['keep-find', { type: 'share-find', id: 'd-pigment', shared: false }, { name: 'setHidden', args: ['hero', 'discovery:d-pigment', true] }],
    ['use-invitation', { type: 'use-invitation', id: 'inv-wren-hero-1' }, { name: 'useInvitation', args: ['hero', 'inv-wren-hero-1'] }],
    ['set-reach', { type: 'set-reach', reach: 'known' }, { name: 'setReach', args: ['hero', 'known'] }],
  ])('%s reaches its command', async (_, reaction, call) => {
    await serveFake();
    expect(await post('/api/muses/hero/garden/reactions', reaction)).toEqual({ status: 200, body: { ok: true } });
    expect(commands.calls).toEqual([call]);
  });

  it('a like or a star on an invitation does nothing, and one on a postcard Muse never sent is not found', async () => {
    await serveFake();
    expect((await post('/api/muses/hero/garden/reactions', { type: 'like-postcard', id: 'inv-wren-hero-1', liked: true })).status).toBe(200);
    expect((await post('/api/muses/hero/garden/reactions', { type: 'favorite-postcard', id: 'inv-wren-hero-1', favorite: true })).status).toBe(200);
    expect((await post('/api/muses/hero/garden/reactions', { type: 'like-postcard', id: 'p-nowhere', liked: true })).status).toBe(404);
    expect((await post('/api/muses/hero/garden/reactions', { type: 'favorite-postcard', id: 'p-nowhere', favorite: true })).status).toBe(404);
    expect(commands.calls).toEqual([]);
  });

  it('a find Muse never found cannot be made public or private', async () => {
    await serveFake();
    expect((await post('/api/muses/hero/garden/reactions', { type: 'share-find', id: 'd-nowhere', shared: false })).status).toBe(404);
    expect(commands.calls).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['an unknown type', { type: 'water', id: 'd-pigment' }],
    ['a like without liked', { type: 'like-find', id: 'd-pigment' }],
    ['a share without shared', { type: 'share-find', id: 'd-pigment', liked: true }],
    ['a star without favorite', { type: 'favorite-postcard', id: 'p-hangout-1', liked: true }],
    ['an empty id', { type: 'use-invitation', id: '' }],
    ['a friend group that is not one of the three', { type: 'set-reach', reach: 'friends' }],
    ['a friend group change without the group', { type: 'set-reach', id: 'everyone' }],
    ['not an object', [1, 2]],
  ])('refuses %s, and sends nothing on', async (_, reaction) => {
    await serveFake();
    expect((await post('/api/muses/hero/garden/reactions', reaction)).status).toBe(400);
    expect(commands.calls).toEqual([]);
  });

  it('answers with the command’s refusal', async () => {
    commands = fakeCommands();
    const garden = { queries: fakeQueries(), commands, now: () => commands.clock().now, subscribe: () => () => undefined };
    await serve({ ...garden, commands: { ...commands, useInvitation: () => Promise.resolve({ ok: false, status: 409, error: 'already used' } as const) } });
    expect(await post('/api/muses/hero/garden/reactions', { type: 'use-invitation', id: 'inv-wren-hero-1' })).toEqual({ status: 409, body: { error: 'already used' } });
  });
});

describe('postcard images', () => {
  it('serves every stand-in the snapshot names, and nothing else', async () => {
    const commands = fakeCommands();
    await serve({ queries: fakeQueries(), commands, now: () => commands.clock().now, subscribe: () => () => undefined });
    const snapshot = fakeQueries().garden(HERO, START)!;
    for (const { image } of snapshot.postcards) {
      const res = await fetch(base + image);
      expect(res.status, image).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      const file = readFileSync(new URL(`../../src/assets/postcards/${image.split('/').at(-1)}`, import.meta.url));
      expect(Buffer.from(await res.arrayBuffer()).equals(file)).toBe(true);
    }
    for (const path of ['/api/postcards/nope.jpg', '/api/postcards/..%2F..%2Fpackage.json', '/api/postcards/close.png']) {
      expect((await fetch(base + path)).status, path).toBe(404);
    }
  });
});
