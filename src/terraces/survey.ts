import { Vector3 } from 'three';
import { clamp, smoothstep } from '../core/math';
import type { CubeReadback } from './bakeReader';
import type { CellSample } from './cells';
import { createCropSample, createPlotSample, SEASON, TERRACE, type CropSample, type TerracePlots } from './plots';

// The terraces surveyed, cell by cell (ARCHITECTURE.md, "Terraces built on
// the hills"). A cell is read on a grid in its own tangent chart (its middle
// at the origin), from the bakes read back to the CPU: the hills' height,
// smoothed a little (so the walls run as smooth curves, the hillside's small
// turns kept), and how far each point lies inside the cell's terraced land
// (in its cell, not wild, not a valley's flat floor: a signed distance, so
// the land's edge is a smooth line). Then:
//
//   walls    the cell's levels (its own riser and offset, each wall a little
//            off its place, here and there one left out) traced as contours
//            of the smoothed hills: polylines, uphill on their left
//   bands    every point of the land in the band between two walls
//   cuts     from points along each band's lower wall every 22–48 m
//            (square-ish where the cell is gentle; from its upper wall where
//            it has none below), a line up the slope across the band to its
//            upper wall, leaning round toward both ends: from a slight C to a
//            full round end
//   paddies  each band's points flooded, the cuts as fences: every part a
//            paddy, with its own crop, plants' height and water level
//
// The meshes are built from this (floors.ts, terraceMesh.ts): each grid
// square clipped exactly at the walls, the cuts and the land's edge.

/** The planet's cuts: a cut wherever a wall's cut field (plots.ts cutField, a noise so many meters across) crosses a step; at most this long across its band (m), drawn at this spacing (m), heading at least this much up the slope (the cosine). */
export const CUTS = { step: 0.24, reach: 30, spacing: 0.25, uphill: 0.6 } as const;

/**
 * What a survey lays out: the terraces on the hills (their riser, their cuts' field this many meters
 * across, how far the cuts bow to one side, a share of their length), or the plots on the valleys' flat floors (strips along their gentle
 * contours a low riser apart, cut square-ish and nearly straight; the villages' courtyards left out).
 */
export const MODES = {
  terraces: { riser: TERRACE.step, offsetKey: 0, cutMeters: TERRACE.cutMeters, bow: [0.06, 0.26], levelKey: 0, merges: true },
  flats: { riser: 0.2, offsetKey: 1, cutMeters: 17, bow: [0.02, 0.1], levelKey: 100000, merges: false },
} as const;
export type SurveyMode = keyof typeof MODES;

/**
 * A wide band's lens (Kai: paddies all of a width, now and then a wider one): where a band is wider than `wide`
 * (m, from none to full; its slope read smoothed over σ `smooth` m), a lower terrace grows inside it along its
 * lower wall, up to `share` of the way across; where the band narrows again its wall meets the lower one at an
 * angle (`lead`). Its floor stands `floor` of the way up the band.
 */
export const LENS = { smooth: 2, wide: [6.5, 10], share: 0.5, lead: 0.06, floor: 0.2 } as const;

/** A lens's share across a band D meters tall where the hills' smoothed slope is `slope` (≤ 0: none there). */
export function lensShare(D: number, slope: number): number {
  return LENS.share * smoothstep(LENS.wide[0], LENS.wide[1], D / Math.max(slope, 1e-3)) - LENS.lead;
}

/** Where a point of height H lies against band B's lens: < 0 inside it (linear in H, so clipped exactly). */
export function lensSide(B: Band, H: number, slope: number): number {
  const D = B.hi - B.lo;
  return (H - B.lo) / D - lensShare(D, slope);
}

export const SURVEY = {
  /** The grid the hills are read on (m), and how far the reading is smoothed (σ, m). */
  spacing: 0.5,
  smooth: 1.1,
  /** Wild and flat (0..1) count this many meters per unit in the land's signed distance. */
  softness: 4,
  /** The cell's extent is found on a grid this coarse (m), out to this many cell sizes from its site. */
  scan: 4,
  reach: 1.7,
  /** Read this far round the cell (m): the smoothings' reach (3σ each, the hills' and the lenses' slope), so its own part reads as its neighbours read it. */
  frame: 10,
  /** A step of the survey's work takes about this many grid points (its job yields between). */
  slice: 25000,
} as const;

/** A wall: a contour of the smoothed hills at a level, uphill on its left (x, y pairs in the chart, m). */
export interface Wall {
  /** Its index among the survey's levels, its height (m), its level on the planet. */
  readonly index: number;
  readonly level: number;
  readonly height: number;
  readonly points: Float64Array;
  /** Arc length at each point (m). */
  readonly s: Float64Array;
  readonly closed: boolean;
}

/** A band of the land between two walls (by index into levels). */
export interface Band {
  readonly index: number;
  /** Its walls' heights (m), and its floor (m). */
  readonly lo: number;
  readonly hi: number;
  readonly floorH: number;
}

/** A paddy: its band, its crop. */
export interface Paddy {
  readonly id: number;
  readonly band: number;
  readonly crop: CropSample;
  /** Its own floor (m): a lens's, or a flats' plot, level with the ground under its middle (a terraced paddy's is its band's). */
  readonly floorH?: number;
}

/** A lens's wall: a contour across its band (x, y pairs in the chart, m), uphill on its left, from the band's lower wall back to it (or round). */
export interface LensWall {
  readonly band: number;
  readonly points: Float64Array;
  readonly closed: boolean;
}

/** A cut across a band: its points (x, y pairs in the chart, m) from one wall to the other (or to the land's edge). */
export interface Cut {
  readonly band: number;
  readonly points: Float64Array;
}

export interface CellSurvey {
  readonly cell: CellSample;
  /** The chart: its middle (unit direction) and axes; a point (x, y) is the direction of centre·R + e1·x + e2·y. */
  readonly centre: Vector3;
  readonly e1: Vector3;
  readonly e2: Vector3;
  readonly R: number;
  readonly riser: number;
  /** The grid: n × n points `g` apart from (−half, −half). */
  readonly n: number;
  readonly g: number;
  readonly half: number;
  /** Per grid point: the hills' own height and the smoothed one (m), the signed distance into the terraced land (m: not wild, not flat), and into this cell (m). */
  readonly h: Float32Array;
  readonly hs: Float32Array;
  readonly land: Float32Array;
  readonly side: Float32Array;
  /** The walls' heights (all the cell's levels round its land, low to high), the walls traced, the bands. */
  readonly levels: Float64Array;
  readonly walls: Wall[];
  readonly bands: Band[];
  /** Per grid point: its band (−1 off the land), its paddy (−1 off the land). */
  readonly band: Int32Array;
  readonly paddy: Int32Array;
  readonly paddies: Paddy[];
  /** Per grid point: in its band's lens (1) or not; the hills' slope smoothed (the lenses grow where it is gentle). Its lenses' walls. */
  readonly sub: Uint8Array;
  readonly slope: Float32Array;
  readonly lensWalls: LensWall[];
  readonly cuts: Cut[];
  /** The cuts' segments through each grid square (square index → [cut, segment] pairs). */
  readonly crossing: Map<number, number[]>;
}

