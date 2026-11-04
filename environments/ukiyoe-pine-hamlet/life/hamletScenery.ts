import { AdditiveBlending, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments, Mesh, ShaderMaterial, Sphere, Vector3, type BufferGeometry, type Frustum, type IUniform, type Object3D } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { gnoise } from '../../../src/planet/noise';
import { warpPoint, type WarpFrame } from '../../../src/render/warp';
import { NOISE_STD, normalQuantile } from '../planet/fields';
import { BANK, createGroundSample, type Terrain } from '../planet/terrain';
import { barleyGeometry, createHamletAssets, createWoodsAssets, grassGeometry, type HamletAsset, type HamletSpecies } from './hamletGeometry';
import vertexShader from './hamletScenery.vert.glsl?raw';
import fragmentShader from './hamletScenery.frag.glsl?raw';

/**
 * direction: on the planet, or (local) cottage-local meters; offset: meters
 * from `direction` across its tangent frame, so a stand keeps its size as R
 * grows; away: shown only as far from the home as WOODS.near … full lets it.
 */
interface Anchor { direction: Vector3; local?: readonly [number, number]; offset?: readonly [number, number]; away?: number; scale: number; turn: number; phase: number; tint: number; }
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
  /** The woods' batches draw only what is in sight (HamletScenery.cull): every tree placed, and its bounds (centre, radius). */
  placed?: { count: number; anchor: Float32Array; across: Float32Array; placement: Float32Array; bounds: Float32Array; drawn: Int32Array; shown: number };
}
export interface HamletClearing { direction: Vector3; radius: number; }
/** Cottage-local cultivated patches. The gaps between beds remain usable paths. */
export const CULTIVATED_BEDS = [
  { x: -4.35, z: 5.95, width: 3.2, length: 1.65, rows: 5, plants: 4 },
  { x: -4.55, z: 14.5, width: 3.5, length: 4.4, rows: 6, plants: 10 },
  { x: 6.65, z: 1.6, width: 1.65, length: 4.6, rows: 3, plants: 10 },
] as const;
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0), EAST = new Vector3(1, 0, 0);
/**
 * The woods beyond the hamlet: stand centres over the globe (Fibonacci,
 * jittered), where a seeded woodland field (direction space: `frequency`,
 * the share of stands in it `cover`) grows close stands of pine or cedar,
 * thinner ones at its edges and a lone tree now and then in the open, so
 * from orbit the planet reads wooded between its snowfields and lakes. None
 * nearer the cottage than `near` m, all of them beyond `full`: the hamlet's
 * own trees stay as they were laid out. Their sizes are drawn about `size.mean`
 * and spread `size.spread` times as far from it (none smaller than
 * `size.least`): old giants among saplings, a spread 1.75 times that of the
 * draws themselves.
 */
