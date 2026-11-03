import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { angleBetween } from '../planet/geo';
import { moved, SNAP, snapBeds, type SnapBed } from './snap';

const R = 128;
/** A planet whose sea covers every place with x below 0.5, its shore a circle; land rises 0.01 m per meter from it. */
const probe = (dir: Vector3) => {
  const water = (dir.x - 0.5) * R;
  return { height: Math.max(0, water) * 0.01, water };
};
const bed = (find: string, x: number, y: number, z: number): SnapBed => ({ find, basket: 'visit', dir: new Vector3(x, y, z).normalize(), ground: 0 });
const apart = (a: SnapBed, b: SnapBed) => angleBetween(a.dir, b.dir) * R;

describe('beds left on the water', () => {
  it('stay as they are on dry ground: the very same objects', () => {
    const dry = bed('a', 0.9, 0.3, 0.1);
    const out = snapBeds(new Map([['a', dry]]), R, probe);
    expect(out.get('a')).toBe(dry);
  });

  it('move to the nearest dry ground within reach, with its height', () => {
    const wet = bed('a', 0.4, 0.9, 0.1);
    expect(probe(wet.dir).water).toBeLessThan(0);
    const out = snapBeds(new Map([['a', wet]]), R, probe).get('a')!;
    expect(probe(out.dir).water).toBeGreaterThanOrEqual(SNAP.clear);
    expect(out.ground).toBeCloseTo(probe(out.dir).height, 9);
    // the nearest dry ground is straight up the meridian toward +x, to where x = 0.5 + clear / R
    const nearest = (Math.asin(0.5 + SNAP.clear / R) - Math.asin(wet.dir.x)) * R;
    expect(apart(out, wet), 'about as far as the nearest dry ground').toBeGreaterThanOrEqual(nearest - 1e-6);
    expect(apart(out, wet)).toBeLessThan(nearest + 1.5 * SNAP.step);
    expect(out).toMatchObject({ find: 'a', basket: 'visit' });
  });

  it('keep clear of each other, and of the beds already dry', () => {
    const beds = new Map([
      ['dry', bed('dry', 0.62, 0.78, 0.0)],
      ['a', bed('a', 0.45, 0.89, 0.0)],
      ['b', bed('b', 0.45, 0.89, 0.01)],
    ]);
    const out = snapBeds(beds, R, probe);
    const all = [...out.values()];
    for (const x of all) expect(probe(x.dir).water, x.find).toBeGreaterThanOrEqual(SNAP.clear);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(apart(all[i], all[j]), `${all[i].find}–${all[j].find}`).toBeGreaterThanOrEqual(SNAP.spacing - 1e-6);
    expect(out.get('dry')).toBe(beds.get('dry'));
  });

  it('stay where they are when no dry ground is in reach, and say how far each moved', () => {
    const far = bed('far', -0.9, 0.1, 0.0);
    const near = bed('near', 0.45, 0.89, 0.0);
    const before = new Map([['far', far], ['near', near]]);
    const out = snapBeds(before, R, probe);
    expect(out.get('far')).toBe(far);
    const distances = moved(before, out, R);
    expect(distances.get('far')).toBe(0);
    expect(distances.get('near')).toBeGreaterThan(0);
    expect(distances.get('near')).toBeLessThanOrEqual(SNAP.reach);
  });
});
