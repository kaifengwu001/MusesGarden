import { DoubleSide, Mesh, ShaderMaterial, Vector4, type IUniform, type InstancedBufferGeometry } from 'three';
import { salt } from '../core/hash';
import { smoothstep } from '../core/math';
import { SPECIES_MESH } from './flowerMeshes';
import fragmentShader from './grass.frag.glsl?raw';
import vertexShader from './flower.vert.glsl?raw';
import { ScatterLayer, type ScatterView } from './scatter';

// Flowers near the camera. One progressive point set (so the total stays at
// `density` per m² at every size); each point's species comes from the local
// drift, lushness and water, so species mass in drifts rather than salt and
// pepper. Four meshes share the instance pool; each draws only its own.

/** Stem top (m) of each template, where the head pivots; and how far it nods (rad). */
const HEADS: ReadonlyArray<readonly [number, number]> = [
  [0.62, 1.0], // pink cup: a nodding cup
  [0.34, 0.15], // white star: faces up
  [0.16, 0.05], // yellow button
  [0.2, 0.1], // blue cluster
];

export const FLOWER_FADE = { fullRadius: 0.4, keepAtEdge: 0.3 };

export class Flowers {
  readonly layer: ScatterLayer;
  readonly meshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  private readonly shared: { uPageSize: IUniform<number>; uPages: IUniform; uFlowers: IUniform<Vector4> }[] = [];

  constructor(shared: Record<string, IUniform>, pages: number) {
    this.layer = new ScatterLayer({
      name: 'flowers',
      cls: { salt: salt('flowers'), jitter: 0.85 },
      tileMeters: 9,
      pageSize: 1024,
      pages,
      headroom: 1.25,
    });
    SPECIES_MESH.forEach((make, species) => {
      const geometry = make();
      geometry.setAttribute('aDir', this.layer.aDir);
      geometry.setAttribute('aBirth', this.layer.aBirth);
      geometry.instanceCount = 0;
      const own = {
        uPageSize: { value: 1024 },
        uPages: { value: this.layer.pageTexture },
        uFlowers: { value: new Vector4(30, 0, species, 1) },
        uFlowerFade: { value: new Vector4(12, FLOWER_FADE.keepAtEdge, HEADS[species][0], HEADS[species][1]) },
      };
      const material = new ShaderMaterial({
        name: `flowers ${species}`,
        vertexShader,
        fragmentShader,
        uniforms: { ...shared, ...own },
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.meshes.push(mesh);
      this.shared.push(own);
    });
  }

  static keep(d: number, near: number): number {
    return 1 + (FLOWER_FADE.keepAtEdge - 1) * smoothstep(near * FLOWER_FADE.fullRadius, near, d);
  }

  update(view: Omit<ScatterView, 'falloff'>, sizeScale: number): void {
    const near = view.near;
    this.layer.update({ ...view, falloff: (d) => Flowers.keep(d, near) });
    for (let s = 0; s < this.meshes.length; s++) {
      const mesh = this.meshes[s];
      mesh.geometry.instanceCount = this.layer.instanceCount;
      const u = this.shared[s];
      u.uFlowers.value.set(near, Math.log(Math.max(view.density, 1e-6)), s, sizeScale);
      (mesh.material.uniforms.uFlowerFade.value as Vector4).x = near * FLOWER_FADE.fullRadius;
      mesh.visible = near > 0.5 && view.density > 0;
    }
  }
}
