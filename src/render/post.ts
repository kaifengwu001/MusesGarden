import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import bloomFragment from './bloom.frag.glsl?raw';
import { fullscreenMesh, fullscreenVertex } from './fullscreen';
import fragmentShader from './post.frag.glsl?raw';

const LEVELS = 4; // 1/2, 1/4, 1/8, 1/16

/** The part of a target drawn, as uv (xy), and the farthest uv a lookup may reach in it (zw: the last texel's centre, as the edge clamps). */
function extent(out: Vector4, view: Vector2, target: WebGLRenderTarget): void {
  const x = view.x / target.width;
  const y = view.y / target.height;
  out.set(x, y, x - 0.5 / target.width, y - 0.5 / target.height);
}

function target(type: typeof HalfFloatType | typeof UnsignedByteType, samples = 0, depth = false): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { type, depthBuffer: depth, stencilBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter, samples });
}

/**
 * The frame pipeline: the scene renders into a linear HDR target (MSAA where
 * affordable), a small bloom chain picks up the highlights (glints, snow,
 * cloud rims, white petals), and the final grade draws to the canvas. The
 * targets are the canvas's size; the render scale draws into the lower-left
 * part of them (setView) and the grade spreads that over the canvas, so a
 * change of scale reallocates nothing and never clears the canvas.
 */
export class Post {
  readonly target: WebGLRenderTarget;
  private readonly bytesPerPixel: number;
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly uniforms: {
    tScene: { value: Texture };
    tBloom: { value: Texture };
    uBloom: { value: number };
    uGrain: { value: number };
    uGrade: { value: Vector2 };
    uCurve: { value: number };
    /** The part of the scene target and of the first bloom level drawn (uv), and the farthest a lookup may go in each (uv). */
    uSceneExtent: { value: Vector4 };
    uBloomExtent: { value: Vector4 };
  };
  private readonly levels: WebGLRenderTarget[] = [];
  private readonly bloomScene: Scene;
  private readonly bloomMaterial: ShaderMaterial;
  private readonly bloomUniforms = { tSource: { value: null as Texture | null }, uTexel: { value: new Vector2() }, uExtent: { value: new Vector4(1, 1, 1, 1) }, uMode: { value: 0 }, uThreshold: { value: 0.88 } };
  /** The part of each target drawn (px): the scene target's, then each bloom level's. */
  private readonly view = new Vector2(1, 1);
  private readonly levelViews: Vector2[] = [];
  bloomEnabled = true;
  bloomStrength = 0.22;

