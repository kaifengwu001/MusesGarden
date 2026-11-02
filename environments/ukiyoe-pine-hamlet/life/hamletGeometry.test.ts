import { InstancedBufferGeometry, Mesh, Ray, Vector3, type LineSegments } from 'three';
import { describe, expect, it } from 'vitest';
import type { FieldParams } from '../planet/fields';
import { generateLayout, Terrain } from '../planet/terrain';
import { barleyGeometry, cedarGeometry, createHamletAssets, grassGeometry, HAMLET_KIND, pineGeometry, plumGeometry } from './hamletGeometry';
import { HamletScenery } from './hamletScenery';

const fields: FieldParams = { roll: 1.8, hummocks: 0.12, wetlands: 0.25, waterLevel: 0, grain: 0.4, density: 0.6, patchiness: 0.8, patchSize: 13, weights: [0, 0, 0, 0] };
const terrainAt = (radius = 128, seed = 412): Terrain => {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, fields, radius / 256);
  return terrain;
};
const meshes = (scenery: HamletScenery): Mesh<InstancedBufferGeometry>[] => scenery.group.children.filter((o): o is Mesh<InstancedBufferGeometry> => o instanceof Mesh && o.geometry instanceof InstancedBufferGeometry);
const anchorSnapshot = (scenery: HamletScenery): number[][] => meshes(scenery).map(m => Array.from(m.geometry.getAttribute('aAnchor').array).slice(0, m.geometry.instanceCount * 4));

