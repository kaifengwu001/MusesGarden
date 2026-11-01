import { DoubleSide, FrontSide, InstancedBufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4, type InstancedBufferGeometry, type IUniform } from 'three';
import { Terrain, type Layout } from '../planet/terrain';
import { hash32, mix, salt, unit } from '../../../src/core/hash';
import { uvToSphere } from '../../../src/planet/cubesphere';
import type { RestPoint } from '../../../src/planet/rest';
import { SCATTER_STRIDE, ScatterLayer, type ScatterClassifier, type ScatterLook, type ScatterView } from './scatter';
import { CLUSTERS, type FieldParams } from '../planet/fields';
import { KIT, KIT_KINDS, KIT_MESH, REED_HEIGHT, type KitKind } from './landmarkMeshes';
import fragmentShader from './landmark.frag.glsl?raw';
import vertexShader from './landmark.vert.glsl?raw';

// Slate seams and three orchard plant families, grounded in local meters.
//   home    a composed foreground and sheltered planting beside the home,
//           with deliberate open routes and native-animal pockets
//   seeded  everywhere else, in the habitat's clusters (fields.ts): a
//           rest-space point set (so each stone keeps its direction and its
//           size in meters as the planet grows, and new ones fade in by
//           their birth radius), streamed in tiles around the camera by the
//           shared ScatterLayer, one pool per kit kind, as far out as a
//           sail-reed stays a few pixels tall
// Each instance is grounded in the shader on the ground it stands on
// (landmark.vert.glsl).

export interface LandmarkInstance {
  readonly kind: KitKind;
  /** Shelter-local position (m), turn about the vertical (rad), size factor. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** 0..1, and (sail-reeds) how many of its lance leaves the clump shows, 3–5. */
  readonly seed: number;
  readonly leaves: number;
}

/** A starflower group: shelter-local centre (m), radius (m) and flowers per m² (flowers.ts and the paint both read them). */
export interface StarGroup {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly density: number;
}

/** Broken outcrops sit inside the planted bank, not at the centres of repeated circular pots. */
export const COMPOSITION_GROUPS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  // x, z, half width, half depth, stones, retained review weight
  [-10.4, 12.1, 3.3, 2.4, 7, 9],
  [-6.7, 4.1, 2.7, 2.1, 5, 7],
  [-12.6, 7.0, 2.7, 1.9, 5, 6],
  [-5.1, -4.8, 2.6, 2.2, 4, 6],
  [8.6, 7.3, 2.3, 2.1, 4, 4],
  [5.5, 13.7, 2.0, 1.7, 3, 3],
  [6.5, -9.0, 2.4, 1.8, 3, 3],
];

interface AuthoredBed {
  readonly polygon: ReadonlyArray<readonly [number, number]>;
  readonly low: number;
  readonly crowns: number;
  readonly young: number;
}

/** The dominant connected left bank, a shelter tributary and two smaller irregular rims. */
export const PLANT_BEDS: readonly AuthoredBed[] = [
  { polygon: [[-15, 3], [-10, 1], [-6, 2.5], [-4, 7], [-5.5, 11], [-4.5, 18.5], [-8, 20], [-12.5, 16], [-15.2, 9]], low: 220, crowns: 18, young: 18 },
  { polygon: [[-10, -8.5], [-4.5, -8.5], [-3.4, -4], [-3.7, 0.5], [-6, 3], [-10.5, -1]], low: 70, crowns: 8, young: 6 },
  { polygon: [[4, 3.5], [8.5, 2.5], [11, 7], [8.7, 13], [5.8, 15.5], [3.5, 11], [4.5, 8]], low: 75, crowns: 8, young: 6 },
  { polygon: [[4, -11], [8.8, -12.5], [11, -9], [7, -4.5], [4, -5.5]], low: 20, crowns: 4, young: 2 },
];

