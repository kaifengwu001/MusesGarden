import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  PerspectiveCamera,
  Vector2,
  BufferAttribute,
  CustomBlending,
  DataTexture,
  FloatType,
  HalfFloatType,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { hash32, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';
import { unwarpPoint, warpPoint, type WarpFrame } from '../render/warp';
import { fullscreenMesh } from '../render/fullscreen';
import fragmentShader from './cloud.frag.glsl?raw';
import lumpsFragment from './cloudLumpsBake.frag.glsl?raw';
import vertexShader from './cloud.vert.glsl?raw';
import shadowFragment from './cloudShadow.frag.glsl?raw';
import shadowVertex from './cloudShadow.vert.glsl?raw';
import { MASK_CELL, WaterMask } from './waterMask';

// Low cumulus drifting with the wind a few meters above the meadow. Each
// cloud is a heap of PUFFS lumpy spheres over a flat base, written once a
// frame into one data texture (clouds.glsl reads it). The same puffs draw the
// cloud (a billboard each, traced per pixel), cast its shadow (splatted
// into a cube map of optical depth where the shadows reach the ground, down
// the sun each place sees, so shadows stay fixed to the planet) and show in
// the lakes (the billboards drawn again from the camera mirrored in the
// water's level plane under the focus; from orbit, a cube map of the cloud
// cover seen from below), so a cloud, its shadow and its reflection always
// agree. Every cloud casts its shadow and shows in the water; only those
// the ground does not hide from the camera are drawn.
//
// Where the clouds are is weather, not scatter. A flow over the sphere (a few
// vortices spiralling in or out, and bands of wind east and west) is traced
// into evenly spaced streamlines; clouds are strung along them, long axis
// with the flow, heaps overlapping into streaks. A cloudiness field smoothed
// along each streamline decides which stretches hold cloud: where it is high
// across neighbouring lines the streaks merge into broad patches, spiralling
// with the vortices; elsewhere single streaks trail off, and between them the
// sky is clear. Coverage sets how much of the field is cloudy.
//
// Clouds keep a human scale as the planet grows: their size grows with √R,
// the streamlines stay put in direction space, and the clouds along them
// slide closer (more of them) so a streak stays whole. A cloud fades in and
// out with its cloudiness, so nothing pops.

export const MAX_CLOUDS = 512;
const PUFFS = 8;
const HEADER = 3;
/** Texels per cloud: the header, the puffs, then the puffs' self-shadows (four a texel). */
const COLUMNS = HEADER + PUFFS + 2;
/** A cloud's size on an R = 128 m planet (m; the heap is about this tall). */
const SIZE = 15;
/**
 * Streamlines (radians): spacing between neighbours (about a cloud's width at
 * R 128, so neighbouring streaks merge), the closest a line may come to
 * another (× spacing), the tracing step (× spacing) and the length limits.
 */
const STREAM = { sep: 0.17, test: 0.55, step: 0.25, minLength: 0.45, maxLength: 3.4 } as const;
/** Share of the streamline slots that hold a cloud at coverage 0 and 1. */
const SHARE = [0.1, 0.78] as const;
/** The lakes read the clouds from orbit between these camera altitudes (× R): none below, fully above. */
const ORBIT_REFLECTION = [0.35, 0.8] as const;
/** The most the wind's ruffle turns a lake's mirrored ray, per unit of wind strength (rad): water.glsl's 0.06 × (0.2 + a full gust). */
const RUFFLE = 0.072;
/**
 * Each face of the cube maps (the GL cube-map convention, as bake.frag.glsl):
 * a direction's coordinates on it are (across, up) / out.
 */
const FACES = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
].map(([u, v, m]) => new Matrix3().set(u.x, v.x, m.x, u.y, v.y, m.y, u.z, v.z, m.z));
/** Each face's axis (out), and the farthest a direction on the face lies from it (rad, to a corner). */
const FACE_AXES = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
const FACE_REACH = Math.acos(1 / Math.sqrt(3));
/**
 * The sharper window of the shadows about the focus: its half-width (m)
 * grows with the camera's height (from `min`, `perMeter` a meter of height,
 * to `max`) in steps of `step` (the texels stay put between steps); it is
 * drawn only while narrower than `share` of R (wider, and the cube map is
 * nearly as sharp), on the face nearest the focus (kept until another leads
 * by `margin`).
 */
const WINDOW = { min: 70, perMeter: 3, max: 320, step: 1.25, share: 0.6, margin: 0.08 } as const;
/** Cloudiness over the threshold at which a cloud is fully grown. */
const FADE = 0.07;
/**
 * Fair-weather cloudlets in the fringe around the cloudy stretches: how far
 * below the threshold they reach, and the share of fringe slots that hold one.
 */
const FRINGE = { reach: 0.24, share: 0.35 } as const;
/** Puff arrangements to pick from. */
const TEMPLATES = 64;

export interface CloudParams {
  coverage: number;
  /** Height of the cloud bases above the meadow (m, at R = 128). */
  altitude: number;
  speed: number;
  shadow: number;
}

