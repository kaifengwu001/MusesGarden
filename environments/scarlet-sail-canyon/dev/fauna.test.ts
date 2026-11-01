import { ShaderMaterial, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { chalkstepRig, dewwingRig, sifterRig } from '../life/canyonFaunaGeometry';
import { FAUNA_ANCHORS, FaunaMotion } from '../life/canyonFaunaMotion';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const PARAMS: FieldParams = { roll: 1.25, hummocks: 0.35, wetlands: 0, waterLevel: 0, grain: 0.6, density: 10, patchiness: 0.78, patchSize: 13, weights: [0.4, 0.24, 0.22, 0.14] };
function world(radius = 128, seed = 166): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, (2 * radius) / 512);
  return terrain;
}

describe('Native Scarlet Canyon creatures', () => {
  it('has three readable species with the exact designed feet, plate, wing and eye counts', () => {
    const material = new ShaderMaterial();
    const chalkstep = chalkstepRig(material), sifter = sifterRig(material), dewwing = dewwingRig(material);
    expect(chalkstep.anatomy).toEqual({ feet: 2, wings: 0, plates: 0, eyes: 2 });
    expect(chalkstep.feet).toHaveLength(2);
    expect(sifter.anatomy).toEqual({ feet: 6, wings: 0, plates: 3, eyes: 2 });
    expect(sifter.feet).toHaveLength(6);
    expect(dewwing.anatomy).toEqual({ feet: 6, wings: 2, plates: 0, eyes: 2 });
    expect(dewwing.wings).toHaveLength(2);
    let vertices = 0;
    for (const animal of [chalkstep, sifter, dewwing]) for (const mesh of animal.meshes) {
      const g = mesh.geometry;
      const p = g.getAttribute('position');
      expect(g.getAttribute('aColour').count).toBe(p.count);
      expect(g.getAttribute('aKind').count).toBe(p.count);
      expect(g.boundingSphere?.radius).toBeGreaterThan(0);
      expect(p.array.every(Number.isFinite)).toBe(true);
      vertices += p.count;
      g.dispose();
    }
    // Body/plate details remain a small explicit mesh budget, no texture atlases
    // or fur-shell copies on the eleven native animals.
    expect(vertices).toBeLessThan(100_000);
    material.dispose();
  });

  for (const radius of [40, 128, 400]) it(`keeps ground animals grounded and clear of the house at R=${radius}`, () => {
    const terrain = world(radius);
    const animals = FAUNA_ANCHORS.filter(({ kind }) => kind !== 'dewwing').map((anchor, index) => new FaunaMotion(anchor, index));
    const prior: Array<Vector3 | undefined> = [];
    let worst = 0;
    for (let time = 0; time < 90; time += 0.2) animals.forEach((motion, i) => {
      const p = motion.at(time, terrain);
      const local = terrain.cottageLocal(p.dir, { x: 0, z: 0 });
      expect(local.z > 6 || Math.abs(local.x) > 9).toBe(true);
      expect(p.height).toBeCloseTo(terrain.height(p.dir), 10);
      expect(p.dir.length()).toBeCloseTo(1, 10);
      expect(p.heading.dot(p.dir)).toBeCloseTo(0, 10);
      const position = p.dir.clone().multiplyScalar(radius + p.height);
      if (prior[i]) worst = Math.max(worst, position.distanceTo(prior[i]));
      prior[i] = position;
    });
    expect(worst).toBeLessThan(0.14);
  });

  it('folds its two wings at the exact nectar-stem landing point, then takes off', () => {
    const terrain = world();
    const anchor = FAUNA_ANCHORS.find(({ id }) => id === 'dewwing-1')!;
    const motion = new FaunaMotion(anchor, 6);
    let landed = false, flying = false;
    for (let time = 0; time < 50; time += 0.1) {
      const pose = motion.at(time, terrain);
      if (pose.perched > 0.999) {
        expect(pose.dir.distanceTo(motion.perchDirection(terrain))).toBeLessThan(1e-10);
        expect(pose.height - terrain.height(pose.dir)).toBeCloseTo(anchor.lift!, 8);
        expect(Math.abs(pose.flap)).toBeLessThan(0.002);
        landed = true;
      }
      if (Math.abs(pose.flap) > 0.7) flying = true;
    }
    expect(landed && flying).toBe(true);
  });

  it('preserves identities and deterministic poses through seed and radius updates', () => {
    const terrain = world();
    const anchor = FAUNA_ANCHORS[0];
    const a = new FaunaMotion(anchor, 0);
    a.at(800, terrain);
    for (const [radius, seed] of [[40, 166], [128, 412], [400, 911]]) {
      terrain.setLayout(generateLayout(seed));
      terrain.update(radius, PARAMS, (2 * radius) / 512);
      const b = new FaunaMotion(anchor, 0);
      expect(a.at(13, terrain).dir.distanceTo(b.at(13, terrain).dir)).toBeLessThan(1e-12);
      expect(a.anchor.id).toBe('chalkstep-1');
    }
  });
});
