import { BufferGeometry, Color, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { smoothstep } from '../../core/math';
import type { Chain, Contours } from './contours';
import type { TerraceField } from './field';
import { hash01, Perlin2, type Grad2 } from './noise';

// The paddy lab's terraces, built from the outlines (contours.ts): each
// outline, evened out and laid back on its level, is offset uphill by the
// dam's thickness (a base and a slow noise, kept within its band and inside
// its bends), and the dam built between the two as a ridge of earth across
// that width; a riser climbs to it from the floor below. Each band's top is
// filled level between its two levels (the dam stands on it, its inner face
// a little under the water, the riser's foot too, so nothing between them
// shows a gap). The canvas's edge is cut straight down, as a block of land.

export interface DamParams {
  /** Its thickness (m), give or take `widthVar` (m) over `widthScale` (m) of the outline. */
  readonly width: number;
  readonly widthVar: number;
  readonly widthScale: number;
  /** Its height over its paddy's floor (m), give or take `heightVar`. */
  readonly height: number;
  readonly heightVar: number;
  /** The riser's lean (m out per m of height). */
  readonly batter: number;
}

export interface PaddyParts {
  readonly floors: BufferGeometry;
  readonly dams: BufferGeometry;
  readonly risers: BufferGeometry;
  readonly sides: BufferGeometry;
  readonly outlines: BufferGeometry;
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
/** How far under the water a dam's inner foot and a riser's foot reach (m). */
const UNDER = 0.05;
/** The outlines' spacing once evened out (m). */
const SPACING = 0.12;

/** A band's floor (m): halfway between its levels. */
function floorOf(levels: readonly number[], k: number): number {
  return 0.5 * (levels[k] + levels[k + 1]);
}

const FLOOR_LOOKS: ReadonlyArray<readonly [number, number, number, number]> = [
  // share, colour (sRGB): flooded, just planted, growing, grown, ripening
  [0.34, 0.72, 0.79, 0.8],
  [0.16, 0.62, 0.72, 0.5],
  [0.22, 0.44, 0.6, 0.3],
  [0.16, 0.33, 0.5, 0.25],
  [0.12, 0.76, 0.72, 0.38],
];

function srgb(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, SRGBColorSpace);
}

export function buildPaddies(field: TerraceField, contours: Contours, half: number, dam: DamParams): PaddyParts {
  const { levels } = contours;
  const seed = field.p.seed;
  const widthNoise = new Perlin2(seed * 31 + 5);
  const heightNoise = new Perlin2(seed * 31 + 6);
  const g: Grad2 = { x: 0, y: 0 };
  const scratch: Grad2 = { x: 0, y: 0 };
  const base = floorOf(levels, 0) - 1.5;
  const stats: Record<string, number> = { outlines: 0, points: 0, narrowed: 0, unbent: 0 };

  const damPos: number[] = [];
  const damIdx: number[] = [];
  const riserPos: number[] = [];
  const riserIdx: number[] = [];
  const capPos: number[] = [];
  const lines: number[] = [];

  for (const chain of contours.chains) {
    const k = chain.level;
    if (k < 1 || k + 1 >= levels.length) continue;
    const z = levels[k];
    const up = levels[k + 1] - z;
    const down = z - levels[k - 1];
    const floor = floorOf(levels, k);
    const floorBelow = floorOf(levels, k - 1);
    const p = resample(chain, SPACING);
    const count = p.length / 2;
    if (count < (chain.closed ? 4 : 2)) continue;
    stats.outlines++;
    stats.points += count;
    // laid back on its level (the resampling cut its corners by a hair)
    for (let i = 0; i < count; i++) {
      if (!chain.closed && (i === 0 || i === count - 1)) continue;
      for (let it = 0; it < 2; it++) {
        const f = field.terrace(p[2 * i], p[2 * i + 1], g) - z;
        const gg = g.x * g.x + g.y * g.y;
        if (gg < 1e-8) break;
        const s = Math.max(Math.min(f / gg, 0.1), -0.1);
        p[2 * i] -= g.x * s;
        p[2 * i + 1] -= g.y * s;
      }
    }
    const at = (i: number): number => (chain.closed ? (i + count) % count : Math.min(Math.max(i, 0), count - 1));
    // uphill: the left of its way (the higher ground is on an outline's left)
    const nx = new Float64Array(count);
    const ny = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = at(i - 1);
      const b = at(i + 1);
      const tx = p[2 * b] - p[2 * a];
      const ty = p[2 * b + 1] - p[2 * a + 1];
      const l = Math.hypot(tx, ty) || 1;
      nx[i] = -ty / l;
      ny[i] = tx / l;
    }
    // its dam's thickness and height: a base and a slow noise
    const w = new Float64Array(count);
    const H = new Float64Array(count);
    const slope = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const x = p[2 * i];
      const y = p[2 * i + 1];
      w[i] = Math.max(dam.width + dam.widthVar * widthNoise.at(x / dam.widthScale, y / dam.widthScale, scratch), 0.06);
      H[i] = Math.max(dam.height + dam.heightVar * heightNoise.at(x / dam.widthScale, y / dam.widthScale, scratch), 0.04);
      field.terrace(x, y, g);
      slope[i] = Math.max(Math.hypot(g.x, g.y), 0.02);
      // no wider than a share of its band, nor than the bend it stands inside allows
      const band = 0.45 * (up / slope[i]);
      if (w[i] > band) {
        w[i] = band;
        stats.narrowed++;
      }
      const a = at(i - 1);
      const b = at(i + 1);
      if (a !== i && b !== i) {
        const ax = x - p[2 * a];
        const ay = y - p[2 * a + 1];
        const bx = p[2 * b] - x;
        const by = p[2 * b + 1] - y;
        const cross = ax * by - ay * bx;
        const kappa = (2 * cross) / Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(ax + bx, ay + by), 1e-12);
        if (kappa > 0 && w[i] > 0.7 / kappa) w[i] = 0.7 / kappa;
      }
    }
    soften(w, chain.closed);
    // the dam's inner edge: uphill of the outline, still below the next level's, and not over a crest
    const qx = new Float64Array(count);
    const qy = new Float64Array(count);
    const place = (i: number): void => {
      qx[i] = p[2 * i] + nx[i] * w[i];
      qy[i] = p[2 * i + 1] + ny[i] * w[i];
    };
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 12; tries++) {
        place(i);
        const tq = field.terrace(qx[i], qy[i]) - z;
        if (tq > 0.25 * w[i] * slope[i] && tq < 0.85 * up) break;
        w[i] *= 0.7;
        stats.narrowed++;
      }
    }
    // where a bend still folds the inner edge back on itself, thinner there
    for (let pass = 0; pass < 10; pass++) {
      let folds = 0;
      const last = chain.closed ? count : count - 1;
      for (let i = 0; i < last; i++) {
        const j = at(i + 1);
        place(i);
        place(j);
        const ex = p[2 * j] - p[2 * i];
        const ey = p[2 * j + 1] - p[2 * i + 1];
        if ((qx[j] - qx[i]) * ex + (qy[j] - qy[i]) * ey < 0.2 * (ex * ex + ey * ey)) {
          w[i] *= 0.7;
          w[j] *= 0.7;
          folds++;
        }
      }
      stats.unbent += folds;
      if (folds === 0) break;
    }
    for (let i = 0; i < count; i++) place(i);
    // a chain's ends lie on the canvas's edge: its dam's end along the edge, into the higher ground
    if (!chain.closed) {
      for (const i of [0, count - 1]) {
        const x = p[2 * i];
        const y = p[2 * i + 1];
        const onSide = Math.abs(Math.abs(x) - half) < Math.abs(Math.abs(y) - half);
        let dx = onSide ? 0 : 1;
        let dy = onSide ? 1 : 0;
        if (field.terrace(x + 0.05 * dx, y + 0.05 * dy) < field.terrace(x - 0.05 * dx, y - 0.05 * dy)) {
          dx = -dx;
          dy = -dy;
        }
        const lean = Math.max(Math.abs(dx * nx[i] + dy * ny[i]), 0.35);
        nx[i] = dx;
        ny[i] = dy;
        w[i] = Math.min(w[i] / lean, 0.45 * (up / slope[i]) / lean);
        place(i);
      }
      for (let i = 0; i < count; i++) {
        qx[i] = Math.min(Math.max(qx[i], -half), half);
        qy[i] = Math.min(Math.max(qy[i], -half), half);
      }
    }

    // the dam: its profile swept along the outline
    const d0 = damPos.length / 3;
    for (let i = 0; i < count; i++) {
      const x = p[2 * i];
      const y = p[2 * i + 1];
      for (const [u, f] of PROFILE) {
        const h = u === 1 ? floor - UNDER : floor + f * H[i];
        damPos.push(x + (qx[i] - x) * u, h, -(y + (qy[i] - y) * u));
      }
    }
    const M = PROFILE.length;
    const segs = chain.closed ? count : count - 1;
    for (let i = 0; i < segs; i++) {
      const a = d0 + i * M;
      const b = d0 + at(i + 1) * M;
      for (let j = 0; j + 1 < M; j++) damIdx.push(a + j, b + j, b + j + 1, a + j, b + j + 1, a + j + 1);
    }
    // the riser: from the floor below (under its water), leaning back, up to the dam's outer edge
    const r0 = riserPos.length / 3;
    for (let i = 0; i < count; i++) {
      const x = p[2 * i];
      const y = p[2 * i + 1];
      const top = floor + PROFILE[0][1] * H[i];
      const foot = floorBelow - UNDER;
      let lean = Math.min(dam.batter * (top - foot), 0.4 * (down / slope[i]));
      // (straight up where the canvas's edge cuts it)
      if (!chain.closed) lean *= smoothstep(0, 1, Math.min(i, count - 1 - i) * SPACING);
      riserPos.push(x, top, -y, x - nx[i] * lean, foot, -(y - ny[i] * lean));
    }
    for (let i = 0; i < segs; i++) {
      const a = r0 + 2 * i;
      const b = r0 + 2 * at(i + 1);
      riserIdx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    // the dam's ends at the canvas's edge, closed
    if (!chain.closed) {
      for (const i of [0, count - 1]) {
        const v = (j: number): number[] => damPos.slice(3 * (d0 + i * M + j), 3 * (d0 + i * M + j) + 3);
        const foot = [p[2 * i], floor - UNDER, -p[2 * i + 1]];
        for (let j = 0; j + 1 < M; j++) capPos.push(...foot, ...v(j), ...v(j + 1));
      }
    }
    for (let i = 0; i < segs; i++) {
      const j = at(i + 1);
      lines.push(p[2 * i], floor + H[i] + 0.02, -p[2 * i + 1], p[2 * j], floor + H[j] + 0.02, -p[2 * j + 1]);
    }
  }

  // the tops: each band level, a look of its own
  const floorPos: number[] = [];
  const floorCol: number[] = [];
  for (let k = 0; k < contours.fill.length; k++) {
    const tri = contours.fill[k];
    if (tri.length === 0) continue;
    const y = floorOf(levels, k);
    const c = floorLook(k, seed);
    for (let i = 0; i < tri.length; i += 2) {
      floorPos.push(tri[i], y, -tri[i + 1]);
      floorCol.push(c.r, c.g, c.b);
    }
  }
  const floors = new BufferGeometry();
  floors.setAttribute('position', new Float32BufferAttribute(floorPos, 3));
  floors.setAttribute('color', new Float32BufferAttribute(floorCol, 3));
  floors.computeVertexNormals();

  const dams = new BufferGeometry();
  dams.setAttribute('position', new Float32BufferAttribute(damPos, 3));
  dams.setIndex(damIdx);
  dams.computeVertexNormals();

  const risers = new BufferGeometry();
  risers.setAttribute('position', new Float32BufferAttribute(riserPos, 3));
  risers.setIndex(riserIdx);
  risers.computeVertexNormals();

  // the canvas's edge, cut straight down from each band's floor; the dams' ends
  const sidePos: number[] = [...capPos];
  const e = contours.edges;
  for (let i = 0; i < e.length; i += 5) {
    const y = floorOf(levels, e[i + 4]);
    sidePos.push(e[i], y, -e[i + 1], e[i], base, -e[i + 1], e[i + 2], base, -e[i + 3], e[i], y, -e[i + 1], e[i + 2], base, -e[i + 3], e[i + 2], y, -e[i + 3]);
  }
  const sides = new BufferGeometry();
  sides.setAttribute('position', new Float32BufferAttribute(sidePos, 3));
  sides.computeVertexNormals();

  const outlines = new BufferGeometry();
  outlines.setAttribute('position', new Float32BufferAttribute(lines, 3));

  stats.levels = levels.length;
  stats.dropped = contours.dropped;
  stats.floorTriangles = floorPos.length / 9;
  stats.damTriangles = damIdx.length / 3;
  stats.riserTriangles = riserIdx.length / 3;
  return { floors, dams, risers, sides, outlines, stats };
}

