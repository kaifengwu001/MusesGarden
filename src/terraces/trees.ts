import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Mesh, ShaderMaterial, type IUniform } from 'three';
import { gpuMemory } from '../core/gpuMemory';
import fragmentShader from './tree.frag.glsl?raw';
import vertexShader from './tree.vert.glsl?raw';

// The forest: a tree where the terraces' build placed one (build/
// construct.ts: on its woods, the slopes too steep to terrace, standing on
// the woods' own ground, the hills' height). Each tree is one billboard; its
// fragment shader traces a crown of a few lumpy spheres and a trunk, lit in
// soft bands with a dark painted edge, and writes its true depth, as the
// clouds do (tree.frag.glsl).

export class Trees {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Trees placed. */
  count = 0;
  /** The trees the terraces' build placed (per tree: direction, ground, seed). */
  placed: Float32Array | null = null;
  private readonly projection = { value: new Matrix4() };

  constructor(shared: Record<string, IUniform>) {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    const material = new ShaderMaterial({ name: 'trees', vertexShader, fragmentShader, uniforms: { ...shared, uProjection: this.projection } });
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    // (projectionMatrix is not declared in fragment shaders: the depth each tree writes needs it)
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.projection.value.copy(camera.projectionMatrix);
    };
  }

  /** The trees the terraces' build placed (direction, ground, seed per tree). */
  place(trees: Float32Array): void {
    this.placed = trees;
    const n = trees.length / 5;
    const a = new Float32Array(4 * n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a.set(trees.subarray(5 * i, 5 * i + 4), 4 * i);
      b[i] = trees[5 * i + 4];
    }
    const g = this.mesh.geometry;
    g.setAttribute('aTree', new InstancedBufferAttribute(a, 4));
    g.setAttribute('aSeed', new InstancedBufferAttribute(b, 1));
    g.instanceCount = n;
    this.count = n;
    gpuMemory.set('terraces trees', a.byteLength + b.byteLength);
  }
}
