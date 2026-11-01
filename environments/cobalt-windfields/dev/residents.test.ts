import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { loadResidents, residentName, ResidentLife, RESIDENT_STORAGE_KEY } from '../life/residentLife';
import { MuseRoam } from '../life/museRoam';
import type { FieldParams } from '../planet/fields';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';

const PARAMS: FieldParams = { roll: 1.25, hummocks: 0.35, wetlands: 0, waterLevel: 0, grain: 0.6, density: 10, patchiness: 0.78, patchSize: 13, weights: [0.4, 0.24, 0.22, 0.14] };
function terrainAt(radius = 128, seed = 166): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, (2 * radius) / 512);
  return terrain;
}

describe('Cobalt Windfield residents', () => {
  for (const radius of [40, 128, 400]) {
    it(`walks safely on dry ground, rests, and keeps neighbours apart at R=${radius}`, () => {
      const terrain = terrainAt(radius);
      const lives = [0, 1, 2].map((index) => new ResidentLife(index));
      const camera = terrain.layout.cottage.clone().multiplyScalar(radius + 20);
      const ground = createGroundSample();
      const prior: Array<Vector3 | undefined> = [];
      const priorHeading: Array<Vector3 | undefined> = [];
      const seen = new Set<string>();
      let worstStep = 0;
      let worstTurn = 0;
      for (let time = 0; time < 180; time += 0.1) {
        const positions = lives.map((life, i) => {
          const out = life.at(time, terrain, camera);
          const point = out.dir.clone().multiplyScalar(radius + out.height);
          const local = terrain.cottageLocal(out.dir, { x: 0, z: 0 });
          expect(local.z).toBeGreaterThan(8);
          expect(Math.abs(local.x)).toBeLessThan(12);
          expect(terrain.sample(out.dir, ground).water).toBeGreaterThan(0.6);
          expect(out.height).toBeCloseTo(ground.height, 8);
          expect(out.heading.length()).toBeCloseTo(1, 8);
          expect(out.heading.dot(out.dir)).toBeCloseTo(0, 8);
          if (prior[i]) worstStep = Math.max(worstStep, point.distanceTo(prior[i]));
          if (priorHeading[i]) worstTurn = Math.max(worstTurn, out.heading.angleTo(priorHeading[i]));
          prior[i] = point;
          priorHeading[i] = out.heading.clone();
          if (out.action.walk > 0.1) seen.add('walk');
          out.action.moves.forEach((move) => seen.add(move.kind));
          return point;
        });
        for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) expect(positions[i].distanceTo(positions[j])).toBeGreaterThan(2);
      }
      expect(worstStep).toBeLessThan(0.09);
      expect(worstTurn).toBeLessThan(0.15);
      expect(seen.has('walk')).toBe(true);
      expect(seen.has('sit')).toBe(true);
    }, 20_000);
  }

  it('is deterministic when seeking and rebuilds on growth or a changed seed', () => {
    const terrain = terrainAt();
    const camera = new Vector3(0, 160, 0);
    const a = new ResidentLife(1);
    const b = new ResidentLife(1);
    a.at(900, terrain, camera);
    for (const time of [12, 77, 801]) expect(a.at(time, terrain, camera).dir.distanceTo(b.at(time, terrain, camera).dir)).toBeLessThan(1e-12);
    for (const [radius, seed] of [[40, 166], [400, 411], [128, 890]]) {
      terrain.setLayout(generateLayout(seed));
      terrain.update(radius, PARAMS, (2 * radius) / 512);
      const fresh = new ResidentLife(1);
      expect(a.at(30, terrain, camera).dir.distanceTo(fresh.at(30, terrain, camera).dir)).toBeLessThan(1e-12);
    }
  });

  it('greets, pauses to be petted, releases and resumes its route', () => {
    const terrain = terrainAt();
    const camera = terrain.layout.cottage.clone().multiplyScalar(160);
    const life = new ResidentLife(0);
    life.at(10, terrain, camera);
    life.tap(10);
    expect(life.at(10.3, terrain, camera).action.wave).toBeCloseTo(0.3);
    life.hold(20, 1);
    const first = life.at(21, terrain, camera).dir.clone();
    const held = life.at(25, terrain, camera);
    expect(held.action.moves.some((move) => move.kind === 'pet')).toBe(true);
    expect(held.cues.petted).toBeGreaterThan(0);
    expect(held.dir.distanceTo(first)).toBeLessThan(1e-9);
    life.letGo(25);
    const released = life.at(45, terrain, camera);
    expect(released.cues.petted).toBe(-1);
    expect(released.dir.distanceTo(first)).toBeGreaterThan(0.001);
    expect(life.activity).not.toBe('Enjoying a little affection');
  });

  it('loads only known local identities and sanitizes persisted names', () => {
    const values = new Map([[RESIDENT_STORAGE_KEY, JSON.stringify([{ id: 'pip', name: '  Fern\n  ' }, { id: 'unknown', name: 'Visitor' }])]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const roster = loadResidents(storage);
    expect(roster.map(({ id }) => id)).toEqual(['pip', 'juniper', 'marlo']);
    expect(roster[0].name).toBe('Fern');
    expect(residentName('   ', 'Pip')).toBe('Pip');
    expect(residentName('A'.repeat(50), 'Pip')).toHaveLength(24);
    values.set(RESIDENT_STORAGE_KEY, '{malformed');
    expect(loadResidents(storage)[0].name).toBe('Pip');
  });

  it('keeps the host busy on dry pastimes, without fishing or watering empty ground', () => {
    const terrain = terrainAt();
    const roam = new MuseRoam(terrain, 1.65);
    const camera = terrain.layout.cottage.clone().multiplyScalar(160);
    const seen = new Set<string>();
    for (let time = 0; time < 1200; time += 1) {
      const out = roam.at(time, camera);
      expect(out.cues.water).toBeNull();
      expect(out.cues.fish).toBeNull();
      out.action.moves.forEach((move) => seen.add(move.kind));
    }
    expect(seen.has('perch')).toBe(true);
    expect(seen.has('stir')).toBe(true);
  });
});
