import { BufferGeometry, Color, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { smoothstep } from '../../core/math';
import type { TerraceField } from './field';
import { clip, Grid, inRing, Side, type Chain, type Corner, type Field } from './grid';
import { hash01, Perlin2, type Grad2 } from './noise';
import { Bands, Cuts, type CutParams } from './terraces';

// The paddy lab's land, built (terraces.ts the bands and cuts, grid.ts the
// outlines and pieces). The slope sorts the ground: the woods (their own
// ground, the height map itself, with trees), the flats (plain plots on a
// lattice, each level at its own height, bunds between), and the terraces
// between. Each band's paddies are filled level, each paddy coloured as its
// own (the cuts' lines part them); along each bank a dam on the higher
// paddy's edge and a riser down to the paddy below; across each cut a
// cross-bank; a bank of earth where the woods meet the paddies; and the
// block's edges cut straight down. Everything that stands on a floor reaches
// a little under it, so nothing between them shows a gap.

export interface DamParams {
  /** Its thickness (m), give or take `widthVar` (m) over `widthScale` (m) of the bank. */
  readonly width: number;
  readonly widthVar: number;
  readonly widthScale: number;
  /** Its height over its paddy's floor (m), give or take `heightVar`. */
  readonly height: number;
  readonly heightVar: number;
  /** The riser's lean (m out per m of height). */
  readonly batter: number;
}

export interface PlotParams {
  /** A plot's width and length (m), the lattice's turn (radians) and its warp (× a plot). */
  readonly width: number;
  readonly length: number;
  readonly angle: number;
  readonly warp: number;
}

export interface BuildParams {
  readonly half: number;
  readonly cell: number;
  /** Rings smaller than this (m²) are levelled into the band round them. */
  readonly minArea: number;
  readonly dam: DamParams;
  readonly cut: CutParams;
  readonly plot: PlotParams;
  /** A tree about every this many m, where the woods are. */
  readonly treeSpacing: number;
  /** The least woods and flats (m²): a patch of either smaller is terraced like the land round it. */
  readonly leastWoods: number;
  readonly leastFlats: number;
}

export interface Trees {
  readonly count: number;
  /** Per tree: x, ground (m, up), z, its height and its crown's radius (m). */
  readonly at: Float32Array;
  /** Per tree: its crown's colour (linear). */
  readonly tint: Float32Array;
}

export interface LabParts {
  readonly floors: BufferGeometry;
  readonly woods: BufferGeometry;
  readonly dams: BufferGeometry;
  readonly risers: BufferGeometry;
  readonly sides: BufferGeometry;
  readonly outlines: BufferGeometry;
  readonly trees: Trees;
  /** The cuts' lines (x, y, …) by band (dev: to find them). */
  readonly cuts: Array<{ band: number; xy: number[] }>;
  readonly stats: Record<string, number>;
}

/** Across a dam from its outer edge (0) to its inner (1): its height (× the dam's; the last just under the water). */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.82],
  [0.14, 1],
  [0.5, 1],
  [0.78, 0.45],
  [1, 0],
];
/** Across a ridge (a cross-bank, a plot's bund, the woods' edge) from its left foot (−1) to its right (1): its rise (0 a foot, 1 its crest). */
const RIDGE: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-0.55, 0.6],
  [-0.22, 1],
  [0.22, 1],
  [0.55, 0.6],
  [1, 0],
];
/** How far under the floors the dams' and risers' feet reach (m). */
const UNDER = 0.05;
/** The banks' spacing once evened out (m). */
const SPACING = 0.12;

const LOOKS: ReadonlyArray<readonly [number, number, number, number]> = [
  // share, colour (sRGB, from the aerial reference's own, a little lighter for the light): flooded (the sky's
  // white, a touch of lilac), flooded and shallow, just planted (lime), growing, grown, grown deep
  [0.36, 0.94, 0.93, 0.97],
  [0.08, 0.85, 0.84, 0.86],
  [0.1, 0.56, 0.66, 0.26],
  [0.18, 0.36, 0.47, 0.19],
  [0.18, 0.24, 0.35, 0.13],
  [0.1, 0.17, 0.27, 0.1],
];

function srgb(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, SRGBColorSpace);
}

function look(u: number): Color {
  for (const [share, r, g, b] of LOOKS) {
    if (u < share) return srgb(r, g, b);
    u -= share;
  }
  const [, r, g, b] = LOOKS[0];
  return srgb(r, g, b);
}

const SLOT = { steep: 1, flat: 2, base: 100000, bands: 200000, u: 300000, v: 400000 } as const;

