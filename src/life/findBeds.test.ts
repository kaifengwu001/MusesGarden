import { Vector3, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { FindBeds, type BedLook } from './findBeds';

const R = 128;

function looks(n: number): BedLook[] {
  return Array.from({ length: n }, (_, i) => ({ bed: { find: `find-${i}`, basket: `b-${i % 7}`, dir: new Vector3(Math.sin(i), 1, Math.cos(i * 1.3)).normalize(), ground: 1 }, species: (i % 4) as 0 | 1 | 2 | 3, variant: 0.4 }));
}

/** Per find, its plants' distances from its middle (m). */
function plants(beds: FindBeds, list: readonly BedLook[]): number[][] {
  const out = list.map((): number[] => []);
  for (const mesh of beds.meshes) {
    const place = mesh.geometry.getAttribute('aPlace') as InstancedBufferAttribute;
    const look = mesh.geometry.getAttribute('aLook') as InstancedBufferAttribute;
    for (let k = 0; k < place.count; k++) {
      const find = look.getW(k);
      out[find].push(new Vector3(place.getX(k), place.getY(k), place.getZ(k)).angleTo(list[find].bed.dir) * R);
    }
  }
  return out;
}

describe('FindBeds', () => {
  it('grows a patch for every find, old baskets included, and a sphere for each', () => {
    const beds = new FindBeds({});
    const list = looks(400);
    beds.set(list, R, new Set());
    const each = plants(beds, list);
    expect(each.every((p) => p.length === each[0].length && p.length > 30)).toBe(true);
    expect(beds.spheres.geometry.drawRange.count).toBe(400);
  });

  it('fills each patch to its middle with flowers', () => {
    const beds = new FindBeds({});
    const list = looks(40);
    beds.set(list, R, new Set());
    // (the quarter metre round the middle was once left to a specimen)
    for (const distances of plants(beds, list)) expect(distances.filter((d) => d < 0.25).length).toBeGreaterThanOrEqual(3);
  });

  it('plants a patch hidden until now, and marks the picked basket', () => {
    const beds = new FindBeds({});
    const list = looks(10);
    beds.set(list, R, new Set(['find-3']));
    expect(beds.planted('find-3')).toBe(false);
    expect(beds.planted('find-4')).toBe(true);
    beds.plant(['find-3'], 0.3, -1);
    expect(beds.planted('find-3')).toBe(true);
    beds.select(['find-1', 'find-8']);
    beds.hover('find-8');
    expect(beds.selected).toEqual(['find-1', 'find-8']);
    expect(beds.hovered).toBe('find-8');
  });

  it('flags one hero per patch: of the find’s own species, the plant nearest its middle', () => {
    const beds = new FindBeds({});
    const list = looks(60);
    beds.set(list, R, new Set());
    const flagged = list.map((): Array<{ species: number; d: number; k: number }> => []);
    const nearest = list.map(() => Infinity);
    beds.meshes.forEach((mesh, species) => {
      const place = mesh.geometry.getAttribute('aPlace') as InstancedBufferAttribute;
      const look = mesh.geometry.getAttribute('aLook') as InstancedBufferAttribute;
      const delay = mesh.geometry.getAttribute('aDelay') as InstancedBufferAttribute;
      for (let k = 0; k < place.count; k++) {
        const find = look.getW(k);
        const d = new Vector3(place.getX(k), place.getY(k), place.getZ(k)).angleTo(list[find].bed.dir) * R;
        if (species === list[find].species) nearest[find] = Math.min(nearest[find], d);
        if (delay.getX(k) < 0) flagged[find].push({ species, d, k });
        // the flag is only a sign: every plant still rises after its distance from the middle
        expect(Math.abs(delay.getX(k))).toBeLessThanOrEqual(0.85 + 1e-6);
      }
    });
    flagged.forEach((heroes, find) => {
      expect(heroes, list[find].bed.find).toHaveLength(1);
      expect(heroes[0].species).toBe(list[find].species);
      expect(heroes[0].d).toBe(nearest[find]);
      // and hero() describes that plant as its patch draws it
      const hero = beds.hero(list[find].bed.find);
      const mesh = beds.meshes[heroes[0].species].geometry;
      const look = mesh.getAttribute('aLook') as InstancedBufferAttribute;
      const place = mesh.getAttribute('aPlace') as InstancedBufferAttribute;
      expect(hero?.species).toBe(list[find].species);
      expect(hero?.ground).toBe(list[find].bed.ground);
      expect(hero?.dir.angleTo(new Vector3(place.getX(heroes[0].k), place.getY(heroes[0].k), place.getZ(heroes[0].k)))).toBeLessThan(1e-6);
      expect([hero?.seed, hero?.size, hero?.variant].map((v) => Math.fround(v ?? NaN))).toEqual([look.getX(heroes[0].k), look.getY(heroes[0].k), look.getZ(heroes[0].k)]);
    });
    expect(beds.hero('not-a-find')).toBeNull();
  });

  it('fits 400 finds’ patches and spheres in 1 MB, hero flags and all', () => {
    const beds = new FindBeds({});
    beds.set(looks(400), R, new Set());
    const bytes = [...beds.meshes, beds.spheres].flatMap((m) => Object.values(m.geometry.attributes).map((a) => a.array.byteLength));
    expect(bytes.reduce((sum, b) => sum + b, 0)).toBeLessThanOrEqual(1_000_000);
  });

  it('brings one find’s hero into focus at a time', () => {
    const beds = new FindBeds({});
    beds.set(looks(5), R, new Set());
    beds.focus('find-2');
    expect(beds.focused).toBe('find-2');
    beds.focus(null);
    expect(beds.focused).toBeNull();
  });

  it('hands the patches over to the spheres as the camera rises', () => {
    const beds = new FindBeds({});
    beds.set(looks(5), R, new Set());
    const at = (altitude: number, shown = true): [boolean, boolean, number] => {
      beds.update(altitude, shown);
      return [beds.bedsShown(), beds.spheres.visible, beds.spheresShown()];
    };
    expect(at(10)).toEqual([true, false, 0]);
    expect(at(80)[0]).toBe(true);
    expect(at(80)[2]).toBeGreaterThan(0);
    expect(at(400)).toEqual([false, true, 1]);
    expect(at(400, false)).toEqual([false, false, 0]);
  });
});