const WOODS = { stands: 322, near: 40, full: 56, frequency: 2.6, cover: 0.55, spacing: 2.8, size: { mean: 0.97, spread: 1.85, least: 0.3 } } as const;

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

  /** Actual instantiated colour geometry, for performance validation (the woods as far as they are in sight). Lines are separate. */
  get triangleCount(): number {
    return this.batches.reduce((sum, b) => sum + triangles(b.mesh.geometry) * b.mesh.geometry.instanceCount, 0);
  }

  /** The hamlet's own scenery, drawn whatever the view. */
  get hamletTriangleCount(): number {
    return this.batches.reduce((sum, b) => sum + (b.placed ? 0 : triangles(b.mesh.geometry) * b.mesh.geometry.instanceCount), 0);
  }

  /** The woods with every tree placed, in sight or not (only those in sight are drawn: cull). */
  get woodsTriangleCount(): number {
    return this.batches.reduce((sum, b) => sum + (b.placed ? triangles(b.mesh.geometry) * b.placed.count : 0), 0);
  }

  /** Local trees and bank stones cast into the existing sphere shadow map.
   * Remote forest templates omit this extra pass to bound its vertex cost. */
  get shadowMeshes(): Mesh<InstancedBufferGeometry, ShaderMaterial>[] {
    return this.batches.flatMap(b => b.shadow ? [b.shadow] : []);
  }

  /** distant: no shadow pass; woods: drawn only where in sight (cull). */
  private addBatch(kind: HamletSpecies, asset: HamletAsset, anchors: Anchor[], distant = false, woods = false): void {
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
    // (the templates are built a triangle at a time; shared corners are merged into one vertex, so each is shaded once)
    const mesh = new Mesh(instantiate(asset.geometry.index ? asset.geometry : mergeVertices(asset.geometry, 1e-7)), this.material);
    const ink = new LineSegments(instantiate(asset.ink), this.inkMaterial);
    const shadow = distant ? undefined : new Mesh(mesh.geometry, this.shadowMaterial);
    if (shadow) {
      shadow.frustumCulled = false;
      shadow.name = `Hamlet ${kind} shadow`;
      this.shadowParent?.add(shadow);
    }
    mesh.name = `Hamlet ${kind}${woods ? ' woods' : distant ? ' distant' : ''}`;
    ink.name = `Hamlet ${kind} selected contours`;
    mesh.frustumCulled = false; ink.frustumCulled = false;
    ink.renderOrder = 1;
    this.group.add(mesh, ink);
    const n = anchors.length;
    const placed = woods ? { count: 0, anchor: new Float32Array(n * 4), across: new Float32Array(n * 3), placement: new Float32Array(n * 4), bounds: new Float32Array(n * 4), drawn: new Int32Array(n), shown: -1 } : undefined;
    this.batches.push({ kind, asset, mesh, ink, shadow, anchors, anchorData, acrossData, placementData, placed });
  }

  private rebuild(terrain: Terrain): void {
    this.releaseBatches();
    this.seed = terrain.layout.seed;
    let state = hash32(this.seed ^ 0x9d243c);
    const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
    const anchors: Record<HamletSpecies, Anchor[]> = { pine: [], cedar: [], plum: [], reeds: [], rock: [] };
    const distant: Record<'pine' | 'cedar', Anchor[]> = { pine: [], cedar: [] };
    const woods: Record<'pine' | 'cedar', Anchor[]> = { pine: [], cedar: [] };
    const grass: Anchor[] = [];
    const local = (kind: HamletSpecies, x: number, z: number, scale: number, turn = rand() * TAU, tint = rand()): void => {
      anchors[kind].push({ direction: new Vector3(), local: [x, z], scale, turn, phase: rand() * TAU, tint });
    };
    // Left framing pine, open doorway and central approach. Pines stay broad;
    // the slender cedars establish a separate distant layer behind the roof.
    for (const [x, z, scale, turn] of [[-9, -3, 1.27, -0.35], [-13, -7, 0.58, 0.65], [-15, 4, 0.82, -0.5], [8, -9, 1.04, 1.1], [-20, -13, 0.49, 0.2], [22, 1, 0.95, 2.3], [24, 25, 0.62, -0.4], [-15, 23, 0.38, 0.4]]) local('pine', x, z, scale, turn);
    for (const [x, z, scale] of [[-17, -14, 0.65], [-10, -15, 1.16], [-7, -13, 0.47], [1, -21, 0.92], [7, -18, 0.60], [13, -15, 1.23], [16, -12, 0.55], [25, 0, 0.72], [26, 28, 0.41]]) local('cedar', x, z, scale);
    for (const [x, z, scale] of [[-6.6, 2.5, 0.76], [-10, 6, 0.84], [-12, 15, 0.81], [6.7, -4, 0.72], [19, 3, 0.78], [22, 19, 0.77], [1, -11, 0.72], [-19, 27, 0.72]]) local('plum', x, z, scale);
    // Unequal groves leave visible openings between them. A few young trees
    // grow beside the framing pine; the background is no longer two even rows.
    for (const [x, z, scale] of [[-13.6, -2, 0.42], [-12.4, 1.4, 0.54], [20, -1.8, 0.38], [27, 22.5, 0.46]]) {
      distant.pine.push({ direction: new Vector3(), local: [x, z], scale, turn: rand() * TAU, phase: rand() * TAU, tint: rand() });
    }
    for (const [cx, cz, count, spread] of [[-26, -26, 5, 6], [-12, -32, 7, 8], [11, -34, 4, 5], [29, -28, 6, 7]]) {
      for (let i = 0; i < count; i++) {
        const angle = i * 2.3999632297 + rand() * 0.45;
        const radius = i ? Math.sqrt(i / count) * spread : 0;
        const kind = i % 3 === 0 ? 'pine' : 'cedar';
        distant[kind].push({ direction: new Vector3(), local: [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius * 0.7],
          scale: i ? 0.38 + rand() * 0.63 : 1.08 + rand() * 0.25, turn: rand() * TAU, phase: rand() * TAU, tint: rand() });
      }
    }
    // Barley-like seed grass in tidy, densely planted rows beside the home.
    // Small within-row offsets keep the plants alive without hiding cultivation.
    for (const bed of CULTIVATED_BEDS) {
      for (let row = 0; row < bed.rows; row++) for (let plant = 0; plant < bed.plants; plant++) {
        const x = bed.x + (row / (bed.rows - 1) - 0.5) * bed.width + (rand() - 0.5) * 0.07;
        const z = bed.z + (plant / (bed.plants - 1) - 0.5) * bed.length + (rand() - 0.5) * 0.09;
        local('reeds', x, z, 0.56 + rand() * 0.32, 0.14 + (rand() - 0.5) * 0.5, -2);
      }
      for (let i = 0; i < 28; i++) {
        const side = i % 4, t = rand() - 0.5;
        const x = bed.x + (side < 2 ? (side ? 1 : -1) * (bed.width * 0.5 + 0.38) : t * (bed.width + 0.8));
        const z = bed.z + (side < 2 ? t * (bed.length + 0.8) : (side === 2 ? -1 : 1) * (bed.length * 0.5 + 0.35));
        grass.push({ direction: new Vector3(), local: [x, z], scale: 0.62 + rand() * 0.52, turn: rand() * TAU, phase: rand() * TAU, tint: -1 });
      }
    }
    // Loose grass patches connect the tended beds to the path and bank. Clumps
    // vary in scale and density, with bare gaps around stones and walking lanes.
    for (const [cx, cz, count, spread] of [[-3, 20, 22, 2.4], [-8, 3.7, 18, 1.8], [-10.5, 12.5, 25, 2.5], [7.7, 5.5, 18, 1.2], [-2.9, 27, 20, 2.0], [7.5, -5.5, 18, 1.8]]) {
      for (let i = 0; i < count; i++) {
        const angle = rand() * TAU, radius = Math.sqrt(rand()) * spread;
        grass.push({ direction: new Vector3(), local: [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius],
          scale: 0.55 + rand() * 0.8, turn: rand() * TAU, phase: rand() * TAU, tint: -1 });
      }
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

    // The woods beyond the hamlet (WOODS): stands on a jittered Fibonacci
    // lattice, as dense as the woodland field is there. Sampling filters water
    // and slopes; the random stream never changes each frame.
    const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const right = new Vector3().crossVectors(home, forward).normalize();
    const woodSeed = hash32(this.seed ^ 0x51ed27);
    const field = (d: Vector3, f: number, seed: number): number => gnoise(d.x * f, d.y * f, d.z * f, seed >>> 0);
    const woodland = (d: Vector3): number => 0.75 * field(d, WOODS.frequency, woodSeed) + 0.25 * field(d, WOODS.frequency * 2.3, woodSeed + 1);
    const threshold = NOISE_STD * Math.hypot(0.75, 0.25) * normalQuantile(1 - WOODS.cover);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < WOODS.stands; i++) {
      const y = 1 - 2 * (i + 0.25 + 0.5 * rand()) / WOODS.stands, a = (i + 0.3 * (rand() - 0.5)) * golden + this.seed * 0.001;
      const r = Math.sqrt(1 - y * y);
      const centre = home.clone().multiplyScalar(y).addScaledVector(right, Math.cos(a) * r).addScaledVector(forward, Math.sin(a) * r).normalize();
      const at = (kind: HamletSpecies, x: number, z: number, scale: number): void => {
        const target = kind === 'pine' || kind === 'cedar' ? woods[kind] : anchors[kind];
        target.push({ direction: centre, offset: [x, z], away: rand(), scale, turn: rand() * TAU, phase: rand() * TAU, tint: rand() });
      };
      // close stands deep in the woods, thinner ones at their edges, now and then a lone tree in the open
      const wood = smoothstep(threshold - 0.05, threshold + 0.1, woodland(centre));
      const trees = wood > 0.6 ? 5 + Math.floor(rand() * 5) : wood > 0.15 ? 1 + Math.floor(rand() * 3) : rand() < 0.12 ? 1 : 0;
      // a stand is mostly one kind: cedar groves, pine groves, a few of the other among them
      const cedars = field(centre, 3.7, woodSeed + 2) > 0.06;
      const turn = rand() * TAU;
      for (let k = 0; k < trees; k++) {
        const angle = turn + k * golden;
        const spread = k ? WOODS.spacing * Math.sqrt(k) * (0.85 + 0.3 * rand()) : rand() * 1.5;
        const drawn = k === 0 ? 1.1 + rand() * 0.5 : rand() < 0.25 ? 0.45 + rand() * 0.25 : 0.72 + rand() * 0.58;
        const scale = Math.max(WOODS.size.least, WOODS.size.mean + WOODS.size.spread * (drawn - WOODS.size.mean));
        at(cedars !== (rand() < 0.2) ? 'cedar' : 'pine', Math.cos(angle) * spread, Math.sin(angle) * spread, scale);
      }
      // slate showing through the snow, reeds at the wet edges, a plum in the open
      if (rand() < 0.24) at('rock', (rand() - 0.5) * 9, (rand() - 0.5) * 9, 0.55 + rand() * 0.45);
      if (rand() < 0.12) at('reeds', (rand() - 0.5) * 8, (rand() - 0.5) * 8, 0.7 + rand() * 0.35);
      if (wood < 0.4 && rand() < 0.05) at('plum', (rand() - 0.5) * 6, (rand() - 0.5) * 6, 0.72 + rand() * 0.25);
    }
    const assets = createHamletAssets();
    for (const kind of Object.keys(anchors) as HamletSpecies[]) {
      this.addBatch(kind, assets[kind], kind === 'reeds' ? anchors.reeds.filter(anchor => anchor.tint !== -2) : anchors[kind]);
    }
    this.addBatch('reeds', barleyGeometry(), anchors.reeds.filter(anchor => anchor.tint === -2));
    this.addBatch('reeds', grassGeometry(), grass);
    const remote = createHamletAssets(true);
    this.addBatch('pine', remote.pine, distant.pine, true);
    this.addBatch('cedar', remote.cedar, distant.cedar, true);
    for (const kind of ['plum', 'reeds', 'rock'] as const) { remote[kind].geometry.dispose(); remote[kind].ink.dispose(); }
    const lean = createWoodsAssets();
    this.addBatch('pine', lean.pine, woods.pine, true, true);
    this.addBatch('cedar', lean.cedar, woods.cedar, true, true);
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
          // Sumi's full courtyard loop has room for the body and crop foliage,
          // not just an empty centre point. Mugi's loop lies in the main reserve.
          if (x > -8.7 - footprint && x < -3.3 + footprint && z > 7.1 - footprint && z < 10.9 + footprint) continue;
        } else {
          direction.copy(anchor.direction);
          if (anchor.offset) {
            across.crossVectors(direction, Math.abs(direction.y) < 0.9 ? UP : EAST).normalize();
            z.crossVectors(across, direction);
            direction.addScaledVector(across, anchor.offset[0] / R).addScaledVector(z, anchor.offset[1] / R).normalize();
          }
          const fromHome = Math.acos(Math.max(-1, Math.min(1, direction.dot(home)))) * R - footprint;
          if (anchor.away === undefined ? fromHome < 37 : smoothstep(WOODS.near, WOODS.full, fromHome) <= anchor.away) continue;
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
        if (anchor.away !== undefined) {
          // The woods are thousands, placed again each frame the planet grows: the stem's own
          // sample stands for its footprint, the shore well beyond it and the rise across it (the
          // ground's height over its distance to the shore is its slope, the bank lip aside).
          supported = this.ground.water > footprint * 1.4;
          maxHeight += 2 * footprint * Math.max(this.ground.height - BANK.height, 0) / this.ground.water;
        } else {
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
      const placed = batch.placed;
      if (placed) {
        placed.count = count;
        placed.anchor.set(batch.anchorData.array.subarray(0, count * 4));
        placed.across.set(batch.acrossData.array.subarray(0, count * 3));
        placed.placement.set(batch.placementData.array.subarray(0, count * 4));
        // a tree's bounds: its template's sphere, scaled, about its stem (it turns about the stem)
        const box = batch.asset.geometry.boundingSphere!;
        const reach = box.radius + Math.hypot(box.center.x, box.center.z);
        for (let i = 0; i < count; i++) {
          const a = placed.anchor, scale = placed.placement[i * 4], up = R + a[i * 4 + 3] + box.center.y * scale;
          placed.bounds.set([a[i * 4] * up, a[i * 4 + 1] * up, a[i * 4 + 2] * up, reach * scale], i * 4);
        }
        placed.shown = -1;
      }
    }
  }

  /**
   * Draw only the woods' trees that can be in sight: in front of the planet's
   * horizon (from orbit, where the true sphere is drawn) and inside the view,
   * as the warp draws them. The instances in sight are packed to the front of
   * the woods' buffers, and uploaded only when that set changes.
   */
  cull(frustum: Frustum, warp: WarpFrame, eye: Vector3): void {
    const R = this.radius;
    const unwarped = Math.abs(warp.k) * R < 0.01;
    const e = eye.length();
    const horizon = Math.acos(Math.min(1, R / e));
    for (const batch of this.batches) {
      const placed = batch.placed;
      if (!placed) continue;
      let shown = 0;
      let changed = false;
      for (let i = 0; i < placed.count; i++) {
        const b = placed.bounds;
        centre.set(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]);
        const radius = b[i * 4 + 3];
        if (unwarped) {
          const p = centre.length();
          const angle = Math.acos(Math.max(-1, Math.min(1, centre.dot(eye) / (p * e))));
          if (angle > horizon + Math.acos(Math.min(1, R / (p + radius))) + radius / R) continue;
        }
        // the warp drops a tree by k·t² (t: its offset from the focus along the ground): it may stretch it a little
        tangent.subVectors(centre, warp.focus);
        tangent.addScaledVector(warp.up, -tangent.dot(warp.up));
        warpPoint(warp, centre, bounds.center);
        bounds.radius = radius * (1.15 + 2 * Math.abs(warp.k) * tangent.length());
        if (!frustum.intersectsSphere(bounds)) continue;
        if (placed.drawn[shown] !== i) changed = true;
        placed.drawn[shown++] = i;
      }
      if (!changed && shown === placed.shown) continue;
      placed.shown = shown;
      const anchor = batch.anchorData.array as Float32Array, across = batch.acrossData.array as Float32Array, placement = batch.placementData.array as Float32Array;
      for (let k = 0; k < shown; k++) {
        const i = placed.drawn[k];
        anchor.set(placed.anchor.subarray(i * 4, i * 4 + 4), k * 4);
        across.set(placed.across.subarray(i * 3, i * 3 + 3), k * 3);
        placement.set(placed.placement.subarray(i * 4, i * 4 + 4), k * 4);
      }
      for (const [attribute, size] of [[batch.anchorData, 4], [batch.acrossData, 3], [batch.placementData, 4]] as const) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, Math.max(shown, 1) * size);
        attribute.needsUpdate = true;
      }
      batch.mesh.geometry.instanceCount = shown;
      batch.ink.geometry.instanceCount = shown;
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

const centre = new Vector3();
const tangent = new Vector3();
const bounds = new Sphere();

function triangles(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}
