import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { salt } from '../core/hash';
import { uvToSphere } from '../planet/cubesphere';
import { enumerateCell } from '../planet/rest';
import fragmentShader from './tree.frag.glsl?raw';
import vertexShader from './tree.vert.glsl?raw';

// The forest (ARCHITECTURE.md, "Land use"): a tree on every point of a
// rest-space point set (a constant number per m² as the planet grows) where
// the land is left wild, so the forest is wherever the land use puts it: the
// hills' crowns, the gullies, steep slopes, the woods, the peaks' flanks.
// The vertex shader reads the land use and the ground from the bake and
// drops the points it does not want. Each tree is one billboard; its
// fragment shader traces a crown of a few lumpy spheres and a trunk, lit in
// soft bands with a dark painted edge, and writes its true depth, as the
// clouds do (tree.frag.glsl).

/** Trees per m² where the forest is full, and the headroom the point set is enumerated to (× R). */
export const TREES = { density: 0.17, headroom: 1.15 } as const;
const treeClass = { salt: salt('terrace trees'), jitter: 0.95 } as const;
const tmp = new Vector3();

export class Trees {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Trees enumerated (the vertex shader keeps those the land use wants). */
  count = 0;
  private enumeratedFor = { seed: -1, radius: 0 };
  private readonly projection = { value: new Matrix4() };

  constructor(shared: Record<string, IUniform>) {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    const material = new ShaderMaterial({ name: 'trees', vertexShader, fragmentShader, uniforms: { ...shared, uProjection: this.projection, uTreeDensity: { value: TREES.density } } });
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    // (projectionMatrix is not declared in fragment shaders: the depth each tree writes needs it)
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.projection.value.copy(camera.projectionMatrix);
    };
  }

  /** Enumerate the point set for this planet (again when it grows past the headroom, shrinks well under it, or the seed changes). */
  update(seed: number, radius: number): void {
    const e = this.enumeratedFor;
    if (e.seed === seed && radius <= e.radius && radius > e.radius / (TREES.headroom * TREES.headroom)) return;
    const R = radius * TREES.headroom;
    const sigma = TREES.density * R * R;
    const dirs: number[] = [];
    const seeds: number[] = [];
    for (let face = 0; face < 6; face++) {
      enumerateCell(treeClass, seed, face, 0, 0, 0, sigma, (p) => {
        uvToSphere(p.face, p.u, p.v, tmp);
        dirs.push(tmp.x, tmp.y, tmp.z, Math.log(p.threshold));
        seeds.push(p.seed / 4294967296);
      });
    }
    const g = this.mesh.geometry;
    const a = new Float32Array(dirs);
    const b = new Float32Array(seeds);
    g.setAttribute('aTree', new InstancedBufferAttribute(a, 4));
    g.setAttribute('aSeed', new InstancedBufferAttribute(b, 1));
    g.instanceCount = seeds.length;
    this.count = seeds.length;
    this.enumeratedFor = { seed, radius: R };
    gpuMemory.set('terraces trees', a.byteLength + b.byteLength);
  }
}
