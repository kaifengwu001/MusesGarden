import { BufferAttribute, Color, DoubleSide, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector4, type IUniform } from 'three';
import { ROW, type Palette } from '../render/palette';
import { salt } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import fragmentShader from '../../../src/life/grass.frag.glsl?raw';
import vertexShader from './grass.vert.glsl?raw';
import { ScatterLayer, type ScatterLook, type ScatterView } from '../../../src/life/scatter';

// Near-field grass: instanced blades (7 vertices) on the grass point set,
// fading into the painted meadow at the edge of the near field.

/** Blade template: x across [-0.5, 0.5], y up [0, 1]. */
function bladeGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const levels = [0, 0.36, 0.7];
  const widths = [1, 0.8, 0.5];
  const pos: number[] = [];
  levels.forEach((y, k) => pos.push(-0.5 * widths[k], y, 0, 0.5 * widths[k], y, 0));
  pos.push(0, 1, 0);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  return g;
}

/** Palette cells the blades use, in uGrassPal order (see grass.vert.glsl). */
const GRASS_COLOURS: ReadonlyArray<readonly [number, number]> = [
  [ROW.GRASS, 0], // 0 light
  [ROW.GRASS, 3], // 1 sunlit tips
  [ROW.GRASS, 1], // 2 mid
  [ROW.BRUSH, 1], // 3 brush mid
  [ROW.GRASS, 5], // 4 deep shade
  [ROW.GRASS, 2], // 5 shade
  [ROW.BUD, 1], // 6 bud tip
  [ROW.BUD, 0], // 7 bud green
  [ROW.LIGHT, 3], // 8 rim
  [ROW.GRASS, 8], // 9 wind sheen
];

/** How the blades thin toward the edge of their radius (a tier's grassFade). */
export interface GrassFade {
  readonly full: number;
  readonly edge: number;
}

export class Grass {
  readonly mesh: Mesh;
  readonly layer: ScatterLayer;
  readonly uniforms: { uPageSize: IUniform<number>; uPool: IUniform; uPoolRest: IUniform; uPageList: IUniform; uGrass: IUniform<Vector4>; uGrassFade: IUniform<Vector4>; uGrassPal: IUniform<Color[]> };
  private readonly geometry: InstancedBufferGeometry;

  constructor(shared: Record<string, IUniform>, pages: number) {
    this.layer = new ScatterLayer({
      name: 'grass',
      cls: { salt: salt('grass'), jitter: 0.95 },
      tileMeters: 6,
      pageSize: 2048,
      pages,
      headroom: 1.25,
    });
    this.geometry = bladeGeometry();
    this.geometry.instanceCount = 0;
    this.uniforms = {
      uPageSize: { value: 2048 },
      uPool: { value: this.layer.mainTextures[0] },
      uPoolRest: { value: this.layer.restTextures[0] },
      uPageList: { value: this.layer.listTextures[0] },
      uGrass: { value: new Vector4(0.42, 0.05, 24, 0) },
      uGrassFade: { value: new Vector4(8, 0.16, 0, 0) },
      uGrassPal: { value: Array.from({ length: GRASS_COLOURS.length }, () => new Color()) },
    };
    // Blades bend and turn in the wind; draw both sides (no extra vertex work).
    const material = new ShaderMaterial({ name: 'grass', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -20; // before the ground: early-z skips ground shading under blades
  }

  /** Fraction of full density kept at distance d (must match the shader): full out to `fade.full` of the radius, `fade.edge` kept at its edge. */
  static keep(d: number, near: number, fade: GrassFade): number {
    if (near <= 0) return 0;
    return 1 + (fade.edge - 1) * smoothstep(near * fade.full, near, d);
  }

  /** Copy this frame's grass colours from the palette (cheaper than per-vertex fetches). */
  setColours(palette: Palette): void {
    GRASS_COLOURS.forEach(([row, col], k) => palette.get(row, col, this.uniforms.uGrassPal.value[k]));
  }

  update(view: Omit<ScatterView, 'falloff' | 'ahead'> & { fade: GrassFade; ahead?: Omit<ScatterLook, 'falloff'> }, height: number): void {
    const { near, fade, ahead } = view;
    this.layer.update({ ...view, falloff: (d) => Grass.keep(d, near, fade), ahead: ahead && { ...ahead, falloff: (d) => Grass.keep(d, ahead.near, fade) } });
    this.geometry.instanceCount = this.layer.instanceCount;
    this.uniforms.uGrass.value.set(height, 0.05, near, Math.log(view.density));
    this.uniforms.uGrassFade.value.set(near * fade.full, fade.edge, 0, 0);
    this.mesh.visible = near > 0.5 && view.density > 0;
  }
}
