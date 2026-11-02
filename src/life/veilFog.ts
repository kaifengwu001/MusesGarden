import {
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type IUniform,
  type Mesh,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenMesh } from '../render/fullscreen';
import { Veil, VEIL } from './veil';
import fieldFragment from './veilField.frag.glsl?raw';
import fragmentShader from './veilFog.frag.glsl?raw';
import vertexShader from './veilFog.vert.glsl?raw';

// The veil drawn as ground fog (veil.ts): a fullscreen pass that marches each view ray through a layer on the
// meadow (veilFog.frag.glsl), wherever the field baked once per planet (veilField.frag.glsl) says the unfolding has
// yet to clear. It is drawn after the ground and the things on it and before the drifting clouds, which pass over
// it. The lakes do not mirror it: it covers the lakes it lies on. Nothing of it is drawn once all is clear.

/**
 * The fog's shape (m, the same on every planet): the top of its lowest banks and of its highest over the ground
 * (beneath the drifting clouds, whose bases are 4–6 m over the water table), its density at the ground (1/m: two
 * meters of it hide nine tenths of what lies behind), and how far its wisps reach above and below the top.
 */
const SHAPE = { low: 2, high: 5.5, density: 1.2, wisps: 1.2 } as const;
/** A face of the field's cube map (texels: about 0.8 m of ground at R 128). */
const FIELD_SIZE = 256;

export class VeilFog {
  readonly veil = new Veil();
  readonly mesh: Mesh;
  private readonly field = new WebGLCubeRenderTarget(FIELD_SIZE, {
    type: HalfFloatType,
    format: RGBAFormat,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  private readonly uniforms = {
    uVeilField: { value: this.field.texture as Texture },
    uVeil: { value: new Vector4() },
    uVeilShape: { value: new Vector4(SHAPE.low, SHAPE.high, SHAPE.density, SHAPE.wisps) },
    uProjection: { value: new Matrix4() },
  };
  private readonly bakeCamera = new OrthographicCamera();
  /** The wind the wisps were drawn out along (rebaked when it turns). */
  private readonly wind = new Vector3();

  constructor(shared: Record<string, IUniform>) {
    gpuMemory.set('veil field', 6 * FIELD_SIZE * FIELD_SIZE * 8);
    const material = new ShaderMaterial({
      name: 'veil fog',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    // after the ground and what stands on it, the hut's room, the birds and the butterflies; before the clouds
    this.mesh = fullscreenMesh(material);
    this.mesh.renderOrder = 2.5;
    this.mesh.visible = false;
  }

  /**
   * Lay the veil out for this planet (once: the field is baked then, and again when the wind turns), set how far it
   * has cleared (`progress`, 0 … 1) and show it while anything of it is left. `ground`: the highest the ground
   * reaches over the water table (m); `wind`: the wind's rotation axis.
   */
  update(renderer: WebGLRenderer, seed: number, hut: Vector3, progress: number, ground: number, wind: Vector3, camera: PerspectiveCamera): void {
    if (this.veil.build(seed, hut) || !wind.equals(this.wind)) {
      this.wind.copy(wind);
      this.bake(renderer, hut);
    }
    this.veil.progress = progress;
    const on = progress < 1;
    this.mesh.visible = on;
    if (!on) return;
    this.uniforms.uVeil.value.set(this.veil.threshold(progress), VEIL.edge, ground + SHAPE.high + SHAPE.wisps + 0.5, 0);
    this.uniforms.uProjection.value.copy(camera.projectionMatrix);
  }

  /** Bake the field (veilField.frag.glsl) into its cube map, a face at a time. */
  private bake(renderer: WebGLRenderer, hut: Vector3): void {
    const face = { value: 0 };
    const material = new ShaderMaterial({
      name: 'veil field bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: fieldFragment,
      uniforms: { uFace: face, uSize: { value: FIELD_SIZE }, uHut: { value: hut.clone() }, uVeilNoise: { value: this.veil.noise }, uWindAxis: { value: this.wind.clone() } },
      depthTest: false,
      depthWrite: false,
    });
    const scene = new Scene().add(fullscreenMesh(material));
    const previous = renderer.getRenderTarget();
    for (let f = 0; f < 6; f++) {
      face.value = f;
      renderer.setRenderTarget(this.field, f);
      renderer.render(scene, this.bakeCamera);
    }
    renderer.setRenderTarget(previous);
    material.dispose();
  }
}
