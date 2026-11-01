import { AdditiveBlending, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform, type Object3D } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { createHamletAssets, type HamletAsset, type HamletSpecies } from './hamletGeometry';
import vertexShader from './hamletScenery.vert.glsl?raw';
import fragmentShader from './hamletScenery.frag.glsl?raw';

interface Anchor { direction: Vector3; local?: readonly [number, number]; scale: number; turn: number; phase: number; tint: number; }
interface Batch {
  kind: HamletSpecies;
  asset: HamletAsset;
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  ink: LineSegments<InstancedBufferGeometry, ShaderMaterial>;
  shadow?: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  anchors: Anchor[];
  anchorData: InstancedBufferAttribute;
  acrossData: InstancedBufferAttribute;
  placementData: InstancedBufferAttribute;
}
export interface HamletClearing { direction: Vector3; radius: number; }
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0), EAST = new Vector3(1, 0, 0);

/** Natural, persistent scenery for the ukiyo-e world; no meadow-flower inheritance. */
export class HamletScenery {
  readonly group = new Group();
  readonly ready = true;
  private readonly material: ShaderMaterial;
  private readonly inkMaterial: ShaderMaterial;
  private readonly shadowMaterial: ShaderMaterial;
  private shadowParent: Object3D | null = null;
  private readonly time = { value: 0 };
  private readonly batches: Batch[] = [];
  private readonly ground = createGroundSample();
  private readonly footprintGround = createGroundSample();
  private clearings: readonly HamletClearing[] = [];
  private seed = Number.NaN;
  private radius = Number.NaN;
  private dirty = true;

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    const uniforms = { ...shared, uSceneryTime: this.time, uSnowAmount: shared.uSnowAmount ?? { value: 1 } };
    this.material = new ShaderMaterial({ name: 'ukiyoe-natural-scenery', vertexShader, fragmentShader, uniforms, side: DoubleSide });
    this.inkMaterial = new ShaderMaterial({ name: 'ukiyoe-selected-contours', vertexShader, fragmentShader, uniforms, defines: { HAMLET_INK: 1 }, transparent: true, depthWrite: false });
    this.shadowMaterial = new ShaderMaterial({ name: 'ukiyoe-scenery-shadows', vertexShader, fragmentShader, uniforms, defines: { HAMLET_SHADOW: 1 }, side: DoubleSide, blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false });
    this.group.name = 'Snow pines, cedars, plum, reeds and slate';
    this.rebuild(terrain);
    this.update(0, terrain);
  }

  invalidate(): void { this.dirty = true; }

  /** Extra inhabited clearings can reserve room for neighbour houses. */
  setClearings(clearings: readonly HamletClearing[]): void {
    this.clearings = clearings.map(c => ({ direction: c.direction.clone().normalize(), radius: c.radius }));
    this.dirty = true;
  }

  /** Actual instantiated colour geometry, for performance validation. Lines are separate. */
  get triangleCount(): number {
    return this.batches.reduce((sum, b) => sum + b.mesh.geometry.getAttribute('position').count / 3 * b.mesh.geometry.instanceCount, 0);
  }

  /** Local trees and bank stones cast into the existing sphere shadow map.
   * Remote forest templates omit this extra pass to bound its vertex cost. */
  get shadowMeshes(): Mesh<InstancedBufferGeometry, ShaderMaterial>[] {
    return this.batches.flatMap(b => b.shadow ? [b.shadow] : []);
  }

  private addBatch(kind: HamletSpecies, asset: HamletAsset, anchors: Anchor[], distant = false): void {
    const anchorData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const acrossData = new InstancedBufferAttribute(new Float32Array(anchors.length * 3), 3);
    const placementData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const instantiate = (base: BufferGeometry): InstancedBufferGeometry => {
      const geometry = new InstancedBufferGeometry();
      for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
      geometry.setIndex(base.index);
      geometry.setAttribute('aAnchor', anchorData);
      geometry.setAttribute('aAcross', acrossData);
      geometry.setAttribute('aPlacement', placementData);
      geometry.instanceCount = 0;
      return geometry;
    };
    const mesh = new Mesh(instantiate(asset.geometry), this.material);
    const ink = new LineSegments(instantiate(asset.ink), this.inkMaterial);
    const shadow = distant ? undefined : new Mesh(mesh.geometry, this.shadowMaterial);
    if (shadow) {
      shadow.frustumCulled = false;
      shadow.name = `Hamlet ${kind} shadow`;
      this.shadowParent?.add(shadow);
    }
    mesh.name = `Hamlet ${kind}${distant ? ' distant' : ''}`;
    ink.name = `Hamlet ${kind} selected contours`;
    mesh.frustumCulled = false; ink.frustumCulled = false;
    ink.renderOrder = 1;
    this.group.add(mesh, ink);
    this.batches.push({ kind, asset, mesh, ink, shadow, anchors, anchorData, acrossData, placementData });
  }

  private rebuild(terrain: Terrain): void {
    this.releaseBatches();
    this.seed = terrain.layout.seed;
    let state = hash32(this.seed ^ 0x9d243c);
    const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
    const anchors: Record<HamletSpecies, Anchor[]> = { pine: [], cedar: [], plum: [], reeds: [], rock: [] };
    const distant: Record<'pine' | 'cedar', Anchor[]> = { pine: [], cedar: [] };
    const local = (kind: HamletSpecies, x: number, z: number, scale: number, turn = rand() * TAU): void => {
      anchors[kind].push({ direction: new Vector3(), local: [x, z], scale, turn, phase: rand() * TAU, tint: rand() });
    };
    // Left framing pine, open doorway and central approach. Pines stay broad;
    // the slender cedars establish a separate distant layer behind the roof.
    for (const [x, z, scale, turn] of [[-9, -3, 1.13, -0.35], [-13, -7, 0.92, 0.65], [-15, 4, 0.8, -0.5], [8, -9, 0.85, 1.1], [-20, -13, 0.83, 0.2], [22, 1, 0.75, 2.3], [24, 25, 0.7, -0.4], [-15, 23, 0.62, 0.4]]) local('pine', x, z, scale, turn);
    for (const [x, z, scale] of [[-17, -14, 0.83], [-10, -15, 0.91], [-5, -18, 0.86], [1, -21, 0.94], [7, -18, 0.79], [13, -15, 0.86], [19, -10, 0.76], [25, 0, 0.72], [26, 28, 0.7]]) local('cedar', x, z, scale);
    for (const [x, z, scale] of [[-6.6, 2.5, 0.76], [-10, 6, 0.84], [-12, 15, 0.81], [6.7, -4, 0.72], [19, 3, 0.78], [22, 19, 0.77], [1, -11, 0.72], [-19, 27, 0.72]]) local('plum', x, z, scale);
    // An overlapping far shore gives the houses a landscape layer behind
    // them; the open path and right-hand water remain the foreground void.
    for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) {
      const kind = (i + row) % 3 === 0 ? 'pine' : 'cedar';
      const x = -29 + i * 5.8 + (row ? 2.4 : 0) + rand();
      const z = -25 - row * 7 - rand() * 3;
      distant[kind].push({ direction: new Vector3(), local: [x, z], scale: 0.74 + rand() * 0.28, turn: rand() * TAU, phase: rand() * TAU, tint: rand() });
    }
    // Rock/reed seams follow the river banks, interrupted at the bridge approaches.
    for (let side = -1; side <= 1; side += 2) for (const z of [-1, 3, 6, 14, 18, 23, 28]) {
      const x = 12 + side * (z > 15 ? 7.9 : 3.7);
      local('rock', x + (rand() - 0.5) * 0.5, z, 0.48 + rand() * 0.35);
      for (let k = 0; k < 3; k++) local('reeds', x + side * (0.7 + rand() * 0.6), z + (k - 1) * 0.65, 0.62 + rand() * 0.28);
    }
    // A broken, overlapping slate bank, not a row of identical boulders. The
    // lower rock rings follow the actual shore slope; bridge entries stay open.
    for (const z of [-1, 1, 3, 5, 6.2, 14, 16, 18, 20, 22, 24]) {
      for (const side of [-1, 1]) {
        const pondWidth = z > 15 ? Math.sqrt(Math.max(0, 52 - (z - 21) ** 2 * 0.67)) : 2.4;
        const x = 12 + Math.sin(z * 0.12) * 0.4 + side * Math.max(2.5, pondWidth);
        local('rock', x + side * (0.3 + rand() * 0.4), z + rand() * 0.5, 0.48 + rand() * 0.26, rand() * TAU);
      }
    }
    for (const [x, z, s] of [[-8, 6, 0.72], [-11, 12, 0.76], [-11, 19, 0.82], [-15, -1, 0.64], [5.8, -8, 0.72], [-19, 8, 0.76], [23, -4, 0.7], [-7, 27, 0.74]]) {
      local('rock', x, z, s);
      for (let k = 0; k < 3; k++) local('reeds', x + 1.3 + rand() * 0.7, z + (k - 1) * 0.7, 0.65 + rand() * 0.25);
    }

    // Persistent Fibonacci sites with small mixed clusters. Sampling filters
    // water and reserves the home; the random stream never changes each frame.
    const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const right = new Vector3().crossVectors(home, forward).normalize();
    const sites = 128;
    for (let i = 0; i < sites; i++) {
      const y = 1 - 2 * (i + 0.5) / sites, a = i * 2.3999632297 + this.seed * 0.001;
      const r = Math.sqrt(1 - y * y);
      const direction = home.clone().multiplyScalar(y).addScaledVector(right, Math.cos(a) * r).addScaledVector(forward, Math.sin(a) * r).normalize();
      const x = new Vector3().crossVectors(direction, Math.abs(direction.y) < 0.9 ? UP : EAST).normalize();
      const z = new Vector3().crossVectors(x, direction).normalize();
      const global = (kind: HamletSpecies, offsetX: number, offsetZ: number, scale: number): void => {
        const target = kind === 'pine' || kind === 'cedar' ? distant[kind] : anchors[kind];
        target.push({ direction: direction.clone().addScaledVector(x, offsetX / 128).addScaledVector(z, offsetZ / 128).normalize(), scale, turn: rand() * TAU, phase: rand() * TAU, tint: rand() });
      };
      global(i % 4 === 0 ? 'cedar' : 'pine', 0, 0, 1.25 + rand() * 0.47);
      const trees = 3 + Math.floor(rand() * 3), turn = rand() * TAU;
      for (let k = 1; k < trees; k++) {
        const angle = turn + k * 2.3999632297;
        const spread = 3.8 + Math.sqrt(k) * 2.7 + rand() * 1.4;
        global((i + k) % 3 === 0 ? 'pine' : 'cedar', Math.cos(angle) * spread, Math.sin(angle) * spread, 0.91 + rand() * 0.47);
      }
      if (i % 5 === 0) global('plum', 2.4, 1.8, 0.72 + rand() * 0.25);
      global('rock', -2.1, 1.1, 0.62 + rand() * 0.38);
      if (i % 2 === 0) global('rock', 2.5, -2.0, 0.48 + rand() * 0.36);
      global('reeds', -2.6, 1.8, 0.7 + rand() * 0.35);
      if (i % 3 === 0) global('reeds', 2.9, 1.7, 0.6 + rand() * 0.35);
    }
    const assets = createHamletAssets();
    for (const kind of Object.keys(anchors) as HamletSpecies[]) this.addBatch(kind, assets[kind], anchors[kind]);
    const remote = createHamletAssets(true);
    this.addBatch('pine', remote.pine, distant.pine, true);
    this.addBatch('cedar', remote.cedar, distant.cedar, true);
    for (const kind of ['plum', 'reeds', 'rock'] as const) { remote[kind].geometry.dispose(); remote[kind].ink.dispose(); }
    this.dirty = true;
  }

  update(time: number, terrain: Terrain): void {
    this.time.value = time;
    if (terrain.layout.seed !== this.seed) this.rebuild(terrain);
    if (!this.dirty && terrain.radius === this.radius) return;
    this.dirty = false; this.radius = terrain.radius;
    const R = terrain.radius, home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const right = new Vector3().crossVectors(home, forward).normalize();
    const direction = new Vector3(), across = new Vector3(), z = new Vector3(), turned = new Vector3(), probe = new Vector3();
    for (const batch of this.batches) {
      let count = 0;
      for (const anchor of batch.anchors) {
        const footprint = batch.asset.footprint * anchor.scale;
        if (anchor.local) {
          const [x, z] = anchor.local, d = Math.hypot(x, z);
          const angle = Math.asin(Math.min(d / R, 0.94));
          direction.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right, x / d * Math.sin(angle)).addScaledVector(forward, z / d * Math.sin(angle)).normalize();
          // The central resident path and both ends of the bridge stay empty.
          if (x > -1 - footprint && x < 6 + footprint && z > 3 - footprint && z < 31) continue;
          if (x > 6 - footprint && x < 18 + footprint && z > 8 - footprint && z < 12 + footprint) continue;
        } else {
          direction.copy(anchor.direction);
          if (Math.acos(Math.max(-1, Math.min(1, direction.dot(home)))) * R < 37 + footprint) continue;
        }
        if (this.clearings.some(c => Math.acos(Math.max(-1, Math.min(1, direction.dot(c.direction)))) * R < c.radius + footprint)) continue;
        terrain.sample(direction, this.ground);
        if (this.ground.clearing > 0.05 || this.ground.depth > 0.03 || this.ground.water < (batch.kind === 'rock' ? 0.12 : footprint * 0.7)) continue;
        across.copy(anchor.local ? right : Math.abs(direction.y) < 0.9 ? UP : EAST);
        if (anchor.local) across.addScaledVector(direction, -across.dot(direction)).normalize();
        else across.cross(direction).normalize();
        z.crossVectors(across, direction).normalize();
        turned.copy(across).multiplyScalar(Math.cos(anchor.turn)).addScaledVector(z, Math.sin(anchor.turn));
        let minHeight = this.ground.height, maxHeight = minHeight, supported = true;
        // Check the whole footprint. Tree roots and the rock's bottom ring then
        // conform to the GPU terrain at each vertex instead of hovering uphill.
        for (let k = 0; k < 4; k++) {
          const a = k * TAU / 4;
          probe.copy(direction).addScaledVector(across, Math.cos(a) * footprint / R).addScaledVector(z, Math.sin(a) * footprint / R).normalize();
          terrain.sample(probe, this.footprintGround);
          if (batch.kind !== 'rock' && this.footprintGround.depth > 0.05) supported = false;
          minHeight = Math.min(minHeight, this.footprintGround.height);
          maxHeight = Math.max(maxHeight, this.footprintGround.height);
        }
        if (!supported || (batch.kind !== 'rock' && maxHeight - minHeight > 0.85 * anchor.scale)) continue;
        const height = batch.kind === 'rock' ? maxHeight - 0.18 * anchor.scale : this.ground.height - 0.07 * anchor.scale;
        batch.anchorData.setXYZW(count, direction.x, direction.y, direction.z, height);
        batch.acrossData.setXYZ(count, turned.x, turned.y, turned.z);
        batch.placementData.setXYZW(count, anchor.scale, anchor.phase, anchor.tint, batch.kind === 'rock' ? 0 : batch.kind === 'reeds' ? 5 : 1);
        count++;
      }
      batch.mesh.geometry.instanceCount = count;
      batch.ink.geometry.instanceCount = count;
      batch.anchorData.needsUpdate = true; batch.acrossData.needsUpdate = true; batch.placementData.needsUpdate = true;
    }
  }

  private releaseBatches(): void {
    for (const b of this.batches) {
      if (b.shadow?.parent) this.shadowParent = b.shadow.parent;
      b.shadow?.removeFromParent();
      this.group.remove(b.mesh, b.ink);
      b.mesh.geometry.dispose(); b.ink.geometry.dispose();
      b.asset.geometry.dispose(); b.asset.ink.dispose();
    }
    this.batches.length = 0;
  }

  dispose(): void {
    this.releaseBatches(); this.material.dispose(); this.inkMaterial.dispose(); this.shadowMaterial.dispose(); this.shadowParent = null;
  }
}