/** Native fauna rest in these open sand pockets; vegetation must not occupy them. */
const FAUNA_POCKETS: ReadonlyArray<readonly [number, number]> = [[-4.6, 5.6], [5.4, 9.8], [-8, 13]];
/** Keep the front route broad and slightly bend its far end toward the dune opening. */
export function orchardClear(x: number, z: number): boolean {
  if (Math.abs(x) < 2.35 && z > -2.8 && z < 23) return true;
  if (Math.abs(x) < 3.2 && Math.abs(z) < 2.8) return true;
  return FAUNA_POCKETS.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.0);
}

/** Stones retain a consistent geological scale instead of unrelated swollen boulders. */
const ROCK_SCALE = [0.8, 1.1] as const;

function random(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32(mix(s, 0x9e3779b9))));
}

/** A connected low planting bank with sparse airy crowns and an open, asymmetric sand corridor. */
export function homePatch(): LandmarkInstance[] {
  const out: LandmarkInstance[] = [];
  const rand = random(0x5ad1);
  const stoneFeet: Array<{ x: number; z: number; yaw: number; halfX: number; halfZ: number }> = [];
  const overStone = (x: number, z: number): boolean => stoneFeet.some((stone) => {
    const dx = x - stone.x;
    const dz = z - stone.z;
    const c = Math.cos(stone.yaw);
    const sn = Math.sin(stone.yaw);
    return Math.abs(dx * c - dz * sn) < stone.halfX && Math.abs(dx * sn + dz * c) < stone.halfZ;
  });
  const add = (kind: KitKind, x: number, z: number, scale: number, yaw: number): boolean => {
    if (orchardClear(x, z)) return false;
    const rock = !isPlant(kind);
    const footprint = rock ? Math.hypot(KIT[kind][0], KIT[kind][1]) * scale * 0.5 : 0.25;
    if (rock && Math.abs(x) < 2.35 + footprint && z > -2.8 - footprint && z < 23 + footprint) return false;
    if (rock && Math.abs(x) < 3.2 + footprint && Math.abs(z) < 2.8 + footprint) return false;
    if (FAUNA_POCKETS.some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.9 + footprint)) return false;
    if (!rock && overStone(x, z)) return false;
    out.push({ kind, x, z, yaw, scale, seed: rand(), leaves: kind === 'reed' ? 3 + Math.floor(rand() * 3) : 0 });
    if (rock) stoneFeet.push({ x, z, yaw, halfX: KIT[kind][0] * scale * 0.32, halfZ: KIT[kind][1] * scale * 0.30 });
    return true;
  };
  const clustered = (): number => (rand() + rand() + rand() - 1.5) / 1.5;
  for (const [cx, cz, rx, rz, stones] of COMPOSITION_GROUPS) {
    const heading = rand() * Math.PI * 2;
    for (let k = 0; k < stones; k++) {
      const x = cx + clustered() * rx;
      const z = cz + clustered() * rz;
      add(k === 0 || k % 3 === 0 ? 'slab' : 'block', x, z, k === 0 ? 1.2 + rand() * 0.2 : 0.72 + rand() * 0.48, heading + (rand() - 0.5) * 1.7);
    }
    for (let k = 0; k < stones + 2; k++) {
      const a = rand() * Math.PI * 2;
      const r = 0.55 + rand() * 0.65;
      add('wedge', cx + Math.cos(a) * rx * r, cz + Math.sin(a) * rz * r, 0.65 + rand() * 0.65, rand() * Math.PI * 2);
    }
  }
  const contains = (polygon: AuthoredBed['polygon'], x: number, z: number): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[i];
      const [bx, bz] = polygon[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  };
  PLANT_BEDS.forEach((bed, index) => {
    const xs = bed.polygon.map(([x]) => x);
    const zs = bed.polygon.map(([, z]) => z);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const fill = (number: number, mode: 'low' | 'young' | 'crown'): void => {
      let placed = 0;
      for (let attempt = 0; attempt < number * 120 && placed < number; attempt++) {
        const x = x0 + rand() * (x1 - x0);
        const z = z0 + rand() * (z1 - z0);
        if (!contains(bed.polygon, x, z)) continue;
        // Broad irregular patches rather than points on circular planter rims.
        const shelter = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.83 + index) * Math.sin(z * 0.57 - index));
        if (rand() > shelter) continue;
        const kind: KitKind = mode === 'low' ? (rand() < 0.31 ? 'comb' : 'tussock') : 'reed';
        const scale = mode === 'crown' ? (REED_HEIGHT[0] + (REED_HEIGHT[1] - REED_HEIGHT[0]) * rand()) / KIT.reed[2] : mode === 'young' ? 0.31 + rand() * 0.19 : kind === 'comb' ? 0.52 + rand() * 0.40 : 0.55 + rand() * 0.48;
        if (add(kind, x, z, scale, rand() * Math.PI * 2)) placed++;
      }
    };
    fill(bed.low, 'low');
    fill(bed.young, 'young');
    fill(bed.crowns, 'crown');
  });
  return out;
}

