import { acrossOf, type CellSurvey } from './survey';

// The paddies' floors of a surveyed cell (survey.ts), as pieces of the grid:
// every square of the terraced land clipped exactly at the land's edge, at
// the walls (a band's floor ends on its wall's contour) and along the cuts
// crossing it (a paddy ends on its cut), so the paddies tile the land
// without a gap or an overlap. Squares wholly inside one paddy, no cut
// through them, are handed out whole (the mesh merges them).

/** A floor piece: its paddy, its corners (x, y pairs in the chart), each corner's share across its band (0 the lower wall … 1 the upper). */
export interface FloorPiece {
  readonly paddy: number;
  readonly xy: number[];
  readonly across: number[];
}

/** Fields carried by a clipped vertex: x, y, hs, land, d (a cut's signed distance). */
const F = 5;

/** Sutherland–Hodgman: the part of a polygon (vertices of F fields each) where field `at` ≥ value (≤ when below). */
function clip(poly: number[], at: number, value: number, below = false): number[] {
  const out: number[] = [];
  const m = poly.length / F;
  const sign = below ? -1 : 1;
  for (let k = 0; k < m; k++) {
    const a = k * F;
    const b = ((k + 1) % m) * F;
    const va = sign * (poly[a + at] - value);
    const vb = sign * (poly[b + at] - value);
    if (va >= 0) for (let f = 0; f < F; f++) out.push(poly[a + f]);
    if (va >= 0 !== vb >= 0) {
      const t = va / (va - vb);
      for (let f = 0; f < F; f++) out.push(poly[a + f] + (poly[b + f] - poly[a + f]) * t);
    }
  }
  return out;
}

/** The floor pieces of a surveyed cell, handed to `piece` one by one; `plain` gets each square wholly inside one paddy. */
export function floorPieces(s: CellSurvey, piece: (p: FloorPiece) => void, plain: (i: number, j: number, paddy: number) => void): void {
  const { n, g, half, hs, land, bands, levels, band, paddy, cuts, crossing } = s;
  if (bands.length === 0) return;
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
  /** A paddy of band b near grid point (i, j): the point's own, else the nearest within two squares. */
  const paddyNear = (i: number, j: number, b: number, sideOk: (x: number, y: number) => boolean): number => {
    for (let r = 0; r <= 2; r++) {
      for (let dj = -r; dj <= r + 1; dj++) {
        for (let di = -r; di <= r + 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const k = jj * n + ii;
          if (band[k] !== b || paddy[k] < 0) continue;
          if (!sideOk(-half + ii * g, -half + jj * g)) continue;
          return paddy[k];
        }
      }
    }
    return -1;
  };
  const poly: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const k0 = j * n + i;
      const ks = [k0, k0 + 1, k0 + n + 1, k0 + n];
      if (land[ks[0]] < 0 && land[ks[1]] < 0 && land[ks[2]] < 0 && land[ks[3]] < 0) continue;
      const through = crossing.get(k0);
      const p0 = paddy[ks[0]];
      if (!through && p0 >= 0 && ks.every((k) => paddy[k] === p0 && band[k] === band[ks[0]])) {
        plain(i, j, p0);
        continue;
      }
      let hmin = Infinity;
      let hmax = -Infinity;
      for (const k of ks) {
        hmin = Math.min(hmin, hs[k]);
        hmax = Math.max(hmax, hs[k]);
      }
      // the cuts through the square: a line each, through the cut's points in or by it
      const lines: Array<[number, number, number, number]> = [];
      if (through) {
        const byCut = new Map<number, number[]>();
        for (let t = 0; t < through.length; t += 2) {
          const list = byCut.get(through[t]) ?? [];
          list.push(through[t + 1]);
          byCut.set(through[t], list);
        }
        for (const [ci, segs] of byCut) {
          const p = cuts[ci].points;
          const a = Math.min(...segs);
          const b = Math.max(...segs) + 1;
          lines.push([p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]]);
        }
      }
      const ij = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      for (let b = bandOf(hmin); b <= bandOf(hmax); b++) {
        const B = bands[b];
        poly.length = 0;
        ks.forEach((k, c) => poly.push(-half + ij[c][0] * g, -half + ij[c][1] * g, hs[k], land[k], 0));
        let p = clip(poly, 3, 0);
        if (p.length >= 3 * F) p = clip(p, 2, B.lo);
        if (p.length >= 3 * F) p = clip(p, 2, B.hi, true);
        if (p.length < 3 * F) continue;
        // split along the cuts: each part takes the paddy of the band's points on its side
        let parts: Array<{ p: number[]; side: number[] }> = [{ p, side: [] }];
        for (const [ax, ay, bx, by] of lines) {
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 1e-6) continue;
          const next: Array<{ p: number[]; side: number[] }> = [];
          for (const part of parts) {
            const q = part.p;
            for (let v = 0; v < q.length; v += F) q[v + 4] = ((bx - ax) * (q[v + 1] - ay) - (by - ay) * (q[v] - ax)) / len;
            const left = clip(q, 4, 0);
            const right = clip(q, 4, 0, true);
            if (left.length >= 3 * F) next.push({ p: left, side: [...part.side, 1] });
            if (right.length >= 3 * F) next.push({ p: right, side: [...part.side, -1] });
          }
          parts = next;
        }
        for (const part of parts) {
          const sideOk = (x: number, y: number): boolean =>
            lines.every(([ax, ay, bx, by], li) => {
              const d = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
              return part.side[li] === undefined || Math.sign(d) === part.side[li] || Math.abs(d) < 1e-9;
            });
          const pd = paddyNear(i, j, b, sideOk);
          if (pd < 0) continue;
          const xy: number[] = [];
          const across: number[] = [];
          for (let v = 0; v < part.p.length; v += F) {
            xy.push(part.p[v], part.p[v + 1]);
            across.push(acrossOf(B, part.p[v + 2]));
          }
          piece({ paddy: pd, xy, across });
        }
      }
    }
  }
}
