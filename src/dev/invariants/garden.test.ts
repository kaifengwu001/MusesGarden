import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BED_RADIUS, bedAt, layOut, type PlacementGround } from '../../garden/placement';
import { dayBefore, placeholderSnapshot, placeholderSource } from '../../garden/placeholder';
import { httpSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import type { Basket, Find, GardenSnapshot, Reach } from '../../garden/types';
import { angleBetween } from '../../planet/geo';
import { chipNote } from '../../ui/garden/dom';
import type { FieldParams } from '../../planet/fields';
import { createGroundSample, generateLayout, Terrain, type GroundSample } from '../../planet/terrain';

// The garden's data side: where the finds grow (placement.ts), the
// placeholder gallery, the state the interface reads, and the hook a backend
// fills (source.ts).

const NOW = new Date(2026, 9, 31, 15, 0);
/** The meadow's defaults (params.ts), as the fields read them. */
const PARAMS: FieldParams = { roll: 1.25, hummocks: 0.8, wetlands: 0.45, waterLevel: 0, grain: 0.9, density: 12, patchiness: 0.95, patchSize: 13, weights: [0.21, 0.35, 0.33, 0.11] };

/** A stand-in planet: water wherever a direction's x is above 0.7 (a sea on one side), the cottage at +y. */
function seaWorld(radius = 128): PlacementGround {
  return {
    radius,
    layout: { cottage: new Vector3(0, 1, 0) },
    sample(dir: Vector3, out: GroundSample): GroundSample {
      const shore = (0.7 - dir.x) * radius;
      out.water = shore;
      out.height = shore > 0 ? 1 : 0;
      out.depth = shore > 0 ? 0 : 1;
      out.clearing = angleBetween(dir, new Vector3(0, 1, 0)) * radius < 12 ? 1 : 0;
      out.wet = 0;
      return out;
    },
  };
}

/** A find found at a place (a direction, normalized by placement), in a basket of that day. */
function found(id: string, day: string, place: readonly [number, number, number] | undefined): { basket: Basket; find: Find } {
  const basket: Basket = { id: `b-${id}`, day, finds: [id] };
  const find: Find = { id, basket: basket.id, topic: 'ferns', media: { kind: 'post', url: 'https://example.com', source: 'Example' }, shared: true, ...(place ? { place } : {}) };
  return { basket, find };
}

function lay(ground: PlacementGround, items: ReadonlyArray<{ basket: Basket; find: Find }>): Map<string, Vector3> {
  const layout = layOut(
    ground,
    items.map((i) => i.basket),
    items.map((i) => i.find),
  );
  return new Map([...layout.beds].map(([id, bed]) => [id, bed.dir]));
}

/** A unit direction `meters` from +z toward −x on a planet of R 128 (−x is the dry side of seaWorld). */
function at(meters: number, sideways = 0): readonly [number, number, number] {
  const a = meters / 128;
  const b = sideways / 128;
  const v = new Vector3(-Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)).normalize();
  return [v.x, v.y, v.z];
}

const metersApart = (a: Vector3, b: Vector3, radius = 128): number => angleBetween(a, b) * radius;

