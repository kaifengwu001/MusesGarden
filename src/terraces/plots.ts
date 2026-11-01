import { Vector3 } from 'three';
import { clamp, smoothstep } from '../core/math';
import { gnoise, latticeHash } from '../planet/noise';
import { createCellSample, type CellSample, type TerraceCells } from './cells';
import { gradientFrame, type TerraceBase, type TerraceFields } from './fields';

// The terraces' plots, their crop and their ground on the CPU: the twin of
// plots.glsl, paddy.glsl and ground.glsl (the camera's footing, picking, the
// villages and the vista read it). Change them together.
//
//   levels   a cell cuts its hillside along its contours into levels a riser
//            apart (its riser taller the steeper it is, so a band is some 5 m
//            wide), each wall a little off its place, here and there one left
//            out: one paddy two levels wide, its walls half again as tall
//   paddies  a band cut along the cell's way every 14–34 m (square-ish where
//            the cell is gentle) by bunds that turn round, staggered level to
//            level
//   flats    on a valley's flat floor, rows 9–16 m wide along the cell's way,
//            bowed, cut into plots 1–2.3 rows long, each level with the
//            ground under its middle
//   crop     each paddy's stage (its cell's season and its own chance), its
//            plants' height, the water on its floor at its own level

/**
 * The terraces' build: a cell's band (m: its riser is its slope times this,
 * within `riser`, each cell ±`spread`), each wall's jitter (a level's share),
 * the share of walls left out, the sites cutting a band this far apart (m: its paddies about as long), bands wider than
 * `square` (m) cut square-ish; a riser's batter (m across per m of height), a
 * bund's width and height (m) and the share of it flat on top.
 */
export const TERRACE = { step: 0.42, cutMeters: 15, band: 4.2, riser: [0.12, 1.3], spread: 0.22, jitter: 0.16, merge: 0.13, cuts: [22, 48], square: 9, batter: 0.45, bund: 0.2, bundHeight: 0.19, crest: 0.45 } as const;
/** The flats' rows (m wide) and their plots (× the row long). */
export const PLOTS = { width: [9, 16], length: [1, 2.3] } as const;
/** A paddy's delay: its cell's season's share (the rest its own chance), and how far the season spreads. A share left fallow. */
export const SEASON = { cell: 0.5, band: 0.82, spread: 0.42, fallow: 0.05 } as const;
/** A band's cuts are placed from its outer wall at most this far downhill (m). */
export const CUT_REACH = 5;
/** Near its cell's edge, a cell is read this far in (m) past the life bake's texel. */
export const EDGE_READ = 0.8;

export const PLOT_TERRACE = 0;
export const PLOT_FLAT = 1;

/** One plot at a point (mirrors Plot in plots.glsl). */
export interface PlotSample {
  kind: number;
  cell: number;
  id: number;
  natural: number;
  slope: number;
  wild: number;
  flatness: number;
  season: number;
  floorH: number;
  u: number;
  lo: number;
  hi: number;
  below: number;
  above: number;
  dOut: number;
  dIn: number;
  band: number;
  level: number;
  dCross: number;
  crossTop: number;
  fl: number;
}

export function createPlotSample(): PlotSample {
  return { kind: 0, cell: 0, id: 0, natural: 0, slope: 0, wild: 0, flatness: 0, season: 0, floorH: 0, u: 0, lo: 0, hi: 1, below: 0, above: 0, dOut: 0, dIn: 0, band: 0, level: 0, dCross: 0, crossTop: 0, fl: 0 };
}

/** A paddy's crop (mirrors Crop in paddy.glsl). */
export interface CropSample {
  variant: number;
  maturity: number;
  fallow: boolean;
  height: number;
  water: number;
  rows: number;
  /** The paddy's own constants, its crop at any season worked out from them (paddy.glsl cropFrom): its place in the season (0 planted first … 1 last), its plants' and its water's own share. */
  delay: number;
  hv: number;
  wv: number;
}

