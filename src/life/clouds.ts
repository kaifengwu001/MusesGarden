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
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { hash32, unit } from '../core/hash';
import { clamp } from '../core/math';
import fragmentShader from './cloud.frag.glsl?raw';
import vertexShader from './cloud.vert.glsl?raw';
import shadowFragment from './cloudShadow.frag.glsl?raw';
import shadowVertex from './cloudShadow.vert.glsl?raw';

// Low cumulus drifting with the wind a few meters above the meadow. Each
// cloud is a heap of PUFFS soft spheres over a flat base, written once a
// frame into one data texture (clouds.glsl reads it). The same puffs draw the
// cloud (a billboard each, traced per pixel), cast its shadow (splatted into
// a sun-space map of optical depth) and show in the lakes (traced along the
// mirrored ray), so a cloud, its shadow and its reflection always agree.
//
// Clouds gather in banks of one to four. They keep a human scale as the
// planet grows: their count grows with R and their size with √R, so the
// share of sky they cover stays put; the count is fractional (the next cloud
// fades in), so nothing pops.

export const MAX_CLOUDS = 128;
const PUFFS = 8;
const HEADER = 3;
const COLUMNS = HEADER + PUFFS;
/** Clouds the water traces for its mirror (the nearest to the camera). */
const REFLECTED = 16;
/** Clouds per R = 128 m planet at coverage 0 and 1. */
const COUNT = [16, 110] as const;

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
}

interface Puff {
  /** Offset × cloud size: x along the cloud, y up from its base, z across. */
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
}

interface Cluster {
  /** The bank's centre, and where in it this cloud sits: a tangent and a distance (× cloud size). */
  bank: Vector3;
  offset: Vector3;
  reach: number;
  /** Heading of the long axis (a tangent at the bank). */
  along: Vector3;
  /** Size (m at R 128) and base height (× the altitude setting). */
  size: number;
  alt: number;
  seed: number;
  puffs: Puff[];
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

/** A cumulus heap: a broad base row, a middle heap and a crown, over a flat base at y = 0. */
function makePuffs(rand: () => number): Puff[] {
  const e = 0.8 + 0.5 * rand(); // elongation
  const puffs: Puff[] = [];
  const add = (x: number, y: number, z: number, r: number): void => {
    puffs.push({ x, y, z, r, phase: rand() * Math.PI * 2 });
  };
  for (let i = 0; i < 4; i++) add((i / 3 - 0.5) * 1.5 * e + (rand() - 0.5) * 0.2, 0.16 + 0.06 * rand(), (rand() - 0.5) * 0.5, 0.34 + 0.1 * rand());
  for (let i = 0; i < 3; i++) add((i / 2 - 0.5) * 0.85 * e + (rand() - 0.5) * 0.2, 0.42 + 0.14 * rand(), (rand() - 0.5) * 0.35, 0.38 + 0.12 * rand());
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
  };
}

function quad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

