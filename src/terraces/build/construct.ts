import { hash32, unit } from '../../core/hash';
import { smoothstep } from '../../core/math';
import { gnoise } from '../../planet/noise';
import { Bands, Cuts, inRing, insideRing, type CutParams } from './bands';
import { gnoiseGrad, PlanetField, type FieldParams } from './field';
import { clip, faceDirection, Side, SphereGrid, tangentFrame, vertexCorner, type Chain, type Corner, type Field } from './sphere';

// The terraces' build (build/): the paddy lab's construction (src/dev/
// paddyLab/build.ts) over the whole planet, once, from the planet's
// mathematics (field.ts): every outline is found on the field itself, every
// height, slope and normal worked out from it exactly, nothing read off a
// mesh or a texture. The slope sorts the ground: the woods (their own ground,
// the hills' height itself, with trees), the flats (plain fields, as Kai's
// aerial of flat rice fields has them: each flat patch a lattice of its own,
// long strips along the lie of its land crossed every so far, each field
// level at the band its ground lies in on the whole and its own green, thin
// dark bunds between and a pale track across), the terraces between.
// Each band's paddies are filled level, each paddy its own (the cuts' lines
// part them, bands.ts); along each bank a dam on the higher paddy's edge and
// a riser down to the paddy below; across each cut a cross-bank; a bank of
// earth where the woods meet the paddies. Everything that stands on a floor
// reaches a little under it, so nothing between them shows a gap. The
// geometry comes out in chunks (a mesh each, culled on its own), per vertex
// as the terraces' shaders read it (terrace.vert.glsl): position, normal,
// aPart, aPaddy (its paddy's crop constants), aFloor (its floor or ground;
// fallow, or the ground's slope).

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
  /** About how much of a plain each of its major curves parts off (m²). */
  readonly section: number;
  /** A section's strips' width (m, from … to: each section its own). */
  readonly strip: readonly [number, number];
  /** How far apart a section's strips are crossed where they are (m, from … to), and the share of sections that are. */
  readonly cross: readonly [number, number];
  readonly crossed: number;
  /** How far each line between strips bends of its own (× a strip's width, over 18 m or so). */
  readonly bend: number;
  /** The lines' widths (m): between strips and crossings, between sections, the track along the first major curve. */
  readonly minor: number;
  readonly major: number;
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
  plot: { section: 450, strip: [3, 5], cross: [8, 14], crossed: 0.85, bend: 0.45, minor: 0.3, major: 0.6, trackWidth: 1.6 },
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