export function createCropSample(): CropSample {
  return { variant: 0, maturity: 0, fallow: false, height: 0, water: 0, rows: 0, delay: 0, hv: 0, wv: 0 };
}

const unitHash = (h: number): number => (h >>> 8) / 16777216;
const nextHash = (h: number): number => (Math.imul(h, 747796405) + 2891336453) >>> 0;

const cell = createCellSample();
const base: TerraceBase = { natural: 0, slope: 0, wild: 0, flat: 0 };
const fp = new Vector3();
const cutsOut = { site: 0, dist: 0 };
const up = new Vector3();
const along = new Vector3();
const wallPoint = new Vector3();
const ua = new Vector3();
const ub = new Vector3();
const plotsOut = { j: 0, dist: 0, vMid: 0, L: 0 };
const wallsOut = { lo2: 0, lo: 0, hi: 0, hi2: 0 };
const lean = { v: 0 };
const mid = { v: 0 };

export class TerracePlots {
  constructor(
    private readonly fields: TerraceFields,
    private readonly cells: TerraceCells,
    private readonly seed: number,
  ) {}

  /** A wall's cut field at a direction (the cuts along it fall where it crosses a step: survey.ts). */
  cutField(dir: Vector3, level: number, meters: number = TERRACE.cutMeters): number {
    const k = this.fields.radius / meters;
    return gnoise(dir.x * k, dir.y * k, dir.z * k, (this.seed + 31 * level + 7) >>> 0);
  }

  /** The season's spread over the hillsides at a direction (0 planted first … 1 last). */
  seasonAt(dir: Vector3): number {
    return this.fields.season(dir);
  }

  /**
   * A paddy's lean in the season (0 planted first … 1 last) from its wall's level and its step along it: a slow
   * noise over the two, so neighbours along a wall and up the hillside lean alike (whole stretches of
   * hillside flooded or green together), the same whichever cell builds it.
   */
  seasonOf(level: number, step: number): number {
    // (each band its own, changing slowly along it: Kai's paddy painting has each band one colour over long stretches)
    return clamp(0.5 + 1.6 * gnoise(level * 0.85 + 0.5, step * 0.09 + 0.5, 0.5, (this.seed + 703) >>> 0), 0, 1);
  }

  hash(cellKey: number, a: number, b: number, c: number, salt: number): number {
    return latticeHash(a, b, c, ((this.seed ^ Math.imul(cellKey, 2654435761)) + salt) >>> 0);
  }

  /** A cell's riser (m), from its slope (mirrors cellRiser). */
  riser(cellKey: number, slope: number): number {
    const s = clamp(slope * TERRACE.band, TERRACE.riser[0], TERRACE.riser[1]);
    return s * (1 + TERRACE.spread * (2 * unitHash(this.hash(cellKey, 0, 0, 0, 21)) - 1));
  }

  /** Wall k of a cell: its place across the levels (a level's index, a little off), and whether it is left out. */
  wall(cellKey: number, k: number): { at: number; left: boolean } {
    const flag = { v: false };
    const at = this.wallAt(cellKey, k, flag);
    return { at, left: flag.v };
  }

  /** A cell's level offset (its walls' heights: (at − offset) · riser). */
  offset(cellKey: number): number {
    return unitHash(this.hash(cellKey, 0, 0, 0, 22));
  }

  /** Wall k of a cell: its place across the levels, and whether it is left out (mirrors wallAt). */
  private wallAt(cellKey: number, k: number, left: { v: boolean }): number {
    const h = this.hash(cellKey, k, 0, 0, 31);
    left.v = (k & 1) === 0 && unitHash(h) < TERRACE.merge;
    return k + TERRACE.jitter * (2 * unitHash(nextHash(h)) - 1);
  }

  private readonly w = new Float64Array(10);
  private readonly left = [false, false, false, false, false, false, false, false, false, false];

