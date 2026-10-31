import {
  Matrix4,
  NearestFilter,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenMesh, fullscreenVertex } from '../render/fullscreen';
import fragmentShader from './waterMask.frag.glsl?raw';
import growFragment from './waterMaskGrow.frag.glsl?raw';

/** Screen pixels a side of a cell of the mask. */
export const MASK_CELL = 8;
/** The most the mask grows (cells). */
const MAX_GROW = 40;

function target(): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { format: RedFormat, type: UnsignedByteType, depthBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
}

/**
 * Where on screen a lake can read the clouds' mirror (clouds.ts): a map of
 * cells of MASK_CELL² pixels, set where the camera's rays meet the water table
 * on wet ground (waterMask.frag.glsl), then grown by as far as the wind's
 * ruffle can move a lake's lookup in the mirror (cloudsInMirror), so the
 * mirror pass shades only the cells set. Found from the camera and the bake,
 * not drawn: no second pass over the terrain.
 */
export class WaterMask {
  private readonly cells = target();
  private readonly across = target();
  private readonly grown = target();
  private readonly scene: Scene;
  private readonly growScene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly uniforms = { uRayFrame: { value: new Matrix4() }, uEye: { value: new Vector3() }, uView: { value: new Vector2(1, 1) }, uReach: { value: 1000 } };
  private readonly growUniforms = { tMask: { value: null as Texture | null }, uAxis: { value: new Vector2() }, uCells: { value: 0 }, uSize: { value: new Vector2(1, 1) } };
  private readonly size = new Vector2();

  constructor(shared: Record<string, IUniform>) {
    const material = new ShaderMaterial({
      name: 'water mask',
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
      defines: { MASK_CELL },
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new Scene().add(fullscreenMesh(material));
    const grow = new ShaderMaterial({
      name: 'water mask grow',
      vertexShader: fullscreenVertex,
      fragmentShader: growFragment,
      uniforms: this.growUniforms,
      defines: { MAX_GROW },
      depthTest: false,
      depthWrite: false,
    });
    this.growScene = new Scene().add(fullscreenMesh(grow));
  }

  /** The grown mask, a texel a cell (read with texelFetch at the pixel / MASK_CELL). */
  get texture(): Texture {
    return this.grown.texture;
  }

  /**
   * Mark the cells for this frame. full: the size of the screen's targets
   * (pixels); view: the part of them drawn this frame; spread: how far a
   * lake's lookup can move from its pixel (pixels).
   */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera, full: Vector2, view: Vector2, spread: number): void {
    const w = Math.ceil(full.x / MASK_CELL);
    const h = Math.ceil(full.y / MASK_CELL);
    if (w !== this.size.x || h !== this.size.y) {
      this.size.set(w, h);
      for (const t of [this.cells, this.across, this.grown]) t.setSize(w, h);
      gpuMemory.set('water mask', 3 * w * h);
    }
    const vw = Math.min(w, Math.ceil(view.x / MASK_CELL));
    const vh = Math.min(h, Math.ceil(view.y / MASK_CELL));
    for (const t of [this.cells, this.across, this.grown]) t.viewport.set(0, 0, vw, vh);
    const u = this.uniforms;
    u.uRayFrame.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    u.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    u.uView.value.copy(view);
    u.uReach.value = camera.far;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.cells);
    renderer.render(this.scene, this.camera);
    const g = this.growUniforms;
    g.uCells.value = Math.min(MAX_GROW, Math.ceil(spread / MASK_CELL) + 1);
    g.uSize.value.set(vw, vh);
    g.tMask.value = this.cells.texture;
    g.uAxis.value.set(1, 0);
    renderer.setRenderTarget(this.across);
    renderer.render(this.growScene, this.camera);
    g.tMask.value = this.across.texture;
    g.uAxis.value.set(0, 1);
    renderer.setRenderTarget(this.grown);
    renderer.render(this.growScene, this.camera);
    renderer.setRenderTarget(previous);
  }
}