const SLOT = { woods: 2, flat: 3, zone: 4, base: 100000, bands: 200000, cut: 600000, fields: 1000000 } as const;

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
  /**
   * A direction's class: 0 the woods, 1 a plain, 2 the terraces (the largest turned ring round it has the last word;
   * a plain is the whole of its stretch of the flats, as the lab's flats were, and the land round it its collar keeps
   * at its level, up to the banks where the next terraces step: fields only, the bands only round it).
   */
  const classAt = (x: number, y: number, z: number): number => {
    const s = field.slope(x, y, z);
    let woods = s - fp.steep >= 0;
    let w = false;
    for (const r of turned) {
      if (!r.woods || w || x * r.c[0] + y * r.c[1] + z * r.c[2] < 0.9) continue;
      const px = x * r.F[0] + y * r.F[1] + z * r.F[2];
      const py = x * r.F[3] + y * r.F[4] + z * r.F[5];
      if (px < r.box[0] || px > r.box[1] || py < r.box[2] || py > r.box[3] || !inRing(r.xy, px, py)) continue;
      woods = r.value === 1;
      w = true;
    }
    if (woods) return 0;
    const p = plainAt(x, y, z);
    if (p < 0) return 2;
    const d = plainDist(p, x, y, z);
    return d < 0 || (d < rasters[p].collar && bandsNow !== null && bandsNow.bandAt(x, y, z) === plainBand[p]) ? 1 : 2;
  };
  const terraced = (x: number, y: number, z: number): boolean => classAt(x, y, z) === 2;
  time('Classes');

  // the plains: each stretch of the flats (tidied, joined across the grid's triangles, its narrow bays and its
  // islands filled) cut out of the land before the bands, as the lab's flats were, and held level (field.ts Plains),
  // the whole of it, at one level: the floor of the band in the middle of the most of its ground that lies within
  // 4 m (a hilltop's flat, a hollow's, a valley floor's). So a plain is truly flat, all of it fields, and no band's
  // outline crosses it. Round it a collar where the land eases back to its own height, the wider the farther the
  // plain's ground lay from its level (8 m for every meter, 14 to 32 m), by the distance from the plain's edge
  // (softened where the edge bends, so the ease bends smoothly too), so the terraces step up and down from its
  // edges. The distance kept on a fine raster on the plane at the plain's middle; the field's samples taken again.
  /** How far a plain's edge's distance is softened (m). */
  const PLAIN_SOFT = 1.5;
  /** How narrow a bay in a plain's edge it fills (half its width, m), and how large a mound in its fields (m²). */
  const PLAIN_CLOSE = 7;
  const PLAIN_MOUND = 800;
  const RASTER = 0.5;
  const core = new Int32Array(V).fill(-1);
  const plainLevel: number[] = [];
  const plainBand: number[] = [];
  interface PlainRaster {
    readonly c: number[];
    readonly e1: number[];
    readonly e2: number[];
    readonly x0: number;
    readonly y0: number;
    readonly nx: number;
    readonly ny: number;
    /** The distance from the plain's edge (m, signed: < 0 on it), per raster point; its collar's width (m). */
    readonly sd: Float32Array;
    readonly collar: number;
    readonly capCos: number;
  }
  const rasters: PlainRaster[] = [];
  {
    const up = new Int32Array(V);
    for (let v = 0; v < V; v++) up[v] = v;
    const root = (v: number): number => {
      while (up[v] !== v) {
        up[v] = up[up[v]];
        v = up[v];
      }
      return v;
    };
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < m; cj++) {
        for (let ci = 0; ci < m; ci++) {
          const t = grid.triangles(f, ci, cj);
          for (let q = 0; q < 12; q += 3) {
            for (let e = 0; e < 3; e++) {
              const a = t[q + e];
              const b = t[q + ((e + 1) % 3)];
              if (!flatIdx[a] || !flatIdx[b]) continue;
              const ra = root(a);
              const rb = root(b);
              if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
            }
          }
        }
      }
    }
    const members = new Map<number, number[]>();
    for (let v = 0; v < V; v++) {
      if (!flatIdx[v]) continue;
      const r = root(v);
      const list = members.get(r);
      if (list) list.push(v);
      else members.set(r, [v]);
    }
    for (const list of members.values()) {
      const p = plainLevel.length;
      for (const v of list) core[v] = p;
      // its level
      const ts = list.map((v) => T[v]).sort((a, b) => a - b);
      let first = 0;
      let most = 0;
      for (let i = 0, j = 0; i < ts.length; i++) {
        while (ts[i] - ts[j] > 4) j++;
        if (i - j + 1 > most) {
          most = i - j + 1;
          first = j;
        }
      }
      let a = 0;
      let b = L;
      while (a < b) {
        const c = (a + b) >> 1;
        if (levels[c] > (ts[first] + ts[first + most - 1]) / 2) b = c;
        else a = c + 1;
      }
      plainBand.push(a - 1);
      plainLevel.push(floorOf(a - 1));
    }
    // its plane, and on it what it holds (its flats, and whatever of the rest they close round) and the distance from
    // that edge, raster point by raster point (an exact distance transform, blurred a little so the ease bends
    // smoothly where the edge does); its collar
    for (let p = 0; p < plainLevel.length; p++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let off = 0;
      for (let v = 0; v < V; v++) {
        if (core[v] !== p) continue;
        off = Math.max(off, Math.abs(T[v] - plainLevel[p]));
        sx += D[3 * v];
        sy += D[3 * v + 1];
        sz += D[3 * v + 2];
      }
      const collar = Math.min(Math.max(8 * off, 14), 32);
      const l = Math.hypot(sx, sy, sz) || 1;
      const c = [sx / l, sy / l, sz / l];
      const F = tangentFrame(c[0], c[1], c[2], new Float64Array(6));
      const e1 = [F[0], F[1], F[2]];
      const e2 = [F[3], F[4], F[5]];
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let v = 0; v < V; v++) {
        if (core[v] !== p) continue;
        const s = Math.max(D[3 * v] * c[0] + D[3 * v + 1] * c[1] + D[3 * v + 2] * c[2], 0.2);
        const X = (R * (D[3 * v] * e1[0] + D[3 * v + 1] * e1[1] + D[3 * v + 2] * e1[2])) / s;
        const Y = (R * (D[3 * v] * e2[0] + D[3 * v + 1] * e2[1] + D[3 * v + 2] * e2[2])) / s;
        x0 = Math.min(x0, X);
        x1 = Math.max(x1, X);
        y0 = Math.min(y0, Y);
        y1 = Math.max(y1, Y);
      }
      const pad = collar + 3;
      x0 -= pad;
      y0 -= pad;
      x1 += pad;
      y1 += pad;
      const nx = Math.ceil((x1 - x0) / RASTER) + 1;
      const ny = Math.ceil((y1 - y0) / RASTER) + 1;
      const inside = new Uint8Array(nx * ny);
      const at = { face: 0, ci: 0, cj: 0 };
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const X = x0 + i * RASTER;
          const Y = y0 + j * RASTER;
          const dx = c[0] + (X / R) * e1[0] + (Y / R) * e2[0];
          const dy = c[1] + (X / R) * e1[1] + (Y / R) * e2[1];
          const dz = c[2] + (X / R) * e1[2] + (Y / R) * e2[2];
          const dl = Math.hypot(dx, dy, dz);
          grid.square(dx / dl, dy / dl, dz / dl, at);
          const t = grid.triangles(at.face, at.ci, at.cj);
          let n = 0;
          for (const v of [t[0], t[3], t[6], t[9], t[2]]) if (core[v] === p) n++;
          inside[j * nx + i] = n >= 3 ? 1 : 0;
        }
      }
      // (its bays and notches narrower than twice PLAIN_CLOSE filled: closed, a dilation then an erosion)
      {
        const r2 = (PLAIN_CLOSE / RASTER) ** 2;
        const toIn0 = edt(inside, nx, ny, 1);
        const grown = new Uint8Array(nx * ny);
        for (let q = 0; q < nx * ny; q++) grown[q] = toIn0[q] <= r2 ? 1 : 0;
        const toOut0 = edt(grown, nx, ny, 0);
        for (let q = 0; q < nx * ny; q++) inside[q] = toOut0[q] > r2 ? 1 : inside[q];
      }
      // (islands: what of the outside the raster's border does not reach)
      const seen = new Uint8Array(nx * ny);
      const stack: number[] = [];
      for (let i = 0; i < nx; i++) stack.push(i, (ny - 1) * nx + i);
      for (let j = 0; j < ny; j++) stack.push(j * nx, j * nx + nx - 1);
      while (stack.length) {
        const q = stack.pop() as number;
        if (seen[q] || inside[q]) continue;
        seen[q] = 1;
        const i = q % nx;
        const j = (q - i) / nx;
        if (i > 0) stack.push(q - 1);
        if (i + 1 < nx) stack.push(q + 1);
        if (j > 0) stack.push(q - nx);
        if (j + 1 < ny) stack.push(q + nx);
      }
      for (let q = 0; q < nx * ny; q++) if (!seen[q]) inside[q] = 1;
      // (signed distance: to the nearest point of the other side, less half a raster step either way; then blurred)
      const distance = (): Float32Array => {
        const toIn = edt(inside, nx, ny, 1);
        const toOut = edt(inside, nx, ny, 0);
        const raw = new Float32Array(nx * ny);
        for (let q = 0; q < nx * ny; q++) raw[q] = inside[q] ? -(Math.sqrt(toOut[q]) - 0.5) * RASTER : (Math.sqrt(toIn[q]) - 0.5) * RASTER;
        return blur(raw, nx, ny, PLAIN_SOFT / RASTER);
      };
      let sd = distance();
      // (and a mound its level's land round it closes in on every side, under PLAIN_MOUND: held level too, as the lab
      // filled a small hole in its flats)
      {
        const level = plainLevel[p];
        const ring = new Uint8Array(nx * ny);
        for (let q = 0; q < nx * ny; q++) {
          const d = sd[q];
          if (d <= 0) {
            ring[q] = 1;
            continue;
          }
          if (d >= collar) continue;
          const X = x0 + (q % nx) * RASTER;
          const Y = y0 + Math.floor(q / nx) * RASTER;
          const dx = c[0] + (X / R) * e1[0] + (Y / R) * e2[0];
          const dy = c[1] + (X / R) * e1[1] + (Y / R) * e2[1];
          const dz = c[2] + (X / R) * e1[2] + (Y / R) * e2[2];
          const dl = Math.hypot(dx, dy, dz);
          const t = field.terrace(dx / dl, dy / dl, dz / dl);
          const w = (1 - d / collar) ** 2;
          ring[q] = Math.abs(t + w * (level - t) - level) < 0.5 * step ? 1 : 0;
        }
        const out = new Uint8Array(nx * ny);
        const todo: number[] = [];
        for (let i = 0; i < nx; i++) todo.push(i, (ny - 1) * nx + i);
        for (let j = 0; j < ny; j++) todo.push(j * nx, j * nx + nx - 1);
        while (todo.length) {
          const q = todo.pop() as number;
          if (out[q] || ring[q]) continue;
          out[q] = 1;
          const i = q % nx;
          const j = (q - i) / nx;
          if (i > 0) todo.push(q - 1);
          if (i + 1 < nx) todo.push(q + 1);
          if (j > 0) todo.push(q - nx);
          if (j + 1 < ny) todo.push(q + nx);
        }
        // (each mound on its own: its size, and filled if small enough)
        const seenM = new Uint8Array(nx * ny);
        let filled = false;
        for (let q0 = 0; q0 < nx * ny; q0++) {
          if (ring[q0] || out[q0] || seenM[q0]) continue;
          const cells: number[] = [];
          const st = [q0];
          seenM[q0] = 1;
          while (st.length) {
            const q = st.pop() as number;
            cells.push(q);
            const i = q % nx;
            const j = (q - i) / nx;
            for (const r of [i > 0 ? q - 1 : -1, i + 1 < nx ? q + 1 : -1, j > 0 ? q - nx : -1, j + 1 < ny ? q + nx : -1]) {
              if (r < 0 || ring[r] || out[r] || seenM[r]) continue;
              seenM[r] = 1;
              st.push(r);
            }
          }
          if (cells.length * RASTER * RASTER > PLAIN_MOUND) continue;
          for (const q of cells) inside[q] = 1;
          filled = true;
        }
        if (filled) sd = distance();
      }
      const capR = Math.hypot(Math.max(-x0, x1), Math.max(-y0, y1)) / R;
      rasters.push({ c, e1, e2, x0, y0, nx, ny, sd, collar, capCos: Math.cos(Math.min(capR, 1.2)) });
    }
  }
  const pg = [0, 0];
  /** A plain's distance from its edge at a direction (m, signed: < 0 on it); with g, its gradient on its plane. */
  const plainDist = (p: number, x: number, y: number, z: number, g?: number[]): number => {
    const r = rasters[p];
    const s = Math.max(x * r.c[0] + y * r.c[1] + z * r.c[2], 0.2);
    const X = (R * (x * r.e1[0] + y * r.e1[1] + z * r.e1[2])) / s;
    const Y = (R * (x * r.e2[0] + y * r.e2[1] + z * r.e2[2])) / s;
    const fx = (X - r.x0) / RASTER;
    const fy = (Y - r.y0) / RASTER;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= r.nx || j + 1 >= r.ny) {
      if (g) g[0] = g[1] = 0;
      return r.collar + 10;
    }
    const u = fx - i;
    const v = fy - j;
    const a = r.sd[j * r.nx + i];
    const b = r.sd[j * r.nx + i + 1];
    const c = r.sd[(j + 1) * r.nx + i];
    const d = r.sd[(j + 1) * r.nx + i + 1];
    if (g) {
      g[0] = ((b - a) * (1 - v) + (d - c) * v) / RASTER;
      g[1] = ((c - a) * (1 - u) + (d - b) * u) / RASTER;
    }
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  field.plains = {
    count: plainLevel.length,
    near: (p, x, y, z) => x * rasters[p].c[0] + y * rasters[p].c[1] + z * rasters[p].c[2] > rasters[p].capCos,
    weight: (p, x, y, z, g) => {
      const d = plainDist(p, x, y, z, g ? pg : undefined);
      const collar = rasters[p].collar;
      if (d >= collar) {
        if (g) g[0] = g[1] = g[2] = 0;
        return 0;
      }
      if (d <= 0) {
        if (g) g[0] = g[1] = g[2] = 0;
        return 1;
      }
      // (falling off at once from the plain's edge, so the land leaves its level there, and gently into its own)
      const u = d / collar;
      if (g) {
        // (dw/dd times d's gradient on the plane, carried onto the planet through the plane's own ways there: X =
        // R (p·e1) / (p·c), so a meter along the planet moves X by (e1 (p·c) − (p·e1) c) / (p·c)² along it)
        const dw = (-2 * (1 - u)) / collar;
        const r = rasters[p];
        const sc = Math.max(x * r.c[0] + y * r.c[1] + z * r.c[2], 0.2);
        const p1 = x * r.e1[0] + y * r.e1[1] + z * r.e1[2];
        const p2 = x * r.e2[0] + y * r.e2[1] + z * r.e2[2];
        for (let k = 0; k < 3; k++) g[k] = (dw * (pg[0] * (r.e1[k] * sc - p1 * r.c[k]) + pg[1] * (r.e2[k] * sc - p2 * r.c[k]))) / (sc * sc);
        const n = g[0] * x + g[1] * y + g[2] * z;
        g[0] -= n * x;
        g[1] -= n * y;
        g[2] -= n * z;
      }
      return (1 - u) * (1 - u);
    },
    level: Float64Array.from(plainLevel),
  };
  // (each square's plain: the one holding its middle most, if any)
  const squarePlain = new Int32Array(6 * m * m).fill(-1);
  {
    const best = new Float32Array(6 * m * m);
    const mid = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < m; cj++) {
        for (let ci = 0; ci < m; ci++) {
          const t = grid.triangles(f, ci, cj);
          grid.point(t[2], mid);
          for (let p = 0; p < plainLevel.length; p++) {
            if (!field.plains.near(p, mid[0], mid[1], mid[2])) continue;
            // (a square's middle and corners all count: a collar's edge can pass between)
            let w = 0;
            for (const v of [t[2], t[0], t[3], t[6], t[9]]) w = Math.max(w, field.plains.weight(p, D[3 * v], D[3 * v + 1], D[3 * v + 2]) + (plainDist(p, D[3 * v], D[3 * v + 1], D[3 * v + 2]) < rasters[p].collar + 1 ? 1e-3 : 0));
            const si = (f * m + cj) * m + ci;
            if (w > best[si]) {
              best[si] = w;
              squarePlain[si] = p;
            }
          }
        }
      }
    }
  }
  const psq = { face: 0, ci: 0, cj: 0 };
  /** The plain whose zone a direction lies in (its square's), or −1. */
  const plainAt = (x: number, y: number, z: number): number => {
    grid.square(x, y, z, psq);
    return squarePlain[(psq.face * m + psq.cj) * m + psq.ci];
  };
  /** How far within a plain a direction lies (m: ≥ 0 on it), or −1 with none near. */
  const plainIn = (x: number, y: number, z: number): number => {
    const p = plainAt(x, y, z);
    return p < 0 ? -1 : -plainDist(p, x, y, z);
  };
  {
    const again = new Uint8Array(V);
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < m; cj++) {
        for (let ci = 0; ci < m; ci++) {
          if (squarePlain[(f * m + cj) * m + ci] < 0) continue;
          const t = grid.triangles(f, ci, cj);
          for (const v of [t[0], t[3], t[6], t[9], t[2]]) {
            if (again[v]) continue;
            again[v] = 1;
            T[v] = field.terrace(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
          }
        }
      }
    }
  }
  stats.plains = plainLevel.length;
  let bandsNow: Bands | null = null;
  time('Plains');

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
  bandsNow = base;
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
  bandsNow = bands;
  const cutLines = cuts.lines(bands, terraced);
  time('Bands');
  stats.levels = L;
  stats.cuts = cuts.cuts.length;
  stats.cutLines = cutLines.length;
  stats.levelled = bands.dropped;

  // each plain divided as Kai's aerials of flat fields divide them (2026-11-01): a few gentle curves across it (the
  // major lines: a track along it, bunds) part it into sections; each section is laid in strips, gentle curves too,
  // running along its sides and fanning from one to the one across from it (or keeping a side's way where none lies
  // across), now and then crossed; a field is a strip's cell, every field of a plain at its level, the lines between
  // them sunk (grooves, below). Each line is the zero of a field of its own on the plane at the plain's middle,
  // found where it crosses the grid on that field itself, as every outline is.
  const pl = P.plot;
  interface Curve {
    /** Where it runs: everywhere (parent −1), or on one side (pside) of an earlier curve (parent), branching off it. */
    readonly parent: number;
    readonly pside: number;
    /** A point it passes, its normal, how far it bends (× its scale) over its scale (m), its noise's offsets, its half-width (m). */
    readonly x0: number;
    readonly y0: number;
    readonly nx: number;
    readonly ny: number;
    readonly bend: number;
    readonly scale: number;
    readonly o: readonly [number, number, number];
    readonly half: number;
    readonly track: boolean;
  }
  interface Section {
    /** Its rails (the curves its strips run along: a, and b across from it, or none) and its side of each (±1). */
    readonly a: Curve;
    readonly sa: number;
    readonly b: Curve | null;
    readonly sb: number;
    /** Its strips: how many between two rails (0: from one rail on, each W m wide), and a line's half-width (in strips). */
    readonly n: number;
    readonly W: number;
    readonly off: number;
    /** Its crossings, L m apart: along a major curve (c, its side sc), or straight across (way tx, ty), or none. */
    readonly c: Curve | null;
    readonly sc: number;
    readonly straight: boolean;
    readonly tx: number;
    readonly ty: number;
    readonly t0: number;
    readonly L: number;
    readonly coff: number;
    /** Its lines' own bend: the noise's offsets. */
    readonly wo: readonly [number, number, number];
  }
  interface Division {
    /** The plane at the plain's middle: its middle and two ways along it (unit). */
    readonly c: number[];
    readonly e1: number[];
    readonly e2: number[];
    readonly curves: Curve[];
    /** Rails only, beyond the plain's edges (none of its lines): the far sides strips by an edge fan toward. */
    readonly phantoms: Curve[];
    readonly sections: Map<number, Section>;
    /** Per section (its sides of the curves, a bit each): its held ground's middle on the plane and how much of it. */
    readonly middles: Map<number, number[]>;
  }
  const divisions: Division[] = [];
  const cg = new Float64Array(3);
  const loc = [0, 0];
  /** A direction on a plain's plane (m), into out. */
  const onPlane = (d: Division, x: number, y: number, z: number, out: number[]): number[] => {
    const s = Math.max(x * d.c[0] + y * d.c[1] + z * d.c[2], 0.2);
    out[0] = (R * (x * d.e1[0] + y * d.e1[1] + z * d.e1[2])) / s;
    out[1] = (R * (x * d.e2[0] + y * d.e2[1] + z * d.e2[2])) / s;
    return out;
  };
  /** A major curve's field at (X, Y) (about meters from it, signed: its zero the curve); with g, its gradient. */
  const curveAt = (cv: Curve, X: number, Y: number, g?: number[]): number => {
    const n = gnoiseGrad((X - cv.x0) / cv.scale + cv.o[0], (Y - cv.y0) / cv.scale + cv.o[1], cv.o[2], (seed + 0x5ec7) >>> 0, cg);
    if (g) {
      g[0] = cv.nx + cv.bend * cg[0];
      g[1] = cv.ny + cv.bend * cg[1];
    }
    return cv.nx * (X - cv.x0) + cv.ny * (Y - cv.y0) + cv.bend * cv.scale * n;
  };
  const gq = [0, 0];
  /** How far (X, Y) lies from a major curve (m, signed): its field over its gradient's length. */
  const curveDist = (cv: Curve, X: number, Y: number): number => {
    const f = curveAt(cv, X, Y, gq);
    return f / Math.max(Math.hypot(gq[0], gq[1]), 0.3);
  };
  /** Whether a curve runs at (X, Y): everywhere, or on its side of the curve it branches off. */
  const curveRuns = (d: Division, cv: Curve, X: number, Y: number): boolean => cv.parent < 0 || (curveAt(d.curves[cv.parent], X, Y) >= 0 ? 1 : -1) === cv.pside;
  /** A section's sides of the curves at (X, Y), a bit each (0 for a curve that does not run there). */
  const sigmaAt = (d: Division, X: number, Y: number): number => {
    let sigma = 0;
    for (let i = 0; i < d.curves.length; i++) if (curveRuns(d, d.curves[i], X, Y) && curveAt(d.curves[i], X, Y) >= 0) sigma |= 1 << i;
    return sigma;
  };
  for (let p = 0; p < plainLevel.length; p++) {
    // (its held ground: the flats' vertices the plain holds level)
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const held: number[] = [];
    for (let v = 0; v < V; v++) {
      if (core[v] !== p) continue;
      held.push(v);
      sx += D[3 * v];
      sy += D[3 * v + 1];
      sz += D[3 * v + 2];
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    const c = [sx / l, sy / l, sz / l];
    const F = tangentFrame(c[0], c[1], c[2], new Float64Array(6));
    const d: Division = { c, e1: [F[0], F[1], F[2]], e2: [F[3], F[4], F[5]], curves: [], phantoms: [], sections: new Map(), middles: new Map() };
    divisions.push(d);
    // its spread on the plane: the way it runs longest and how far either way
    let mx = 0;
    let my = 0;
    for (const v of held) {
      onPlane(d, D[3 * v], D[3 * v + 1], D[3 * v + 2], loc);
      mx += loc[0];
      my += loc[1];
    }
    mx /= Math.max(held.length, 1);
    my /= Math.max(held.length, 1);
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    for (const v of held) {
      onPlane(d, D[3 * v], D[3 * v + 1], D[3 * v + 2], loc);
      cxx += (loc[0] - mx) ** 2;
      cxy += (loc[0] - mx) * (loc[1] - my);
      cyy += (loc[1] - my) ** 2;
    }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const [ux, uy] = [Math.cos(th), Math.sin(th)];
    const n = Math.max(held.length, 1);
    const along = Math.sqrt(Math.max((cxx * ux * ux + 2 * cxy * ux * uy + cyy * uy * uy) / n, 1));
    const across = Math.sqrt(Math.max((cxx * uy * uy - 2 * cxy * ux * uy + cyy * ux * ux) / n, 1));
    const area = (held.length * 4 * Math.PI * R * R) / V;
    // its major curves: the first along it near its middle (a track); the rest across it, branching off the track to
    // one side or the other, and along it, by turns, spread over it, each its own way give or take, bending gently
    let h = hash32((Math.imul(p + 1, 0x9e3779b1) ^ (seed + 0x91a1)) >>> 0);
    const rnd = (): number => unit((h = hash32((h + 0x6d2b79f5) >>> 0)));
    const count = Math.max(2, Math.min(8, Math.round(area / pl.section)));
    const acrossCount = Math.ceil((count - 1) / 2);
    const alongCount = count - 1 - acrossCount;
    for (let i = 0; i < count; i++) {
      const isAcross = i > 0 && i % 2 === 1;
      const rank = i === 0 ? 0 : Math.floor((i - 1) / 2);
      const of = isAcross ? acrossCount : alongCount;
      const turn = isAcross ? Math.PI / 2 + (rnd() - 0.5) * 0.9 : (rnd() - 0.5) * 0.5;
      // (its place: along the plain for those across, across it for those along; the track near the middle)
      const at = i === 0 ? (rnd() - 0.5) * 0.4 : ((rank + 0.3 + 0.4 * rnd()) / Math.max(of, 1) - 0.5) * 2.4;
      const [px, py] = isAcross ? [mx + ux * at * along, my + uy * at * along] : [mx - uy * at * across, my + ux * at * across];
      const dirX = Math.cos(th + turn);
      const dirY = Math.sin(th + turn);
      d.curves.push({
        parent: isAcross ? 0 : -1,
        pside: rnd() < 0.5 ? 1 : -1,
        x0: px,
        y0: py,
        nx: -dirY,
        ny: dirX,
        bend: 0.24 + 0.12 * rnd(),
        scale: 26 + 14 * rnd(),
        o: [rnd() * 97, rnd() * 97, rnd() * 97],
        half: (i === 0 ? pl.trackWidth : pl.major) / 2,
        track: i === 0,
      });
    }
    // beyond each of its edges a rail of its own, turned a little and bending, for the strips by that edge to fan to
    for (const [isAcross, sgn] of [
      [false, 1],
      [false, -1],
      [true, 1],
      [true, -1],
    ] as const) {
      const turn = (isAcross ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.6;
      const out = isAcross ? 2.2 * along + 6 : 2.2 * across + 6;
      const [px, py] = isAcross ? [mx + ux * sgn * out, my + uy * sgn * out] : [mx - uy * sgn * out, my + ux * sgn * out];
      d.phantoms.push({ parent: -1, pside: 1, x0: px, y0: py, nx: -Math.sin(th + turn), ny: Math.cos(th + turn), bend: 0.24 + 0.12 * rnd(), scale: 26 + 14 * rnd(), o: [rnd() * 97, rnd() * 97, rnd() * 97], half: 0, track: false });
    }
    // each section's held ground: its middle on the plane, how much of it
    for (const v of held) {
      onPlane(d, D[3 * v], D[3 * v + 1], D[3 * v + 2], loc);
      const sigma = sigmaAt(d, loc[0], loc[1]);
      const mid = d.middles.get(sigma);
      if (mid) {
        mid[0] += loc[0];
        mid[1] += loc[1];
        mid[2]++;
      } else d.middles.set(sigma, [loc[0], loc[1], 1]);
    }
    for (const mid of d.middles.values()) {
      mid[0] /= mid[2];
      mid[1] /= mid[2];
    }
  }
  /** A section of a plain (its sides of the major curves, a bit each), worked out the first time it is asked for. */
  const sectionOf = (p: number, sigma: number, X: number, Y: number): Section => {
    const d = divisions[p];
    const known = d.sections.get(sigma);
    if (known) return known;
    const mid = d.middles.get(sigma) ?? [X, Y, 0];
    const [cx, cy] = mid;
    // the curves it lies along: where the nearest point of each to its middle has it on the same side of every other
    // (and the curve runs there)
    type Rail = { cv: Curve; d: number; nx: number; ny: number; side: number };
    const railOf = (cv: Curve): Rail => {
      const g = [0, 0];
      const f = curveAt(cv, cx, cy, g);
      const gl = Math.hypot(g[0], g[1]) || 1;
      const side = f >= 0 ? 1 : -1;
      return { cv, d: Math.abs(f) / Math.max(gl, 0.3), nx: (side * g[0]) / gl, ny: (side * g[1]) / gl, side };
    };
    const border: Rail[] = [];
    d.curves.forEach((cv, i) => {
      let qx = cx;
      let qy = cy;
      const g = [0, 0];
      for (let it = 0; it < 4; it++) {
        const f = curveAt(cv, qx, qy, g);
        const gg = Math.max(g[0] * g[0] + g[1] * g[1], 0.09);
        qx -= (f * g[0]) / gg;
        qy -= (f * g[1]) / gg;
      }
      if (curveRuns(d, cv, qx, qy) && ((sigmaAt(d, qx, qy) ^ sigma) & ~(1 << i)) === 0) border.push(railOf(cv));
    });
    border.sort((u, w) => u.d - w.d);
    // its rails: the two it lies between, most nearly facing each other, if any do; else the nearest, and across from
    // it the rail beyond the plain's edge most nearly facing it; else the nearest alone
    let a = border.length ? border[0] : railOf(d.curves[0]);
    let b: Rail | null = null;
    let best = -0.3;
    for (let i = 0; i < border.length; i++) {
      for (let j = i + 1; j < border.length; j++) {
        const dot = border[i].nx * border[j].nx + border[i].ny * border[j].ny;
        if (dot < best) {
          best = dot;
          a = border[i];
          b = border[j];
        }
      }
    }
    if (!b) {
      for (const ph of d.phantoms) {
        const r = railOf(ph);
        const dot = r.nx * a.nx + r.ny * a.ny;
        if (dot < best) {
          best = dot;
          b = r;
        }
      }
    }
    const hs = hash32((Math.imul(p + 1, 0x85ebca6b) ^ Math.imul(sigma + 1, 0xc2b2ae35) ^ (seed + 0x5ec1)) >>> 0);
    const W = pl.strip[0] + (pl.strip[1] - pl.strip[0]) * unit(hs);
    const gap = b ? a.d + b.d : 0;
    const n = b ? Math.max(1, Math.round(gap / W)) : 0;
    const width = b ? gap / n : W;
    // its crossings, in some sections: along a third curve that lies across its strips, or else straight across them
    let c: Curve | null = null;
    let sc = 1;
    let straight = false;
    let tx = 0;
    let ty = 0;
    let t0 = 0;
    const L = pl.cross[0] + (pl.cross[1] - pl.cross[0]) * unit(hash32(hs ^ 0x51));
    if (unit(hash32(hs ^ 0x52)) < pl.crossed) {
      const third = border.find((e) => e !== a && e !== b && Math.abs(e.nx * a.nx + e.ny * a.ny) < 0.5);
      if (third) {
        c = third.cv;
        sc = third.side;
      } else {
        straight = true;
        tx = -a.ny;
        ty = a.nx;
        t0 = cx * tx + cy * ty + L * unit(hash32(hs ^ 0x53));
      }
    }
    const wo = [unit(hash32(hs ^ 0x54)) * 97, unit(hash32(hs ^ 0x55)) * 97, unit(hash32(hs ^ 0x56)) * 97] as const;
    const sec: Section = { a: a.cv, sa: a.side, b: b ? b.cv : null, sb: b ? b.side : 1, n, W, off: pl.minor / 2 / width, c, sc, straight, tx, ty, t0, L, coff: pl.minor / 2 / L, wo };
    d.sections.set(sigma, sec);
    return sec;
  };
  /** A section's lines' own bend at (X, Y) (in strips: k a second noise, for its crossings). */
  const bendAt = (sec: Section, X: number, Y: number, k: number): number =>
    gnoise(X / 18 + sec.wo[0] + 31 * k, Y / 18 + sec.wo[1], sec.wo[2], (seed + 0x5ec3) >>> 0);
  /** A section's strip coordinate at (X, Y): 0 along rail a, n along rail b (or a strip's width a unit from a alone), each line bending a little of its own. */
  const stripAt = (sec: Section, X: number, Y: number): number => {
    const da = sec.sa * curveDist(sec.a, X, Y);
    const bend = pl.bend * bendAt(sec, X, Y, 0);
    if (!sec.b) return da / sec.W + bend;
    const db = sec.sb * curveDist(sec.b, X, Y);
    const pa = Math.max(da, 0);
    const pb = Math.max(db, 0);
    return (sec.n * pa) / Math.max(pa + pb, 1e-9) + bend;
  };
  /** Whether a section's strips are crossed. */
  const crossed = (sec: Section): boolean => sec.c !== null || sec.straight;
  /** A section's crossing coordinate at (X, Y) (0 where it is not crossed). */
  const crossAt = (sec: Section, X: number, Y: number): number => {
    if (sec.c) return (sec.sc * curveDist(sec.c, X, Y)) / sec.L + 0.6 * pl.bend * bendAt(sec, X, Y, 1);
    if (!sec.straight) return 0;
    return (X * sec.tx + Y * sec.ty - sec.t0) / sec.L + 0.6 * pl.bend * bendAt(sec, X, Y, 1);
  };
  /** A field: its plain, section, strip and crossing. */
  const fieldKey = (p: number, sigma: number, t: number, u: number): number => ((p * 64 + sigma) * 512 + (t + 128)) * 256 + (u + 128);
  /** A vertex's field, or −1 within a groove's reach (so a square whose five agree holds no line). */
  const fieldOfVertex = (v: number, p: number): number => {
    const d = divisions[p];
    onPlane(d, D[3 * v], D[3 * v + 1], D[3 * v + 2], loc);
    const [X, Y] = loc;
    for (const cv of d.curves) if (Math.abs(curveDist(cv, X, Y)) < cv.half + pl.minor && curveRuns(d, cv, X, Y)) return -1;
    const sigma = sigmaAt(d, X, Y);
    const sec = sectionOf(p, sigma, X, Y);
    // (its strip as the cut pieces take it: before the first, the first; past the last, the last; near a line between
    // two strips — not a rail — none)
    const f = stripAt(sec, X, Y);
    const t = Math.min(Math.max(Math.floor(f), 0), sec.b ? sec.n - 1 : Infinity);
    const width = sec.b ? pl.minor / 2 / sec.off : sec.W;
    if (t >= 1 && (f - t) * width < pl.minor / 2 + 0.3) return -1;
    if ((!sec.b || t + 1 < sec.n) && (t + 1 - f) * width < pl.minor / 2 + 0.3) return -1;
    const g = crossAt(sec, X, Y);
    const u = Math.floor(g);
    if (crossed(sec) && Math.min(g - u, u + 1 - g) * sec.L < pl.minor / 2 + 0.3) return -1;
    return fieldKey(p, sigma, t, u);
  };

  // the sides pieces are cut by (one per field and level, sharing their crossings with the outlines)
  const inWoods = new Side(grid, SLOT.woods, steepF, (v) => woodsIdx[v] === 1, true, steepV);
  const outWoods = new Side(grid, SLOT.woods, steepF, (v) => woodsIdx[v] === 1, false, steepV);
  // (a plain: its edge where its distance from it passes 0)
  const plainF: Field = (x, y, z) => plainIn(x, y, z);
  const plainMemo = new Map<number, number>();
  const plainV = (v: number): number => {
    let q = plainMemo.get(v);
    if (q === undefined) {
      q = plainIn(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      plainMemo.set(v, q);
    }
    return q;
  };
  const inPlain = new Side(grid, SLOT.zone, plainF, (v) => plainV(v) >= 0, true, plainV);
  const outPlain = new Side(grid, SLOT.zone, plainF, (v) => plainV(v) >= 0, false, plainV);
  // (a plain's collar: its outer edge, where the land is its own again)
  const collarIn = (x: number, y: number, z: number): number => {
    const p = plainAt(x, y, z);
    return p < 0 ? -1 : rasters[p].collar - plainDist(p, x, y, z);
  };
  const collarMemo = new Map<number, number>();
  const collarV = (v: number): number => {
    let q = collarMemo.get(v);
    if (q === undefined) {
      q = collarIn(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
      collarMemo.set(v, q);
    }
    return q;
  };
  const inCollar = new Side(grid, SLOT.zone + 1, collarIn, (v) => collarV(v) >= 0, true, collarV);
  const outCollar = new Side(grid, SLOT.zone + 1, collarIn, (v) => collarV(v) >= 0, false, collarV);
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
  // the plains' lines' sides: each field kept back from its lines by their half-widths (the grooves between), a slot
  // each, the side each vertex is on kept
  let nextSlot = SLOT.fields;
  const lineSides = new Map<string, Side>();
  const lineSide = (key: string, f: (X: number, Y: number) => number, p: number): Side => {
    let sd = lineSides.get(key);
    if (!sd) {
      const d = divisions[p];
      const at = [0, 0];
      const f3: Field = (x, y, z) => {
        onPlane(d, x, y, z, at);
        return f(at[0], at[1]);
      };
      const known = new Map<number, number>();
      const fv = (v: number): number => {
        let q = known.get(v);
        if (q === undefined) {
          q = f3(D[3 * v], D[3 * v + 1], D[3 * v + 2]);
          known.set(v, q);
        }
        return q;
      };
      sd = new Side(grid, nextSlot++, f3, (v) => fv(v) >= 0, true, fv);
      lineSides.set(key, sd);
    }
    return sd;
  };
  /** A field's side of a major curve (s: which), kept back from it by its half-width. */
  const majorSide = (p: number, i: number, s: number): Side => {
    const cv = divisions[p].curves[i];
    return lineSide(`${p} m${i} ${s}`, (X, Y) => s * curveDist(cv, X, Y) - cv.half, p);
  };
  /** A field's side of the line t between a section's strips (or crossings): above it or below, kept back. */
  const stripSide = (p: number, sigma: number, t: number, above: boolean): Side => {
    const d = divisions[p];
    const sec = d.sections.get(sigma) as Section;
    return lineSide(`${p} s${sigma} ${t} ${above}`, (X, Y) => (above ? stripAt(sec, X, Y) - t - sec.off : t - sec.off - stripAt(sec, X, Y)), p);
  };
  const crossSide = (p: number, sigma: number, u: number, above: boolean): Side => {
    const d = divisions[p];
    const sec = d.sections.get(sigma) as Section;
    return lineSide(`${p} c${sigma} ${u} ${above}`, (X, Y) => (above ? crossAt(sec, X, Y) - u - sec.coff : u - sec.coff - crossAt(sec, X, Y)), p);
  };

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
  // the fields' triangles: points, field, chunk; per field its plain; per plain the squares its fields lie in
  const plotTri = new Grow(new Int32Array(1 << 16));
  const plotIds = new Map<number, number>();
  const plotPlain: number[] = [];
  const plainSquares = new Map<number, number[]>();
  // the paddies' pieces: per triangle slot (4 a square) its first piece, first band and count; per piece whether it
  // holds any of the floor, whether a cut parts it, its band; the pieces' triangles (points, piece, chunk)
  const slots = 4 * 6 * m * m;
  const slotFirst = new Int32Array(slots).fill(-1);
  const slotK0 = new Int32Array(slots);
  const slotCount = new Uint8Array(slots);
  const pieceValid = new Grow(new Uint8Array(1 << 16));
  const pieceParted = new Grow(new Uint8Array(1 << 16));
  const pieceBand = new Grow(new Int32Array(1 << 16));
  const paddyTri = new Grow(new Int32Array(1 << 18));
  // the halves of parted pieces: points, piece, cut, side, chunk
  const halfTri = new Grow(new Int32Array(1 << 12));
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
        // (whole squares: the woods, a field, a band with no cut through it)
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
        // (a plain's, if one reaches here)
        const pp = squarePlain[si];
        if (pp >= 0 && five.every((v) => plainV(v) >= 0)) {
          const key = fieldOfVertex(five[0], pp);
          if (key >= 0 && five.every((v) => fieldOfVertex(v, pp) === key)) {
            const plot = plotIndex(key, pp);
            for (const [a, b, c] of [
              [0, 1, 2],
              [0, 2, 3],
            ]) {
              for (const k of [a, b, c]) plotTri.push(corners[k]);
              plotTri.push(plot);
              plotTri.push(chunk);
            }
            const list = plainSquares.get(pp);
            if (list) list.push(si);
            else plainSquares.set(pp, [si]);
            continue;
          }
        }
        const k0 = bands.band[five[0]];
        if (five.every((v) => !woodsIdx[v] && bands.band[v] === k0 && !(pp >= 0 && (plainV(v) >= 0 || (k0 === plainBand[pp] && collarV(v) >= 0)))) && !cutSquare.has(si * L + k0)) {
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
            for (const k of [a, b, c]) paddyTri.push(corners[k]);
            paddyTri.push(piece);
            paddyTri.push(chunk);
          }
          continue;
        }
        let onFlats = false;
        for (let q = 0; q < 4; q++) {
          const tri: Corner[] = [vertexCorner(grid, t[3 * q]), vertexCorner(grid, t[3 * q + 1]), vertexCorner(grid, t[3 * q + 2])];
          const w = clip(tri, inWoods);
          fan(w, (a, b, c) => {
            woodsTri.push(a.id);
            woodsTri.push(b.id);
            woodsTri.push(c.id);
            woodsTri.push(chunk);
          });
          let r = clip(tri, outWoods);
          if (r.length < 3) continue;
          const vs = [t[3 * q], t[3 * q + 1], t[3 * q + 2]];
          if (pp >= 0) {
            // (a plain first, as the lab's flats: on it its fields, the bands only round it)
            const fl = clip(r, inPlain);
            if (fl.length >= 3) {
              onFlats = true;
              fieldsOf(fl, pp, chunk);
            }
            r = clip(r, outPlain);
            if (r.length < 3) continue;
          }
          const b0 = Math.min(...vs.map((v) => bands.band[v]));
          const b1 = Math.max(...vs.map((v) => bands.band[v]));
          const slot = 4 * si + q;
          slotK0[slot] = b0;
          slotCount[slot] = Math.min(b1 - b0 + 1, 255);
          slotFirst[slot] = pieceValid.n;
          for (let k = b0; k <= b1; k++) newPiece(k);
          for (let k = b0; k <= b1; k++) {
            let pc = clip(clip(r, bandFrom(k)), bandTo(k + 1));
            if (pc.length < 3) continue;
            if (pp >= 0 && k === plainBand[pp]) {
              // (the plain's own level round it, in its collar: its fields too, up to the banks)
              const fl = clip(pc, inCollar);
              if (fl.length >= 3) {
                onFlats = true;
                fieldsOf(fl, pp, chunk);
              }
              pc = clip(pc, outCollar);
              if (pc.length < 3) continue;
            }
            const id = slotFirst[slot] + (k - b0);
            pieceValid.a[id] = 1;
            fan(pc, (a, b, c) => {
              paddyTri.push(a.id);
              paddyTri.push(b.id);
              paddyTri.push(c.id);
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
                halfTri.push(a.id);
                halfTri.push(b.id);
                halfTri.push(c.id);
                halfTri.push(id);
                halfTri.push(cut);
                halfTri.push(sign);
                halfTri.push(chunk);
              });
            }
          }
        }
        if (onFlats) {
          const list = plainSquares.get(pp);
          if (list) list.push(si);
          else plainSquares.set(pp, [si]);
        }
      }
    }
  }
  stats.pieces = pieceValid.n;
  time('Pieces');

  function plotIndex(key: number, plain: number): number {
    let i = plotIds.get(key);
    if (i === undefined) {
      i = plotIds.size;
      plotIds.set(key, i);
      plotPlain.push(plain);
    }
    return i;
  }
  /** A piece of a plain cut into its fields: split along each major curve its corners lie either side of, each section's part into its strips and crossings, every field kept back from its lines. */
  function fieldsOf(piece: Corner[], p: number, chunk: number): void {
    const d = divisions[p];
    const at = [0, 0];
    const plane = (c: Corner): number[] => onPlane(d, c.x, c.y, c.z, at);
    let parts: Array<[Corner[], number]> = [[piece, 0]];
    d.curves.forEach((cv, i) => {
      const next: Array<[Corner[], number]> = [];
      for (const [pc, sigma] of parts) {
        // (a curve that branches off another runs on one side of it only)
        if (cv.parent >= 0 && (((sigma >> cv.parent) & 1) === 1 ? 1 : -1) !== cv.pside) {
          next.push([pc, sigma]);
          continue;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of pc) {
          plane(c);
          const v = curveDist(cv, at[0], at[1]);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        if (lo >= cv.half + 0.05) next.push([pc, sigma | (1 << i)]);
        else if (hi <= -cv.half - 0.05) next.push([pc, sigma]);
        else {
          const a = clip(pc, majorSide(p, i, 1));
          if (a.length >= 3) next.push([a, sigma | (1 << i)]);
          const b = clip(pc, majorSide(p, i, -1));
          if (b.length >= 3) next.push([b, sigma]);
        }
      }
      parts = next;
    });
    for (const [pc, sigma] of parts) {
      plane(pc[0]);
      const sec = sectionOf(p, sigma, at[0], at[1]);
      const fs: number[] = [];
      const gs: number[] = [];
      for (const c of pc) {
        plane(c);
        fs.push(stripAt(sec, at[0], at[1]));
        gs.push(crossAt(sec, at[0], at[1]));
      }
      // (before rail a's first line still the first strip's, past rail b's last still the last's: as fieldOfVertex)
      const tHi = Math.max(sec.b ? Math.min(Math.floor(Math.max(...fs)), sec.n - 1) : Math.floor(Math.max(...fs)), 0);
      const tLo = Math.min(Math.max(Math.floor(Math.min(...fs)), 0), tHi);
      const uLo = Math.floor(Math.min(...gs));
      const uHi = Math.floor(Math.max(...gs));
      for (let t = tLo; t <= tHi; t++) {
        // (no line along a rail: the major curve's side keeps the field back there)
        let st = pc;
        if (t > 0 && Math.min(...fs) < t + sec.off + 0.01) st = clip(st, stripSide(p, sigma, t, true));
        if ((!sec.b || t + 1 < sec.n) && Math.max(...fs) > t + 1 - sec.off - 0.01) st = clip(st, stripSide(p, sigma, t + 1, false));
        if (st.length < 3) continue;
        for (let u = uLo; u <= uHi; u++) {
          let cu = st;
          if (crossed(sec)) {
            if (Math.min(...gs) < u + sec.coff + 0.01) cu = clip(cu, crossSide(p, sigma, u, true));
            if (Math.max(...gs) > u + 1 - sec.coff - 0.01) cu = clip(cu, crossSide(p, sigma, u + 1, false));
          }
          if (cu.length < 3) continue;
          const plot = plotIndex(fieldKey(p, sigma, t, u), p);
          fan(cu, (a, b, c) => {
            plotTri.push(a.id);
            plotTri.push(b.id);
            plotTri.push(c.id);
            plotTri.push(plot);
            plotTri.push(chunk);
          });
        }
      }
    }
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
    // (variant, place in the season, its plants' and its water's own share; never fallow: the lab's paddies take the
    // aerial's six looks only)
    [unit(hash32((h ^ 0x51) >>> 0)), delayOf(u), unit(hash32((h ^ 0x63) >>> 0)), unit(hash32((h ^ 0x25) >>> 0)), 0];
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

  // the fields' floors: every field of a plain at its level, co-planar (the plain is held level there)
  const plotFloor = Float64Array.from(plotPlain, (p) => plainLevel[p]);
  stats.fields = plotIds.size;
  const plotCrop: number[][] = [];
  // (the fields planted and grown, each its own green, lime to deep, as in Kai's aerial)
  for (const [key, i] of plotIds) plotCrop[i] = cropOf(0.46 + 0.54 * unit(hash32((key ^ (seed + 78)) >>> 0)), hash32((key + seed) >>> 0));

  // the floors and the woods' ground, chunk by chunk
  const chunks = Array.from({ length: 6 * CHUNKS * CHUNKS }, () => new Chunk());
  const floorVertex = (c: Chunk, id: number, owner: number, h: number, crop: number[]): number => {
    const key = id * 4194304 + owner;
    const known = c.shared.get(key);
    if (known !== undefined) return known;
    grid.point(id, tmp);
    const s = R + h;
    const v = c.vertex(tmp[0] * s, tmp[1] * s, tmp[2] * s, PART.floor, crop, h, crop[4], 0, 0, tmp);
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
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, paddyTri.a[i + k], owner, h, crop));
  }
  for (let i = 0; i < halfTri.n; i += 7) {
    const piece = halfTri.a[i + 3];
    const cut = halfTri.a[i + 4];
    const sign = halfTri.a[i + 5];
    const c = chunks[halfTri.a[i + 6]];
    const owner = find(sideOf.get(cut * 2 + (sign > 0 ? 0 : 1)) ?? piece);
    const crop = paddyCrop(owner);
    const h = floorOf(pieceBand.a[piece]);
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, halfTri.a[i + k], owner, h, crop));
  }
  const PLOTS = 4194304 - 65536;
  for (let i = 0; i < plotTri.n; i += 5) {
    const plot = plotTri.a[i + 3];
    const c = chunks[plotTri.a[i + 4]];
    for (let k = 0; k < 3; k++) c.index.push(floorVertex(c, plotTri.a[i + k], PLOTS + plot, plotFloor[plot], plotCrop[plot]));
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
        const h = field.ground(tmp[0], tmp[1], tmp[2], g3);
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

  // the floor a direction stands on: the woods' ground, a field's floor, a band's
  const surfaceAt = (x: number, y: number, z: number): number => {
    const cls = classAt(x, y, z);
    if (cls === 0) return field.ground(x, y, z);
    if (cls === 1) return plainLevel[plainAt(x, y, z)];
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
    // where it is a bank: its band still there (not pinched out), and farmed (a paddy's or a plain's edge, not the
    // woods')
    const present = new Uint8Array(count);
    const cls = new Int8Array(count);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
      const [qx, qy, qz] = moveTo(x, y, z, N[3 * i], N[3 * i + 1], N[3 * i + 2], 0.04);
      present[i] = bands.bandAt(qx, qy, qz) === k ? 1 : 0;
      cls[i] = classAt(qx, qy, qz);
    }
    const built = new Uint8Array(count);
    {
      const ok = new Uint8Array(count);
      for (let i = 0; i < count; i++) ok[i] = present[i] && cls[i] !== 0 ? 1 : 0;
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
        bank(run.idx, run.closed);
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

    /** A bank along the points idx: a dam and a riser under it. */
    function bank(idx: number[], closed: boolean): void {
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
        w[i] = widthAt(x, y, z);
        Hd[i] = heightAt(x, y, z);
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
          ch.vertex((x / l) * (R + h), (y / l) * (R + h), (z / l) * (R + h), s < 0.7 ? PART.bund : PART.bundSide, NONE, floor, 0, 0, 0);
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
          const f = ch.vertex(x * (R + floor - UNDER), y * (R + floor - UNDER), z * (R + floor - UNDER), PART.bundSide, NONE, floor, 0, 0, 0);
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
  // the lines between the plains' fields, sunk: the fields' surfaces stand over them (the crop over its bunds), dark,
  // the major curves' wider and deeper; along each plain's first major curve a track, pale and barely sunk. Each line
  // traced over its plain's squares on its own field, kept where the plain is (a section's strips and crossings
  // within their section), carried on a little past its ends under whatever it runs into; its lips a hair under
  // the fields and on under their edges, so nothing between shows a gap.
  const groove = (src: number[], closed: boolean, half: number, depth: number, track: boolean, level: number): void => {
    if (src.length < 6) return;
    let pts = src;
    if (!closed) {
      const n = src.length / 3;
      const head = past([src[0], src[1], src[2]], [src[3], src[4], src[5]], OVERLAP);
      const tail = past([src[3 * n - 3], src[3 * n - 2], src[3 * n - 1]], [src[3 * n - 6], src[3 * n - 5], src[3 * n - 4]], OVERLAP);
      pts = [...head, ...src, ...tail];
    }
    const lip = 0.012;
    const prof: Array<[number, number]> = track
      ? [
          [-(half + 0.06), lip],
          [-half, lip],
          [-0.8 * half, depth],
          [0.8 * half, depth],
          [half, lip],
          [half + 0.06, lip],
        ]
      : [
          [-(half + 0.06), lip],
          [-half, lip],
          [-0.55 * half, 0.7 * depth],
          [0, depth],
          [0.55 * half, 0.7 * depth],
          [half, lip],
          [half + 0.06, lip],
        ];
    const c = pts.length / 3;
    const N = normals(pts, closed);
    const ch = chunks[chunkAt(pts[0], pts[1], pts[2])];
    const r0 = ch.count;
    const part = track ? PART.track : PART.earth;
    for (let i = 0; i < c; i++) {
      for (const [s, dz] of prof) {
        const [x, y, z] = moveTo(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2], -s);
        const h = level - dz;
        ch.vertex(x * (R + h), y * (R + h), z * (R + h), part, NONE, level, 0, 0, 0);
      }
    }
    const M = prof.length;
    for (let i = 0; i < (closed ? c : c - 1); i++) {
      const a = r0 + i * M;
      const b = r0 + ((i + 1) % c) * M;
      for (let j = 0; j + 1 < M; j++) quad(ch, a + j, b + j, b + j + 1, a + j + 1);
    }
    // (its ends closed: the profile fanned from its first point)
    if (!closed) {
      for (const i of [0, c - 1]) {
        for (let j = 1; j + 1 < M; j++) {
          if (i === 0) tri(ch, r0 + i * M, r0 + i * M + j + 1, r0 + i * M + j);
          else tri(ch, r0 + i * M, r0 + i * M + j, r0 + i * M + j + 1);
        }
      }
    }
  };
  const lineIdx = new Int32Array(V);
  const lineSlots = new Map<string, number>();
  let grooves = 0;
  for (const [p, squares] of plainSquares) {
    const d = divisions[p];
    const level = plainLevel[p];
    const verts = new Set<number>();
    for (const si of squares) {
      const f = Math.floor(si / (m * m));
      const cj = Math.floor((si - f * m * m) / m);
      const t = grid.triangles(f, si - f * m * m - cj * m, cj);
      for (const v of [t[0], t[3], t[6], t[9], t[2]]) verts.add(v);
    }
    const at = [0, 0];
    /** The lines k of a field over the plain (value), each kept where `keep` holds and the plain is, sunk as a groove. */
    const lines = (name: string, value: (X: number, Y: number) => number, take: (k: number) => boolean, keep: (X: number, Y: number) => boolean, half: number, depth: number, track: boolean): void => {
      const known = new Map<number, number>();
      const fv = (v: number): number => {
        let q = known.get(v);
        if (q === undefined) {
          onPlane(d, D[3 * v], D[3 * v + 1], D[3 * v + 2], at);
          q = value(at[0], at[1]);
          known.set(v, q);
        }
        return q;
      };
      for (const v of verts) lineIdx[v] = Math.floor(fv(v));
      const chains = grid.trace(
        lineIdx,
        (u, w, k) => {
          const key = `${p} ${name} ${k}`;
          let slot = lineSlots.get(key);
          if (slot === undefined) {
            slot = nextSlot++;
            lineSlots.set(key, slot);
          }
          const f3: Field = (x, y, z) => {
            onPlane(d, x, y, z, at);
            return value(at[0], at[1]) - k;
          };
          return grid.crossing(slot, u, w, f3, (v) => fv(v) - k);
        },
        squares,
      );
      for (const chain of chains) {
        if (!take(chain.level)) continue;
        const pts = resample(grid, chain, P.edgeSpacing);
        const c = pts.length / 3;
        const ok = new Uint8Array(c);
        for (let i = 0; i < c; i++) {
          onPlane(d, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], at);
          ok[i] = keep(at[0], at[1]) && classAt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]) === 1 ? 1 : 0;
        }
        for (const run of runs(ok, chain.closed)) {
          const r: number[] = [];
          for (const i of run.idx) r.push(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
          groove(r, run.closed, half, depth, track, level);
          grooves++;
        }
      }
    };
    d.curves.forEach((cv, i) => {
      lines(`m${i}`, (X, Y) => (curveAt(cv, X, Y) >= 0 ? 0.5 : -0.5), (k) => k === 0, (X, Y) => curveRuns(d, cv, X, Y), cv.half, cv.track ? 0.035 : 0.18, cv.track);
    });
    for (const [sigma, sec] of d.sections) {
      const inside = (X: number, Y: number): boolean => sigmaAt(d, X, Y) === sigma;
      lines(`s${sigma}`, (X, Y) => stripAt(sec, X, Y), (k) => k >= 1 && (!sec.b || k < sec.n), inside, pl.minor / 2, 0.12, false);
      if (crossed(sec)) lines(`c${sigma}`, (X, Y) => crossAt(sec, X, Y), () => true, inside, pl.minor / 2, 0.12, false);
    }
  }
  stats.grooves = grooves;
  // where a plain meets the terraces, and where the woods meet the farmed land: a ridge between them (where `keep`
  // holds, if given)
  const edgeRidge = (chains: Chain[], width: number, rise: (hl: number, hr: number) => number, wall: number, top: number, keep?: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => boolean): void => {
    const pieces: Array<[number[], boolean]> = [];
    for (const chain of chains) {
      const all = resample(grid, chain, P.edgeSpacing);
      if (!keep) {
        pieces.push([all, chain.closed]);
        continue;
      }
      const n = all.length / 3;
      const An = normals(all, chain.closed);
      const ok = new Uint8Array(n);
      for (let i = 0; i < n; i++) ok[i] = keep(all[3 * i], all[3 * i + 1], all[3 * i + 2], An[3 * i], An[3 * i + 1], An[3 * i + 2]) ? 1 : 0;
      for (const run of runs(ok, chain.closed)) {
        const r: number[] = [];
        for (const i of run.idx) r.push(all[3 * i], all[3 * i + 1], all[3 * i + 2]);
        pieces.push([r, run.closed]);
      }
    }
    for (const [pts, closed] of pieces) {
      const c = pts.length / 3;
      if (c < 2) continue;
      const N = normals(pts, closed);
      const side = (i: number, s: number): number => {
        const [x, y, z] = moveTo(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2], s);
        return surfaceAt(x, y, z);
      };
      // (each side read right at the edge and out at the ridge's foot: where a bank runs into the edge the floor
      // steps between the two, and the ridge covers the higher and reaches down to the lower)
      const far = width / 2 + 0.02;
      const L = Array.from({ length: c }, (_, i) => [side(i, 0.03), side(i, far)]);
      const Rt = Array.from({ length: c }, (_, i) => [side(i, -0.03), side(i, -far)]);
      const ring = (i: number): number => (closed ? (i + c) % c : Math.min(Math.max(i, 0), c - 1));
      const over = (i: number): number => {
        let h = -Infinity;
        for (let d = -2; d <= 2; d++) {
          const j = ring(i + d);
          h = Math.max(h, L[j][0], L[j][1], Rt[j][0], Rt[j][1]);
        }
        return h;
      };
      ridge(pts, closed, () => width, (i) => Math.min(L[i][0], L[i][1]), (i) => Math.min(Rt[i][0], Rt[i][1]), (i) => rise(L[i][1], Rt[i][1]), wall, top, over);
    }
  };
  // (a plain's edge, as the lab's flats': a bund between its fields and the paddies, its wall down to the lower where
  // they step: along its flats where another level meets them, and where its own level goes on past its collar)
  {
    const near = new Int32Array(V);
    const far = new Int32Array(V);
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < m; cj++) {
        for (let ci = 0; ci < m; ci++) {
          if (squarePlain[(f * m + cj) * m + ci] < 0) continue;
          const t = grid.triangles(f, ci, cj);
          for (const v of [t[0], t[3], t[6], t[9], t[2]]) {
            near[v] = plainV(v) >= 0 ? 1 : 0;
            far[v] = collarV(v) >= 0 ? 1 : 0;
          }
        }
      }
    }
    const level = (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number): boolean => {
      const p = plainAt(x, y, z);
      const [qx, qy, qz] = moveTo(x, y, z, nx, ny, nz, s);
      return p >= 0 && bands.bandAt(qx, qy, qz) === plainBand[p];
    };
    edgeRidge(grid.trace(near, (u, w) => grid.crossing(SLOT.zone, u, w, plainF, plainV)), 0.7 * D_.width, () => 0.75 * D_.height, PART.riser, PART.ridge, (x, y, z, nx, ny, nz) => !level(x, y, z, nx, ny, nz, -0.05));
    edgeRidge(grid.trace(far, (u, w) => grid.crossing(SLOT.zone + 1, u, w, collarIn, collarV)), 0.7 * D_.width, () => 0.75 * D_.height, PART.riser, PART.ridge, (x, y, z, nx, ny, nz) => level(x, y, z, nx, ny, nz, 0.05) && level(x, y, z, nx, ny, nz, -0.05));
  }
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
          trees.push(tx, ty, tz, field.ground(tx, ty, tz), look);
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

/** Squared distance (in raster steps) from each raster point to the nearest point whose flag is `to` (Felzenszwalb and Huttenlocher's transform, rows then columns). */
function edt(flag: Uint8Array, nx: number, ny: number, to: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(nx * ny);
  for (let q = 0; q < nx * ny; q++) f[q] = flag[q] === to ? 0 : INF;
  const n = Math.max(nx, ny);
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (len: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + line[v[k]];
    }
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) line[i] = f[j * nx + i];
    pass(nx);
    for (let i = 0; i < nx; i++) f[j * nx + i] = out[i];
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) line[j] = f[j * nx + i];
    pass(ny);
    for (let j = 0; j < ny; j++) f[j * nx + i] = out[j];
  }
  return f;
}

/** A raster blurred (a Gaussian of `sigma` raster steps, rows then columns, its edges held). */
function blur(a: Float32Array, nx: number, ny: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    sum += k[k.length - 1];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const b = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * a[j * nx + Math.min(Math.max(i + t, 0), nx - 1)];
      b[j * nx + i] = s;
    }
  }
  const c = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * b[Math.min(Math.max(j + t, 0), ny - 1) * nx + i];
      c[j * nx + i] = s;
    }
  }
  return c;
}
