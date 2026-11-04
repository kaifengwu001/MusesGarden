import { Vector3 } from 'three';
import { angleBetween, tangentToward, travel } from '../planet/geo';

// The director's routes (director.ts): the way a Muse walks from one mark to the next by itself, round water and
// walls. Straight on where the way is clear; otherwise found on a grid laid over the planet about the two marks
// (A*, eight ways round each cell, dearer close to the water), pulled tight from corner to corner, and its corners
// rounded off as Muse's own walks round theirs (museRoam.ts rounded). Pure: the world is read only through `RouteGround`.

/** What a route reads of the world. */
export interface RouteGround {
  /** The ground's signed distance to the shore at a place (m, negative on water). */
  water(dir: Vector3): number;
  /** Whether a Muse may stand there beyond dry ground (clear of a house's walls), where the world knows. */
  standable(dir: Vector3): boolean;
  /** The height it would stand at there (m over R: a deck's, a step's, the ground's), to keep off drops too high to step down. */
  height?(dir: Vector3): number;
}

export const ROUTE = {
  /** Ground nearer the water than this (m) is not walked on. */
  dry: 0.45,
  /** Ground nearer the water than this (m) is walked on only when it must be (dearer). */
  wary: 1.4,
  /** How finely the way is checked for water and walls (m). */
  probe: 0.2,
  /** The grid's cells (m): finer for short ways, coarser for long ones, never more than `cells` across. */
  cellMin: 0.25,
  cellMax: 0.8,
  cells: 150,
  /** How far round the two marks the grid reaches (m, and as a share of the way's length). */
  margin: 6,
  marginShare: 0.6,
  /** Kept this far from what can't be walked on either side of the way (m): about Muse's girth. */
  clear: 0.3,
  /** The highest step up or down a Muse takes (m), and the steepest slope it walks (rise over run). */
  stepUp: 0.3,
  slope: 0.65,
  /** Corners rounded off over as much as this (m), or two fifths of the legs either side. */
  sweep: 1.4,
  /** The points along a route, this far apart (m). */
  step: 0.2,
} as const;

/** A way over the planet: points along it (unit directions) and each one's distance from its start (m). */
export class Path {
  readonly points: Vector3[] = [];
  readonly at: number[] = [];

  constructor(readonly R: number) {}

  get length(): number {
    return this.at.length ? this.at[this.at.length - 1] : 0;
  }

  add(p: Vector3): void {
    const n = this.points.length;
    if (n && angleBetween(this.points[n - 1], p) * this.R < 1e-4) return;
    this.at.push(n ? this.at[n - 1] + angleBetween(this.points[n - 1], p) * this.R : 0);
    this.points.push(p.clone());
  }

  /** Straight on to a point (a great circle), every `step` m. */
  line(to: Vector3, step: number): void {
    const from = this.points[this.points.length - 1];
    const steps = Math.max(1, Math.ceil((angleBetween(from, to) * this.R) / step));
    const a = from.clone();
    for (let k = 1; k <= steps; k++) this.add(a.clone().lerp(to, k / steps).normalize());
  }

