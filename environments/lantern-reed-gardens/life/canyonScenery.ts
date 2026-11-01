import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { chalkGeometry, fanTreeGeometry, fernGeometry, lampPetalGeometry } from './canyonGeometry';
import vertexShader from './canyonScenery.vert.glsl?raw';
import fragmentShader from './canyonScenery.frag.glsl?raw';

interface Anchor {
  direction: Vector3;
  local?: readonly [number, number];
  scale: number;
  turn: number;
  phase: number;
  tint: number;
  threshold: number;
  height?: number;
  groundHeight?: number;
  water?: number;
}
type Habitat = 'reeds' | 'stone' | 'herbs' | 'pollinators';
interface Batch {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  anchors: Anchor[];
  habitat: Habitat;
  anchorData: InstancedBufferAttribute;
  acrossData: InstancedBufferAttribute;
  placementData: InstancedBufferAttribute;
}
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0), EAST = new Vector3(1, 0, 0);

/** Seeded reed colonies, the Evening Causeway and a few local dusk pollinators. */
export class CanyonScenery {
  readonly group = new Group();
  readonly ready = true;
  private readonly material: ShaderMaterial;
  private readonly batches: Batch[] = [];
  private readonly time = { value: 0 };
  private seed = Number.NaN;
  private radius = Number.NaN;
  private dirty = true;
  private growthFrame = 0;
  private pendingGround = false;
  private readonly right = new Vector3();
  private readonly dir = new Vector3();
  private readonly x = new Vector3();
  private readonly z = new Vector3();
  private readonly turned = new Vector3();
  private readonly ground = createGroundSample();

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.material = new ShaderMaterial({
      name: 'Lantern reeds and mineral gardens', vertexShader, fragmentShader,
      uniforms: { ...shared, uSceneryTime: this.time, uLanternDusk: shared.uLanternDusk ?? { value: 0.6 } }, side: DoubleSide,
    });
    this.group.name = 'Lantern reed colonies, mineral causeway and Lamp Petals';
    this.buildAnchors(terrain);
    this.update(0, terrain);
  }

  invalidate(): void { this.dirty = true; }

  private batch(base: BufferGeometry, anchors: Anchor[], name: string, habitat: Habitat): void {
    const geometry = new InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
    geometry.setIndex(base.index);
    const anchorData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const acrossData = new InstancedBufferAttribute(new Float32Array(anchors.length * 3), 3);
    const placementData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    geometry.setAttribute('aAnchor', anchorData);
    geometry.setAttribute('aAcross', acrossData);
    geometry.setAttribute('aPlacement', placementData);
    geometry.instanceCount = 0;
    const mesh = new Mesh(geometry, this.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.batches.push({ mesh, anchors, habitat, anchorData, acrossData, placementData });
  }

  private buildAnchors(terrain: Terrain): void {
    for (const b of this.batches) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.batches.length = 0;
    this.seed = terrain.layout.seed;
    let state = hash32(this.seed ^ 0x1a72e4);
    const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
    const reeds: Anchor[] = [], rocks: Anchor[] = [], herbs: Anchor[] = [], flyers: Anchor[] = [];
    const local = (x: number, z: number, scale: number, turn = rand() * TAU): Anchor => ({ direction: new Vector3(), local: [x, z], scale, turn, phase: rand() * TAU, tint: rand(), threshold: 0 });
    // The main clearing remains spacious; the tallest leaves frame its edges.
    for (const [x, z, scale] of [[-11,-5,1.55],[-15,-1,1.15],[-10,-11,1.05],[10,-5,1.3],[14,3,1.0],[-14,8,1.08],[15,16,0.9],[-12,23,0.9],[11,25,0.75],[-43,36,1.3],[-24,44,1.05]]) {
      reeds.push(local(x, z, scale));
      for (let k = 0; k < 8; k++) {
        const angle = rand() * TAU, distance = 0.7 + rand() * 2;
        herbs.push(local(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance, 1.2 + rand() * 0.5));
      }
    }
    // Reeds trace the basin perimeter in loose clumps, with open water between them.
    for (let k = 0; k < 30; k++) {
      const angle = k / 30 * TAU;
      if (k % 7 === 0) continue;
      const x = -25 + Math.cos(angle) * (18 + rand() * 3);
      const z = 24 + Math.sin(angle) * (15 + rand() * 3);
      if (x > -12 && z > 5 && z < 22) continue;
      // Keep the overlook itself free; edge colonies frame it without a lamp against the lens.
      if (Math.hypot(x + 35, z - 43) < 9) continue;
      reeds.push(local(x, z, 0.55 + rand() * 0.5));
      for (let j = 0; j < 4; j++) herbs.push(local(x + (rand() - 0.5) * 2.6, z + (rand() - 0.5) * 2.6, 0.9 + rand() * 0.8));
    }
    // Broad slabs mark a quiet side crossing. Resident paths stay on the clearing.
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      const stone = local(-13 - t * 23, 22 + Math.sin(t * Math.PI) * 4.8, 1.35 + rand() * 0.2, 0.08 + rand() * 0.3);
      stone.height = 0.12;
      rocks.push(stone);
    }
    for (const [x,z,scale] of [[-10,-7,2.0],[-17,-7,1.5],[11,-9,1.9],[14,5,1.25],[-15,8,1.15],[15,22,1.6],[-9,24,1.5]]) rocks.push(local(x,z,scale));
    for (let i = 0; i < 7; i++) flyers.push(local(-11.5 + Math.sin(i * 2.3) * 6.5, 1 + Math.cos(i * 2.3) * 7, 1.1 + rand() * 0.35));

    const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const across = new Vector3().crossVectors(home, forward).normalize();
    for (let i = 0; i < 260; i++) {
      const y = 1 - 2 * (i + 0.5) / 260, a = i * 2.399963229728653 + this.seed * 0.001, r = Math.sqrt(1 - y * y);
      const dir = home.clone().multiplyScalar(y).addScaledVector(across, Math.cos(a) * r).addScaledVector(forward, Math.sin(a) * r).normalize();
      if (dir.dot(home) > Math.cos(0.4)) continue;
      const gate = rand();
      const anchor: Anchor = { direction: dir, scale: 0.52 + rand() * 0.48, turn: rand() * TAU, phase: rand() * TAU, tint: rand(), threshold: gate };
      reeds.push(anchor);
      const tangent = new Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : EAST).normalize();
      const bitangent = new Vector3().crossVectors(tangent, dir).normalize();
      for (let k = 0; k < 3; k++) {
        const angle = rand() * TAU;
        const nearby = dir.clone().addScaledVector(tangent, Math.cos(angle) * 0.012).addScaledVector(bitangent, Math.sin(angle) * 0.012).normalize();
        herbs.push({ direction: nearby, scale: 0.8 + rand() * 1.2, turn: rand() * TAU, phase: rand() * TAU, tint: rand(), threshold: gate });
        if (k === 0) rocks.push({ direction: nearby, scale: 0.8 + rand() * 1.5, turn: rand() * TAU, phase: 0, tint: rand(), threshold: gate });
      }
    }
    this.batch(fanTreeGeometry(), reeds, 'Mint lantern reeds and ivory leaves', 'reeds');
    this.batch(chalkGeometry(), rocks, 'Evening Causeway and mineral shore slabs', 'stone');
    this.batch(fernGeometry(), herbs, 'Lavender shore sprigs', 'herbs');
    this.batch(lampPetalGeometry(), flyers, 'Seven four-winged Lamp Petals', 'pollinators');
    this.dirty = true;
  }

  update(time: number, terrain: Terrain): void {
    this.time.value = time;
    if (terrain.layout.seed !== this.seed) this.buildAnchors(terrain);
    const growing = terrain.radius !== this.radius;
    // Distant anchors have fixed directions. During growth, their terrain
    // changes slowly; stagger those samples instead of spending a whole frame
    // re-evaluating every colony. Hero reeds, slabs and pollinators stay exact;
    // small local sprigs refresh in four groups. The first still frame refreshes
    // everything exactly (including the dev harness's deterministic settle).
    const refreshAll = this.dirty || (!growing && this.pendingGround);
    const rebuild = refreshAll || growing;
    this.pendingGround = growing;
    this.radius = terrain.radius;
    this.dirty = false;
    const bucket = this.growthFrame++ % 8;
    const R = terrain.radius, home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const { right, dir, x, z, turned } = this;
    right.crossVectors(home, forward).normalize();
    let globalIndex = 0;
    let herbIndex = 0;
    const active = Math.min(1, 0.35 + R / 128 * 0.5);
    for (const batch of this.batches) {
      const flying = batch.habitat === 'pollinators';
      if (!rebuild && !flying) continue;
      let count = 0;
      for (const a of batch.anchors) {
        const refreshGlobal = !a.local && globalIndex++ % 8 === bucket;
        const refreshLocal = a.local && (batch.habitat !== 'herbs' || herbIndex++ % 4 === bucket % 4);
        if (a.threshold >= active) continue;
        const emergence = a.local ? 1 : smoothstep(a.threshold, a.threshold + 0.08, active);
        if (a.local) {
          let [lx, lz] = a.local;
          if (flying) {
            const cycle = time * 0.22 + a.phase;
            const flutter = Math.max(0, Math.sin(cycle * 0.47));
            lx += Math.sin(cycle) * 1.8 * flutter;
            lz += Math.cos(cycle * 0.71) * 1.2 * flutter;
          }
          const d = Math.hypot(lx, lz), angle = Math.asin(Math.min(0.95, d / R));
          dir.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right, lx / d * Math.sin(angle)).addScaledVector(forward, lz / d * Math.sin(angle)).normalize();
        } else dir.copy(a.direction);
        if (refreshLocal || refreshAll || refreshGlobal || a.groundHeight === undefined) {
          terrain.sample(dir, this.ground);
          a.groundHeight = this.ground.height;
          a.water = this.ground.water;
        }
        // Global colonies favour shallow banks; leave the broad mirror pools open.
        if (!a.local && a.water! < -1.5 && batch.habitat !== 'stone') continue;
        if (!a.local && batch.habitat === 'stone' && a.water! < -0.5) continue;
        if (a.local) x.copy(right).addScaledVector(dir, -right.dot(dir)).normalize();
        else x.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : EAST).normalize();
        z.crossVectors(x, dir).normalize();
        const turn = a.turn + (flying ? Math.sin(time * 0.22 + a.phase) * 0.7 : 0);
        turned.copy(x).multiplyScalar(Math.cos(turn)).addScaledVector(z, Math.sin(turn));
        let height = a.groundHeight - 0.06 * a.scale;
        if (a.height !== undefined) height = Math.max(height, a.height);
        if (flying) height += 2.4 + 0.55 * Math.sin(time * 0.32 + a.phase);
        batch.anchorData.setXYZW(count, dir.x, dir.y, dir.z, height);
        batch.acrossData.setXYZ(count, turned.x, turned.y, turned.z);
        batch.placementData.setXYZW(count, a.scale * emergence, a.phase, a.tint, 0);
        count++;
      }
      batch.mesh.geometry.instanceCount = count;
      batch.anchorData.needsUpdate = true;
      batch.acrossData.needsUpdate = true;
      batch.placementData.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.batches) b.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