describe('where the finds grow', () => {
  const ground = seaWorld();

  it('grows each find where Muse found it', () => {
    const beds = lay(ground, [found('a', '2026-10-01', at(20)), found('b', '2026-10-02', at(40)), found('c', '2026-10-02', at(20, 30))]);
    for (const [id, place] of [['a', at(20)], ['b', at(40)], ['c', at(20, 30)]] as const) expect(metersApart(beds.get(id)!, new Vector3(...place))).toBeLessThan(1e-6);
  });

  it('nudges finds found closer than a bed’s width apart, no farther than it must', () => {
    const items = ['a', 'b', 'c', 'd'].map((id, i) => found(id, `2026-10-0${i + 1}`, at(30, i * 0.3)));
    const beds = [...lay(ground, items).values()];
    for (const bed of beds) {
      expect(metersApart(bed, new Vector3(...at(30)))).toBeLessThan(4);
      for (const other of beds) if (other !== bed) expect(metersApart(bed, other)).toBeGreaterThan(2 * BED_RADIUS);
    }
  });

  it('never moves a bed onto the water when its find was found on dry ground', () => {
    // seaWorld's shore is where x = 0.7: six finds from the same spot a meter up from it, so most must move
    const shore = Math.asin(0.7) * 128;
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => found(id, '2026-10-01', at(-(shore - 1.4))));
    for (const item of items) expect(ground.sample(new Vector3(...item.find.place!), createGroundSample()).water).toBeGreaterThan(0);
    const s = createGroundSample();
    for (const dir of lay(ground, items).values()) expect(ground.sample(dir, s).water).toBeGreaterThan(BED_RADIUS);
  });

  it('brings a find whose place is on the water to the nearest dry ground', () => {
    const shore = Math.asin(0.7) * 128;
    const wet = at(-(shore + 3));
    expect(ground.sample(new Vector3(...wet), createGroundSample()).water).toBeLessThan(0);
    const dir = lay(ground, [found('a', '2026-10-01', wet)]).get('a')!;
    expect(ground.sample(dir, createGroundSample()).water).toBeGreaterThan(BED_RADIUS);
    expect(metersApart(dir, new Vector3(...wet))).toBeLessThan(6);
  });

  it('keeps the beds already growing where they are when a newer basket comes', () => {
    const old = [found('a', '2026-10-01', at(30)), found('b', '2026-10-02', at(50))];
    const before = lay(ground, old);
    const after = lay(ground, [found('new', '2026-10-09', at(30)), ...old]);
    for (const id of ['a', 'b']) expect(after.get(id)!.distanceTo(before.get(id)!)).toBe(0);
    expect(metersApart(after.get('new')!, after.get('a')!)).toBeGreaterThan(2 * BED_RADIUS);
  });

  it('grows a find with no place near the cottage, outside its clearing', () => {
    const dir = lay(ground, [found('a', '2026-10-01', undefined)]).get('a')!;
    const fromCottage = metersApart(dir, ground.layout.cottage);
    expect(fromCottage).toBeGreaterThan(12);
    expect(fromCottage).toBeLessThan(16);
  });

  it('finds the bed under a tap, and none between beds', () => {
    const snap = placeholderSnapshot(NOW);
    const layout = layOut(ground, snap.baskets, snap.finds);
    const bed = [...layout.beds.values()][3];
    expect(bedAt(layout, bed.dir, ground.radius)?.find).toBe(bed.find);
    expect(bedAt(layout, new Vector3(0, -1, 0), ground.radius)).toBeNull();
  });

  it('lays out the example gallery on the real terrain at every size: every bed on dry ground, apart, near where it was found', () => {
    const snap = placeholderSnapshot(NOW);
    const places = new Map(snap.finds.map((f) => [f.id, new Vector3(...f.place!)]));
    for (const radius of [60, 128, 300]) {
      const terrain = new Terrain(generateLayout(412));
      terrain.update(radius, PARAMS, (2 * radius) / 512);
      const beds = [...layOut(terrain, snap.baskets, snap.finds).beds.values()];
      const s = createGroundSample();
      expect(beds).toHaveLength(snap.finds.length);
      for (const bed of beds) {
        expect(terrain.sample(bed.dir, s).water).toBeGreaterThan(BED_RADIUS);
        expect(metersApart(bed.dir, places.get(bed.find)!, radius)).toBeLessThan(24);
        for (const other of beds) if (other !== bed) expect(metersApart(bed.dir, other.dir, radius)).toBeGreaterThan(2 * BED_RADIUS);
      }
    }
  });
});