export function buildLab(field: TerraceField, P: BuildParams): LabParts {
  const grid = new Grid(P.half, P.cell);
  // (the build's time by stage, on the panel's line)
  let lap = performance.now();
  const time = (name: string): void => {
    const now = performance.now();
    stats[`ms${name}`] = Math.round(now - lap);
    lap = now;
  };
  const { N, n, m, X, Y } = grid;
  const fp = field.p;
  const step = fp.step;
  const seed = fp.seed;
  const stats: Record<string, number> = {};
  const g: Grad2 = { x: 0, y: 0 };

  // the samples: the terrace field and the smoothed slope
  const T = new Float64Array(N);
  const S = new Float64Array(N);
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < N; v++) {
    T[v] = field.terrace(X[v], Y[v]);
    S[v] = field.slope(X[v], Y[v]);
    lo = Math.min(lo, T[v]);
    hi = Math.max(hi, T[v]);
  }
  const levels = field.levels(lo, hi);
  const L = levels.length;
  const floorOf = (k: number): number => 0.5 * (levels[Math.max(0, Math.min(k, L - 2))] + levels[Math.max(1, Math.min(k + 1, L - 1))]);
  const terrace = (x: number, y: number): number => field.terrace(x, y);
  const height = (x: number, y: number): number => field.height(x, y);

  // the classes: woods where steep, flats where flat, terraces between; a patch of either smaller than its
  // least is terraced like the land round it (no drum of plots on a hilltop), as a hole in either smaller than
  // that is filled (its rings traced on the slope, the samples inside turned)
  const steepF: Field = (x, y) => field.slope(x, y) - fp.steep;
  const flatF: Field = (x, y) => fp.flat - field.slope(x, y);
  const woodsIdx = new Int32Array(N);
  const flatIdx = new Int32Array(N);
  for (let v = 0; v < N; v++) {
    woodsIdx[v] = S[v] - fp.steep >= 0 ? 1 : 0;
    flatIdx[v] = fp.flat - S[v] >= 0 ? 1 : 0;
  }
  const turned: Array<{ xy: number[]; box: number[]; value: number; woods: boolean; area: number }> = [];
  const tidy = (idx: Int32Array, slot: number, f: Field, least: number, woods: boolean): number => {
    const small = grid
      .trace(idx, (u, w) => grid.crossing(slot, u, w, f, 0))
      .filter((c) => c.closed && Math.abs(c.area) < least)
      .sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    for (const r of small) {
      const box = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < r.xy.length; i += 2) {
        box[0] = Math.min(box[0], r.xy[i]);
        box[1] = Math.max(box[1], r.xy[i]);
        box[2] = Math.min(box[2], r.xy[i + 1]);
        box[3] = Math.max(box[3], r.xy[i + 1]);
      }
      const value = r.area > 0 ? 0 : 1;
      turned.push({ xy: r.xy, box, value, woods, area: Math.abs(r.area) });
      const [c0, r0] = grid.square(box[0], box[2]);
      const [c1, r1] = grid.square(box[1], box[3]);
      for (let j = r0; j <= r1 + 1; j++) {
        for (let i = c0; i <= c1 + 1; i++) {
          for (const v of [j * n + i, n * n + j * m + i]) {
            if (v < N && (v < n * n ? i < n && j < n : i < m && j < m) && inRing(r.xy, X[v], Y[v])) idx[v] = value;
          }
        }
      }
    }
    return small.length;
  };
  stats.woodsTidied = tidy(woodsIdx, SLOT.steep, steepF, P.leastWoods, true);
  stats.flatsTidied = tidy(flatIdx, SLOT.flat, flatF, P.leastFlats, false);
  turned.sort((a, b) => b.area - a.area);
  for (let v = 0; v < N; v++) if (woodsIdx[v]) flatIdx[v] = 0;
  const isWoods = (v: number): boolean => woodsIdx[v] === 1;
  const isFlat = (v: number): boolean => flatIdx[v] === 1;
  /** A point's class: 0 the woods, 1 the flats, 2 the terraces (the largest turned ring round it has the last word). */
  const classAt = (x: number, y: number): number => {
    const s = field.slope(x, y);
    let woods = s - fp.steep >= 0;
    let flat = fp.flat - s >= 0;
    let w = false;
    let f = false;
    for (const r of turned) {
      if ((r.woods ? w : f) || x < r.box[0] || x > r.box[1] || y < r.box[2] || y > r.box[3] || !inRing(r.xy, x, y)) continue;
      if (r.woods) {
        woods = r.value === 1;
        w = true;
      } else {
        flat = r.value === 1;
        f = true;
      }
    }
    return woods ? 0 : flat ? 1 : 2;
  };
  const terraced = (x: number, y: number): boolean => classAt(x, y) === 2;

  // the bands, unshifted; the cuts along their banks; the bands as the cuts shift them
  const G0 = (k: number, x: number, y: number, t: number): number => t - levels[k] - field.wander(k, x, y);
  time('Samples');
  const base = new Bands(grid, levels, G0, T, terrace, SLOT.base);
  base.trace();
  time('Base');
  const cuts = new Cuts(field, base.chains, base, P.cut, terraced, P.minArea);
  const reach = 1.05 * P.cut.shift * step;
  const G = (k: number, x: number, y: number, t: number): number => {
    const v = G0(k, x, y, t);
    return Math.abs(v) < reach ? v + step * cuts.shift(k, x, y) : v;
  };
  const bands = new Bands(grid, levels, G, T, terrace, SLOT.bands);
  bands.trace();
  bands.levelSmall(P.minArea);
  const cutLines = cuts.lines(bands, (x, y) => Math.abs(x) < P.half - 0.05 && Math.abs(y) < P.half - 0.05 && terraced(x, y));
  time('Bands');
  stats.levels = L;
  stats.cuts = cuts.cuts.length;
  stats.cutLines = cutLines.length;
  stats.levelled = bands.dropped;

  // the flats' lattice
  const pl = P.plot;
  const ca = Math.cos(pl.angle);
  const sa = Math.sin(pl.angle);
  const warp = new Perlin2(seed * 31 + 9);
  const wg: Grad2 = { x: 0, y: 0 };
  const U: Field = (x, y) => (ca * x + sa * y) / pl.width + pl.warp * warp.at(x / 25, y / 25, wg);
  const V: Field = (x, y) => (-sa * x + ca * y) / pl.length + pl.warp * warp.at(x / 25 + 31.7, y / 25 - 12.9, wg);
  const ui = new Int32Array(N);
  const vi = new Int32Array(N);
  for (let v = 0; v < N; v++) {
    ui[v] = Math.floor(U(X[v], Y[v]));
    vi[v] = Math.floor(V(X[v], Y[v]));
  }
  const plotKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  const plotAt = (x: number, y: number): number => plotKey(Math.floor(U(x, y)), Math.floor(V(x, y)));

  // the sides pieces are cut by (one per field and level, sharing their crossings with the outlines)
  const sides = new Map<string, Side>();
  const side = (name: string, make: () => Side): Side => {
    let s = sides.get(name);
    if (!s) {
      s = make();
      sides.set(name, s);
    }
    return s;
  };
  const inWoods = new Side(grid, SLOT.steep, steepF, 0, isWoods, true);
  const outWoods = new Side(grid, SLOT.steep, steepF, 0, isWoods, false);
  const inFlats = new Side(grid, SLOT.flat, flatF, 0, isFlat, true);
  const outFlats = new Side(grid, SLOT.flat, flatF, 0, isFlat, false);
  const bandFrom = (k: number): Side => side(`b${k}`, () => new Side(grid, SLOT.bands + k, (x, y) => bands.H(k, x, y), 0, (v) => bands.band[v] >= k, true));
  const bandTo = (k: number): Side => side(`B${k}`, () => new Side(grid, SLOT.bands + k, (x, y) => bands.H(k, x, y), 0, (v) => bands.band[v] >= k, false));
  const uFrom = (i: number): Side => side(`u${i}`, () => new Side(grid, SLOT.u + i + 50000, U, i, (v) => ui[v] >= i, true));
  const uTo = (i: number): Side => side(`U${i}`, () => new Side(grid, SLOT.u + i + 50000, U, i, (v) => ui[v] >= i, false));
  const vFrom = (j: number): Side => side(`v${j}`, () => new Side(grid, SLOT.v + j + 50000, V, j, (v) => vi[v] >= j, true));
  const vTo = (j: number): Side => side(`V${j}`, () => new Side(grid, SLOT.v + j + 50000, V, j, (v) => vi[v] >= j, false));

  // the cuts' lines part the paddies: the triangles' edges each crosses, per band
  const barrier = new Set<number>();
  const cutSquare = new Map<number, number>();
  const cutPts: number[][] = [];
  const segHits = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (const [ci0, line] of cutLines.entries()) {
    const xy = line.xy;
    const k = line.band;
    // (a little past both banks, so it parts the band's floor right across)
    const ext = (i: number, j: number, d: number): [number, number] => {
      const l = Math.hypot(xy[i] - xy[j], xy[i + 1] - xy[j + 1]) || 1;
      return [xy[i] + ((xy[i] - xy[j]) / l) * d, xy[i + 1] + ((xy[i + 1] - xy[j + 1]) / l) * d];
    };
    const pts = [...ext(0, 2, 0.5), ...xy, ...ext(xy.length - 2, xy.length - 4, 0.3)];
    cutPts.push(pts);
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const [ax, ay, bx, by] = [pts[s], pts[s + 1], pts[s + 2], pts[s + 3]];
      const [c0, r0] = grid.square(Math.min(ax, bx), Math.min(ay, by));
      const [c1, r1] = grid.square(Math.max(ax, bx), Math.max(ay, by));
      for (let cj = r0; cj <= r1; cj++) {
        for (let ci = c0; ci <= c1; ci++) {
          const t = grid.triangles(ci, cj);
          const [a, b, e, c, d] = [t[0], t[1], t[2], t[4], t[7]];
          for (const [u, w] of [
            [a, b],
            [b, c],
            [c, d],
            [d, a],
            [a, e],
            [b, e],
            [c, e],
            [d, e],
          ]) {
            if (segHits(ax, ay, bx, by, X[u], Y[u], X[w], Y[w])) {
              barrier.add(grid.key(u, w) * L + k);
              if (!cutSquare.has((cj * m + ci) * L + k)) cutSquare.set((cj * m + ci) * L + k, ci0);
            }
          }
        }
      }
    }
  }

  /** A cut's field: the signed distance (m) to its line, > 0 on its left. */
  const cutField = (c: number): Field => {
    const pts = cutPts[c];
    return (x, y) => {
      let best = Infinity;
      let sign = 1;
      for (let s = 0; s + 3 < pts.length; s += 2) {
        const ex = pts[s + 2] - pts[s];
        const ey = pts[s + 3] - pts[s + 1];
        const ll = ex * ex + ey * ey;
        const t = ll > 0 ? Math.min(Math.max(((x - pts[s]) * ex + (y - pts[s + 1]) * ey) / ll, 0), 1) : 0;
        const d = Math.hypot(pts[s] + ex * t - x, pts[s + 1] + ey * t - y);
        if (d < best) {
          best = d;
          sign = ex * (y - pts[s + 1]) - ey * (x - pts[s]) >= 0 ? 1 : -1;
        }
      }
      return sign * best;
    };
  };
  const cutSides = new Map<number, [Side, Side]>();
  const cutSide = (c: number): [Side, Side] => {
    let s = cutSides.get(c);
    if (!s) {
      const f = cutField(c);
      const at = (v: number): boolean => f(X[v], Y[v]) >= 0;
      s = [new Side(grid, 600000 + c, f, 0, at, true), new Side(grid, 600000 + c, f, 0, at, false)];
      cutSides.set(c, s);
    }
    return s;
  };
  /** A piece of a paddy parted exactly along a cut: its cut and side (+1 its left, −1 its right). */
  const parted = new Map<number, [number, number][]>();

  // the pieces: each triangle cut into the woods, the flats' plots and the terraces' bands
  const paddyXY: number[][] = [];
  const paddyBand: number[] = [];
  const paddyHalves: Array<{ piece: number; cut: number; sign: number; xy: number[] }> = [];
  const pieceOf = new Map<number, number>();
  const plots = new Map<number, { xy: number[][]; area: number; sum: number }>();
  const woodsXY: number[] = [];
  const fan = (c: Corner[], out: number[]): void => {
    for (let i = 1; i + 1 < c.length; i++) out.push(c[0].x, c[0].y, c[i].x, c[i].y, c[i + 1].x, c[i + 1].y);
  };
  const addPaddy = (tri: number, k: number, xy: number[]): void => {
    pieceOf.set(tri * L + k, paddyXY.length);
    paddyXY.push(xy);
    paddyBand.push(k);
  };
  const addPlot = (key: number, xy: number[]): void => {
    let p = plots.get(key);
    if (!p) {
      p = { xy: [], area: 0, sum: 0 };
      plots.set(key, p);
    }
    p.xy.push(xy);
    for (let i = 0; i < xy.length; i += 6) {
      const a = Math.abs((xy[i + 2] - xy[i]) * (xy[i + 5] - xy[i + 1]) - (xy[i + 4] - xy[i]) * (xy[i + 3] - xy[i + 1])) / 2;
      p.area += a;
      p.sum += a * terrace((xy[i] + xy[i + 2] + xy[i + 4]) / 3, (xy[i + 1] + xy[i + 3] + xy[i + 5]) / 3);
    }
  };
  const corner = (v: number): Corner => ({ x: X[v], y: Y[v], v, a: -1, b: -1 });
  for (let cj = 0; cj < m; cj++) {
    for (let ci = 0; ci < m; ci++) {
      const t = Array.from(grid.triangles(ci, cj));
      const sq = cj * m + ci;
      const five = [t[0], t[1], t[4], t[7], t[2]];
      const woods = five.map(isWoods);
      const flat = five.map((v) => !isWoods(v) && isFlat(v));
      // (whole squares: the woods, a plot, a band with no cut through it)
      if (woods.every(Boolean)) {
        const [a, b, c, d] = five;
        woodsXY.push(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[a], Y[a], X[c], Y[c], X[d], Y[d]);
        continue;
      }
      if (flat.every(Boolean) && five.every((v) => ui[v] === ui[five[0]] && vi[v] === vi[five[0]])) {
        const [a, b, c, d] = five;
        addPlot(plotKey(ui[a], vi[a]), [X[a], Y[a], X[b], Y[b], X[c], Y[c], X[a], Y[a], X[c], Y[c], X[d], Y[d]]);
        continue;
      }
      const k0 = bands.band[five[0]];
      if (!woods.some(Boolean) && !flat.some(Boolean) && five.every((v) => bands.band[v] === k0 && !isFlat(v)) && !cutSquare.has(sq * L + k0)) {
        for (let q = 0; q < 4; q++) addPaddy(sq * 4 + q, k0, [X[t[3 * q]], Y[t[3 * q]], X[t[3 * q + 1]], Y[t[3 * q + 1]], X[t[3 * q + 2]], Y[t[3 * q + 2]]]);
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const tri = [corner(t[3 * q]), corner(t[3 * q + 1]), corner(t[3 * q + 2])];
        const w = clip(tri, inWoods);
        if (w.length >= 3) fan(w, woodsXY);
        const rest = clip(tri, outWoods);
        if (rest.length < 3) continue;
        const f = clip(rest, inFlats);
        if (f.length >= 3) {
          const vs = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
          const i0 = Math.min(...vs.map((v) => ui[v]));
          const i1 = Math.max(...vs.map((v) => ui[v]));
          const j0 = Math.min(...vs.map((v) => vi[v]));
          const j1 = Math.max(...vs.map((v) => vi[v]));
          for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
              const piece = clip(clip(clip(clip(f, uFrom(i)), uTo(i + 1)), vFrom(j)), vTo(j + 1));
              if (piece.length < 3) continue;
              const xy: number[] = [];
              fan(piece, xy);
              addPlot(plotKey(i, j), xy);
            }
          }
        }
        const r = clip(rest, outFlats);
        if (r.length < 3) continue;
        const vs = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
        const b0 = Math.min(...vs.map((v) => bands.band[v]));
        const b1 = Math.max(...vs.map((v) => bands.band[v]));
        for (let k = b0; k <= b1; k++) {
          const piece = clip(clip(r, bandFrom(k)), bandTo(k + 1));
          if (piece.length < 3) continue;
          const xy: number[] = [];
          fan(piece, xy);
          addPaddy(sq * 4 + q, k, xy);
          // (a cut through it: the halves either side drawn each in its own paddy's look)
          const c = cutSquare.get(sq * L + k);
          if (c !== undefined) {
            const [left, right] = cutSide(c);
            const halves: [number, number][] = [];
            for (const [side, sign] of [
              [left, 1],
              [right, -1],
            ] as const) {
              const half = clip(piece, side);
              if (half.length < 3) continue;
              const hxy: number[] = [];
              fan(half, hxy);
              halves.push([c, sign]);
              paddyHalves.push({ piece: paddyXY.length - 1, cut: c, sign, xy: hxy });
            }
            if (halves.length) parted.set(paddyXY.length - 1, halves);
          }
        }
      }
    }
  }

  time('Pieces');
  // the paddies: a band's pieces joined across every edge no cut parts, each paddy one look
  const parent = new Int32Array(paddyXY.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (tA: number, tB: number, u: number, w: number): void => {
    const lo = Math.min(bands.band[u], bands.band[w]);
    const hi = Math.max(bands.band[u], bands.band[w]);
    for (let k = lo; k <= hi; k++) {
      const a = pieceOf.get(tA * L + k);
      const b = pieceOf.get(tB * L + k);
      if (a === undefined || b === undefined || barrier.has(grid.key(u, w) * L + k)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  };
  for (let cj = 0; cj < m; cj++) {
    for (let ci = 0; ci < m; ci++) {
      const t = Array.from(grid.triangles(ci, cj));
      const sq = (cj * m + ci) * 4;
      for (let q = 0; q < 4; q++) join(sq + q, sq + ((q + 1) % 4), t[3 * q + 1], t[2]);
      if (cj > 0) join(sq, ((cj - 1) * m + ci) * 4 + 2, t[0], t[1]);
      if (ci + 1 < m) join(sq + 1, (cj * m + ci + 1) * 4 + 3, t[3], t[4]);
    }
  }
  // (dev: how many cuts part the paddies either side of them)
  {
    let parted = 0;
    let tried = 0;
    const pieceAt = (x: number, y: number, k: number): number => {
      const [ci, cj] = grid.square(x, y);
      const t = grid.triangles(ci, cj);
      for (let q = 0; q < 4; q++) {
        const [A, B, C] = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
        const s1 = (X[B] - X[A]) * (y - Y[A]) - (Y[B] - Y[A]) * (x - X[A]);
        const s2 = (X[C] - X[B]) * (y - Y[B]) - (Y[C] - Y[B]) * (x - X[B]);
        const s3 = (X[A] - X[C]) * (y - Y[C]) - (Y[A] - Y[C]) * (x - X[C]);
        if (s1 >= 0 && s2 >= 0 && s3 >= 0) return pieceOf.get(((cj * m + ci) * 4 + q) * L + k) ?? -1;
      }
      return -1;
    };
    for (const line of cutLines) {
      const xy = line.xy;
      const i = 2 * Math.floor(xy.length / 4);
      if (i + 3 >= xy.length) continue;
      const tx = xy[i + 2] - xy[i];
      const ty = xy[i + 3] - xy[i + 1];
      const l = Math.hypot(tx, ty) || 1;
      const a = pieceAt(xy[i] - (0.4 * ty) / l, xy[i + 1] + (0.4 * tx) / l, line.band);
      const b = pieceAt(xy[i] + (0.4 * ty) / l, xy[i + 1] - (0.4 * tx) / l, line.band);
      if (a < 0 || b < 0) continue;
      tried++;
      if (find(a) !== find(b)) parted++;
    }
    stats.cutsTried = tried;
    stats.cutsParting = parted;
  }
  // each paddy's look: from a slow noise at its middle (so neighbours, across banks and cuts alike, mostly
  // share theirs and the looks change by stretches of hillside, as farmed), now and then one of its own
  const middle = new Map<number, [number, number, number]>();
  paddyXY.forEach((xy, i) => {
    const r = find(i);
    const m = middle.get(r) ?? [0, 0, 0];
    for (let j = 0; j < xy.length; j += 6) {
      const a = Math.abs((xy[j + 2] - xy[j]) * (xy[j + 5] - xy[j + 1]) - (xy[j + 4] - xy[j]) * (xy[j + 3] - xy[j + 1])) / 2;
      m[0] += a;
      m[1] += (a * (xy[j] + xy[j + 2] + xy[j + 4])) / 3;
      m[2] += (a * (xy[j + 1] + xy[j + 3] + xy[j + 5])) / 3;
    }
    middle.set(r, m);
  });
  const lookNoise = new Perlin2(seed * 31 + 13);
  const lookOf = new Map<number, Color>();
  let paddies = 0;
  const paddyLook = (i: number): Color => {
    const r = find(i);
    let c = lookOf.get(r);
    if (!c) {
      const m = middle.get(r) ?? [1, 0, 0];
      const x = m[1] / Math.max(m[0], 1e-9);
      const y = m[2] / Math.max(m[0], 1e-9);
      // (two octaves, spread to about even shares: the noise's values gather round its middle)
      const v = lookNoise.at(x / 26, y / 26, wg) + 0.45 * lookNoise.at(x / 11 + 41.3, y / 11 - 7.7, wg);
      const u = hash01(r, seed + 79) < 0.15 ? hash01(r, seed + 77) : 0.5 + 0.5 * Math.tanh(v / 0.3);
      c = look(Math.min(Math.max(u, 0), 0.9999));
      lookOf.set(r, c);
      paddies++;
    }
    return c;
  };

  // the plots' floors: level, at the level of the band their ground's mean lies in (so a plot is a step at most
  // from the paddies and plots round it)
  const bandFloor = (t: number): number => {
    let a = 0;
    let b = L;
    while (a < b) {
      const c = (a + b) >> 1;
      if (levels[c] > t) b = c;
      else a = c + 1;
    }
    return floorOf(a - 1);
  };
  const plotFloor = new Map<number, number>();
  for (const [key, p] of plots) plotFloor.set(key, bandFloor(p.sum / Math.max(p.area, 1e-9)));
  const plotFloorAt = (x: number, y: number): number => plotFloor.get(plotAt(x, y)) ?? bandFloor(terrace(x, y));

  // the tops: paddies and plots, level
  const floorPos: number[] = [];
  const floorCol: number[] = [];
  // the paddy either side of each cut (found a little off its middle, either side)
  const sideOf = new Map<number, number>();
  {
    const pieceAt = (x: number, y: number, k: number): number => {
      const [ci, cj] = grid.square(x, y);
      const t = grid.triangles(ci, cj);
      for (let q = 0; q < 4; q++) {
        const [A, B, C] = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
        const s1 = (X[B] - X[A]) * (y - Y[A]) - (Y[B] - Y[A]) * (x - X[A]);
        const s2 = (X[C] - X[B]) * (y - Y[B]) - (Y[C] - Y[B]) * (x - X[B]);
        const s3 = (X[A] - X[C]) * (y - Y[C]) - (Y[A] - Y[C]) * (x - X[C]);
        if (s1 >= 0 && s2 >= 0 && s3 >= 0) {
          const p = pieceOf.get(((cj * m + ci) * 4 + q) * L + k);
          return p === undefined || parted.has(p) ? -1 : p;
        }
      }
      return -1;
    };
    cutLines.forEach((line, c) => {
      const xy = line.xy;
      for (const sign of [1, -1]) {
        for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          const i = 2 * Math.min(Math.max(Math.round((f * xy.length) / 2), 0), xy.length / 2 - 2);
          const tx = xy[i + 2] - xy[i];
          const ty = xy[i + 3] - xy[i + 1];
          const l = Math.hypot(tx, ty) || 1;
          const p = pieceAt(xy[i] - (sign * 0.45 * ty) / l, xy[i + 1] + (sign * 0.45 * tx) / l, line.band);
          if (p >= 0) {
            sideOf.set(c * 2 + (sign > 0 ? 0 : 1), p);
            break;
          }
        }
      }
    });
  }
  for (const h of paddyHalves) {
    const p = sideOf.get(h.cut * 2 + (h.sign > 0 ? 0 : 1)) ?? h.piece;
    const y = floorOf(paddyBand[h.piece]);
    const c = paddyLook(p);
    for (let j = 0; j < h.xy.length; j += 2) {
      floorPos.push(h.xy[j], y, -h.xy[j + 1]);
      floorCol.push(c.r, c.g, c.b);
    }
  }
  paddyXY.forEach((xy, i) => {
    if (parted.has(i)) return;
    const y = floorOf(paddyBand[i]);
    const c = paddyLook(i);
    for (let j = 0; j < xy.length; j += 2) {
      floorPos.push(xy[j], y, -xy[j + 1]);
      floorCol.push(c.r, c.g, c.b);
    }
  });
  for (const [key, p] of plots) {
    const y = plotFloor.get(key) as number;
    const c = look(hash01(key, seed + 78));
    for (const xy of p.xy) {
      for (let j = 0; j < xy.length; j += 2) {
        floorPos.push(xy[j], y, -xy[j + 1]);
        floorCol.push(c.r, c.g, c.b);
      }
    }
  }
  stats.paddies = paddies;
  stats.plots = plots.size;

  // the woods' ground: the height map itself
  const woodsPos: number[] = [];
  const woodsNrm: number[] = [];
  const woodsCol: number[] = [];
  const shade = new Perlin2(seed * 31 + 11);
  for (let i = 0; i < woodsXY.length; i += 2) {
    const x = woodsXY[i];
    const y = woodsXY[i + 1];
    const h = field.height(x, y, g);
    const l = Math.hypot(g.x, g.y, 1);
    woodsPos.push(x, h, -y);
    woodsNrm.push(-g.x / l, 1 / l, g.y / l);
    const c = srgb(0.3, 0.38, 0.22).lerp(srgb(0.42, 0.4, 0.26), 0.5 + 0.5 * shade.at(x / 3, y / 3, wg));
    woodsCol.push(c.r, c.g, c.b);
  }

  // the floor a point stands on: the woods' ground, a plot's floor, a band's
  const surfaceAt = (x: number, y: number): number => {
    const c = classAt(x, y);
    if (c === 0) return height(x, y);
    if (c === 1) return plotFloorAt(x, y);
    return floorOf(bands.bandAt(x, y));
  };

  time('Tops');
  // the banks: along each band's outline, where it is terraced, a dam on the paddy's edge and a riser under it
  const widthNoise = new Perlin2(seed * 31 + 5);
  const heightNoise = new Perlin2(seed * 31 + 6);
  const damPos: number[] = [];
  const damIdx: number[] = [];
  const riserPos: number[] = [];
  const riserIdx: number[] = [];
  const capPos: number[] = [];
  const lines: number[] = [];
  const D = P.dam;
  const onEdge = (x: number, y: number): boolean => Math.abs(Math.abs(x) - P.half) < 1e-7 || Math.abs(Math.abs(y) - P.half) < 1e-7;
  let banks = 0;
  for (const chain of bands.chains) {
    const k = chain.level;
    if (k < 1 || k + 1 >= L) continue;
    const pts = resample(chain, SPACING);
    const count = pts.length / 2;
    if (count < 3) continue;
    const at = (i: number): number => (chain.closed ? (i + count) % count : Math.min(Math.max(i, 0), count - 1));
    const nx = new Float64Array(count);
    const ny = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = at(i - 1);
      const b = at(i + 1);
      const tx = pts[2 * b] - pts[2 * a];
      const ty = pts[2 * b + 1] - pts[2 * a + 1];
      const l = Math.hypot(tx, ty) || 1;
      nx[i] = -ty / l;
      ny[i] = tx / l;
    }
    // where it is a bank: terraced, and its band still there (not pinched out)
    const ok = new Uint8Array(count);
    const present = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const x = pts[2 * i];
      const y = pts[2 * i + 1];
      present[i] = bands.bandAt(x + nx[i] * 0.04, y + ny[i] * 0.04) === k ? 1 : 0;
      ok[i] = present[i] && terraced(x, y) ? 1 : 0;
    }
    // (where the terraces end at the woods or the flats, a little on into them, within their edge's half-width:
    // its end buried in it)
    {
      const grow = ok.slice();
      for (let i = 0; i < count; i++) {
        if (!ok[i]) continue;
        for (const dir of [1, -1]) {
          for (let d = 1; d <= 2; d++) {
            const j = at(i + dir * d);
            if ((!chain.closed && (i + dir * d < 0 || i + dir * d >= count)) || ok[j] || !present[j]) break;
            grow[j] = 1;
          }
        }
      }
      ok.set(grow);
    }
    // (a point or two that fails between ones that pass is a sharp corner, not a pinch: kept)
    for (let i = 0; i < count; i++) {
      if (ok[i] || (!chain.closed && (i === 0 || i === count - 1))) continue;
      const a = ok[at(i - 1)] || ok[at(i - 2)];
      const b = ok[at(i + 1)] || ok[at(i + 2)];
      if (a && b && (ok[at(i - 1)] || ok[at(i + 1)])) ok[i] = 2;
    }
    for (let i = 0; i < count; i++) if (ok[i] === 2) ok[i] = 1;
    const bank = (idx: number[], closed: boolean): void => {
      const c = idx.length;
      const px = new Float64Array(c);
      const py = new Float64Array(c);
      const qx = new Float64Array(c);
      const qy = new Float64Array(c);
      const ux = new Float64Array(c);
      const uy = new Float64Array(c);
      const w = new Float64Array(c);
      const H = new Float64Array(c);
      const slope = new Float64Array(c);
      const ring = (i: number): number => (closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
      for (let i = 0; i < c; i++) {
        px[i] = pts[2 * idx[i]];
        py[i] = pts[2 * idx[i] + 1];
        ux[i] = nx[idx[i]];
        uy[i] = ny[idx[i]];
      }
      const up = levels[k + 1] - levels[k];
      const down = levels[k] - levels[k - 1];
      const floor = floorOf(k);
      for (let i = 0; i < c; i++) {
        const x = px[i];
        const y = py[i];
        w[i] = Math.max(D.width + D.widthVar * widthNoise.at(x / D.widthScale, y / D.widthScale, wg), 0.06);
        H[i] = Math.max(D.height + D.heightVar * heightNoise.at(x / D.widthScale, y / D.widthScale, wg), 0.04);
        field.terrace(x, y, g);
        slope[i] = Math.max(Math.hypot(g.x, g.y), 0.02);
        w[i] = Math.min(w[i], 0.45 * (up / slope[i]));
        const a = ring(i - 1);
        const b = ring(i + 1);
        if (a !== i && b !== i) {
          const ax = x - px[a];
          const ay = y - py[a];
          const bx = px[b] - x;
          const by = py[b] - y;
          const kappa = (2 * (ax * by - ay * bx)) / Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(ax + bx, ay + by), 1e-12);
          if (kappa > 0) w[i] = Math.min(w[i], 0.7 / kappa);
        }
      }
      soften(w, closed);
      const place = (i: number): void => {
        qx[i] = px[i] + ux[i] * w[i];
        qy[i] = py[i] + uy[i] * w[i];
      };
      // the dam's inner edge: in its own band, still below the next bank, and not over a crest
      for (let i = 0; i < c; i++) {
        for (let tries = 0; tries < 12; tries++) {
          place(i);
          if (bands.H(k, qx[i], qy[i]) > 0.25 * w[i] * slope[i] * 0.5 && bands.H(k + 1, qx[i], qy[i]) < -0.1 * up) break;
          w[i] *= 0.7;
        }
      }
      for (let pass = 0; pass < 10; pass++) {
        let folds = 0;
        for (let i = 0; i < (closed ? c : c - 1); i++) {
          const j = ring(i + 1);
          place(i);
          place(j);
          const ex = px[j] - px[i];
          const ey = py[j] - py[i];
          if ((qx[j] - qx[i]) * ex + (qy[j] - qy[i]) * ey < 0.2 * (ex * ex + ey * ey)) {
            w[i] *= 0.7;
            w[j] *= 0.7;
            folds++;
          }
        }
        if (folds === 0) break;
      }
      for (let i = 0; i < c; i++) place(i);
      // an end on the block's edge: the dam's end along the edge
      const edgeEnd = [false, false];
      if (!closed) {
        [0, c - 1].forEach((i, e) => {
          if (!onEdge(px[i], py[i])) return;
          edgeEnd[e] = true;
          const vertical = Math.abs(Math.abs(px[i]) - P.half) < 1e-7;
          let dx = vertical ? 0 : 1;
          let dy = vertical ? 1 : 0;
          if (bands.H(k, px[i] + 0.05 * dx, py[i] + 0.05 * dy) < bands.H(k, px[i] - 0.05 * dx, py[i] - 0.05 * dy)) {
            dx = -dx;
            dy = -dy;
          }
          const lean = Math.max(Math.abs(dx * ux[i] + dy * uy[i]), 0.35);
          ux[i] = dx;
          uy[i] = dy;
          w[i] /= lean;
          place(i);
        });
        for (let i = 0; i < c; i++) {
          qx[i] = Math.min(Math.max(qx[i], -P.half), P.half);
          qy[i] = Math.min(Math.max(qy[i], -P.half), P.half);
        }
      }
      // the dam: its profile swept along the bank
      const M = PROFILE.length;
      const d0 = damPos.length / 3;
      for (let i = 0; i < c; i++) {
        for (const [u, f] of PROFILE) damPos.push(px[i] + (qx[i] - px[i]) * u, u === 1 ? floor - UNDER : floor + f * H[i], -(py[i] + (qy[i] - py[i]) * u));
      }
      const segs = closed ? c : c - 1;
      for (let i = 0; i < segs; i++) {
        const a = d0 + i * M;
        const b = d0 + ring(i + 1) * M;
        for (let j = 0; j + 1 < M; j++) damIdx.push(a + j, b + j, b + j + 1, a + j, b + j + 1, a + j + 1);
      }
      // the riser: from the floor below it (under its water: the lowest beside it nearby, so where the band below
      // pinches out it reaches the next one down without a gap), leaning back, up to the dam's outer edge
      const r0 = riserPos.length / 3;
      const below = new Float64Array(c);
      for (let i = 0; i < c; i++) below[i] = floorOf(bands.bandAt(px[i] - ux[i] * 0.05, py[i] - uy[i] * 0.05));
      for (let i = 0; i < c; i++) {
        const top = floor + PROFILE[0][1] * H[i];
        let low = floor;
        for (let d = -2; d <= 2; d++) low = Math.min(low, below[ring(i + d)]);
        const foot = low - UNDER;
        let lean = Math.min(D.batter * (top - foot), 0.4 * (down / slope[i]));
        if (!closed) lean *= smoothstep(0, 1, Math.min(i, c - 1 - i) * SPACING);
        riserPos.push(px[i], top, -py[i], px[i] - ux[i] * lean, foot, -(py[i] - uy[i] * lean));
      }
      for (let i = 0; i < segs; i++) {
        const a = r0 + 2 * i;
        const b = r0 + 2 * ring(i + 1);
        riserIdx.push(a, a + 1, b + 1, a, b + 1, b);
      }
      // (its ends closed: the wedge between its lean and the plumb line under its top)
      if (!closed) {
        for (const i of [0, c - 1]) {
          const a = r0 + 2 * i;
          const v = riserPos.length / 3;
          riserPos.push(px[i], riserPos[3 * (a + 1) + 1], -py[i]);
          riserIdx.push(a, a + 1, v);
        }
      }
      // the dam's ends: on the block's edge, cut (the earth's colour); inside the land, closed in its own
      if (!closed) {
        [0, c - 1].forEach((i, e) => {
          if (edgeEnd[e]) {
            const vtx = (j: number): number[] => damPos.slice(3 * (d0 + i * M + j), 3 * (d0 + i * M + j) + 3);
            const foot = [px[i], floor - UNDER, -py[i]];
            for (let j = 0; j + 1 < M; j++) capPos.push(...foot, ...vtx(j), ...vtx(j + 1));
            return;
          }
          const f = damPos.length / 3;
          damPos.push(px[i], floor - UNDER, -py[i]);
          for (let j = 0; j + 1 < M; j++) damIdx.push(f, d0 + i * M + j, d0 + i * M + j + 1);
        });
      }
      for (let i = 0; i < segs; i++) {
        const j = ring(i + 1);
        lines.push(px[i], floor + H[i] + 0.02, -py[i], px[j], floor + H[j] + 0.02, -py[j]);
      }
    };
    for (const run of runs(ok, chain.closed)) {
      banks++;
      bank(run.idx, run.closed);
    }
  }
  stats.banks = banks;
  time('Banks');

  // the ridges: across each cut (a cross-bank on its band's floor), between the flats' plots (a bund on the
  // higher plot's floor, down to the lower's), and where the woods meet the farmed land (a bank of earth)
  const ridgePos: number[] = [];
  const ridgeIdx: number[] = [];
  const ridgeCol: number[] = [];
  const damColour = srgb(0.8, 0.82, 0.64);
  const riserColour = srgb(0.47, 0.56, 0.34);
  const earthColour = srgb(0.36, 0.36, 0.24);
  /**
   * A ridge along xy: its feet `width` apart at the heights either side (left, right; each as low as the lowest
   * beside it nearby, so where a side steps down it reaches the lower floor without a gap), its crest `rise`
   * over the higher; below the higher side it is a wall (`wall`), above it its crest (`top`).
   */
  const ridge = (xy: number[], closed: boolean, width: (i: number) => number, left: (i: number) => number, right: (i: number) => number, rise: (i: number) => number, wall: Color, top: Color): void => {
    const c = xy.length / 2;
    if (c < 2) return;
    const ring = (i: number): number => (closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
    const hl = Array.from({ length: c }, (_, i) => left(i));
    const hr = Array.from({ length: c }, (_, i) => right(i));
    const r0 = ridgePos.length / 3;
    for (let i = 0; i < c; i++) {
      const a = ring(i - 1);
      const b = ring(i + 1);
      const tx = xy[2 * b] - xy[2 * a];
      const ty = xy[2 * b + 1] - xy[2 * a + 1];
      const l = Math.hypot(tx, ty) || 1;
      const ox = -ty / l;
      const oy = tx / l;
      let lowL = hl[i];
      let lowR = hr[i];
      for (let d = -3; d <= 3; d++) {
        lowL = Math.min(lowL, hl[ring(i + d)]);
        lowR = Math.min(lowR, hr[ring(i + d)]);
      }
      const higher = Math.max(hl[i], hr[i]);
      const crest = higher + rise(i);
      const half = width(i) / 2;
      for (const [u, f] of RIDGE) {
        const foot = (u < 0 ? lowL : lowR) - UNDER;
        const h = foot + (crest - foot) * f;
        // (u < 0 the left foot: along the left normal)
        ridgePos.push(xy[2 * i] - ox * u * half, h, -(xy[2 * i + 1] - oy * u * half));
        const k = h < higher - 0.005 ? wall : top;
        ridgeCol.push(k.r, k.g, k.b);
      }
    }
    const M = RIDGE.length;
    for (let i = 0; i < (closed ? c : c - 1); i++) {
      const a = r0 + i * M;
      const b = r0 + ring(i + 1) * M;
      for (let j = 0; j + 1 < M; j++) ridgeIdx.push(a + j, b + j, b + j + 1, a + j, b + j + 1, a + j + 1);
    }
    // (its ends closed: the profile fanned from its left foot)
    if (!closed) for (const i of [0, c - 1]) for (let j = 1; j + 1 < M; j++) ridgeIdx.push(r0 + i * M, r0 + i * M + j, r0 + i * M + j + 1);
  };
  for (const line of cutLines) {
    // (from inside its bank's dam, a dam's half-width up the band)
    const xy = resampleXY(line.xy, false, SPACING / 2).slice(2 * Math.round(D.width / 2 / (SPACING / 2)));
    if (xy.length < 4) continue;
    const floor = floorOf(line.band);
    ridge(
      xy,
      false,
      (i) => 0.7 * (D.width + D.widthVar * widthNoise.at(xy[2 * i] / D.widthScale, xy[2 * i + 1] / D.widthScale, wg)),
      () => floor,
      () => floor,
      (i) => 0.9 * Math.max(D.height + D.heightVar * heightNoise.at(xy[2 * i] / D.widthScale, xy[2 * i + 1] / D.widthScale, wg), 0.04),
      damColour,
      damColour,
    );
  }
  // the plots' bunds
  const uCross = (u: number, w: number, i: number): number => grid.crossing(SLOT.u + i + 50000, u, w, U, i);
  const vCross = (u: number, w: number, j: number): number => grid.crossing(SLOT.v + j + 50000, u, w, V, j);
  const flatRuns = (chains: Chain[], width: number): void => {
    for (const ch of chains) {
      const xy = resample(ch, SPACING);
      const c = xy.length / 2;
      const ok = new Uint8Array(c);
      for (let i = 0; i < c; i++) ok[i] = classAt(xy[2 * i], xy[2 * i + 1]) === 1 ? 1 : 0;
      for (const run of runs(ok, ch.closed)) {
        const r = run.idx.flatMap((i) => [xy[2 * i], xy[2 * i + 1]]);
        const probe = (i: number, s: number): number => {
          const a = Math.max(i - 1, 0);
          const b = Math.min(i + 1, r.length / 2 - 1);
          const tx = r[2 * b] - r[2 * a];
          const ty = r[2 * b + 1] - r[2 * a + 1];
          const l = Math.hypot(tx, ty) || 1;
          return plotFloorAt(r[2 * i] - (s * ty) / l, r[2 * i + 1] + (s * tx) / l);
        };
        ridge(r, run.closed, () => width, (i) => probe(i, 0.1), (i) => probe(i, -0.1), () => 0.75 * D.height, riserColour, damColour);
      }
    }
  };
  flatRuns(grid.trace(ui, uCross), 0.7 * D.width);
  flatRuns(grid.trace(vi, vCross), 0.7 * D.width);
  // where the flats meet the terraces: a bund between the plot and the paddy
  const edgeRidge = (chains: Chain[], width: number, rise: (hl: number, hr: number) => number, wall: Color, top: Color): void => {
    for (const ch of chains) {
      const xy = resample(ch, SPACING);
      const c = xy.length / 2;
      if (c < 2) continue;
      const side = (i: number, s: number): number => {
        const a = ch.closed ? (i - 1 + c) % c : Math.max(i - 1, 0);
        const b = ch.closed ? (i + 1) % c : Math.min(i + 1, c - 1);
        const tx = xy[2 * b] - xy[2 * a];
        const ty = xy[2 * b + 1] - xy[2 * a + 1];
        const l = Math.hypot(tx, ty) || 1;
        return surfaceAt(xy[2 * i] - (s * ty) / l, xy[2 * i + 1] + (s * tx) / l);
      };
      ridge(xy, ch.closed, () => width, (i) => side(i, width / 2 + 0.02), (i) => side(i, -width / 2 - 0.02), (i) => rise(side(i, width / 2 + 0.02), side(i, -width / 2 - 0.02)), wall, top);
    }
  };
  edgeRidge(grid.trace(flatIdx, (u, w) => grid.crossing(SLOT.flat, u, w, flatF, 0)), 0.7 * D.width, () => 0.75 * D.height, riserColour, damColour);
  // (the woods on the left: a bank of earth up to the woods, or a bund where the paddy stands above them)
  edgeRidge(grid.trace(woodsIdx, (u, w) => grid.crossing(SLOT.steep, u, w, steepF, 0)), 0.5, (hl, hr) => (hr > hl ? D.height : 0.03), earthColour, earthColour);

  time('Ridges');
  // the block's edges, cut straight down from whatever stands on them
  const sidePos: number[] = [...capPos];
  let bottom = Infinity;
  for (let v = 0; v < N; v++) bottom = Math.min(bottom, T[v]);
  bottom -= 2;
  const border = (u: number, w: number): void => {
    const ts: number[] = [0, 1];
    const len = Math.hypot(X[w] - X[u], Y[w] - Y[u]);
    const add = (p: number): void => {
      ts.push(Math.hypot(grid.px[p] - X[u], grid.py[p] - Y[u]) / len);
    };
    if (isWoods(u) !== isWoods(w)) add(grid.crossing(SLOT.steep, u, w, steepF, 0));
    if (isFlat(u) !== isFlat(w)) add(grid.crossing(SLOT.flat, u, w, flatF, 0));
    for (let k = Math.min(bands.band[u], bands.band[w]) + 1; k <= Math.max(bands.band[u], bands.band[w]); k++) add(bands.cross(u, w, k));
    for (let i = Math.min(ui[u], ui[w]) + 1; i <= Math.max(ui[u], ui[w]); i++) add(uCross(u, w, i));
    for (let j = Math.min(vi[u], vi[w]) + 1; j <= Math.max(vi[u], vi[w]); j++) add(vCross(u, w, j));
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] < 1e-9) continue;
      const x0 = X[u] + (X[w] - X[u]) * ts[i];
      const y0 = Y[u] + (Y[w] - Y[u]) * ts[i];
      const x1 = X[u] + (X[w] - X[u]) * ts[i + 1];
      const y1 = Y[u] + (Y[w] - Y[u]) * ts[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const woods = classAt(mx, my) === 0;
      const h0 = woods ? height(x0, y0) : surfaceAt(mx, my);
      const h1 = woods ? height(x1, y1) : h0;
      sidePos.push(x0, h0, -y0, x0, bottom, -y0, x1, bottom, -y1, x0, h0, -y0, x1, bottom, -y1, x1, h1, -y1);
    }
  };
  for (let i = 0; i + 1 < n; i++) {
    border(i, i + 1);
    border((n - 1) * n + i + 1, (n - 1) * n + i);
    border((i + 1) * n, i * n);
    border(i * n + n - 1, (i + 1) * n + n - 1);
  }

  // the trees: one about every treeSpacing m where the woods are, each its own size and green
  const treeAt: number[] = [];
  const treeTint: number[] = [];
  let rs = (seed * 2246822519 + 7) >>> 0 || 1;
  const rand = (): number => {
    rs ^= rs << 13;
    rs >>>= 0;
    rs ^= rs >>> 17;
    rs ^= rs << 5;
    rs >>>= 0;
    return rs / 4294967296;
  };
  const sp = P.treeSpacing;
  for (let y = -P.half + sp / 2; y < P.half; y += sp) {
    for (let x = -P.half + sp / 2; x < P.half; x += sp) {
      const tx = x + (rand() - 0.5) * sp * 0.9;
      const ty = y + (rand() - 0.5) * sp * 0.9;
      const size = rand();
      const shadeT = rand();
      if (Math.abs(tx) > P.half - 0.6 || Math.abs(ty) > P.half - 0.6) continue;
      if (field.slope(tx, ty) - fp.steep < 0.03 || rand() > 0.85) continue;
      const h = 3.2 + 3.8 * size;
      treeAt.push(tx, height(tx, ty), -ty, h, 0.26 * h + 0.3);
      const c = srgb(0.2, 0.33, 0.16).lerp(srgb(0.33, 0.45, 0.2), shadeT);
      treeTint.push(c.r, c.g, c.b);
    }
  }

  const floors = geometry(floorPos, floorCol);
  const woods = new BufferGeometry();
  woods.setAttribute('position', new Float32BufferAttribute(woodsPos, 3));
  woods.setAttribute('normal', new Float32BufferAttribute(woodsNrm, 3));
  woods.setAttribute('color', new Float32BufferAttribute(woodsCol, 3));
  const damCol: number[] = [];
  for (let i = 0; i < damPos.length / 3; i++) damCol.push(damColour.r, damColour.g, damColour.b);
  const dams = indexed([damPos, ridgePos], [damIdx, ridgeIdx], [damCol, ridgeCol]);
  const risers = indexed([riserPos], [riserIdx]);
  const sidesG = geometry(sidePos);
  const outlines = new BufferGeometry();
  outlines.setAttribute('position', new Float32BufferAttribute(lines, 3));
  stats.floorTriangles = floorPos.length / 9;
  stats.trees = treeAt.length / 5;
  return {
    floors,
    woods,
    dams,
    risers,
    sides: sidesG,
    outlines,
    trees: { count: treeAt.length / 5, at: new Float32Array(treeAt), tint: new Float32Array(treeTint) },
    cuts: cutLines,
    stats,
  };
}