/** Cloud uniforms shared by every material that shows clouds or their shadows. */
export interface CloudUniforms {
  uCloudData: IUniform<DataTexture>;
  /** Optical depth where the shadows reach the water table (direction space). */
  uCloudShadowCube: IUniform<Texture | null>;
  /** The cloud cover seen from below (direction space). */
  uCloudLayerCube: IUniform<Texture | null>;
  /** Shadow strength, optical density (1/m), clouds, -. */
  uCloudLook: IUniform<Vector4>;
  /** Weight of the view from orbit in the lakes, mean height of the clouds (m), -, -. */
  uCloudOrbit: IUniform<Vector4>;
  /** The sharper shadows over a window of one face about the focus, that face, and the window (centre, 1 / half-width, on). */
  uCloudShadowLocal: IUniform<Texture | null>;
  uShadowLocalFace: IUniform<Matrix3>;
  uShadowWindow: IUniform<Vector4>;
  /** The cube face being drawn (the maps above, a face at a time), and the part of it (centre, 1 / half-width). */
  uCubeFace: IUniform<Matrix3>;
  uFaceWindow: IUniform<Vector3>;
  /** The puffs' lumps, baked once (cloudLumps.glsl). */
  uCloudLumps: IUniform<Texture | null>;
  /** The camera (clouds dissolve around it, in the mirror too). */
  uCloudEye: IUniform<Vector3>;
  /** The clouds from the mirrored camera, and its view-projection. */
  uCloudMirror: IUniform<Texture | null>;
  uCloudMirrorVP: IUniform<Matrix4>;
  /** The part of the mirror drawn this frame (uv, the render scale's), and the farthest a lookup may reach in it. */
  uCloudMirrorExtent: IUniform<Vector4>;
}

interface Puff {
  /** Offset × cloud size: x along the cloud, y up from its base, z across. */
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
}

/** A swirl in the weather: the flow circles its centre, spiralling in (inflow > 0) or out. */
interface Vortex {
  centre: Vector3;
  /** Angular radius of the fastest ring (rad). */
  radius: number;
  /** +1 or -1: which way it turns. */
  spin: number;
  /** Angle of the spiral (rad). */
  inflow: number;
  /** Cloudiness it gathers at its core. */
  gather: number;
}

interface Flow {
  vortices: Vortex[];
  /** Axis of the banded east–west winds, how many bands, their strength. */
  zonal: Vector3;
  bands: number;
  strength: number;
}

/** A streamline: points one step apart, the cloudiness along it and its girth. */
interface Line {
  points: Vector3[];
  cloudy: Float32Array;
  girth: Float32Array;
  seed: number;
}

/** A place on a streamline that can hold a cloud (for the current R). */
interface Slot {
  dir: Vector3;
  along: Vector3;
  cloudiness: number;
  /** Size factor: each streak has its own girth, and swells and thins along its length. */
  girth: number;
  seed: number;
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

/** A cumulus heap: a broad base row, a middle heap and a crown, over a flat base at y = 0. */
function makePuffs(rand: () => number): Puff[] {
  const e = 1.05 + 0.5 * rand(); // elongation along the flow
  const puffs: Puff[] = [];
  const add = (x: number, y: number, z: number, r: number): void => {
    puffs.push({ x, y, z, r, phase: rand() * Math.PI * 2 });
  };
  for (let i = 0; i < 4; i++) add((i / 3 - 0.5) * 1.5 * e + (rand() - 0.5) * 0.2, 0.2 + 0.06 * rand(), (rand() - 0.5) * 0.5, 0.34 + 0.1 * rand());
  for (let i = 0; i < 3; i++) add((i / 2 - 0.5) * 0.85 * e + (rand() - 0.5) * 0.2, 0.44 + 0.14 * rand(), (rand() - 0.5) * 0.35, 0.36 + 0.12 * rand());
  add((rand() - 0.5) * 0.5 * e, 0.72 + 0.16 * rand(), (rand() - 0.5) * 0.2, 0.28 + 0.1 * rand());
  return puffs;
}

/** `count` directions, each placed farthest from those before it: any prefix is evenly spread. */
function spreadDirections(rand: () => number, count: number): Vector3[] {
  const dirs: Vector3[] = [];
  const candidate = (): Vector3 => {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    return new Vector3(s * Math.cos(a), s * Math.sin(a), z);
  };
  for (let i = 0; i < count; i++) {
    let best = candidate();
    let bestGap = -Infinity;
    for (let k = 0; k < 12; k++) {
      const c = k === 0 ? best : candidate();
      let gap = Infinity;
      for (const d of dirs) gap = Math.min(gap, 1 - c.dot(d));
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    dirs.push(best);
  }
  return dirs;
}

/** The weather for a seed: two or three big vortices, a couple of small ones, banded winds. */
function makeFlow(rand: () => number): Flow {
  const count = 4 + Math.floor(rand() * 2);
  const vortices = spreadDirections(rand, count).map((centre, i): Vortex => {
    const big = i < 2 + Math.floor(rand() * 2);
    const cyclone = rand() < 0.65;
    return {
      centre,
      radius: big ? 0.55 + 0.3 * rand() : 0.3 + 0.18 * rand(),
      spin: rand() < 0.5 ? -1 : 1,
      inflow: (cyclone ? 1 : -1) * (0.22 + 0.22 * rand()),
      gather: cyclone ? 0.12 + 0.12 * rand() : -0.08,
    };
  });
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return { vortices, zonal: new Vector3(s * Math.cos(a), s * Math.sin(a), z), bands: 3, strength: 0.32 };
}

const fx = new Vector3();
const fy = new Vector3();

/** The flow at a direction (a tangent there; its length is only a speed). */
function flowAt(flow: Flow, d: Vector3, out: Vector3): Vector3 {
  out.set(0, 0, 0);
  for (const v of flow.vortices) {
    const c = clamp(d.dot(v.centre), -1, 1);
    const sin = Math.sqrt(1 - c * c);
    if (sin < 1e-5) continue;
    const ang = Math.acos(c);
    const x = ang / v.radius;
    const speed = v.spin * x * Math.exp(1 - x);
    fx.crossVectors(v.centre, d).divideScalar(sin);
    fy.copy(v.centre).addScaledVector(d, -c).divideScalar(sin);
    out.addScaledVector(fx, speed * Math.cos(v.inflow)).addScaledVector(fy, speed * Math.sin(v.inflow) * Math.sign(v.spin));
  }
  const lat = Math.asin(clamp(d.dot(flow.zonal), -1, 1));
  fx.crossVectors(flow.zonal, d);
  return out.addScaledVector(fx, flow.strength * Math.sin(flow.bands * lat));
}

/**
 * Streamlines of the flow over the whole sphere, spaced about `sep` apart
 * (after Jobard and Lefer), the spacing itself wandering between 0.7× and
 * 1.3× so the streaks do not run like a fingerprint.
 */
function traceStreamlines(flow: Flow, rand: () => number, noiseSeed: number): Vector3[][] {
  const sepAt = (p: Vector3): number => STREAM.sep * (1 + 0.3 * clamp(2.5 * gnoise(p.x * 1.7, p.y * 1.7, p.z * 1.7, noiseSeed + 7), -1, 1));
  const cell = STREAM.sep * 1.3;
  const step = STREAM.step * STREAM.sep;
  const cells = Math.ceil(2 / cell) + 1;
  const grid = new Map<number, Vector3[]>();
  const key = (p: Vector3): number => {
    const i = Math.floor((p.x + 1) / cell);
    const j = Math.floor((p.y + 1) / cell);
    const k = Math.floor((p.z + 1) / cell);
    return (i * cells + j) * cells + k;
  };
  const near = (q: Vector3, dist: number): boolean => {
    const i0 = Math.floor((q.x + 1) / cell);
    const j0 = Math.floor((q.y + 1) / cell);
    const k0 = Math.floor((q.z + 1) / cell);
    const d2 = dist * dist;
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++)
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          const list = grid.get((i * cells + j) * cells + k);
          if (list) for (const p of list) if (p.distanceToSquared(q) < d2) return true;
        }
    return false;
  };
  const v = new Vector3();
  const mid = new Vector3();
  const recent = Math.ceil(STREAM.test / STREAM.step) + 2;
  const trace = (seed: Vector3): Vector3[] | null => {
    if (near(seed, 0.9 * sepAt(seed))) return null;
    const halves: Vector3[][] = [[], []];
    const maxSteps = Math.floor(STREAM.maxLength / 2 / step);
    for (let h = 0; h < 2; h++) {
      const sign = h === 0 ? 1 : -1;
      const pts = halves[h];
      let p = seed;
      for (let i = 0; i < maxSteps; i++) {
        flowAt(flow, p, v);
        if (v.lengthSq() < 1e-6) break;
        v.normalize().multiplyScalar(sign);
        mid.copy(p).addScaledVector(v, step / 2).normalize();
        flowAt(flow, mid, v);
        if (v.lengthSq() < 1e-6) break;
        v.normalize().multiplyScalar(sign);
        const q = p.clone().addScaledVector(v, step).normalize();
        const test = STREAM.test * sepAt(q);
        if (near(q, test)) break;
        // closing on itself (a ring round a vortex): stop
        let loops = false;
        const own = (list: Vector3[], from: number): void => {
          for (let k = from; k < list.length && !loops; k++) if (list[k].distanceToSquared(q) < test * test) loops = true;
        };
        if (pts.length > recent) {
          for (let k = 0; k < pts.length - recent && !loops; k++) if (pts[k].distanceToSquared(q) < test * test) loops = true;
        }
        if (h === 1) own(halves[0], Math.max(0, recent - i));
        if (loops) break;
        pts.push(q);
        p = q;
      }
    }
    const line = [...halves[1].reverse(), seed, ...halves[0]];
    if ((line.length - 1) * step < STREAM.minLength) return null;
    for (const p of line) {
      const k = key(p);
      const list = grid.get(k);
      if (list) list.push(p);
      else grid.set(k, [p]);
    }
    return line;
  };

