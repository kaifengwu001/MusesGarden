import {
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenMesh } from '../render/fullscreen';
import fragmentShader from './fieldMap.frag.glsl?raw';

// The ground around the focus, evaluated once per frame into three small
// textures so vegetation never re-runs the terrain, cloud or wind noise per
// vertex. All are an azimuthal equidistant projection centred on the focus
// direction: texel (x, y) ∈ [-1, 1]² lies at angle |(x, y)|·Θ from the focus,
// bearing atan2(y, x) in the focus tangent frame.
//   ground: height (m), signed distance to the shore (m), clearing, bloom
//   meadow: lushness, wetness, cloud shadow, colour variant
//   wind:   shared bend vector (xyz, planet space), wind sheen 0..1

export interface FieldUniforms {
  uFieldMap: IUniform;
  uFieldMeadow: IUniform;
  uFieldWind: IUniform;
  /** Focus direction xyz, angular radius Θ. */
  uFieldCentre: IUniform<Vector4>;
  /** Tangent t1 of the focus frame (t2 = centre × t1). */
  uFieldT1: IUniform<Vector3>;
}

function target(size: number): WebGLRenderTarget {
  return new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
}

export class FieldMap {
  readonly ground: WebGLRenderTarget;
  readonly meadow: WebGLRenderTarget;
  readonly wind: WebGLRenderTarget;
  readonly uniforms: FieldUniforms;
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly pass: { value: number };
  /** Radius covered by the map, m. */
  radiusMeters = 48;

  constructor(shared: Record<string, IUniform>, size: number) {
    this.ground = target(size);
    this.meadow = target(size);
    this.wind = target(size);
    gpuMemory.set('field map', 3 * size * size * 8);
    this.uniforms = {
      uFieldMap: { value: this.ground.texture },
      uFieldMeadow: { value: this.meadow.texture },
      uFieldWind: { value: this.wind.texture },
      uFieldCentre: { value: new Vector4(0, 1, 0, 0.3) },
      uFieldT1: { value: new Vector3(1, 0, 0) },
    };
    this.pass = { value: 0 };
    const material = new ShaderMaterial({
      name: 'field map',
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: { ...shared, ...this.uniforms, uFieldSize: { value: size }, uFieldPass: this.pass },
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new Scene().add(fullscreenMesh(material));
  }

  /** Centre the maps on the focus and re-evaluate the ground. */
  render(renderer: WebGLRenderer, focus: Vector3, forward: Vector3, radius: number): void {
    const theta = Math.min(this.radiusMeters / radius, 2.6);
    this.uniforms.uFieldCentre.value.set(focus.x, focus.y, focus.z, theta);
    this.uniforms.uFieldT1.value.copy(forward);
    const previous = renderer.getRenderTarget();
    this.pass.value = 0;
    renderer.setRenderTarget(this.ground);
    renderer.render(this.scene, this.camera);
    this.pass.value = 1;
    renderer.setRenderTarget(this.meadow);
    renderer.render(this.scene, this.camera);
    this.pass.value = 2;
    renderer.setRenderTarget(this.wind);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }
}
