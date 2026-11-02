import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CubeReadback } from '../../terraces/bakeReader';
import { readGrid, type Grid } from '../../terraces/build/grid';
import { labelGrid, type Layout } from '../../terraces/build/labels';
import { buildMesh, CROSSINGS } from '../../terraces/build/mesh';
import { generateTerraceLayout, TerraceTerrain } from '../../terraces/terrain';

// The terraces' build (build/), on a small planet with the bake read from the
// fields themselves: the faces agree on every sample they share, and every
// boundary crosses its grid edge where its own field says (none falls on an
// edge's middle for want of a zero: a label the fields disagree with draws a
// staircase), so neighbouring pieces meet exactly.

const terrain = new TerraceTerrain(generateTerraceLayout(7));
terrain.update(40, { hills: 13, forest: 0.1 }, 1);
const base = { natural: 0, slope: 0, wild: 0, flat: 0 };
const bake = {
  size: 64,
  sample4(d: Vector3, out: Float32Array): Float32Array {
    const b = terrain.fields.base(d, base);
    out[0] = b.natural;
    out[1] = b.slope;
    out[2] = b.wild;
    out[3] = b.flat;
    return out;
  },
} as unknown as CubeReadback;
const g = new Vector3();
const gradient = {
  size: 64,
  sample4(d: Vector3, out: Float32Array): Float32Array {
    terrain.fields.naturalGrad(d, g);
    out[0] = g.x;
    out[1] = g.y;
    out[2] = g.z;
    out[3] = 0;
    return out;
  },
} as unknown as CubeReadback;

function run<T>(job: Generator<void, T, void>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

for (const k of Object.keys(CROSSINGS)) delete CROSSINGS[k];
const grid: Grid = run(readGrid(bake, gradient, terrain.radius, 65));
const layout: Layout = run(labelGrid(grid, terrain.plots, 7, terrain.seasonFront, () => 1e9));
const meshes = run(buildMesh(grid, layout, 7));

describe("the terraces' build", () => {
  it('builds paddies and their walls', () => {
    expect(layout.paddies.length).toBeGreaterThan(20);
    expect(meshes.filter((m) => m !== null).length).toBeGreaterThan(10);
  });

  it('gives every sample two faces share one label on both', () => {
    const seen = new Map<number, number>();
    let shared = 0;
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < grid.n * grid.n; k++) {
        const g = grid.gid[f][k];
        const l = layout.label[f][k];
        const before = seen.get(g);
        if (before === undefined) seen.set(g, l);
        else {
          shared++;
          // (labels are indices into one list of paddies: the same paddy, the same index)
          expect(l).toBe(before);
        }
      }
    }
    // (the cube's twelve edges, each sample on one seen from both faces: its corners from three)
    expect(shared).toBeGreaterThan(12 * 60);
  });

  it('crosses every edge on its boundary, never on the middle for want of a zero', () => {
    let hits = 0;
    let misses = 0;
    for (const [kind, [hit, miss]] of Object.entries(CROSSINGS)) {
      hits += hit;
      // (the land's edge can fall between two samples a yard or the river cuts off: a few)
      if (kind !== 'land' && kind !== 'flats') misses += miss;
    }
    expect(hits).toBeGreaterThan(500);
    expect(misses).toBe(0);
  });
});
