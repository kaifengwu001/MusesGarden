import {
  AdditiveBlending,
  BufferAttribute,
  CustomBlending,
  DataTexture,
  FloatType,
  HalfFloatType,
  InstancedBufferGeometry,
  LinearFilter,
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
  type PerspectiveCamera,
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

// Low cumulus drifting with the wind a few meters above the meadow. Each
// cloud is a heap of PUFFS lumpy spheres over a flat base, written once a
// frame into one data texture (clouds.glsl reads it). The same puffs draw the
// cloud (a billboard each, traced per pixel), cast its shadow (splatted into
// a sun-space map of optical depth) and show in the lakes (traced along the
// mirrored ray), so a cloud, its shadow and its reflection always agree.
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
const COLUMNS = HEADER + PUFFS;
/** Clouds the water traces for its mirror (the nearest to the camera). */
const REFLECTED = 8;
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
  uCloudShadowMap: IUniform<Texture | null>;
  /** Sun-space axis A, 1 / half-extent of the shadow map (1/m). */
  uCloudSunA: IUniform<Vector4>;
  uCloudSunB: IUniform<Vector4>;
  /** Shadow strength, optical density (1/m), clouds, clouds that reflect. */
  uCloudLook: IUniform<Vector4>;
  /** The puffs' lumps, baked once (cloudLumps.glsl). */
  uCloudLumps: IUniform<Texture | null>;
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
    uCloudShadowMap: { value: null },
    uCloudSunA: { value: new Vector4(1, 0, 0, 1 / 200) },
    uCloudSunB: { value: new Vector4(0, 0, 1, 0) },
    uCloudLook: { value: new Vector4(0.7, 0.12, 0, 0) },
    uCloudLumps: { value: null },
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

export class Clouds {
  /** The billboards; add to the scene. */
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly shadowTarget: WebGLRenderTarget;
  private readonly shadowScene: Scene;
  private readonly shadowGeometry: InstancedBufferGeometry;
  private readonly shadowCamera = new OrthographicCamera();
  private readonly lumps = new WebGLCubeRenderTarget(64, { generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private lumpsBaked = false;
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
  private readonly all: Array<{ centre: Vector3; radius: number }> = [];
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly across = new Vector3();
  private readonly centre = new Vector3();
  private readonly axisA = new Vector3();
  private readonly axisB = new Vector3();
  private readonly projection = { value: new Matrix4() };
  /** Clouds shown (perf stat). */
  count = 0;

  /** `uniforms` must already be in `shared` (materials copy it when they are made). */
  constructor(shared: Record<string, IUniform>, readonly uniforms: CloudUniforms, shadowSize: number) {
    this.shadowTarget = new WebGLRenderTarget(shadowSize, shadowSize, {
      type: HalfFloatType,
      format: RedFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    gpuMemory.set('cloud shadow map', shadowSize * shadowSize * 2);
    gpuMemory.set('cloud lumps', 6 * 64 * 64 * 4);
    uniforms.uCloudShadowMap.value = this.shadowTarget.texture;
    uniforms.uCloudLumps.value = this.lumps.texture;

    const material = new ShaderMaterial({
      name: 'clouds',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uProjection: this.projection },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    const geometry = quad();
    geometry.instanceCount = 0;
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    this.shadowGeometry = quad();
    this.shadowGeometry.instanceCount = 0;
    const shadowMaterial = new ShaderMaterial({
      name: 'cloud shadows',
      vertexShader: shadowVertex,
      fragmentShader: shadowFragment,
      uniforms: { uCloudData: uniforms.uCloudData, uCloudSunA: uniforms.uCloudSunA, uCloudSunB: uniforms.uCloudSunB, uCloudLook: uniforms.uCloudLook, uCloudLumps: uniforms.uCloudLumps, uTime: shared.uTime },
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const shadowMesh = new Mesh(this.shadowGeometry, shadowMaterial);
    shadowMesh.frustumCulled = false;
    this.shadowScene = new Scene().add(shadowMesh);
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
   * Drop the clouds the ground hides. A sightline from the eye to a cloud is
   * blocked where it passes under the water table (nothing stands lower), in
   * the warped world the camera sees: behind the planet from orbit, or under
   * the bent meadow at the tiny-planet zooms. A cloud goes when the line to
   * the top of its bound is blocked (lower points are hidden sooner).
   */
  private cullHidden(eye: Vector3, radius: number, warp: WarpFrame): void {
    const blocked = (target: Vector3): boolean => {
      for (let i = 1; i < 16; i++) {
        this.q.lerpVectors(eye, target, i / 16);
        if (unwarpPoint(warp, this.q, this.q).length() < radius) return true;
      }
      return false;
    };
    let kept = 0;
    for (const at of this.order) {
      if (!blocked(warpPoint(warp, this.p.copy(at.up).multiplyScalar(at.base + 2.65 * at.size), this.p))) this.order[kept++] = at;
    }
    this.order.length = kept;
  }

  /** Every cloud's bounding sphere now (planet space; those behind the planet too), nearest the camera first. */
  bounds(): Array<{ centre: Vector3; radius: number }> {
    return this.all;
  }

  /**
   * Place the clouds for this frame, write them for the shaders (nearest the
   * camera first) and render their shadow map.
   */
  update(renderer: WebGLRenderer, seed: number, radius: number, time: number, p: CloudParams, windAxis: Vector3, sunDir: Vector3, camera: PerspectiveCamera, warp: WarpFrame): void {
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
      at.distance = this.p.copy(at.up).multiplyScalar(at.base + 0.45 * at.size).distanceTo(camera.position);
      this.order.push(at);
    }
    this.order.sort((a, b) => a.distance - b.distance);
    this.order.forEach((at, i) => {
      const b = (this.all[i] ??= { centre: new Vector3(), radius: 0 });
      b.centre.copy(at.up).multiplyScalar(at.base + 0.45 * at.size);
      b.radius = 2.2 * at.size;
    });
    this.all.length = this.order.length;
    // clouds the ground hides are left out (they would still be shaded: the cloud shader writes its depth)
    this.cullHidden(camera.position, radius, warp);
    const n = this.order.length;

    const data = this.uniforms.uCloudData.value.image.data as Float32Array;
    let top = 0;
    this.order.forEach((at, row) => {
      const h = at.slot.seed;
      const { size, base } = at;
      const puffs = this.templates[h % TEMPLATES];
      const across = this.across.crossVectors(at.up, at.along);
      const o = row * COLUMNS * 4;
      // bounding sphere about the heap's middle
      this.centre.copy(at.up).multiplyScalar(base + 0.45 * size);
      let reach = 0;
      puffs.forEach((puff, k) => {
        const breathe = 1 + 0.05 * Math.sin(time * 0.25 + puff.phase);
        const r = puff.r * size * breathe * at.fade;
        this.p
          .copy(at.up)
          .multiplyScalar(base + puff.y * size)
          .addScaledVector(at.along, puff.x * size)
          .addScaledVector(across, puff.z * size);
        const q = o + (HEADER + k) * 4;
        data[q] = this.p.x;
        data[q + 1] = this.p.y;
        data[q + 2] = this.p.z;
        data[q + 3] = r;
        reach = Math.max(reach, this.p.distanceTo(this.centre) + r);
      });
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
      top = Math.max(top, base + 1.3 * size - radius);
    });
    this.uniforms.uCloudData.value.needsUpdate = true;
    this.projection.value.copy(camera.projectionMatrix);
    this.count = n;

    // the shadow map: an orthographic view down the sun over the whole planet
    const ref = Math.abs(sunDir.y) < 0.9 ? this.p.set(0, 1, 0) : this.p.set(1, 0, 0);
    this.axisA.crossVectors(sunDir, ref).normalize();
    this.axisB.crossVectors(sunDir, this.axisA);
    const extent = radius + top + 2;
    this.uniforms.uCloudSunA.value.set(this.axisA.x, this.axisA.y, this.axisA.z, 1 / extent);
    this.uniforms.uCloudSunB.value.set(this.axisB.x, this.axisB.y, this.axisB.z, 0);
    this.uniforms.uCloudLook.value.set(p.shadow, 0.22, n, Math.min(n, REFLECTED));
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.shadowGeometry.instanceCount = n * PUFFS;
    const previous = renderer.getRenderTarget();
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.shadowTarget);
    renderer.setClearAlpha(0);
    renderer.clear(true, false, false);
    if (n > 0) renderer.render(this.shadowScene, this.shadowCamera);
    renderer.setClearAlpha(clearAlpha);
    renderer.setRenderTarget(previous);
  }
}