/** Ivory flowers are accents in ten sheltered pockets, never a uniform carpet. */
export function starGroups(): StarGroup[] {
  return COMPOSITION_GROUPS.map(([x, z, rx], i) => ({ x: x + (i % 2 ? -0.8 : 0.8), z: z + 0.9, radius: Math.min(2.6, rx * 0.7), density: 2.4 }));
}

/** Most starflower groups (uniform array size in GLSL: MAX_STAR_GROUPS). */
export const MAX_STAR_GROUPS = 12;

/** Where an instance stands on the planet, as landmark.vert.glsl sets it: its anchor, the ground at its footprint's corners and centre, and its base height (m). */
export interface Footing {
  readonly anchor: Vector3;
  readonly centre: number;
  /** Ground at the footprint's +x, −x, +z, −z edges (slate), or [] (sail-reed). */
  readonly corners: number[];
  readonly base: number;
}

/**
 * The CPU mirror of landmark.vert.glsl's grounding (near the camera, where
 * the distance sink is nil): the anchor bent round the planet as the props
 * are; a slate on the mean of its centre and lowest edge, sunk 6 % of its
 * height; a sail-reed 4 cm into the sand.
 */
export function landmarkFooting(terrain: Terrain, inst: LandmarkInstance): Footing {
  const L = terrain.layout;
  const R = terrain.radius;
  const X = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
  const Z = new Vector3().crossVectors(X, L.cottage);
  const d = Math.hypot(inst.x, inst.z);
  const anchor = L.cottage.clone();
  if (d > 1e-5) {
    const a = Math.asin(Math.min(d / R, 1));
    const T = X.clone().multiplyScalar(inst.x / d).addScaledVector(Z, inst.z / d);
    anchor.multiplyScalar(Math.cos(a)).addScaledVector(T, Math.sin(a)).normalize();
  }
  const centre = terrain.height0(anchor);
  if (isPlant(inst.kind)) return { anchor, centre, corners: [], base: centre - 0.04 };
  const x0 = X.clone().addScaledVector(anchor, -X.dot(anchor)).normalize();
  const z0 = new Vector3().crossVectors(x0, anchor);
  const c = Math.cos(inst.yaw);
  const s = Math.sin(inst.yaw);
  const side = x0.clone().multiplyScalar(c).addScaledVector(z0, -s);
  const fwd = x0.clone().multiplyScalar(s).addScaledVector(z0, c);
  const [w, dd, h] = KIT[inst.kind];
  const hx = (w / 2) * inst.scale;
  const hz = (dd / 2) * inst.scale;
  const at = (v: Vector3, k: number): number => terrain.height0(anchor.clone().addScaledVector(v, k / R).normalize());
  const corners = [at(side, hx), at(side, -hx), at(fwd, hz), at(fwd, -hz)];
  const base = (centre + Math.min(...corners)) / 2 - 0.06 * h * inst.scale;
  return { anchor, centre, corners, base };
}

