import { describe, expect, it } from 'vitest';
import type { Mesh, InstancedBufferGeometry, ShaderMaterial } from 'three';
import { CanyonScenery } from '../life/canyonScenery';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const params: FieldParams = { roll: 1.5, hummocks: 0.25, wetlands: 0.58, waterLevel: 0, grain: 0.5, density: 0.5, patchiness: 0.9, patchSize: 13, weights: [0.1, 0.7, 0.1, 0.1] };
function at(radius: number): Terrain {
  const terrain = new Terrain(generateLayout(412));
  terrain.update(radius, params, 0.5);
  return terrain;
}
function placements(scenery: CanyonScenery): number[][] {
  return scenery.group.children.map(child => {
    const g = (child as Mesh<InstancedBufferGeometry, ShaderMaterial>).geometry;
    return ['aAnchor', 'aAcross', 'aPlacement'].flatMap(name => {
      const a = g.getAttribute(name);
      return Array.from(a.array.slice(0, g.instanceCount * a.itemSize));
    });
  });
}

describe('Lantern scenery growth cache', () => {
  it('refreshes exact placements on the first still frame, and survives a radius round trip', () => {
    const terrain = at(128), scenery = new CanyonScenery({}, terrain);
    const original = placements(scenery);
    const geometry = scenery.group.children.map(child => (child as Mesh).geometry);
    terrain.update(230, params, 0.5);
    scenery.update(3, terrain);
    scenery.update(3, terrain);
    const direct = new CanyonScenery({}, at(230));
    direct.update(3, at(230));
    expect(placements(scenery)).toEqual(placements(direct));
    expect(scenery.group.children.map(child => (child as Mesh).geometry)).toEqual(geometry);
    terrain.update(128, params, 0.5);
    scenery.update(0, terrain);
    scenery.update(0, terrain);
    expect(placements(scenery)).toEqual(original);
    scenery.dispose(); direct.dispose();
  }, 15_000);

  it('recomputes cached colonies when terrain parameters change at the same radius', () => {
    const terrain = at(128), scenery = new CanyonScenery({}, terrain);
    terrain.update(128, { ...params, waterLevel: 1 }, 0.5);
    scenery.invalidate();
    scenery.update(0, terrain);
    const direct = new CanyonScenery({}, terrain);
    expect(placements(scenery)).toEqual(placements(direct));
    scenery.dispose(); direct.dispose();
  });
});
