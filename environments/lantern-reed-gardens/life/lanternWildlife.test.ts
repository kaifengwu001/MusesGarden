import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LanternWildlife } from './lanternWildlife';
import { CanyonScenery } from './canyonScenery';
import { poolglassGeometry, reedWaderGeometry } from './lanternWildlifeGeometry';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const params: FieldParams = { roll: 1.5, hummocks: 0.25, wetlands: 0.58, waterLevel: 0, grain: 0.5, density: 0.5, patchiness: 0.9, patchSize: 13, weights: [0.1, 0.7, 0.1, 0.1] };
function terrain(radius = 128, seed = 412): Terrain { const t = new Terrain(generateLayout(seed)); t.update(radius, params, 0.5); return t; }
function snapshot(w: LanternWildlife): number[][] { return w.poses.map(p => [...p.dir.toArray(), ...p.forward.toArray(), p.height, p.scale, p.phase, p.moving, p.visible ? 1 : 0]); }

describe('Lantern wildlife', () => {
  it('builds distinct finite animal anatomy at the reference proportions', () => {
    for (const [geometry, minKinds] of [[poolglassGeometry(), 7], [reedWaderGeometry(), 9]] as const) {
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new Vector3());
      expect(size.z).toBeGreaterThan(2.3);
      expect(size.x).toBeGreaterThan(1.6);
      expect(size.y).toBeLessThan(2);
      const p = geometry.getAttribute('position');
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      expect(new Set(Array.from(geometry.getAttribute('aKind').array)).size).toBeGreaterThanOrEqual(minKinds);
      expect(p.count).toBeLessThan(15_000);
      geometry.dispose();
    }
  });

  it('keeps three swimmers in water and three waders on dry, shallow-sloped banks', () => {
    for (const radius of [40, 128, 400]) for (const seed of [5, 412, 9999]) {
      const t = terrain(radius, seed), w = new LanternWildlife({}, t), sample = createGroundSample();
      const first = w.poses.map(p => p.dir.clone());
      const motion = new Array<number>(6).fill(0);
      for (let time = 0; time <= 96; time += 4) {
        w.update(time, t);
        expect(w.poses.filter(p => p.visible), JSON.stringify({ radius, seed, time, hidden: w.poses.filter(p => !p.visible).map(p => p.id) })).toHaveLength(6);
        w.poses.forEach((p, i) => {
          const g = t.sample(p.dir, sample);
          expect(p.dir.length()).toBeCloseTo(1, 10);
          expect(p.forward.length()).toBeCloseTo(1, 10);
          if (p.species === 'poolglass') { expect(g.depth).toBeGreaterThan(0.28); expect(g.water).toBeLessThan(-1.2); expect(p.height).toBeLessThan(0); expect(p.height).toBeGreaterThan(-0.15); }
          else { expect(g.water).toBeGreaterThanOrEqual(0.85); expect(p.height).toBeCloseTo(g.height + 0.015, 8); }
          motion[i] = Math.max(motion[i], first[i].angleTo(p.dir) * radius);
        });
      }
      motion.forEach(m => expect(m).toBeGreaterThan(0.5));
      w.dispose();
    }
  }, 20_000);

  it('keeps the foreground wader and all four feet supported by its actual stone shelf', () => {
    const t = terrain(), banks = new CanyonScenery({}, t), w = new LanternWildlife({}, t, banks);
    for (let time = 0; time <= 64; time += 8) {
      banks.update(time, t); w.update(time, t);
      const hero = w.poses.find(p => p.id === 'reed-wader-adult')!;
      expect(w.poses.every(p => p.visible)).toBe(true);
      w.poses.filter(p => p.species === 'poolglass').forEach(p => expect(banks.waterClearAt(p.x, p.z, p.scale * 2 + 0.1)).toBe(true));
      const swimmer = w.poses.find(p => p.id === 'poolglass-adult')!;
      // Keep the adult in the visible foreground channel, rather than resolving
      // it behind the causeway simply to make room for a large swim orbit.
      expect(swimmer.x).toBeLessThan(-31);
      expect(swimmer.z).toBeGreaterThan(33);
      expect(hero.visible).toBe(true);
      expect(Math.abs(hero.x + 26)).toBeLessThan(0.3);
      expect(Math.abs(hero.z - 36)).toBeLessThan(0.3);
      const support = banks.shelfHeightAt(hero.x, hero.z);
      expect(support).not.toBeNull();
      expect(hero.height).toBeCloseTo(support! + 0.015, 7);
      for (let k = 0; k < 8; k++) expect(banks.shelfHeightAt(hero.x + Math.cos(k * Math.PI / 4) * hero.scale * 1.05, hero.z + Math.sin(k * Math.PI / 4) * hero.scale * 1.05)).not.toBeNull();
    }
    w.dispose(); banks.dispose();
  }, 15_000);

  it('keeps authored wildlife clear of stone and reed islands across planet sizes and seeds', () => {
    for (const radius of [40, 128, 400]) for (const seed of [5, 412, 9999]) {
      const t = terrain(radius, seed), banks = new CanyonScenery({}, t), w = new LanternWildlife({}, t, banks);
      for (const time of [0, 12, 48]) {
        banks.update(time, t); w.update(time, t);
        expect(w.poses.filter(p => p.visible), `${radius}/${seed}/${time}`).toHaveLength(6);
        for (const p of w.poses.filter(p => p.species === 'poolglass')) {
          expect(banks.waterClearAt(p.x, p.z, p.scale * 2 + 0.1), `${p.id}/${radius}/${seed}/${time}`).toBe(true);
          expect(t.sample(p.dir, createGroundSample()).depth).toBeGreaterThan(0.28);
          expect(p.height).toBeLessThan(0);
        }
      }
      w.dispose(); banks.dispose();
    }
  }, 20_000);

  it('is deterministic after time seeking and a settled growth round trip', () => {
    const t = terrain(), w = new LanternWildlife({}, t);
    w.update(12, t); w.update(12, t);
    const before = snapshot(w);
    w.update(80, t); w.update(12, t);
    expect(snapshot(w)).toEqual(before);
    t.update(40, params, 0.5); w.update(12, t);
    t.update(400, params, 0.5); w.update(12, t);
    t.update(128, params, 0.5); w.update(12, t); w.update(12, t);
    expect(snapshot(w)).toEqual(before);
    const copy = new LanternWildlife({}, terrain()); copy.update(12, terrain());
    expect(snapshot(copy)).toEqual(before);
    w.dispose(); copy.dispose();
  });
});