  const lines: Vector3[][] = [];
  const queue: Vector3[] = [];
  const accept = (line: Vector3[] | null): void => {
    if (!line) return;
    lines.push(line);
    // seeds a spacing away on either side, every few steps
    for (let i = 1; i < line.length - 1; i += 3) {
      const p = line[i];
      v.subVectors(line[i + 1], line[i - 1]);
      const n = new Vector3().crossVectors(p, v).normalize();
      const sep = sepAt(p);
      queue.push(p.clone().addScaledVector(n, sep).normalize(), p.clone().addScaledVector(n, -sep).normalize());
    }
  };
  // start near each vortex's core, then grow outward from the lines already laid
  for (const vx of flow.vortices) {
    const t = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
    t.addScaledVector(vx.centre, -t.dot(vx.centre)).normalize();
    accept(trace(vx.centre.clone().addScaledVector(t, vx.radius * 0.6).normalize()));
    while (queue.length) accept(trace(queue.shift()!));
  }
  // and fill whatever the flow left out
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = 900;
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    accept(trace(new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z)));
    while (queue.length) accept(trace(queue.shift()!));
  }
  return lines;
}

export function createCloudUniforms(): CloudUniforms {
  const data = new DataTexture(new Float32Array(COLUMNS * MAX_CLOUDS * 4), COLUMNS, MAX_CLOUDS, RGBAFormat, FloatType);
  data.magFilter = NearestFilter;
  data.minFilter = NearestFilter;
  data.generateMipmaps = false;
  data.needsUpdate = true;
  return {
    uCloudData: { value: data },
    uCloudShadowCube: { value: null },
    uCloudLayerCube: { value: null },
    uCloudLook: { value: new Vector4(0.7, 0.12, 0, 0) },
    uCloudOrbit: { value: new Vector4(0, 12, 0, 0) },
    uCloudShadowLocal: { value: null },
    uShadowLocalFace: { value: new Matrix3() },
    uShadowWindow: { value: new Vector4(0, 0, 1, 0) },
    uCubeFace: { value: new Matrix3() },
    uFaceWindow: { value: new Vector3(0, 0, 1) },
    uCloudLumps: { value: null },
    uCloudEye: { value: new Vector3() },
    uCloudMirror: { value: null },
    uCloudMirrorVP: { value: new Matrix4() },
    uCloudMirrorExtent: { value: new Vector4(1, 1, 1, 1) },
  };
}

