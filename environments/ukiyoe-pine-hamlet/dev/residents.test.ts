import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { loadResidents, residentName, ResidentLife, RESIDENT_STORAGE_KEY } from '../life/residentLife';
import { MuseRoam } from '../life/museRoam';
import { ParamStore } from '../params';
import { FACE, TERRACE, walkableHeightAt } from '../life/props';
import { residentDirection } from '../life/residentLife';
import type { FieldParams } from '../planet/fields';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';

const p = new ParamStore().values;
const PARAMS: FieldParams = { roll: p.terrain.roll, hummocks: p.terrain.hummocks, wetlands: p.terrain.wetlands, waterLevel: p.terrain.waterLevel, grain: p.terrain.grain, density: p.flowers.density, patchiness: p.flowers.patchiness, patchSize: p.flowers.patchSize, weights: [p.flowers.pink, p.flowers.star, p.flowers.yellow, p.flowers.blue] };
function terrainAt(radius = 128, seed = 412): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, (2 * radius) / 512);
  return terrain;
}

describe('Pine Hamlet residents', () => {
  for (const radius of [40, 128, 400]) {
    it(`walks safely on dry ground, rests, and keeps neighbours apart at R=${radius}`, () => {
      const terrain = terrainAt(radius);
      const lives = [0, 1].map((index) => new ResidentLife(index));
      const camera = terrain.layout.cottage.clone().multiplyScalar(radius + 20);
      const ground = createGroundSample();
      const prior: Array<Vector3 | undefined> = [];
      const priorHeading: Array<Vector3 | undefined> = [];
      const seen = new Set<string>();
      let worstStep = 0;
      let worstTurn = 0;
      let minZ = Infinity, maxX = 0, minWater = Infinity, groundError = 0, headingError = 0, tangentError = 0, separation = Infinity;
      for (let time = 0; time < 180; time += 0.1) {
        const positions = lives.map((life, i) => {
          const out = life.at(time, terrain, camera);
          const point = out.dir.clone().multiplyScalar(radius + out.height);
          const local = terrain.cottageLocal(out.dir, { x: 0, z: 0 });
          minZ = Math.min(minZ, local.z);
          maxX = Math.max(maxX, Math.abs(local.x));
          minWater = Math.min(minWater, terrain.sample(out.dir, ground).water);
          groundError = Math.max(groundError, Math.abs(out.height - ground.height));
          headingError = Math.max(headingError, Math.abs(out.heading.length() - 1));
          tangentError = Math.max(tangentError, Math.abs(out.heading.dot(out.dir)));
          if (prior[i]) worstStep = Math.max(worstStep, point.distanceTo(prior[i]));
          if (priorHeading[i]) worstTurn = Math.max(worstTurn, out.heading.angleTo(priorHeading[i]));
          prior[i] = point;
          priorHeading[i] = out.heading.clone();
          if (out.action.walk > 0.1) seen.add('walk');
          out.action.moves.forEach((move) => seen.add(move.kind));
          return point;
        });
        for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) separation = Math.min(separation, positions[i].distanceTo(positions[j]));
      }
      expect(minZ).toBeGreaterThan(6.5);
      expect(maxX).toBeLessThan(8.3);
      expect(minWater).toBeGreaterThan(0.6);
      expect(groundError).toBeLessThan(1e-8);
      expect(headingError).toBeLessThan(1e-8);
      expect(tangentError).toBeLessThan(1e-8);
      expect(separation).toBeGreaterThan(2);
      expect(worstStep).toBeLessThan(0.09);
      expect(worstTurn).toBeLessThan(0.15);
      expect(seen.has('walk')).toBe(true);
      expect(seen.has('sit')).toBe(true);
    });
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

  it('rechecks routes when relief changes in place without changing the seed or radius', () => {
    const terrain = terrainAt();
    const camera = terrain.layout.cottage.clone().multiplyScalar(160);
    const lives = [0, 1].map(index => new ResidentLife(index));
    lives.forEach(life => life.at(30, terrain, camera));
    for (const params of [
      { ...PARAMS, roll: 0.2, hummocks: 1.4, grain: 0.95 },
      { ...PARAMS, roll: 4, hummocks: 0, grain: 0 },
    ]) {
      terrain.update(128, params, 0.5);
      lives.forEach((life, index) => {
        const fresh = new ResidentLife(index);
        for (const time of [30, 51, 92]) {
          const next = life.at(time, terrain, camera);
          expect(next.dir.distanceTo(fresh.at(time, terrain, camera).dir)).toBeLessThan(1e-12);
          expect(next.height).toBeCloseTo(terrain.height(next.dir), 8);
        }
      });
    }
  });

  it('loads only known local identities and sanitizes persisted names', () => {
    const values = new Map([[RESIDENT_STORAGE_KEY, JSON.stringify([{ id: 'sumi', name: '  Fern\n  ' }, { id: 'unknown', name: 'Visitor' }])]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const roster = loadResidents(storage);
    expect(roster.map(({ id }) => id)).toEqual(['sumi', 'mugi']);
    expect(roster[0].name).toBe('Fern');
    expect(residentName('   ', 'Sumi')).toBe('Sumi');
    expect(residentName('A'.repeat(50), 'Sumi')).toHaveLength(24);
    expect(Array.from(residentName('🌱'.repeat(30), 'Sumi'))).toHaveLength(24);
    expect(residentName('🌱'.repeat(30), 'Sumi').endsWith('🌱')).toBe(true);
    values.set(RESIDENT_STORAGE_KEY, '{malformed');
    expect(loadResidents(storage)[0].name).toBe('Sumi');
  });

  it.each([40, 128, 400].flatMap(radius => [0, 5, 412, 890, 9999].map(seed => ({ radius, seed }))))('keeps seeded routes on safe patches at R=$radius, seed=$seed', ({ radius, seed }) => {
    const ground = createGroundSample();
    const terrain = terrainAt(radius, seed);
    const camera = terrain.layout.cottage.clone().multiplyScalar(radius + 15);
    const lives = [0, 1].map(index => new ResidentLife(index));
    for (let time = 0; time < 180; time += 3) {
      const positions = lives.map(life => {
        const out = life.at(time, terrain, camera);
        const local = terrain.cottageLocal(out.dir, { x: 0, z: 0 });
        expect(local.z).toBeGreaterThan(6.5);
        expect(Math.abs(local.x)).toBeLessThan(8.3);
        expect(terrain.sample(out.dir, ground).water).toBeGreaterThan(1);
        expect(out.height).toBeCloseTo(ground.height, 8);
        expect(out.heading.length()).toBeCloseTo(1, 8);
        return out.dir.clone().multiplyScalar(radius + out.height);
      });
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) expect(positions[i].distanceTo(positions[j])).toBeGreaterThan(2);
    }
  });

  it('shares exact step and bridge contact heights with the host route', () => {
    const terrain = terrainAt();
    const roam = new MuseRoam(terrain, 1.65);
    for (const [x, z] of [[0, 3.5], [0, 4.3], [0, 4.7], [0, 5.1], [8, 10], [10, 10], [12, 10], [14, 10], [16, 10]]) {
      const support = walkableHeightAt(x, z);
      expect(support).not.toBeNull();
      expect(roam.groundAt(residentDirection(terrain, x, z))).toBeCloseTo(terrain.cottageGround + support!, 7);
    }
  });

  it.each([40, 128, 400].flatMap(radius => [412, 890].map(seed => ({ radius, seed }))))('keeps Muse clear of both neighbour routes at R=$radius, seed=$seed', ({ radius, seed }) => {
    const terrain = terrainAt(radius, seed);
    const roam = new MuseRoam(terrain, 1.65);
    const lives = [new ResidentLife(0), new ResidentLife(1)];
    const camera = terrain.layout.cottage.clone().multiplyScalar(radius + 20);
    let closest = Infinity;
    for (let time = 0; time < 1200; time += 0.5) {
      const host = roam.at(time, camera);
      const hostPoint = host.dir.clone().multiplyScalar(radius + host.height);
      for (const life of lives) {
        const neighbour = life.at(time, terrain, camera);
        closest = Math.min(closest, hostPoint.distanceTo(neighbour.dir.clone().multiplyScalar(radius + neighbour.height)));
      }
    }
    // Each body is about 0.9 m across; reserve real body space, not just anchors.
    expect(closest).toBeGreaterThan(1);
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
      if (out.cues.cook) {
        const local = terrain.cottageLocal(out.dir, { x: 0, z: 0 });
        expect(local.z - 0.45).toBeGreaterThan(FACE);
        expect(local.z + 0.45).toBeLessThan(TERRACE.z1);
        expect(local.x - 0.45).toBeGreaterThan(TERRACE.x0);
        expect(local.x + 0.45).toBeLessThan(TERRACE.x1);
      }
      out.action.moves.forEach((move) => seen.add(move.kind));
    }
    expect(seen.has('perch')).toBe(true);
    expect(seen.has('stir')).toBe(true);
  });
});
