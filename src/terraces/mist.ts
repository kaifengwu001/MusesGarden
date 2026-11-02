import {
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  Matrix3,
  Matrix4,
  MaxEquation,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RGFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { hash32 } from '../core/hash';
import type { PlanetField } from './build/field';
import mistFragment from './mist.frag.glsl?raw';
import mistVertex from './mist.vert.glsl?raw';
import mistStrokeFragment from './mistStroke.frag.glsl?raw';
import mistStrokeVertex from './mistStroke.vert.glsl?raw';
import { makeStrokes, type StrokeParams } from './mistStrokes';

// The terraces' mist (Kai, 2026-11-02: the paintings' meandering bands of mist; "meander between hills instead of
// across the whole planet"; "branch and merge"; then, of the blue-green landscape, "match as close as possible":
// lower, denser, its meanders less simple and mechanical, its widths growing and shrinking as the painting's; then
// one layer, a little more in it, no shadows, translucent by its breadth). A shell round the planet at its height
// over the land's form; its bands are strokes, each brushed as the painting's ribbons are (mistStrokes.ts):
// meandering as a river does, steered round the hills, swelling and pinching, scalloped, pointed at its tail, now and
// then curled at its end, forking, stacked. They are drawn once a seed into a cube map as the distance from their
// edges and their breadth there (mistStroke.*.glsl: every segment's, the greatest kept), drift with the wind (the
// lookup turned about the wind's axis), and are painted as the paintings paint their mist (mist.frag.glsl), the
// thinner the more translucent. The hills rise through the layer, and it thins where the ground comes up to it. The
// paddies' water reflects it (mist.glsl `mistReflected`).

/** The layer: its height (m) over the land's form, and how far that form follows the hills (0: the land's broadest form alone, BROAD_FORM, the hills rising through; 1: the hills' form too, HILL_FORM, the layer lying over them); its strokes; its drift (× the panel's speed). */
export interface MistLayer extends StrokeParams {
  readonly height: number;
  readonly follow: number;
  readonly drift: number;
}

/**
 * One layer (Kai: the layers' overlapping did not look good; one, with a little more in it): 2 m over a form 60 % of
 * the way from the land's broadest to the hills', so it lies in the valleys and up the hills' sides, the hilltops
 * rising through it; 137 strokes (52 of them branches or siblings) covering 16.5 % of the planet seen from above (the
 * largest of the three layers before, 122 and 14.5 %).
 */
export const MIST: MistLayer = { height: 2, follow: 0.6, strokes: 170, half: 2.9, length: [50, 140], wavelength: [30, 55], sinuosity: [0.2, 1.75], curl: 0.4, branch: 0.35, stack: 0.3, lobe: 3, steer: 0.04, drift: 0.4 };


/** The forms the layers lie over: the hills' octaves this broad and broader (m), the land's broadest form and the hills'. */
const BROAD_FORM = 200;
const HILL_FORM = 60;

/** A layer's cube map's side, and the ground's raster's (texels a cube face). */
const BANDS = 512;
const GROUND = 96;
/** How far past a stroke's edge its distance is drawn (m), and the offset the cube maps keep distances at (m: none drawn is 0, −10 m). */
const MARGIN = 2;
const OFFSET = 10;

/** Each face of the cube maps (the GL cube-map convention, as bake.frag.glsl): a direction's coordinates on it are (across, up) / out. */
const FACES = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
].map(([u, v, m]) => new Matrix3().set(u.x, v.x, m.x, u.y, v.y, m.y, u.z, v.z, m.z));

