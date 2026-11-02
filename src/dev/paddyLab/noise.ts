// Perlin's gradient noise in two dimensions, seeded, with its exact gradient
// (the paddy lab's height map and the noise that varies its levels and dams).

const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1, -1];

export interface Grad2 {
  x: number;
  y: number;
}

export class Perlin2 {
  private readonly p = new Uint8Array(512);

  constructor(seed: number) {
    const a = new Uint8Array(256);
    for (let i = 0; i < 256; i++) a[i] = i;
    let s = (seed >>> 0) * 2654435761 + 1;
    for (let i = 255; i > 0; i--) {
      // (xorshift)
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const j = s % (i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = a[i & 255];
  }

  /** The noise at (x, y), about −1 … 1; its gradient into g. */
  at(x: number, y: number, g: Grad2): number {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const fx = x - X;
    const fy = y - Y;
    const p = this.p;
    const a = p[X & 255] + (Y & 255);
    const b = p[(X + 1) & 255] + (Y & 255);
    const g00 = p[a] & 7;
    const g01 = p[a + 1] & 7;
    const g10 = p[b] & 7;
    const g11 = p[b + 1] & 7;
    const n00 = GX[g00] * fx + GY[g00] * fy;
    const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
    const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
    const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const du = 30 * fx * fx * (fx * (fx - 2) + 1);
    const dv = 30 * fy * fy * (fy * (fy - 2) + 1);
    const x0 = n00 + u * (n10 - n00);
    const x1 = n01 + u * (n11 - n01);
    g.x = (1 - v) * (GX[g00] + u * (GX[g10] - GX[g00]) + du * (n10 - n00)) + v * (GX[g01] + u * (GX[g11] - GX[g01]) + du * (n11 - n01));
    g.y = (1 - v) * (GY[g00] + u * (GY[g10] - GY[g00])) + v * (GY[g01] + u * (GY[g11] - GY[g01])) + dv * (x1 - x0);
    return x0 + v * (x1 - x0);
  }
}

/** A number in [0, 1) from an integer and a seed. */
export function hash01(k: number, seed: number): number {
  let h = (Math.imul(k | 0, 2654435761) ^ Math.imul(seed | 0, 2246822519)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return h / 4294967296;
}
