import { hash32, unit } from '../../core/hash';
import { smoothstep } from '../../core/math';
import { gnoise } from '../../planet/noise';
import { Bands, Cuts, inRing, insideRing, type CutParams } from './bands';
import { PlanetField, type FieldParams } from './field';
import { clip, faceDirection, Side, SphereGrid, tangentFrame, vertexCorner, type Chain, type Corner, type Field } from './sphere';

// The terraces' build (build/): the paddy lab's construction (src/dev/
// paddyLab/build.ts) over the whole planet, once, from the planet's
// mathematics (field.ts): every outline is found on the field itself, every
// height, slope and normal worked out from it exactly, nothing read off a
// mesh or a texture. The slope sorts the ground: the woods (their own ground,
// the hills' height itself, with trees), the flats (plain fields in long
// strips along the lie of the land, a band each, crossed every so far, thin
// dark bunds between and a pale track winding through, as Kai's aerial of
// flat rice fields has them), the terraces between.
// Each band's paddies are filled level, each paddy its own (the cuts' lines
// part them, bands.ts); along each bank a dam on the higher paddy's edge and
// a riser down to the paddy below; across each cut a cross-bank; a bank of
// earth where the woods meet the paddies. Everything that stands on a floor
// reaches a little under it, so nothing between them shows a gap. The
// geometry comes out in chunks (a mesh each, culled on its own), per vertex
// as the terraces' shaders read it (terrace.vert.glsl): position, normal,
// aPart, aPaddy (its paddy's crop constants), aFloor (its floor or ground;
// fallow, or the ground's slope; its share across its band; meters from its
// bank).

export const PART = { floor: 0, riser: 1, bund: 2, bundSide: 3, earth: 4, ridge: 5, woods: 6, track: 7 } as const;

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
  /** A field's length (m: the strips, each a band, crossed this far apart) and how far the crossings wander (× it). */
  readonly length: number;
  readonly warp: number;
  /** The tracks winding through the flats: how far apart, about (m), and how wide (m). */
  readonly trackScale: number;
  readonly trackWidth: number;
}

export interface BuildParams {
  /** The grid's spacing (m): where the outlines are looked for. */
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
  /** The banks' spacing once evened out (m), and the cross-banks', the plots' bunds' and the land's edges'. */
  readonly spacing: number;
  readonly cutSpacing: number;
  readonly edgeSpacing: number;
}

/** The paddy lab's settings (src/dev/paddyLab/lab.ts), Kai's after its second round. */
export const BUILD: BuildParams = {
  cell: 0.45,
  minArea: 12,
  dam: { width: 0.3, widthVar: 0.08, widthScale: 7, height: 0.13, heightVar: 0.04, batter: 0.3 },
  cut: { spacing: [7, 20], cascade: 0.75, drift: 0.5, shift: 0.45, blend: 1.2 },
  plot: { length: 32, warp: 0.3, trackScale: 120, trackWidth: 1.6 },
  treeSpacing: 2.2,
  leastWoods: 60,
  leastFlats: 400,
  // (the lab's 0.12 along the banks and half that across the cuts: on the planet as many points as keep a bank's
  // bend under a millimetre off its curve, the cuts' lines all but straight)
  spacing: 0.18,
  cutSpacing: 0.15,
  edgeSpacing: 0.2,
};

export interface BuildInput {
  /** The world's noise seed, the planet's mathematics, the construction's settings. */
  readonly seed: number;
  readonly field: Omit<FieldParams, 'seed'>;
  readonly params: BuildParams;
}

/** A chunk's geometry, as the terraces' shaders read it. */
export interface ChunkData {
  readonly position: Float32Array;
  readonly normal: Int8Array;
  readonly part: Uint8Array;
  readonly paddy: Uint8Array;
  readonly floor: Float32Array;
  readonly index: Uint32Array;
}

export interface BuildOutput {
  /** 6 faces × CHUNKS² chunks (null: nothing in it). */
  readonly chunks: Array<ChunkData | null>;
  /** Per tree: its direction (x, y, z), its ground (m), a seed in [0, 1). */
  readonly trees: Float32Array;
  readonly stats: Record<string, number>;
  /** (checks) Points of an outline where the floor inside stands over the floor outside, both terraced, and no bank was built: direction and level (x, y, z, k, …). */
  readonly bare: Float32Array;
}

/** Chunks per face side. */
export const CHUNKS = 4;

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
/** How far under the floors the dams' and risers' feet reach (m); how far past its last point an open bank or ridge is carried on (m). */
const UNDER = 0.05;
const OVERLAP = 0.1;

/** The paddies' looks as the lab measured them from the aerial (shares of: flooded, flooded and shallow, just planted, growing, grown, grown deep), as places in the season at its default front (paddy.glsl cropFrom: maturity = (front − delay) / spread). */
const LOOK_SHARE = [0, 0.44, 0.54, 0.9, 1];
const LOOK_DELAY = [1, 0.55, 0.424, 0.13, 0];

const SLOT = { woods: 2, flat: 3, base: 100000, bands: 200000, u: 300000, v: 400000, w: 500000, cut: 600000 } as const;