/** A band's look: one of the paddies' stages, by chance. */
function floorLook(k: number, seed: number): Color {
  let u = hash01(k, seed + 77);
  for (const [share, r, g, b] of FLOOR_LOOKS) {
    if (u < share) return srgb(r, g, b);
    u -= share;
  }
  const [, r, g, b] = FLOOR_LOOKS[0];
  return srgb(r, g, b);
}

/** An outline evened out: points every SPACING m along it (a chain keeps its two ends). */
function resample(chain: Chain, step: number): number[] {
  const xy = chain.closed ? [...chain.xy, chain.xy[0], chain.xy[1]] : chain.xy;
  const cum = [0];
  for (let i = 2; i < xy.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]));
  const total = cum[cum.length - 1];
  const count = Math.max(chain.closed ? 3 : 1, Math.round(total / step));
  const out: number[] = [];
  let seg = 0;
  for (let s = 0; s <= (chain.closed ? count - 1 : count); s++) {
    const d = (s / count) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const t = (d - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-12);
    out.push(xy[2 * seg] + (xy[2 * seg + 2] - xy[2 * seg]) * t, xy[2 * seg + 1] + (xy[2 * seg + 3] - xy[2 * seg + 1]) * t);
  }
  return out;
}

/** Widths eased along an outline: the narrowest nearby carried a little way on, then averaged (never wider than they were). */
function soften(w: Float64Array, closed: boolean): void {
  const n = w.length;
  const r = 4;
  const at = (i: number): number => (closed ? w[(i + n) % n] : w[Math.min(Math.max(i, 0), n - 1)]);
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = Infinity;
    for (let d = -r; d <= r; d++) v = Math.min(v, at(i + d));
    low[i] = v;
  }
  const lowAt = (i: number): number => (closed ? low[(i + n) % n] : low[Math.min(Math.max(i, 0), n - 1)]);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += lowAt(i + d);
    w[i] = Math.min(w[i], s / (2 * r + 1));
  }
}