const dir = new Vector3();

/** A point of the chart as a direction. */
export function chartDir(t: { centre: Vector3; e1: Vector3; e2: Vector3 }, R: number, x: number, y: number, out: Vector3): Vector3 {
  return out.copy(t.centre).multiplyScalar(R).addScaledVector(t.e1, x).addScaledVector(t.e2, y).normalize();
}

/** A field blurred by a Gaussian of σ grid squares, a step every so many rows (its job yields between). */
function* gaussian(src: Float32Array, n: number, sigma: number): Generator<void, Float32Array, void> {
  const r = Math.ceil(3 * sigma);
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += w[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < w.length; k++) w[k] /= sum;
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    if (j % 64 === 63) yield;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -r; k <= r; k++) a += w[k + r] * src[j * n + clamp(i + k, 0, n - 1)];
      tmp[j * n + i] = a;
    }
  }
  for (let j = 0; j < n; j++) {
    if (j % 64 === 63) yield;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -r; k <= r; k++) a += w[k + r] * tmp[clamp(j + k, 0, n - 1) * n + i];
      out[j * n + i] = a;
    }
  }
  return out;
}

/** A field blurred as a Gaussian of σ grid squares would blur it, near enough (three box passes each way, their widths odd): as fast for a wide σ as a narrow one. */
function boxBlur(src: Float32Array, n: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.round(0.5 * (Math.sqrt(4 * sigma * sigma + 1) - 1)));
  const w = 2 * r + 1;
  let a = Float32Array.from(src);
  let b = new Float32Array(n * n);
  for (let pass = 0; pass < 6; pass++) {
    // along rows on the even passes, down columns on the odd: (i, j) → index
    const at = pass % 2 === 0 ? (line: number, x: number): number => line * n + x : (line: number, x: number): number => x * n + line;
    for (let line = 0; line < n; line++) {
      let sum = 0;
      for (let x = -r - 1; x < r; x++) sum += a[at(line, clamp(x, 0, n - 1))];
      for (let x = 0; x < n; x++) {
        sum += a[at(line, Math.min(x + r, n - 1))] - a[at(line, Math.max(x - r - 1, 0))];
        b[at(line, x)] = sum / w;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * The contour of a field at value H over the grid squares inside the land
 * (marching squares), chained into polylines with the higher side on their
 * left. inside(k): whether grid point k counts.
 */
export function contour(
  field: Float32Array,
  n: number,
  g: number,
  half: number,
  H: number,
  inside: (k: number) => boolean,
  box: readonly [number, number, number, number] = [0, 0, n - 1, n - 1],
): Array<{ points: number[]; closed: boolean }> {
  const v = (k: number): number => field[k] - H;
  const cross = (e: number): [number, number] => {
    const k = e >> 1;
    const i = k % n;
    const j = (k - i) / n;
    const a = v(k);
    if ((e & 1) === 0) {
      const t = a / (a - v(k + 1));
      return [-half + (i + t) * g, -half + j * g];
    }
    const t = a / (a - v(k + n));
    return [-half + i * g, -half + (j + t) * g];
  };
  const next = new Map<number, number>();
  const into = new Set<number>();
  for (let j = box[1]; j < box[3]; j++) {
    for (let i = box[0]; i < box[2]; i++) {
      const k = j * n + i;
      if (!(inside(k) && inside(k + 1) && inside(k + n) && inside(k + n + 1))) continue;
      const a = v(k);
      const b = v(k + 1);
      const c = v(k + n + 1);
      const d = v(k + n);
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const bottom = 2 * k;
      const right = 2 * (k + 1) + 1;
      const top = 2 * (k + n);
      const left = 2 * k + 1;
      // each segment oriented with the high side (the corners over H) on its left
      const add = (from: number, to: number): void => {
        next.set(from, to);
        into.add(to);
      };
      switch (code) {
        case 1:
          add(bottom, left);
          break;
        case 2:
          add(right, bottom);
          break;
        case 3:
          add(right, left);
          break;
        case 4:
          add(top, right);
          break;
        case 6:
          add(top, bottom);
          break;
        case 7:
          add(top, left);
          break;
        case 8:
          add(left, top);
          break;
        case 9:
          add(bottom, top);
          break;
        case 11:
          add(right, top);
          break;
        case 12:
          add(left, right);
          break;
        case 13:
          add(bottom, right);
          break;
        case 14:
          add(left, bottom);
          break;
        case 5:
        case 10: {
          // a saddle: the middle decides which corners join
          const mid = 0.25 * (a + b + c + d) > 0;
          if (code === 5) {
            if (mid) {
              add(top, left);
              add(bottom, right);
            } else {
              add(bottom, left);
              add(top, right);
            }
          } else if (mid) {
            add(left, bottom);
            add(right, top);
          } else {
            add(left, top);
            add(right, bottom);
          }
          break;
        }
      }
    }
  }
  const lines: Array<{ points: number[]; closed: boolean }> = [];
  const used = new Set<number>();
  const walk = (start: number): void => {
    const points: number[] = [];
    let e: number | undefined = start;
    let closed = false;
    while (e !== undefined && !used.has(e)) {
      used.add(e);
      const p = cross(e);
      points.push(p[0], p[1]);
      e = next.get(e);
      if (e === start) closed = true;
    }
    if (points.length >= 4) lines.push({ points, closed });
  };
  for (const from of next.keys()) if (!into.has(from) && !used.has(from)) walk(from);
  for (const from of next.keys()) if (!used.has(from)) walk(from);
  return lines;
}

/** A polyline resampled every `step` m along it: points and arc lengths. */
export function resample(points: number[], closed: boolean, step: number): { p: Float64Array; s: Float64Array } {
  const m = points.length / 2;
  const cum = [0];
  for (let k = 1; k < m; k++) cum.push(cum[k - 1] + Math.hypot(points[2 * k] - points[2 * k - 2], points[2 * k + 1] - points[2 * k - 1]));
  let total = cum[m - 1];
  if (closed) total += Math.hypot(points[0] - points[2 * m - 2], points[1] - points[2 * m - 1]);
  const count = Math.max(2, Math.round(total / step) + (closed ? 0 : 1));
  const ds = total / (closed ? count : count - 1);
  const p = new Float64Array(2 * count);
  const s = new Float64Array(count);
  let k = 0;
  for (let c = 0; c < count; c++) {
    const target = c * ds;
    while (k < m - 1 && cum[k + 1] < target) k++;
    let ax = points[2 * k];
    let ay = points[2 * k + 1];
    let bx: number;
    let by: number;
    let t: number;
    if (k < m - 1) {
      bx = points[2 * k + 2];
      by = points[2 * k + 3];
      t = (target - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-9);
    } else {
      ax = points[2 * m - 2];
      ay = points[2 * m - 1];
      bx = points[0];
      by = points[1];
      t = (target - cum[m - 1]) / Math.max(total - cum[m - 1], 1e-9);
    }
    t = clamp(t, 0, 1);
    p[2 * c] = ax + (bx - ax) * t;
    p[2 * c + 1] = ay + (by - ay) * t;
    s[c] = target;
  }
  return { p, s };
}

/** Survey a cell at once (dev, tests): surveyCellJob run through. */
export function surveyCell(
  cell: CellSample,
  R: number,
  cellSize: number,
  terrain: CubeReadback,
  layout: CubeReadback,
  plots: TerracePlots,
  front: number,
  mode: SurveyMode = 'terraces',
  yard: (dir: Vector3) => number = () => 1e9,
  inCell: (dir: Vector3) => number = () => Number.NaN,
): CellSurvey {
  const job = surveyCellJob(cell, R, cellSize, terrain, layout, plots, front, mode, yard, inCell);
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

/** Survey a cell, a few milliseconds a step: its land, walls, bands, cuts and paddies (crop at the season's front). */
export function* surveyCellJob(
  cell: CellSample,
  R: number,
  cellSize: number,
  terrain: CubeReadback,
  layout: CubeReadback,
  plots: TerracePlots,
  front: number,
  mode: SurveyMode = 'terraces',
  yard: (dir: Vector3) => number = () => 1e9,
  inCell: (dir: Vector3) => number = () => Number.NaN,
): Generator<void, CellSurvey, void> {
  const M = MODES[mode];
  // (the cell itself, from its own geometry on the CPU: the same function for every cell)
  const isCell = (dir: Vector3): boolean => !(inCell(dir) < 0);
  // the chart round the cell itself (its site can lie off to one side of it: the cells are a warped Voronoi of
  // points in space), wide enough to take all of it and the frame. Its points are found on a coarse grid by
  // the layout's key, each checked for the cell itself (isCell: another cell nearby can have the same key)
  const site = { centre: cell.centre, e1: cell.along, e2: new Vector3().crossVectors(cell.centre, cell.along).normalize() };
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const S = SURVEY.scan;
  const m = 2 * Math.ceil((SURVEY.reach * cellSize) / S) + 1;
  const reach = 0.5 * (m - 1) * S;
  const own = new Uint8Array(m * m);
  for (let sj = 0; sj < m; sj++) {
    for (let si = 0; si < m; si++) {
      const x = -reach + si * S;
      const y = -reach + sj * S;
      chartDir(site, R, x, y, dir);
      if (Math.floor(layout.nearest(dir, 0) * 1024) !== cell.key || !isCell(dir)) continue;
      own[sj * m + si] = 1;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }
  /** Whether a direction lies by the cell's own points on the coarse grid (within a step of one). */
  const ownNear = (d: Vector3): boolean => {
    const t = R / Math.max(d.dot(site.centre), 1e-6);
    const si = Math.round((t * d.dot(site.e1) + reach) / S);
    const sj = Math.round((t * d.dot(site.e2) + reach) / S);
    for (let b = Math.max(sj - 1, 0); b <= Math.min(sj + 1, m - 1); b++) for (let a = Math.max(si - 1, 0); a <= Math.min(si + 1, m - 1); a++) if (own[b * m + a]) return true;
    return false;
  };
  if (!(box[2] >= box[0])) box.fill(0);
  const centre = chartDir(site, R, 0.5 * (box[0] + box[2]), 0.5 * (box[1] + box[3]), new Vector3());
  const e1 = cell.along.clone().addScaledVector(centre, -cell.along.dot(centre)).normalize();
  const e2 = new Vector3().crossVectors(centre, e1).normalize();
  const chart = { centre, e1, e2 };
  const g = SURVEY.spacing;
  const half = Math.ceil((0.5 * Math.max(box[2] - box[0], box[3] - box[1]) + SURVEY.scan + SURVEY.frame) / g) * g;
  const n = Math.round((2 * half) / g) + 1;
  const N = n * n;
  const h = new Float32Array(N);
  const land = new Float32Array(N);
  const side = new Float32Array(N);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      chartDir(chart, R, -half + i * g, -half + j * g, dir);
      const k = j * n + i;
      h[k] = terrain.sample(dir, 0);
      // the terraced land (not wild, not flat); and this cell (signed by its key: the edge distance is the
      // same either side). The terraces run on across cells: a cell only builds its own part of them
      const mine = Math.floor(layout.nearest(dir, 0) * 1024) === cell.key && ownNear(dir);
      const edge = layout.sample(dir, 3);
      side[k] = mine ? edge : -edge;
      // (near its edge the bake's texels can tell two neighbours different stories, leaving a gap between their
      // floors: there both read the cells' own geometry, one function for both)
      if (edge < 2.5) {
        const exact = inCell(dir);
        if (!Number.isNaN(exact)) side[k] = exact;
      }
      const wild = (0.5 - terrain.sample(dir, 2)) * SURVEY.softness;
      const fl = terrain.sample(dir, 3);
      const flat = (fl - 0.5) * SURVEY.softness;
      // (1 … 2 in the river: the plots end at the top of its bank)
      const plots = (Math.min(fl, 2 - fl) - 0.5) * SURVEY.softness;
      // the hills' terraces, or the valleys' plots (but a village's courtyards)
      land[k] = mode === 'terraces' ? Math.min(wild, -flat) : Math.min(wild, plots, yard(dir) - 1.0);
    }
    if (j % 16 === 15) yield;
  }
  // (a true Gaussian: the walls are its contours, and two cells must trace them alike, each on its own grid)
  const hs = yield* gaussian(h, n, SURVEY.smooth / g);
  yield;
  const inLand = (k: number): boolean => land[k] >= 0;
  if (mode === 'flats') return yield* flatsLayout(cell, chart, R, n, g, half, h, hs, land, side, plots, front);

  // the planet's levels (the same everywhere, so the walls run on from cell to cell): their heights, those
  // left out skipped (a band two levels wide, its walls half again as tall)
  const riser = M.riser;
  const phi = plots.offset(M.offsetKey);
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < N; k++) {
    if (!inLand(k)) continue;
    lo = Math.min(lo, hs[k]);
    hi = Math.max(hi, hs[k]);
  }
  const survey: CellSurvey = {
    cell,
    centre,
    e1,
    e2,
    R,
    riser,
    n,
    g,
    half,
    h,
    hs,
    land,
    side,
    levels: new Float64Array(0),
    walls: [],
    bands: [],
    band: new Int32Array(0),
    paddy: new Int32Array(0),
    paddies: [],
    sub: new Uint8Array(N),
    slope: new Float32Array(N),
    lensWalls: [],
    cuts: [],
    crossing: new Map(),
  };
  if (!(hi > lo)) return survey;
  const levelList: number[] = [];
  const levelIndex: number[] = [];
  for (let k = Math.floor(lo / riser + phi) - 2; k <= Math.ceil(hi / riser + phi) + 2; k++) {
    const w = plots.wall(M.offsetKey, k);
    if (!w.left || !M.merges) {
      levelList.push((w.at - phi) * riser);
      levelIndex.push(k + M.levelKey);
    }
  }
  const levels = Float64Array.from(levelList);
  const bandOf = (H: number): number => {
    let a = 0;
    let b = levels.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (levels[m] <= H) a = m;
      else b = m;
    }
    return a;
  };
  const bands: Band[] = [];
  for (let b = 0; b < levels.length - 1; b++)
    bands.push({
      index: b,
      lo: levels[b],
      hi: levels[b + 1],
      floorH: 0.5 * (levels[b] + levels[b + 1]),
    });

  // the walls: contours at the levels inside the land
  const walls: Wall[] = [];
  for (let w = 1; w < levels.length - 1; w++) {
    if (levels[w] < lo || levels[w] > hi) continue;
    for (const line of contour(hs, n, g, half, levels[w], inLand)) {
      const rs = resample(line.points, line.closed, 0.5);
      walls.push({
        index: w,
        level: levelIndex[w],
        height: levels[w],
        points: rs.p,
        s: rs.s,
        closed: line.closed,
      });
    }
    if (w % 2 === 1) yield;
  }

  yield;
  const band = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (inLand(k)) band[k] = bandOf(hs[k]);
  const wallsBy = new Map<number, number[]>();
  walls.forEach((w, wi) => {
    const list = wallsBy.get(w.index) ?? [];
    list.push(wi);
    wallsBy.set(w.index, list);
  });

  // the lenses: where a band gets wide (the hills gentle), a lower terrace inside it along its lower wall; its
  // wall a contour of the share across the band less the lens's share there (read the same in every cell: it
  // runs on), meeting the lower wall where the band narrows again
  const slope = new Float32Array(N);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, n - 1);
      const j0 = Math.max(j - 1, 0);
      const j1 = Math.min(j + 1, n - 1);
      slope[k] = Math.hypot((hs[j * n + i1] - hs[j * n + i0]) / ((i1 - i0) * g), (hs[j1 * n + i] - hs[j0 * n + i]) / ((j1 - j0) * g));
    }
  }
  yield;
  const gentle = boxBlur(slope, n, LENS.smooth / g);
  yield;
  const sub = new Uint8Array(N);
  const lensBands = new Set<number>();
  for (let k = 0; k < N; k++) {
    if (band[k] < 0) continue;
    if (lensSide(bands[band[k]], hs[k], gentle[k]) < 0) {
      sub[k] = 1;
      lensBands.add(band[k]);
    }
  }
  // (each band's lens traced on the grid round the band alone)
  const boxes = new Map<number, [number, number, number, number]>();
  for (let k = 0; k < N; k++) {
    if (!lensBands.has(band[k])) continue;
    const i = k % n;
    const j = (k - i) / n;
    const box = boxes.get(band[k]) ?? [i, j, i, j];
    box[0] = Math.min(box[0], i);
    box[1] = Math.min(box[1], j);
    box[2] = Math.max(box[2], i);
    box[3] = Math.max(box[3], j);
    boxes.set(band[k], box);
  }
  yield;
  const lensWalls: LensWall[] = [];
  const E = new Float32Array(N);
  const G = { n, g, half, hs, land };
  let done = 0;
  for (const [b, box] of boxes) {
    const B = bands[b];
    const i0 = Math.max(box[0] - 2, 0);
    const j0 = Math.max(box[1] - 2, 0);
    const i1 = Math.min(box[2] + 2, n - 1);
    const j1 = Math.min(box[3] + 2, n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) E[j * n + i] = lensSide(B, hs[j * n + i], gentle[j * n + i]);
    for (const line of contour(E, n, g, half, 0, inLand, [i0, j0, i1, j1])) {
      for (const part of withinBand(G, B, line.points, line.closed)) {
        const rs = resample(part.points, part.closed, 0.5);
        lensWalls.push({ band: b, points: rs.p, closed: part.closed });
      }
    }
    done += (i1 - i0 + 1) * (j1 - j0 + 1);
    if (done > SURVEY.slice) {
      done = 0;
      yield;
    }
  }

  // the cuts: along each band's lower wall, wherever the planet's cut field for that wall crosses a step (the
  // same wherever the wall is traced: the paddies run on from cell to cell), each a gentle arc across the band
  // the shortest way, to the nearest point of its upper wall (up the slope where it has none in reach); a cut
  // that meets another of its band ends on it. Each stretch between two cuts is a paddy: its id from its
  // wall's level and its step
  const traced: Array<{ band: number; points: Float64Array; rank: [number, number, number] }> = [];
  const stretches: Array<{ wall: number; step: Int32Array }> = [];
  const pd = new Vector3();
  for (const [wi, w] of walls.entries()) {
    if (wi % 16 === 15) yield;
    const B = bands[w.index];
    const m = w.s.length;
    const step = new Int32Array(m);
    for (let c = 0; c < m; c++) step[c] = Math.floor(plots.cutField(chartDir(chart, R, w.points[2 * c], w.points[2 * c + 1], pd), w.level) / CUTS.step);
    stretches.push({ wall: wi, step });
    if (!B) continue;
    for (let c = 0; c + 1 < m; c++) {
      if (step[c] === step[c + 1]) continue;
      const x0 = 0.5 * (w.points[2 * c] + w.points[2 * c + 2]);
      const y0 = 0.5 * (w.points[2 * c + 1] + w.points[2 * c + 3]);
      const at = Math.max(step[c], step[c + 1]);
      const hb = plots.hash(0, w.level, at, 0, 42);
      const points = cutAcross(G, B, x0, y0, (wallsBy.get(w.index + 1) ?? []).map((u) => walls[u].points), hb, M.bow) ?? cutUphill(G, B, x0, y0);
      chartDir(chart, R, x0, y0, pd);
      if (points) traced.push({ band: B.index, points, rank: [w.level, at, pd.x + 3 * pd.y] });
    }
  }
  yield;
  const cuts = endOnEachOther(traced);

  yield;
  // the cuts as fences on the grid: each grid edge they cross is closed; and each square's segments
  const closedEdge = new Uint8Array(2 * N);
  const crossing = new Map<number, number[]>();
  const fx = (x: number): number => (x + half) / g;
  cuts.forEach((cut, ci) => {
    const p = cut.points;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = fx(p[k]);
      const ay = fx(p[k + 1]);
      const bx = fx(p[k + 2]);
      const by = fx(p[k + 3]);
      const i0 = Math.max(Math.floor(Math.min(ax, bx)), 0);
      const i1 = Math.min(Math.floor(Math.max(ax, bx)), n - 2);
      const j0 = Math.max(Math.floor(Math.min(ay, by)), 0);
      const j1 = Math.min(Math.floor(Math.max(ay, by)), n - 2);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const sq = j * n + i;
          // the square's four edges this segment crosses
          let any = false;
          if (crosses(ax, ay, bx, by, i, j, i + 1, j)) {
            closedEdge[2 * (j * n + i)] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i, j + 1, i + 1, j + 1)) {
            closedEdge[2 * ((j + 1) * n + i)] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i, j, i, j + 1)) {
            closedEdge[2 * (j * n + i) + 1] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i + 1, j, i + 1, j + 1)) {
            closedEdge[2 * (j * n + i + 1) + 1] = 1;
            any = true;
          }
          if (!any && !(ax >= i && ax <= i + 1 && ay >= j && ay <= j + 1)) continue;
          const list = crossing.get(sq) ?? [];
          list.push(ci, k / 2);
          crossing.set(sq, list);
        }
      }
    }
  });

  yield;
  // the paddies: each band flooded, the cuts as fences; each part named by the wall stretch most of it
  // borders (a stretch: between two cuts along its lower wall), so a paddy keeps its id whichever cell traces
  // it, and one a cut does not quite close is one paddy, not two meeting on a stair-step
  const paddy = new Int32Array(N).fill(-1);
  const paddies: Paddy[] = [];
  const byKey = new Map<string, number>();
  const plot = createPlotSample();
  const paddyOf = (key: string, id: number, b: number, season: number, floorH?: number): number => {
    const known = byKey.get(key);
    if (known !== undefined) return known;
    plot.id = id;
    plot.season = season;
    const index = paddies.length;
    paddies.push({ id, band: b, crop: plots.cropOf(plot, front, createCropSample(), SEASON.band), floorH });
    byKey.set(key, index);
    return index;
  };
  // each grid point by a wall stretch: its level and step
  const stretchAt = new Map<number, [number, number]>();
  for (const { wall: wi, step } of stretches) {
    const w = walls[wi];
    if (!bands[w.index]) continue;
    for (let c = 0; c < step.length; c++) {
      const fi = Math.floor((w.points[2 * c] + half) / g);
      const fj = Math.floor((w.points[2 * c + 1] + half) / g);
      for (let dj = 0; dj <= 1; dj++) {
        for (let di = 0; di <= 1; di++) {
          const i = fi + di;
          const j = fj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const k = j * n + i;
          if (band[k] === w.index) stretchAt.set(k, [w.level, step[c]]);
        }
      }
    }
  }
  // (and the part of a band above its lens, by the stretches along the lens's wall: the same field as its lower wall's)
  for (const lw of lensWalls) {
    const level = levelIndex[lw.band];
    for (let c = 0; c < lw.points.length / 2; c++) {
      const st = Math.floor(plots.cutField(chartDir(chart, R, lw.points[2 * c], lw.points[2 * c + 1], pd), level) / CUTS.step);
      const fi = Math.floor((lw.points[2 * c] + half) / g);
      const fj = Math.floor((lw.points[2 * c + 1] + half) / g);
      for (let dj = 0; dj <= 1; dj++) {
        for (let di = 0; di <= 1; di++) {
          const i = fi + di;
          const j = fj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const k = j * n + i;
          if (band[k] === lw.band && sub[k] === 0 && !stretchAt.has(k)) stretchAt.set(k, [level, st]);
        }
      }
    }
  }
  yield;
  const part = new Int32Array(N).fill(-1);
  const queue: number[] = [];
  const members: number[] = [];
  let filled = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (band[k0] < 0 || part[k0] >= 0) continue;
    if (filled > SURVEY.slice) {
      filled = 0;
      yield;
    }
    const b = band[k0];
    const sb = sub[k0];
    part[k0] = k0;
    queue.length = 0;
    members.length = 0;
    queue.push(k0);
    const votes = new Map<string, number>();
    while (queue.length > 0) {
      const k = queue.pop() as number;
      members.push(k);
      const st = stretchAt.get(k);
      if (st) {
        const key = `${st[0]}/${st[1]}`;
        votes.set(key, (votes.get(key) ?? 0) + 1);
      }
      const i = k % n;
      const j = (k - i) / n;
      if (i + 1 < n && !closedEdge[2 * k] && band[k + 1] === b && sub[k + 1] === sb && part[k + 1] < 0) {
        part[k + 1] = k0;
        queue.push(k + 1);
      }
      if (i > 0 && !closedEdge[2 * (k - 1)] && band[k - 1] === b && sub[k - 1] === sb && part[k - 1] < 0) {
        part[k - 1] = k0;
        queue.push(k - 1);
      }
      if (j + 1 < n && !closedEdge[2 * k + 1] && band[k + n] === b && sub[k + n] === sb && part[k + n] < 0) {
        part[k + n] = k0;
        queue.push(k + n);
      }
      if (j > 0 && !closedEdge[2 * (k - n) + 1] && band[k - n] === b && sub[k - n] === sb && part[k - n] < 0) {
        part[k - n] = k0;
        queue.push(k - n);
      }
    }
    // named by the stretch most of its lower wall belongs to; with none here, by where it lies (to a few meters)
    let best = '';
    let most = 0;
    for (const [key, count] of votes) {
      if (count > most || (count === most && key < best)) {
        best = key;
        most = count;
      }
    }
    let idx: number;
    if (best) {
      const [level, step] = best.split('/').map(Number);
      // (a lens its own paddy, lower, its season a little its own)
      const lens = sb === 1 ? bands[b].lo + LENS.floor * (bands[b].hi - bands[b].lo) : undefined;
      idx = paddyOf(`${best}/${sb}`, plots.hash(0, level, step, sb, 47), b, plots.seasonOf(level + 0.5 * sb, step), lens);
    } else {
      const i0 = k0 % n;
      const j0 = (k0 - i0) / n;
      const q = chartDir(chart, R, -half + i0 * g, -half + j0 * g, pd);
      const id = plots.hash(0, levelIndex[b], Math.round((q.x * R) / 6), Math.round((q.y * R) / 6) * 7919 + Math.round((q.z * R) / 6), 48);
      const lens = sb === 1 ? bands[b].lo + LENS.floor * (bands[b].hi - bands[b].lo) : undefined;
      idx = paddyOf(`loose/${id}/${sb}`, plots.hash(0, id, sb, 0, 49), b, plots.seasonAt(q), lens);
    }
    for (const k of members) paddy[k] = idx;
    filled += members.length;
  }
  return {
    ...survey,
    levels,
    walls,
    bands,
    band,
    paddy,
    paddies,
    sub,
    slope: gentle,
    lensWalls,
    cuts,
    crossing,
  };
}

