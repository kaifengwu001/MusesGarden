import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector4,
  type IUniform,
} from 'three';
import { ChunkSelection, NODE_FLOATS, type LodConfig, type LodView } from './chunks';
import fragmentShader from './surface.frag.glsl?raw';
import vertexShader from './surface.vert.glsl?raw';

/** A grid × grid vertex patch over [0,1]², split along the (x,y)→(x+1,y+1) diagonals. */
export function createGrid(grid: number): BufferGeometry {
  const positions = new Float32Array(grid * grid * 3);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = (y * grid + x) * 3;
      positions[i] = x / (grid - 1);
      positions[i + 1] = y / (grid - 1);
    }
  }
  const index = new Uint16Array((grid - 1) * (grid - 1) * 6);
  let o = 0;
  for (let y = 0; y < grid - 1; y++) {
    for (let x = 0; x < grid - 1; x++) {
      const a = y * grid + x;
      const b = a + 1;
      const c = a + grid;
      const d = c + 1;
      index.set([a, b, d, a, d, c], o);
      o += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/**
 * The planet's ground: every selected CDLOD node in one instanced draw.
 * Terrain is evaluated in the vertex shader from rest-space directions
 * (terrain.glsl), so a node needs no CPU data beyond where it is.
 */
export class Surface {
  readonly mesh: Mesh;
  readonly selection = new ChunkSelection();
  private readonly geometry: InstancedBufferGeometry;
  private readonly instances: InstancedInterleavedBuffer;
  private grid = 0;
  readonly uniforms: { uGridSteps: IUniform<number>; uNearField: IUniform<Vector4> };

  constructor(shared: Record<string, IUniform>, grid: number) {
    this.instances = new InstancedInterleavedBuffer(this.selection.data, NODE_FLOATS, 1);
    this.instances.setUsage(DynamicDrawUsage);
    this.geometry = new InstancedBufferGeometry();
    this.uniforms = { uGridSteps: { value: grid - 1 }, uNearField: { value: new Vector4(0, 1, 0, 0.001) } };
    this.setGrid(grid);
    this.geometry.setAttribute('aNode', new InterleavedBufferAttribute(this.instances, 4, 0));
    this.geometry.setAttribute('aLod', new InterleavedBufferAttribute(this.instances, 4, 4));
    this.geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      name: 'surface',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  setGrid(grid: number): void {
    if (grid === this.grid) return;
    this.grid = grid;
    const patch = createGrid(grid);
    this.geometry.setAttribute('position', patch.getAttribute('position'));
    this.geometry.setIndex(patch.getIndex());
    this.uniforms.uGridSteps.value = grid - 1;
  }

  update(view: LodView, cfg: LodConfig): void {
    this.setGrid(cfg.grid);
    this.selection.select(view, cfg);
    this.instances.clearUpdateRanges();
    this.instances.addUpdateRange(0, this.selection.count * NODE_FLOATS);
    this.instances.needsUpdate = true;
    this.geometry.instanceCount = this.selection.count;
  }

  get triangles(): number {
    return this.selection.count * 2 * (this.grid - 1) ** 2;
  }
}
