import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  Group,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector4,
  type IUniform,
  type Texture,
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

/** Selected nodes drawn with one material: their own copy of the node data, instanced over the shared grid. */
class SurfacePart {
  readonly data: Float32Array;
  readonly instances: InstancedInterleavedBuffer;
  readonly geometry = new InstancedBufferGeometry();
  readonly mesh: Mesh;
  count = 0;

  constructor(capacity: number, material: ShaderMaterial) {
    this.data = new Float32Array(capacity * NODE_FLOATS);
    this.instances = new InstancedInterleavedBuffer(this.data, NODE_FLOATS, 1);
    this.instances.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aNode', new InterleavedBufferAttribute(this.instances, 4, 0));
    this.geometry.setAttribute('aLod', new InterleavedBufferAttribute(this.instances, 4, 4));
    this.geometry.instanceCount = 0;
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** Upload the nodes gathered into `data` since the last call. */
  commit(): void {
    this.instances.clearUpdateRanges();
    this.instances.addUpdateRange(0, this.count * NODE_FLOATS);
    this.instances.needsUpdate = true;
    this.geometry.instanceCount = this.count;
  }
}

/**
 * The planet's ground: every selected CDLOD node, instanced in two draws.
 * Terrain is evaluated in the vertex shader from rest-space directions
 * (terrain.glsl), so a node needs no CPU data beyond where it is. Nodes the
 * homestead shapes or shades (flagged by the selection) are drawn with its
 * code; the rest, most of the planet, with a build of the same shaders
 * without it (AWAY_FROM_HOME): the same pixels, but a smaller shader runs
 * faster everywhere, even where the code it drops would never have run.
 */
export class Surface {
  /** Add to the scene. */
  readonly mesh = new Group();
  readonly selection = new ChunkSelection();
  private readonly near: SurfacePart;
  private readonly away: SurfacePart;
  private grid = 0;
  readonly uniforms: { uGridSteps: IUniform<number>; uNearField: IUniform<Vector4>; uFlowersBuilt: IUniform<Texture | null>; uFlowerCells: IUniform<number> };

  /** The meadow's ground by default; another planet passes its own shaders (terraces/surface.*.glsl). */
  constructor(shared: Record<string, IUniform>, grid: number, shaders: { name: string; vertexShader: string; fragmentShader: string } = { name: 'surface', vertexShader, fragmentShader }) {
    this.uniforms = {
      uGridSteps: { value: grid - 1 },
      uNearField: { value: new Vector4(0, 1, 0, 0.001) },
      // which flower tiles are built (Flowers' builtMap): the paint's flowers give way to them only once they are
      uFlowersBuilt: { value: null },
      uFlowerCells: { value: 0 },
    };
    const uniforms = { ...shared, ...this.uniforms };
    const material = (away: boolean): ShaderMaterial =>
      new ShaderMaterial({ name: away ? `${shaders.name} (away from home)` : shaders.name, vertexShader: shaders.vertexShader, fragmentShader: shaders.fragmentShader, uniforms, defines: away ? { AWAY_FROM_HOME: 1 } : {} });
    this.near = new SurfacePart(this.selection.capacity, material(false));
    this.away = new SurfacePart(this.selection.capacity, material(true));
    this.setGrid(grid);
    this.mesh.add(this.near.mesh, this.away.mesh);
  }

  setGrid(grid: number): void {
    if (grid === this.grid) return;
    this.grid = grid;
    const patch = createGrid(grid);
    for (const part of [this.near, this.away]) {
      part.geometry.setAttribute('position', patch.getAttribute('position'));
      part.geometry.setIndex(patch.getIndex());
    }
    this.uniforms.uGridSteps.value = grid - 1;
  }

  update(view: LodView, cfg: LodConfig): void {
    this.setGrid(cfg.grid);
    const sel = this.selection;
    sel.select(view, cfg);
    this.near.count = 0;
    this.away.count = 0;
    const d = sel.data;
    for (let k = 0; k < sel.count; k++) {
      const o = k * NODE_FLOATS;
      const part = d[o + 7] > 0.5 ? this.near : this.away;
      const to = part.count++ * NODE_FLOATS;
      for (let f = 0; f < NODE_FLOATS; f++) part.data[to + f] = d[o + f];
    }
    this.near.commit();
    this.away.commit();
  }

  get triangles(): number {
    return this.selection.count * 2 * (this.grid - 1) ** 2;
  }
}
