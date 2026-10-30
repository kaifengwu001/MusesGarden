import { BufferAttribute, DoubleSide, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import fragmentShader from './butterfly.frag.glsl?raw';
import vertexShader from './butterfly.vert.glsl?raw';

// Butterflies over the flowers, when you are down in the meadow. They live on
// the planet, not around the camera: space is cut into 3 m cells, and a cell
// whose jittered point falls in a 3 m shell about the water table holds a
// candidate (so candidates are spread evenly over the surface, one per
// 9 m²); a candidate becomes a butterfly with a chance that follows the
// flowers there and the bloom. The block of cells about the focus is drawn
// as instances, everything about each butterfly worked out in the vertex
// shader from its cell's hash: where it lives, its kind and colours, and its
// flight, a closed-form function of time (a wandering, bobbing flutter about
// its home, now and then a rest on a flower with its wings fanning), so a
// frozen frame is a pure function of state. They fade out toward the edge of
// the block, and away altogether as you rise above the meadow.

/** Cell size (m), and the block's half extent in cells. */
const CELL = 3;
const HALF = 8;

/** Butterfly uniforms: the focus's cell (planet space) and direction; cell size, half extent, fade radius (m), visibility. */
export interface ButterflyUniforms {
  uButterflyCell: IUniform<Vector3>;
  uButterflyFocus: IUniform<Vector3>;
  uButterflies: IUniform<Vector4>;
}

export class Butterflies {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly uniforms: ButterflyUniforms = {
    uButterflyCell: { value: new Vector3() },
    uButterflyFocus: { value: new Vector3(0, 1, 0) },
    uButterflies: { value: new Vector4(CELL, HALF, CELL * HALF * 0.85, 0) },
  };

  constructor(shared: Record<string, IUniform>) {
    // two wings, hinged along the body (local z): x out from the body, z forward
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.6, 0, 0, 0.6, 0, 0, -0.5, -1, 0, -0.5, -1, 0, 0.6, 0, 0, 0.6]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    g.instanceCount = (2 * HALF + 1) ** 3;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'butterflies', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Centre the block on the focus point (planet space, m); `visible` 0..1 fades them all. */
  update(focus: Vector3, visible: number): void {
    this.uniforms.uButterflyCell.value.set(Math.floor(focus.x / CELL), Math.floor(focus.y / CELL), Math.floor(focus.z / CELL));
    this.uniforms.uButterflyFocus.value.copy(focus).normalize();
    this.uniforms.uButterflies.value.w = visible;
    this.mesh.visible = visible > 0.01;
  }
}