  /** The point at a distance along it (m). */
  point(d: number, out: Vector3): Vector3 {
    const at = this.at;
    const n = at.length;
    if (d <= 0 || n < 2) return out.copy(this.points[0]);
    if (d >= at[n - 1]) return out.copy(this.points[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - at[lo]) / Math.max(at[hi] - at[lo], 1e-9);
    return out.copy(this.points[lo]).lerp(this.points[hi], f).normalize();
  }

  /** Its way at a distance along it (a unit tangent), smoothed over a stretch either side, as museRoam.ts's Path. */
  heading(d: number, out: Vector3): Vector3 {
    const L = this.length;
    const span = Math.min(0.3, L / 2);
    const a = this.point(Math.max(0, Math.min(L - 2 * span, d - span)), pathA);
    const b = this.point(Math.min(L, Math.max(2 * span, d + span)), pathB);
    const p = this.point(d, pathC);
    out.subVectors(b, a);
    out.addScaledVector(p, -out.dot(p));
    return out.lengthSq() > 1e-18 ? out.normalize() : tangentToward(p, this.points[this.points.length - 1], out);
  }
}
const pathA = new Vector3();
const pathB = new Vector3();
const pathC = new Vector3();

/** A route: its path, and whether no way round was found (it goes straight on through what is in the way). */
export interface Route {
  readonly path: Path;
  readonly blocked: boolean;
}

const probe = new Vector3();
const probeSide = new Vector3();
const across = new Vector3();

/** Whether a Muse may walk at a place: on dry ground, clear of walls. */
export function walkable(ground: RouteGround, dir: Vector3, dry: number = ROUTE.dry): boolean {
  return ground.water(dir) > dry && ground.standable(dir);
}

/**
 * Whether the great circle from a to b is walkable all along, and `clear` m to either side of it (a Muse's girth);
 * within `ends` m of a mark (the route's own first and last points, `aEnd`, `bEnd`) only along the way itself: a mark
 * may stand close to a wall.
 */
export function clearWay(ground: RouteGround, a: Vector3, b: Vector3, R: number, aEnd = true, bEnd = true, clear: number = ROUTE.clear): boolean {
  const length = angleBetween(a, b) * R;
  if (length < 1e-6) return walkable(ground, a);
  const steps = Math.max(1, Math.ceil(length / ROUTE.probe));
  across.crossVectors(a, b).normalize();
  const ends = 0.6;
  const rise = Math.max(ROUTE.stepUp, ROUTE.slope * (length / steps));
  let was = Number.NaN;
  for (let k = 0; k <= steps; k++) {
    const d = (k / steps) * length;
    probe.copy(a).lerp(b, k / steps).normalize();
    if (ground.height) {
      const h = ground.height(probe);
      if (Math.abs(h - was) > rise) return false;
      was = h;
    }
    const nearMark = (aEnd && d < ends) || (bEnd && length - d < ends);
    if (nearMark) {
      if ((aEnd && d < 0.15) || (bEnd && length - d < 0.15)) continue;
      if (!walkable(ground, probe)) return false;
      continue;
    }
    if (!walkable(ground, probe)) return false;
    if (clear > 0) {
      for (const side of [-1, 1]) {
        probeSide.copy(probe).addScaledVector(across, (side * clear) / R).normalize();
        if (!walkable(ground, probeSide, ROUTE.dry * 0.5)) return false;
      }
    }
  }
  return true;
}

/**
 * The way from `from` to `to` (unit directions) on a planet of radius R. A mark in the water or in a wall is walked to
 * as near as it can be, then straight on to it: blocked, so it shows.
 */
export function planRoute(from: Vector3, to: Vector3, R: number, ground: RouteGround): Route {
  const length = angleBetween(from, to) * R;
  const there = walkable(ground, to, ROUTE.dry * 0.5);
  if (length < 0.05 || clearWay(ground, from, to, R)) return { path: rounded([from, to], R, ground), blocked: !there && length >= 0.05 };
  const way = searchGrid(from, to, R, ground);
  if (!way) return { path: rounded([from, to], R, ground), blocked: true };
  return { path: rounded(pullTight(way, R, ground), R, ground), blocked: !there };
}

/**
 * A* over a grid about the two marks: a gnomonic plane touching the planet midway between them (x along the way, y
 * across it), each cell walkable or not, dearer the nearer the water. Its cells' middles as unit directions, from
 * `from` to `to`; null when there is no way within the grid.
 */
function searchGrid(from: Vector3, to: Vector3, R: number, ground: RouteGround): Vector3[] | null {
  const length = angleBetween(from, to) * R;
  const mid = from.clone().add(to).normalize();
  const ex = tangentToward(mid, to.clone().sub(from), new Vector3());
  const ey = new Vector3().crossVectors(mid, ex).normalize();
  const reach = length / 2 + Math.max(ROUTE.margin, ROUTE.marginShare * length);
  // (fine enough for a house's walls on short ways; on long ones never more than 260 cells across)
  const cell = Math.max(ROUTE.cellMin, Math.min(ROUTE.cellMax, (2 * reach) / ROUTE.cells), (2 * reach) / 260);
  const n = Math.ceil((2 * reach) / cell) | 1;
  const half = (n - 1) / 2;
  const at = (i: number, j: number, out: Vector3): Vector3 =>
    out
      .copy(mid)
      .addScaledVector(ex, ((i - half) * cell) / R)
      .addScaledVector(ey, ((j - half) * cell) / R)
      .normalize();
  const index = (dir: Vector3): [number, number] => {
    // (the gnomonic projection's inverse: onto the plane touching at `mid`)
    const s = dir.dot(mid);
    const x = (dir.dot(ex) / s) * R;
    const y = (dir.dot(ey) / s) * R;
    return [Math.round(x / cell + half), Math.round(y / cell + half)];
  };
  // each cell's cost to enter: Infinity where it can't be walked
  const cost = new Float32Array(n * n);
  const heights = ground.height ? new Float32Array(n * n) : null;
  const p = new Vector3();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      at(i, j, p);
      if (heights && ground.height) heights[j * n + i] = ground.height(p);
      const water = ground.water(p);
      cost[j * n + i] = water <= ROUTE.dry || !ground.standable(p) ? Infinity : 1 + (water < ROUTE.wary ? (3 * (ROUTE.wary - water)) / ROUTE.wary : 0);
    }
  }
  // (what can't be walked on grown by Muse's girth, so the way keeps clear of walls)
  const grow = Math.ceil(ROUTE.clear / cell - 0.25);
  if (grow > 0) {
    const shut = cost.map((c) => (c === Infinity ? 1 : 0));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!shut[j * n + i]) continue;
        for (let dj = -grow; dj <= grow; dj++) {
          for (let di = -grow; di <= grow; di++) {
            const x = i + di;
            const y = j + dj;
            if (x >= 0 && y >= 0 && x < n && y < n && di * di + dj * dj <= grow * grow) cost[y * n + x] = Infinity;
          }
        }
      }
    }
  }
  const nearestOpen = ([i0, j0]: [number, number]): number => {
    for (let r = 0; r < n; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let j = Math.max(0, j0 - r); j <= Math.min(n - 1, j0 + r); j++) {
        for (let i = Math.max(0, i0 - r); i <= Math.min(n - 1, i0 + r); i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || cost[j * n + i] === Infinity) continue;
          const d = (i - i0) ** 2 + (j - j0) ** 2;
          if (d < bestD) {
            bestD = d;
            best = j * n + i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const clamp = ([i, j]: [number, number]): [number, number] => [Math.min(n - 1, Math.max(0, i)), Math.min(n - 1, Math.max(0, j))];
  const start = nearestOpen(clamp(index(from)));
  const goal = nearestOpen(clamp(index(to)));
  if (start < 0 || goal < 0) return null;
  const gx = goal % n;
  const gy = Math.floor(goal / n);
  const g = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  const h = (k: number): number => {
    const dx = Math.abs((k % n) - gx);
    const dy = Math.abs(Math.floor(k / n) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, h(start));
  const steps: readonly [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  let found = false;
  while (heap.size > 0) {
    const k = heap.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) {
      found = true;
      break;
    }
    const x = k % n;
    const y = Math.floor(k / n);
    for (const [dx, dy, len] of steps) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const m = ny * n + nx;
      if (closed[m] || cost[m] === Infinity) continue;
      // (no cutting a corner past a cell that can't be walked, and no step up or down higher than a Muse takes)
      if (dx !== 0 && dy !== 0 && (cost[y * n + nx] === Infinity || cost[ny * n + x] === Infinity)) continue;
      if (heights && Math.abs(heights[m] - heights[k]) > Math.max(ROUTE.stepUp, ROUTE.slope * len * cell)) continue;
      const next = g[k] + len * 0.5 * (cost[k] + cost[m]);
      if (next < g[m]) {
        g[m] = next;
        came[m] = k;
        heap.push(m, next + h(m));
      }
    }
  }
  if (!found) return null;
  const cells: Vector3[] = [];
  for (let k = goal; k >= 0; k = came[k]) cells.unshift(at(k % n, Math.floor(k / n), new Vector3()));
  // (the marks themselves at its ends, not their cells' middles)
  cells[0] = from.clone();
  cells[cells.length - 1] = to.clone();
  return cells;
}

/** Corner to corner: from each corner, on as far as the straight way stays clear (string pulling). */
function pullTight(way: Vector3[], R: number, ground: RouteGround): Vector3[] {
  const out = [way[0]];
  let i = 0;
  while (i < way.length - 1) {
    let j = i + 1;
    while (j + 1 < way.length && clearWay(ground, way[i], way[j + 1], R, i === 0, j + 1 === way.length - 1)) j++;
    out.push(way[j]);
    i = j;
  }
  return out;
}

/**
 * A path through points, each corner rounded off by a curve inside it (as museRoam.ts rounded): wide where the curve
 * stays on dry ground clear of walls, tighter where it wouldn't, sharp (eased by the walk's own heading) where even a
 * tight one wouldn't.
 */
function rounded(points: Vector3[], R: number, ground: RouteGround): Path {
  const build = (sweep: number): Path => {
    const path = new Path(R);
    path.add(points[0]);
    const t = new Vector3();
    for (let i = 1; i < points.length - 1; i++) {
      const c = points[i];
      const before = angleBetween(points[i - 1], c) * R;
      const after = angleBetween(c, points[i + 1]) * R;
      const d = Math.min(sweep, 0.4 * before, 0.4 * after);
      if (d < 0.02) {
        path.line(c, ROUTE.step);
        continue;
      }
      const into = travel(c, tangentToward(c, points[i - 1], t), d / R, new Vector3());
      const out = travel(c, tangentToward(c, points[i + 1], t), d / R, new Vector3());
      path.line(into, ROUTE.step);
      const curve = Math.max(8, Math.ceil((2 * d) / ROUTE.step));
      for (let k = 1; k <= curve; k++) {
        const u = k / curve;
        path.add(new Vector3().addScaledVector(into, (1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(out, u * u).normalize());
      }
    }
    path.line(points[points.length - 1], ROUTE.step);
    return path;
  };
  if (points.length < 3) return build(0);
  const ok = (path: Path): boolean => path.points.every((p, k) => path.at[k] < 0.6 || path.length - path.at[k] < 0.6 || walkable(ground, p, ROUTE.dry * 0.8));
  for (const sweep of [ROUTE.sweep, 0.5]) {
    const path = build(sweep);
    if (ok(path)) return path;
  }
  return build(0);
}

/** A binary heap of cell indices by priority. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly prios: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, prio: number): void {
    const keys = this.keys;
    const prios = this.prios;
    let i = keys.length;
    keys.push(key);
    prios.push(prio);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prios[parent] <= prio) break;
      keys[i] = keys[parent];
      prios[i] = prios[parent];
      i = parent;
    }
    keys[i] = key;
    prios[i] = prio;
  }

  pop(): number {
    const keys = this.keys;
    const prios = this.prios;
    const top = keys[0];
    const lastKey = keys.pop() as number;
    const lastPrio = prios.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = lastPrio;
        if (l < n && prios[l] < mp) {
          m = l;
          mp = prios[l];
        }
        if (r < n && prios[r] < mp) m = r;
        if (m === i) break;
        keys[i] = keys[m];
        prios[i] = prios[m];
        i = m;
      }
      keys[i] = lastKey;
      prios[i] = lastPrio;
    }
    return top;
  }
}