/** A growable array of numbers, typed. */
class Grow<T extends Float32Array | Float64Array | Int32Array | Uint8Array> {
  n = 0;
  constructor(public a: T) {}
  push(x: number): void {
    if (this.n === this.a.length) {
      const b = new (this.a.constructor as new (n: number) => T)(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
  }
  view(): T {
    return this.a.subarray(0, this.n) as T;
  }
}

class Chunk {
  readonly pos = new Grow(new Float32Array(4096));
  /** A vertex's own normal (x, y, z; NaN: from the faces round it). */
  readonly nrm = new Grow(new Float32Array(4096));
  readonly part = new Grow(new Uint8Array(1024));
  readonly paddy = new Grow(new Uint8Array(4096));
  readonly floor = new Grow(new Float32Array(4096));
  readonly index = new Grow(new Int32Array(4096));
  /** Floors' and the woods' vertices by point and owner (shared by the triangles of a paddy, of the woods). */
  readonly shared = new Map<number, number>();
  get count(): number {
    return this.part.n;
  }
  vertex(x: number, y: number, z: number, part: number, paddy: readonly number[], f0: number, f1: number, f2: number, f3: number, normal?: readonly number[]): number {
    this.pos.push(x);
    this.pos.push(y);
    this.pos.push(z);
    this.nrm.push(normal ? normal[0] : Number.NaN);
    this.nrm.push(normal ? normal[1] : Number.NaN);
    this.nrm.push(normal ? normal[2] : Number.NaN);
    this.part.push(part);
    for (let i = 0; i < 4; i++) this.paddy.push(Math.round(Math.min(Math.max(paddy[i], 0), 1) * 255));
    this.floor.push(f0);
    this.floor.push(f1);
    this.floor.push(f2);
    this.floor.push(f3);
    return this.part.n - 1;
  }
  data(): ChunkData | null {
    if (this.index.n === 0) return null;
    const position = this.pos.view().slice();
    const index = Uint32Array.from(this.index.view());
    const own = this.nrm.view();
    // (the walls' normals from the faces round each vertex, area-weighted; the floors' and the woods' their own)
    const nrm = new Float32Array(position.length);
    for (let i = 0; i < index.length; i += 3) {
      const a = 3 * index[i];
      const b = 3 * index[i + 1];
      const c = 3 * index[i + 2];
      const ux = position[b] - position[a];
      const uy = position[b + 1] - position[a + 1];
      const uz = position[b + 2] - position[a + 2];
      const vx = position[c] - position[a];
      const vy = position[c + 1] - position[a + 1];
      const vz = position[c + 2] - position[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        nrm[k] += nx;
        nrm[k + 1] += ny;
        nrm[k + 2] += nz;
      }
    }
    const normal = new Int8Array(position.length);
    for (let k = 0; k < position.length; k += 3) {
      let [x, y, z] = Number.isNaN(own[k]) ? [nrm[k], nrm[k + 1], nrm[k + 2]] : [own[k], own[k + 1], own[k + 2]];
      let l = Math.hypot(x, y, z);
      if (l < 1e-12) {
        // (a vertex no face turned: up)
        [x, y, z] = [position[k], position[k + 1], position[k + 2]];
        l = Math.hypot(x, y, z) || 1;
      }
      normal[k] = Math.round((127 * x) / l);
      normal[k + 1] = Math.round((127 * y) / l);
      normal[k + 2] = Math.round((127 * z) / l);
    }
    return { position, normal, part: this.part.view().slice(), paddy: this.paddy.view().slice(), floor: this.floor.view().slice(), index };
  }
}

const NONE = [0, 0, 0, 0];

export function buildTerraces(input: BuildInput): BuildOutput {
  const P = input.params;
  const stats: Record<string, number> = {};
  let lap = performance.now();
  const started = lap;
  const time = (name: string): void => {
    const now = performance.now();
    stats[`ms${name}`] = Math.round(now - lap);
    lap = now;
  };
  const seed = input.seed;
  const field = new PlanetField({ ...input.field, seed });
  const fp = field.p;
  const grid = new SphereGrid(fp.radius, P.cell);
  const R = grid.R;
  const { V, m } = grid;
  const D = grid.dir;
  const step = fp.step;
  const tmp: number[] = [0, 0, 0];
  const g3 = new Float64Array(3);

  // the samples: the terrace field, the height and the smoothed slope, each worked out at its point
  const T = new Float64Array(V);
  const H = new Float32Array(V);
  const S = new Float32Array(V);
  let lo = Infinity;
  let hi = -Infinity;
  const one = new Float64Array(3);
  for (let v = 0; v < V; v++) {
    field.sample(D[3 * v], D[3 * v + 1], D[3 * v + 2], one);
    H[v] = one[0];
    T[v] = one[1];
    S[v] = one[2];
    lo = Math.min(lo, T[v]);
    hi = Math.max(hi, T[v]);
  }
  const levels = field.levels(lo, hi);
  const L = levels.length;
  const floorOf = (k: number): number => 0.5 * (levels[Math.max(0, Math.min(k, L - 2))] + levels[Math.max(1, Math.min(k + 1, L - 1))]);
  const terraceF: Field = (x, y, z) => field.terrace(x, y, z);
  stats.vertices = V;
  time('Samples');

  // the classes: woods where steep, flats where flat, terraces between; a patch of either smaller than its least is
  // terraced like the land round it (no drum of plots on a hilltop), as a hole in either smaller than that is
  // filled (its rings traced on the slope, the vertices inside turned)
  const steepF: Field = (x, y, z) => field.slope(x, y, z) - fp.steep;
  const flatF: Field = (x, y, z) => fp.flat - field.slope(x, y, z);
  const steepV = (v: number): number => S[v] - fp.steep;
  const flatV = (v: number): number => fp.flat - S[v];
  const woodsIdx = new Int32Array(V);
  const flatIdx = new Int32Array(V);
  for (let v = 0; v < V; v++) {
    woodsIdx[v] = steepV(v) >= 0 ? 1 : 0;
    flatIdx[v] = flatV(v) >= 0 ? 1 : 0;
  }
  const turned: Array<{ c: number[]; F: Float64Array; xy: number[]; box: number[]; value: number; woods: boolean; area: number }> = [];
  const tidy = (idx: Int32Array, slot: number, f: Field, fv: (v: number) => number, least: number, woods: boolean): number => {
    const small = grid
      .trace(idx, (u, w) => grid.crossing(slot, u, w, f, fv))
      .filter((c) => c.closed && Math.abs(c.area) < least)
      .sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    for (const r of small) {
      const value = r.area > 0 ? 0 : 1;
      for (const v of insideRing(grid, r.pts)) idx[v] = value;
      const c = grid.centre(r.pts);
      const F = tangentFrame(c[0], c[1], c[2], new Float64Array(6));
      const xy: number[] = [];
      const box = [Infinity, -Infinity, Infinity, -Infinity];
      for (const id of r.pts) {
        grid.point(id, tmp);
        const px = tmp[0] * F[0] + tmp[1] * F[1] + tmp[2] * F[2];
        const py = tmp[0] * F[3] + tmp[1] * F[4] + tmp[2] * F[5];
        xy.push(px, py);
        box[0] = Math.min(box[0], px);
        box[1] = Math.max(box[1], px);
        box[2] = Math.min(box[2], py);
        box[3] = Math.max(box[3], py);
      }
      turned.push({ c, F, xy, box, value, woods, area: Math.abs(r.area) });
    }
    return small.length;
  };
  stats.woodsTidied = tidy(woodsIdx, SLOT.woods, steepF, steepV, P.leastWoods, true);
  stats.flatsTidied = tidy(flatIdx, SLOT.flat, flatF, flatV, P.leastFlats, false);
  turned.sort((a, b) => b.area - a.area);
  for (let v = 0; v < V; v++) if (woodsIdx[v]) flatIdx[v] = 0;
  /** A direction's class: 0 the woods, 1 the flats, 2 the terraces (the largest turned ring round it has the last word). */
  const classAt = (x: number, y: number, z: number): number => {
    const s = field.slope(x, y, z);
    let woods = s - fp.steep >= 0;
    let flat = fp.flat - s >= 0;
    let w = false;
    let f = false;
    for (const r of turned) {
      if ((r.woods ? w : f) || x * r.c[0] + y * r.c[1] + z * r.c[2] < 0.9) continue;
      const px = x * r.F[0] + y * r.F[1] + z * r.F[2];
      const py = x * r.F[3] + y * r.F[4] + z * r.F[5];
      if (px < r.box[0] || px > r.box[1] || py < r.box[2] || py > r.box[3] || !inRing(r.xy, px, py)) continue;
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
  const terraced = (x: number, y: number, z: number): boolean => classAt(x, y, z) === 2;
  time('Classes');

  // the bands, unshifted; the cuts along their banks; the bands as the cuts shift them. (A vertex's levels' wander
  // and shift are kept for the four levels round its own, all the bands' outlines through it can need.)
  const near = new Int32Array(V);
  for (let v = 0; v < V; v++) {
    let a = 0;
    let b = L;
    while (a < b) {
      const c = (a + b) >> 1;
      if (levels[c] > T[v]) b = c;
      else a = c + 1;
    }
    near[v] = a - 2;
  }
  const kept = (cache: Float32Array, k: number, v: number, make: () => number): number => {
    const i = k - near[v];
    if (i < 0 || i > 3) return make();
    let x = cache[4 * v + i];
    if (Number.isNaN(x)) {
      x = make();
      cache[4 * v + i] = x;
    }
    return x;
  };
  const wanders = new Float32Array(4 * V).fill(Number.NaN);
  const G0 = (k: number, x: number, y: number, z: number, t: number): number => t - levels[k] - field.wander(k, x, y, z);
  const G0v = (k: number, v: number): number => T[v] - levels[k] - kept(wanders, k, v, () => field.wander(k, D[3 * v], D[3 * v + 1], D[3 * v + 2]));
  const base = new Bands(grid, levels, G0, G0v, T, terraceF, SLOT.base);
  base.trace();
  time('Base');
  const cuts = new Cuts(grid, field, base.chains, base, P.cut, seed, terraced, P.minArea);
  time('Cuts');
  const reach = 1.05 * P.cut.shift * step;
  const shifts = new Float32Array(4 * V).fill(Number.NaN);
  const G = (k: number, x: number, y: number, z: number, t: number): number => {
    const g0 = G0(k, x, y, z, t);
    return Math.abs(g0) < reach ? g0 + step * cuts.shift(k, x, y, z) : g0;
  };
  const Gv = (k: number, v: number): number => {
    const g0 = G0v(k, v);
    return Math.abs(g0) < reach ? g0 + step * kept(shifts, k, v, () => cuts.shift(k, D[3 * v], D[3 * v + 1], D[3 * v + 2])) : g0;
  };
  const bands = new Bands(grid, levels, G, Gv, T, terraceF, SLOT.bands);
  bands.trace();
  bands.levelSmall(P.minArea);
  const cutLines = cuts.lines(bands, terraced);
  time('Bands');
  stats.levels = L;
  stats.cuts = cuts.cuts.length;
  stats.cutLines = cutLines.length;
  stats.levelled = bands.dropped;

  // the flats' fields: the strips are the bands themselves (along the lie of the land, a step apart); a turn of the
  // planet's axes crosses them every field's length, wandering a little (the second coordinate); and the tracks,
  // where a slow noise passes zero (its sign the third coordinate: −1 one side, 0 the other); the first coordinate
  // is one cell everywhere
  const pl = P.plot;
  const turn: number[] = [];
  {
    let h = hash32((seed ^ 0x9107) >>> 0);
    const r = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
    const a = r() * Math.PI * 2;
    const b = Math.acos(2 * r() - 1);
    const c = r() * Math.PI * 2;
    const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
    turn.push(ca * cc - sa * cb * sc, -ca * sc - sa * cb * cc, sa * sb, sa * cc + ca * cb * sc, -sa * sc + ca * cb * cc, -ca * sb, sb * sc, sb * cc, cb);
  }
  const warpK = R / 60;
  const trackK = R / pl.trackScale;
  const latticeAt = (c: number, x: number, y: number, z: number): number => {
    if (c === 0) return 0.5;
    if (c === 2) return 0.5 * gnoise(x * trackK - 11.3, y * trackK + 27.1, z * trackK + 5.9, (seed + 0x7a75) >>> 0);
    const q = (turn[3] * x + turn[4] * y + turn[5] * z) * R;
    return q / pl.length + pl.warp * gnoise(x * warpK + 31.7, y * warpK - 12.9, z * warpK + 7.3, (seed + 0x9109) >>> 0);
  };
  const lattice = new Float32Array(3 * V).fill(Number.NaN);
  const lat = (c: number, v: number): number => {
    let q = lattice[3 * v + c];
    if (Number.isNaN(q)) {
      q = latticeAt(c, D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      lattice[3 * v + c] = q;
    }
    return q;
  };
  const plotKey = (i: number, j: number, k: number): number => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  const plotOf = (v: number): number => plotKey(Math.floor(lat(0, v)), Math.floor(lat(1, v)), Math.floor(lat(2, v)));

  // the sides pieces are cut by (one per field and level, sharing their crossings with the outlines)
  const inWoods = new Side(grid, SLOT.woods, steepF, (v) => woodsIdx[v] === 1, true, steepV);
  const outWoods = new Side(grid, SLOT.woods, steepF, (v) => woodsIdx[v] === 1, false, steepV);
  const inFlats = new Side(grid, SLOT.flat, flatF, (v) => flatIdx[v] === 1, true, flatV);
  const outFlats = new Side(grid, SLOT.flat, flatF, (v) => flatIdx[v] === 1, false, flatV);
  const sides = new Map<number, Side>();
  const memoSide = (key: number, make: () => Side): Side => {
    let s = sides.get(key);
    if (!s) {
      s = make();
      sides.set(key, s);
    }
    return s;
  };
  const bandFrom = (k: number): Side =>
    memoSide(2 * k, () => {
      const [f, fv] = bands.H(k);
      return new Side(grid, SLOT.bands + k, f, (v) => bands.band[v] >= k, true, fv);
    });
  const bandTo = (k: number): Side =>
    memoSide(2 * k + 1, () => {
      const [f, fv] = bands.H(k);
      return new Side(grid, SLOT.bands + k, f, (v) => bands.band[v] >= k, false, fv);
    });
  const latticeSide = (c: number, i: number, above: boolean): Side =>
    memoSide(1e7 * (c + 1) + 2 * (i + 50000) + (above ? 0 : 1), () => new Side(grid, [SLOT.u, SLOT.v, SLOT.w][c] + i + 50000, (x, y, z) => latticeAt(c, x, y, z) - i, (v) => Math.floor(lat(c, v)) >= i, above, (v) => lat(c, v) - i));

  // the cuts' lines part the paddies: the triangles' edges each crosses, per band
  const barrier = new Map<number, Set<number>>();
  const cutSquare = new Map<number, number>();
  const cutPts: Float64Array[] = [];
  const frame = new Float64Array(6);
  const sq = { face: 0, ci: 0, cj: 0 };
  const squareIndex = (f: number, ci: number, cj: number): number => (f * m + cj) * m + ci;
  const past = (p: number[], q: number[], d: number): number[] => {
    // (q to p, carried on d m past p)
    const ex = p[0] - q[0];
    const ey = p[1] - q[1];
    const ez = p[2] - q[2];
    const l = Math.hypot(ex, ey, ez) || 1;
    const x = p[0] + (ex / l) * (d / R);
    const y = p[1] + (ey / l) * (d / R);
    const z = p[2] + (ez / l) * (d / R);
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n];
  };
  cutLines.forEach((line, c) => {
    const p = line.pts;
    const at = (i: number): number[] => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const count = p.length / 3;
    // (a little past both banks, so it parts the band's floor right across)
    const pts = [...past(at(0), at(1), 0.5), ...p, ...past(at(count - 1), at(count - 2), 0.3)];
    // (in pieces no longer than a fifth of a meter, each within a square or two)
    const fine: number[] = [];
    for (let i = 0; i + 3 < pts.length; i += 3) {
      const len = R * Math.hypot(pts[i + 3] - pts[i], pts[i + 4] - pts[i + 1], pts[i + 5] - pts[i + 2]);
      const parts = Math.max(1, Math.ceil(len / 0.2));
      for (let s = 0; s < parts; s++) {
        const t = s / parts;
        fine.push(pts[i] + (pts[i + 3] - pts[i]) * t, pts[i + 1] + (pts[i + 4] - pts[i + 1]) * t, pts[i + 2] + (pts[i + 5] - pts[i + 2]) * t);
      }
    }
    fine.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    cutPts.push(Float64Array.from(fine));
    const k = line.band;
    let set = barrier.get(k);
    if (!set) {
      set = new Set();
      barrier.set(k, set);
    }
    for (let s = 0; s + 3 < fine.length; s += 3) {
      const [ax, ay, az, bx, by, bz] = [fine[s], fine[s + 1], fine[s + 2], fine[s + 3], fine[s + 4], fine[s + 5]];
      const F = tangentFrame(ax, ay, az, frame);
      const pr = (x: number, y: number, z: number): [number, number] => [x * F[0] + y * F[1] + z * F[2], x * F[3] + y * F[4] + z * F[5]];
      const [Ax, Ay] = pr(ax, ay, az);
      const [Bx, By] = pr(bx, by, bz);
      const squares = new Set<number>();
      for (const [x, y, z] of [
        [ax, ay, az],
        [bx, by, bz],
      ]) {
        grid.square(x, y, z, sq);
        squares.add(squareIndex(sq.face, sq.ci, sq.cj));
      }
      for (const si of squares) {
        const f = Math.floor(si / (m * m));
        const cj = Math.floor((si - f * m * m) / m);
        const ci = si - f * m * m - cj * m;
        const t = grid.triangles(f, ci, cj);
        const [a, b, e, c4, d] = [t[0], t[3], t[2], t[6], t[9]];
        for (const [u, w] of [
          [a, b],
          [b, c4],
          [c4, d],
          [d, a],
          [a, e],
          [b, e],
          [c4, e],
          [d, e],
        ]) {
          const [Ux, Uy] = pr(D[3 * u], D[3 * u + 1], D[3 * u + 2]);
          const [Wx, Wy] = pr(D[3 * w], D[3 * w + 1], D[3 * w + 2]);
          if (segHits(Ax, Ay, Bx, By, Ux, Uy, Wx, Wy)) {
            set.add(grid.key(u, w));
            if (!cutSquare.has(si * L + k)) cutSquare.set(si * L + k, c);
          }
        }
      }
    }
  });
  /** A cut's field: the signed distance (m) to its line, > 0 on its left. */
  const cutDistance = (c: number, x: number, y: number, z: number): number => {
    const pts = cutPts[c];
    let best = Infinity;
    let sign = 1;
    for (let s = 0; s + 3 < pts.length; s += 3) {
      const ex = pts[s + 3] - pts[s];
      const ey = pts[s + 4] - pts[s + 1];
      const ez = pts[s + 5] - pts[s + 2];
      const ll = ex * ex + ey * ey + ez * ez;
      const t = ll > 0 ? Math.min(Math.max(((x - pts[s]) * ex + (y - pts[s + 1]) * ey + (z - pts[s + 2]) * ez) / ll, 0), 1) : 0;
      const d = Math.hypot(pts[s] + ex * t - x, pts[s + 1] + ey * t - y, pts[s + 2] + ez * t - z);
      if (d < best) {
        best = d;
        // (left of the line, seen from outside: up · (along × to the point) > 0)
        const rx = x - pts[s];
        const ry = y - pts[s + 1];
        const rz = z - pts[s + 2];
        sign = x * (ey * rz - ez * ry) + y * (ez * rx - ex * rz) + z * (ex * ry - ey * rx) >= 0 ? 1 : -1;
      }
    }
    return sign * best * R;
  };
  const cutSides = new Map<number, [Side, Side]>();
  const cutSide = (c: number): [Side, Side] => {
    let s = cutSides.get(c);
    if (!s) {
      const f: Field = (x, y, z) => cutDistance(c, x, y, z);
      const fv = (v: number): number => cutDistance(c, D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      s = [new Side(grid, SLOT.cut + c, f, (v) => fv(v) >= 0, true, fv), new Side(grid, SLOT.cut + c, f, (v) => fv(v) >= 0, false, fv)];
      cutSides.set(c, s);
    }
    return s;
  };
  time('Barriers');

  // the pieces: each triangle cut into the woods, the flats' plots and the terraces' bands
  const chunkOf = (f: number, ci: number, cj: number): number => f * CHUNKS * CHUNKS + Math.floor((cj * CHUNKS) / m) * CHUNKS + Math.floor((ci * CHUNKS) / m);
  const chunkAt = (x: number, y: number, z: number): number => {
    grid.square(x, y, z, sq);
    return chunkOf(sq.face, sq.ci, sq.cj);
  };
  // the woods' triangles: points, chunk
  const woodsTri = new Grow(new Int32Array(1 << 16));
  // the fields' triangles: points, field, chunk; per corner its share across its band and meters from its step
  const plotTri = new Grow(new Int32Array(1 << 16));
  const plotRow = new Grow(new Float32Array(1 << 16));
  // (a field: its cell of the lattice and its band, key · L + band)
  const plotIds = new Map<number, number>();
  // the paddies' pieces: per triangle slot (4 a square) its first piece, first band and count; per piece whether it
  // holds any of the floor, whether a cut parts it, its band; the pieces' triangles (points, piece, chunk) and per
  // corner its share across its band and meters from its bank
  const slots = 4 * 6 * m * m;
  const slotFirst = new Int32Array(slots).fill(-1);
  const slotK0 = new Int32Array(slots);
  const slotCount = new Uint8Array(slots);
  const pieceValid = new Grow(new Uint8Array(1 << 16));
  const pieceParted = new Grow(new Uint8Array(1 << 16));
  const pieceBand = new Grow(new Int32Array(1 << 16));
  const paddyTri = new Grow(new Int32Array(1 << 18));
  const paddyRow = new Grow(new Float32Array(1 << 18));
  // the halves of parted pieces: points, piece, cut, side, chunk; their rows
  const halfTri = new Grow(new Int32Array(1 << 12));
  const halfRow = new Grow(new Float32Array(1 << 12));
  const pieceOf = (slot: number, k: number): number => {
    const first = slotFirst[slot];
    if (first < 0) return -1;
    const i = k - slotK0[slot];
    if (i < 0 || i >= slotCount[slot]) return -1;
    return pieceValid.a[first + i] ? first + i : -1;
  };
  const newPiece = (k: number): number => {
    pieceValid.push(0);
    pieceParted.push(0);
    pieceBand.push(k);
    return pieceValid.n - 1;
  };
  /** A floor's corner's share across its band (0 its bank … 1 the next) and how far from its bank (m). */
  const rowsOf = (c: Corner, k: number, out: Grow<Float32Array>): void => {
    let gk: number;
    let gk1: number;
    let s: number;
    if (c.v >= 0) {
      gk = bands.gv(k, c.v);
      gk1 = bands.gv(k + 1, c.v);
      s = S[c.v];
    } else {
      const t = field.terrace(c.x, c.y, c.z);
      gk = bands.g(k, c.x, c.y, c.z, t);
      gk1 = bands.g(k + 1, c.x, c.y, c.z, t);
      s = field.slope(c.x, c.y, c.z);
    }
    out.push(Math.min(Math.max(gk / Math.max(gk - gk1, 1e-6), 0), 1));
    out.push(Math.max(gk, 0) / Math.max(s, 0.02));
  };
  const fan = (c: Corner[], emit: (a: Corner, b: Corner, d: Corner) => void): void => {
    for (let i = 1; i + 1 < c.length; i++) emit(c[0], c[i], c[i + 1]);
  };
  const corners: number[] = [0, 0, 0, 0];
  const qOf = (f: number): { bottom: number; right: number; top: number; left: number } => (grid.flip[f] ? { left: 0, top: 1, right: 2, bottom: 3 } : { bottom: 0, right: 1, top: 2, left: 3 });
  for (let f = 0; f < 6; f++) {
    for (let cj = 0; cj < m; cj++) {
      for (let ci = 0; ci < m; ci++) {
        const t = Int32Array.from(grid.triangles(f, ci, cj));
        const si = squareIndex(f, ci, cj);
        const chunk = chunkOf(f, ci, cj);
        corners[0] = t[0];
        corners[1] = t[3];
        corners[2] = t[6];
        corners[3] = t[9];
        const five = [t[0], t[3], t[6], t[9], t[2]];
        // (whole squares: the woods, a plot, a band with no cut through it)
        if (five.every((v) => woodsIdx[v])) {
          for (const [a, b, c] of [
            [0, 1, 2],
            [0, 2, 3],
          ]) {
            woodsTri.push(corners[a]);
            woodsTri.push(corners[b]);
            woodsTri.push(corners[c]);
            woodsTri.push(chunk);
          }
          continue;
        }
        if (five.every((v) => !woodsIdx[v] && flatIdx[v]) && five.every((v) => plotOf(v) === plotOf(five[0]) && bands.band[v] === bands.band[five[0]])) {
          const plot = plotIndex(plotOf(five[0]) * L + bands.band[five[0]]);
          for (const [a, b, c] of [
            [0, 1, 2],
            [0, 2, 3],
          ]) {
            for (const k of [a, b, c]) {
              plotTri.push(corners[k]);
              rowsOf(vertexCorner(grid, corners[k]), bands.band[five[0]], plotRow);
            }
            plotTri.push(plot);
            plotTri.push(chunk);
          }
          continue;
        }
        const k0 = bands.band[five[0]];
        if (five.every((v) => !woodsIdx[v] && !flatIdx[v] && bands.band[v] === k0) && !cutSquare.has(si * L + k0)) {
          const piece = newPiece(k0);
          pieceValid.a[piece] = 1;
          for (let q = 0; q < 4; q++) {
            slotFirst[4 * si + q] = piece;
            slotK0[4 * si + q] = k0;
            slotCount[4 * si + q] = 1;
          }
          for (const [a, b, c] of [
            [0, 1, 2],
            [0, 2, 3],
          ]) {
            for (const k of [a, b, c]) {
              paddyTri.push(corners[k]);
              rowsOf(vertexCorner(grid, corners[k]), k0, paddyRow);
            }
            paddyTri.push(piece);
            paddyTri.push(chunk);
          }
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const tri: Corner[] = [vertexCorner(grid, t[3 * q]), vertexCorner(grid, t[3 * q + 1]), vertexCorner(grid, t[3 * q + 2])];
          const w = clip(tri, inWoods);
          fan(w, (a, b, c) => {
            woodsTri.push(a.id);
            woodsTri.push(b.id);
            woodsTri.push(c.id);
            woodsTri.push(chunk);
          });
          const rest = clip(tri, outWoods);
          if (rest.length < 3) continue;
          const fl = clip(rest, inFlats);
          if (fl.length >= 3) {
            const vs = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
            const lo3 = [0, 1, 2].map((c) => Math.min(...vs.map((v) => Math.floor(lat(c, v)))));
            const hi3 = [0, 1, 2].map((c) => Math.max(...vs.map((v) => Math.floor(lat(c, v)))));
            for (let i = lo3[0]; i <= hi3[0]; i++) {
              for (let j = lo3[1]; j <= hi3[1]; j++) {
                for (let k = lo3[2]; k <= hi3[2]; k++) {
                  let pc = fl;
                  pc = clip(pc, latticeSide(0, i, true));
                  pc = clip(pc, latticeSide(0, i + 1, false));
                  pc = clip(pc, latticeSide(1, j, true));
                  pc = clip(pc, latticeSide(1, j + 1, false));
                  pc = clip(pc, latticeSide(2, k, true));
                  pc = clip(pc, latticeSide(2, k + 1, false));
                  if (pc.length < 3) continue;
                  // (each field cut by the bands, each part of it at its own band's level: a field is never a step
                  // off its ground)
                  const fb0 = Math.min(...vs.map((v) => bands.band[v]));
                  const fb1 = Math.max(...vs.map((v) => bands.band[v]));
                  for (let kb = fb0; kb <= fb1; kb++) {
                    const pb = fb0 === fb1 ? pc : clip(clip(pc, bandFrom(kb)), bandTo(kb + 1));
                    if (pb.length < 3) continue;
                    const plot = plotIndex(plotKey(i, j, k) * L + kb);
                    fan(pb, (a, b, c) => {
                      for (const p of [a, b, c]) {
                        plotTri.push(p.id);
                        rowsOf(p, kb, plotRow);
                      }
                      plotTri.push(plot);
                      plotTri.push(chunk);
                    });
                  }
                }
              }
            }
          }
          const r = clip(rest, outFlats);
          if (r.length < 3) continue;
          const vs = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
          const b0 = Math.min(...vs.map((v) => bands.band[v]));
          const b1 = Math.max(...vs.map((v) => bands.band[v]));
          const slot = 4 * si + q;
          slotK0[slot] = b0;
          slotCount[slot] = Math.min(b1 - b0 + 1, 255);
          slotFirst[slot] = pieceValid.n;
          for (let k = b0; k <= b1; k++) newPiece(k);
          for (let k = b0; k <= b1; k++) {
            const pc = clip(clip(r, bandFrom(k)), bandTo(k + 1));
            if (pc.length < 3) continue;
            const id = slotFirst[slot] + (k - b0);
            pieceValid.a[id] = 1;
            fan(pc, (a, b, c) => {
              for (const p of [a, b, c]) {
                paddyTri.push(p.id);
                rowsOf(p, k, paddyRow);
              }
              paddyTri.push(id);
              paddyTri.push(chunk);
            });
            // (a cut through it: the halves either side drawn each in its own paddy's look)
            const cut = cutSquare.get(si * L + k);
            if (cut === undefined) continue;
            const [left, right] = cutSide(cut);
            for (const [side, sign] of [
              [left, 1],
              [right, -1],
            ] as const) {
              const half = clip(pc, side);
              if (half.length < 3) continue;
              pieceParted.a[id] = 1;
              fan(half, (a, b, c) => {
                for (const p of [a, b, c]) {
                  halfTri.push(p.id);
                  rowsOf(p, k, halfRow);
                }
                halfTri.push(id);
                halfTri.push(cut);
                halfTri.push(sign);
                halfTri.push(chunk);
              });
            }
          }
        }
      }
    }
  }
  stats.pieces = pieceValid.n;
  time('Pieces');

  function plotIndex(key: number): number {
    let i = plotIds.get(key);
    if (i === undefined) {
      i = plotIds.size;
      plotIds.set(key, i);
    }
    return i;
  }
  // the paddies: a band's pieces joined across every edge no cut parts
  const parent = new Int32Array(pieceValid.n);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (sA: number, sB: number, u: number, w: number): void => {
    const lo = Math.min(bands.band[u], bands.band[w]);
    const hi = Math.max(bands.band[u], bands.band[w]);
    const key = grid.key(u, w);
    for (let k = lo; k <= hi; k++) {
      const a = pieceOf(sA, k);
      const b = pieceOf(sB, k);
      if (a < 0 || b < 0 || barrier.get(k)?.has(key)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  };
  const border = new Map<number, number>();
  for (let f = 0; f < 6; f++) {
    const Q = qOf(f);
    for (let cj = 0; cj < m; cj++) {
      for (let ci = 0; ci < m; ci++) {
        const t = grid.triangles(f, ci, cj);
        const s = 4 * squareIndex(f, ci, cj);
        const spokes = [t[1], t[4], t[7], t[10]];
        const e = t[2];
        for (let q = 0; q < 4; q++) join(s + q, s + ((q + 1) % 4), spokes[q], e);
        const a = grid.sample(f, ci, cj);
        const b = grid.sample(f, ci + 1, cj);
        const c = grid.sample(f, ci + 1, cj + 1);
        const d = grid.sample(f, ci, cj + 1);
        if (ci + 1 < m) join(s + Q.right, 4 * squareIndex(f, ci + 1, cj) + Q.left, b, c);
        if (cj + 1 < m) join(s + Q.top, 4 * squareIndex(f, ci, cj + 1) + Q.bottom, d, c);
        // (across the faces' edges: the squares either side found by their shared edge)
        const outer: Array<[number, number, number]> = [];
        if (ci === 0) outer.push([Q.left, a, d]);
        if (ci === m - 1) outer.push([Q.right, b, c]);
        if (cj === 0) outer.push([Q.bottom, a, b]);
        if (cj === m - 1) outer.push([Q.top, d, c]);
        for (const [q, u, w] of outer) {
          const key = grid.key(u, w);
          const other = border.get(key);
          if (other === undefined) border.set(key, s + q);
          else join(other, s + q, u, w);
        }
      }
    }
  }
  // each paddy's look: from a slow noise at its middle (so neighbours, across banks and cuts alike, mostly share
  // theirs and the looks change by stretches of hillside, as farmed), now and then one of its own
  const middle = new Float64Array(4 * pieceValid.n);
  const A: number[] = [0, 0, 0];
  const B: number[] = [0, 0, 0];
  const C: number[] = [0, 0, 0];
  for (let i = 0; i < paddyTri.n; i += 5) {
    const r = find(paddyTri.a[i + 3]);
    grid.point(paddyTri.a[i], A);
    grid.point(paddyTri.a[i + 1], B);
    grid.point(paddyTri.a[i + 2], C);
    const area = triArea(A, B, C);
    middle[4 * r] += area;
    middle[4 * r + 1] += (area * (A[0] + B[0] + C[0])) / 3;
    middle[4 * r + 2] += (area * (A[1] + B[1] + C[1])) / 3;
    middle[4 * r + 3] += (area * (A[2] + B[2] + C[2])) / 3;
  }
  const lookK = [R / 26, R / 11];
  const crops = new Map<number, number[]>();
  let paddies = 0;
  const cropOf = (u: number, h: number): number[] =>
    // (variant, place in the season, its plants' and its water's own share; fallow now and then)
    [unit(hash32((h ^ 0x51) >>> 0)), delayOf(u), unit(hash32((h ^ 0x63) >>> 0)), unit(hash32((h ^ 0x25) >>> 0)), unit(hash32((h ^ 0x85) >>> 0)) < 0.05 ? 1 : 0];
  const paddyCrop = (piece: number): number[] => {
    const r = find(piece);
    let c = crops.get(r);
    if (!c) {
      const x = middle[4 * r + 1];
      const y = middle[4 * r + 2];
      const z = middle[4 * r + 3];
      const l = Math.hypot(x, y, z) || 1;
      const [px, py, pz] = [x / l, y / l, z / l];
      // (two octaves, spread to about even shares: the noise's values gather round its middle)
      const v = gnoise(px * lookK[0], py * lookK[0], pz * lookK[0], (seed + 0x10c) >>> 0) + 0.45 * gnoise(px * lookK[1] + 41.3, py * lookK[1] - 7.7, pz * lookK[1] + 3.1, (seed + 0x10c) >>> 0);
      const h = hash32((Math.imul(r, 2654435761) ^ (seed + 79)) >>> 0);
      const u = unit(h) < 0.15 ? unit(hash32(h + 77)) : 0.5 + 0.5 * Math.tanh(v / 0.3);
      c = cropOf(Math.min(Math.max(u, 0), 0.9999), h);
      crops.set(r, c);
      paddies++;
    }
    return c;
  };
  // the paddy either side of each cut (found a little off its middle, either side)
  const sideOf = new Map<number, number>();
  cutLines.forEach((line, c) => {
    const p = line.pts;
    const count = p.length / 3;
    for (const sign of [1, -1]) {
      for (const fr of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const i = Math.min(Math.max(Math.round(fr * count), 0), count - 2);
        const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
        const [qx, qy, qz] = moveTo(x, y, z, ...leftOf(x, y, z, p[3 * i + 3] - x, p[3 * i + 4] - y, p[3 * i + 5] - z), sign * 0.45);
        const piece = pieceOf(grid.locate(qx, qy, qz), line.band);
        if (piece >= 0 && !pieceParted.a[piece]) {
          sideOf.set(c * 2 + (sign > 0 ? 0 : 1), piece);
          break;
        }
      }
    }
  });
  time('Paddies');

  // the fields' floors: level, each at its band's level
  const plotFloor = new Float64Array(plotIds.size);
  for (const [key, i] of plotIds) plotFloor[i] = floorOf(((key % L) + L) % L);
  const plotCrop: number[][] = [];
  // (the fields grown, each its own green: yellow-green to deep, as in Kai's aerial; a field cut by a band's step keeps
  // one green either side of it)
  for (const [key, i] of plotIds) {
    const cell = Math.floor(key / L);
    plotCrop[i] = cropOf(0.56 + 0.44 * unit(hash32((cell ^ (seed + 78)) >>> 0)), hash32((cell + seed) >>> 0));
  }

  // the floors and the woods' ground, chunk by chunk
  const chunks = Array.from({ length: 6 * CHUNKS * CHUNKS }, () => new Chunk());
  const floorVertex = (c: Chunk, id: number, owner: number, h: number, crop: number[], across: number, rows: number): number => {
    const key = id * 4194304 + owner;
    const known = c.shared.get(key);
    if (known !== undefined) return known;
    grid.point(id, tmp);
    const s = R + h;
    const v = c.vertex(tmp[0] * s, tmp[1] * s, tmp[2] * s, PART.floor, crop, h, crop[4], across, rows, tmp);
    c.shared.set(key, v);
    return v;
  };
  for (let i = 0; i < paddyTri.n; i += 5) {
    const piece = paddyTri.a[i + 3];
    if (pieceParted.a[piece]) continue;
    const c = chunks[paddyTri.a[i + 4]];
    const crop = paddyCrop(piece);
    const h = floorOf(pieceBand.a[piece]);
    const owner = find(piece);
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, paddyTri.a[i + k], owner, h, crop, paddyRow.a[(i / 5) * 6 + 2 * k], paddyRow.a[(i / 5) * 6 + 2 * k + 1]));
  }
  for (let i = 0; i < halfTri.n; i += 7) {
    const piece = halfTri.a[i + 3];
    const cut = halfTri.a[i + 4];
    const sign = halfTri.a[i + 5];
    const c = chunks[halfTri.a[i + 6]];
    const owner = find(sideOf.get(cut * 2 + (sign > 0 ? 0 : 1)) ?? piece);
    const crop = paddyCrop(owner);
    const h = floorOf(pieceBand.a[piece]);
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, halfTri.a[i + k], owner, h, crop, halfRow.a[(i / 7) * 6 + 2 * k], halfRow.a[(i / 7) * 6 + 2 * k + 1]));
  }
  const PLOTS = 4194304 - 65536;
  for (let i = 0; i < plotTri.n; i += 5) {
    const plot = plotTri.a[i + 3];
    const c = chunks[plotTri.a[i + 4]];
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, plotTri.a[i + k], PLOTS + plot, plotFloor[plot], plotCrop[plot], plotRow.a[(i / 5) * 6 + 2 * k], plotRow.a[(i / 5) * 6 + 2 * k + 1]));
  }
  for (const c of chunks) c.shared.clear();
  // (the woods' ground: the hills' own height at each point, its normal from their gradient there)
  const nrm: number[] = [0, 0, 0];
  for (let i = 0; i < woodsTri.n; i += 4) {
    const c = chunks[woodsTri.a[i + 3]];
    for (let k = 0; k < 3; k++) {
      const id = woodsTri.a[i + k];
      const key = id * 4194304 + 4194303;
      let v = c.shared.get(key);
      if (v === undefined) {
        grid.point(id, tmp);
        const h = field.height(tmp[0], tmp[1], tmp[2], g3);
        nrm[0] = tmp[0] - g3[0];
        nrm[1] = tmp[1] - g3[1];
        nrm[2] = tmp[2] - g3[2];
        const s = R + h;
        v = c.vertex(tmp[0] * s, tmp[1] * s, tmp[2] * s, PART.woods, NONE, h, Math.hypot(g3[0], g3[1], g3[2]), 0, 0, nrm);
        c.shared.set(key, v);
      }
      c.index.push(v);
    }
  }
  for (const c of chunks) c.shared.clear();
  stats.paddies = paddies;
  stats.plots = plotIds.size;

  // the floor a direction stands on: the woods' ground, a plot's floor, a band's
  const surfaceAt = (x: number, y: number, z: number): number => {
    const cls = classAt(x, y, z);
    if (cls === 0) return field.height(x, y, z);
    return floorOf(bands.bandAt(x, y, z));
  };
  /** How steep the terrace field is at a direction (m per m: its own gradient, as the lab reads it). */
  const steepness = (x: number, y: number, z: number): number => {
    field.terrace(x, y, z, g3);
    return Math.max(Math.hypot(g3[0], g3[1], g3[2]), 0.02);
  };
  time('Tops');

  // the banks: along each band's outline, where it is terraced, a dam on the paddy's edge and a riser under it
  const D_ = P.dam;
  const noiseK = R / D_.widthScale;
  const widthAt = (x: number, y: number, z: number): number => Math.max(D_.width + D_.widthVar * gnoise(x * noiseK, y * noiseK, z * noiseK, (seed + 0x5a) >>> 0), 0.06);
  const heightAt = (x: number, y: number, z: number): number => Math.max(D_.height + D_.heightVar * gnoise(x * noiseK + 17.1, y * noiseK - 3.3, z * noiseK + 9.9, (seed + 0x5b) >>> 0), 0.04);
  let banks = 0;
  const candidates: number[] = [];
  const builtNear = new Map<number, number[]>();
  const cellOf = (x: number, y: number, z: number): number => ((Math.floor(x * R * 5) + 2048) * 4096 + (Math.floor(y * R * 5) + 2048)) * 4096 + (Math.floor(z * R * 5) + 2048);
  for (const chain of bands.chains) {
    const k = chain.level;
    if (k < 1 || k + 1 >= L) continue;
    const pts = resample(grid, chain, P.spacing);
    const count = pts.length / 3;
    if (count < 3) continue;
    const at = (i: number): number => (chain.closed ? (i + count) % count : Math.min(Math.max(i, 0), count - 1));
    const N = normals(pts, chain.closed);
    // where it is a bank: its band still there (not pinched out), and terraced (a dam on its edge) or on the flats
    // (a step between two fields, a thin dark bund on its edge)
    const present = new Uint8Array(count);
    const cls = new Int8Array(count);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
      const [qx, qy, qz] = moveTo(x, y, z, N[3 * i], N[3 * i + 1], N[3 * i + 2], 0.04);
      present[i] = bands.bandAt(qx, qy, qz) === k ? 1 : 0;
      cls[i] = classAt(x, y, z);
    }
    const built = new Uint8Array(count);
    for (const style of [2, 1]) {
      const ok = new Uint8Array(count);
      for (let i = 0; i < count; i++) ok[i] = present[i] && cls[i] === style ? 1 : 0;
      // (where it ends at the woods or the other farmed land, a little on into it, within its edge's half-width:
      // its end buried in it)
      {
        const grow = ok.slice();
        const on = Math.max(1, Math.floor(0.22 / P.spacing));
        for (let i = 0; i < count; i++) {
          if (!ok[i]) continue;
          for (const dir of [1, -1]) {
            for (let d = 1; d <= on; d++) {
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
      for (const run of runs(ok, chain.closed)) {
        banks++;
        bank(run.idx, run.closed, style === 1);
        for (const i of run.idx) {
          built[i] = 1;
          const key = cellOf(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
          const list = builtNear.get(key);
          if (list) list.push(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
          else builtNear.set(key, [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]);
        }
      }
    }
    // (checks: a step between two terraced floors with no bank along it, kept to see if another bank covers it)
    for (let i = 0; i < count; i++) {
      if (built[i]) continue;
      const [x, y, z] = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
      const [ix, iy, iz] = moveTo(x, y, z, N[3 * i], N[3 * i + 1], N[3 * i + 2], 0.04);
      const [ox, oy, oz] = moveTo(x, y, z, N[3 * i], N[3 * i + 1], N[3 * i + 2], -0.05);
      if (classAt(ix, iy, iz) === 0 || classAt(ox, oy, oz) === 0) continue;
      const inner = bands.bandAt(ix, iy, iz);
      const outer = bands.bandAt(ox, oy, oz);
      if (inner > outer) candidates.push(x, y, z, k + 0.001 * Math.min(inner - k + 1, 9) + 0.0001 * (present[i] ? 1 : 0));
    }

    /** A bank along the points idx: a dam and a riser (the terraces), or a thin dark bund over a riser (a step on the flats). */
    function bank(idx: number[], closed: boolean, flats: boolean): void {
      // (an open run carried on a little past both its ends, along its own way: its ends overlap whatever they meet)
      const c = idx.length + (closed ? 0 : 2);
      const p = new Float64Array(3 * c);
      const q = new Float64Array(3 * c);
      const u = new Float64Array(3 * c);
      const w = new Float64Array(c);
      const Hd = new Float64Array(c);
      const slope = new Float64Array(c);
      const ring = (i: number): number => (closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
      const o = closed ? 0 : 1;
      for (let i = 0; i < idx.length; i++) {
        for (let d = 0; d < 3; d++) {
          p[3 * (i + o) + d] = pts[3 * idx[i] + d];
          u[3 * (i + o) + d] = N[3 * idx[i] + d];
        }
      }
      if (!closed) {
        for (const [e, f, g] of [
          [0, 1, 2],
          [c - 1, c - 2, c - 3],
        ]) {
          const [x, y, z] = past([p[3 * f], p[3 * f + 1], p[3 * f + 2]], [p[3 * g], p[3 * g + 1], p[3 * g + 2]], OVERLAP);
          p[3 * e] = x;
          p[3 * e + 1] = y;
          p[3 * e + 2] = z;
          for (let d = 0; d < 3; d++) u[3 * e + d] = u[3 * f + d];
        }
      }
      const up = levels[k + 1] - levels[k];
      const down = levels[k] - levels[k - 1];
      const floor = floorOf(k);
      for (let i = 0; i < c; i++) {
        const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
        w[i] = flats ? 0.6 * widthAt(x, y, z) : widthAt(x, y, z);
        Hd[i] = flats ? 0.45 * heightAt(x, y, z) : heightAt(x, y, z);
        slope[i] = steepness(x, y, z);
        w[i] = Math.min(w[i], 0.45 * (up / slope[i]));
        const a = ring(i - 1);
        const b = ring(i + 1);
        if (a !== i && b !== i) {
          // (its curvature on the plane here: bending toward its left, the dam's side, it must fit inside the bend)
          const ax = (x - p[3 * a]) * R;
          const ay = (y - p[3 * a + 1]) * R;
          const az = (z - p[3 * a + 2]) * R;
          const bx = (p[3 * b] - x) * R;
          const by = (p[3 * b + 1] - y) * R;
          const bz = (p[3 * b + 2] - z) * R;
          const cross = x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx);
          const kappa = (2 * cross) / Math.max(Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) * Math.hypot(ax + bx, ay + by, az + bz), 1e-12);
          if (kappa > 0) w[i] = Math.min(w[i], 0.7 / kappa);
        }
      }
      soften(w, closed);
      const place = (i: number): void => {
        const [x, y, z] = moveTo(p[3 * i], p[3 * i + 1], p[3 * i + 2], u[3 * i], u[3 * i + 1], u[3 * i + 2], w[i]);
        q[3 * i] = x;
        q[3 * i + 1] = y;
        q[3 * i + 2] = z;
      };
      // the dam's inner edge: in its own band, still below the next bank, and not over a crest
      for (let i = 0; i < c; i++) {
        for (let tries = 0; tries < 12; tries++) {
          place(i);
          if (bands.Hat(k, q[3 * i], q[3 * i + 1], q[3 * i + 2]) > 0.125 * w[i] * slope[i] && bands.Hat(k + 1, q[3 * i], q[3 * i + 1], q[3 * i + 2]) < -0.1 * up) break;
          w[i] *= 0.7;
        }
      }
      for (let pass = 0; pass < 10; pass++) {
        let folds = 0;
        for (let i = 0; i < (closed ? c : c - 1); i++) {
          const j = ring(i + 1);
          place(i);
          place(j);
          const ex = p[3 * j] - p[3 * i];
          const ey = p[3 * j + 1] - p[3 * i + 1];
          const ez = p[3 * j + 2] - p[3 * i + 2];
          if ((q[3 * j] - q[3 * i]) * ex + (q[3 * j + 1] - q[3 * i + 1]) * ey + (q[3 * j + 2] - q[3 * i + 2]) * ez < 0.2 * (ex * ex + ey * ey + ez * ez)) {
            w[i] *= 0.7;
            w[j] *= 0.7;
            folds++;
          }
        }
        if (folds === 0) break;
      }
      for (let i = 0; i < c; i++) place(i);
      const ch = chunks[chunkAt(p[0], p[1], p[2])];
      // the dam: its profile swept along the bank
      const M = PROFILE.length;
      const d0 = ch.count;
      for (let i = 0; i < c; i++) {
        for (const [s, f] of PROFILE) {
          const x = p[3 * i] + (q[3 * i] - p[3 * i]) * s;
          const y = p[3 * i + 1] + (q[3 * i + 1] - p[3 * i + 1]) * s;
          const z = p[3 * i + 2] + (q[3 * i + 2] - p[3 * i + 2]) * s;
          const l = Math.hypot(x, y, z);
          const h = s === 1 ? floor - UNDER : floor + f * Hd[i];
          ch.vertex((x / l) * (R + h), (y / l) * (R + h), (z / l) * (R + h), flats ? PART.earth : s < 0.7 ? PART.bund : PART.bundSide, NONE, floor, 0, 0, 0);
        }
      }
      const segs = closed ? c : c - 1;
      for (let i = 0; i < segs; i++) {
        const a = d0 + i * M;
        const b = d0 + ring(i + 1) * M;
        for (let j = 0; j + 1 < M; j++) quad(ch, a + j, b + j, b + j + 1, a + j + 1);
      }
      // the riser: from the floor below it (under its water: the lowest beside it nearby, so where the band below
      // pinches out it reaches the next one down without a gap), leaning back, up to the dam's outer edge
      const r0 = ch.count;
      const below = new Float64Array(c);
      for (let i = 0; i < c; i++) {
        // (the band just outside the bank, at the band below at the least: an evened-out point can lie a hair inside
        // its own band, the bend between its crossings)
        const [x, y, z] = moveTo(p[3 * i], p[3 * i + 1], p[3 * i + 2], u[3 * i], u[3 * i + 1], u[3 * i + 2], -0.05);
        below[i] = floorOf(Math.min(bands.bandAt(x, y, z), k - 1));
      }
      for (let i = 0; i < c; i++) {
        const top = floor + PROFILE[0][1] * Hd[i];
        let low = floor;
        for (let d = -2; d <= 2; d++) low = Math.min(low, below[ring(i + d)]);
        const foot = low - UNDER;
        let lean = Math.min(D_.batter * (top - foot), 0.4 * (down / slope[i]));
        if (!closed) lean *= smoothstep(0, 1, Math.min(i, c - 1 - i) * P.spacing);
        const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
        ch.vertex(x * (R + top), y * (R + top), z * (R + top), PART.riser, NONE, floor, 0, 0, 0);
        const [bx, by, bz] = moveTo(x, y, z, u[3 * i], u[3 * i + 1], u[3 * i + 2], -lean);
        ch.vertex(bx * (R + foot), by * (R + foot), bz * (R + foot), PART.riser, NONE, floor, 0, 0, 0);
      }
      for (let i = 0; i < segs; i++) {
        const a = r0 + 2 * i;
        const b = r0 + 2 * ring(i + 1);
        quad(ch, a, a + 1, b + 1, b);
      }
      // (its ends closed: the riser's wedge between its lean and the plumb line under its top; the dam's profile fanned)
      if (!closed) {
        for (const i of [0, c - 1]) {
          const a = r0 + 2 * i;
          const footR = Math.hypot(ch.pos.a[3 * (a + 1)], ch.pos.a[3 * (a + 1) + 1], ch.pos.a[3 * (a + 1) + 2]);
          const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
          const v = ch.vertex(x * footR, y * footR, z * footR, PART.riser, NONE, floor, 0, 0, 0);
          if (i === 0) tri(ch, a, v, a + 1);
          else tri(ch, a, a + 1, v);
          const f = ch.vertex(x * (R + floor - UNDER), y * (R + floor - UNDER), z * (R + floor - UNDER), flats ? PART.earth : PART.bundSide, NONE, floor, 0, 0, 0);
          for (let j = 0; j + 1 < M; j++) {
            if (i === 0) tri(ch, f, d0 + i * M + j + 1, d0 + i * M + j);
            else tri(ch, f, d0 + i * M + j, d0 + i * M + j + 1);
          }
        }
      }
    }
  }
  stats.banks = banks;
  // (a candidate is bare if no bank was built within 12 cm of it, of any level)
  const bare: number[] = [];
  for (let c = 0; c < candidates.length; c += 4) {
    const [x, y, z] = [candidates[c], candidates[c + 1], candidates[c + 2]];
    let near = false;
    const cx = Math.floor(x * R * 5);
    const cy = Math.floor(y * R * 5);
    const cz = Math.floor(z * R * 5);
    for (let dx = -1; dx <= 1 && !near; dx++) {
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dz = -1; dz <= 1 && !near; dz++) {
          const list = builtNear.get(((cx + dx + 2048) * 4096 + (cy + dy + 2048)) * 4096 + (cz + dz + 2048));
          if (!list) continue;
          for (let q = 0; q < list.length; q += 3) if (R * Math.hypot(list[q] - x, list[q + 1] - y, list[q + 2] - z) < 0.12) near = true;
        }
      }
    }
    if (!near) bare.push(x, y, z, candidates[c + 3]);
  }
  time('Banks');

  // the ridges: across each cut (a cross-bank on its band's floor), between the flats' plots (a bund on the
  // higher plot's floor, down to the lower's), and where the woods meet the farmed land (a bank of earth)
  /**
   * A ridge along pts: its feet `width` apart at the heights either side (left, right; each as low as the lowest
   * beside it nearby, so where a side steps down it reaches the lower floor without a gap), its crest `rise` over
   * the higher (or over `over`, the highest it must cover there, if higher); below the higher side it is a wall
   * (`wall`), above it its crest (`top`).
   */
  const ridge = (src: number[], closed: boolean, width: (i: number) => number, left: (i: number) => number, right: (i: number) => number, rise: (i: number) => number, wall: number, top: number, over?: (i: number) => number): void => {
    if (src.length < 6) return;
    // (an open ridge carried on a little past both its ends, its first and last points' heights and widths kept)
    let pts = src;
    let at = (i: number): number => i;
    if (!closed) {
      const n = src.length / 3;
      const head = past([src[0], src[1], src[2]], [src[3], src[4], src[5]], 0.8 * OVERLAP);
      const tail = past([src[3 * n - 3], src[3 * n - 2], src[3 * n - 1]], [src[3 * n - 6], src[3 * n - 5], src[3 * n - 4]], 0.8 * OVERLAP);
      pts = [...head, ...src, ...tail];
      at = (i: number): number => Math.min(Math.max(i - 1, 0), n - 1);
    }
    const c = pts.length / 3;
    const ring = (i: number): number => (closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
    const hl = Array.from({ length: c }, (_, i) => left(at(i)));
    const hr = Array.from({ length: c }, (_, i) => right(at(i)));
    const N = normals(pts, closed);
    const ch = chunks[chunkAt(pts[0], pts[1], pts[2])];
    const r0 = ch.count;
    for (let i = 0; i < c; i++) {
      // (both feet down to the lowest floor beside it nearby, either side: where a side steps down, or the other side
      // is the lower, it reaches it without a gap; on the higher side the foot goes into the ground)
      let low = Math.min(hl[i], hr[i]);
      for (let d = -3; d <= 3; d++) low = Math.min(low, hl[ring(i + d)], hr[ring(i + d)]);
      const higher = Math.max(hl[i], hr[i]);
      const crest = Math.max(higher, over ? over(at(i)) : higher) + rise(at(i));
      const half = width(at(i)) / 2;
      for (const [s, f] of RIDGE) {
        const foot = low - UNDER;
        const h = foot + (crest - foot) * f;
        // (s < 0 the left foot: along the left normal)
        const [x, y, z] = moveTo(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2], -s * half);
        ch.vertex(x * (R + h), y * (R + h), z * (R + h), h < higher - 0.005 ? wall : top, NONE, higher, 0, 0, 0);
      }
    }
    const M = RIDGE.length;
    for (let i = 0; i < (closed ? c : c - 1); i++) {
      const a = r0 + i * M;
      const b = r0 + ring(i + 1) * M;
      for (let j = 0; j + 1 < M; j++) quad(ch, a + j, b + j, b + j + 1, a + j + 1);
    }
    // (its ends closed: the profile fanned from its left foot)
    if (!closed) {
      for (const i of [0, c - 1]) {
        for (let j = 1; j + 1 < M; j++) {
          if (i === 0) tri(ch, r0 + i * M, r0 + i * M + j + 1, r0 + i * M + j);
          else tri(ch, r0 + i * M, r0 + i * M + j, r0 + i * M + j + 1);
        }
      }
    }
  };
  for (const line of cutLines) {
    // (from inside its bank's dam, a dam's half-width up the band)
    const all = resampleXYZ(line.pts, false, P.cutSpacing, R);
    const pts = all.slice(3 * Math.round(D_.width / 2 / P.cutSpacing));
    if (pts.length < 6) continue;
    const floor = floorOf(line.band);
    ridge(
      pts,
      false,
      (i) => 0.7 * widthAt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]),
      () => floor,
      () => floor,
      (i) => 0.9 * heightAt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]),
      PART.ridge,
      PART.ridge,
    );
  }
  // the fields' bunds (thin, dark) and the tracks (pale, a cart's width)
  const flatRuns = (chains: Chain[], width: number, rise: number, wall: number, top: number): void => {
    for (const chain of chains) {
      const pts = resample(grid, chain, P.edgeSpacing);
      const c = pts.length / 3;
      const ok = new Uint8Array(c);
      for (let i = 0; i < c; i++) ok[i] = classAt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]) === 1 ? 1 : 0;
      for (const run of runs(ok, chain.closed)) {
        const r: number[] = [];
        for (const i of run.idx) r.push(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
        const N = normals(r, run.closed);
        const probe = (i: number, s: number): number => {
          const [x, y, z] = moveTo(r[3 * i], r[3 * i + 1], r[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2], s);
          return surfaceAt(x, y, z);
        };
        ridge(r, run.closed, () => width, (i) => probe(i, width / 2 + 0.05), (i) => probe(i, -width / 2 - 0.05), () => rise, wall, top);
      }
    }
  };
  for (let cc = 1; cc < 3; cc++) {
    // (the crossings and the tracks, traced over the planet; kept where the flats are)
    const idx = new Int32Array(V);
    for (let v = 0; v < V; v++) idx[v] = Math.floor(lat(cc, v));
    const slot0 = [SLOT.u, SLOT.v, SLOT.w][cc] + 50000;
    flatRuns(
      grid.trace(idx, (u, w, k) =>
        grid.crossing(
          slot0 + k,
          u,
          w,
          (x, y, z) => latticeAt(cc, x, y, z) - k,
          (v) => lat(cc, v) - k,
        ),
      ),
      cc === 2 ? pl.trackWidth : 0.6 * D_.width,
      cc === 2 ? 0.04 : 0.06,
      cc === 2 ? PART.track : PART.earth,
      cc === 2 ? PART.track : PART.earth,
    );
  }
  // where the flats meet the terraces: a bund between the plot and the paddy
  const edgeRidge = (chains: Chain[], width: number, rise: (hl: number, hr: number) => number, wall: number, top: number): void => {
    for (const chain of chains) {
      const pts = resample(grid, chain, P.edgeSpacing);
      const c = pts.length / 3;
      if (c < 2) continue;
      const N = normals(pts, chain.closed);
      const side = (i: number, s: number): number => {
        const [x, y, z] = moveTo(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2], s);
        return surfaceAt(x, y, z);
      };
      // (each side read right at the edge and out at the ridge's foot: where a bank runs into the edge the floor
      // steps between the two, and the ridge covers the higher and reaches down to the lower)
      const far = width / 2 + 0.02;
      const L = Array.from({ length: c }, (_, i) => [side(i, 0.03), side(i, far)]);
      const Rt = Array.from({ length: c }, (_, i) => [side(i, -0.03), side(i, -far)]);
      const ring = (i: number): number => (chain.closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
      const over = (i: number): number => {
        let h = -Infinity;
        for (let d = -2; d <= 2; d++) {
          const j = ring(i + d);
          h = Math.max(h, L[j][0], L[j][1], Rt[j][0], Rt[j][1]);
        }
        return h;
      };
      ridge(pts, chain.closed, () => width, (i) => Math.min(L[i][0], L[i][1]), (i) => Math.min(Rt[i][0], Rt[i][1]), (i) => rise(L[i][1], Rt[i][1]), wall, top, over);
    }
  };
  edgeRidge(
    grid.trace(flatIdx, (u, w) => grid.crossing(SLOT.flat, u, w, flatF, flatV)),
    0.7 * D_.width,
    () => 0.75 * D_.height,
    PART.riser,
    PART.ridge,
  );
  // (the woods on the left: a bank of earth up to the woods, or a bund where the paddy stands above them)
  edgeRidge(
    grid.trace(woodsIdx, (u, w) => grid.crossing(SLOT.woods, u, w, steepF, steepV)),
    // (wide enough to bury the banks' ends carried on into the woods: a point and an overlap)
    0.6,
    (hl, hr) => (hr > hl ? D_.height : 0.03),
    PART.earth,
    PART.earth,
  );
  time('Ridges');

  // the trees: one about every treeSpacing m where the woods are, each its own size and green
  const trees: number[] = [];
  {
    const per = Math.max(1, Math.round(P.treeSpacing / grid.spacing));
    let rs = Math.imul(seed, 2246822519) + 7 || 1;
    const rand = (): number => {
      rs ^= rs << 13;
      rs >>>= 0;
      rs ^= rs >>> 17;
      rs ^= rs << 5;
      rs >>>= 0;
      return rs / 4294967296;
    };
    const d: number[] = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj + per <= m; cj += per) {
        for (let ci = 0; ci + per <= m; ci += per) {
          // (somewhere in its block of squares, evenly in angle as the grid is)
          const a = (2 * (ci + rand() * per) - m) / m;
          const b = (2 * (cj + rand() * per) - m) / m;
          const [tx, ty, tz] = faceDirection(f, Math.tan((Math.PI / 4) * a), Math.tan((Math.PI / 4) * b), d);
          const keep = rand();
          const look = rand();
          if (keep > 0.85 || field.slope(tx, ty, tz) - fp.steep < 0.03 || classAt(tx, ty, tz) !== 0) continue;
          trees.push(tx, ty, tz, field.height(tx, ty, tz), look);
        }
      }
    }
  }
  stats.trees = trees.length / 5;

  const out = chunks.map((c) => c.data());
  stats.triangles = out.reduce((s, c) => s + (c ? c.index.length / 3 : 0), 0);
  stats.meshVertices = out.reduce((s, c) => s + (c ? c.part.length : 0), 0);
  stats.points = grid.points;
  time('Out');
  stats.buildMs = Math.round(performance.now() - started);
  stats.bare = bare.length / 4;
  return { chunks: out, trees: Float32Array.from(trees), stats, bare: Float32Array.from(bare) };

  function moveTo(x: number, y: number, z: number, nx: number, ny: number, nz: number, d: number): [number, number, number] {
    const qx = x + (nx * d) / R;
    const qy = y + (ny * d) / R;
    const qz = z + (nz * d) / R;
    const l = Math.hypot(qx, qy, qz);
    return [qx / l, qy / l, qz / l];
  }
}