  constructor(private readonly renderer: WebGLRenderer) {
    const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const type = halfFloat ? HalfFloatType : UnsignedByteType;
    this.bytesPerPixel = halfFloat ? 8 : 4;
    this.target = target(type, 0, true);
    for (let k = 0; k < LEVELS; k++) {
      this.levels.push(target(type));
      this.levelViews.push(new Vector2(1, 1));
    }
    this.uniforms = {
      tScene: { value: this.target.texture },
      tBloom: { value: this.levels[0].texture },
      uBloom: { value: 0 },
      uGrain: { value: 0.02 },
      uGrade: { value: new Vector2(1, 1) },
      uCurve: { value: 1 },
      uSceneExtent: { value: new Vector4(1, 1, 1, 1) },
      uBloomExtent: { value: new Vector4(1, 1, 1, 1) },
    };
    const material = new ShaderMaterial({ name: 'post', vertexShader: fullscreenVertex, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.scene = new Scene().add(fullscreenMesh(material));
    this.bloomMaterial = new ShaderMaterial({ name: 'bloom', vertexShader: fullscreenVertex, fragmentShader: bloomFragment, uniforms: this.bloomUniforms, depthTest: false, depthWrite: false });
    this.bloomScene = new Scene().add(fullscreenMesh(this.bloomMaterial));
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
    let bloomBytes = 0;
    for (let k = 0; k < LEVELS; k++) {
      const w = Math.max(1, width >> (k + 1));
      const h = Math.max(1, height >> (k + 1));
      this.levels[k].setSize(w, h);
      bloomBytes += w * h * this.bytesPerPixel;
    }
    const colour = this.bytesPerPixel * (samples > 0 ? samples + 1 : 1); // MSAA buffer + resolve
    const depth = 4 * Math.max(samples, 1);
    gpuMemory.set('scene target', width * height * (colour + depth));
    gpuMemory.set('bloom chain', bloomBytes);
    this.setView(width, height);
  }

  /** Draw the coming frames into the lower-left width × height of the targets (px), the render scale's share. */
  setView(width: number, height: number): void {
    const t = this.target;
    this.view.set(Math.max(1, Math.min(width, t.width)), Math.max(1, Math.min(height, t.height)));
    t.viewport.set(0, 0, this.view.x, this.view.y);
    extent(this.uniforms.uSceneExtent.value, this.view, t);
    for (let k = 0; k < LEVELS; k++) {
      const level = this.levels[k];
      const v = this.levelViews[k];
      v.set(Math.max(1, Math.min(level.width, Math.round(this.view.x / 2 ** (k + 1)))), Math.max(1, Math.min(level.height, Math.round(this.view.y / 2 ** (k + 1)))));
      level.viewport.set(0, 0, v.x, v.y);
    }
    extent(this.uniforms.uBloomExtent.value, this.levelViews[0], this.levels[0]);
  }

  /**
   * Render the scene and grade it to the canvas: its highlights' bloom and the painterly tone curve (unless a planet
   * does without them), paper grain, and contrast and brightness in display space.
   */
  render(scene: Object3D, camera: Camera, grain: number, contrast = 1, brightness = 1, curve = true, bloom = true): void {
    const r = this.renderer;
    const bloomOn = this.bloomEnabled && bloom;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    if (bloomOn) this.renderBloom();
    r.setRenderTarget(null);
    this.uniforms.uGrain.value = grain;
    this.uniforms.uGrade.value.set(contrast, brightness);
    this.uniforms.uCurve.value = curve ? 1 : 0;
    this.uniforms.uBloom.value = bloomOn ? this.bloomStrength : 0;
    r.render(this.scene, this.camera);
  }

  private renderBloom(): void {
    const r = this.renderer;
    const u = this.bloomUniforms;
    const pass = (source: WebGLRenderTarget, view: Vector2, dest: WebGLRenderTarget, mode: number, additive: boolean): void => {
      u.tSource.value = source.texture;
      u.uTexel.value.set(1 / source.width, 1 / source.height);
      extent(u.uExtent.value, view, source);
      u.uMode.value = mode;
      this.bloomMaterial.blending = additive ? AdditiveBlending : NoBlending;
      r.setRenderTarget(dest);
      if (!additive) r.clear(true, false, false);
      r.render(this.bloomScene, this.camera);
    };
    const autoClear = r.autoClear;
    r.autoClear = false;
    pass(this.target, this.view, this.levels[0], 0, false);
    for (let k = 1; k < LEVELS; k++) pass(this.levels[k - 1], this.levelViews[k - 1], this.levels[k], 1, false);
    for (let k = LEVELS - 1; k > 0; k--) pass(this.levels[k], this.levelViews[k], this.levels[k - 1], 2, true);
    r.autoClear = autoClear;
  }

  /**
   * Compile every program before the first frame: the scene against the HDR
   * target (the output colour space is part of each program's key), then the
   * bloom chain and the grade.
   */
  async warm(scene: Object3D, camera: Camera): Promise<void> {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    await r.compileAsync(scene, camera);
    r.setRenderTarget(this.levels[0]);
    await r.compileAsync(this.bloomScene, this.camera);
    r.setRenderTarget(null);
    await r.compileAsync(this.scene, this.camera);
  }
}
