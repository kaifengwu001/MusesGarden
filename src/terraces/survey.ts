import { Vector3 } from "three";
import { clamp } from "../core/math";
import type { CubeReadback } from "./bakeReader";
import type { CellSample } from "./cells";
import {
  createCropSample,
  createPlotSample,
  TERRACE,
  type CropSample,
  type TerracePlots,
} from "./plots";

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

/** The planet's cuts: a cut wherever a wall's cut field (plots.ts cutField, a noise this many meters across) crosses a step. */
export const CUTS = { step: 0.24 } as const;

export const SURVEY = {
  /** The grid the hills are read on (m), and how far the reading is smoothed (σ, m). */
  spacing: 0.5,
  smooth: 1.1,
  /** Wild and flat (0..1) count this many meters per unit in the land's signed distance. */
  softness: 4,
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
}

/** A cut across a band: its points (x, y pairs in the chart, m) from one wall toward the other; open where it does not part two paddies (no ridge then). */
export interface Cut {
  readonly band: number;
  readonly points: Float64Array;
  open?: boolean;
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
  readonly cuts: Cut[];
  /** The cuts' segments through each grid square (square index → [cut, segment] pairs). */
  readonly crossing: Map<number, number[]>;
}

const dir = new Vector3();

/** A point of the chart as a direction. */
export function chartDir(
  t: { centre: Vector3; e1: Vector3; e2: Vector3 },
  R: number,
  x: number,
  y: number,
  out: Vector3,
): Vector3 {
  return out
    .copy(t.centre)
    .multiplyScalar(R)
    .addScaledVector(t.e1, x)
    .addScaledVector(t.e2, y)
    .normalize();
}

function gaussian(src: Float32Array, n: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++)
    sum += w[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < w.length; k++) w[k] /= sum;
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -r; k <= r; k++)
        a += w[k + r] * src[j * n + clamp(i + k, 0, n - 1)];
      tmp[j * n + i] = a;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -r; k <= r; k++)
        a += w[k + r] * tmp[clamp(j + k, 0, n - 1) * n + i];
      out[j * n + i] = a;
    }
  }
  return out;
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
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const k = j * n + i;
      if (!(inside(k) && inside(k + 1) && inside(k + n) && inside(k + n + 1)))
        continue;
      const a = v(k);
      const b = v(k + 1);
      const c = v(k + n + 1);
      const d = v(k + n);
      const code =
        (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
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
  for (const from of next.keys())
    if (!into.has(from) && !used.has(from)) walk(from);
  for (const from of next.keys()) if (!used.has(from)) walk(from);
  return lines;
}

