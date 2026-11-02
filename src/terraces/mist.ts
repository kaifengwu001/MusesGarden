import {
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
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
import { fullscreenMesh } from '../render/fullscreen';
import type { PlanetField } from './build/field';
import mistBakeFragment from './mistBake.frag.glsl?raw';
import mistFragment from './mist.frag.glsl?raw';
import mistVertex from './mist.vert.glsl?raw';

// The terraces' mist (Kai, 2026-11-02: the paintings' meandering bands of mist; "the curvatures should happen at a
// much smaller scale … so that they meander between hills instead of across the whole planet"; "they should be able
// to branch and merge"; "multiple layers of mists at different heights and scales"). Each layer is a shell at its
// own height round the planet; its bands lie where a winding field of its own is near zero, so they meander as the
// field's zero line does, fork and join where it does, and come and go with a slower field (its presence). The
// hills above a layer rise through it, and it thins where the ground comes up to it, so a low layer lies in the
// valleys and winds between the hills. The fields are baked once a seed into a cube map a layer (mistBake.frag.glsl:
// the distance from the band's middle line, and the presence), each layer drifts with the wind at its own pace (its
// lookup turned about the wind's axis), and is painted as the paintings paint their mist (mist.frag.glsl). The ground
// reads the same bands where the sun's ray from it meets each layer, for its shadows (mist.glsl `mistShadowAt`).

/** A layer: its height over the planet's radius (m); its bands' half-breadth (m); the scale of its network of bands, of their meanders and how far the meanders swing them (m); the scale of its presence (m), and how much of it holds bands before the panel's coverage moves it (0 … 1); its density; its drift (× the panel's speed). */
export interface MistLayer {
  readonly height: number;
  readonly half: number;
  readonly net: number;
  readonly meander: number;
  readonly swing: number;
  readonly presence: number;
  readonly share: number;
  readonly density: number;
  readonly drift: number;
}

/**
 * The terraces' three: a valley mist low among the hills (the ground is under −5 m over two fifths of the planet),
 * a mist at the height of most hilltops, and a high one over them all, long and slow-winding, the towers rising
 * through it. Their meanders turn at 15–30 m, about 40 % of the bands' before (Kai).
 */
export const MIST_LAYERS: readonly MistLayer[] = [
  { height: -5, half: 3.5, net: 46, meander: 15, swing: 5, presence: 45, share: 0.7, density: 3.2, drift: 0.25 },
  { height: 2, half: 4, net: 64, meander: 22, swing: 7, presence: 60, share: 0.6, density: 3.0, drift: 0.6 },
  { height: 16, half: 5, net: 92, meander: 30, swing: 10, presence: 80, share: 0.5, density: 2.6, drift: 1.2 },
];

/** A band field's cube map's side, and the ground's raster's (texels a cube face). */
const BANDS = 512;
const GROUND = 96;

export class TerraceMist {
  /** For the shared uniforms (the ground reads them for its shadows): the bands, each layer's drift and settings, the ground's height. */
  readonly uniforms: Record<string, IUniform>;
  /** The layers' shells; add to the scene. */
  readonly group = new Group();
  private readonly bands: WebGLCubeRenderTarget[];
  private readonly ground: DataTexture;
  private readonly meshes: Array<Mesh<SphereGeometry, ShaderMaterial>> = [];
  private bakedFor = Number.NaN;
  private readonly bake: ShaderMaterial;
  private readonly bakeScene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly turn = new Matrix4();

  constructor() {
    this.bands = MIST_LAYERS.map(
      () => new WebGLCubeRenderTarget(BANDS, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter }),
    );
    gpuMemory.set('mist bands', MIST_LAYERS.length * 6 * BANDS * BANDS * 8);
    this.ground = new DataTexture(new Uint16Array(GROUND * 6 * GROUND), GROUND, 6 * GROUND, RedFormat, HalfFloatType);
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
      uMistLook: { value: new Vector4(0.88, 0, 0, 0) },
      uMistGround: { value: this.ground },
    };
    this.bake = new ShaderMaterial({
      name: 'mist bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: mistBakeFragment,
      uniforms: { uFace: { value: 0 }, uSize: { value: BANDS }, uScales: { value: new Vector4() }, uShell: { value: 128 }, uSeed: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.bakeScene = new Scene().add(fullscreenMesh(this.bake));
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
          uniforms: { ...shared, uShell: { value: 128 } },
          defines: { MIST_LAYER: i },
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

  /** Bake a seed's band fields and the ground's height (once a seed), then set each layer's drift and settings for now. */
  update(renderer: WebGLRenderer, seed: number, field: PlanetField, R: number, time: number, coverage: number, speed: number, shadow: number, windAxis: Vector3, eyeRadius: number): void {
    if (seed !== this.bakedFor) {
      this.bakeBands(renderer, seed, R);
      this.bakeGround(field);
      this.bakedFor = seed;
    }
    const drift = this.uniforms.uMistDrift.value as Matrix3[];
    const layer = this.uniforms.uMistLayer.value as Vector4[];
    // (the panel's coverage moves how much of each layer holds bands, about the terraces' own share: 0.45 by default)
    const more = coverage - 0.45;
    MIST_LAYERS.forEach((L, i) => {
      const shell = R + L.height;
      // (its lookup turned back about the wind's axis as far as the wind has carried it: the bands go with the wind)
      const angle = (time * (0.4 + 3.2 * speed) * L.drift) / shell;
      drift[i].setFromMatrix4(this.turn.makeRotationAxis(windAxis, -angle));
      // (the presence where the bands begin: the field's spread is about ±0.6, so a share s begins near 0.5 − s)
      layer[i].set(L.height, L.half, 0.5 - Math.min(Math.max(L.share + more, 0), 1) * 0.95, L.density);
      const mesh = this.meshes[i];
      if (mesh) {
        mesh.material.uniforms.uShell.value = shell;
        // (drawn farthest first: the layer farther from the camera's height before the nearer)
        mesh.renderOrder = 3 + Math.round(10 - Math.min(Math.abs(eyeRadius - shell), 100) / 10);
      }
    });
    (this.uniforms.uMistLook.value as Vector4).x = shadow;
  }

  /** Each layer's band field into its cube map, a face at a time. */
  private bakeBands(renderer: WebGLRenderer, seed: number, R: number): void {
    const u = this.bake.uniforms;
    const previous = renderer.getRenderTarget();
    MIST_LAYERS.forEach((L, i) => {
      (u.uScales.value as Vector4).set(L.net, L.meander, L.swing, L.presence);
      u.uShell.value = R + L.height;
      u.uSeed.value = hash32((seed + 0x3157 * (i + 1)) >>> 0) % 100000;
      for (let f = 0; f < 6; f++) {
        u.uFace.value = f;
        renderer.setRenderTarget(this.bands[i], f);
        renderer.render(this.bakeScene, this.camera);
      }
    });
    renderer.setRenderTarget(previous);
  }

  /** The ground's height (m over the radius) on a raster a cube face, the six stacked (mist.glsl mistGround reads it). */
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
          data[(face * GROUND + j) * GROUND + i] = DataUtils.toHalfFloat(field.height(d.x, d.y, d.z));
        }
      }
    }
    this.ground.needsUpdate = true;
  }
}
