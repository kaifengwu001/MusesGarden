import { describe, expect, it } from 'vitest';
import { Ray, Vector3, type BufferGeometry, type Mesh, type InstancedBufferAttribute, type InstancedBufferGeometry } from 'three';
import { CHALK_SHELF_VARIANTS, fanTreeGeometry, chalkGeometry, fernGeometry, coralGeometry, chalkShelfGeometry, lichenGeometry, mossGeometry, plantedMossGeometry } from '../life/canyonGeometry';
import { CanyonScenery } from '../life/canyonScenery';
import { generateCanyonRockSites } from '../life/canyonDistribution';
import { generateGroundcoverSites, selectMossTreeSites } from '../life/canyonGroundcover';
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
  return scenery.group.children.filter(child => (child as Mesh).isMesh).map((child) => (child as Mesh<InstancedBufferGeometry>).geometry);
}
/** Intersect the built mesh, independently of its exported placement constants. */
function surfaceAtCentre(geometry: BufferGeometry): number {
  const ray = new Ray(new Vector3(0, 100, 0), new Vector3(0, -1, 0));
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertexAt = (i: number): number => index ? index.getX(i) : i;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  let height = -Infinity;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    if (geometry.getAttribute('aKind').getX(vertexAt(i)) !== 2) continue;
    a.fromBufferAttribute(positions, vertexAt(i));
    b.fromBufferAttribute(positions, vertexAt(i + 1));
    c.fromBufferAttribute(positions, vertexAt(i + 2));
    if (ray.intersectTriangle(a, b, c, false, hit)) height = Math.max(height, hit.y);
  }
  expect(Number.isFinite(height)).toBe(true);
  return height;
}
function snapshot(scenery: CanyonScenery): unknown {
  return batches(scenery).map((geometry) => ({
    count: geometry.instanceCount,
    anchor: Array.from(geometry.getAttribute('aAnchor').array).slice(0, geometry.instanceCount * 4),
    across: Array.from(geometry.getAttribute('aAcross').array).slice(0, geometry.instanceCount * 3),
    placement: Array.from(geometry.getAttribute('aPlacement').array).slice(0, geometry.instanceCount * 4),
    heightScale: Array.from(geometry.getAttribute('aHeightScale').array).slice(0, geometry.instanceCount),
    groundSlope: Array.from(geometry.getAttribute('aGroundSlope').array).slice(0, geometry.instanceCount * 2),
  }));
}