/** A polyline resampled every `step` m along it: points and arc lengths. */
export function resample(
  points: number[],
  closed: boolean,
  step: number,
): { p: Float64Array; s: Float64Array } {
  const m = points.length / 2;
  const cum = [0];
  for (let k = 1; k < m; k++)
    cum.push(
      cum[k - 1] +
        Math.hypot(
          points[2 * k] - points[2 * k - 2],
          points[2 * k + 1] - points[2 * k - 1],
        ),
    );
  let total = cum[m - 1];
  if (closed)
    total += Math.hypot(
      points[0] - points[2 * m - 2],
      points[1] - points[2 * m - 1],
    );
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
): CellSurvey {
  const job = surveyCellJob(cell, R, cellSize, terrain, layout, plots, front);
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
): Generator<void, CellSurvey, void> {
  const centre = cell.centre.clone();
  const e1 = cell.along.clone();
  const e2 = new Vector3().crossVectors(centre, e1).normalize();
  const chart = { centre, e1, e2 };
  const g = SURVEY.spacing;
  const half = Math.ceil((0.85 * cellSize + 4) / g) * g;
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
      const mine = Math.floor(layout.nearest(dir, 0) * 1024) === cell.key;
      const edge = layout.sample(dir, 3);
      side[k] = mine ? edge : -edge;
      land[k] = Math.min(
        (0.5 - terrain.sample(dir, 2)) * SURVEY.softness,
        (0.5 - terrain.sample(dir, 3)) * SURVEY.softness,
      );
    }
    if (j % 48 === 47) yield;
  }
  const hs = gaussian(h, n, SURVEY.smooth / g);
  yield;
  const inLand = (k: number): boolean => land[k] >= 0;

  // the planet's levels (the same everywhere, so the walls run on from cell to cell): their heights, those
  // left out skipped (a band two levels wide, its walls half again as tall)
  const riser = TERRACE.step;
  const phi = plots.offset(0);
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
    cuts: [],
    crossing: new Map(),
  };
  if (!(hi > lo)) return survey;
  const levelList: number[] = [];
  const levelIndex: number[] = [];
  for (
    let k = Math.floor(lo / riser + phi) - 2;
    k <= Math.ceil(hi / riser + phi) + 2;
    k++
  ) {
    const w = plots.wall(0, k);
    if (!w.left) {
      levelList.push((w.at - phi) * riser);
      levelIndex.push(k);
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
    if (w % 4 === 3) yield;
  }

  const band = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (inLand(k)) band[k] = bandOf(hs[k]);
  const wallsBy = new Map<number, number[]>();
  walls.forEach((w, wi) => {
    const list = wallsBy.get(w.index) ?? [];
    list.push(wi);
    wallsBy.set(w.index, list);
  });

  // the cuts: along each band's lower wall (its upper one where it has none here), wherever the planet's cut
  // field for that wall crosses a step (the same wherever the wall is traced: the paddies run on from cell to
  // cell), each traced up the slope across the band, leaning round toward both ends. Each stretch between
  // two cuts is a paddy: its id from its wall's level and its step
  const cuts: Cut[] = [];
  const grad = { x: 0, y: 0 };
  const G = { n, g, half, hs };
  const stretches: Array<{ wall: number; step: Int32Array }> = [];
  const pd = new Vector3();
  for (const [wi, w] of walls.entries()) {
    const B = bands[w.index];
    const m = w.s.length;
    const step = new Int32Array(m);
    for (let c = 0; c < m; c++)
      step[c] = Math.floor(
        plots.cutField(
          chartDir(chart, R, w.points[2 * c], w.points[2 * c + 1], pd),
          w.level,
        ) / CUTS.step,
      );
    stretches.push({ wall: wi, step });
    if (!B) continue;
    for (let c = 0; c + 1 < m; c++) {
      if (step[c] === step[c + 1]) continue;
      let x = 0.5 * (w.points[2 * c] + w.points[2 * c + 2]);
      let y = 0.5 * (w.points[2 * c + 1] + w.points[2 * c + 3]);
      const pts: number[] = [x, y];
      for (let d = 0; d < 40; d += 0.25) {
        gradAt(G, x, y, grad);
        const len = Math.hypot(grad.x, grad.y);
        if (len < 1e-4) break;
        const nx = x + (grad.x * 0.25) / len;
        const ny = y + (grad.y * 0.25) / len;
        if (landAt(n, g, half, land, nx, ny) < 0) break;
        pts.push(nx, ny);
        x = nx;
        y = ny;
        if (heightAt(G, nx, ny) >= B.hi) break;
      }
      if (pts.length < 4) continue;
      // its lean: along the band (across the slope), most at its ends
      const hb = plots.hash(0, w.level, Math.max(step[c], step[c + 1]), 0, 42);
      const bandW = Math.max(
        (B.hi - B.lo) / Math.max(Math.hypot(grad.x, grad.y), 0.02),
        1,
      );
      const bow =
        (0.15 + 0.45 * unit(hb)) *
        ((hb & 256) === 0 ? 1 : -1) *
        Math.min(bandW, 8);
      const k2 = pts.length / 2;
      const bent = new Float64Array(pts.length);
      for (let k = 0; k < k2; k++) {
        const px = pts[2 * k];
        const py = pts[2 * k + 1];
        gradAt(G, px, py, grad);
        const len = Math.max(Math.hypot(grad.x, grad.y), 1e-6);
        const tx = -grad.y / len;
        const ty = grad.x / len;
        const shift = bow * leanOf(acrossOf(B, heightAt(G, px, py)));
        bent[2 * k] = px + tx * shift;
        bent[2 * k + 1] = py + ty * shift;
      }
      // (only where it lies in its band: leaning round, its ends must not climb a wall)
      const kept: number[] = [];
      for (let k = 0; k < k2; k++) {
        const H = heightAt(G, bent[2 * k], bent[2 * k + 1]);
        if (H < B.lo - 0.02 || H > B.hi + 0.02) {
          if (kept.length >= 4) break;
          kept.length = 0;
          continue;
        }
        kept.push(bent[2 * k], bent[2 * k + 1]);
      }
      if (kept.length >= 4) cuts.push({ band: B.index, points: Float64Array.from(kept) });
    }
  }

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
          if (!any && !(ax >= i && ax <= i + 1 && ay >= j && ay <= j + 1))
            continue;
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
  const paddyOf = (key: string, id: number, b: number, season: number): number => {
    const known = byKey.get(key);
    if (known !== undefined) return known;
    plot.id = id;
    plot.season = season;
    const index = paddies.length;
    paddies.push({ id, band: b, crop: plots.cropOf(plot, front, createCropSample()) });
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
  const part = new Int32Array(N).fill(-1);
  const queue: number[] = [];
  const members: number[] = [];
  for (let k0 = 0; k0 < N; k0++) {
    if (band[k0] < 0 || part[k0] >= 0) continue;
    const b = band[k0];
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
      if (i + 1 < n && !closedEdge[2 * k] && band[k + 1] === b && part[k + 1] < 0) {
        part[k + 1] = k0;
        queue.push(k + 1);
      }
      if (i > 0 && !closedEdge[2 * (k - 1)] && band[k - 1] === b && part[k - 1] < 0) {
        part[k - 1] = k0;
        queue.push(k - 1);
      }
      if (j + 1 < n && !closedEdge[2 * k + 1] && band[k + n] === b && part[k + n] < 0) {
        part[k + n] = k0;
        queue.push(k + n);
      }
      if (j > 0 && !closedEdge[2 * (k - n) + 1] && band[k - n] === b && part[k - n] < 0) {
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
      idx = paddyOf(best, plots.hash(0, level, step, 0, 47), b, plots.seasonOf(level, step));
    } else {
      const i0 = k0 % n;
      const j0 = (k0 - i0) / n;
      const q = chartDir(chart, R, -half + i0 * g, -half + j0 * g, pd);
      const id = plots.hash(0, levelIndex[b], Math.round((q.x * R) / 6), Math.round((q.y * R) / 6) * 7919 + Math.round((q.z * R) / 6), 48);
      idx = paddyOf(`loose/${id}`, id, b, plots.seasonAt(q));
    }
    for (const k of members) paddy[k] = idx;
  }
  // a cut that does not part two paddies (it stopped short of the far wall) is open: no ridge along it
  for (const cut of cuts) {
    const p = cut.points;
    const m = p.length / 2;
    const c = Math.floor(m / 2);
    const tx = p[2 * Math.min(c + 1, m - 1)] - p[2 * Math.max(c - 1, 0)];
    const ty = p[2 * Math.min(c + 1, m - 1) + 1] - p[2 * Math.max(c - 1, 0) + 1];
    const tl = Math.hypot(tx, ty) || 1;
    const at = (o: number): number => {
      const i = Math.round((p[2 * c] - (ty / tl) * o + half) / g);
      const j = Math.round((p[2 * c + 1] + (tx / tl) * o + half) / g);
      return i < 0 || j < 0 || i >= n || j >= n ? -1 : paddy[j * n + i];
    };
    const a = at(0.6);
    const b = at(-0.6);
    cut.open = a >= 0 && a === b;
  }
  return {
    ...survey,
    levels,
    walls,
    bands,
    band,
    paddy,
    paddies,
    cuts,
    crossing,
  };
}

const unit = (h: number): number => (h >>> 8) / 16777216;

/** The smoothed height at a chart point (bilinear). */
function heightAt(
  G: { n: number; g: number; half: number; hs: Float32Array },
  x: number,
  y: number,
): number {
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
function gradAt(
  G: { n: number; g: number; half: number; hs: Float32Array },
  x: number,
  y: number,
  out: { x: number; y: number },
): void {
  const e = 0.5 * G.g;
  out.x = (heightAt(G, x + e, y) - heightAt(G, x - e, y)) / (2 * e);
  out.y = (heightAt(G, x, y + e) - heightAt(G, x, y - e)) / (2 * e);
}

/** The land's signed distance at a chart point (bilinear). */
function landAt(
  n: number,
  g: number,
  half: number,
  land: Float32Array,
  x: number,
  y: number,
): number {
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
function crosses(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
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

/** How far a cut leans along the band at a share across it: none in the middle, its full turn at the walls (a gentle C). */
export function leanOf(f: number): number {
  const c = 2 * f - 1;
  return c * c;
}
