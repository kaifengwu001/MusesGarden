import {
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenTriangle } from '../render/fullscreen';
import bakeFragment from './channelBake.frag.glsl?raw';
import type { Layout } from './terrain';

// Channels are stored as a direction-space distance field: a cube map whose
// texels hold the angular distance (rad) to the channel centrelines at each
// meander level (r, g, b) and to the branch (a). It is baked once per world on
// the GPU; R-independent, so growth never re-bakes it. Shaders turn angle into
// meters with R, so widths stay in meters at every size.

const MAX_SEGMENTS = 512;

export class ChannelField {
  readonly target: WebGLCubeRenderTarget;
  private readonly segments: DataTexture;
  private readonly segmentData = new Float32Array(MAX_SEGMENTS * 2 * 4);
  private readonly material: ShaderMaterial;
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();
  private bakedFor: Layout | null = null;

  constructor(size: number) {
    this.target = new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      format: RGBAFormat,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    gpuMemory.set('channel field', 6 * size * size * 8);
    this.segments = new DataTexture(this.segmentData, MAX_SEGMENTS * 2, 1, RGBAFormat, FloatType);
    this.segments.minFilter = NearestFilter;
    this.segments.magFilter = NearestFilter;
    this.material = new ShaderMaterial({
      name: 'channel bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: bakeFragment,
      uniforms: {
        uFace: { value: 0 },
        uSize: { value: size },
        uSegments: { value: this.segments },
        uSegmentCount: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(fullscreenTriangle(), this.material);
    mesh.frustumCulled = false;
    this.scene = new Scene().add(mesh);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /** Bake for a layout; a no-op when the layout has not changed. */
  bake(renderer: WebGLRenderer, layout: Layout): void {
    if (this.bakedFor === layout) return;
    this.bakedFor = layout;
    let n = 0;
    const push = (points: readonly Vector3[], level: number): void => {
      for (let i = 0; i + 1 < points.length && n < MAX_SEGMENTS; i++, n++) {
        const a = points[i];
        const b = points[i + 1];
        this.segmentData.set([a.x, a.y, a.z, level, b.x, b.y, b.z, 0], n * 8);
      }
    };
    for (const [l0, l1, l2] of layout.channels) {
      push(l0, 0);
      push(l1, 1);
      push(l2, 2);
    }
    if (layout.branch) push(layout.branch, 3);
    this.segments.needsUpdate = true;
    this.material.uniforms.uSegmentCount.value = n;
    const previous = renderer.getRenderTarget();
    for (let face = 0; face < 6; face++) {
      this.material.uniforms.uFace.value = face;
      renderer.setRenderTarget(this.target, face);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(previous);
  }
}