describe('the placeholder gallery', () => {
  const snap = placeholderSnapshot(NOW);

  it('counts its days back from today, the newest basket today', () => {
    expect(dayBefore(0, NOW)).toBe('2026-10-31');
    expect(dayBefore(9, NOW)).toBe('2026-10-22');
    expect(snap.baskets.map((b) => b.day).sort().at(-1)).toBe('2026-10-31');
  });

  it('holds reels, posts, articles and a video, each with its picture, in a basket, under an interest', () => {
    const kinds = new Set(snap.finds.map((f) => f.media.kind));
    expect([...kinds].sort()).toEqual(['article', 'post', 'reel', 'video']);
    const interests = new Set(snap.interests.map((i) => i.id));
    const ids = new Set(snap.finds.map((f) => f.id));
    for (const f of snap.finds) {
      expect(interests.has(f.topic)).toBe(true);
      expect(f.media.image?.startsWith('data:image/svg+xml')).toBe(true);
    }
    for (const b of snap.baskets) for (const id of b.finds) expect(ids.has(id)).toBe(true);
  });

  it('found every find somewhere on dry ground of the meadow’s own planet (seed 412, R 128)', () => {
    const terrain = new Terrain(generateLayout(412));
    terrain.update(128, PARAMS, 256 / 512);
    const s = createGroundSample();
    for (const f of snap.finds) {
      expect(f.place).toBeDefined();
      expect(terrain.sample(new Vector3(...f.place!), s).water).toBeGreaterThan(BED_RADIUS);
      expect(s.clearing).toBeLessThan(0.05);
    }
  });

  it('spreads the finds over several areas, and one basket over two far apart (so its flight has to climb)', () => {
    const dirs = snap.finds.map((f) => new Vector3(...f.place!));
    const areas: Vector3[] = [];
    for (const d of dirs) if (areas.every((a) => metersApart(a, d) > 30)) areas.push(d);
    expect(areas.length).toBeGreaterThanOrEqual(4);
    const span = (b: Basket): number => Math.max(...b.finds.flatMap((x) => b.finds.map((y) => metersApart(new Vector3(...snap.finds.find((f) => f.id === x)!.place!), new Vector3(...snap.finds.find((f) => f.id === y)!.place!)))));
    expect(span(snap.baskets[0])).toBeLessThan(25);
    expect(Math.max(...snap.baskets.map(span))).toBeGreaterThan(100);
  });

  it('names Muses only, and tags friends known elsewhere by network alone', () => {
    for (const f of snap.friends) expect(Object.keys(f).sort()).toEqual(expect.arrayContaining(['coat', 'id', 'met', 'name', 'shared']));
    expect(snap.friends.some((f) => f.knownOn === 'instagram')).toBe(true);
    const hosts = snap.postcards.flatMap((p) => (p.invitation ? [p.invitation.from] : []));
    expect(hosts, 'two invitations, each from its own friend').toEqual(['pip', 'juniper']);
  });
});

describe('the garden’s state', () => {
  it('opens a first visit on today’s arrivals; older post counts as read, older baskets as visited', async () => {
    vi.useFakeTimers({ now: NOW });
    const state = new GardenState(placeholderSource());
    await state.start();
    expect(state.unread.map((p) => p.id).sort()).toEqual(['inv-pip', 'pc-terrace']);
    expect(state.freshBasket?.day).toBe('2026-10-31');
    expect(state.browseOrder.at(-1), 'browsed as the timeline runs: today’s last').toBe(state.baskets[0].finds.at(-1));
    vi.useRealTimers();
  });

  it('steps a card back and forward in time, round at the ends, naming the day a step crosses into', async () => {
    const state = new GardenState(placeholderSource());
    await state.start();
    const [newest, before] = state.baskets;
    const oldest = state.baskets.at(-1)!;
    expect(state.step(newest.finds[0], 1)).toEqual({ find: newest.finds[1], into: null });
    expect(state.step(newest.finds[0], -1)).toEqual({ find: before.finds.at(-1), into: before.day });
    expect(state.step(before.finds.at(-1)!, 1)).toEqual({ find: newest.finds[0], into: newest.day });
    expect(state.step(newest.finds.at(-1)!, 1), 'the newest steps round to the oldest').toEqual({ find: oldest.finds[0], into: oldest.day });
    expect(state.step(oldest.finds[0], -1)).toEqual({ find: newest.finds.at(-1), into: newest.day });
  });

  it('likes, stars, and uses an invitation once; tells the source', async () => {
    const source = placeholderSource();
    const reactions: unknown[] = [];
    source.react = (r) => (reactions.push(r), Promise.resolve());
    const state = new GardenState(source);
    await state.start();
    const id = state.browseOrder[2];
    expect(state.toggleLike(id)).toBe(true);
    expect(state.likedFindIds).toEqual([id]);
    expect(state.toggleCardFavorite('pc-terrace')).toBe(true);
    expect([state.cardFavorite('pc-terrace'), state.cardLiked('pc-terrace')], 'a star is not a like').toEqual([true, false]);
    expect(state.invitations.map((p) => p.id)).toEqual(['inv-pip', 'inv-juniper']);
    state.useInvitation('inv-pip');
    expect(state.invitations.map((p) => p.id)).toEqual(['inv-juniper']);
    state.setShared('noodles', true);
    expect(state.interest('noodles')?.shared).toBe(true);
    expect(reactions).toEqual([
      { type: 'like-find', id, liked: true },
      { type: 'favorite-postcard', id: 'pc-terrace', favorite: true },
      { type: 'use-invitation', id: 'inv-pip' },
      { type: 'share-interest', id: 'noodles', shared: true },
    ]);
  });

  it('takes in what the source pushes: a postcard, a basket, Muse going out', async () => {
    const source = placeholderSource();
    const state = new GardenState(source);
    await state.start();
    const changes: string[] = [];
    state.subscribe((c) => changes.push(c));
    const card = state.postcards[0];
    source.push({ type: 'postcard', postcard: { ...card, id: 'pc-new', invitation: undefined } });
    expect(state.unread.some((p) => p.id === 'pc-new')).toBe(true);
    const find = state.find(state.browseOrder[0])!;
    source.push({ type: 'basket', basket: { id: 'b-new', day: '2099-01-01', finds: ['f-new'] }, finds: [{ ...find, id: 'f-new', basket: 'b-new' }] });
    expect(state.baskets[0].id).toBe('b-new');
    expect(state.freshBasket?.id).toBe('b-new');
    source.push({ type: 'status', status: { home: false } });
    expect(state.status.home).toBe(false);
    expect(changes).toEqual(['postcards', 'baskets', 'status']);
  });
});

