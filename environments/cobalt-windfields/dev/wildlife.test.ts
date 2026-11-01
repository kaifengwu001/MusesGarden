import { Ray, Vector3, type Mesh, type InstancedBufferGeometry, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { KITELET_PERCH_HEIGHT, wildlifeGeometry, wildlifeHabitatGeometry, WILDLIFE_DISPLAY_SCALE, WILDLIFE_SPECIES, WILDLIFE_SIZE, WILDLIFE_FEET } from '../life/wildlifeGeometry';
import { WindWildlife, wildlifeDirection, wildlifeHome, wildlifeMotion, wildlifePresence } from '../life/windWildlife';
import { defaultParams } from '../params';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

function fieldParams(): FieldParams {
  const p = defaultParams();
  return { roll: p.terrain.roll, hummocks: p.terrain.hummocks, wetlands: 0, waterLevel: 0, grain: p.terrain.grain, density: p.flowers.density, patchiness: p.flowers.patchiness, patchSize: p.flowers.patchSize, weights: [p.flowers.pink, p.flowers.star, p.flowers.yellow, p.flowers.blue] };
}
function terrainAt(radius: number, seed: number): Terrain {
  const terrain = new Terrain(generateLayout(seed)); terrain.update(radius, fieldParams(), 2 * radius / 512); return terrain;
}

describe('Cobalt reference wildlife', () => {
  it('preserves physical dimensions and distinct, broad articulated silhouettes', () => {
    for (const species of WILDLIFE_SPECIES) {
      const geometry = wildlifeGeometry(species);
      const p = geometry.getAttribute('position'), joint = geometry.getAttribute('aJoint'), kind = geometry.getAttribute('aKind');
      const bounds = new Map<number, { min: Vector3; max: Vector3 }>();
      let eyes = 0;
      for (let i = 0; i < p.count; i++) {
        const id = joint.getX(i), v = new Vector3().fromBufferAttribute(p, i);
        expect(Number.isFinite(v.lengthSq())).toBe(true);
        if (!bounds.has(id)) bounds.set(id, { min: v.clone(), max: v.clone() });
        else { bounds.get(id)!.min.min(v); bounds.get(id)!.max.max(v); }
        if (kind.getX(i) === 4) eyes++;
      }
      expect(eyes).toBeGreaterThan(20);
      if (species === 'kitelet') {
        expect([...bounds.keys()].sort()).toEqual([0, 5, 6, 7, 8]);
        // The real midrib's submillimetre thickness extends beyond its leaf tip.
        expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeCloseTo(WILDLIFE_SIZE[species], 3);
        // Four broad diamonds, each wider/longer than the tiny central body.
        for (const id of [5, 6, 7, 8]) { const b = bounds.get(id)!; expect(b.max.x - b.min.x).toBeGreaterThan(0.09); expect(b.max.z - b.min.z).toBeGreaterThan(0.07); }
      } else {
        for (const id of [1, 2, 3, 4]) expect(bounds.has(id)).toBe(true);
        const body = bounds.get(0)!;
        expect(body.max.z - body.min.z).toBeCloseTo(WILDLIFE_SIZE[species], 5);
        expect(body.max.y - body.min.y).toBeLessThan(WILDLIFE_SIZE[species] * 0.45);
        if (species === 'sailback') {
          expect([...bounds.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
          for (const id of [5, 6]) { const b = bounds.get(id)!; expect(b.max.y - b.min.y).toBeGreaterThan(0.15); expect(b.max.z - b.min.z).toBeGreaterThan(0.12); }
        } else {
          expect([...bounds.keys()].sort()).toEqual([0, 1, 2, 3, 4, 9]);
          const stem = bounds.get(9)!; expect(stem.max.x - stem.min.x).toBeGreaterThan(0.13); expect(stem.max.z - stem.min.z).toBeLessThan(0.004);
        }
      }
      expect(p.count).toBeLessThan(8000);
      geometry.dispose();
    }
  });

  it('has continuous, deterministic walk/open/skim, flutter/perch, and carry/place cycles', () => {
    const activities = new Set<string>();
    for (const species of WILDLIFE_SPECIES) {
      // Coarse interior samples plus dense samples immediately around every
      // state boundary cover continuity without tens of thousands of matchers.
      const cycle = species === 'sailback' ? 26 : species === 'kitelet' ? 22 : 20;
      const boundaries = species === 'sailback' ? [0, 9, 12, 15, 26] : species === 'kitelet' ? [0, 1, 4, 7, 11, 16, 20, 22] : [0, 7, 9, 10, 11, 13, 18, 20];
      const offset = wildlifeMotion(species, 0, 0, 166).phase;
      const samples = new Set(Array.from({ length: 451 }, (_, i) => i * 0.2));
      for (let lap = 0; lap < 5; lap++) for (const boundary of boundaries) for (const delta of [-0.01, -0.0001, 0, 0.0001, 0.01]) {
        const t = lap * cycle + boundary - offset + delta;
        if (t >= 0 && t <= 90) samples.add(t);
      }
      let previous = wildlifeMotion(species, 0, 0, 166), previousTime = 0;
      let maximumSpeed = 0, minimumHeading = Infinity, minimumLift = Infinity;
      for (const time of [...samples].sort((a, b) => a - b)) {
        const pose = wildlifeMotion(species, 0, time, 166);
        if (time > previousTime) maximumSpeed = Math.max(maximumSpeed, Math.hypot(pose.x - previous.x, pose.z - previous.z, pose.lift - previous.lift) / (time - previousTime));
        minimumHeading = Math.min(minimumHeading, Math.hypot(pose.headingX, pose.headingZ)); minimumLift = Math.min(minimumLift, pose.lift);
        activities.add(pose.activity); previous = pose; previousTime = time;
      }
      // Short wind-assisted skims may travel up to 1.7 m/s at the 3x display
      // scale. Bound speed, rather than allowing a discontinuous teleport.
      expect(maximumSpeed).toBeLessThan(1.8); expect(minimumHeading).toBeGreaterThan(0.1); expect(minimumLift).toBeGreaterThanOrEqual(-1e-12);
      for (const time of [0, 9, 13.5, 25, 1.2, 88, 12]) expect(wildlifeMotion(species, 0, time, 166)).toEqual(wildlifeMotion(species, 0, time, 166));
    }
    for (const word of ['Walking', 'Opening', 'Skimming', 'Perched', 'Fluttering', 'Gliding', 'Carrying', 'Tucking', 'Scurrying']) expect([...activities].some(a => a.includes(word)), word).toBe(true);
  });

  it('shows blue armour above the Sailback skin and convex split Stitcher panels', () => {
    const sail = wildlifeGeometry('sailback'), stitcher = wildlifeGeometry('sand-stitcher');
    const cast = (geometry: typeof sail, x: number, z: number, below = false): { kind: number; y: number } => {
      const ray = new Ray(new Vector3(x, below ? -1 : 1, z), new Vector3(0, below ? 1 : -1, 0));
      const p = geometry.getAttribute('position'), j = geometry.getAttribute('aJoint'), k = geometry.getAttribute('aKind');
      const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
      let distance = Infinity, nearest = { kind: -1, y: 0 };
      for (let i = 0; i < p.count; i += 3) {
        if (j.getX(i) !== 0) continue;
        if (!ray.intersectTriangle(a.fromBufferAttribute(p, i), b.fromBufferAttribute(p, i + 1), c.fromBufferAttribute(p, i + 2), false, hit)) continue;
        const d = hit.distanceTo(ray.origin);
        if (d < distance) { distance = d; nearest = { kind: k.getX(i), y: hit.y }; }
      }
      return nearest;
    };
    for (const z of [-0.105, -0.065, -0.02, 0.03, 0.08, 0.145, 0.175, 0.20]) for (const x of [-0.015, 0, 0.015]) expect(cast(sail, x, z).kind).toBe(0);
    for (const z of [-0.08, 0, 0.07]) expect(cast(sail, 0, z, true).kind).toBe(1);
    for (const side of [-1, 1]) {
      const crown = cast(stitcher, side * 0.012, -0.012), shoulder = cast(stitcher, side * 0.039, -0.012);
      expect(crown.kind).toBe(0); expect(shoulder.kind).toBe(0); expect(crown.y - shoulder.y).toBeGreaterThan(0.012);
    }
    // Probe both tapered ends across almost the full panel width. These rays
    // previously hit peach skin protruding through the front/rear blue rims.
    for (const [z, width] of [[-0.060, 0.01816], [-0.055, 0.02395], [-0.049, 0.0309], [0.033, 0.03414], [0.039, 0.02986], [0.042, 0.02771]]) {
      for (const side of [-1, 1]) for (const fraction of [0.12, 0.35, 0.6, 0.8, 0.92]) {
        expect(cast(stitcher, side * (0.0014 + width * fraction), z).kind, `shell end at z=${z}, side=${side}, width=${fraction}`).toBe(0);
      }
    }
    expect(cast(stitcher, 0, -0.012).kind).toBe(1);
    sail.dispose(); stitcher.dispose();
  });

  it('anchors every species and foot to current terrain across seeds, radius changes and seeking', () => {
    const terrain = terrainAt(128, 166);
    const wildlife = new WindWildlife({}, terrain);
    for (const seed of [5, 166, 412]) for (const radius of [40, 128, 400]) {
      terrain.setLayout(generateLayout(seed));
      terrain.update(radius, fieldParams(), 2 * radius / 512);
      wildlife.invalidate();
      for (const time of [0, 8, 13, 20, 75, 4]) {
        wildlife.update(time, terrain);
        for (const species of WILDLIFE_SPECIES) {
          const e = wildlife.encounter(species)!;
          expect(e.dir.length()).toBeCloseTo(1, 10);
          expect(e.height - terrain.height(e.dir)).toBeCloseTo(wildlifeMotion(species, 0, time, seed).lift, 8);
          expect(e.heading.dot(e.dir)).toBeCloseTo(0, 10);
          const mesh = wildlife.group.children.find(c => c.name === `${species} bodies`) as Mesh<InstancedBufferGeometry, ShaderMaterial>;
          const feet = mesh.geometry.getAttribute('aFeet');
          const up = e.dir, heading = e.heading, across = new Vector3().crossVectors(up, heading).normalize();
          WILDLIFE_FEET[species].forEach(([fx, fz], i) => {
            const scale=WILDLIFE_DISPLAY_SCALE[species];
            const dir = up.clone().addScaledVector(across, fx*scale / radius).addScaledVector(heading, fz*scale / radius).normalize();
            expect(feet.array[i]).toBeCloseTo(terrain.height(dir) - terrain.height(up), 6);
          });
          const pose = wildlifeMotion(species, 0, time, seed);
          expect(e.dir.distanceTo(wildlifeDirection(terrain, pose.x, pose.z))).toBeLessThan(1e-12);
        }
      }
    }
    wildlife.dispose(); expect(wildlife.group.children).toHaveLength(0); wildlife.dispose();
  });

  it('hides distant fauna and keeps encounter positions available for the close-up camera', () => {
    const terrain = terrainAt(128, 166), wildlife = new WindWildlife({}, terrain);
    wildlife.update(12, terrain, new Vector3(0, 0, 2000));
    expect(wildlife.group.children.every(c => !c.visible)).toBe(true);
    expect(WILDLIFE_SPECIES.every(s => wildlife.encounter(s) !== null)).toBe(true);
    const target = wildlife.encounter('sailback')!;
    wildlife.update(12, terrain, target.dir.clone().multiplyScalar(terrain.radius + target.height + 1));
    expect(wildlife.group.children.find(c => c.name === 'sailback bodies')!.visible).toBe(true);
    wildlife.dispose();
  });

  it('keeps compact contact shadows on the ground and fades them with their animals', () => {
    const terrain = terrainAt(128, 412), wildlife = new WindWildlife({}, terrain);
    const shadows = wildlife.group.children.find(c => c.name === 'Wildlife ground contacts') as Mesh<InstancedBufferGeometry, ShaderMaterial>;
    expect(shadows.material.depthWrite).toBe(false); expect(shadows.material.transparent).toBe(true);
    for (const time of [0, 13, 15, 25]) {
      wildlife.update(time, terrain);
      expect(shadows.geometry.instanceCount).toBe(6);
      const anchors = shadows.geometry.getAttribute('aShadowAnchor'), shapes = shadows.geometry.getAttribute('aShadowShape');
      for (let i = 0; i < 6; i++) {
        const dir = new Vector3(anchors.getX(i), anchors.getY(i), anchors.getZ(i)).normalize();
        expect(Math.abs(anchors.getW(i) - terrain.height(dir))).toBeLessThan(0.0001);
        // Shadow footprint follows the displayed body, including its skim.
        expect(shapes.getX(i)).toBeGreaterThan(0.15); expect(shapes.getX(i)).toBeLessThan(0.30);
        expect(shapes.getY(i)).toBeGreaterThan(0.22); expect(shapes.getY(i)).toBeLessThan(0.675);
        expect(shapes.getZ(i)).toBeGreaterThan(0.1); expect(shapes.getZ(i)).toBeLessThanOrEqual(0.241);
      }
    }
    wildlife.update(13, terrain, new Vector3(0, 0, 2000));
    expect(shadows.visible).toBe(false);
    expect(Array.from(shadows.geometry.getAttribute('aShadowShape').array).filter((_, i) => i % 3 === 2).every(alpha => alpha === 0)).toBe(true);
    wildlife.dispose();
  });

  it('keeps fauna solid at ordinary landscape distances and fades subpixel silhouettes', () => {
    const terrain=terrainAt(128,412), wildlife=new WindWildlife({},terrain);
    const cameraDir=wildlifeDirection(terrain,7,48);
    const camera=cameraDir.clone().multiplyScalar(128+terrain.height(cameraDir)+8);
    for(const time of [0,7,13,22]) {
      wildlife.update(time,terrain,camera,0.001);
      for(const species of WILDLIFE_SPECIES) {
        const mesh=wildlife.group.children.find(c=>c.name===`${species} bodies`) as Mesh<InstancedBufferGeometry,ShaderMaterial>;
        expect(mesh.visible).toBe(true);
        for(const presence of mesh.geometry.getAttribute('aPresence').array) expect(presence,`${species} must be solid in the landscape`).toBeGreaterThan(0.99);
      }
    }
    // Screen size, not raw distance, controls the transition across devices.
    for(const species of WILDLIFE_SPECIES) {
      expect(wildlifePresence(species,30,0.001)).toBe(1);
      const span=WILDLIFE_SIZE[species]*WILDLIFE_DISPLAY_SCALE[species];
      expect(wildlifePresence(species,span/0.001,0.001)).toBe(0);
      expect(wildlifePresence(species,span/(5*0.001),0.001)).toBeGreaterThan(0);
      expect(wildlifePresence(species,20,0.001)).toBe(wildlifePresence(species,10,0.002));
    }
    wildlife.dispose();
  });

  it('lands Kitelet feet on a physical seed cup and keeps placed stems with the litter', () => {
    const terrain=terrainAt(128,412), wildlife=new WindWildlife({},terrain);
    const perch=wildlifeHabitatGeometry('kitelet');
    const p=perch.getAttribute('position'),j=perch.getAttribute('aJoint');
    const ray=new Ray(new Vector3(0,3,0),new Vector3(0,-1,0));
    const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
    let top=-Infinity;
    for(let i=0;i<p.count;i+=3) if(j.getX(i)===0&&ray.intersectTriangle(a.fromBufferAttribute(p,i),b.fromBufferAttribute(p,i+1),c.fromBufferAttribute(p,i+2),false,hit)) top=Math.max(top,hit.y);
    expect(top).toBeCloseTo(KITELET_PERCH_HEIGHT,5);
    const landingTime=22-wildlifeMotion('kitelet',0,0,412).phase;
    const landing=wildlifeMotion('kitelet',0,landingTime,412),home=wildlifeHome('kitelet',0);
    expect(landing.x).toBeCloseTo(home.x,8);expect(landing.z).toBeCloseTo(home.z,8);
    expect(landing.lift-0.014*WILDLIFE_DISPLAY_SCALE.kitelet).toBeCloseTo(top,5);
    const phase=wildlifeMotion('sand-stitcher',0,0,412).phase;
    const anchors: number[][]=[];
    for(const t of [9,16]) {
      wildlife.update(t-phase,terrain);
      const fence=wildlife.group.children.find(c=>c.name==='sand-stitcher habitats') as Mesh<InstancedBufferGeometry,ShaderMaterial>;
      anchors.push(Array.from(fence.geometry.getAttribute('aAnchor').array).slice(0,4));
      expect(fence.geometry.getAttribute('aMotion').getW(0)).toBe(1);
    }
    expect(anchors[0]).toEqual(anchors[1]);
    expect(wildlifeMotion('sand-stitcher',0,16-phase,412).x).toBeLessThan(wildlifeMotion('sand-stitcher',0,9-phase,412).x);
    perch.dispose();wildlife.dispose();
  });

  it('gives perches distinct cupped foliage and removes upright coral-like litter spikes',()=>{
    const geometries=[0,1,2].map(i=>wildlifeHabitatGeometry('kitelet',i));
    const signatures=geometries.map(g=>Array.from(g.getAttribute('position').array).join(','));
    expect(new Set(signatures).size).toBe(3);
    const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
    for(const g of geometries) {
      const p=g.getAttribute('position'),k=g.getAttribute('aKind'),areas=Array.from({length:8},()=>0);
      const ray=new Ray(new Vector3(0,3,0),new Vector3(0,-1,0));
      let landing=-Infinity;
      for(let i=0;i<p.count;i+=3) {
        a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
        if(ray.intersectTriangle(a,b,c,false,hit))landing=Math.max(landing,hit.y);
        if(k.getX(i)!==2)continue;
        const area=b.sub(a).cross(c.sub(a)).multiplyScalar(.5);
        for(let n=0;n<8;n++)areas[n]+=Math.abs(area.x*Math.cos(n*Math.PI/4)+area.z*Math.sin(n*Math.PI/4));
      }
      expect(landing).toBeCloseTo(KITELET_PERCH_HEIGHT,5);
      expect(Math.min(...areas)/Math.max(...areas)).toBeGreaterThan(.3);
      expect(g.boundingBox!.max.z-g.boundingBox!.min.z).toBeGreaterThan(.4);
      g.dispose();
    }
    const litter=wildlifeHabitatGeometry('sand-stitcher');
    expect(new Set(litter.getAttribute('aKind').array)).toEqual(new Set([6]));
    expect(litter.boundingBox!.max.y).toBeLessThan(.075);
    expect(litter.boundingBox!.max.x-litter.boundingBox!.min.x).toBeGreaterThan(.4);
    litter.dispose();
  });

});
