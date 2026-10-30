import { BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector4, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import fragmentShader from './grass.frag.glsl?raw';
import vertexShader from './petal.vert.glsl?raw';

// Petals lifting off: a fixed pool whose every state is a closed-form
// function of time (cycle index and age from a per-petal phase), so frozen
// frames are deterministic. A petal only shows where it spawns among
// flowers, as a gust's crest passes over them (at any wind that has gusts)
// or on the bloom front's edge, within the near field; it takes the colour
// of the flowers there.

const COUNT = 720;

export class Petals {
  readonly mesh: Mesh;
  readonly uniforms: { uPetals: IUniform<Vector4> };

  constructor(shared: Record<string, IUniform>) {
    const g = new InstancedBufferGeometry();
    // a small curled petal: four triangles around a bent spine
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -0.5, 0, -0.35, 0, 0.08, 0, 0.1, 0.12, 0.35, 0, 0.08, 0, 0.5, 0]), 3));
    g.setIndex([0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4]);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seeds[i] = unit(hash32(i * 2654435761 + 7));
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    g.instanceCount = COUNT;
    this.uniforms = { uPetals: { value: new Vector4(25, 0, 0, 0) } };
    const material = new ShaderMaterial({ name: 'petals', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide });
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  update(nearRadius: number): void {
    this.uniforms.uPetals.value.x = nearRadius;
    this.mesh.visible = nearRadius > 1;
  }
}