describe('the post: from today, envelopes and tickets', () => {
  const ids = (cards: readonly { id: string }[]) => cards.map((p) => p.id);

  it('From today holds the day’s photos and the day’s invitation in its envelope; the older invitation is a ticket', async () => {
    const state = new GardenState(placeholderSource());
    await state.start();
    expect(ids(state.today)).toEqual(['pc-terrace', 'inv-pip']);
    expect(ids(state.tickets)).toEqual(['inv-juniper']);
  });

  it('opening the box collects the post but leaves the envelope sealed; opened, the envelope is a ticket', async () => {
    const state = new GardenState(placeholderSource());
    await state.start();
    expect(ids(state.unread)).toEqual(['pc-terrace', 'inv-pip']);
    state.collect();
    expect(ids(state.unread)).toEqual(['inv-pip']);
    expect(ids(state.today)).toEqual(['pc-terrace', 'inv-pip']);
    state.markRead('inv-pip');
    expect(ids(state.today)).toEqual(['pc-terrace']);
    expect(ids(state.tickets)).toEqual(['inv-pip', 'inv-juniper']);
    state.useInvitation('inv-juniper');
    expect(ids(state.tickets), 'a used ticket is gone').toEqual(['inv-pip']);
  });

  it('counts today by the source’s day, which turns when post of a later day arrives', async () => {
    const snapshot = placeholderSnapshot(NOW);
    const source = placeholderSource();
    source.load = () => Promise.resolve(snapshot);
    const state = new GardenState(source);
    await state.start();
    expect(snapshot.today).toBe('2026-10-31');
    expect(ids(state.today)).toEqual(['pc-terrace', 'inv-pip']);
    source.push({ type: 'postcard', postcard: { ...snapshot.postcards[0], id: 'pc-next', day: '2026-11-01' } });
    expect(ids(state.today)).toEqual(['pc-next']);
    expect(ids(state.tickets), 'yesterday’s invitation, never opened, waits as a ticket').toEqual(['inv-pip', 'inv-juniper']);
  });
});

