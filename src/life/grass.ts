import { BufferAttribute, DoubleSide, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector4, type IUniform } from 'three';
import { salt } from '../core/hash';
import { smoothstep } from '../core/math';
import fragmentShader from './grass.frag.glsl?raw';
import vertexShader from './grass.vert.glsl?raw';
import { ScatterLayer, type ScatterView } from './scatter';

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

export const GRASS_FADE = { fullRadius: 0.35, keepAtEdge: 0.16 };

export class Grass {
  readonly mesh: Mesh;
  readonly layer: ScatterLayer;
  readonly uniforms: { uPageSize: IUniform<number>; uPages: IUniform; uGrass: IUniform<Vector4>; uGrassFade: IUniform<Vector4> };
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
    this.geometry.setAttribute('aDir', this.layer.aDir);
    this.geometry.setAttribute('aBirth', this.layer.aBirth);
    this.geometry.instanceCount = 0;
    this.uniforms = {
      uPageSize: { value: 2048 },
      uPages: { value: this.layer.pageTexture },
      uGrass: { value: new Vector4(0.42, 0.05, 24, 0) },
      uGrassFade: { value: new Vector4(8, GRASS_FADE.keepAtEdge, 0, 0) },
    };
    // Blades bend and turn in the wind; draw both sides (no extra vertex work).
    const material = new ShaderMaterial({ name: 'grass', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Fraction of full density kept at distance d (must match the shader). */
  static keep(d: number, near: number): number {
    return 1 + (GRASS_FADE.keepAtEdge - 1) * smoothstep(near * GRASS_FADE.fullRadius, near, d);
  }

  update(view: Omit<ScatterView, 'falloff'>, height: number): void {
    const near = view.near;
    this.layer.update({ ...view, falloff: (d) => Grass.keep(d, near) });
    this.geometry.instanceCount = this.layer.instanceCount;
    this.uniforms.uGrass.value.set(height, 0.05, near, Math.log(view.density));
    this.uniforms.uGrassFade.value.set(near * GRASS_FADE.fullRadius, GRASS_FADE.keepAtEdge, 0, 0);
    this.mesh.visible = near > 0.5 && view.density > 0;
  }
}
