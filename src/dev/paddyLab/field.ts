import { hash01, Perlin2, type Grad2 } from './noise';

// The paddy lab's ground: a height map from Perlin noise at several scales,
// and the field the terraces are cut from, the height less a slow noise (the
// levels' outlines wander off the height's own contours). Each level also
// wanders on its own (its banks offset in and out along their length,
// independently of the banks above and below, so a band swells, thins and
// now and then pinches out). The slope, smoothed, sorts the ground: too steep
// is left to the woods, too flat is farmed in plain plots, terraces between.

export interface Octave {
  /** Its wavelength (m) and its share of the relief. */
  readonly scale: number;
  readonly weight: number;
}

export interface FieldParams {
  readonly seed: number;
  /** The height map's relief (m: about its largest rise from the mean). */
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

export class TerraceField {
  private readonly noise: Perlin2[];
  private readonly offsetNoise: Perlin2;
  private readonly bankNoise: Perlin2;
  private readonly classNoise: Perlin2;
  private readonly g: Grad2 = { x: 0, y: 0 };
  private readonly k: number;

  constructor(readonly p: FieldParams) {
    this.noise = p.octaves.map((_, o) => new Perlin2(p.seed * 7919 + o * 104729 + 1));
    this.offsetNoise = new Perlin2(p.seed * 7919 + 99991);
    this.bankNoise = new Perlin2(p.seed * 7919 + 77777);
    this.classNoise = new Perlin2(p.seed * 7919 + 55333);
    const total = p.octaves.reduce((s, o) => s + o.weight, 0);
    this.k = p.relief / (total > 0 ? total : 1);
  }

  /** The ground's height (m) at (x, y); its gradient (m per m) into out. */
  height(x: number, y: number, out?: Grad2): number {
    let h = 0;
    let gx = 0;
    let gy = 0;
    for (let o = 0; o < this.noise.length; o++) {
      const { scale, weight } = this.p.octaves[o];
      const s = 1 / scale;
      h += weight * this.noise[o].at(x * s + 17.3 * o, y * s - 9.1 * o, this.g);
      gx += weight * s * this.g.x;
      gy += weight * s * this.g.y;
    }
    if (out) {
      out.x = gx * this.k;
      out.y = gy * this.k;
    }
    return h * this.k;
  }

  /** The field the terraces are cut from (m): the height, less its slow wander; its gradient into out. */
  terrace(x: number, y: number, out?: Grad2): number {
    const h = this.height(x, y, out);
    const s = 1 / this.p.offsetScale;
    const a = this.p.offset * this.p.step;
    const o = this.offsetNoise.at(x * s, y * s, this.g);
    if (out) {
      out.x -= a * s * this.g.x;
      out.y -= a * s * this.g.y;
    }
    return h - a * o;
  }

  /** Level k's own wander at (x, y) (m): a stretch of noise of its own. */
  wander(k: number, x: number, y: number): number {
    const s = 1 / this.p.bankScale;
    return this.p.bank * this.p.step * this.bankNoise.at(x * s + 37.1 * k, y * s - 53.7 * k, this.g);
  }

  /** How steep the ground is (m per m), smoothed: the gradient of its broader octaves, wandering a little at the edges of its classes. */
  slope(x: number, y: number): number {
    let gx = 0;
    let gy = 0;
    for (let o = 0; o < this.noise.length; o++) {
      const { scale, weight } = this.p.octaves[o];
      if (scale < 12) continue;
      const s = 1 / scale;
      this.noise[o].at(x * s + 17.3 * o, y * s - 9.1 * o, this.g);
      gx += weight * s * this.g.x;
      gy += weight * s * this.g.y;
    }
    return Math.hypot(gx, gy) * this.k * (1 + 0.3 * this.classNoise.at(x / 13, y / 13, this.g));
  }

  /** The levels (m) the field is cut at, ascending, from below `lo` to above `hi`. */
  levels(lo: number, hi: number): number[] {
    const s = this.p.step;
    const out: number[] = [];
    for (let k = Math.floor(lo / s) - 4; k <= Math.ceil(hi / s) + 4; k++) out.push(s * (k + this.p.jitter * (hash01(k, this.p.seed) - 0.5)));
    return out;
  }
}
