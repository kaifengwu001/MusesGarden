// Likes from the garden, end to end through the commands: what reaches the log, and what is refused.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiscoveryId, Instant, MuseEventBody, MuseId, PhotoId } from '../../src/muse/contract';
import { FIXTURES_DIR, readMemberDocs } from '../fixtures/cast';
import { buildGarden } from './compose';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const H = 3_600_000;
const A = 'twin-a' as MuseId;
const B = 'twin-b' as MuseId;

/** Two introduced Muses after four days: finds, photos, and hangouts with each other's photos. */
async function garden() {
  const g = buildGarden({ db: null, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
  const soul = readFileSync(join(FIXTURES_DIR, 'divergence/a/SOUL.md'), 'utf8');
  const seed = (id: MuseId) => ({ id, name: id, worldSeed: 412, timezone: 'America/Los_Angeles' });
  await g.engine.addMuse(seed(A), soul, readMemberDocs({ dir: 'divergence/a' }).memory, START);
  await g.engine.addMuse(seed(B), soul, readMemberDocs({ dir: 'divergence/b' }).memory, START);
  await g.engine.introduce(A, B, START);
  await g.engine.advanceTo((START + 4 * 24 * H) as Instant);
  return g;
}

const likes = (g: Awaited<ReturnType<typeof garden>>): MuseEventBody[] =>
  g.engine.log(A).flatMap((e) => (e.event.kind === 'owner.liked' ? [e.event] : []));

describe('likes through the commands', () => {
  it('records a like once, an unlike once, and refuses what Muse never had', async () => {
    const g = await garden();
    const s = g.engine.state(A);
    const [find] = s?.discoveries.keys() ?? [];
    expect(find).toBeDefined();
    expect(await g.commands.like(A, { find }, true)).toEqual({ ok: true });
    expect(await g.commands.like(A, { find }, true)).toEqual({ ok: true });
    expect(await g.commands.like(A, { find }, false)).toEqual({ ok: true });
    expect(likes(g)).toEqual([
      expect.objectContaining({ target: { find }, liked: true }),
      expect.objectContaining({ target: { find }, liked: false }),
    ]);
    expect(await g.commands.like(A, { find: 'd:nowhere' as DiscoveryId }, true)).toMatchObject({ ok: false, status: 404 });
    expect(await g.commands.like(A, { photo: 'p:nowhere' as PhotoId }, true)).toMatchObject({ ok: false, status: 404 });
    expect(await g.commands.like('nobody' as MuseId, { find }, true)).toMatchObject({ ok: false, status: 404 });
    expect(likes(g)).toHaveLength(2);
    g.store.close();
  });

  it('names the friend a liked photo shows, and no one for a photo without a friend', async () => {
    const g = await garden();
    const photos = g.engine.state(A)?.photos ?? [];
    const withFriend = photos.find((p) => p.subject === 'friend' || p.subject === 'new-friend');
    const alone = photos.find((p) => p.companions.length === 0);
    if (!withFriend || !alone) throw new Error('four days should bring a hangout photo and one taken alone');
    await g.commands.like(A, { photo: withFriend.id }, true);
    await g.commands.like(A, { photo: alone.id }, true);
    const [friendly, solo] = likes(g);
    expect(friendly).toMatchObject({ target: { photo: withFriend.id }, friend: B });
    expect(solo).toEqual({ kind: 'owner.liked', target: { photo: alone.id }, liked: true, at: expect.any(Number) as number });
    g.store.close();
  });
});

describe('favorites through the commands', () => {
  const favorites = (g: Awaited<ReturnType<typeof garden>>): MuseEventBody[] =>
    g.engine.log(A).flatMap((e) => (e.event.kind === 'owner.favorited' ? [e.event] : []));

  it('records a star once and an unstar once, shows each on the postcard, and refuses a photo Muse never took', async () => {
    const g = await garden();
    const [photo] = g.engine.state(A)?.photos ?? [];
    expect(photo).toBeDefined();
    const card = () => g.views.garden(A, g.engine.now())?.postcards.find((p) => p.id === photo.id);
    expect(card()?.favorite).toBe(false);
    expect(await g.commands.favorite(A, photo.id, true)).toEqual({ ok: true });
    expect(await g.commands.favorite(A, photo.id, true)).toEqual({ ok: true });
    expect(card()?.favorite).toBe(true);
    expect(await g.commands.favorite(A, photo.id, false)).toEqual({ ok: true });
    expect(card()?.favorite).toBe(false);
    expect(favorites(g)).toEqual([
      { kind: 'owner.favorited', photo: photo.id, favorite: true, at: expect.any(Number) as number },
      { kind: 'owner.favorited', photo: photo.id, favorite: false, at: expect.any(Number) as number },
    ]);
    expect(await g.commands.favorite(A, 'p:nowhere' as PhotoId, true)).toMatchObject({ ok: false, status: 404 });
    expect(await g.commands.favorite('nobody' as MuseId, photo.id, true)).toMatchObject({ ok: false, status: 404 });
    expect(favorites(g)).toHaveLength(2);
    g.store.close();
  });

  it('never nudges Muse: a starred photo of a friend leaves its friendship as it was, where a like warms it', async () => {
    const g = await garden();
    const photo = g.engine.state(A)?.photos.find((p) => p.subject === 'friend' || p.subject === 'new-friend');
    if (!photo) throw new Error('four days should bring a hangout photo');
    const before = g.engine.state(A)!;
    await g.commands.favorite(A, photo.id, true);
    const starred = g.engine.state(A)!;
    expect(starred.social.relationships.get(B)).toEqual(before.social.relationships.get(B));
    expect(starred.interests).toEqual(before.interests);
    await g.commands.like(A, { photo: photo.id }, true);
    expect(g.engine.state(A)!.social.relationships.get(B)?.fondness).toBe((before.social.relationships.get(B)?.fondness ?? 0) + 1);
    g.store.close();
  });
});