const unit = (h: number): number => (h >>> 8) / 16777216;

/** The flats' plots: rows (m wide), plots (× the row long), as Kai's references 12 and 13 lay them. */
export const FLATS = { width: [9, 16], length: [1, 2.3], bow: [0.3, 2.2] } as const;

/**
 * A valley's flat floor in a cell: rows along the cell's way, 9–16 m wide and gently bowed, cut into plots
 * 1–2.3 rows long, a little askew; each plot level with the ground under its middle (to 5 cm). Each cell's
 * block of plots is its own (the painting's blocks, each its own way); its edges are its roads.
 */
function* flatsLayout(
  cell: CellSample,
  chart: { centre: Vector3; e1: Vector3; e2: Vector3 },
  R: number,
  n: number,
  g: number,
  half: number,
  h: Float32Array,
  hs: Float32Array,
  land: Float32Array,
  side: Float32Array,
  plots: TerracePlots,
  front: number,
): Generator<void, CellSurvey, void> {
  const N = n * n;
  const key = cell.key;
  const W = FLATS.width[0] + (FLATS.width[1] - FLATS.width[0]) * unit(plots.hash(key, 0, 0, 0, 51));
  const phase = unit(plots.hash(key, 0, 0, 0, 52));
  const rowEdge = (r: number, x: number): number => {
    const hr = plots.hash(key, r, 0, 0, 53);
    const h2 = (Math.imul(hr, 747796405) + 2891336453) >>> 0;
    const bow = (FLATS.bow[0] + (FLATS.bow[1] - FLATS.bow[0]) * unit(hr)) * Math.sin(x / (9 + 6 * unit(h2)) + 2 * Math.PI * unit((h2 ^ 0x9e3779b9) >>> 0));
    return (r - phase + 0.28 * (2 * unit((hr ^ 0x85ebca6b) >>> 0) - 1)) * W + bow;
  };
  const rowLength = (r: number): { L: number; ph: number } => {
    const hr = plots.hash(key, r, 0, 0, 54);
    return { L: W * (FLATS.length[0] + (FLATS.length[1] - FLATS.length[0]) * unit(hr)), ph: unit((Math.imul(hr, 747796405) + 2891336453) >>> 0) };
  };
  const plotEdge = (r: number, j: number, y: number, yMid: number): number => {
    const { L, ph } = rowLength(r);
    const hp = plots.hash(key, r, j, 0, 56);
    const lean = 0.25 * (2 * unit((Math.imul(hp, 747796405) + 2891336453) >>> 0) - 1);
    return (j - ph + 0.3 * (2 * unit(hp) - 1)) * L + lean * (y - yMid);
  };
  const rowOf = (x: number, y: number): number => {
    let r = Math.floor(y / W + phase) - 1;
    while (rowEdge(r + 1, x) <= y) r++;
    while (rowEdge(r, x) > y) r--;
    return r;
  };
  const rowMid = (r: number): number => 0.5 * ((r - phase) * W + (r + 1 - phase) * W);
  const plotOf = (r: number, x: number, y: number): number => {
    const { L, ph } = rowLength(r);
    const yMid = rowMid(r);
    let j = Math.floor(x / L + ph) - 1;
    while (plotEdge(r, j + 1, y, yMid) <= x) j++;
    while (plotEdge(r, j, y, yMid) > x) j--;
    return j;
  };
  // every land point's plot; the plots' floors, from the ground under their middles
  const band = new Int32Array(N).fill(-1);
  const paddy = new Int32Array(N).fill(-1);
  const paddies: Paddy[] = [];
  const byKey = new Map<string, number>();
  const plot = createPlotSample();
  const pd = new Vector3();
  const heightUnder = (x: number, y: number): number => {
    const i = Math.min(Math.max(Math.round((x + half) / g), 0), n - 1);
    const j = Math.min(Math.max(Math.round((y + half) / g), 0), n - 1);
    return h[j * n + i];
  };
  const rows = new Set<number>();
  for (let k = 0; k < N; k++) {
    if (k % (48 * n) === 48 * n - 1) yield;
    if (land[k] < 0) continue;
    const i = k % n;
    const x = -half + i * g;
    const y = -half + ((k - i) / n) * g;
    const r = rowOf(x, y);
    const j = plotOf(r, x, y);
    rows.add(r);
    const name = `${r}/${j}`;
    let idx = byKey.get(name);
    if (idx === undefined) {
      const { L, ph } = rowLength(r);
      const xm = (j - ph + 0.5) * L;
      const ym = rowMid(r);
      plot.id = plots.hash(key, r, j, 1, 58);
      plot.season = plots.seasonAt(chartDir(chart, R, xm, ym, pd));
      idx = paddies.length;
      paddies.push({ id: plot.id, band: 0, crop: plots.cropOf(plot, front, createCropSample()), floorH: Math.round(heightUnder(xm, ym) / 0.05) * 0.05 });
      byKey.set(name, idx);
    }
    band[k] = 0;
    paddy[k] = idx;
  }
  // the plots' edges as cuts: the rows' edges along the way, the plots' across each row
  const cuts: Cut[] = [];
  for (const r of rows) {
    const pts: number[] = [];
    for (let x = -half; x <= half; x += 0.5) pts.push(x, rowEdge(r, x));
    cuts.push({ band: 0, points: Float64Array.from(pts) });
    const { L } = rowLength(r);
    const yMid = rowMid(r);
    for (let j = Math.floor(-half / L) - 2; j <= Math.ceil(half / L) + 2; j++) {
      const across: number[] = [];
      const y0 = rowEdge(r, plotEdge(r, j, yMid, yMid));
      const y1 = rowEdge(r + 1, plotEdge(r, j, yMid, yMid));
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const y = y0 + (y1 - y0) * t;
        across.push(plotEdge(r, j, y, yMid), y);
      }
      cuts.push({ band: 0, points: Float64Array.from(across) });
    }
  }
  yield;
  const { closedEdge, crossing } = fences(cuts, n, g, half);
  void closedEdge;
  const levels = Float64Array.from([-1e9, 1e9]);
  return {
    cell,
    centre: chart.centre,
    e1: chart.e1,
    e2: chart.e2,
    R,
    riser: 0,
    n,
    g,
    half,
    h,
    hs,
    land,
    side,
    levels,
    walls: [],
    bands: [{ index: 0, lo: -1e9, hi: 1e9, floorH: 0 }],
    band,
    paddy,
    paddies,
    sub: new Uint8Array(N),
    slope: new Float32Array(N),
    lensWalls: [],
    cuts,
    crossing,
  };
}

