import { describe, expect, it } from 'vitest';
import { Ray, Vector3, type BufferGeometry, type Mesh, type InstancedBufferAttribute, type InstancedBufferGeometry } from 'three';
import { fanTreeGeometry, chalkGeometry, fernGeometry, chalkShelfGeometry, lichenGeometry } from '../life/canyonGeometry';
import { CanyonScenery } from '../life/canyonScenery';
import { Homestead } from '../life/props';
import { Terrain, generateLayout, createGroundSample } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const PARAMS: FieldParams = { roll: 3.6, hummocks: 0.16, wetlands: 0, waterLevel: 0, grain: 0.45, density: 0.7, patchiness: 0.95, patchSize: 13, weights: [0.15, 0.8, 0.05, 0] };
function terrainAt(radius: number, seed = 412): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, 0.5);
  return terrain;
}
function geometryIsSound(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute('position');
  expect(positions.count).toBeGreaterThan(20);
  for (const name of ['position', 'normal', 'uv', 'aKind']) {
    const attribute = geometry.getAttribute(name);
    expect(attribute.count).toBe(positions.count);
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  }
  const normals = geometry.getAttribute('normal');
  let nonUnitNormals = 0;
  for (let i = 0; i < normals.count; i++) {
    if (Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) > 0.000005) nonUnitNormals++;
  }
  expect(nonUnitNormals).toBe(0);
  expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
}
function batches(scenery: CanyonScenery): InstancedBufferGeometry[] {
  return scenery.group.children.map((child) => (child as Mesh<InstancedBufferGeometry>).geometry);
}
/** Intersect the built mesh, independently of its exported placement constants. */
function surfaceAtCentre(geometry: BufferGeometry): number {
  const ray = new Ray(new Vector3(0, 100, 0), new Vector3(0, -1, 0));
  const positions = geometry.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  let height = -Infinity;
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    if (ray.intersectTriangle(a, b, c, false, hit)) height = Math.max(height, hit.y);
  }
  expect(Number.isFinite(height)).toBe(true);
  return height;
}
function snapshot(scenery: CanyonScenery): unknown {
  return batches(scenery).map((geometry) => ({
    count: geometry.instanceCount,
    anchor: Array.from(geometry.getAttribute('aAnchor').array).slice(0, geometry.instanceCount * 4),
    placement: Array.from(geometry.getAttribute('aPlacement').array).slice(0, geometry.instanceCount * 4),
    heightScale: Array.from(geometry.getAttribute('aHeightScale').array).slice(0, geometry.instanceCount),
  }));
}