/** Per kit kind: slate (0) or reed (1), the footprint's half sizes (m) and the height (m), for the shader. */
function isPlant(kind: KitKind): boolean {
  return kind === 'reed' || kind === 'comb' || kind === 'tussock';
}

function kitUniform(kind: KitKind): Vector4 {
  const [w, d, h] = KIT[kind];
  return new Vector4(isPlant(kind) ? 1 : 0, w / 2, d / 2, h);
}

/** Maximum scaled kit extent plus the largest displacement used by landmark.vert.glsl at wind=1. */
export const LANDMARK_REACH = Math.max(...KIT_KINDS.map((kind) => {
  const [w, d, h] = KIT[kind];
  const scale = kind === 'reed' ? REED_HEIGHT[1] / h : isPlant(kind) ? 1.25 : 1.4;
  const geometry = Math.hypot(w / 2, d / 2, h) * scale;
  const motion = isPlant(kind) ? (0.05 + 0.18 + 0.02) * h * scale : 0;
  return geometry + motion;
}));

/** Seeded landmarks: their density (per m²) at the heart of a cluster, how far round the shelter the home patch keeps them out (m), the steepest ground they stand on, and each kind's share. */
export const SEEDED = { peak: 0.20, homeClear: 19, slope: 0.42 } as const;
const KIND_SHARE: ReadonlyArray<readonly [KitKind, number]> = [
  ['reed', 0.27],
  ['comb', 0.20],
  ['tussock', 0.23],
  ['slab', 0.12],
  ['block', 0.08],
  ['wedge', 0.10],
];
/** Per instance: the standard five floats, then size factor, lance leaves shown, -. */
const STRIDE = SCATTER_STRIDE + 3;
/** Field samples per tile side (bilinear in between), and R's quantisation for classifying (4 % steps). */
const GRID = 4;
const LN_R_STEP = 0.04;
/** A sail-reed stays drawn while at least this many pixels tall (the layer reaches as far), but never beyond REACH_MAX (m). */
const REACH_PIXELS = 1.2;
const REACH_MAX = 260;

interface LandmarkTile {
  level: number;
  i: number;
  j: number;
}

export class LandmarkClassifier implements ScatterClassifier<LandmarkTile> {
  version = '';
  private terrain: Terrain | null = null;
  private layout: Layout | null = null;
  private lnR = Number.NaN;
  private paramsKey = '';
  private readonly dir = new Vector3();
  private readonly across = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly q = new Vector3();

  /** The mean density over the planet the layer is told (per m²): the peak over the clusters' share of the habitat's share. */
  get mean(): number {
    return SEEDED.peak * CLUSTERS.cover * 0.3;
  }

  set(layout: Layout, radius: number, params: FieldParams, paramsKey: string): void {
    const lnR = Math.round(Math.log(radius) / LN_R_STEP) * LN_R_STEP;
    if (layout === this.layout && lnR === this.lnR && paramsKey === this.paramsKey) return;
    if (layout !== this.layout || !this.terrain) {
      this.layout = layout;
      this.terrain = new Terrain(layout);
    }
    // Queued tile jobs see this quantised snapshot, never the continuously updated live terrain.
    this.terrain.update(Math.exp(lnR), params, 1);
    this.lnR = lnR;
    this.paramsKey = paramsKey;
    this.version = `${layout.seed}/${lnR.toFixed(3)}/${paramsKey}`;
  }

  /** Match Terrain.maxHeight while classification is quantised during growth. */
  get maxGroundHeight(): number {
    return Math.max(0, this.terrain?.maxHeight ?? 0);
  }

  /** The clusters' density at dir (per m²). */
  density(dir: Vector3): number {
    const f = this.terrain!.fields;
    return SEEDED.peak * f.clusters(dir, f.habitat(dir));
  }