/** Cuts as fences on the grid: each grid edge a cut crosses is closed; and each square's cut segments (cut, segment). */
function fences(cuts: Cut[], n: number, g: number, half: number): { closedEdge: Uint8Array; crossing: Map<number, number[]> } {
  const closedEdge = new Uint8Array(2 * n * n);
  const crossing = new Map<number, number[]>();
  const fx = (x: number): number => (x + half) / g;
  cuts.forEach((cut, ci) => {
    const p = cut.points;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = fx(p[k]);
      const ay = fx(p[k + 1]);
      const bx = fx(p[k + 2]);
      const by = fx(p[k + 3]);
      const i0 = Math.max(Math.floor(Math.min(ax, bx)), 0);
      const i1 = Math.min(Math.floor(Math.max(ax, bx)), n - 2);
      const j0 = Math.max(Math.floor(Math.min(ay, by)), 0);
      const j1 = Math.min(Math.floor(Math.max(ay, by)), n - 2);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          let any = false;
          if (crosses(ax, ay, bx, by, i, j, i + 1, j)) {
            closedEdge[2 * (j * n + i)] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i, j + 1, i + 1, j + 1)) {
            closedEdge[2 * ((j + 1) * n + i)] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i, j, i, j + 1)) {
            closedEdge[2 * (j * n + i) + 1] = 1;
            any = true;
          }
          if (crosses(ax, ay, bx, by, i + 1, j, i + 1, j + 1)) {
            closedEdge[2 * (j * n + i + 1) + 1] = 1;
            any = true;
          }
          if (!any && !(ax >= i && ax <= i + 1 && ay >= j && ay <= j + 1)) continue;
          const sq = j * n + i;
          const list = crossing.get(sq) ?? [];
          list.push(ci, k / 2);
          crossing.set(sq, list);
        }
      }
    }
  });
  return { closedEdge, crossing };
}

