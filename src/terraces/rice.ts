import {
  BufferAttribute,
  DoubleSide,
  HalfFloatType,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { salt } from '../core/hash';
import { smoothstep } from '../core/math';
import fragmentShader from '../life/grass.frag.glsl?raw';
import { ScatterLayer, type ScatterLook, type ScatterView } from '../life/scatter';
import { fullscreenMesh } from '../render/fullscreen';
import dataShader from './riceData.frag.glsl?raw';
import vertexShader from './rice.vert.glsl?raw';

// The rice near the camera (Kai's note after the second pass: rice plants,
// long blades of grass for now): a blade per point of a rest-space point set
// where a paddy has a crop, built in tiles round the focus as the meadow's
// grass is (life/scatter.ts), thinned toward the edge of the near field where
// the ground's paint takes over. Before the blades are drawn, a pass works
// out each drawn blade's paddy once (its plants' height, its floor, its
// colour and stage) and the wind on it, into two textures the blades read:
// the paddy's layout is far too much work to run again at every vertex.

/** Blades per m² at full density, their width (m), the near field's radius (m), and the most pages drawn at once. */
export const RICE = { density: 120, width: 0.034, near: 24, maxPages: 256, fade: { full: 0.45, edge: 0.24 } } as const;
const PAGE = 2048;

/** A blade template: x across [-0.5, 0.5], y up [0, 1], narrowing to its tip. */
function bladeGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const levels = [0, 0.4, 0.75];
  const widths = [1, 0.85, 0.55];
  const pos: number[] = [];
  levels.forEach((y, k) => pos.push(-0.5 * widths[k], y, 0, 0.5 * widths[k], y, 0));
  pos.push(0, 1, 0);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  return g;
}

function dataTarget(): WebGLRenderTarget {
  return new WebGLRenderTarget(PAGE, RICE.maxPages, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
}

export class Rice {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly layer: ScatterLayer;
  readonly uniforms: {
    uPageSize: IUniform<number>;
    uPool: IUniform;
    uPoolRest: IUniform;
    uPageList: IUniform;
    uRiceCrop: IUniform;
    uRiceWind: IUniform;
    uRice: IUniform<Vector4>;
    uRiceFade: IUniform<Vector4>;
  };
  private readonly crop = dataTarget();
  private readonly wind = dataTarget();
  private readonly pass = { value: 0 };
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();

  constructor(shared: Record<string, IUniform>, pages: number) {
    this.layer = new ScatterLayer({ name: 'rice', cls: { salt: salt('rice'), jitter: 0.95 }, tileMeters: 6, pageSize: PAGE, pages, headroom: 1.25 });
    gpuMemory.set('rice blades', 2 * PAGE * RICE.maxPages * 8);
    this.uniforms = {
      uPageSize: { value: PAGE },
      uPool: { value: this.layer.mainTextures[0] },
      uPoolRest: { value: this.layer.restTextures[0] },
      uPageList: { value: this.layer.listTextures[0] },
      uRiceCrop: { value: this.crop.texture },
      uRiceWind: { value: this.wind.texture },
      uRice: { value: new Vector4(RICE.width, RICE.near, Math.log(RICE.density), 0.6) },
      uRiceFade: { value: new Vector4(RICE.near * RICE.fade.full, RICE.fade.edge, 0, 0) },
    };
    const geometry = bladeGeometry();
    geometry.instanceCount = 0;
    // blades bend and turn in the wind: both sides, shading per vertex (grass.frag.glsl)
    const material = new ShaderMaterial({ name: 'rice', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -20; // before the ground: early-z skips the ground's shading under blades
    const data = new ShaderMaterial({
      name: 'rice per blade',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: dataShader,
      uniforms: { ...shared, uPool: this.uniforms.uPool, uPageList: this.uniforms.uPageList, uPass: this.pass },
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new Scene().add(fullscreenMesh(data));
  }

  /** Fraction of full density kept at distance d (must match rice.vert.glsl and the ground's paint). */
  static keep(d: number, near: number): number {
    if (near <= 0) return 0;
    return 1 + (RICE.fade.edge - 1) * smoothstep(near * RICE.fade.full, near, d);
  }

  update(renderer: WebGLRenderer, view: Omit<ScatterView, 'falloff' | 'ahead' | 'density'> & { ahead?: Omit<ScatterLook, 'falloff'> }, near: number, sheen: number): void {
    const keep = (d: number): number => Rice.keep(d, near);
    this.layer.update({ ...view, near, density: RICE.density, falloff: keep, ahead: view.ahead && { ...view.ahead, falloff: (d) => Rice.keep(d, view.ahead?.near ?? 0) } });
    const pages = Math.min(this.layer.instanceCount / PAGE, RICE.maxPages);
    this.mesh.geometry.instanceCount = pages * PAGE;
    this.uniforms.uRice.value.set(RICE.width, near, Math.log(RICE.density), sheen);
    this.uniforms.uRiceFade.value.set(near * RICE.fade.full, RICE.fade.edge, 0, 0);
    this.mesh.visible = near > 0.5 && pages > 0;
    if (!this.mesh.visible) return;
    // each drawn blade's paddy and wind, a row per drawn page
    const previous = renderer.getRenderTarget();
    for (const [target, pass] of [
      [this.crop, 0],
      [this.wind, 1],
    ] as const) {
      this.pass.value = pass;
      target.viewport.set(0, 0, PAGE, pages);
      target.scissor.set(0, 0, PAGE, pages);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(previous);
  }
}