/** The left of a direction along (tx, ty, tz) at (x, y, z) on the planet (unit: up × along). */
function leftOf(x: number, y: number, z: number, tx: number, ty: number, tz: number): [number, number, number] {
  const nx = y * tz - z * ty;
  const ny = z * tx - x * tz;
  const nz = x * ty - y * tx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function delayOf(u: number): number {
  for (let i = 1; i < LOOK_SHARE.length; i++) {
    if (u <= LOOK_SHARE[i]) return LOOK_DELAY[i - 1] + ((LOOK_DELAY[i] - LOOK_DELAY[i - 1]) * (u - LOOK_SHARE[i - 1])) / (LOOK_SHARE[i] - LOOK_SHARE[i - 1]);
  }
  return LOOK_DELAY[LOOK_DELAY.length - 1];
}

function quad(c: Chunk, a: number, b: number, d: number, e: number): void {
  c.index.push(a);
  c.index.push(b);
  c.index.push(d);
  c.index.push(a);
  c.index.push(d);
  c.index.push(e);
}

function tri(c: Chunk, a: number, b: number, d: number): void {
  c.index.push(a);
  c.index.push(b);
  c.index.push(d);
}

function triArea(A: number[], B: number[], C: number[]): number {
  const ux = B[0] - A[0];
  const uy = B[1] - A[1];
  const uz = B[2] - A[2];
  const vx = C[0] - A[0];
  const vy = C[1] - A[1];
  const vz = C[2] - A[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function segHits(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Each point's left on the planet (unit: up × along), for points x, y, z, … */
function normals(pts: readonly number[], closed: boolean): Float64Array {
  const c = pts.length / 3;
  const N = new Float64Array(3 * c);
  for (let i = 0; i < c; i++) {
    const a = closed ? (i - 1 + c) % c : Math.max(i - 1, 0);
    const b = closed ? (i + 1) % c : Math.min(i + 1, c - 1);
    const [nx, ny, nz] = leftOf(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], pts[3 * b] - pts[3 * a], pts[3 * b + 1] - pts[3 * a + 1], pts[3 * b + 2] - pts[3 * a + 2]);
    N[3 * i] = nx;
    N[3 * i + 1] = ny;
    N[3 * i + 2] = nz;
  }
  return N;
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

/** A chain evened out: points (x, y, z unit) every `step` m along it (an open one keeps its two ends). */
function resample(grid: SphereGrid, chain: Chain, step: number): number[] {
  const p: number[] = [0, 0, 0];
  const xyz: number[] = [];
  for (const id of chain.pts) xyz.push(...grid.point(id, p));
  return resampleXYZ(xyz, chain.closed, step, grid.R);
}

function resampleXYZ(src: readonly number[], closed: boolean, step: number, R: number): number[] {
  const xyz = closed ? [...src, src[0], src[1], src[2]] : src;
  const cum = [0];
  for (let i = 3; i < xyz.length; i += 3) cum.push(cum[cum.length - 1] + R * Math.hypot(xyz[i] - xyz[i - 3], xyz[i + 1] - xyz[i - 2], xyz[i + 2] - xyz[i - 1]));
  const total = cum[cum.length - 1];
  const count = Math.max(closed ? 3 : 1, Math.round(total / step));
  const out: number[] = [];
  let seg = 0;
  for (let s = 0; s <= (closed ? count - 1 : count); s++) {
    const d = (s / count) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const t = (d - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-12);
    const x = xyz[3 * seg] + (xyz[3 * seg + 3] - xyz[3 * seg]) * t;
    const y = xyz[3 * seg + 1] + (xyz[3 * seg + 4] - xyz[3 * seg + 1]) * t;
    const z = xyz[3 * seg + 2] + (xyz[3 * seg + 5] - xyz[3 * seg + 2]) * t;
    const l = Math.hypot(x, y, z);
    out.push(x / l, y / l, z / l);
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