// (building the canyon's scenery at every size takes a second or two a size, more on a busy machine)
describe('Scarlet canyon geometry', { timeout: 30_000 }, () => {
  it('builds nonempty finite thin foliage and hard chalk without degenerate normals', () => {
    for (const geometry of [fanTreeGeometry(), fanTreeGeometry(1), fanTreeGeometry(2), chalkGeometry(), fernGeometry(), coralGeometry(), chalkShelfGeometry(), lichenGeometry(), lichenGeometry(1)]) {
      geometryIsSound(geometry);
      geometry.dispose();
    }
  });

  it('indexes render batches without changing their triangles or per-corner material and support data', () => {
    const scenery = new CanyonScenery({}, terrainAt(128));
    const sources = [fanTreeGeometry(), chalkGeometry(), fernGeometry(), chalkShelfGeometry(), lichenGeometry(), coralGeometry(), fanTreeGeometry(1), fanTreeGeometry(2), lichenGeometry(1), ...Array.from({length:CHALK_SHELF_VARIANTS-1},(_,i)=>chalkShelfGeometry(i+1)), mossGeometry(1), plantedMossGeometry(0), plantedMossGeometry(1)];
    let sourceVertices = 0, renderedVertices = 0;
    batches(scenery).forEach((geometry, batch) => {
      const source = sources[batch], index = geometry.getIndex()!;
      expect(index).not.toBeNull();
      expect(index.count).toBe(source.getAttribute('position').count);
      sourceVertices += source.getAttribute('position').count;
      renderedVertices += geometry.getAttribute('position').count;
      for (const name of ['position', 'normal', 'uv', 'aKind', 'aPlantBase', 'aSupportSlope']) {
        const original = source.getAttribute(name), rendered = geometry.getAttribute(name);
        let largestDifference = 0;
        for (let i = 0; i < index.count; i++) for (let axis = 0; axis < original.itemSize; axis++) {
          largestDifference = Math.max(largestDifference, Math.abs(original.getComponent(i, axis) - rendered.getComponent(index.getX(i), axis)));
        }
        expect(largestDifference).toBeLessThan(1e-7);
      }
    });
    expect(renderedVertices).toBeLessThan(sourceVertices * 0.5);
    for (const source of sources) source.dispose();
    scenery.dispose();
  });

  it('builds an open inhabited shelter and disposes its mesh resources', () => {
    const home = new Homestead({}, 412);
    const mesh = home.group.children[0] as Mesh;
    geometryIsSound(mesh.geometry);
    const kinds = new Set(Array.from(mesh.geometry.getAttribute('aKind').array));
    expect(kinds).toEqual(new Set([0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => { disposed = true; });
    home.dispose();
    expect(disposed).toBe(true);
  });

  for (const radius of [40, 56, 90, 128, 160, 400]) {
    it(`keeps persistent scenery grounded and the resident corridor clear at R=${radius}`, () => {
      const terrain = terrainAt(radius);
      const scenery = new CanyonScenery({}, terrain);
      const ground = createGroundSample();
      const shelves = scenery.group.children.filter(child=>(child as Mesh).isMesh&&child.name.startsWith('Connected chalk escarpments')) as Mesh<InstancedBufferGeometry>[];
      const shelfSurface = surfaceAtCentre(shelves[0].geometry);
      const groundcoverSites=generateGroundcoverSites(terrain.layout.seed,generateCanyonRockSites(terrain.layout.seed));
      const mossTrees=selectMossTreeSites(terrain.layout.seed,groundcoverSites);
      const home=terrain.layout.cottage,forward=terrain.layout.homeBearing;
      const across=new Vector3().crossVectors(home,forward).normalize();
      const key=(x:number,y:number,z:number):string=>`${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
      const selectedKeys=new Map(mossTrees.map(tree=>{
        const direction=home.clone().multiplyScalar(tree.site.direction.y).addScaledVector(across,tree.site.direction.x).addScaledVector(forward,tree.site.direction.z).normalize();
        return [key(direction.x,direction.y,direction.z),tree] as const;
      }));
      const mossRoots=new Map<string,{geometry:InstancedBufferGeometry;index:number}>();
      const treeRoots=new Map<string,{geometry:InstancedBufferGeometry;index:number}>();
      for(const geometry of batches(scenery)){
        const kinds=new Set(Array.from(geometry.getAttribute('aKind').array));
        const roots=kinds.has(9)?mossRoots:kinds.has(1)?treeRoots:undefined;
        if(!roots)continue;
        const anchors=geometry.getAttribute('aAnchor');
        for(let i=0;i<geometry.instanceCount;i++)roots.set(key(anchors.getX(i),anchors.getY(i),anchors.getZ(i)),{geometry,index:i});
      }
      let acceptedMossTrees=0;
      for(const [direction,selected] of selectedKeys){
        const moss=mossRoots.get(direction),tree=treeRoots.get(direction);
        if(!moss){expect(tree).toBeUndefined();continue;}
        expect(tree).toBeDefined();
        if(!tree)continue;
        acceptedMossTrees++;
        const mossAcross=moss.geometry.getAttribute('aAcross'),treeAcross=tree.geometry.getAttribute('aAcross');
        expect([treeAcross.getX(tree.index),treeAcross.getY(tree.index),treeAcross.getZ(tree.index)])
          .toEqual([mossAcross.getX(moss.index),mossAcross.getY(moss.index),mossAcross.getZ(moss.index)]);
        // The parent mat decides terrain acceptance, but the trunk stays
        // upright and retains its own smaller size while the planet grows.
        const treeSlope=tree.geometry.getAttribute('aGroundSlope');
        expect([treeSlope.getX(tree.index),treeSlope.getY(tree.index)]).toEqual([0,0]);
        expect(tree.geometry.getAttribute('aHeightScale').getX(tree.index)).toBe(1);
        expect(tree.geometry.getAttribute('aPlacement').getX(tree.index))
          .toBeCloseTo(moss.geometry.getAttribute('aPlacement').getX(moss.index)*selected.scale/selected.site.scale,6);
      }
      if(radius===128)expect(acceptedMossTrees).toBeGreaterThan(180);
      let elevatedPlants = 0;
      let instances = 0;
      let triangles = 0;
      for (const geometry of batches(scenery)) {
        const anchors = geometry.getAttribute('aAnchor') as InstancedBufferAttribute;
        const placement = geometry.getAttribute('aPlacement') as InstancedBufferAttribute;
        const direction = terrain.layout.cottage.clone();
        const kinds = new Set(Array.from(geometry.getAttribute('aKind').array));
        instances += geometry.instanceCount;
        triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 * geometry.instanceCount;
        for (let i = 0; i < geometry.instanceCount; i++) {
          direction.set(anchors.getX(i), anchors.getY(i), anchors.getZ(i));
          expect(direction.length()).toBeCloseTo(1, 6);
          // The vertex shader normalises the stored float32 anchor before
          // terrain sampling; its rounded length is not a height offset.
          direction.normalize();
          const sample = terrain.sample(direction, ground);
          const scale = placement.getX(i);
          // Fragments carry only chalk material. Their skirt owns ground
          // contact, so their low cap is embedded 2 cm, not the shelf/plant 8 cm.
          const groundEmbed = kinds.size === 1 && kinds.has(2) ? 0.02 : 0.08;
          const soilHeight = sample.height - groundEmbed * scale;
          if (anchors.getW(i) > soilHeight + 0.00001) {
            // A fading site may retain sub-millimetre support. Classify it
            // above float32 noise rather than mistaking it for ground contact.
            // Elevated plants must be supported by a real shelf at the same
            // sphere anchor, never by an arbitrary allowance in this assertion.
            let actualSurface: number | undefined;
            for (const shelf of shelves) {
              const shelfAnchors=shelf.geometry.getAttribute('aAnchor'),shelfPlacement=shelf.geometry.getAttribute('aPlacement');
              for (let j=0;j<shelf.geometry.instanceCount;j++) {
                if(Math.hypot(direction.x-shelfAnchors.getX(j),direction.y-shelfAnchors.getY(j),direction.z-shelfAnchors.getZ(j))<1e-6) {
                  actualSurface=shelfAnchors.getW(j)+shelfSurface*shelfPlacement.getX(j)*shelf.geometry.getAttribute('aHeightScale').getX(j);
                  break;
                }
              }
              if(actualSurface!==undefined)break;
            }
            expect(actualSurface).toBeDefined();
            expect(kinds.has(1) || kinds.has(8)).toBe(true);
            expect(anchors.getW(i)).toBeCloseTo(actualSurface! - 0.08 * scale, 4);
            if (kinds.has(1)) elevatedPlants++;
          } else {
            expect(anchors.getW(i)).toBeCloseTo(soilHeight, 4);
          }
          const heightScale = geometry.getAttribute('aHeightScale').getX(i);
          expect(Number.isFinite(heightScale)).toBe(true);
          expect(heightScale).toBeGreaterThan(0);
          expect(placement.getW(i)).toBe(1); // every submitted mesh is fully opaque
          const home = terrain.cottageLocal(direction, { x: 0, z: 0 });
          const nearHome = direction.dot(terrain.layout.cottage) > 0;
          for (const [x,z] of [[-7.2,12],[0,17],[7.2,12]]) {
            const insideRoute=nearHome&&((home.x-x)/3.15)**2+((home.z-z)/2.75)**2<1;
            expect(insideRoute).toBe(false);
          }
        }
      }
      expect(instances).toBeGreaterThan(100);
      expect(elevatedPlants).toBeGreaterThan(0);
      expect(triangles).toBeLessThan(3_000_000);
      // Three canopy habits and two olive growth habits are separate batches;
      // keep their total draw budget bounded while preserving all three fans.
      // Plain moss plus two rooted plant communities share ground fitting.
      expect(batches(scenery).length).toBeLessThanOrEqual(11+CHALK_SHELF_VARIANTS);
      expect(scenery.group.children.filter(child=>(child as Mesh).isMesh&&/scarlet fan/i.test(child.name))).toHaveLength(3);
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
