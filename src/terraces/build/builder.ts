import { DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { BuildQueue } from '../../core/buildQueue';
import type { CubeReadback } from '../bakeReader';
import type { TerraceTerrain } from '../terrain';
import fragmentShader from '../terrace.frag.glsl?raw';
import vertexShader from '../terrace.vert.glsl?raw';
import { houseDistance, type Village } from '../villages';
import { GRID, readGrid } from './grid';
import { labelGrid } from './labels';
import { buildMesh } from './mesh';

// The terraces, built (ARCHITECTURE.md, "The terraces' build"): the whole
// planet's at once from the terrain bake (grid.ts), labelled (labels.ts) and
// made into meshes (mesh.ts), a chunk of a cube face each. Never from the
// camera: built again only when the ground is baked anew (the planet's size,
// a parameter, the villages), the new meshes put in place of the old in one
// step once all are ready. The hills' own mesh is sunk under all built land.

export class TerraceBuild {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private builtFor = '';
  /** The ground sinks under the built land within `reach` of `centre` (m): everywhere, once built. */
  reach = 0;
  readonly centre = new Vector3(0, 1, 0);

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'terraces', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
    this.group.name = 'terraces';
  }

  /** Build the planet's terraces if what they depend on changed (key), a step of work at a time on the queue. */
  update(terrain: TerraceTerrain, bakes: { terrain: CubeReadback; gradient: CubeReadback }, villages: readonly Village[], key: string, queue: BuildQueue): void {
    if (key === this.builtFor) return;
    this.builtFor = key;
    queue.add('terraces:build', 0, this.job(terrain, bakes, villages));
  }

  private *job(terrain: TerraceTerrain, bakes: { terrain: CubeReadback; gradient: CubeReadback }, villages: readonly Village[]): Generator<void, void, void> {
    const R = terrain.radius;
    const bake = bakes.terrain;
    // (samples a face side: GRID.spacing apart, no finer than the bake)
    const grid = yield* readGrid(bake, bakes.gradient, R, Math.min(bake.size, Math.ceil((R * Math.PI) / 2 / GRID.spacing)) + 1);
    const yard = (d: Vector3): number => houseDistance(villages, d, R);
    const layout = yield* labelGrid(grid, terrain.plots, terrain.layout.noiseSeed, terrain.seasonFront, yard);
    const geometries = yield* buildMesh(grid, layout, terrain.layout.noiseSeed);
    // in place of the old, all at once
    for (const m of [...this.group.children] as Mesh[]) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    for (const g of geometries) {
      if (!g) continue;
      const mesh = new Mesh(g, this.material);
      mesh.renderOrder = -10; // before the ground: early-z skips the shading of the ground sunk under them
      this.group.add(mesh);
    }
    this.reach = 1e9;
  }

  get triangles(): number {
    let n = 0;
    for (const m of this.group.children as Mesh[]) if (m.geometry.index) n += m.geometry.index.count / 3;
    return n;
  }
}