export class TerraceMist {
  /** For the shared uniforms (the ground and the paddies' water read them): the strokes, the layer's drift and settings, the ground's height. */
  readonly uniforms: Record<string, IUniform>;
  /** The layer's shell; add to the scene. */
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  /** The last bake's strokes (dev stats). */
  strokes = { strokes: 0, children: 0, segments: 0, area: 0 };
  private readonly bands = new WebGLCubeRenderTarget(BANDS, { type: HalfFloatType, format: RGFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  private readonly ground: DataTexture;
  /** The same raster, at full precision, for the strokes' placement: per texel the ground's height, the land's broadest form, the hills' form. */
  private readonly groundCpu = new Float32Array(3 * 6 * GROUND * GROUND);
  private bakedFor = Number.NaN;
  private groundFor = Number.NaN;
  /** The wind's axis and the coverage the strokes were made for (made again if either changes). */
  private readonly bakedAxis = new Vector3();
  private bakedCoverage = Number.NaN;
  private bakedHeight = Number.NaN;
  /** The height and coverage last asked for, and when either last changed (ms). */
  private height = MIST.height;
  private wantCoverage = Number.NaN;
  private changedAt = 0;
  private readonly bake: ShaderMaterial;
  private readonly bakeMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly bakeScene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly turn = new Matrix4();

  constructor(shared: Record<string, IUniform>) {
    gpuMemory.set('mist strokes', 6 * BANDS * BANDS * 4);
    this.ground = new DataTexture(new Uint16Array(4 * GROUND * 6 * GROUND), GROUND, 6 * GROUND, RGBAFormat, HalfFloatType);
    this.ground.minFilter = LinearFilter;
    this.ground.magFilter = LinearFilter;
    this.ground.wrapS = ClampToEdgeWrapping;
    this.ground.wrapT = ClampToEdgeWrapping;
    this.uniforms = {
      uMistBands: { value: this.bands.texture },
      uMistDrift: { value: new Matrix3() },
      uMistLayer: { value: new Vector4(MIST.height, MIST.follow, OFFSET, 1) },
      uMistGround: { value: this.ground },
    };
    Object.assign(shared, this.uniforms);
    // (every segment of the strokes splatted as the distance from its edge and its breadth there, the greatest kept)
    this.bake = new ShaderMaterial({
      name: 'mist strokes',
      vertexShader: mistStrokeVertex,
      fragmentShader: mistStrokeFragment,
      uniforms: { uCubeFace: { value: new Matrix3() }, uShell: { value: 128 }, uMargin: { value: MARGIN }, uOffset: { value: OFFSET } },
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    this.bakeMesh = new Mesh(new InstancedBufferGeometry(), this.bake);
    this.bakeMesh.frustumCulled = false;
    this.bakeScene = new Scene().add(this.bakeMesh);
    this.mesh = new Mesh(
      new SphereGeometry(1, 192, 96),
      new ShaderMaterial({
        name: 'mist',
        vertexShader: mistVertex,
        fragmentShader: mistFragment,
        uniforms: { ...shared },
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /**
   * Make and draw a seed's strokes (again if the wind turns, or the coverage or the height changes: a moment after the
   * last change, so a slider's drag does not make them at every step) and the ground's height (once a seed), then set
   * the layer for now: its height (at once) and density (the panel's sliders), its drift.
   */
  update(renderer: WebGLRenderer, seed: number, field: PlanetField, R: number, time: number, coverage: number, speed: number, windAxis: Vector3, height: number, density: number): void {
    // (the share of the strokes shown: all of them at 0.72, 0.625 at the panel's default 0.45)
    const shown = Math.round(Math.min(Math.max(coverage / 0.72, 0), 1) * 100) / 100;
    if (seed !== this.groundFor) {
      this.bakeGround(field);
      this.groundFor = seed;
    }
    const now = performance.now();
    if (height !== this.height || shown !== this.wantCoverage) {
      this.height = height;
      this.wantCoverage = shown;
      this.changedAt = now;
    }
    const settled = now - this.changedAt > 300;
    if (seed !== this.bakedFor || this.bakedAxis.dot(windAxis) < 0.9999 || (settled && (shown !== this.bakedCoverage || height !== this.bakedHeight))) {
      this.bakeStrokes(renderer, seed, R, windAxis, shown, height);
      this.bakedFor = seed;
      this.bakedAxis.copy(windAxis);
      this.bakedCoverage = shown;
      this.bakedHeight = height;
    }
    (this.uniforms.uMistLayer.value as Vector4).set(height, MIST.follow, OFFSET, density);
    // (its lookup turned back about the wind's axis as far as the wind has carried it: the strokes go with the wind)
    const angle = (time * (0.4 + 3.2 * speed) * MIST.drift) / (R + height);
    (this.uniforms.uMistDrift.value as Matrix3).setFromMatrix4(this.turn.makeRotationAxis(windAxis, -angle));
  }

  /** The strokes, made (mistStrokes.ts) and drawn into the cube map, a face at a time. */
  private bakeStrokes(renderer: WebGLRenderer, seed: number, R: number, windAxis: Vector3, shown: number, height: number): void {
    const previous = renderer.getRenderTarget();
    const shell = R + height;
    // (how far the layer clears the ground, read from the ground's raster as the mist's paint reads it)
    const g = [0, 0, 0];
    const clearance = (d: readonly number[]): number => {
      this.groundAt(d, g);
      return height + g[1] + (g[2] - g[1]) * MIST.follow - g[0];
    };
    const made = makeStrokes(MIST, hash32((seed + 0x3157) >>> 0), shell, [windAxis.x, windAxis.y, windAxis.z], clearance, shown);
    this.strokes = { strokes: made.strokes, children: made.children, segments: made.count, area: Math.round(made.area) };
    const segments = new InstancedInterleavedBuffer(made.data, 8, 1);
    const quads = new InstancedBufferGeometry();
    quads.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quads.setIndex([0, 1, 2, 0, 2, 3]);
    quads.setAttribute('aA', new InterleavedBufferAttribute(segments, 3, 0));
    quads.setAttribute('aB', new InterleavedBufferAttribute(segments, 3, 3));
    quads.setAttribute('aH', new InterleavedBufferAttribute(segments, 2, 6));
    quads.instanceCount = made.count;
    const was = this.bakeMesh.geometry;
    this.bakeMesh.geometry = quads;
    this.bake.uniforms.uShell.value = shell;
    for (let f = 0; f < 6; f++) {
      (this.bake.uniforms.uCubeFace.value as Matrix3).copy(FACES[f]);
      renderer.setRenderTarget(this.bands, f);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      if (made.count > 0) renderer.render(this.bakeScene, this.camera);
    }
    this.bakeMesh.geometry = was;
    quads.dispose();
    renderer.setRenderTarget(previous);
  }

  /** The ground's height, the land's broadest form and the hills' form (m over the radius) on a raster a cube face, the six stacked (mist.glsl mistGround reads them). */
  private bakeGround(field: PlanetField): void {
    const data = this.ground.image.data as Uint16Array;
    const d = new Vector3();
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j < GROUND; j++) {
        for (let i = 0; i < GROUND; i++) {
          const u = (2 * (i + 0.5)) / GROUND - 1;
          const v = (2 * (j + 0.5)) / GROUND - 1;
          if (face === 0) d.set(1, u, v);
          else if (face === 1) d.set(-1, u, v);
          else if (face === 2) d.set(u, 1, v);
          else if (face === 3) d.set(u, -1, v);
          else if (face === 4) d.set(u, v, 1);
          else d.set(u, v, -1);
          d.normalize();
          const k = (face * GROUND + j) * GROUND + i;
          const h = field.height(d.x, d.y, d.z);
          const broad = field.smooth(d.x, d.y, d.z, BROAD_FORM);
          const hills = field.smooth(d.x, d.y, d.z, HILL_FORM);
          data[4 * k] = DataUtils.toHalfFloat(h);
          data[4 * k + 1] = DataUtils.toHalfFloat(broad);
          data[4 * k + 2] = DataUtils.toHalfFloat(hills);
          this.groundCpu[3 * k] = h;
          this.groundCpu[3 * k + 1] = broad;
          this.groundCpu[3 * k + 2] = hills;
        }
      }
    }
    this.ground.needsUpdate = true;
  }

  /** The ground's raster at a direction, bilinear between its texels' middles, as mist.glsl mistGround reads it (the ground's height, the land's broadest form, the hills' form, into out). */
  private groundAt(d: readonly number[], out: number[]): number[] {
    const [x, y, z] = d;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let face: number;
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) [face, u, v] = [x > 0 ? 0 : 1, y / ax, z / ax];
    else if (ay >= az) [face, u, v] = [y > 0 ? 2 : 3, x / ay, z / ay];
    else [face, u, v] = [z > 0 ? 4 : 5, x / az, y / az];
    const fx = Math.min(Math.max(((u + 1) / 2) * GROUND - 0.5, 0), GROUND - 1.001);
    const fy = Math.min(Math.max(((v + 1) / 2) * GROUND - 0.5, 0), GROUND - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const g = this.groundCpu;
    const k00 = 3 * ((face * GROUND + j) * GROUND + i);
    const k10 = k00 + 3;
    const k01 = k00 + 3 * GROUND;
    const k11 = k01 + 3;
    for (let c = 0; c < 3; c++) out[c] = (g[k00 + c] * (1 - tx) + g[k10 + c] * tx) * (1 - ty) + (g[k01 + c] * (1 - tx) + g[k11 + c] * tx) * ty;
    return out;
  }
}
