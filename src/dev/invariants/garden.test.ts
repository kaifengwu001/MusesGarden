import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BED_RADIUS, bedAt, layOut, type PlacementGround } from '../../garden/placement';
import { dayBefore, placeholderSnapshot, placeholderSource } from '../../garden/placeholder';
import { httpSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import { angleBetween } from '../../planet/geo';
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
    layout: { cottage: new Vector3(0, 1, 0), homeBearing: new Vector3(0, 0, 1) },
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

describe('where the finds grow', () => {
  const snap = placeholderSnapshot(NOW);
  const ground = seaWorld();
  const layout = layOut(ground, snap.baskets, snap.finds);

  it('gives every find a bed and every basket a patch', () => {
    expect(layout.beds.size).toBe(snap.finds.length);
    expect(layout.patches.size).toBe(snap.baskets.length);
  });

  it('grows every bed on dry ground, clear of the cottage and of the other beds', () => {
    const beds = [...layout.beds.values()];
    for (const bed of beds) {
      expect((0.7 - bed.dir.x) * ground.radius).toBeGreaterThan(1.5);
      expect(angleBetween(bed.dir, ground.layout.cottage) * ground.radius).toBeGreaterThan(12);
      for (const other of beds) if (other !== bed) expect(angleBetween(bed.dir, other.dir) * ground.radius).toBeGreaterThan(2 * BED_RADIUS);
    }
  });

  it('keeps each basket’s beds within its patch, the first in the middle', () => {
    for (const basket of snap.baskets) {
      const patch = layout.patches.get(basket.id)!;
      basket.finds.forEach((id, i) => {
        const d = angleBetween(layout.beds.get(id)!.dir, patch.dir) * ground.radius;
        expect(d).toBeLessThanOrEqual(patch.reach + 1e-6);
        if (i === 0) expect(d).toBeLessThan(0.01);
      });
    }
  });

  it('winds the patches outward from the cottage, the oldest day nearest home', () => {
    const byDay = [...snap.baskets].sort((a, b) => (a.day < b.day ? -1 : 1));
    const distances = byDay.map((b) => angleBetween(layout.patches.get(b.id)!.dir, ground.layout.cottage) * ground.radius);
    expect(distances[0]).toBeLessThan(distances[distances.length - 1]);
  });

  it('is the same every time, and keeps a find the backend placed', () => {
    const again = layOut(ground, snap.baskets, snap.finds);
    for (const [id, bed] of layout.beds) expect(again.beds.get(id)!.dir.distanceTo(bed.dir)).toBe(0);
    const placed = snap.finds.map((f, i) => (i === 0 ? { ...f, place: [0, 0.6, 0.8] as const } : f));
    expect(layOut(ground, snap.baskets, placed).beds.get(snap.finds[0].id)!.dir.distanceTo(new Vector3(0, 0.6, 0.8))).toBeLessThan(1e-9);
  });

  it('finds the bed under a tap, and none between beds', () => {
    const bed = [...layout.beds.values()][3];
    expect(bedAt(layout, bed.dir, ground.radius)?.find).toBe(bed.find);
    expect(bedAt(layout, new Vector3(0, -1, 0), ground.radius)).toBeNull();
  });

  it('lays out on the real terrain too: every bed above the water, at every size', () => {
    for (const radius of [60, 128, 300]) {
      const terrain = new Terrain(generateLayout(412));
      terrain.update(radius, PARAMS, (2 * radius) / 512);
      const real = layOut(terrain, snap.baskets, snap.finds);
      const s = createGroundSample();
      for (const bed of real.beds.values()) expect(terrain.sample(bed.dir, s).water).toBeGreaterThan(0);
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

  it('names Muses only, and tags friends known elsewhere by network alone', () => {
    for (const f of snap.friends) expect(Object.keys(f).sort()).toEqual(expect.arrayContaining(['coat', 'id', 'met', 'name', 'shared']));
    expect(snap.friends.some((f) => f.knownOn === 'instagram')).toBe(true);
    expect(snap.postcards.filter((p) => p.invitation)).toHaveLength(1);
  });
});

describe('the garden’s state', () => {
  it('opens a first visit on today’s arrivals; older post counts as read, older baskets as visited', async () => {
    vi.useFakeTimers({ now: NOW });
    const state = new GardenState(placeholderSource());
    await state.start();
    expect(state.unread.map((p) => p.id).sort()).toEqual(['inv-pip', 'pc-terrace']);
    expect(state.freshBasket?.day).toBe('2026-10-31');
    expect(state.browseOrder[0]).toBe(state.baskets[0].finds[0]);
    vi.useRealTimers();
  });

  it('likes, reads, puts away and uses an invitation once; tells the source', async () => {
    const source = placeholderSource();
    const reactions: unknown[] = [];
    source.react = (r) => (reactions.push(r), Promise.resolve());
    const state = new GardenState(source);
    await state.start();
    const id = state.browseOrder[2];
    expect(state.toggleLike(id)).toBe(true);
    expect(state.likedFindIds).toEqual([id]);
    state.putAway('pc-terrace');
    expect(state.mail.some((p) => p.id === 'pc-terrace')).toBe(false);
    expect(state.isRead('pc-terrace')).toBe(true);
    expect(state.invitations).toHaveLength(1);
    state.useInvitation('inv-pip');
    expect(state.invitations).toHaveLength(0);
    state.setShared('noodles', true);
    expect(state.interest('noodles')?.shared).toBe(true);
    expect(reactions).toEqual([
      { type: 'like-find', id, liked: true },
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
