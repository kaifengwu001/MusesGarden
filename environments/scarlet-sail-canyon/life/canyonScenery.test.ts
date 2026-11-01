import { InstancedBufferGeometry, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FieldParams } from '../planet/fields';
import { generateLayout, Terrain } from '../planet/terrain';
import { chalkGeometry, chalkShelfGeometry, fanTreeGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';
import { CanyonScenery } from './canyonScenery';

const fields: FieldParams = { roll: 3.6, hummocks: 0.16, wetlands: 0, waterLevel: 0, grain: 0.45, density: 0.7, patchiness: 0.95, patchSize: 13, weights: [0.15, 0.8, 0.05, 0] };
const terrainAt = (radius: number, seed = 412): Terrain => {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, fields, radius / 256);
  return terrain;
};

function meshes(scenery: CanyonScenery): Mesh<InstancedBufferGeometry>[] {
  return scenery.group.children.filter((object): object is Mesh<InstancedBufferGeometry> => object instanceof Mesh && object.geometry instanceof InstancedBufferGeometry);
}

function anchors(scenery: CanyonScenery): number[][] {
  return meshes(scenery).map(mesh => Array.from(mesh.geometry.getAttribute('aAnchor').array).slice(0, mesh.geometry.instanceCount * 4));
}

describe('canyon scenery', () => {
  it('uses finite, non-degenerate triangles for leaves, fractured chalk and comb-ferns', () => {
    for (const make of [fanTreeGeometry, chalkGeometry, fernGeometry, chalkShelfGeometry, lichenGeometry]) {
      const geometry = make();
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      expect(position.count).toBeGreaterThan(0);
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i);
        b.fromBufferAttribute(position, i + 1);
        c.fromBufferAttribute(position, i + 2);
        expect(a.toArray().every(Number.isFinite)).toBe(true);
        expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-14);
        expect(new Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
      }
      geometry.dispose();
    }
  });

  it('keeps the resident foreground clear and all anchors attached through growth', () => {
    const terrain = terrainAt(128);
    const scenery = new CanyonScenery({}, terrain);
    for (const radius of [40, 128, 400]) {
      terrain.update(radius, fields, radius / 256);
      scenery.update(12, terrain);
      expect(meshes(scenery)).toHaveLength(5);
      for (const mesh of meshes(scenery)) {
        const anchor = mesh.geometry.getAttribute('aAnchor');
        const scale = mesh.geometry.getAttribute('aPlacement');
        expect(mesh.geometry.instanceCount).toBeGreaterThan(0);
        for (let i = 0; i < mesh.geometry.instanceCount; i++) {
          const dir = new Vector3(anchor.getX(i), anchor.getY(i), anchor.getZ(i));
          const local = terrain.cottageLocal(dir, { x: 0, z: 0 });
          expect(dir.dot(terrain.layout.cottage) > 0 && Math.abs(local.x) < 12 && local.z > 8 && local.z < 20).toBe(false);
          expect(dir.length()).toBeCloseTo(1, 6);
          expect(anchor.getW(i)).toBeGreaterThanOrEqual(terrain.height(dir) - 0.08 * scale.getX(i) - 0.001);
          expect(anchor.getW(i)).toBeLessThan(terrain.height(dir) + 6);
        }
      }
    }
    scenery.dispose();
  });

  it('reuses batches between frames, is deterministic, and resamples terrain changes', () => {
    const terrain = terrainAt(128);
    const first = new CanyonScenery({}, terrain);
    const second = new CanyonScenery({}, terrainAt(128));
    expect(anchors(first)).toEqual(anchors(second));
    const geometry = meshes(first).map(mesh => mesh.geometry);
    first.update(80, terrain);
    expect(meshes(first).map(mesh => mesh.geometry)).toEqual(geometry);
    const before = anchors(first);
    terrain.update(128, { ...fields, roll: 0.5 }, 0.5);
    first.invalidate();
    first.update(80, terrain);
    expect(anchors(first)).not.toEqual(before);
    first.dispose(); second.dispose();
    expect(first.group.children).toHaveLength(0);
  });
});