describe('Scarlet canyon geometry', () => {
  it('builds nonempty finite thin foliage and hard chalk without degenerate normals', () => {
    for (const geometry of [fanTreeGeometry(), chalkGeometry(), fernGeometry(), chalkShelfGeometry(), lichenGeometry()]) {
      geometryIsSound(geometry);
      geometry.dispose();
    }
  });

  it('builds an open inhabited shelter and disposes its mesh resources', () => {
    const home = new Homestead({}, 412);
    const mesh = home.group.children[0] as Mesh;
    geometryIsSound(mesh.geometry);
    const kinds = new Set(Array.from(mesh.geometry.getAttribute('aKind').array));
    expect(kinds).toEqual(new Set([0, 2, 4, 5, 7]));
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => { disposed = true; });
    home.dispose();
    expect(disposed).toBe(true);
  });

  for (const radius of [40, 128, 400]) {
    it(`keeps persistent scenery grounded and the resident corridor clear at R=${radius}`, () => {
      const terrain = terrainAt(radius);
      const scenery = new CanyonScenery({}, terrain);
      const ground = createGroundSample();
      const shelf = scenery.group.getObjectByName('Connected chalk escarpments') as Mesh<InstancedBufferGeometry>;
      const shelfAnchors = shelf.geometry.getAttribute('aAnchor');
      const shelfPlacement = shelf.geometry.getAttribute('aPlacement');
      const shelfSurface = surfaceAtCentre(shelf.geometry);
      let elevatedPlants = 0;
      let instances = 0;
      let triangles = 0;
      for (const geometry of batches(scenery)) {
        const anchors = geometry.getAttribute('aAnchor') as InstancedBufferAttribute;
        const placement = geometry.getAttribute('aPlacement') as InstancedBufferAttribute;
        const direction = terrain.layout.cottage.clone();
        const kinds = new Set(Array.from(geometry.getAttribute('aKind').array));
        instances += geometry.instanceCount;
        triangles += geometry.getAttribute('position').count / 3 * geometry.instanceCount;
        for (let i = 0; i < geometry.instanceCount; i++) {
          direction.set(anchors.getX(i), anchors.getY(i), anchors.getZ(i));
          expect(direction.length()).toBeCloseTo(1, 6);
          const sample = terrain.sample(direction, ground);
          const scale = placement.getX(i);
          const soilHeight = sample.height - 0.08 * scale;
          if (anchors.getW(i) > soilHeight + 0.001) {
            // Elevated plants must be supported by a real shelf at the same
            // sphere anchor, never by an arbitrary allowance in this assertion.
            let support = -1;
            for (let j = 0; j < shelf.geometry.instanceCount; j++) {
              if (Math.hypot(direction.x - shelfAnchors.getX(j), direction.y - shelfAnchors.getY(j), direction.z - shelfAnchors.getZ(j)) < 1e-6) { support = j; break; }
            }
            expect(support).toBeGreaterThanOrEqual(0);
            expect(kinds.has(1) || kinds.has(8)).toBe(true);
            const actualSurface = shelfAnchors.getW(support) + shelfSurface * shelfPlacement.getX(support);
            expect(anchors.getW(i)).toBeCloseTo(actualSurface - 0.08 * scale, 4);
            if (kinds.has(1)) elevatedPlants++;
          } else {
            expect(anchors.getW(i)).toBeCloseTo(soilHeight, 4);
          }
          const heightScale = geometry.getAttribute('aHeightScale').getX(i);
          expect(Number.isFinite(heightScale)).toBe(true);
          expect(heightScale).toBeGreaterThan(0);
          expect(placement.getW(i)).toBeGreaterThan(0);
          expect(placement.getW(i)).toBeLessThanOrEqual(1);
          const home = terrain.cottageLocal(direction, { x: 0, z: 0 });
          const nearHome = direction.dot(terrain.layout.cottage) > 0;
          expect(nearHome && Math.abs(home.x) < 12 && home.z > 8 && home.z < 20).toBe(false);
        }
      }
      expect(instances).toBeGreaterThan(100);
      expect(elevatedPlants).toBeGreaterThan(0);
      expect(triangles).toBeLessThan(280_000);
      expect(scenery.group.children.length).toBeLessThanOrEqual(5);
      scenery.dispose();
      expect(scenery.group.children).toHaveLength(0);
    });
  }

  it('regenerates deterministically after growth, seed changes, and relief edits', () => {
    const terrain = terrainAt(128);
    const scenery = new CanyonScenery({}, terrain);
    const initial = snapshot(scenery);
    terrain.update(400, PARAMS, 0.5);
    scenery.update(30, terrain);
    terrain.update(128, PARAMS, 0.5);
    scenery.update(10, terrain);
    expect(snapshot(scenery)).toEqual(initial);
    terrain.setLayout(generateLayout(84));
    terrain.update(128, PARAMS, 0.5);
    scenery.update(10, terrain);
    expect(snapshot(scenery)).not.toEqual(initial);
    terrain.setLayout(generateLayout(412));
    terrain.update(128, PARAMS, 0.5);
    scenery.update(10, terrain);
    expect(snapshot(scenery)).toEqual(initial);
    terrain.update(128, { ...PARAMS, roll: 0.1 }, 0.5);
    scenery.invalidate();
    scenery.update(10, terrain);
    expect(snapshot(scenery)).not.toEqual(initial);
    scenery.dispose();
  });
});
