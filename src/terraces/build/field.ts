import { hash32, unit } from '../../core/hash';
import { gnoise, latticeHash } from '../../planet/noise';

// The terraces' planet in mathematics: the paddy lab's ground (src/dev/
// paddyLab/field.ts) laid on the sphere. The hills are gradient noise at
// several scales in meters, read in the planet's own space (a point on the
// sphere at R), so they are the same shape every way and wrap round the
// planet without a seam; everything else is worked out from them, exactly,
// at whatever point is asked: the field the terraces are cut from (the
// height less a slow noise, so the levels' outlines wander off the height's
// own contours), each level's own wander, and the slope, smoothed (the
// broader octaves' gradient, wandering a little at the edges), which sorts
// the ground: too steep is left to the woods, too flat is farmed in plain
// plots, terraces between. Nothing is read off a mesh or a texture.

export interface Octave {
  /** Its wavelength (m) and its share of the relief. */
  readonly scale: number;
  readonly weight: number;
}

export interface FieldParams {
  readonly seed: number;
  /** The planet's radius (m). */
  readonly radius: number;
  /** The hills' relief (m: about their largest rise from the mean), their octaves. */
  readonly relief: number;
  readonly octaves: readonly Octave[];
  /** The levels: a step apart (m), each moved by up to ± half `jitter` of a step. */
  readonly step: number;
  readonly jitter: number;
  /** All levels' slow wander: its amplitude (× the step) and wavelength (m). */
  readonly offset: number;
  readonly offsetScale: number;
  /** Each level's own wander (× the step) and wavelength (m). */
  readonly bank: number;
  readonly bankScale: number;
  /** The smoothed slope (m per m) past which the ground is left to the woods, and under which it is farmed flat. */
  readonly steep: number;
  readonly flat: number;
}

/** The lab's ground as Kai left it (its second round: a hillside, Perlin noise at four scales) on a planet of R 128. */
export const FIELD: Omit<FieldParams, 'seed'> = {
  radius: 128,
  relief: 36,
  octaves: [
    { scale: 260, weight: 1 },
    { scale: 80, weight: 0.35 },
    { scale: 28, weight: 0.1 },
    { scale: 10, weight: 0.035 },
  ],
  step: 0.38,
  jitter: 0.15,
  offset: 0.35,
  offsetScale: 14,
  bank: 0.4,
  bankScale: 9,
  steep: 0.3,
  flat: 0.06,
};

/** The octaves the smoothed slope reads: those 12 m and broader (the lab's). */
const BROAD = 12;
const SEED = { hills: 0x68, offset: 0x6f, bank: 0x62, cls: 0x63 } as const;

const gc = new Float64Array(24);
const nc = new Float64Array(8);
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const fadeD = (t: number): number => 30 * t * t * (t - 1) * (t - 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Gradient noise (planet/noise.ts gnoise, value for value) and its gradient (∂/∂x, ∂/∂y, ∂/∂z) into g: the
 * corners' gradients blended as their values are, plus each fade's slope times the change across it.
 */
export function gnoiseGrad(x: number, y: number, z: number, seed: number, g: Float64Array): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const s = seed >>> 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1;
    const dy = (c >> 1) & 1;
    const dz = (c >> 2) & 1;
    // Perlin's table (gradDot's): the corner's gradient, then its value
    const k = (latticeHash(ix + dx, iy + dy, iz + dz, s) >>> 4) & 15;
    gc[3 * c] = gc[3 * c + 1] = gc[3 * c + 2] = 0;
    gc[3 * c + (k < 8 ? 0 : 1)] += (k & 1) === 0 ? 1 : -1;
    gc[3 * c + (k < 4 ? 1 : k === 12 || k === 14 ? 0 : 2)] += (k & 2) === 0 ? 1 : -1;
    nc[c] = gc[3 * c] * (fx - dx) + gc[3 * c + 1] * (fy - dy) + gc[3 * c + 2] * (fz - dz);
  }
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const x00 = lerp(nc[0], nc[1], u);
  const x10 = lerp(nc[2], nc[3], u);
  const x01 = lerp(nc[4], nc[5], u);
  const x11 = lerp(nc[6], nc[7], u);
  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);
  const du = lerp(lerp(nc[1] - nc[0], nc[3] - nc[2], v), lerp(nc[5] - nc[4], nc[7] - nc[6], v), w);
  const dv = lerp(x10 - x00, x11 - x01, w);
  const dw = y1 - y0;
  const blend = (a: number): number => lerp(lerp(lerp(gc[a], gc[3 + a], u), lerp(gc[6 + a], gc[9 + a], u), v), lerp(lerp(gc[12 + a], gc[15 + a], u), lerp(gc[18 + a], gc[21 + a], u), v), w);
  g[0] = blend(0) + fadeD(fx) * du;
  g[1] = blend(1) + fadeD(fy) * dv;
  g[2] = blend(2) + fadeD(fz) * dw;
  return lerp(y0, y1, w);
}

export class PlanetField {
  readonly R: number;
  /** Each octave's amplitude (m) and frequency (per m), its noise's offset (so the octaves are not one noise scaled). */
  private readonly amp: number[];
  private readonly freq: number[];
  private readonly shift: number[];
  private readonly g = new Float64Array(3);

  constructor(readonly p: FieldParams) {
    this.R = p.radius;
    const total = p.octaves.reduce((s, o) => s + o.weight, 0);
    const k = p.relief / (total > 0 ? total : 1);
    this.amp = p.octaves.map((o) => o.weight * k);
    this.freq = p.octaves.map((o) => 1 / o.scale);
    this.shift = p.octaves.map((_, o) => 17.3 * o + 0.5);
  }