describe('likes and sharing, kept by the backend', () => {
  /** A backend that keeps likes: the placeholders with every like answered. */
  function keeping(): { snapshot: GardenSnapshot; source: ReturnType<typeof placeholderSource> } {
    const s = placeholderSnapshot(NOW);
    const snapshot = { ...s, finds: s.finds.map((f) => ({ ...f, liked: false })), postcards: s.postcards.map((p) => ({ ...p, liked: false, favorite: false })) };
    const source = placeholderSource();
    source.load = () => Promise.resolve(snapshot);
    return { snapshot, source };
  }

  /** localStorage for one test: the garden remembers in it, as in a browser. */
  function browserStorage(): void {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) });
  }

  it('shows a flip at once, holds it until the backend sends it back, then follows the backend', async () => {
    const { snapshot, source } = keeping();
    const state = new GardenState(source);
    await state.start();
    const find = state.find(state.browseOrder[0])!;
    const basket = state.basket(find.basket)!;
    const resend = (change: Partial<Find>) =>
      source.push({ type: 'basket', basket, finds: snapshot.finds.filter((f) => f.basket === basket.id).map((f) => (f.id === find.id ? { ...f, ...change } : f)) });
    const seen = () => [state.liked(find.id), state.findShared(find.id), state.likedFindIds.includes(find.id)];

    expect(seen()).toEqual([false, true, false]);
    expect(state.toggleLike(find.id)).toBe(true);
    state.shareFind(find.id, false);
    expect(seen()).toEqual([true, false, true]);
    resend({});
    expect(seen(), 'the backend has not caught up yet').toEqual([true, false, true]);
    resend({ liked: true, shared: false });
    resend({ liked: false, shared: true });
    expect(seen(), 'changed elsewhere, after it answered').toEqual([false, true, false]);
  });

  it('a basket sent again only updates its finds: the garden hears of likes, not of a basket arriving', async () => {
    const { snapshot, source } = keeping();
    const state = new GardenState(source);
    await state.start();
    const changes: string[] = [];
    state.subscribe((c) => changes.push(c));
    const basket = state.baskets[0];
    const finds = snapshot.finds.filter((f) => f.basket === basket.id);
    source.push({ type: 'basket', basket, finds: finds.map((f, i) => (i === 0 ? { ...f, liked: true } : f)) });
    expect(state.liked(finds[0].id)).toBe(true);
    source.push({ type: 'basket', basket: { ...basket, finds: [...basket.finds, 'f-more'] }, finds: [...finds, { ...finds[0], id: 'f-more' }] });
    source.push({ type: 'basket', basket: { id: 'b-new', day: '2099-01-01', finds: ['f-new'] }, finds: [{ ...finds[0], id: 'f-new', basket: 'b-new' }] });
    expect(changes).toEqual(['likes', 'baskets', 'baskets']);
  });

  it('a reload shows what the backend keeps, not what this browser saw', async () => {
    browserStorage();
    const { source } = keeping();
    const first = new GardenState(source);
    await first.start();
    const find = first.browseOrder[0];
    first.toggleLike(find);
    first.toggleCardLike('pc-terrace');
    first.toggleCardFavorite('pc-terrace');
    first.setShared('noodles', true);
    const again = new GardenState(source);
    await again.start();
    expect([again.liked(find), again.cardLiked('pc-terrace'), again.cardFavorite('pc-terrace'), again.interest('noodles')?.shared]).toEqual([false, false, false, false]);
    vi.unstubAllGlobals();
  });

  it('without a backend that keeps likes and stars, this browser remembers them, as before', async () => {
    browserStorage();
    const first = new GardenState(placeholderSource());
    await first.start();
    const find = first.browseOrder[0];
    first.toggleLike(find);
    first.toggleCardLike('pc-terrace');
    first.toggleCardFavorite('pc-pier');
    const again = new GardenState(placeholderSource());
    await again.start();
    expect([again.liked(find), again.likedFindIds, again.cardLiked('pc-terrace'), again.cardFavorite('pc-pier'), again.cardFavorite('pc-terrace')]).toEqual([true, [find], true, true, false]);
    vi.unstubAllGlobals();
  });

  it('goes back to what the backend holds when it turns a flip down', async () => {
    const { source } = keeping();
    source.react = () => Promise.reject(new Error('404'));
    const state = new GardenState(source);
    await state.start();
    const changes: string[] = [];
    state.subscribe((c) => changes.push(c));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(state.toggleCardLike('pc-terrace')).toBe(true);
    expect(state.toggleCardFavorite('pc-pier')).toBe(true);
    state.shareFind(state.browseOrder[0], false);
    expect([state.cardLiked('pc-terrace'), state.cardFavorite('pc-pier'), state.findShared(state.browseOrder[0])]).toEqual([true, true, false]);
    await Promise.resolve();
    expect([state.cardLiked('pc-terrace'), state.cardFavorite('pc-pier'), state.findShared(state.browseOrder[0])]).toEqual([false, false, true]);
    expect(changes).toEqual(['postcards', 'postcards', 'finds', 'postcards', 'postcards', 'finds']);
    vi.restoreAllMocks();
  });
});