  prepare(face: number, level: number, i: number, j: number): { state: LandmarkTile; boost: number } {
    const n = 2 ** level;
    const f = this.terrain!.fields;
    let habitat = 0;
    for (let gy = 0; gy < GRID && habitat <= 0; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        uvToSphere(face, (i + gx / (GRID - 1)) / n, (j + gy / (GRID - 1)) / n, this.dir);
        habitat = Math.max(habitat, f.habitat(this.dir));
      }
    }
    // a tile with any habitat may hold a cluster's heart (clusters are smaller than a tile): bound it by the peak; one without, by nothing
    return { state: { level, i, j }, boost: (habitat > 0 ? SEEDED.peak : 0) / this.mean };
  }

  classify(_tile: LandmarkTile, p: RestPoint, sigma: number, record: Float32Array, o: number): number {
    const dir = this.dir.set(record[o], record[o + 1], record[o + 2]);
    // a point that would not be born even at the peak is done with first
    if ((p.threshold * this.mean) / SEEDED.peak > sigma) return -1;
    const total = this.density(dir);
    if (total <= 1e-6) return -1;
    const local = (p.threshold * this.mean) / total;
    if (local > sigma) return -1;
    // not in the home patch (the brief lays that out itself) or on steep ground
    if (this.nearHome(dir) || this.steep(dir)) return -1;
    record[o + 3] = Math.log(local);
    const h = hash32(p.seed ^ 0x4c1d2e3f);
    let pick = unit(h);
    let channel = 0;
    for (; channel < KIND_SHARE.length - 1; channel++) {
      pick -= KIND_SHARE[channel][1];
      if (pick < 0) break;
    }
    const kind = KIND_SHARE[channel][0];
    const r = unit(hash32(h ^ 0x9e3779b9));
    record[o + 5] = kind === 'reed' ? (REED_HEIGHT[0] + (REED_HEIGHT[1] - REED_HEIGHT[0]) * r) / KIT.reed[2] : isPlant(kind) ? 0.75 + 0.5 * r : ROCK_SCALE[0] + (ROCK_SCALE[1] - ROCK_SCALE[0]) * r;
    record[o + 6] = kind === 'reed' ? 3 + Math.floor(unit(hash32(h ^ 0x51ed27)) * 3) : 0;
    record[o + 7] = 0;
    return KIT_KINDS.indexOf(kind);
  }

  private get radius(): number {
    return Math.exp(this.lnR);
  }

  /** Inside the home patch's square, in shelter-local meters. */
  private nearHome(dir: Vector3): boolean {
    const L = this.layout!;
    if (Math.acos(Math.min(1, dir.dot(L.cottage))) * this.radius > SEEDED.homeClear * 1.5) return false;
    this.across.crossVectors(L.cottage, L.homeBearing);
    this.q.subVectors(dir, L.cottage);
    const x = this.q.dot(this.across) * this.radius;
    const z = this.q.dot(L.homeBearing) * this.radius;
    return Math.max(Math.abs(x), Math.abs(z)) < SEEDED.homeClear;
  }

  /** Steeper than a stone or clump can stand on, including authored dunes and home shaping. */
  private steep(dir: Vector3): boolean {
    const terrain = this.terrain!;
    const e = 1 / this.radius;
    this.a.crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : X_AXIS).normalize();
    this.b.crossVectors(dir, this.a);
    const ha = terrain.height0(this.q.copy(dir).addScaledVector(this.a, e).normalize()) - terrain.height0(this.q.copy(dir).addScaledVector(this.a, -e).normalize());
    const hb = terrain.height0(this.q.copy(dir).addScaledVector(this.b, e).normalize()) - terrain.height0(this.q.copy(dir).addScaledVector(this.b, -e).normalize());
    return Math.hypot(ha, hb) / 2 > SEEDED.slope;
  }
}

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

/** How far (m) the seeded layer reaches from the focus: as far as a tall sail-reed stays a pixel or two tall, out of the camera's height. */
export function landmarkReach(altitude: number, pixelAngle: number): number {
  const far = Math.min(REACH_MAX, REED_HEIGHT[1] / (REACH_PIXELS * Math.max(pixelAngle, 1e-5)));
  return far > altitude ? Math.sqrt(far * far - altitude * altitude) : 0;
}

