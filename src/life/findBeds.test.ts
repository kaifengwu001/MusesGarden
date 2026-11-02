import { Vector3, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { FindBeds, heroStance, type BedLook } from './findBeds';

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
    beds.set(list, R);
    const each = plants(beds, list);
    expect(each.every((p) => p.length === each[0].length && p.length > 30)).toBe(true);
    expect(beds.spheres.geometry.drawRange.count).toBe(400);
  });

  it('fills each patch to its middle with flowers', () => {
    const beds = new FindBeds({});
    const list = looks(40);
    beds.set(list, R);
    // (the quarter metre round the middle was once left to a specimen)
    for (const distances of plants(beds, list)) expect(distances.filter((d) => d < 0.25).length).toBeGreaterThanOrEqual(3);
  });

  it('marks the picked basket and lifts the find under the pointer', () => {
    const beds = new FindBeds({});
    const list = looks(10);
    beds.set(list, R);
    beds.select(['find-1', 'find-8']);
    beds.hover('find-8');
    expect(beds.selected).toEqual(['find-1', 'find-8']);
    expect(beds.hovered).toBe('find-8');
  });

  it('flags one hero per patch: of the find’s own species, the plant nearest its middle', () => {
    const beds = new FindBeds({});
    const list = looks(60);
    beds.set(list, R);
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

  it('stands a hero where its patch grows it, upright, and taller and larger in focus or marked', () => {
    const beds = new FindBeds({});
    const list = looks(12);
    beds.set(list, R);
    for (const { bed } of list) {
      const hero = beds.hero(bed.find)!;
      const rest = heroStance(hero, R, { mark: 0, lift: 0, focus: 0, open: 0 });
      // its foot on its own ground, its up the planet's there, its frame square and right-handed
      expect(rest.foot.clone().normalize().angleTo(hero.dir)).toBeLessThan(1e-9);
      expect(rest.foot.length()).toBeCloseTo(R + hero.ground, 1);
      expect(rest.up.angleTo(hero.dir)).toBeLessThan(1e-9);
      expect([rest.side.dot(rest.up), rest.forward.dot(rest.up), rest.side.dot(rest.forward)].map((d) => Math.abs(d) < 1e-9)).toEqual([true, true, true]);
      expect(rest.side.clone().cross(rest.up).dot(rest.forward)).toBeCloseTo(1, 9);
      // about its plant's own size
      expect(rest.scale / hero.size).toBeGreaterThan(0.84);
      expect(rest.scale / hero.size).toBeLessThan(1.16);
      const focused = heroStance(hero, R, { mark: 0, lift: 0, focus: 1, open: 0 });
      const marked = heroStance(hero, R, { mark: 1, lift: 0, focus: 0, open: 0 });
      expect(focused.foot.length()).toBeGreaterThan(rest.foot.length() + 0.05);
      expect(focused.scale).toBeGreaterThan(rest.scale * 1.2);
      expect(marked.scale).toBeGreaterThan(rest.scale * 1.2);
      expect(focused.side.angleTo(rest.side)).toBeLessThan(1e-9);
    }
  });

  it('fits 400 finds’ patches and spheres in 1 MB, hero flags and all', () => {
    const beds = new FindBeds({});
    beds.set(looks(400), R);
    const bytes = [...beds.meshes, beds.spheres].flatMap((m) => Object.values(m.geometry.attributes).map((a) => a.array.byteLength));
    expect(bytes.reduce((sum, b) => sum + b, 0)).toBeLessThanOrEqual(1_000_000);
  });

  it('brings one find’s hero into focus at a time', () => {
    const beds = new FindBeds({});
    beds.set(looks(5), R);
    beds.focus('find-2');
    expect(beds.focused).toBe('find-2');
    beds.focus(null);
    expect(beds.focused).toBeNull();
  });

  it('is picked as drawn: through its flowers’ heads standing over its ground, the nearest along the ray', () => {
    const beds = new FindBeds({});
    const up = new Vector3(0, 1, 0);
    const beside = new Vector3(1, 0, 0);
    // two patches in a row on a flat warp, the camera 8 m short of the first
    const near = up.clone().applyAxisAngle(new Vector3(0, 0, 1), -2 / R);
    const far = up.clone().applyAxisAngle(new Vector3(0, 0, 1), -5 / R);
    beds.set(
      [near, far].map((dir, i) => ({ bed: { find: `find-${i}`, basket: 'b', dir, ground: 0 }, species: 0 as const, variant: 0.4 })),
      R,
    );
    const warp = { focus: up.clone().multiplyScalar(R), up, k: 0 };
    const at = (dir: Vector3, height: number, side = 0, eyeHeight = 2): string | null => {
      const eye = up.clone().multiplyScalar(R + eyeHeight).addScaledVector(beside, -6);
      const target = dir.clone().multiplyScalar(R + height).addScaledVector(new Vector3(0, 0, 1), side);
      return beds.pick(eye, target.sub(eye).normalize(), warp, R)?.find ?? null;
    };
    expect(at(near, 0.55), 'a head half a metre up, whose ray meets the ground 3 m behind the patch').toBe('find-0');
    expect(at(far, 0.6, 0, 5), 'the far patch, seen over the near one').toBe('find-1');
    expect(at(near, 0.1, 3), 'the ground beside it').toBeNull();
    expect(at(near, 2.5), 'the air over it').toBeNull();
  });

  it('hands the patches over to the spheres as the camera rises', () => {
    const beds = new FindBeds({});
    beds.set(looks(5), R);
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