describe('the friend group', () => {
  /** A backend that keeps the friend group: the placeholders' friends, all but Pip's inside the narrowest group. */
  function keeping(): { source: ReturnType<typeof placeholderSource>; sent: unknown[] } {
    const s = placeholderSnapshot(NOW);
    let reach: Reach = 'shared';
    const sent: unknown[] = [];
    const source = placeholderSource();
    source.load = () => Promise.resolve({ ...s, muse: { ...s.muse, reach }, friends: s.friends.filter((f) => reach !== 'shared' || f.id !== 'pip') });
    source.react = (r) => {
      sent.push(r);
      if (r.type === 'set-reach') reach = r.reach;
      return Promise.resolve();
    };
    return { source, sent };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('shows the new group at once, tells the backend, and reads back the friends it takes in', async () => {
    const { source, sent } = keeping();
    const state = new GardenState(source);
    await state.start();
    const changes: string[] = [];
    state.subscribe((c) => changes.push(c));
    const friends = () => state.snapshot?.friends.map((f) => f.id);
    expect(state.reach).toBe('shared');
    expect(friends()).not.toContain('pip');

    state.setReach('everyone');
    expect(state.reach, 'at once').toBe('everyone');
    expect(sent).toEqual([{ type: 'set-reach', reach: 'everyone' }]);
    await settled();
    expect(friends()).toContain('pip');
    state.setReach('shared');
    await settled();
    expect([state.reach, friends()?.includes('pip')]).toEqual(['shared', false]);
    expect(changes).toEqual(['friends', 'friends', 'friends', 'friends']);
  });

  it('the placeholders keep it too: friends known online show once the group takes them in', async () => {
    const state = new GardenState(placeholderSource());
    await state.start();
    const known = () => state.snapshot?.friends.filter((f) => f.knownOn).length;
    expect([state.reach, known()]).toEqual(['shared', 0]);
    state.setReach('known');
    await settled();
    expect([state.reach, known()]).toEqual(['known', 2]);
  });

  it('holds the group a backend does not keep, and goes back when the backend turns it down', async () => {
    const forgetful = placeholderSource();
    forgetful.react = () => Promise.resolve();
    const quiet = new GardenState(forgetful);
    await quiet.start();
    quiet.setReach('known');
    await settled();
    expect(quiet.reach, 'a backend that keeps nothing: the page still shows your pick').toBe('known');

    const { source } = keeping();
    source.react = () => Promise.reject(new Error('400'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = new GardenState(source);
    await state.start();
    state.setReach('everyone');
    expect(state.reach).toBe('everyone');
    await settled();
    expect(state.reach).toBe('shared');
    vi.restoreAllMocks();
  });
});

describe('what Muse is doing, as the garden says it', () => {
  it('falls back to at home or out exploring, and the portrait says it in lower case but keeps a Muse’s name', async () => {
    const source = placeholderSource();
    const state = new GardenState(source);
    await state.start();
    expect(state.statusNote).toBe('At home');
    source.push({ type: 'status', status: { home: false } });
    expect(state.statusNote).toBe('Out exploring');
    source.push({ type: 'status', status: { home: false, note: 'Traveling outside the planet' } });
    expect(chipNote(state.statusNote, ['Wren'])).toBe('traveling outside the planet');
    expect(chipNote("Away at Wren's planet", ['Wren'])).toBe("away at Wren's planet");
    expect(chipNote('Wren is visiting', ['Wren'])).toBe('Wren is visiting');
  });
});

describe('the hook a backend fills', () => {
  it('reads the snapshot and posts reactions where the backend says', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(JSON.stringify(placeholderSnapshot(NOW)), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetch);
    const source = httpSource('https://muse.example/api/');
    const snap = await source.load();
    expect(snap.baskets.length).toBeGreaterThan(0);
    await source.react({ type: 'like-find', id: 'x', liked: true });
    expect(calls[0][0]).toBe('https://muse.example/api/garden');
    expect(calls[1][0]).toBe('https://muse.example/api/garden/reactions');
    expect(JSON.parse(calls[1][1]?.body as string)).toEqual({ type: 'like-find', id: 'x', liked: true });
    vi.unstubAllGlobals();
  });
});