export class Landmarks {
  readonly meshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  readonly instances: readonly LandmarkInstance[];
  /** The seeded stones and clumps: one pool per kit kind (KIT_KINDS order). */
  readonly layer: ScatterLayer;
  readonly classifier = new LandmarkClassifier();
  /** The seeded layer's meshes, one per kit kind (KIT_KINDS order). */
  readonly seededMeshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  private readonly lnDensity = { value: 0 };
  private groundBound = 0;

  constructor(shared: Record<string, IUniform>) {
    this.instances = homePatch();
    this.layer = new ScatterLayer({
      name: 'landmarks',
      boundPadding: () => this.groundBound + LANDMARK_REACH,
      cls: { salt: salt('landmarks'), jitter: 0.9 },
      tileMeters: 40,
      pageSize: 32,
      pages: 640,
      headroom: 1.25,
      stride: STRIDE,
      channels: KIT_KINDS.length,
    });
    KIT_KINDS.forEach((kind, channel) => {
      const geometry = KIT_MESH[kind]();
      geometry.instanceCount = 0;
      const material = new ShaderMaterial({
        name: `landmarks ${kind} (seeded)`,
        vertexShader,
        fragmentShader,
        uniforms: {
          ...shared,
          uKit: { value: kitUniform(kind) },
          uPageSize: { value: 32 },
          uPool: { value: this.layer.mainTextures[channel] },
          uPoolRest: { value: this.layer.restTextures[channel] },
          uPageList: { value: this.layer.listTextures[channel] },
          uLnDensity: this.lnDensity,
        },
        defines: { SEEDED: 1 },
        side: isPlant(kind) ? DoubleSide : FrontSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.seededMeshes.push(mesh);
      this.meshes.push(mesh);
    });
    for (const kind of KIT_KINDS) {
      const geometry = KIT_MESH[kind]();
      const mine = this.instances.filter((i) => i.kind === kind);
      const home = new Float32Array(mine.length * 4);
      const seed = new Float32Array(mine.length * 2);
      mine.forEach((inst, k) => {
        home.set([inst.x, inst.z, inst.yaw, inst.scale], k * 4);
        seed.set([inst.seed, inst.leaves], k * 2);
      });
      geometry.setAttribute('aHome', new InstancedBufferAttribute(home, 4));
      geometry.setAttribute('aSeed', new InstancedBufferAttribute(seed, 2));
      geometry.instanceCount = mine.length;
      const material = new ShaderMaterial({
        name: `landmarks ${kind}`,
        vertexShader,
        fragmentShader,
        uniforms: { ...shared, uKit: { value: kitUniform(kind) } },
        side: isPlant(kind) ? DoubleSide : FrontSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
    }
  }

  /** Stream the seeded stones and clumps for this view. */
  update(view: Omit<ScatterView, 'falloff' | 'classifier' | 'density' | 'ahead'> & { ahead?: Omit<ScatterLook, 'falloff'>; heightAbove?: number }, layout: Layout, params: FieldParams, paramsKey: string): void {
    this.classifier.set(layout, view.radius, params, paramsKey);
    this.groundBound = Math.max(0, view.heightAbove ?? this.classifier.maxGroundHeight);
    const all = (): number => 1;
    const { ahead } = view;
    this.layer.update({ ...view, density: this.classifier.mean, falloff: all, classifier: this.classifier, ahead: ahead && { ...ahead, falloff: all } });
    this.lnDensity.value = Math.log(this.classifier.mean);
    this.seededMeshes.forEach((mesh, c) => {
      mesh.geometry.instanceCount = this.layer.instanceCounts[c];
      mesh.visible = view.near > 0.5 && mesh.geometry.instanceCount > 0;
    });
  }

  /** Vertices submitted a frame (perf stats). */
  get vertices(): number {
    return this.meshes.reduce((n, m) => n + (m.visible ? m.geometry.getAttribute('position').count * m.geometry.instanceCount : 0), 0);
  }
}