interface Placed {
  cluster: Cluster;
  /** Fade of the last, fractional cloud (0..1). */
  fade: number;
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
  private clusters: Cluster[] = [];
  private seed = Number.NaN;
  private readonly placed: Placed[] = Array.from({ length: MAX_CLOUDS }, () => ({ cluster: null as unknown as Cluster, fade: 1, up: new Vector3(), along: new Vector3(), distance: 0 }));
  private readonly order: Placed[] = [];
  private readonly p = new Vector3();
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
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    gpuMemory.set('cloud shadow map', shadowSize * shadowSize * 8);
    uniforms.uCloudShadowMap.value = this.shadowTarget.texture;

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
      uniforms: { uCloudData: uniforms.uCloudData, uCloudSunA: uniforms.uCloudSunA, uCloudSunB: uniforms.uCloudSunB, uCloudLook: uniforms.uCloudLook },
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const shadowMesh = new Mesh(this.shadowGeometry, shadowMaterial);
    shadowMesh.frustumCulled = false;
    this.shadowScene = new Scene().add(shadowMesh);
  }

  private build(seed: number): void {
    const rand = rng(seed ^ 0x5eed);
    const tangent = (at: Vector3): Vector3 => {
      const t = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
      return t.addScaledVector(at, -t.dot(at)).normalize();
    };
    // banks spread evenly; their clouds in order, so any prefix holds whole banks
    this.clusters = [];
    for (const bank of spreadDirections(rand, MAX_CLOUDS)) {
      const heading = tangent(bank);
      const size = 13 + 8 * rand();
      const members = 1 + Math.floor(rand() * rand() * 4);
      for (let m = 0; m < members && this.clusters.length < MAX_CLOUDS; m++) {
        const along = heading.clone().applyAxisAngle(bank, (rand() - 0.5) * 0.8);
        this.clusters.push({
          bank,
          offset: m === 0 ? heading.clone() : tangent(bank),
          reach: m === 0 ? 0 : 1.1 + 0.9 * rand(),
          along,
          size: size * (m === 0 ? 1 : 0.6 + 0.35 * rand()),
          alt: 0.75 + 0.5 * rand(),
          seed: (hash32(seed + this.clusters.length * 131) % 9973) + 7,
          puffs: makePuffs(rand),
        });
      }
      if (this.clusters.length >= MAX_CLOUDS) break;
    }
    this.seed = seed;
  }

  /** Each cloud's bounding sphere now (planet space), nearest the camera first. */
  bounds(): Array<{ centre: Vector3; radius: number }> {
    const data = this.uniforms.uCloudData.value.image.data as Float32Array;
    return Array.from({ length: this.count }, (_, row) => {
      const o = row * COLUMNS * 4;
      return { centre: new Vector3(data[o], data[o + 1], data[o + 2]), radius: data[o + 3] };
    });
  }

  /**
   * Place the clouds for this frame, write them for the shaders (nearest the
   * camera first) and render their shadow map.
   */
  update(renderer: WebGLRenderer, seed: number, radius: number, time: number, p: CloudParams, windAxis: Vector3, sunDir: Vector3, camera: PerspectiveCamera): void {
    if (seed !== this.seed) this.build(seed);
    const scale = radius / 128;
    const wanted = clamp((COUNT[0] + (COUNT[1] - COUNT[0]) * p.coverage) * scale, 0, MAX_CLOUDS);
    const n = Math.ceil(wanted - 1e-6);
    const sizeScale = Math.sqrt(scale);
    // drift: about a meter and a half a second at the default speed
    const speed = 0.4 + 3.2 * p.speed;
    this.order.length = 0;
    for (let i = 0; i < n; i++) {
      const c = this.clusters[i];
      const at = this.placed[i];
      at.cluster = c;
      at.fade = clamp(wanted - i, 0, 1);
      const height = radius + p.altitude * c.alt * Math.pow(scale, 0.35);
      const angle = (time * speed) / height;
      const away = (c.reach * c.size * sizeScale) / radius;
      at.up.copy(c.bank).multiplyScalar(Math.cos(away)).addScaledVector(c.offset, Math.sin(away)).applyAxisAngle(windAxis, angle);
      at.along.copy(c.along).applyAxisAngle(windAxis, angle);
      at.along.addScaledVector(at.up, -at.along.dot(at.up)).normalize();
      at.distance = this.p.copy(at.up).multiplyScalar(height).distanceTo(camera.position);
      this.order.push(at);
    }
    this.order.sort((a, b) => a.distance - b.distance);

    const data = this.uniforms.uCloudData.value.image.data as Float32Array;
    let top = 0;
    this.order.forEach((at, row) => {
      const c = at.cluster;
      const size = c.size * sizeScale * (0.35 + 0.65 * at.fade);
      const base = radius + p.altitude * c.alt * Math.pow(scale, 0.35);
      const across = this.across.crossVectors(at.up, at.along);
      const o = row * COLUMNS * 4;
      // bounding sphere about the heap's middle
      this.centre.copy(at.up).multiplyScalar(base + 0.45 * size);
      let reach = 0;
      c.puffs.forEach((puff, k) => {
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
      data[o + 8] = c.seed;
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
