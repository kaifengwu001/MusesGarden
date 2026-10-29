import {
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenMesh, fullscreenVertex } from './fullscreen';
import fragmentShader from './post.frag.glsl?raw';

/**
 * The frame pipeline: the scene renders into a linear HDR target, then the
 * final grade draws it to the canvas. S2 adds the tone curve and highlight
 * bloom here; MSAA is applied to the scene target only when affordable.
 */
export class Post {
  readonly target: WebGLRenderTarget;
  private readonly bytesPerPixel: number;
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly uniforms: { tScene: { value: Texture }; uGrain: { value: number } };

  constructor(private readonly renderer: WebGLRenderer) {
    const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.bytesPerPixel = halfFloat ? 8 : 4;
    this.target = new WebGLRenderTarget(1, 1, {
      type: halfFloat ? HalfFloatType : UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.uniforms = {
      tScene: { value: this.target.texture },
      uGrain: { value: 0.02 },
    };
    const material = new ShaderMaterial({
      name: 'post',
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new Scene().add(fullscreenMesh(material));
  }

  get samples(): number {
    return this.target.samples;
  }

  /** Size in drawing-buffer pixels. */
  setSize(width: number, height: number, samples: number): void {
    if (this.target.samples !== samples) {
      this.target.samples = samples;
      this.target.dispose(); // re-created with the new sample count on next use
    }
    this.target.setSize(width, height);
    const colour = this.bytesPerPixel * (samples > 0 ? samples + 1 : 1); // MSAA buffer + resolve
    const depth = 4 * Math.max(samples, 1);
    gpuMemory.set('scene target', width * height * (colour + depth));
  }

  render(scene: Object3D, camera: Camera, grain: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.uniforms.uGrain.value = grain;
    r.render(this.scene, this.camera);
  }

  /**
   * Compile every program before the first frame: the scene against the HDR
   * target (the output colour space is part of each program's key), then the
   * grade against the canvas.
   */
  async warm(scene: Object3D, camera: Camera): Promise<void> {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    await r.compileAsync(scene, camera);
    r.setRenderTarget(null);
    await r.compileAsync(this.scene, this.camera);
  }
}
