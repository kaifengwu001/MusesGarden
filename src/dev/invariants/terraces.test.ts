import { describe, expect, it } from 'vitest';
import { Bands } from '../../terraces/build/bands';
import { BUILD, buildTerraces, PART } from '../../terraces/build/construct';
import { FIELD, PlanetField } from '../../terraces/build/field';
import { SphereGrid, type Field } from '../../terraces/build/sphere';

// The terraces' planet is mathematics (build/field.ts) and its terraces the
// paddy lab's construction on it (build/): the field's gradient is its own
// (not differences of heights), the cube faces' grid shares every edge, every
// outline's point lies on its level's field (found on the field itself, never
// interpolated), and a small planet builds paddies, banks, cuts, woods and
// flats from it, with a bank along every step between two farmed floors.

const seed = 0x51ce7a;
const field = new PlanetField({ ...FIELD, radius: 40, seed });
const dirs: Array<[number, number, number]> = [];
for (let i = 0; i < 400; i++) {
  const z = 1 - (2 * (i + 0.5)) / 400;
  const r = Math.sqrt(1 - z * z);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  dirs.push([r * Math.cos(a), r * Math.sin(a), z]);
}

describe("the terraces' mathematics", () => {
  it("gives the hills' and the terrace field's gradients exactly (against centimetre differences)", () => {
    const g = new Float64Array(3);
    const e = 0.01 / field.R;
    let worst = 0;
    for (const [x, y, z] of dirs) {
      for (const f of [(px: number, py: number, pz: number, out?: Float64Array) => field.height(px, py, pz, out), (px: number, py: number, pz: number, out?: Float64Array) => field.terrace(px, py, pz, out)]) {
        f(x, y, z, g);
        // (along two tangents: the difference over a centimetre either way)
        const t1 = [-z, 0, x];
        const l1 = Math.hypot(...t1) || 1;
        const a = t1.map((v) => v / l1);
        const b = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]];
        for (const t of [a, b]) {
          const at = (s: number): number => {
            const px = x + t[0] * s;
            const py = y + t[1] * s;
            const pz = z + t[2] * s;
            const l = Math.hypot(px, py, pz);
            return f(px / l, py / l, pz / l);
          };
          const diff = (at(e) - at(-e)) / 0.02;
          worst = Math.max(worst, Math.abs(diff - (g[0] * t[0] + g[1] * t[1] + g[2] * t[2])));
        }
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("finds every outline's point on its level's field, the faces' shared edges and all", () => {
    const grid = new SphereGrid(40, 0.9);
    const T = new Float64Array(grid.V);
    const D = grid.dir;
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < grid.V; v++) {
      T[v] = field.terrace(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      lo = Math.min(lo, T[v]);
      hi = Math.max(hi, T[v]);
    }
    const levels = field.levels(lo, hi);
    const G = (k: number, x: number, y: number, z: number, t: number): number => t - levels[k] - field.wander(k, x, y, z);
    const Gv = (k: number, v: number): number => G(k, D[3 * v], D[3 * v + 1], D[3 * v + 2], T[v]);
    const terrace: Field = (x, y, z) => field.terrace(x, y, z);
    const bands = new Bands(grid, levels, G, Gv, T, terrace, 100);
    const chains = bands.trace();
    expect(chains.length).toBeGreaterThan(50);
    const p = [0, 0, 0];
    let worst = 0;
    let points = 0;
    for (const c of chains) {
      const H = bands.H(c.level)[0];
      for (const id of c.pts) {
        grid.point(id, p);
        worst = Math.max(worst, Math.abs(H(p[0], p[1], p[2])));
        points++;
      }
    }
    expect(points).toBeGreaterThan(5000);
    // (half a millimetre along an edge, the root's own tolerance: at most this far off the level in height)
    expect(worst).toBeLessThan(5e-4);
  });

  it('builds a small planet: paddies, banks, cuts, woods and flats', { timeout: 60000 }, () => {
    const out = buildTerraces({ seed, field: { ...FIELD, radius: 30 }, params: BUILD });
    expect(out.stats.paddies).toBeGreaterThan(200);
    expect(out.stats.banks).toBeGreaterThan(20);
    expect(out.stats.cutLines).toBeGreaterThan(100);
    // (every step between two farmed floors has a bank along it, within 12 cm: none left bare)
    expect(out.bare.length).toBe(0);
    const parts = new Set<number>();
    for (const c of out.chunks) if (c) for (let i = 0; i < c.part.length; i++) parts.add(c.part[i]);
    for (const part of [PART.floor, PART.riser, PART.bund, PART.ridge]) expect(parts.has(part)).toBe(true);
    // (every vertex on the planet, within its hills' relief)
    for (const c of out.chunks) {
      if (!c) continue;
      for (let i = 0; i < c.position.length; i += 3) {
        const r = Math.hypot(c.position[i], c.position[i + 1], c.position[i + 2]);
        expect(Math.abs(r - 30)).toBeLessThan(FIELD.relief + 2);
      }
    }
  });
});