/** The smoothed height at a chart point (bilinear). */
function heightAt(G: { n: number; g: number; half: number; hs: Float32Array }, x: number, y: number): number {
  const fxx = clamp((x + G.half) / G.g, 0, G.n - 1.0001);
  const fyy = clamp((y + G.half) / G.g, 0, G.n - 1.0001);
  const i = Math.floor(fxx);
  const j = Math.floor(fyy);
  const tx = fxx - i;
  const ty = fyy - j;
  const n = G.n;
  const a = G.hs[j * n + i] * (1 - tx) + G.hs[j * n + i + 1] * tx;
  const b = G.hs[(j + 1) * n + i] * (1 - tx) + G.hs[(j + 1) * n + i + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** The smoothed hills' slope at a chart point. */
function gradAt(G: { n: number; g: number; half: number; hs: Float32Array }, x: number, y: number, out: { x: number; y: number }): void {
  const e = 0.5 * G.g;
  out.x = (heightAt(G, x + e, y) - heightAt(G, x - e, y)) / (2 * e);
  out.y = (heightAt(G, x, y + e) - heightAt(G, x, y - e)) / (2 * e);
}

/** The land's signed distance at a chart point (bilinear). */
function landAt(n: number, g: number, half: number, land: Float32Array, x: number, y: number): number {
  const fxx = (x + half) / g;
  const fyy = (y + half) / g;
  if (fxx < 0 || fyy < 0 || fxx >= n - 1 || fyy >= n - 1) return -1;
  const i = Math.floor(fxx);
  const j = Math.floor(fyy);
  const tx = fxx - i;
  const ty = fyy - j;
  const a = land[j * n + i] * (1 - tx) + land[j * n + i + 1] * tx;
  const b = land[(j + 1) * n + i] * (1 - tx) + land[(j + 1) * n + i + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** Whether segment a–b crosses segment c–d (grid units). */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A band's across share at a height: 0 on its lower wall … 1 on its upper one. */
export function acrossOf(B: Band, H: number): number {
  return clamp((H - B.lo) / Math.max(B.hi - B.lo, 1e-6), 0, 1);
}

type Grid = { n: number; g: number; half: number; hs: Float32Array; land: Float32Array };

const inBand = (G: Grid, B: Band, x: number, y: number): boolean => {
  const H = heightAt(G, x, y);
  return H >= B.lo - 0.03 && H <= B.hi + 0.03 && landAt(G.n, G.g, G.half, G.land, x, y) >= 0;
};

/** The parts of a polyline within band B (its smoothed height between the band's walls), cut exactly where it crosses out. */
function withinBand(G: Grid, B: Band, points: number[], closed: boolean): Array<{ points: number[]; closed: boolean }> {
  const inside = (x: number, y: number): number => {
    const H = heightAt(G, x, y);
    return Math.min(H - B.lo, B.hi - H);
  };
  const m = points.length / 2;
  const count = closed ? m + 1 : m;
  const parts: Array<{ points: number[]; closed: boolean }> = [];
  let run: number[] = [];
  let prev = 0;
  for (let c = 0; c < count; c++) {
    const k = c % m;
    const x = points[2 * k];
    const y = points[2 * k + 1];
    const v = inside(x, y);
    if (c > 0 && v >= 0 !== prev >= 0) {
      const kp = (c - 1) % m;
      const t = prev / (prev - v);
      run.push(points[2 * kp] + (x - points[2 * kp]) * t, points[2 * kp + 1] + (y - points[2 * kp + 1]) * t);
      if (v < 0) {
        if (run.length >= 4) parts.push({ points: run, closed: false });
        run = [];
      }
    }
    if (v >= 0) run.push(x, y);
    prev = v;
  }
  if (run.length >= 4) parts.push({ points: run, closed: false });
  // (a loop wholly inside stays one)
  if (closed && parts.length === 1 && parts[0].points.length === 2 * count) return [{ points: points.slice(), closed: true }];
  return parts;
}

/**
 * A cut across band B from (x0, y0) on its lower wall: a gentle arc to the nearest point of the upper walls
 * (bowed to one side by a share of its length, `bow`), ended where it leaves the band near its end; null with
 * no upper wall in reach up the slope, or where the arc leaves the band early (it would cross a spur or a hollow).
 */
function cutAcross(G: Grid, B: Band, x0: number, y0: number, upper: readonly Float64Array[], hb: number, bow: readonly [number, number]): Float64Array | null {
  let best = CUTS.reach * CUTS.reach;
  let x1 = Number.NaN;
  let y1 = Number.NaN;
  for (const p of upper) {
    for (let k = 0; k < p.length; k += 2) {
      const d = (p[k] - x0) ** 2 + (p[k + 1] - y0) ** 2;
      if (d < best) {
        best = d;
        x1 = p[k];
        y1 = p[k + 1];
      }
    }
  }
  if (Number.isNaN(x1)) return null;
  const len = Math.sqrt(best);
  if (len < 0.3) return null;
  // (roughly up the slope: not to where an upper wall ends, off to one side)
  const grad = { x: 0, y: 0 };
  gradAt(G, x0, y0, grad);
  if ((x1 - x0) * grad.x + (y1 - y0) * grad.y < CUTS.uphill * len * Math.hypot(grad.x, grad.y)) return null;
  const share = (bow[0] + (bow[1] - bow[0]) * unit(hb)) * ((hb & 256) === 0 ? 1 : -1);
  const cx = 0.5 * (x0 + x1) - ((y1 - y0) / len) * share * len;
  const cy = 0.5 * (y0 + y1) + ((x1 - x0) / len) * share * len;
  const count = Math.max(2, Math.ceil((len * (1 + 2 * Math.abs(share))) / CUTS.spacing));
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * cx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * cy + t * t * y1;
    if (i > 0 && i < count && !inBand(G, B, x, y)) {
      if (t < 0.6) return null;
      break;
    }
    out.push(x, y);
  }
  return out.length >= 4 ? Float64Array.from(out) : null;
}

/** A cut traced up the slope from (x0, y0) to the band's upper level or the land's edge (where the band has no upper wall in reach); null where it gets to neither (it would part nothing). */
function cutUphill(G: Grid, B: Band, x0: number, y0: number): Float64Array | null {
  const grad = { x: 0, y: 0 };
  const out: number[] = [x0, y0];
  let x = x0;
  let y = y0;
  for (let d = 0; d < CUTS.reach; d += CUTS.spacing) {
    gradAt(G, x, y, grad);
    const len = Math.hypot(grad.x, grad.y);
    if (len < 1e-4) return null;
    x += (grad.x * CUTS.spacing) / len;
    y += (grad.y * CUTS.spacing) / len;
    if (heightAt(G, x, y) >= B.hi || landAt(G.n, G.g, G.half, G.land, x, y) < 0) return out.length >= 4 ? Float64Array.from(out) : null;
    if (!inBand(G, B, x, y)) return null;
    out.push(x, y);
  }
  return null;
}

/** The cuts, each ending on the first of its band it meets that ranks before it (by its wall's level, its step, where it starts): the same whichever cell traces the two. */
function endOnEachOther(traced: Array<{ band: number; points: Float64Array; rank: [number, number, number] }>): Cut[] {
  const order = traced.map((_, i) => i);
  order.sort((a, b) => traced[a].rank[0] - traced[b].rank[0] || traced[a].rank[1] - traced[b].rank[1] || traced[a].rank[2] - traced[b].rank[2]);
  const kept: Array<{ band: number; points: Float64Array; box: [number, number, number, number] }> = [];
  for (const i of order) {
    let p = traced[i].points;
    for (const other of kept) {
      if (other.band !== traced[i].band) continue;
      const box = boxOf(p);
      if (box[0] > other.box[2] || box[2] < other.box[0] || box[1] > other.box[3] || box[3] < other.box[1]) continue;
      const q = other.points;
      let cut = -1;
      let hx = 0;
      let hy = 0;
      for (let a = 0; a + 3 < p.length && cut < 0; a += 2) {
        for (let b = 0; b + 3 < q.length; b += 2) {
          const t = segmentHit(p[a], p[a + 1], p[a + 2], p[a + 3], q[b], q[b + 1], q[b + 2], q[b + 3]);
          if (t < 0) continue;
          cut = a;
          hx = p[a] + (p[a + 2] - p[a]) * t;
          hy = p[a + 1] + (p[a + 3] - p[a + 1]) * t;
          break;
        }
      }
      if (cut >= 0) p = Float64Array.from([...p.subarray(0, cut + 2), hx, hy]);
    }
    if (p.length >= 4 && Math.hypot(p[p.length - 2] - p[0], p[p.length - 1] - p[1]) >= 0.4) kept.push({ band: traced[i].band, points: p, box: boxOf(p) });
  }
  return kept.map(({ band, points }) => ({ band, points }));
}

function boxOf(p: Float64Array): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.length; k += 2) {
    box[0] = Math.min(box[0], p[k]);
    box[1] = Math.min(box[1], p[k + 1]);
    box[2] = Math.max(box[2], p[k]);
    box[3] = Math.max(box[3], p[k + 1]);
  }
  return box;
}

/** Where segment a–b crosses segment c–d, as a share along a–b (−1: it does not; past its start, so a cut never ends where it begins). */
function segmentHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t > 1e-6 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
