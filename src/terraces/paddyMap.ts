import { Color, DoubleSide, HalfFloatType, NearestFilter, OrthographicCamera, RGBAFormat, ShaderMaterial, Vector3, Vector4, WebGLRenderTarget, type Group, type IUniform, type Material, type Mesh, type WebGLRenderer } from 'three';
import { gpuMemory } from '../core/gpuMemory';
import fragmentShader from './paddyMap.frag.glsl?raw';
import vertexShader from './paddyMap.vert.glsl?raw';

// The paddies round the focus as a map the rice reads (rice.ts): the built
// terraces (objects.ts) drawn from above into an azimuthal map (laid out as
// the meadow's field map is), each texel the paddy there: its plants'
// height, its floor, its colour and stage. Drawn again only when the focus
// has moved on or the terraces were built anew.

export const PADDY_MAP = { size: 1024, radius: 34 } as const;

const clearColour = new Color();

export class PaddyMap {
  readonly target: WebGLRenderTarget;
  readonly uniforms: { uPaddyMap: IUniform; uMapCentre: IUniform<Vector4>; uMapT1: IUniform<Vector3> };
  private readonly material: ShaderMaterial;
  private readonly camera = new OrthographicCamera();
  private readonly drawnAt = new Vector3(0, 0, 0);
  private drawnFor = '';

  constructor(shared: Record<string, IUniform>) {
    this.target = new WebGLRenderTarget(PADDY_MAP.size, PADDY_MAP.size, { type: HalfFloatType, format: RGBAFormat, depthBuffer: true, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
    gpuMemory.set('paddy map', PADDY_MAP.size * PADDY_MAP.size * 12);
    this.uniforms = { uPaddyMap: { value: this.target.texture }, uMapCentre: { value: new Vector4(0, 1, 0, 0.2) }, uMapT1: { value: new Vector3(1, 0, 0) } };
    this.material = new ShaderMaterial({ name: 'paddy map', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide });
  }

  /** Draw the terraces round the focus into the map (when it has moved on, or the terraces are new: key). */
  render(renderer: WebGLRenderer, terraces: Group, focus: Vector3, forward: Vector3, radius: number, key: string): void {
    if (key === this.drawnFor && focus.distanceTo(this.drawnAt) * radius < 0.5) return;
    this.drawnFor = key;
    this.drawnAt.copy(focus);
    this.uniforms.uMapCentre.value.set(focus.x, focus.y, focus.z, PADDY_MAP.radius / radius);
    this.uniforms.uMapT1.value.copy(forward);
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColour);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    // every mesh of the terraces drawn with the map's material, none culled (the map's vertex shader places them;
    // culled against this camera's frustum, a box at the planet's middle, every chunk was left out and the map
    // stayed empty: no rice grew)
    const own: Array<[Mesh, Material | Material[], boolean]> = [];
    for (const child of terraces.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      own.push([mesh, mesh.material, mesh.frustumCulled]);
      mesh.material = this.material;
      mesh.frustumCulled = false;
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(terraces, this.camera);
    renderer.autoClear = autoClear;
    for (const [mesh, material, culled] of own) {
      mesh.material = material;
      mesh.frustumCulled = culled;
    }
    renderer.setClearColor(clearColour, alpha);
    renderer.setRenderTarget(previous);
  }
}
