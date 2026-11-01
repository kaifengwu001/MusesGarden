import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CubeReadback } from '../../terraces/bakeReader';
import { createCellSample, type CellSample } from '../../terraces/cells';
import { floorPieces } from '../../terraces/floors';
import { chartDir, surveyCell, type CellSurvey } from '../../terraces/survey';
import { generateTerraceLayout, TerraceTerrain } from '../../terraces/terrain';

// The terraces as surveyed (survey.ts: what the built terraces are laid out
// from), the bakes read here from the fields and cells themselves: the cuts
// never cross one another, the floors tile the land without a gap or an
// overlap, a lens lies below its band's floor, and two cells that meet trace
// the same walls up to their shared edge (no fault lines between them).

const terrain = new TerraceTerrain(generateTerraceLayout(7));
terrain.update(128, { hills: 18, forest: 0.15 }, 1);
const R = terrain.radius;
const size = R / terrain.cells.frequency;
const base = { natural: 0, slope: 0, wild: 0, flat: 0 };
const at = createCellSample();
const bakes = {
  terrain: {
    sample(d: Vector3, c: number): number {
      const b = terrain.fields.base(d, base);
      return [b.natural, b.slope, b.wild, b.flat][c];
    },
  },
  layout: {
    nearest: (d: Vector3): number => (terrain.cells.at(d, at).key + 0.5) / 1024,
    sample: (d: Vector3): number => terrain.cells.at(d, at).edge,
  },
} as unknown as { terrain: CubeReadback; layout: CubeReadback };

const survey = (c: CellSample): CellSurvey => surveyCell(c, R, size, bakes.terrain, bakes.layout, terrain.plots, terrain.seasonFront);

/** Terraced hillsides: a cell at each of a few spots of tame, sloping ground, and its neighbour across the slope. */
function hillsides(count: number): Array<[CellSurvey, CellSurvey]> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pairs: Array<[CellSurvey, CellSurvey]> = [];
  const d = new Vector3();
  for (let i = 0; i < 400 && pairs.length < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / 400;
    const r = Math.sqrt(1 - z * z);
    d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
    const b = terrain.fields.base(d, base);
    if (b.wild > 0.25 || b.flat > 0.25 || b.slope < 0.12 || b.slope > 0.5) continue;
    const a = terrain.cells.at(d, createCellSample());
    // the neighbour: past a's edge, along its contours' way
    const q = a.centre.clone().multiplyScalar(R).addScaledVector(a.along, size).normalize();
    const n = terrain.cells.at(q, createCellSample());
    if (n.key === a.key) continue;
    pairs.push([survey(a), survey(n)]);
  }
  return pairs;
}

const pairs = hillsides(3);
const surveys = pairs.flat();

/** Where segment a–b crosses c–d strictly inside both (a cut ending on another touches it, it does not cross). */
function crossesInside(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const e = 1e-4;
  return t > e && t < 1 - e && u > e && u < 1 - e;
}

describe('the terraces as surveyed', () => {
  it('surveys terraced hillsides: walls, cuts and paddies in every cell', () => {
    expect(surveys.length).toBe(6);
    for (const s of surveys) {
      expect(s.walls.length).toBeGreaterThan(5);
      expect(s.cuts.length).toBeGreaterThan(5);
      expect(s.paddies.length).toBeGreaterThan(10);
    }
  });

  it('never lets two cuts of a band cross (one meeting another ends on it)', () => {
    for (const s of surveys) {
      for (let i = 0; i < s.cuts.length; i++) {
        for (let j = 0; j < i; j++) {
          const A = s.cuts[i];
          const B = s.cuts[j];
          if (A.band !== B.band) continue;
          for (let a = 0; a + 3 < A.points.length; a += 2) {
            for (let b = 0; b + 3 < B.points.length; b += 2) {
              const p = A.points;
              const q = B.points;
              expect(crossesInside(p[a], p[a + 1], p[a + 2], p[a + 3], q[b], q[b + 1], q[b + 2], q[b + 3])).toBe(false);
            }
          }
        }
      }
    }
  });

  it('tiles the land with floors: every square inside the land and the cell covered once', () => {
    for (const s of surveys) {
      const { n, g, half, land, side } = s;
      const covered = new Float64Array(n * n);
      floorPieces(
        s,
        (pc) => {
          // its area (shoelace), given to the square under its middle
          let area = 0;
          let cx = 0;
          let cy = 0;
          const m = pc.xy.length / 2;
          for (let v = 0; v < m; v++) {
            const w = (v + 1) % m;
            area += pc.xy[2 * v] * pc.xy[2 * w + 1] - pc.xy[2 * w] * pc.xy[2 * v + 1];
            cx += pc.xy[2 * v] / m;
            cy += pc.xy[2 * v + 1] / m;
          }
          const i = Math.floor((cx + half) / g);
          const j = Math.floor((cy + half) / g);
          covered[j * n + i] += Math.abs(area) / 2;
        },
        (i, j) => {
          covered[j * n + i] += g * g;
        },
      );
      let inside = 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const ks = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
          if (!ks.every((k) => land[k] > 0.3 && side[k] > 0.3)) continue;
          inside++;
          expect(covered[j * n + i]).toBeCloseTo(g * g, 4);
        }
      }
      expect(inside).toBeGreaterThan(500);
    }
  });

  it('lays a lens below its band floor, above its lower wall', () => {
    let lenses = 0;
    for (const s of surveys) {
      for (const p of s.paddies) {
        if (p.floorH === undefined) continue;
        const B = s.bands[p.band];
        lenses++;
        expect(p.floorH).toBeLessThan(B.floorH - 0.1);
        expect(p.floorH).toBeGreaterThan(B.lo);
      }
    }
    expect(lenses).toBeGreaterThan(0);
  });

  it('traces the same walls on both sides of where two cells meet', () => {
    const d = new Vector3();
    let checked = 0;
    for (const [A, B] of pairs) {
      // B's walls by level, as points on the planet (m)
      const byLevel = new Map<number, Vector3[]>();
      for (const w of B.walls) {
        const list = byLevel.get(w.level) ?? [];
        for (let k = 0; k < w.points.length; k += 2) list.push(chartDir(B, R, w.points[k], w.points[k + 1], d).clone().multiplyScalar(R));
        byLevel.set(w.level, list);
      }
      for (const w of A.walls) {
        const theirs = byLevel.get(w.level);
        if (!theirs) continue;
        for (let k = 0; k < w.points.length; k += 2) {
          // A's wall points along its edge with B, where both cells' surveys reach well past it
          const p = chartDir(A, R, w.points[k], w.points[k + 1], d).clone();
          if (Math.abs(sideAt(A, w.points[k], w.points[k + 1])) > 0.5 || terrain.cells.at(p, at).key !== B.cell.key) continue;
          p.multiplyScalar(R);
          let best = Infinity;
          for (const q of theirs) best = Math.min(best, q.distanceTo(p));
          // (each traced at its own grid: a wall's points lie on the same contour, half a meter apart along it)
          expect(best).toBeLessThan(0.3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

/** The survey's side field (into its cell, m) at a chart point. */
function sideAt(s: CellSurvey, x: number, y: number): number {
  const i = Math.min(Math.max(Math.round((x + s.half) / s.g), 0), s.n - 1);
  const j = Math.min(Math.max(Math.round((y + s.half) / s.g), 0), s.n - 1);
  return s.side[j * s.n + i];
}
