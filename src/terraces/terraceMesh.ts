import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { floorPiecesJob } from './floors';
import { TERRACE } from './plots';
import { acrossOf, chartDir, contour, resample, type CellSurvey } from './survey';

// A surveyed cell's terraces as one mesh (survey.ts lays them out): its
// paddies' floors, level, each at its own water's height where flooded; the
// walls along the contours, a riser up from the floor below (battered back a
// little, as dry earth walls are) to a bund along the edge of the floor above;
// low ridges along the cuts; and skirts down into the ground where the
// terraced land ends (the hills' own mesh is sunk under the terraces, so the
// skirts close the gap). Planet space; the shader warps it.
//
// Per vertex: position, normal; aPart (0 floor, 1 riser, 2 bund top, 3 bund
// side, 4 skirt, 5 cut ridge); aPaddy: the paddy's constants (its colour,
// its place in the season, its plants' and its water's own share: its crop
// at any season is worked out from them in the shaders, paddy.glsl
// cropFrom, so the season moves without a rebuild; a floor is lifted to its
// water there); aFloor: its floor (m), fallow, share across its band, -.

export const PART = {
  floor: 0,
  riser: 1,
  bundTop: 2,
  bundSide: 3,
  skirt: 4,
  ridge: 5,
} as const;
/** How far the hills' own mesh is sunk under the terraces (m): the skirts reach this far down. */
export const SINK = 2.6;
/** Floors are merged into rectangles at most this many grid squares wide (the planet curves under a long one). */
const MERGE = 8;

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly part: number[] = [];
  readonly paddy: number[] = [];
  readonly floor: number[] = [];
  readonly index: number[] = [];
  private readonly d = new Vector3();
  constructor(
    private readonly s: CellSurvey,
    private readonly R: number,
  ) {}

  /** A vertex at chart (x, y), height h (m); normal: up, or a tangent lean (nx, ny in the chart) blended with up by `steep`. */
  vertex(x: number, y: number, h: number, part: number, data: readonly number[], fl: readonly number[], lean?: [number, number, number]): number {
    const d = chartDir(this.s, this.R, x, y, this.d);
    const r = this.R + h;
    this.pos.push(d.x * r, d.y * r, d.z * r);
    if (lean) {
      const s = this.s;
      const nx = d.x * lean[2] + s.e1.x * lean[0] + s.e2.x * lean[1];
      const ny = d.y * lean[2] + s.e1.y * lean[0] + s.e2.y * lean[1];
      const nz = d.z * lean[2] + s.e1.z * lean[0] + s.e2.z * lean[1];
      const l = Math.hypot(nx, ny, nz) || 1;
      this.nrm.push(nx / l, ny / l, nz / l);
    } else this.nrm.push(d.x, d.y, d.z);
    this.part.push(part);
    this.paddy.push(data[0], data[1], data[2], data[3]);
    this.floor.push(fl[0], fl[1], fl[2], fl[3]);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.index.push(a, b, c, a, c, d);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 1));
    g.setAttribute('aPaddy', new BufferAttribute(new Float32Array(this.paddy), 4));
    g.setAttribute('aFloor', new BufferAttribute(new Float32Array(this.floor), 4));
    const vertices = this.pos.length / 3;
    g.setIndex(vertices > 65535 ? new BufferAttribute(new Uint32Array(this.index), 1) : new BufferAttribute(new Uint16Array(this.index), 1));
    return g;
  }
}

const NONE = [0, 0, 0, 0] as const;