function geometry(pos: number[], col?: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function indexed(pos: number[][], idx: number[][], col?: number[][]): BufferGeometry {
  const all: number[] = [];
  const index: number[] = [];
  const colours: number[] = [];
  for (let p = 0; p < pos.length; p++) {
    const base = all.length / 3;
    for (const v of pos[p]) all.push(v);
    for (const i of idx[p]) index.push(base + i);
    if (col) for (const c of col[p]) colours.push(c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(all, 3));
  if (col) g.setAttribute('color', new Float32BufferAttribute(colours, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The runs of a chain's points that are kept (ok): each a list of indices, closed if the whole of a ring. */
function runs(ok: Uint8Array, closed: boolean): Array<{ idx: number[]; closed: boolean }> {
  const c = ok.length;
  if (closed && ok.every((v) => v === 1)) return [{ idx: Array.from({ length: c }, (_, i) => i), closed: true }];
  const out: Array<{ idx: number[]; closed: boolean }> = [];
  // (a ring's run may wrap past its start: begin after a point that is not kept)
  const start = closed ? ok.indexOf(0) + 1 : 0;
  let cur: number[] = [];
  for (let s = 0; s < c; s++) {
    const i = (start + s) % c;
    if (ok[i]) cur.push(i);
    else {
      if (cur.length >= 3) out.push({ idx: cur, closed: false });
      cur = [];
    }
  }
  if (cur.length >= 3) out.push({ idx: cur, closed: false });
  return out;
}

/** A chain evened out: points every `step` m along it (an open one keeps its two ends). */
function resample(chain: Chain, step: number): number[] {
  return resampleXY(chain.xy, chain.closed, step);
}

function resampleXY(src: readonly number[], closed: boolean, step: number): number[] {
  const xy = closed ? [...src, src[0], src[1]] : src;
  const cum = [0];
  for (let i = 2; i < xy.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]));
  const total = cum[cum.length - 1];
  const count = Math.max(closed ? 3 : 1, Math.round(total / step));
  const out: number[] = [];
  let seg = 0;
  for (let s = 0; s <= (closed ? count - 1 : count); s++) {
    const d = (s / count) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const t = (d - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-12);
    out.push(xy[2 * seg] + (xy[2 * seg + 2] - xy[2 * seg]) * t, xy[2 * seg + 1] + (xy[2 * seg + 3] - xy[2 * seg + 1]) * t);
  }
  return out;
}

/** Widths eased along a bank: the narrowest nearby carried a little way on, then averaged (never wider than they were). */
function soften(w: Float64Array, closed: boolean): void {
  const n = w.length;
  const r = 4;
  const at = (a: Float64Array, i: number): number => (closed ? a[(i + n) % n] : a[Math.min(Math.max(i, 0), n - 1)]);
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = Infinity;
    for (let d = -r; d <= r; d++) v = Math.min(v, at(w, i + d));
    low[i] = v;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += at(low, i + d);
    w[i] = Math.min(w[i], s / (2 * r + 1));
  }
}
