import {
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  Group,
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
  RedFormat,
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
// across the whole planet"; "branch and merge"; "multiple layers of mists at different heights and scales"; then, of
// the blue-green landscape, "match as close as possible": lower, denser, its meanders less simple and mechanical, its
// widths growing and shrinking as the painting's). Each layer is a shell round the planet at its own height over the
// land's form; its bands are strokes, each brushed as the painting's ribbons are (mistStrokes.ts): meandering as a
// river does, steered round the hills, swelling and pinching, scalloped, pointed at its tail, now and then curled at
// its end, forking, stacked, merging where they cross. They are drawn once a seed into a cube map a layer as the
// distance from their edges (mistStroke.*.glsl: every segment's, the greatest kept, so strokes that cross merge), each
// layer drifts with the wind at its own pace (its lookup turned about the wind's axis), and is painted as the
// paintings paint their mist (mist.frag.glsl). The hills above a layer rise through it, and it thins where the ground
// comes up to it. The ground reads the same strokes where the sun's ray from it meets each layer, for its shadows
// (mist.glsl `mistShadowAt`).

/** A layer: its height (m) over the land's form, and how far that form follows the hills (0: the land's broadest form alone, BROAD_FORM, the hills rising through; 1: the hills' form too, HILL_FORM, the layer lying over them); its strokes; its density; its drift (× the panel's speed). */
export interface MistLayer extends StrokeParams {
  readonly height: number;
  readonly follow: number;
  readonly density: number;
  readonly drift: number;
}

/**
 * The terraces' three, all low among the hills (Kai: the layers too high up; too sparse; then, 30% fewer): in the
 * valleys, nearly level, the hills rising through it; up the hills' sides, half way to their form; and a few meters
 * over the hills themselves, following their form most of the way. Their strokes the finer the lower: in the valleys
 * short and narrow, winding hard round the hills; over the hills long and broad.
 */
export const MIST_LAYERS: readonly MistLayer[] = [
  { height: -2.5, follow: 0.2, strokes: 60, half: 2, length: [28, 70], wavelength: [22, 36], sinuosity: [0.35, 1.45], curl: 0.4, branch: 0.35, stack: 0.3, lobe: 2.6, steer: 0.05, density: 3.6, drift: 0.2 },
  { height: 0.5, follow: 0.5, strokes: 64, half: 2.4, length: [36, 95], wavelength: [26, 42], sinuosity: [0.35, 1.4], curl: 0.4, branch: 0.35, stack: 0.3, lobe: 2.9, steer: 0.04, density: 3.4, drift: 0.35 },
  { height: 3, follow: 0.85, strokes: 72, half: 2.8, length: [42, 110], wavelength: [30, 48], sinuosity: [0.3, 1.35], curl: 0.35, branch: 0.3, stack: 0.3, lobe: 3.2, steer: 0.03, density: 3.2, drift: 0.5 },
];

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
  /** For the shared uniforms (the ground reads them for its shadows): the strokes, each layer's drift and settings, the ground's height. */
  readonly uniforms: Record<string, IUniform>;
  /** The layers' shells; add to the scene. */
  readonly group = new Group();
  /** The last bake's strokes, per layer (dev stats). */
  readonly strokes: Array<{ strokes: number; children: number; segments: number; area: number }> = [];
  private readonly bands: WebGLCubeRenderTarget[];
  private readonly ground: DataTexture;
  private readonly meshes: Array<Mesh<SphereGeometry, ShaderMaterial>> = [];
  private bakedFor = Number.NaN;
  private groundFor = Number.NaN;
  /** The wind's axis and the coverage the strokes were made for (made again if either changes). */
  private readonly bakedAxis = new Vector3();
  private bakedCoverage = Number.NaN;
  private readonly bake: ShaderMaterial;
  private readonly bakeMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly bakeScene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly turn = new Matrix4();

  constructor() {
    this.bands = MIST_LAYERS.map(
      () => new WebGLCubeRenderTarget(BANDS, { type: HalfFloatType, format: RedFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter }),
    );
    gpuMemory.set('mist strokes', MIST_LAYERS.length * 6 * BANDS * BANDS * 2);
    this.ground = new DataTexture(new Uint16Array(4 * GROUND * 6 * GROUND), GROUND, 6 * GROUND, RGBAFormat, HalfFloatType);
    this.ground.minFilter = LinearFilter;
    this.ground.magFilter = LinearFilter;
    this.ground.wrapS = ClampToEdgeWrapping;
    this.ground.wrapT = ClampToEdgeWrapping;
    this.uniforms = {
      uMistBands0: { value: this.bands[0].texture },
      uMistBands1: { value: this.bands[1].texture },
      uMistBands2: { value: this.bands[2].texture },
      uMistDrift: { value: MIST_LAYERS.map(() => new Matrix3()) },
      uMistLayer: { value: MIST_LAYERS.map(() => new Vector4()) },
      uMistFollow: { value: MIST_LAYERS.map((L) => L.follow) },
      uMistLook: { value: new Vector4(0.88, 0, 0, 0) },
      uMistGround: { value: this.ground },
    };
    // (every segment of a layer's strokes splatted as the distance from its edge, the greatest kept)
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
  }

  /** The layers' shells, once the shared uniforms hold the mist's. */
  makeShells(shared: Record<string, IUniform>): void {
    const sphere = new SphereGeometry(1, 192, 96);
    MIST_LAYERS.forEach((_, i) => {
      const mesh = new Mesh(
        sphere,
        new ShaderMaterial({
          name: `mist ${i}`,
          vertexShader: mistVertex,
          fragmentShader: mistFragment,
          uniforms: { ...shared },
          defines: { MIST_LAYER: i, MIST_OFFSET: OFFSET.toFixed(1) },
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
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
  }

  /** Make and draw a seed's strokes (again if the wind turns or the coverage changes) and the ground's height (once a seed), then set each layer's drift and settings for now. */
  update(renderer: WebGLRenderer, seed: number, field: PlanetField, R: number, time: number, coverage: number, speed: number, shadow: number, windAxis: Vector3, eyeRadius: number): void {
    // (the share of each layer's strokes shown: all of them at 0.72, 0.625 at the panel's default 0.45)
    const shown = Math.round(Math.min(Math.max(coverage / 0.72, 0), 1) * 100) / 100;
    if (seed !== this.groundFor) {
      this.bakeGround(field);
      this.groundFor = seed;
    }
    if (seed !== this.bakedFor || this.bakedAxis.dot(windAxis) < 0.9999 || shown !== this.bakedCoverage) {
      this.bakeStrokes(renderer, seed, field, R, windAxis, shown);
      this.bakedFor = seed;
      this.bakedAxis.copy(windAxis);
      this.bakedCoverage = shown;
    }
    const drift = this.uniforms.uMistDrift.value as Matrix3[];
    const layer = this.uniforms.uMistLayer.value as Vector4[];
    MIST_LAYERS.forEach((L, i) => {
      const shell = R + L.height;
      // (its lookup turned back about the wind's axis as far as the wind has carried it: the strokes go with the wind)
      const angle = (time * (0.4 + 3.2 * speed) * L.drift) / shell;
      drift[i].setFromMatrix4(this.turn.makeRotationAxis(windAxis, -angle));
      layer[i].set(L.height, 0, 0, L.density);
      const mesh = this.meshes[i];
      // (drawn farthest first: the layer farther from the camera's height before the nearer)
      if (mesh) mesh.renderOrder = 3 + Math.round(10 - Math.min(Math.abs(eyeRadius - shell), 100) / 10);
    });
    (this.uniforms.uMistLook.value as Vector4).x = shadow;
  }

  /** Each layer's strokes, made (mistStrokes.ts) and drawn into its cube map, a face at a time. */
  private bakeStrokes(renderer: WebGLRenderer, seed: number, field: PlanetField, R: number, windAxis: Vector3, shown: number): void {
    const previous = renderer.getRenderTarget();
    const geometry = this.bakeMesh.geometry;
    const quad = new InstancedBufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.strokes.length = 0;
    MIST_LAYERS.forEach((L, i) => {
      const shell = R + L.height;
      const clearance = (d: readonly number[]): number => {
        const x = d[0];
        const y = d[1];
        const z = d[2];
        const broad = field.smooth(x, y, z, BROAD_FORM);
        return L.height + broad + (field.smooth(x, y, z, HILL_FORM) - broad) * L.follow - field.height(x, y, z);
      };
      const made = makeStrokes(L, hash32((seed + 0x3157 * (i + 1)) >>> 0), shell, [windAxis.x, windAxis.y, windAxis.z], clearance, shown);
      this.strokes.push({ strokes: made.strokes, children: made.children, segments: made.count, area: Math.round(made.area) });
      const segments = new InstancedInterleavedBuffer(made.data, 8, 1);
      const g = quad.clone();
      g.setAttribute('aA', new InterleavedBufferAttribute(segments, 3, 0));
      g.setAttribute('aB', new InterleavedBufferAttribute(segments, 3, 3));
      g.setAttribute('aH', new InterleavedBufferAttribute(segments, 2, 6));
      g.instanceCount = made.count;
      this.bakeMesh.geometry = g;
      this.bake.uniforms.uShell.value = shell;
      for (let f = 0; f < 6; f++) {
        (this.bake.uniforms.uCubeFace.value as Matrix3).copy(FACES[f]);
        renderer.setRenderTarget(this.bands[i], f);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        if (made.count > 0) renderer.render(this.bakeScene, this.camera);
      }
      g.dispose();
    });
    this.bakeMesh.geometry = geometry;
    quad.dispose();
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
          const q = 4 * ((face * GROUND + j) * GROUND + i);
          data[q] = DataUtils.toHalfFloat(field.height(d.x, d.y, d.z));
          data[q + 1] = DataUtils.toHalfFloat(field.smooth(d.x, d.y, d.z, BROAD_FORM));
          data[q + 2] = DataUtils.toHalfFloat(field.smooth(d.x, d.y, d.z, HILL_FORM));
        }
      }
    }
    this.ground.needsUpdate = true;
  }
}