/** The parts of a polyline (x, y pairs) inside the cell (its side field ≥ 0), cut exactly where it crosses out. */
function inCell(s: CellSurvey, points: Float64Array, closed: boolean): Float64Array[] {
  const { n, g, half, side } = s;
  const at = (x: number, y: number): number => {
    const fx = Math.min(Math.max((x + half) / g, 0), n - 1.0001);
    const fy = Math.min(Math.max((y + half) / g, 0), n - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = side[j * n + i] * (1 - tx) + side[j * n + i + 1] * tx;
    const b = side[(j + 1) * n + i] * (1 - tx) + side[(j + 1) * n + i + 1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const m = points.length / 2;
  const count = closed ? m + 1 : m;
  const parts: Float64Array[] = [];
  let run: number[] = [];
  let prev = -1;
  for (let c = 0; c < count; c++) {
    const k = c % m;
    const x = points[2 * k];
    const y = points[2 * k + 1];
    const v = at(x, y);
    if (c > 0 && v >= 0 !== prev >= 0) {
      const kp = (c - 1) % m;
      const t = prev / (prev - v);
      run.push(points[2 * kp] + (x - points[2 * kp]) * t, points[2 * kp + 1] + (y - points[2 * kp + 1]) * t);
      if (v < 0) {
        if (run.length >= 4) parts.push(Float64Array.from(run));
        run = [];
      }
    }
    if (v >= 0) run.push(x, y);
    prev = v;
  }
  if (run.length >= 4) parts.push(Float64Array.from(run));
  // (a loop wholly inside the cell stays one)
  if (closed && parts.length === 1 && parts[0].length === 2 * count) return [points];
  return parts;
}

/** The terraces of a surveyed cell as one geometry at once (dev): buildCellMeshJob run through. */
export function buildCellMesh(s: CellSurvey): BufferGeometry | null {
  const job = buildCellMeshJob(s);
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

/** The terraces of a surveyed cell as one geometry (null where it has none), a few milliseconds a step. */
export function* buildCellMeshJob(s: CellSurvey): Generator<void, BufferGeometry | null, void> {
  if (s.paddies.length === 0) return null;
  const R = s.R;
  const b = new Builder(s, R);
  const { n, g, half } = s;
  const bh = TERRACE.bundHeight;
  const bw = TERRACE.bund;
  // a paddy's constants; its floor (the shader lifts it to its water)
  const paddyData = s.paddies.map((p) => [p.crop.variant, p.crop.delay, p.crop.hv, p.crop.wv] as const);
  const surface = (pd: number): number => s.paddies[pd].floorH ?? s.bands[s.paddies[pd].band].floorH;
  const floorOf = surface;

  // 1. floors: whole squares merged into rectangles (by paddy, along rows then down), the clipped pieces as fans
  const plain = new Int32Array(n * n).fill(-1);
  yield* floorPiecesJob(
    s,
    (pc) => {
      const pd = pc.paddy;
      const h = surface(pd);
      const fl = [floorOf(pd), s.paddies[pd].crop.fallow ? 1 : 0, 0, 0];
      const first = b.pos.length / 3;
      for (let v = 0; v < pc.xy.length / 2; v++) {
        fl[2] = pc.across[v];
        b.vertex(pc.xy[2 * v], pc.xy[2 * v + 1], h, PART.floor, paddyData[pd], fl);
      }
      for (let v = 1; v + 1 < pc.xy.length / 2; v++) b.index.push(first, first + v, first + v + 1);
    },
    (i, j, pd) => {
      plain[j * n + i] = pd;
    },
  );
  const usedSq = new Uint8Array(n * n);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const pd = plain[j * n + i];
      if (pd < 0 || usedSq[j * n + i]) continue;
      // grow a rectangle: along the row, then down while every square of the next row matches
      let i1 = i;
      while (i1 + 1 < n - 1 && i1 + 1 - i < MERGE && plain[j * n + i1 + 1] === pd && !usedSq[j * n + i1 + 1]) i1++;
      let j1 = j;
      for (;;) {
        if (j1 + 1 >= n - 1 || j1 + 1 - j >= MERGE) break;
        let ok = true;
        for (let ii = i; ii <= i1 && ok; ii++) ok = plain[(j1 + 1) * n + ii] === pd && !usedSq[(j1 + 1) * n + ii];
        if (!ok) break;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) usedSq[jj * n + ii] = 1;
      const h = surface(pd);
      const B = s.bands[s.paddies[pd].band];
      // (a hair larger than its squares: its long edges are chords, its neighbours' vertices lie on the planet's curve)
      const x0 = -half + i * g - 0.03;
      const y0 = -half + j * g - 0.03;
      const x1 = -half + (i1 + 1) * g + 0.03;
      const y1 = -half + (j1 + 1) * g + 0.03;
      const fl = (x: number, y: number): number[] => [B.floorH, s.paddies[pd].crop.fallow ? 1 : 0, acrossOf(B, s.hs[Math.round((y + half) / g) * n + Math.round((x + half) / g)]), 0];
      const a = b.vertex(x0, y0, h, PART.floor, paddyData[pd], fl(x0, y0));
      const c1 = b.vertex(x1, y0, h, PART.floor, paddyData[pd], fl(x1, y0));
      const c2 = b.vertex(x1, y1, h, PART.floor, paddyData[pd], fl(x1, y1));
      const c3 = b.vertex(x0, y1, h, PART.floor, paddyData[pd], fl(x0, y1));
      b.quad(a, c1, c2, c3);
    }
  }

  // the hills' own height at a chart point (the skirts reach down past it)
  const natural = (x: number, y: number): number => {
    const i = Math.min(Math.max(Math.round((x + half) / g), 0), n - 1);
    const j = Math.min(Math.max(Math.round((y + half) / g), 0), n - 1);
    return s.h[j * n + i];
  };

  yield;
  // the floor (m) of the paddy at a chart point, or the nearest one within a meter; NaN off the land
  const floorAt = (x: number, y: number): number => {
    const i0 = Math.round((x + half) / g);
    const j0 = Math.round((y + half) / g);
    for (let r = 0; r <= 2; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const pdx = s.paddy[j * n + i];
          if (pdx >= 0) return surface(pdx);
        }
      }
    }
    return Number.NaN;
  };

  // 2. walls: a riser from the floor below up to the bund along the edge of the floor above
  for (const w0 of s.walls) {
    const lower = s.bands[w0.index - 1];
    const upper = s.bands[w0.index];
    if (!lower || !upper) continue;
    for (const p of inCell(s, w0.points, w0.closed)) {
      const w = { closed: w0.closed && p === w0.points };
      const m = p.length / 2;
      const ring: number[][] = [];
      for (let k = 0; k < m; k++) {
        // uphill: the polyline's left
        const a = Math.max(k - 1, 0);
        const c = Math.min(k + 1, m - 1);
        let tx = p[2 * c] - p[2 * a];
        let ty = p[2 * c + 1] - p[2 * a + 1];
        if (w.closed && (k === 0 || k === m - 1)) {
          const kp = (k - 1 + m) % m;
          const kn = (k + 1) % m;
          tx = p[2 * kn] - p[2 * kp];
          ty = p[2 * kn + 1] - p[2 * kp + 1];
        }
        const tl = Math.hypot(tx, ty) || 1;
        const ux = -ty / tl;
        const uy = tx / tl;
        const x = p[2 * k];
        const y = p[2 * k + 1];
        const top = upper.floorH + bh;
        // down past the floor below into the sunk ground (hidden under the floor where there is one), at a
        // steady batter: it stands as steep over the floor below wherever that floor ends
        const shown = top - lower.floorH;
        const below = Math.min(lower.floorH, natural(x, y)) - SINK - 0.3;
        const batter = TERRACE.batter * (top - below);
        const fl = [upper.floorH, 0, 0, 0];
        // the riser's face leans back uphill as steep as it stands; the bund rounds over to the floor above
        const face: [number, number, number] = [-ux * shown, -uy * shown, TERRACE.batter * shown];
        const v0 = b.vertex(x - ux * batter, y - uy * batter, below, PART.riser, NONE, fl, face);
        const v1 = b.vertex(x, y, top, PART.riser, NONE, fl, face);
        const v2 = b.vertex(x, y, top, PART.bundTop, NONE, fl);
        const v3 = b.vertex(x + ux * TERRACE.crest * bw, y + uy * TERRACE.crest * bw, top, PART.bundTop, NONE, fl);
        const side: [number, number, number] = [ux * bh, uy * bh, (1 - TERRACE.crest) * bw];
        const v4 = b.vertex(x + ux * TERRACE.crest * bw, y + uy * TERRACE.crest * bw, top, PART.bundSide, NONE, fl, side);
        const v5 = b.vertex(x + ux * bw, y + uy * bw, upper.floorH - 0.12, PART.bundSide, NONE, fl, side);
        ring.push([v0, v1, v2, v3, v4, v5]);
      }
      const count = w.closed ? m : m - 1;
      for (let k = 0; k < count; k++) {
        const r0 = ring[k];
        const r1 = ring[(k + 1) % m];
        // (uphill on the left: the faces' winding)
        b.quad(r0[0], r1[0], r1[1], r0[1]);
        b.quad(r0[2], r1[2], r1[3], r0[3]);
        b.quad(r0[4], r1[4], r1[5], r0[5]);
      }
    }
  }

  yield;
  // 3. the cuts' ridges: a low bund along each, over the higher of the floors either side
  for (const cut of s.cuts) {
    if (cut.open) continue;
    for (const p of inCell(s, cut.points, false)) {
      const m = p.length / 2;
      if (m < 2) continue;
      const ring: number[][] = [];
      for (let k = 0; k < m; k++) {
        const a = Math.max(k - 1, 0);
        const c = Math.min(k + 1, m - 1);
        const tx = p[2 * c] - p[2 * a];
        const ty = p[2 * c + 1] - p[2 * a + 1];
        const tl = Math.hypot(tx, ty) || 1;
        const sx = -ty / tl;
        const sy = tx / tl;
        const x = p[2 * k];
        const y = p[2 * k + 1];
        const half = 0.5 * bw;
        let left = floorAt(x - sx * 0.6, y - sy * 0.6);
        let right = floorAt(x + sx * 0.6, y + sy * 0.6);
        if (Number.isNaN(left)) left = right;
        if (Number.isNaN(right)) right = left;
        if (Number.isNaN(left)) left = right = natural(x, y);
        const crest = Math.max(left, right) + 0.8 * bh;
        const fl = [Math.max(left, right), 0, 0, 0];
        ring.push([
          b.vertex(x - sx * half, y - sy * half, left - 0.08, PART.ridge, NONE, fl, [-sx * 0.8 * bh, -sy * 0.8 * bh, 0.3 * half]),
          b.vertex(x - sx * 0.3 * half, y - sy * 0.3 * half, crest, PART.ridge, NONE, fl),
          b.vertex(x + sx * 0.3 * half, y + sy * 0.3 * half, crest, PART.ridge, NONE, fl),
          b.vertex(x + sx * half, y + sy * half, right - 0.08, PART.ridge, NONE, fl, [sx * 0.8 * bh, sy * 0.8 * bh, 0.3 * half]),
        ]);
      }
      for (let k = 0; k + 1 < m; k++) {
        const r0 = ring[k];
        const r1 = ring[k + 1];
        b.quad(r0[0], r1[0], r1[1], r0[1]);
        b.quad(r0[1], r1[1], r1[2], r0[2]);
        b.quad(r0[2], r1[2], r1[3], r0[3]);
      }
    }
  }

  yield;
  // 4. skirts: where the land ends, from its floor down into the sunk ground
  for (const line of contour(s.land, n, g, half, 0, () => true)) {
    const all = resample(line.points, line.closed, 0.5);
    for (const part of inCell(s, all.p, line.closed)) {
      const rs = { p: part, s: new Float64Array(part.length / 2) };
      const closedHere = line.closed && part === all.p;
      const m = rs.s.length;
      const ring: number[][] = [];
      for (let k = 0; k < m; k++) {
        const x = rs.p[2 * k];
        const y = rs.p[2 * k + 1];
        const i = Math.min(Math.max(Math.round((x + half) / g), 0), n - 1);
        const j = Math.min(Math.max(Math.round((y + half) / g), 0), n - 1);
        // (where the land's edge runs along a wall, the lower floor's: the skirt never saws between the two)
        let H = Infinity;
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ii = Math.min(Math.max(i + di, 0), n - 1);
          const jj = Math.min(Math.max(j + dj, 0), n - 1);
          H = Math.min(H, s.hs[jj * n + ii]);
        }
        let bi = 0;
        while (bi + 1 < s.bands.length && s.bands[bi + 1].lo <= H) bi++;
        // (a flats' plot has its own floor)
        const own = floorAt(x, y);
        const floorH = s.walls.length === 0 && !Number.isNaN(own) ? own : s.bands[bi].floorH;
        const top = floorH + 0.02;
        const fl = [floorH, 0, 0, 0];
        ring.push([b.vertex(x, y, top, PART.skirt, NONE, fl), b.vertex(x, y, Math.min(top, natural(x, y)) - SINK - 0.3, PART.skirt, NONE, fl)]);
      }
      const count = closedHere ? m : m - 1;
      for (let k = 0; k < count; k++) {
        const r0 = ring[k];
        const r1 = ring[(k + 1) % m];
        b.quad(r0[0], r1[0], r1[1], r0[1]);
      }
    }
  }
  // 5. on the flats, the cell's edge is a road between its block of plots and the next: a raised path,
  // this cell's half of it (the next cell builds the other)
  if (s.riser === 0) {
    for (const line of contour(s.side, n, g, half, 0, (k) => s.land[k] >= 0)) {
      const rs = resample(line.points, line.closed, 0.5);
      const m = rs.s.length;
      const ring: number[][] = [];
      for (let k = 0; k < m; k++) {
        const a = Math.max(k - 1, 0);
        const c = Math.min(k + 1, m - 1);
        const tx = rs.p[2 * c] - rs.p[2 * a];
        const ty = rs.p[2 * c + 1] - rs.p[2 * a + 1];
        const tl = Math.hypot(tx, ty) || 1;
        // into the cell: the side field's high side, the line's left
        const ux = -ty / tl;
        const uy = tx / tl;
        const x = rs.p[2 * k];
        const y = rs.p[2 * k + 1];
        let own = floorAt(x + ux * 1.2, y + uy * 1.2);
        if (Number.isNaN(own)) own = natural(x, y);
        const top = own + 1.1 * bh;
        const fl = [own, 0, 0, 0];
        ring.push([
          b.vertex(x, y, own - SINK, PART.skirt, NONE, fl),
          b.vertex(x, y, top, PART.bundTop, NONE, fl),
          b.vertex(x + ux * 0.3, y + uy * 0.3, top, PART.bundTop, NONE, fl),
          b.vertex(x + ux * 0.55, y + uy * 0.55, own - 0.08, PART.bundSide, NONE, fl, [ux * bh, uy * bh, 0.25]),
        ]);
      }
      const count = line.closed ? m : m - 1;
      for (let k = 0; k < count; k++) {
        const r0 = ring[k];
        const r1 = ring[(k + 1) % m];
        b.quad(r0[0], r1[0], r1[1], r0[1]);
        b.quad(r0[1], r1[1], r1[2], r0[2]);
        b.quad(r0[2], r1[2], r1[3], r0[3]);
      }
    }
  }
  return b.geometry();
}
