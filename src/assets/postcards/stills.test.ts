import { describe, expect, it } from 'vitest';
import { assignStills, PLAIN, poolFor, STILLS, type PhotoToShow, type PlanetStills, type StillKey } from './stills';

const onDisk = new Set(Object.keys(import.meta.glob('./*.jpg', { query: '?url', import: 'default', eager: true })).map((p) => p.slice(2)));
const keys = Object.keys(STILLS) as StillKey[];
/** Five photos a day for 90 days, their keys in a fixed but uneven mix, as a Muse would take them. */
const MIX: readonly StillKey[] = ['scenery', 'friend', 'sky', 'selfie', 'friend', 'closeup', 'home', 'selfie', 'creature', 'work', 'scenery', 'beyond', 'find', 'friend', 'new-friend'];
const photos: PhotoToShow[] = Array.from({ length: 450 }, (_, i) => ({
  id: `p${i}`,
  key: MIX[(i * 7 + Math.floor(i / 5)) % MIX.length],
  day: `day-${Math.floor(i / 5)}`,
}));
const shown = assignStills(photos, 'fern');
const look = (id: string) => JSON.stringify(shown.get(id)!.look);

describe('the postcard stills', () => {
  it('lists only files that are in the folder', () => {
    for (const key of keys) for (const file of STILLS[key]) expect(onDisk, `${key}: ${file}`).toContain(file);
  });

  it('lists every rendered still', () => {
    const listed = new Set(keys.flatMap((key) => STILLS[key]));
    for (const file of onDisk) if (/-\d+\.jpg$/.test(file)) expect(listed, file).toContain(file);
  });

  it('has at least three stills of each subject', () => {
    for (const key of keys) expect(STILLS[key].length, key).toBeGreaterThanOrEqual(3);
  });

  it('gives a photo the same still and look every time, and taking more photos never changes the earlier ones', () => {
    expect(assignStills(photos, 'fern')).toEqual(shown);
    const earlier = assignStills(photos.slice(0, 200), 'fern');
    for (const [id, still] of earlier) expect(shown.get(id), id).toEqual(still);
  });

  it('shows none of a subject’s stills again before it has shown them all', () => {
    for (const key of Object.keys(STILLS) as StillKey[]) {
      const files = photos.filter((p) => p.key === key).map((p) => shown.get(p.id)!.file);
      const n = STILLS[key].length;
      for (let start = 0; start + n <= files.length; start += n) {
        expect(new Set(files.slice(start, start + n)).size, `${key} round from ${start}`).toBe(n);
      }
    }
  });

  it('never shows the same still twice in a day', () => {
    const days = new Map<string, string[]>();
    for (const p of photos) days.set(p.day, [...(days.get(p.day) ?? []), shown.get(p.id)!.file]);
    for (const [day, files] of days) expect(new Set(files).size, `${day}: ${files.join(', ')}`).toBe(files.length);
  });

  it('shows a still the first time as it is, and every time after with a look it hasn’t had', () => {
    const seen = new Map<string, Set<string>>();
    for (const p of photos) {
      const { file } = shown.get(p.id)!;
      const looks = seen.get(file) ?? new Set<string>();
      if (looks.size === 0) expect(shown.get(p.id)!.look, `${file} first`).toEqual(PLAIN);
      expect(looks, `${file} again`).not.toContain(look(p.id));
      looks.add(look(p.id));
      seen.set(file, looks);
    }
  });

  it('deals each Muse its own order', () => {
    const other = assignStills(photos, 'wren');
    expect(photos.filter((p) => other.get(p.id)!.file !== shown.get(p.id)!.file).length).toBeGreaterThan(photos.length / 2);
  });
});

describe('a photo taken on another planet', () => {
  const violet: PlanetStills = {
    friend: ['violet-dunes/friend-1.jpg', 'violet-dunes/friend-2.jpg'],
    scenery: ['violet-dunes/scenery-1.jpg', 'violet-dunes/scenery-2.jpg', 'violet-dunes/scenery-3.jpg'],
  };
  const planets = new Map([['violet-dunes', violet]]);

  it('shows that planet: its stills of that kind, else its nearest kind; the meadow’s only where it has none near', () => {
    expect(poolFor('friend', 'violet-dunes', planets).files).toBe(violet.friend);
    expect(poolFor('selfie', 'violet-dunes', planets).files, 'a selfie, two Muses close: its friends').toBe(violet.friend);
    expect(poolFor('home', 'violet-dunes', planets).files, 'its home, out of shots of it: its scenery').toBe(violet.scenery);
    expect(poolFor('beyond', 'violet-dunes', planets).files, 'nothing near a view from beyond').toBe(STILLS.beyond);
    expect(poolFor('friend', 'golden-rye', planets).files, 'a planet with no stills yet').toBe(STILLS.friend);
    expect(poolFor('friend', undefined, planets).files).toBe(STILLS.friend);
  });

  it('is dealt from that planet, in rounds of its own, leaving the meadow’s rounds to the meadow’s photos', () => {
    const away: PhotoToShow[] = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, key: 'friend', day: `day-${i}`, planet: 'violet-dunes' }));
    const both = assignStills([...photos, ...away], 'fern', planets);
    for (const p of photos) expect(both.get(p.id), p.id).toEqual(shown.get(p.id));
    const files = away.map((p) => both.get(p.id)!.file);
    for (const f of files) expect(violet.friend).toContain(f);
    // two stills, six photos: each round shows both before either comes again, and a still come round again looks its own
    expect(new Set(files.slice(0, 2)).size).toBe(2);
    const looks = away.map((p) => JSON.stringify(both.get(p.id)!.look));
    expect(looks[0]).toBe(JSON.stringify(PLAIN));
    expect(new Set(away.map((_, k) => `${files[k]}|${looks[k]}`)).size, 'no two photos the same picture').toBe(6);
  });
});
