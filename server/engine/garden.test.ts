import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GardenSnapshot } from '../../src/garden/types';
import type { GardenFrame, Instant, MuseId } from '../../src/muse/contract';
import { run, seedCast } from '../cli/run';
import { lifePolicy } from '../domain/policy/index';
import { FIXTURES_DIR, loadCast, readMemberDocs } from '../fixtures/cast';
import { buildGarden, type Garden } from './compose';
import { soulLine } from './garden';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const HERO = 'hero' as MuseId;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ownerDay = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(at);
const POSTCARDS = fileURLToPath(new URL('../../src/assets/postcards/', import.meta.url));

/** The cast on the real domain, as `npm run serve` seeds it, run for `hours` with owners who accept invitations. */
async function seeded(hours: number): Promise<Garden> {
  const cast = loadCast();
  const garden = buildGarden({
    db: null,
    mind: 'heuristic',
    hero: HERO,
    start: START,
    clock: 'fast-forward',
    roles: new Map(cast.members.map((m) => [m.id, m.role])),
  });
  const work = `${FIXTURES_DIR}work-3weeks.json`;
  await seedCast(garden.engine, lifePolicy, { cast: `${FIXTURES_DIR}cast.json`, work, start: START, hours: 0 });
  await run(garden.engine, { cast: '', work: null, start: START, hours });
  return garden;
}