  /** The hills' height (m) at a unit direction; with `out`, its gradient on the planet (in the tangent plane, m per m). */
  height(x: number, y: number, z: number, out?: Float64Array, broad = false): number {
    const R = this.R;
    let h = 0;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let o = 0; o < this.amp.length; o++) {
      if (broad && 1 / this.freq[o] < BROAD) continue;
      const f = this.freq[o] * R;
      const s = this.shift[o];
      if (out) {
        h += this.amp[o] * gnoiseGrad(x * f + s, y * f - s, z * f + s, (this.p.seed + SEED.hills + o) >>> 0, this.g);
        // (∂/∂ of the point at R: the noise's own gradient times its frequency in meters)
        const a = this.amp[o] * this.freq[o];
        gx += a * this.g[0];
        gy += a * this.g[1];
        gz += a * this.g[2];
      } else h += this.amp[o] * gnoise(x * f + s, y * f - s, z * f + s, (this.p.seed + SEED.hills + o) >>> 0);
    }
    if (out) tangent(gx, gy, gz, x, y, z, out);
    return h;
  }

  /** The slow wander every level shares (m: subtracted from the height); with `out`, its gradient. */
  private offsetAt(x: number, y: number, z: number, out?: Float64Array): number {
    const f = this.R / this.p.offsetScale;
    const a = this.p.offset * this.p.step;
    if (!out) return a * gnoise(x * f, y * f, z * f, (this.p.seed + SEED.offset) >>> 0);
    const v = a * gnoiseGrad(x * f, y * f, z * f, (this.p.seed + SEED.offset) >>> 0, this.g);
    tangent((a / this.p.offsetScale) * this.g[0], (a / this.p.offsetScale) * this.g[1], (a / this.p.offsetScale) * this.g[2], x, y, z, out);
    return v;
  }

  private readonly og = new Float64Array(3);

  /** The field the terraces are cut from (m): the height less its slow wander; with `out`, its gradient. */
  terrace(x: number, y: number, z: number, out?: Float64Array): number {
    const h = this.height(x, y, z, out);
    if (!out) return h - this.offsetAt(x, y, z);
    const o = this.offsetAt(x, y, z, this.og);
    out[0] -= this.og[0];
    out[1] -= this.og[1];
    out[2] -= this.og[2];
    return h - o;
  }

  /** Level k's own wander at a direction (m): a stretch of noise of its own. */
  wander(k: number, x: number, y: number, z: number): number {
    const f = this.R / this.p.bankScale;
    return this.p.bank * this.p.step * gnoise(x * f + 37.1 * k, y * f - 53.7 * k, z * f + 21.9 * k, (this.p.seed + SEED.bank) >>> 0);
  }

  /** How steep the ground is (m per m), smoothed: the gradient of its broader octaves, wandering a little at the edges of its classes. */
  slope(x: number, y: number, z: number): number {
    this.height(x, y, z, this.sg, true);
    const f = this.R / 13;
    return Math.hypot(this.sg[0], this.sg[1], this.sg[2]) * (1 + 0.3 * gnoise(x * f, y * f, z * f, (this.p.seed + SEED.cls) >>> 0));
  }

  private readonly sg = new Float64Array(3);

  /**
   * At one point in one pass (the build's samples): the height (m), the terrace field (m) and the smoothed slope,
   * into out [h, t, slope].
   */
  sample(x: number, y: number, z: number, out: Float64Array): Float64Array {
    const R = this.R;
    let h = 0;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let o = 0; o < this.amp.length; o++) {
      const f = this.freq[o] * R;
      const s = this.shift[o];
      const seed = (this.p.seed + SEED.hills + o) >>> 0;
      if (1 / this.freq[o] < BROAD) {
        h += this.amp[o] * gnoise(x * f + s, y * f - s, z * f + s, seed);
        continue;
      }
      h += this.amp[o] * gnoiseGrad(x * f + s, y * f - s, z * f + s, seed, this.g);
      const a = this.amp[o] * this.freq[o];
      gx += a * this.g[0];
      gy += a * this.g[1];
      gz += a * this.g[2];
    }
    tangent(gx, gy, gz, x, y, z, this.sg);
    const c = this.R / 13;
    out[0] = h;
    out[1] = h - this.offsetAt(x, y, z);
    out[2] = Math.hypot(this.sg[0], this.sg[1], this.sg[2]) * (1 + 0.3 * gnoise(x * c, y * c, z * c, (this.p.seed + SEED.cls) >>> 0));
    return out;
  }

  /** The levels (m) the field is cut at, ascending, from below `lo` to above `hi`. */
  levels(lo: number, hi: number): number[] {
    const s = this.p.step;
    const out: number[] = [];
    for (let k = Math.floor(lo / s) - 4; k <= Math.ceil(hi / s) + 4; k++) out.push(s * (k + this.p.jitter * (unit(hash32((Math.imul(k, 2654435761) ^ (this.p.seed + 0x1e7e1)) >>> 0)) - 0.5)));
    return out;
  }
}

/** A gradient in space made a gradient on the planet: its part in the tangent plane at (x, y, z), into out. */
function tangent(gx: number, gy: number, gz: number, x: number, y: number, z: number, out: Float64Array): void {
  const d = gx * x + gy * y + gz * z;
  out[0] = gx - d * x;
  out[1] = gy - d * y;
  out[2] = gz - d * z;
}
