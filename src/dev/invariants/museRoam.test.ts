import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FieldParams } from '../../planet/fields';
import { createGroundSample, generateLayout, HOUSE_FOOTPRINT, Terrain } from '../../planet/terrain';
import { MuseRoam } from '../../life/museRoam';

// Muse roaming the planet (museRoam.ts): it never stands in water or in the
// house, it moves on smoothly, it does all its things now and then, and the
// same planet and time always find it in the same place.

const PARAMS: FieldParams = { roll: 1.25, hummocks: 0.35, wetlands: 0.42, waterLevel: 0, grain: 0.6, density: 10, patchiness: 0.78, patchSize: 13, weights: [0.4, 0.24, 0.22, 0.14] };
const H = 1.65;

function terrainAt(radius: number, seed = 412): Terrain {
  const t = new Terrain(generateLayout(seed));
  t.update(radius, PARAMS, (2 * radius) / 512);
  return t;
}

describe('Muse roaming the planet', () => {
  for (const radius of [40, 128, 400]) {
    it(`keeps out of the water and the house, moves on smoothly and does all its things (R ${radius})`, () => {
      const terrain = terrainAt(radius);
      const roam = new MuseRoam(terrain, H);
      const camera = new Vector3(0, 0, 0).copy(terrain.layout.cottage).multiplyScalar(radius + 30);
      const ground = createGroundSample();
      const local = { x: 0, z: 0 };
      const seen = new Set<string>();
      let prev: Vector3 | null = null;
      let worstStep = 0;
      for (let t = 0; t < 3600; t += 0.05) {
        const m = roam.at(t, camera);
        for (const move of m.action.moves) seen.add(move.kind);
        const p = m.dir.clone().multiplyScalar(radius + m.height);
        if (prev) worstStep = Math.max(worstStep, p.distanceTo(prev));
        prev = p;
        terrain.cottageLocal(m.dir, local);
        const inHouse = Math.abs(local.x) < HOUSE_FOOTPRINT.halfX - 0.1 && Math.abs(local.z) < HOUSE_FOOTPRINT.halfZ - 0.1;
        expect(inHouse, `in the house at ${t.toFixed(2)} s`).toBe(false);
        // (on the deck or its edge it may stand over the water; on the meadow never)
        const onDeck = m.height > terrain.cottageGround + 0.3;
        if (!onDeck) expect(terrain.sample(m.dir, ground).water, `in the water at ${t.toFixed(2)} s`).toBeGreaterThan(0);
      }
      // a waddle, a hop (the quickest, up onto the bench): no jumps from one place to another
      expect(worstStep).toBeLessThan(0.2);
      for (const kind of ['perch', 'stir', 'fish', 'water', 'sleep']) expect(seen.has(kind), kind).toBe(true);
    });
  }

  it('turns smoothly: no jump in its heading from one frame to the next, along its paths, at their ends, in its turns', () => {
    const terrain = terrainAt(128);
    const roam = new MuseRoam(terrain, H);
    const camera = terrain.layout.cottage.clone().multiplyScalar(160);
    let prev: Vector3 | null = null;
    let worst = 0;
    let when = 0;
    for (let t = 0; t < 1200; t += 1 / 60) {
      const heading = roam.at(t, camera).heading.clone();
      if (prev) {
        const a = Math.acos(Math.max(-1, Math.min(1, heading.dot(prev))));
        if (a > worst) {
          worst = a;
          when = t;
        }
      }
      prev = heading;
    }
    // (a half turn on the spot comes round at most about 4 rad a second: under 0.07 rad a frame)
    expect(worst, `at ${when.toFixed(2)} s`).toBeLessThan(0.08);
  });

  it('is the same Muse for the same planet and time', () => {
    const terrain = terrainAt(128);
    const a = new MuseRoam(terrain, H);
    const b = new MuseRoam(terrain, H);
    const camera = terrain.layout.cottage.clone().multiplyScalar(160);
    b.at(900, camera);
    for (const t of [12, 345.6, 1200]) {
      const x = a.at(t, camera);
      const pa = x.dir.clone();
      const ha = x.heading.clone();
      const y = b.at(t, camera);
      expect(y.dir.distanceTo(pa)).toBeLessThan(1e-9);
      expect(y.heading.distanceTo(ha)).toBeLessThan(1e-9);
    }
  });
});