describe('the garden snapshot on a seeded engine', () => {
  let garden: Garden;
  let snap: GardenSnapshot;
  beforeAll(async () => {
    garden = await seeded(72);
    const s = garden.views.garden(HERO, garden.engine.now());
    if (!s) throw new Error('no snapshot for the hero');
    snap = JSON.parse(JSON.stringify(s)) as GardenSnapshot;
  });

  it('shows only the finds of delivered baskets, each once, in the basket that brought it', () => {
    const s = garden.engine.state(HERO)!;
    const delivered = s.baskets.flatMap((b) => b.items);
    expect(s.discoveries.size, 'some finds are still waiting for a basket').toBeGreaterThan(delivered.length);
    expect(snap.finds.map((f) => f.id)).toEqual(delivered);
    expect(snap.baskets.map((b) => b.id)).toEqual(s.baskets.map((b) => b.id));
    for (const b of snap.baskets) for (const id of b.finds) expect(snap.finds.find((f) => f.id === id)?.basket).toBe(b.id);
  });

  it('every find grows as one of the interests, where Muse found it', () => {
    const interests = new Set(snap.interests.map((i) => i.id));
    const s = garden.engine.state(HERO)!;
    for (const f of snap.finds) {
      expect(interests.has(f.topic), f.topic).toBe(true);
      expect(f.place).toEqual(s.discoveries.get(f.id as never)?.place.dir);
      expect(f.media.url).toMatch(/^https:\/\//);
      expect(f.note?.length).toBeGreaterThan(0);
    }
    expect(snap.interests.length).toBeGreaterThanOrEqual(Math.min(12, s.interests.size));
  });

  it('a trip’s finds grow as the interest Muse set out after', () => {
    const plans = new Map<number, string | null>();
    const kept = new Map<number, string[]>();
    for (const { event: e } of garden.engine.log(HERO)) {
      if (e.kind === 'episode.started' && e.plan.activity === 'travel') plans.set(e.n, e.plan.trip.kind === 'serendipity' ? null : e.plan.trip.topic);
      if (e.kind === 'trip.hop') kept.set(e.n, [...(kept.get(e.n) ?? []), ...e.kept]);
    }
    const topicOf = new Map(snap.finds.map((f) => [f.id, f.topic]));
    let checked = 0;
    for (const [n, ids] of kept) {
      const topics = new Set(ids.filter((id) => topicOf.has(id)).map((id) => topicOf.get(id)));
      if (topics.size === 0) continue;
      expect(topics.size, `trip ${n}`).toBe(1);
      const planned = plans.get(n);
      if (planned) expect([...topics][0]).toBe(planned);
      if (planned && ids.length > 1) checked++;
    }
    expect(checked, 'a trip that kept several finds').toBeGreaterThan(0);
  });

  it('dates everything with the owner’s local day', () => {
    const s = garden.engine.state(HERO)!;
    expect(snap.baskets.map((b) => b.day)).toEqual(s.baskets.map((b) => ownerDay(b.at)));
    const photos = new Map(s.photos.map((p) => [p.id as string, p]));
    for (const p of snap.postcards) {
      expect(p.day).toMatch(DAY);
      const photo = photos.get(p.id);
      if (photo) expect(p.day).toBe(ownerDay(photo.at));
    }
    for (const day of [...snap.interests.map((i) => i.since), ...snap.friends.map((f) => f.met)]) expect(day).toMatch(DAY);
  });

  it('gives every interest, find, basket, postcard and friend its own id', () => {
    for (const ids of [snap.interests, snap.finds, snap.baskets, snap.postcards, snap.friends].map((xs) => xs.map((x) => x.id))) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('sends every photo and every invitation the owner received as a postcard with an image the server has', () => {
    const s = garden.engine.state(HERO)!;
    const received = [...s.social.invitations.values()].filter((inv) => inv.guest === HERO && inv.state !== 'withdrawn');
    expect(received.length, 'the run brought an invitation').toBeGreaterThan(0);
    expect(snap.postcards.map((p) => p.id).sort()).toEqual([...s.photos.map((p) => p.id), ...received.map((inv) => inv.id)].sort());
    for (const p of snap.postcards) {
      expect(p.image).toMatch(/^\/api\/postcards\/[a-z]+\.jpg$/);
      expect(existsSync(POSTCARDS + p.image.split('/').at(-1)), p.image).toBe(true);
      expect(p.place.length).toBeGreaterThan(0);
    }
    for (const inv of received) {
      const card = snap.postcards.find((p) => p.id === inv.id);
      expect(card?.invitation).toMatchObject({ from: inv.host, world: inv.host });
      expect(card?.invitation?.worldName).toContain(garden.engine.state(inv.host)!.seed.name);
    }
    const away = s.photos.find((p) => p.planetOf !== HERO);
    if (away) expect(snap.postcards.find((p) => p.id === away.id)?.place).toContain(garden.engine.state(away.planetOf)!.seed.name);
  });

  it('describes Muse from SOUL.md in a line, on its own planet, with its friends', () => {
    const body = readMemberDocs(loadCast().members.find((m) => m.id === HERO)!).soul.replace(/\s+/g, ' ');
    expect(snap.muse.soul.length).toBeGreaterThan(0);
    expect(snap.muse.soul.length).toBeLessThanOrEqual(160);
    expect(body).toContain(snap.muse.soul.replace(/…$/, ''));
    expect(snap.muse.soul).not.toMatch(/^#|---|curiosity:/);
    expect(snap.muse.soul).toMatch(/[.!?…]$/);
    expect(snap.world).toEqual({ seed: 1031, g: expect.any(Number) as number });
    expect(snap.friends.map((f) => f.id).sort()).toEqual(['juniper', 'wren']);
    for (const f of snap.friends) {
      expect(f.name).toBe(garden.engine.state(f.id as MuseId)!.seed.name);
      expect(f.coat).toMatch(/^#[0-9a-f]{6}$/);
      expect(f.shared.length).toBeGreaterThan(0);
      expect(f.shared.length).toBeLessThanOrEqual(3);
    }
  });

  it('says whether Muse is home, and where it is while out on the planet', () => {
    const now = garden.views.now(HERO, garden.engine.now())!;
    expect(snap.muse.status.note).toBe(now.label);
    expect(snap.muse.status.home).toBe(now.activity !== 'travel' && now.away === null);
    if (now.activity === 'travel') expect(Math.hypot(...snap.muse.status.where!)).toBeCloseTo(1, 6);
    else expect(snap.muse.status.where).toBeUndefined();
  });
});

describe('the soul line', () => {
  it('is the first paragraph of prose, past headings and lists, in whole sentences when they fit', () => {
    expect(soulLine('# Fern\n\n- **Tea** (emerging)\n- **Ink**\n\nI look closely.\nThen I draw.\n\nMore later.')).toBe('I look closely. Then I draw.');
    const long = `${'A leaf, '.repeat(15)}then another. And a third sentence that runs on past the end of the line for sure.`;
    expect(soulLine(long)).toBe(`${'A leaf, '.repeat(15)}then another.`);
    const word = soulLine('word '.repeat(60));
    expect(word.length).toBeLessThanOrEqual(160);
    expect(word).toMatch(/^(word )+word…$/);
    expect(soulLine(null)).toBe('');
  });
});

describe('garden events', () => {
  it('replays after a log seq exactly what was sent live, then Muse’s status', async () => {
    const garden = await seeded(0);
    const live: GardenFrame[] = [];
    const stop = garden.views.subscribeGarden(HERO, null, (f) => live.push(f));
    expect(live.map((f) => f.event.type)).toEqual(['status']);
    await run(garden.engine, { cast: '', work: null, start: START, hours: 48 });
    stop();

    const ids = live.map((f) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const baskets = live.filter((f) => f.event.type === 'basket');
    expect(baskets.length, 'a basket arrived').toBeGreaterThan(0);
    expect(live.some((f) => f.event.type === 'postcard')).toBe(true);
    expect(live.filter((f) => f.event.type === 'status').length).toBeGreaterThan(10);

    const snap = JSON.parse(JSON.stringify(garden.views.garden(HERO, garden.engine.now()))) as GardenSnapshot;
    for (const f of baskets) {
      if (f.event.type !== 'basket') continue;
      expect(snap.baskets).toContainEqual(JSON.parse(JSON.stringify(f.event.basket)));
      for (const find of f.event.finds) expect(snap.finds).toContainEqual(JSON.parse(JSON.stringify(find)));
    }

    const after = baskets[0].id - 1;
    const replayed: GardenFrame[] = [];
    garden.views.subscribeGarden(HERO, after, (f) => replayed.push(f))();
    const items = (frames: GardenFrame[]) => frames.filter((f) => f.event.type !== 'status' && f.id > after);
    expect(JSON.parse(JSON.stringify(items(replayed)))).toEqual(JSON.parse(JSON.stringify(items(live))));
    expect(replayed.at(-1)).toEqual({ id: garden.engine.state(HERO)!.seq, event: { type: 'status', status: snap.muse.status } });
    expect(replayed.filter((f) => f.event.type === 'status').length).toBe(1);
  });

});