  /** The walls round u (mirrors wallsRound). */
  walls(cellKey: number, u: number, out: typeof wallsOut): typeof wallsOut {
    const k0 = Math.floor(u) - 4;
    const flag = { v: false };
    for (let i = 0; i < 10; i++) {
      this.w[i] = this.wallAt(cellKey, k0 + i, flag);
      this.left[i] = flag.v;
    }
    let ilo = 0;
    for (let i = 0; i < 10; i++) if (!this.left[i] && this.w[i] <= u) ilo = i;
    let ihi = 9;
    for (let i = 9; i >= 0; i--) if (!this.left[i] && i > ilo) ihi = i;
    let ilo2 = 0;
    for (let i = 0; i < 10; i++) if (!this.left[i] && i < ilo) ilo2 = i;
    let ihi2 = 9;
    for (let i = 9; i >= 0; i--) if (!this.left[i] && i > ihi) ihi2 = i;
    out.lo2 = this.w[ilo2];
    out.lo = this.w[ilo];
    out.hi = this.w[ihi];
    out.hi2 = this.w[ihi2];
    return out;
  }

  private readonly c4 = new Float64Array(4);
  private readonly l4 = new Float64Array(4);
  private readonly m4 = new Float64Array(4);

  /** A band's cuts: its outer wall shared out among the sites of its level (mirrors cutsRound). */
  private cuts(cellKey: number, level: number, wallPoint: Vector3, spacing: number, out: typeof cutsOut): typeof cutsOut {
    const R = this.fields.radius;
    const qx = (wallPoint.x * R) / spacing;
    const qy = (wallPoint.y * R) / spacing;
    const qz = (wallPoint.z * R) / spacing;
    const bx = Math.floor(qx);
    const by = Math.floor(qy);
    const bz = Math.floor(qz);
    let d1 = 1e9;
    let d2 = 1e9;
    let site = 0;
    const salt = (61 + Math.imul((level + 4096) >>> 0, 2654435761)) >>> 0;
    for (let z = -1; z <= 1; z++) {
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
          const cx = bx + x;
          const cy = by + y;
          const cz = bz + z;
          const h = this.hash(cellKey, cx, cy, cz, salt);
          const fx = cx + 0.1 + (0.8 * (h & 1023)) / 1023;
          const fy = cy + 0.1 + (0.8 * ((h >>> 10) & 1023)) / 1023;
          const fz = cz + 0.1 + (0.8 * ((h >>> 20) & 1023)) / 1023;
          const d = (Math.hypot(fx - qx, fy - qy, fz - qz) + 0.2 * (unitHash(nextHash(h)) - 0.5)) * spacing;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            site = h;
          } else if (d < d2) d2 = d;
        }
      }
    }
    out.site = site;
    out.dist = 0.5 * (d2 - d1);
    return out;
  }

  /** The ground's way uphill at dir (unit tangent) and its slope (mirrors uphillAt). */
  uphill(dir: Vector3, out: Vector3): number {
    gradientFrame(dir, ua, ub);
    const e = 2;
    const R = this.fields.radius;
    const nat = (t: Vector3, k: number): number => this.fields.natural(fp.copy(dir).addScaledVector(t, (k * e) / R).normalize());
    const ha = nat(ua, 1) - nat(ua, -1);
    const hb = nat(ub, 1) - nat(ub, -1);
    out.copy(ua).multiplyScalar(ha / (2 * e)).addScaledVector(ub, hb / (2 * e));
    const slope = out.length();
    if (slope > 1e-5) out.divideScalar(slope);
    else out.copy(ua);
    return slope;
  }

  /** The flats: row r's lower edge at v (mirrors rowEdge). */
  private rowEdge(cellKey: number, r: number, v: number, W: number, phase: number): number {
    const h = this.hash(cellKey, r, 0, 0, 53);
    const h2 = nextHash(h);
    const bow = (0.3 + 1.9 * unitHash(h)) * Math.sin(v / (9 + 6 * unitHash(h2)) + 2 * Math.PI * unitHash(nextHash(h2)));
    return (r - phase + 0.28 * (2 * unitHash((h ^ 0x85ebca6b) >>> 0) - 1)) * W + bow;
  }

  private rowMiddle(cellKey: number, r: number, W: number, phase: number): number {
    const a = r - phase + 0.28 * (2 * unitHash((this.hash(cellKey, r, 0, 0, 53) ^ 0x85ebca6b) >>> 0) - 1);
    const b = r + 1 - phase + 0.28 * (2 * unitHash((this.hash(cellKey, r + 1, 0, 0, 53) ^ 0x85ebca6b) >>> 0) - 1);
    return 0.5 * (a + b) * W;
  }

  /** The flats: plot j's lower edge along row r (mirrors plotEdge). */
  private plotEdge(cellKey: number, r: number, j: number, y: number, yMid: number, L: number, phase: number): number {
    const h = this.hash(cellKey, r, j, 0, 56);
    lean.v = 0.25 * (2 * unitHash(nextHash(h)) - 1);
    mid.v = (j - phase + 0.3 * (2 * unitHash(h) - 1)) * L;
    return mid.v + lean.v * (y - yMid);
  }

  /** The plots along row r round v (mirrors plotsRound). */
  private plotsRound(cellKey: number, r: number, v: number, y: number, yMid: number, W: number, out: typeof plotsOut): typeof plotsOut {
    const h = this.hash(cellKey, r, 0, 0, 54);
    const L = W * (PLOTS.length[0] + (PLOTS.length[1] - PLOTS.length[0]) * unitHash(h));
    const phase = unitHash(nextHash(h));
    const j0 = Math.floor(v / L + phase) - 1;
    for (let i = 0; i < 4; i++) {
      this.c4[i] = this.plotEdge(cellKey, r, j0 + i, y, yMid, L, phase);
      this.l4[i] = lean.v;
      this.m4[i] = mid.v;
    }
    let k = 0;
    for (let i = 0; i < 4; i++) if (this.c4[i] <= v) k = i;
    k = Math.min(k, 2);
    out.j = j0 + k;
    out.dist = Math.max(Math.min((v - this.c4[k]) / Math.sqrt(1 + this.l4[k] ** 2), (this.c4[k + 1] - v) / Math.sqrt(1 + this.l4[k + 1] ** 2)), 0);
    out.vMid = 0.5 * (this.m4[k] + this.m4[k + 1]);
    out.L = L;
    return out;
  }

  /** The ground (m) under a point of the flats, level to 5 cm (mirrors flatFloorAt). */
  private flatFloor(c: CellSample, along: number, up: number): number {
    const R = this.fields.radius;
    fp.copy(c.centre).multiplyScalar(R).addScaledVector(c.along, along).addScaledVector(c.up, up).normalize();
    return Math.floor(this.fields.natural(fp) / 0.05 + 0.5) * 0.05;
  }

  /** The plot at a direction (mirrors plotAt / plotFrom). */
  plotAt(dir: Vector3, out: PlotSample): PlotSample {
    const b = this.fields.base(dir, base);
    const c = this.cells.at(dir, cell);
    out.natural = b.natural;
    out.slope = Math.max(b.slope, 0.004);
    out.wild = b.wild;
    out.flatness = b.flat;
    out.season = c.season;
    out.cell = c.key;
    out.dCross = 1e3;
    out.fl = 0.5;
    out.u = 0;
    out.lo = 0;
    out.hi = 1;
    out.dOut = 1e3;
    out.dIn = 1e3;
    out.band = 1e3;
    const bh = TERRACE.bundHeight;
    if (b.flat < 0.5) {
      out.kind = PLOT_TERRACE;
      const slopeC = Math.max(c.slope, 0.004);
      const s = this.riser(c.key, slopeC);
      const phi = unitHash(this.hash(c.key, 0, 0, 0, 22));
      out.u = b.natural / s + phi;
      const w = this.walls(c.key, out.u, wallsOut);
      out.lo = w.lo;
      out.hi = w.hi;
      out.floorH = (0.5 * (w.lo + w.hi) - phi) * s;
      out.below = (0.5 * (w.lo2 + w.lo) - phi) * s;
      out.above = (0.5 * (w.hi + w.hi2) - phi) * s;
      const perLevel = s / out.slope;
      out.dOut = (out.u - w.lo) * perLevel;
      out.dIn = (w.hi - out.u) * perLevel;
      out.band = (w.hi - w.lo) * perLevel;
      const level = Math.floor(w.lo + 0.5);
      out.level = level;
      out.fl = clamp((out.u - w.lo) / (w.hi - w.lo), 0, 1);
      // the point of its outer wall straight downhill, moved along the wall toward the band's edges
      this.uphill(dir, up);
      along.crossVectors(dir, up);
      const cc = 2 * out.fl - 1;
      const r = Math.sqrt(Math.max(1 - cc * cc, 0));
      const k = this.fields.radius / 23;
      const bow = 0.62 * gnoise(dir.x * k, dir.y * k, dir.z * k, (this.seed + Math.imul((level + 4096) >>> 0, 747796405)) >>> 0);
      const R = this.fields.radius;
      wallPoint
        .copy(dir)
        .addScaledVector(along, (bow * (1 - r) * Math.min(out.band, 2 * CUT_REACH)) / R)
        .addScaledVector(up, -Math.min(out.dOut, CUT_REACH) / R)
        .normalize();
      let spacing = TERRACE.cuts[0] + (TERRACE.cuts[1] - TERRACE.cuts[0]) * unitHash(this.hash(c.key, 0, 0, 0, 43));
      const bandC = s / slopeC;
      if (bandC > TERRACE.square) spacing = clamp(spacing, 0.9 * bandC, 2 * bandC);
      const cut = this.cuts(c.key, level, wallPoint, spacing, cutsOut);
      const lean = bow * clamp(cc / Math.max(r, 0.2), -5, 5);
      out.id = nextHash(cut.site);
      out.dCross = Math.min(cut.dist / Math.sqrt(1 + lean * lean), c.edge);
      out.crossTop = out.floorH + bh;
    } else {
      out.kind = PLOT_FLAT;
      const W = PLOTS.width[0] + (PLOTS.width[1] - PLOTS.width[0]) * unitHash(this.hash(c.key, 0, 0, 0, 51));
      const phase = unitHash(this.hash(c.key, 0, 0, 0, 52));
      const v = c.v;
      const y = c.w;
      const r0 = Math.floor(y / W + phase) - 1;
      const e = this.c4;
      for (let i = 0; i < 4; i++) e[i] = this.rowEdge(c.key, r0 + i, v, W, phase);
      let k = 0;
      for (let i = 0; i < 4; i++) if (e[i] <= y) k = i;
      k = Math.min(k, 2);
      const r = r0 + k;
      const lowerEdge = e[k];
      const upperEdge = e[k + 1];
      const yMid = this.rowMiddle(c.key, r, W, phase);
      const pl = this.plotsRound(c.key, r, v, y, yMid, W, plotsOut);
      const j = pl.j;
      const dPlot = pl.dist;
      const vMid = pl.vMid;
      const L = pl.L;
      const dRow = Math.min(y - lowerEdge, upperEdge - y);
      out.level = r;
      out.id = this.hash(c.key, r, j, 0, 58);
      out.fl = clamp((y - lowerEdge) / Math.max(upperEdge - lowerEdge, 1e-3), 0, 1);
      out.floorH = this.flatFloor(c, vMid, yMid);
      let other: number;
      if (dRow < dPlot) {
        const rn = y - lowerEdge < upperEdge - y ? r - 1 : r + 1;
        const yn = this.rowMiddle(c.key, rn, W, phase);
        const n = this.plotsRound(c.key, rn, v, y, yn, W, plotsOut);
        other = this.flatFloor(c, n.vMid, yn);
      } else other = this.flatFloor(c, vMid + (v < vMid ? -L : L), yMid);
      out.dCross = Math.min(dRow, dPlot, c.edge);
      out.crossTop = Math.max(out.floorH, other) + bh;
      out.below = out.floorH;
      out.above = out.floorH;
    }
    return out;
  }

  /** A paddy's crop this season (mirrors cropOf in paddy.glsl); front: the season's front; share: how much of its delay its season sets (the rest its own chance). */
  cropOf(p: PlotSample, front: number, out: CropSample, share: number = SEASON.cell): CropSample {
    out.variant = unitHash(p.id);
    out.rows = unitHash(nextHash(p.id));
    const chance = unitHash((p.id ^ 0x9e3779b9) >>> 0);
    const delay = clamp(share * p.season + (1 - share) * chance, 0, 1);
    out.fallow = unitHash((p.id ^ 0x85ebca6b) >>> 0) < SEASON.fallow;
    out.delay = delay;
    out.hv = unitHash((p.id ^ 0x632be5ab) >>> 0);
    out.wv = unitHash((p.id ^ 0x2545f491) >>> 0);
    return cropAt(out, front);
  }

  /** A plot's ground (m) at its point: floor, bunds and walls, without the water (mirrors plotGround). */
  ground(p: PlotSample): number {
    const bh = TERRACE.bundHeight;
    let g = p.floorH;
    if (p.kind === PLOT_TERRACE) {
      g = Math.max(g, p.floorH + bh * bundRise(p.dOut));
      const top = p.above + bh;
      g = Math.max(g, p.floorH + (top - p.floorH) * clamp(1 - p.dIn / riserWidth(p.floorH, top), 0, 1));
    }
    const half = 0.5 * TERRACE.bund;
    return Math.max(g, p.floorH + (p.crossTop - p.floorH) * (1 - smoothstep(TERRACE.crest * half, half, p.dCross)));
  }

  /** The surface (m): the ground, the water over it, the hills' own shape where wild (mirrors surfaceOf). */
  surface(p: PlotSample, c: CropSample): number {
    const water = c.water > 0 ? p.floorH + c.water : -1e4;
    const h = Math.max(this.ground(p), water);
    return h + (p.natural - h) * smoothstep(0.35, 0.65, p.wild);
  }
}

/** A paddy's crop at the season's front, from its constants (mirrors cropFrom in paddy.glsl). */
export function cropAt(c: CropSample, front: number): CropSample {
  c.maturity = clamp((front - c.delay) / SEASON.spread, 0, 1);
  c.height = c.maturity > 0 && !c.fallow ? (0.12 + 0.83 * smoothstep(0.05, 0.85, c.maturity)) * (0.8 + 0.4 * c.hv) : 0;
  const full = 0.06 + 0.1 * c.wv;
  c.water = c.fallow ? (c.wv < 0.3 ? 0.025 : 0) : full * (1 - smoothstep(0.55, 0.95, c.maturity)) * (1 - 0.55 * smoothstep(0.05, 0.5, c.maturity) * c.hv);
  return c;
}

/** A bund's rise d meters in from its outer edge (mirrors bundRise). */
export function bundRise(d: number): number {
  return 1 - smoothstep(TERRACE.crest * TERRACE.bund, TERRACE.bund, d);
}

/** A riser's width (m) for the floor below it and the bund it climbs to (mirrors riserWidth). */
export function riserWidth(floorH: number, top: number): number {
  return Math.max(TERRACE.batter * (top - floorH), 0.06);
}
