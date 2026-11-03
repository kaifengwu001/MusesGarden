import { describe, expect, it } from 'vitest';
import { assignStills, PLAIN, STILLS, type PhotoToShow, type StillKey } from './stills';

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