describe('ukiyoe natural scenery', () => {
  it('builds five distinct solid silhouettes with finite triangles, grounded roots and independent snow', () => {
    const assets = createHamletAssets();
    for (const asset of Object.values(assets)) {
      const geometry = asset.geometry;
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      expect(position.count).toBeGreaterThan(100);
      for (let i = 0; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
        expect([...a.toArray(), ...b.toArray(), ...c.toArray()].every(Number.isFinite)).toBe(true);
        expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-14);
        expect(new Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
      }
      const kinds = Array.from(geometry.getAttribute('aKind').array);
      expect(kinds).toContain(HAMLET_KIND.snow);
      expect(Array.from(geometry.getAttribute('aGround').array)).toContain(1);
      expect(asset.ink.getAttribute('position').count).toBeLessThan(position.count / 2);
    }
    const pine = assets.pine.geometry.boundingBox!, cedar = assets.cedar.geometry.boundingBox!;
    const pineSize = pine.getSize(new Vector3()), cedarSize = cedar.getSize(new Vector3());
    expect(pineSize.x / pineSize.y).toBeGreaterThan(0.85);
    expect(cedarSize.x / cedarSize.y).toBeLessThan(0.52);
    expect(cedarSize.y).toBeGreaterThan(pineSize.y);
    const plumKinds = Array.from(assets.plum.geometry.getAttribute('aKind').array);
    expect(plumKinds).toContain(HAMLET_KIND.bud);
    expect(plumKinds).not.toContain(HAMLET_KIND.needle);
    for (const asset of Object.values(assets)) { asset.geometry.dispose(); asset.ink.dispose(); }
  });

  it('keeps home/bridge routes open and remains below the complete instantiated triangle budget', () => {
    const terrain = terrainAt(), scenery = new HamletScenery({}, terrain);
    for (const radius of [40, 128, 400]) {
      terrain.update(radius, fields, radius / 256); scenery.update(12, terrain);
      expect(meshes(scenery)).toHaveLength(9);
      expect(scenery.triangleCount).toBeLessThan(1_500_000);
      expect(scenery.triangleCount).toBeGreaterThan(20_000);
      for (const mesh of meshes(scenery)) {
        const anchors = mesh.geometry.getAttribute('aAnchor');
        for (let i = 0; i < mesh.geometry.instanceCount; i++) {
          const direction = new Vector3(anchors.getX(i), anchors.getY(i), anchors.getZ(i));
          const local = terrain.cottageLocal(direction, { x: 0, z: 0 });
          expect(direction.length()).toBeCloseTo(1, 6);
          if (direction.dot(terrain.layout.cottage) > 0 && Math.acos(direction.dot(terrain.layout.cottage)) * radius < 36) {
            expect(local.x > -1 && local.x < 6 && local.z > 3 && local.z < 31).toBe(false);
            expect(local.x > 6 && local.x < 18 && local.z > 8 && local.z < 12).toBe(false);
          }
        }
      }
    }
    scenery.dispose();
  });

  it('draws botanical marks on one surface with continuous material charts and no duplicate faces', () => {
    for (const coarse of [false, true]) {
      const assets = createHamletAssets(coarse);
      for (const [name, asset] of Object.entries(assets)) {
        const geometry = asset.geometry, position = geometry.getAttribute('position');
        const chart = geometry.getAttribute('uv'), style = geometry.getAttribute('aPrintStyle'), kind = geometry.getAttribute('aKind'), lobe = geometry.getAttribute('aLobe');
        expect(lobe.count).toBe(position.count);
        expect(Array.from(lobe.array).every(Number.isFinite)).toBe(true);
        const lobeTurn = geometry.getAttribute('aLobeTurn');
        expect(lobeTurn.count).toBe(position.count);
        expect(Array.from(lobeTurn.array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < style.count; i++) if (style.getX(i) < 20) expect(lobeTurn.getX(i)).toBe(0);
        expect(chart.count).toBe(position.count);
        expect(style.count).toBe(position.count);
        expect(Array.from(chart.array).every(Number.isFinite)).toBe(true);
        const faces = new Set<string>();
        for (let i = 0; i < position.count; i += 3) {
          const face = [i, i + 1, i + 2].map(j => [position.getX(j), position.getY(j), position.getZ(j)].map(n => n.toFixed(7)).join(',')).sort().join(';');
          expect(faces.has(face), `${name}: duplicate surface at vertex ${i}`).toBe(false);
          faces.add(face);
        }
        // A repeated (0,0)-(1,0)-(0,1) chart would put print seams along every
        // triangle. Tube arc lengths and crown charts must carry real extent.
        if (name === 'pine' || name === 'cedar') {
          const needleStyles = new Set(Array.from({ length: kind.count }, (_, i) => kind.getX(i) === HAMLET_KIND.needle ? style.getX(i) : -1));
          if (name === 'pine') {
            // Each pine lobe has its own normalised 3D fan coordinates; there
            // are no detached needle blades or tiled motifs on a canopy pad.
            expect([...needleStyles].filter(s => s >= 0).every(s => s >= 20 && s < 21)).toBe(true);
            expect(Array.from(lobe.array).reduce((a, b) => Math.max(a, b), -Infinity)).toBeCloseTo(1, 5);
            expect(Array.from(lobe.array).reduce((a, b) => Math.min(a, b), Infinity)).toBeCloseTo(-1, 5);
          } else {
            // Cedars now share rounded, locally mapped clouds rather than
            // retaining the old angular pads and projecting needle cards.
            expect([...needleStyles].filter(s => s >= 0).every(s => s >= 21 && s < 22)).toBe(true);
          }
          expect(Array.from(chart.array).reduce((a, b) => Math.max(a, b), -Infinity)).toBeGreaterThan(5);
        }
        // Printed bark and snow lips have no coincident LineSegments pass.
        expect(Array.from(asset.ink.getAttribute('aKind').array).every(k => k === HAMLET_KIND.slate)).toBe(true);
        asset.geometry.dispose(); asset.ink.dispose();
      }
    }
  });

  it.each([['plum', plumGeometry, 28], ['cedar', cedarGeometry, 40]] as const)('embeds every %s branch and twig base inside its actual emitted parent', (_, create, junctionCount) => {
    const asset = create(), geometry = asset.geometry;
    const position = geometry.getAttribute('position');
    const trunkRange = geometry.userData.branchTrunkRange as [number, number];
    const junctions = geometry.userData.branchJunctions as { center: number[]; ring: number[][]; parentRange?: [number, number] }[];
    expect(junctions).toHaveLength(junctionCount);
    const ray = new Ray(), a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
    for (const junction of junctions) for (const point of [junction.center, ...junction.ring]) {
      const [start, count] = junction.parentRange ?? trunkRange;
      ray.origin.fromArray(point);
      for (const direction of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
        ray.direction.copy(direction);
        let distance = Infinity;
        for (let i = start; i < start + count; i += 3) {
          a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
          if (ray.intersectTriangle(a, b, c, false, hit)) distance = Math.min(distance, hit.distanceTo(ray.origin));
        }
        expect(distance, `Detached branch junction at ${point.join(',')}`).toBeGreaterThan(0.001);
        expect(distance).toBeLessThan(0.50);
      }
    }
    geometry.dispose(); asset.ink.dispose();
  });

  it('provides a low-cost rooted living grass asset distinct from dry reeds', () => {
    const grass = grassGeometry(), geometry = grass.geometry;
    expect(geometry.getAttribute('position').count / 3).toBeLessThan(250);
    expect(Array.from(geometry.getAttribute('aPrintStyle').array).every(s => s === 15)).toBe(true);
    expect(Array.from(geometry.getAttribute('aGround').array)).toContain(1);
    expect(Array.from(geometry.getAttribute('aKind').array).every(k => k === HAMLET_KIND.reed)).toBe(true);
    geometry.dispose(); grass.ink.dispose();
  });

  it('rounds exposed snow over its support instead of ending in a vertical plate', () => {
    const assets = createHamletAssets();
    for (const name of ['plum', 'reeds', 'rock'] as const) {
      const geometry = assets[name].geometry;
      const kind = geometry.getAttribute('aKind'), normal = geometry.getAttribute('normal');
      const snowUp = Array.from({ length: kind.count }, (_, i) => kind.getX(i) === HAMLET_KIND.snow ? normal.getY(i) : NaN).filter(Number.isFinite);
      expect(Math.min(...snowUp), `${name}: no snow drape below the outer rim`).toBeLessThan(-0.1);
      expect(Math.max(...snowUp), `${name}: no rounded upper snow surface`).toBeGreaterThan(0.7);
      expect(new Set(snowUp.map(n => n.toFixed(2))).size).toBeGreaterThan(10);
    }
    for (const asset of Object.values(assets)) { asset.geometry.dispose(); asset.ink.dispose(); }
  });

  it('gives the cultivated barley compact solid heads within the clump budget', () => {
    const asset = barleyGeometry(), geometry = asset.geometry;
    const position = geometry.getAttribute('position'), kind = geometry.getAttribute('aKind'), normal = geometry.getAttribute('normal');
    expect(position.count / 3).toBeLessThanOrEqual(450);
    expect(position.count / 3).toBeGreaterThan(300);
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(0.9);
    expect(geometry.boundingBox!.max.y).toBeLessThan(1.12);
    expect(Array.from(kind.array).every(k => k === HAMLET_KIND.reed)).toBe(true);
    expect(Array.from(geometry.getAttribute('aGround').array).filter(g => g === 1).length).toBeGreaterThan(6);
    for (let i = 0; i < position.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(position, i), b = new Vector3().fromBufferAttribute(position, i + 1), c = new Vector3().fromBufferAttribute(position, i + 2);
      expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-14);
      expect(new Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
    }
    geometry.dispose(); asset.ink.dispose();
  });

  it('uses downward normals on evergreen snow undersides rather than dome normals', () => {
    for (const create of [pineGeometry, cedarGeometry]) {
      const asset = create(), geometry = asset.geometry;
      const kind = geometry.getAttribute('aKind'), normal = geometry.getAttribute('normal');
      let downward = 0;
      for (let i = 0; i < kind.count; i++) if (kind.getX(i) === HAMLET_KIND.snow && normal.getY(i) < -0.5) downward++;
      expect(downward).toBeGreaterThan(30);
      geometry.dispose(); asset.ink.dispose();
    }
  });

  it('shares placement and season between colour and selected ink, including static rock snow', () => {
    const snow = { value: 1 }, terrain = terrainAt();
    const scenery = new HamletScenery({ uSnowAmount: snow }, terrain);
    for (let i = 0; i < scenery.group.children.length; i += 2) {
      const mesh = scenery.group.children[i] as Mesh<InstancedBufferGeometry>;
      const ink = scenery.group.children[i + 1] as LineSegments<InstancedBufferGeometry>;
      expect(ink.geometry.getAttribute('aAnchor')).toBe(mesh.geometry.getAttribute('aAnchor'));
      expect(ink.geometry.getAttribute('aAcross')).toBe(mesh.geometry.getAttribute('aAcross'));
      expect(ink.geometry.getAttribute('aPlacement')).toBe(mesh.geometry.getAttribute('aPlacement'));
      expect(ink.geometry.instanceCount).toBe(mesh.geometry.instanceCount);
      if (mesh.name === 'Hamlet rock') expect(mesh.geometry.getAttribute('aPlacement').getW(0)).toBe(0);
    }
    scenery.dispose();
  });

  it('is deterministic, refreshes unchanged-radius ground and honours extra inhabited clearings', () => {
    const terrain = terrainAt(), first = new HamletScenery({}, terrain), second = new HamletScenery({}, terrainAt());
    expect(anchorSnapshot(first)).toEqual(anchorSnapshot(second));
    const geometry = meshes(first).map(m => m.geometry);
    first.update(95, terrain);
    expect(meshes(first).map(m => m.geometry)).toEqual(geometry);
    const before = anchorSnapshot(first);
    terrain.update(128, { ...fields, roll: 0.2 }, 0.5); first.invalidate(); first.update(95, terrain);
    expect(anchorSnapshot(first)).not.toEqual(before);
    first.setClearings([{ direction: terrain.layout.cottage, radius: 400 }]); first.update(95, terrain);
    expect(sceneryInstances(first)).toBe(0);
    first.dispose(); second.dispose();
    expect(first.group.children).toHaveLength(0);
  });
});

function sceneryInstances(scenery: HamletScenery): number {
  return meshes(scenery).reduce((count, mesh) => count + mesh.geometry.instanceCount, 0);
}