function quad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A cloud being shown this frame. */
interface Placed {
  slot: Slot;
  fade: number;
  /** Distance of its base from the planet centre, and its size (m). */
  base: number;
  size: number;
  up: Vector3;
  along: Vector3;
  distance: number;
}

/** Distance from a point to the segment a–b. */
function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / Math.max(abx * abx + aby * aby + abz * abz, 1e-9), 0, 1);
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

export class Clouds {
  /** The billboards; add to the scene. */
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /**
   * The cutaway into Muse's hut (view/cutaway.ts): heaps within `radius` (m)
   * of the line from the camera to the room draw back by `amount` (0 … 1), so
   * none stands in the way while it is open. Null the rest of the time.
   */
  clearing: { readonly from: Vector3; readonly to: Vector3; radius: number; amount: number } | null = null;
  private readonly shadowCube: WebGLCubeRenderTarget;
  private readonly layerCube: WebGLCubeRenderTarget;
  /** The sharper window of the shadows (WINDOW), its face (-1: none yet) and size. */
  private readonly shadowLocal: WebGLRenderTarget;
  private localFace = -1;
  private localLevel = Number.NaN;
  private readonly localSize: number;
  private readonly shadowScene: Scene;
  private readonly layerScene: Scene;
  private readonly shadowGeometry: InstancedBufferGeometry;
  private readonly shadowCamera = new OrthographicCamera();
  private readonly lumps = new WebGLCubeRenderTarget(64, { generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly mirrorTarget = new WebGLRenderTarget(1, 1, { depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  private readonly mirrorScene: Scene;
  private readonly mirrorCamera = new PerspectiveCamera();
  private readonly mirror = new Matrix4();
  /** Where the lakes can read the mirror: the mirror pass shades only there. */
  private readonly waterMask: WaterMask;
  private readonly wind: IUniform<Vector4>;
  /** The pixels drawn this frame (globals: the render scale's part of the screen-sized targets). */
  private readonly view: IUniform<Vector2>;
  private readonly bufferSize = new Vector2();
  private readonly clearColour = new Color();
  private lumpsBaked = false;
  private casters = 0;
  private lines: Line[] = [];
  private templates: Puff[][] = [];
  private seed = Number.NaN;
  /** Slots for the current R (rebuilt when R changes), and the cloudiness threshold for the current coverage. */
  private readonly slots: Slot[] = [];
  private sorted = new Float32Array(0);
  private slotsR = Number.NaN;
  private threshold = 0;
  private thresholdKey = '';
  private readonly placed: Placed[] = Array.from({ length: MAX_CLOUDS }, () => ({ slot: null as unknown as Slot, fade: 1, base: 0, size: 0, up: new Vector3(), along: new Vector3(), distance: 0 }));
  private readonly order: Placed[] = [];
  /** Per row: 1 when the ground does not hide the cloud from the camera. */
  private readonly inSight = new Uint8Array(MAX_CLOUDS);
  private readonly all: Array<{ centre: Vector3; radius: number }> = [];
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly across = new Vector3();
  private readonly centre = new Vector3();
  private readonly projection = { value: new Matrix4() };
  /** Clouds shown (perf stat). */
  count = 0;

  /**
   * `uniforms` must already be in `shared` (materials copy it when they are
   * made). Sizes: a face of the shadow cube and of the cover-from-below
   * cube, and the sharper window of the shadows.
   */
  constructor(shared: Record<string, IUniform>, readonly uniforms: CloudUniforms, shadowSize: number, layerSize: number, localSize: number) {
    const cube = (size: number): WebGLCubeRenderTarget =>
      new WebGLCubeRenderTarget(size, { type: HalfFloatType, format: RedFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    this.shadowCube = cube(shadowSize);
    this.layerCube = cube(layerSize);
    this.localSize = localSize;
    this.shadowLocal = new WebGLRenderTarget(localSize, localSize, { type: HalfFloatType, format: RedFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    uniforms.uCloudShadowLocal.value = this.shadowLocal.texture;
    gpuMemory.set('cloud shadow window', localSize * localSize * 2);
    gpuMemory.set('cloud shadow map', 6 * shadowSize * shadowSize * 2);
    gpuMemory.set('cloud cover map', 6 * layerSize * layerSize * 2);
    gpuMemory.set('cloud lumps', 6 * 64 * 64 * 4);
    uniforms.uCloudShadowCube.value = this.shadowCube.texture;
    uniforms.uCloudLayerCube.value = this.layerCube.texture;
    uniforms.uCloudLumps.value = this.lumps.texture;

    this.waterMask = new WaterMask(shared);
    this.wind = shared.uWindVec as IUniform<Vector4>;
    this.view = shared.uResolution as IUniform<Vector2>;
    const cloudMaterial = (mirror: boolean): ShaderMaterial =>
      new ShaderMaterial({
        name: mirror ? 'clouds (mirror)' : 'clouds',
        vertexShader,
        fragmentShader,
        uniforms: mirror ? { ...shared, uProjection: this.projection, uWaterMask: { value: this.waterMask.texture } } : { ...shared, uProjection: this.projection },
        defines: mirror ? { MIRROR_PASS: 1, MASK_CELL } : {},
        // a mirrored camera turns the billboards' winding
        side: mirror ? DoubleSide : FrontSide,
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      });
    const material = cloudMaterial(false);
    const geometry = quad();
    geometry.instanceCount = 0;
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    // the same billboards, seen in the water
    const mirrorMesh = new Mesh(geometry, cloudMaterial(true));
    mirrorMesh.frustumCulled = false;
    this.mirrorScene = new Scene().add(mirrorMesh);
    this.mirrorCamera.matrixAutoUpdate = false;
    this.mirrorCamera.matrixWorldAutoUpdate = false;
    uniforms.uCloudMirror.value = this.mirrorTarget.texture;

    // the puffs splatted into the cube maps: the shadows, and the cover from below
    this.shadowGeometry = quad();
    this.shadowGeometry.instanceCount = 0;
    const splats = (radial: boolean): Mesh => {
      const material = new ShaderMaterial({
        name: radial ? 'cloud cover' : 'cloud shadows',
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        defines: radial ? { RADIAL: 1 } : {},
        uniforms: {
          uCloudData: uniforms.uCloudData,
          uCloudLook: uniforms.uCloudLook,
          uCloudLumps: uniforms.uCloudLumps,
          uCubeFace: uniforms.uCubeFace,
          uFaceWindow: uniforms.uFaceWindow,
          uTime: shared.uTime,
          uRadius: shared.uRadius,
          uSunAngles: shared.uSunAngles,
        },
        // the cube faces' projections turn some splats over
        side: DoubleSide,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const mesh = new Mesh(this.shadowGeometry, material);
      mesh.frustumCulled = false;
      return mesh;
    };
    this.shadowScene = new Scene().add(splats(false));
    this.layerScene = new Scene().add(splats(true));
  }

  /** Something else that casts its shadow into the clouds' map (the birds): drawn after the puffs, additively, with uCubeFace. */
  addShadowCaster(mesh: Mesh): void {
    this.shadowScene.add(mesh);
    this.casters++;
  }

  /** Bake the lumps into their cube map (once). */
  private bakeLumps(renderer: WebGLRenderer): void {
    const face = { value: 0 };
    const material = new ShaderMaterial({
      name: 'cloud lumps bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: lumpsFragment,
      uniforms: { uFace: face, uSize: { value: this.lumps.width } },
      depthTest: false,
      depthWrite: false,
    });
    const scene = new Scene().add(fullscreenMesh(material));
    const previous = renderer.getRenderTarget();
    for (let f = 0; f < 6; f++) {
      face.value = f;
      renderer.setRenderTarget(this.lumps, f);
      renderer.render(scene, this.shadowCamera);
    }
    renderer.setRenderTarget(previous);
    material.dispose();
    this.lumpsBaked = true;
  }

  /** The weather for a seed: its streamlines and the cloudiness along them. */
  private build(seed: number): void {
    const rand = rng(seed ^ 0x5eed);
    const flow = makeFlow(rand);
    const s = hash32(seed ^ 0xc10d) % 100000;
    const lines = traceStreamlines(flow, rand, s);
    const window = Math.round(0.3 / (STREAM.step * STREAM.sep));
    const step = STREAM.step * STREAM.sep;
    this.lines = lines.map((points, li): Line => {
      const offset = (rand() - 0.5) * 0.28;
      const raw = points.map((d) => {
        let c = 0.62 * gnoise(d.x * 1.3, d.y * 1.3, d.z * 1.3, s) + 0.38 * gnoise(d.x * 2.9, d.y * 2.9, d.z * 2.9, s + 1);
        // cyclones gather cloud round their cores, the others clear it
        for (const v of flow.vortices) {
          const a = Math.acos(clamp(d.dot(v.centre), -1, 1)) / (1.25 * v.radius);
          c += v.gather * Math.exp(-a * a);
        }
        return c + offset;
      });
      // smoothed along the line, so cloud runs in streaks with the flow, and thinning to the line's ends
      const cloudy = new Float32Array(points.length);
      for (let i = 0; i < points.length; i++) {
        let acc = 0;
        let n = 0;
        for (let k = Math.max(0, i - window); k <= Math.min(points.length - 1, i + window); k++, n++) acc += raw[k];
        const ends = Math.min(i, points.length - 1 - i) * step;
        cloudy[i] = acc / n - 0.3 * (1 - smoothstep(0, 0.3, ends));
      }
      // girth: thin wisps and fat streaks, swelling and thinning along the way
      const base = 0.75 + 0.5 * rand();
      const girth = new Float32Array(points.length);
      points.forEach((d, i) => {
        girth[i] = base * (0.82 + 0.36 * clamp(0.5 + 1.6 * gnoise(d.x * 4.1, d.y * 4.1, d.z * 4.1, s + 3), 0, 1));
      });
      return { points, cloudy, girth, seed: hash32(seed + li * 7919) };
    });
    this.templates = Array.from({ length: TEMPLATES }, () => makePuffs(rand));
    this.seed = seed;
    this.slotsR = Number.NaN;
  }

  /** Places for clouds along the streamlines at this R: about three quarters of a cloud's length apart. */
  private layoutSlots(radius: number): void {
    const size = SIZE * Math.sqrt(radius / 128);
    const spacing = (0.75 * 2.9 * size) / radius;
    const step = STREAM.step * STREAM.sep;
    let count = 0;
    for (const line of this.lines) {
      const pts = line.points;
      const length = (pts.length - 1) * step;
      for (let j = 0; (j + 0.5) * spacing < length; j++) {
        const at = ((j + 0.5) * spacing) / step;
        const i = Math.min(Math.floor(at), pts.length - 2);
        const f = at - i;
        // slots are reused frame to frame (R changes every frame while the planet grows)
        const slot = (this.slots[count++] ??= { dir: new Vector3(), along: new Vector3(), cloudiness: 0, girth: 1, seed: 0 });
        const dir = slot.dir.lerpVectors(pts[i], pts[i + 1], f).normalize();
        const along = slot.along.subVectors(pts[i + 1], pts[i]);
        along.addScaledVector(dir, -along.dot(dir)).normalize();
        // a little off the line, to either side, so neighbouring streaks do not run in step
        slot.seed = hash32(line.seed + j * 131);
        const side = this.across.crossVectors(dir, along);
        dir.addScaledVector(side, (unit(hash32(slot.seed + 5)) - 0.5) * 0.4 * STREAM.sep).normalize();
        along.addScaledVector(dir, -along.dot(dir)).normalize();
        slot.girth = line.girth[i] + (line.girth[i + 1] - line.girth[i]) * f;
        slot.cloudiness = line.cloudy[i] + (line.cloudy[i + 1] - line.cloudy[i]) * f;
      }
    }
    this.slots.length = count;
    this.slotsR = radius;
    this.thresholdKey = '';
  }

  /**
   * Whether the ground hides a cloud from the camera. A sightline from the
   * eye to a cloud is blocked where it passes under the water table (nothing
   * stands lower), in the warped world the camera sees: behind the planet
   * from orbit, or under the bent meadow at the tiny-planet zooms. Judged by
   * the line to the top of its bound (lower points are hidden sooner).
   */
  private hidden(at: Placed, eye: Vector3, radius: number, warp: WarpFrame): boolean {
    const target = warpPoint(warp, this.p.copy(at.up).multiplyScalar(at.base + 2.65 * at.size), this.p);
    for (let i = 1; i < 16; i++) {
      this.q.lerpVectors(eye, target, i / 16);
      if (unwarpPoint(warp, this.q, this.q).length() < radius) return true;
    }
    return false;
  }

  /** Every cloud's heap now, as a sphere about its middle (planet space; those behind the planet too), nearest the camera first. */
  bounds(): Array<{ centre: Vector3; radius: number }> {
    return this.all;
  }

  /**
   * Place the clouds for this frame, write them for the shaders (nearest the
   * camera first) and render their shadow map. `focus` and `seen` (rad): the
   * ground the camera can see lies within `seen` of the focus direction; only
   * the faces of the cube maps that hold some of it are drawn (the others are
   * never read this frame).
   */
  update(renderer: WebGLRenderer, seed: number, radius: number, time: number, p: CloudParams, windAxis: Vector3, sunDir: Vector3, camera: PerspectiveCamera, warp: WarpFrame, focus: Vector3, seen: number): void {
    if (!this.lumpsBaked) this.bakeLumps(renderer);
    if (seed !== this.seed) this.build(seed);
    if (radius !== this.slotsR) this.layoutSlots(radius);
    const key = `${p.coverage}`;
    if (key !== this.thresholdKey) {
      // the cloudiest share of the slots holds cloud (never more than the texture has rows for)
      const n = this.slots.length;
      if (this.sorted.length < n) this.sorted = new Float32Array(n * 2);
      const sorted = this.sorted.subarray(0, n);
      this.slots.forEach((slot, i) => (sorted[i] = -slot.cloudiness));
      sorted.sort();
      const share = SHARE[0] + (SHARE[1] - SHARE[0]) * p.coverage;
      const shown = Math.min(Math.floor(share * n), MAX_CLOUDS);
      this.threshold = p.coverage <= 0 || n === 0 ? Infinity : -sorted[Math.max(shown - 1, 0)] - FADE * 0.5;
      this.thresholdKey = key;
    }
    const scale = radius / 128;
    const sizeScale = Math.sqrt(scale);
    // drift: about a meter and a half a second at the default speed
    const speed = 0.4 + 3.2 * p.speed;
    this.order.length = 0;
    for (const slot of this.slots) {
      if (this.order.length >= MAX_CLOUDS) break;
      const h = slot.seed;
      const c = slot.cloudiness;
      // in a cloudy stretch, a heap; in its fringe, now and then a small cloudlet
      // (a fixed choice of slots, growing and shrinking with the fringe, so none pops)
      let fade: number;
      let girth: number;
      if (c > this.threshold) {
        fade = clamp((c - this.threshold) / FADE, 0, 1);
        girth = slot.girth * (0.7 + 0.55 * smoothstep(this.threshold, this.threshold + 0.3, c));
      } else {
        fade = smoothstep(this.threshold - FRINGE.reach, this.threshold, c);
        if (fade <= 0 || unit(hash32(h + 9)) > FRINGE.share) continue;
        girth = 0.38 + 0.2 * fade;
      }
      const at = this.placed[this.order.length];
      at.slot = slot;
      at.fade = fade;
      at.base = radius + p.altitude * (0.75 + 0.5 * unit(hash32(h + 1))) * Math.pow(scale, 0.35);
      at.size = SIZE * sizeScale * girth * (0.9 + 0.2 * unit(hash32(h + 2))) * (0.35 + 0.65 * fade);
      const angle = (time * speed) / at.base;
      at.up.copy(slot.dir).applyAxisAngle(windAxis, angle);
      at.along.copy(slot.along).applyAxisAngle(windAxis, angle);
      at.along.addScaledVector(at.up, -at.along.dot(at.up)).normalize();
      if (this.clearing) {
        // the cutaway into Muse's hut: a heap near the line from the camera to the room draws back, out of the way
        const c = this.clearing;
        const middle = this.p.copy(at.up).multiplyScalar(at.base + 0.45 * at.size);
        const reach = segmentDistance(middle, c.from, c.to) - 1.45 * at.size;
        at.fade *= 1 - c.amount * (1 - smoothstep(c.radius, c.radius + 8, reach));
      }
      at.distance = this.p.copy(at.up).multiplyScalar(at.base + 0.45 * at.size).distanceTo(camera.position);
      this.order.push(at);
    }
    this.order.sort((a, b) => a.distance - b.distance);
    this.order.forEach((at, i) => {
      const b = (this.all[i] ??= { centre: new Vector3(), radius: 0 });
      b.centre.copy(at.up).multiplyScalar(at.base + 0.45 * at.size);
      b.radius = 1.45 * at.size;
      // the ground hides some from the camera: they still cast shadows and show in the water, but are not drawn
      this.inSight[i] = this.hidden(at, camera.position, radius, warp) ? 0 : 1;
    });
    this.all.length = this.order.length;
    const n = this.order.length;

    const data = this.uniforms.uCloudData.value.image.data as Float32Array;
    const { x: sx, y: sy, z: sz } = sunDir;
    let heights = 0;
    this.order.forEach((at, row) => {
      const h = at.slot.seed;
      const { size, base } = at;
      const puffs = this.templates[h % TEMPLATES];
      const across = this.across.crossVectors(at.up, at.along);
      const o = row * COLUMNS * 4;
      // bounding sphere about the heap's middle
      this.centre.copy(at.up).multiplyScalar(base + 0.45 * size);
      let reach = 0;
      const { x: ux, y: uy, z: uz } = at.up;
      const { x: ax, y: ay, z: az } = at.along;
      const { x: cx, y: cy, z: cz } = across;
      const { x: mx, y: my, z: mz } = this.centre;
      for (let k = 0; k < PUFFS; k++) {
        const puff = puffs[k];
        const r = puff.r * size * (1 + 0.05 * Math.sin(time * 0.25 + puff.phase)) * at.fade;
        const up = base + puff.y * size;
        const al = puff.x * size;
        const ac = puff.z * size;
        const x = ux * up + ax * al + cx * ac;
        const y = uy * up + ay * al + cy * ac;
        const z = uz * up + az * al + cz * ac;
        const q = o + (HEADER + k) * 4;
        data[q] = x;
        data[q + 1] = y;
        data[q + 2] = z;
        data[q + 3] = r;
        reach = Math.max(reach, Math.hypot(x - mx, y - my, z - mz) + r);
      }
      // how much of the heap stands between each puff and the sun (from the
      // upper, sunward part of the puff): 0 lit … 1 in the shade of the others
      // (only for clouds that are drawn: the mirror and the shadows do without)
      const lit = o + (HEADER + PUFFS) * 4;
      for (let k = 0; k < PUFFS; k++) {
        const qk = o + (HEADER + k) * 4;
        const rk = data[qk + 3];
        if (!this.inSight[row] || rk <= 0) {
          data[lit + k] = 0;
          continue;
        }
        const ox = data[qk] + sx * 0.35 * rk;
        const oy = data[qk + 1] + sy * 0.35 * rk;
        const oz = data[qk + 2] + sz * 0.35 * rk;
        let block = 0;
        for (let j = 0; j < PUFFS; j++) {
          const qj = o + (HEADER + j) * 4;
          const rj = data[qj + 3];
          if (j === k || rj <= 0) continue;
          const dx = data[qj] - ox;
          const dy = data[qj + 1] - oy;
          const dz = data[qj + 2] - oz;
          const tc = dx * sx + dy * sy + dz * sz;
          const d2 = dx * dx + dy * dy + dz * dz - tc * tc;
          if (tc > 0 && d2 < rj * rj) block += 2 * Math.sqrt(rj * rj - d2);
        }
        data[lit + k] = smoothstep(0.1, 0.6, block / Math.max(size, 1e-3));
      }
      data[o] = this.centre.x;
      data[o + 1] = this.centre.y;
      data[o + 2] = this.centre.z;
      data[o + 3] = reach;
      data[o + 4] = at.up.x;
      data[o + 5] = at.up.y;
      data[o + 6] = at.up.z;
      data[o + 7] = base;
      data[o + 8] = (h % 9973) + 7;
      data[o + 9] = size;
      data[o + 10] = this.inSight[row];
      heights += base + 0.45 * size - radius;
    });
    this.uniforms.uCloudData.value.needsUpdate = true;
    this.projection.value.copy(camera.projectionMatrix);
    this.uniforms.uCloudEye.value.copy(camera.position);
    this.count = this.inSight.subarray(0, n).reduce((a, v) => a + v, 0);

    // the lakes mirror the clouds through the mirror pass near the ground and read the cover from below from orbit
    const orbit = smoothstep(ORBIT_REFLECTION[0] * radius, ORBIT_REFLECTION[1] * radius, camera.position.length() - radius);
    this.uniforms.uCloudLook.value.set(p.shadow, 0.22, n, 0);
    this.uniforms.uCloudOrbit.value.set(orbit, n > 0 ? heights / n : 12, 0, 0);
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = this.count > 0;
    this.shadowGeometry.instanceCount = n * PUFFS;
    const previous = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColour);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    const faces = FACE_AXES.map((axis) => Math.acos(clamp(axis.dot(focus), -1, 1)) < seen + FACE_REACH);
    if (n > 0 || this.casters > 0) {
      this.renderCube(renderer, this.shadowCube, this.shadowScene, faces);
      this.renderWindow(renderer, focus, radius, camera.position.length() - radius);
    } else this.uniforms.uShadowWindow.value.w = 0;
    if (orbit > 0) this.renderCube(renderer, this.layerCube, this.layerScene, faces);
    if (orbit < 1) this.renderMirror(renderer, camera, radius, warp, n);
    renderer.setClearColor(this.clearColour, clearAlpha);
    renderer.setRenderTarget(previous);
  }

  /** Clear the faces of a cube map in sight and splat into them. */
  private renderCube(renderer: WebGLRenderer, target: WebGLCubeRenderTarget, scene: Scene, faces: readonly boolean[]): void {
    FACES.forEach((face, f) => {
      if (!faces[f]) return;
      this.uniforms.uCubeFace.value.copy(face);
      renderer.setRenderTarget(target, f);
      renderer.clear(true, false, false);
      renderer.render(scene, this.shadowCamera);
    });
  }

  /**
   * The sharper window of the shadows about the focus (WINDOW): a square of
   * the face nearest the focus, its centre moved in whole texels and its
   * size in steps, so its texels stay fixed to the planet as you move (they
   * change only at a step in its size, or a change of face).
   */
  private renderWindow(renderer: WebGLRenderer, focus: Vector3, radius: number, height: number): void {
    const window = this.uniforms.uShadowWindow.value;
    // the face nearest the focus, kept until another leads
    const lead = (f: number): number => FACE_AXES[f].dot(focus);
    let face = this.localFace;
    for (let f = 0; f < 6; f++) if (face < 0 || lead(f) > lead(face) + WINDOW.margin) face = f;
    this.localFace = face;
    const m = FACES[face].elements; // columns: across, up, out
    const out = focus.x * m[6] + focus.y * m[7] + focus.z * m[8];
    // half-width in face units: a meter of ground across the face's slant there is 1 / (R·out²) of it
    const want = clamp(WINDOW.min + WINDOW.perMeter * height, WINDOW.min, WINDOW.max) / (radius * out * out);
    const base = WINDOW.min / radius;
    const level = Math.log(want / base) / Math.log(WINDOW.step);
    if (!Number.isFinite(this.localLevel) || Math.abs(level - this.localLevel) > 0.6) this.localLevel = Math.round(level);
    const h = base * WINDOW.step ** this.localLevel;
    if (h * radius * out * out > WINDOW.share * radius) {
      window.w = 0;
      return;
    }
    const fx = (focus.x * m[0] + focus.y * m[1] + focus.z * m[2]) / out;
    const fy = (focus.x * m[3] + focus.y * m[4] + focus.z * m[5]) / out;
    const texel = (2 * h) / this.localSize;
    const cx = Math.round(fx / texel) * texel;
    const cy = Math.round(fy / texel) * texel;
    window.set(cx, cy, 1 / h, 1);
    this.uniforms.uShadowLocalFace.value.copy(FACES[face]);
    this.uniforms.uCubeFace.value.copy(FACES[face]);
    this.uniforms.uFaceWindow.value.set(cx, cy, 1 / h);
    renderer.setRenderTarget(this.shadowLocal);
    renderer.clear(true, false, false);
    renderer.render(this.shadowScene, this.shadowCamera);
    this.uniforms.uFaceWindow.value.set(0, 0, 1);
  }

  /**
   * The clouds as the lakes mirror them: the camera reflected in the water's
   * level plane under the focus (the warp leaves the focus where it is),
   * at full resolution. A point of that plane lands on the same pixel from
   * either camera, so the water looks its reflection up where it is; the
   * pass shades only the pixels some lake can read (the water mask).
   */
  private renderMirror(renderer: WebGLRenderer, camera: PerspectiveCamera, radius: number, warp: WarpFrame, n: number): void {
    // the canvas's size, drawn in the part the render scale draws (as the scene is)
    renderer.getDrawingBufferSize(this.bufferSize);
    const w = Math.max(1, this.bufferSize.x);
    const h = Math.max(1, this.bufferSize.y);
    if (w !== this.mirrorTarget.width || h !== this.mirrorTarget.height) {
      this.mirrorTarget.setSize(w, h);
      gpuMemory.set('cloud mirror', w * h * 4);
    }
    const view = this.view.value;
    const vw = Math.min(w, view.x);
    const vh = Math.min(h, view.y);
    this.mirrorTarget.viewport.set(0, 0, vw, vh);
    this.uniforms.uCloudMirrorExtent.value.set(vw / w, vh / h, (vw - 0.5) / w, (vh - 0.5) / h);
    // X' = X − 2((X − P)·U)U with P = U·R: the water table under the focus
    const u = warp.up;
    const d = 2 * radius;
    this.mirror.set(
      1 - 2 * u.x * u.x, -2 * u.x * u.y, -2 * u.x * u.z, d * u.x,
      -2 * u.y * u.x, 1 - 2 * u.y * u.y, -2 * u.y * u.z, d * u.y,
      -2 * u.z * u.x, -2 * u.z * u.y, 1 - 2 * u.z * u.z, d * u.z,
      0, 0, 0, 1,
    );
    const mc = this.mirrorCamera;
    mc.projectionMatrix.copy(camera.projectionMatrix);
    mc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    mc.matrixWorld.multiplyMatrices(this.mirror, camera.matrixWorld);
    mc.matrixWorldInverse.copy(mc.matrixWorld).invert();
    this.uniforms.uCloudMirrorVP.value.multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse);
    // only where a lake can read it (waterMask.ts): the water on screen, grown by the most the
    // ruffle can move a lake's lookup (cloudsInMirror), worst at the corners of the view
    if (n > 0) {
      const tanY = Math.tan((camera.fov * Math.PI) / 360);
      const tanX = tanY * camera.aspect;
      const spread = ((RUFFLE * this.wind.value.w * vh) / (2 * tanY)) * (1 + tanX * tanX + tanY * tanY);
      this.waterMask.render(renderer, camera, this.bufferSize, view, spread);
    }
    // cleared to transparent black: the water reads it as premultiplied colour
    renderer.setRenderTarget(this.mirrorTarget);
    renderer.clear(true, false, false);
    if (n > 0) renderer.render(this.mirrorScene, mc);
  }
}
