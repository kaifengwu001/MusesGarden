import { describe, expect, it } from 'vitest';
import { STILLS, stillFor, type StillKey } from './stills';

const onDisk = new Set(Object.keys(import.meta.glob('./*.jpg', { query: '?url', import: 'default', eager: true })).map((p) => p.slice(2)));
const keys = Object.keys(STILLS) as StillKey[];
const ids = Array.from({ length: 300 }, (_, i) => `photo-${i}`);

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

  it('gives a photo the same still every time', () => {
    for (const key of keys) for (const id of ids.slice(0, 20)) expect(stillFor(key, id)).toBe(stillFor(key, id));
  });

  it('spreads photos over all of a subject’s stills', () => {
    for (const key of keys) expect(new Set(ids.map((id) => stillFor(key, id))), key).toEqual(new Set(STILLS[key]));
  });
});
