import { Vector3 } from 'three';
import type { CubeReadback } from '../bakeReader';

// The terraces' build (build/): one grid over the whole planet, every cube
// face at once, read from the terrain bake (bake.frag.glsl: natural height,
// wild, flat) and its gradient pass (the height's exact gradient, from the
// hills' own derivatives: never differences of heights). A face holds
// (n × n) samples on its corners' lattice (s, t = −1 … 1 inclusive), so two
// faces sample their shared edge at the very same directions; after
// smoothing, those shared samples are averaged over the faces holding them,
// so every face reads the same values there and whatever is built from them
// meets across the edge exactly.

/** A cube face's direction at (s, t) in [−1, 1] (faceDirection in bake.frag.glsl), unit. */
export function faceDirection(face: number, s: number, t: number, out: Vector3): Vector3 {
  if (face === 0) out.set(1, -t, -s);
  else if (face === 1) out.set(-1, -t, s);
  else if (face === 2) out.set(s, 1, t);
  else if (face === 3) out.set(s, -1, -t);
  else if (face === 4) out.set(s, -t, 1);
  else out.set(-s, -t, -1);
  return out.normalize();
}

export interface Grid {
  /** Samples per face side, the planet's radius (m). */
  readonly n: number;
  readonly R: number;
  /** Per face, per sample: its direction (xyz), the bake's natural height (m), smoothed (m), the smoothed hills' slope, wild, flat. */
  readonly dir: Float32Array[];
  readonly h: Float32Array[];
  readonly hs: Float32Array[];
  readonly slope: Float32Array[];
  readonly wild: Float32Array[];
  readonly flat: Float32Array[];
  /** Per face, per sample: the one id every face holding it gives it (a shared edge's samples have one id). */
  readonly gid: Int32Array[];
  /** The ground a sample stands for (m²), and the mean spacing (m). */
  readonly area: Float32Array[];
  readonly spacing: number;
}

/** How far the hills are smoothed before the walls are traced (m): their contours, not their grain. */
/** The grid's spacing it aims at (m: the walls run between samples, placed exactly on the hills' contours), and work per step. */
export const GRID = { smooth: 1.0, spacing: 0.7, slice: 20000 } as const;

/** The grid of the planet at R from the terrain bake and its gradient, n samples a face side; a step of work at a time. */
export function* readGrid(bake: CubeReadback, gradient: CubeReadback, R: number, n: number): Generator<void, Grid, void> {
  const N = n * n;
  const dir: Float32Array[] = [];
  const h: Float32Array[] = [];
  const grad: Float32Array[][] = [[], [], []];
  const wild: Float32Array[] = [];
  const flat: Float32Array[] = [];
  const area: Float32Array[] = [];
  const v = new Vector3();
  const px = new Float32Array(4);
  let done = 0;
  for (let f = 0; f < 6; f++) {
    const d = new Float32Array(N * 3);
    const hh = new Float32Array(N);
    const g = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    const wl = new Float32Array(N);
    const fl = new Float32Array(N);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        faceDirection(f, -1 + (2 * i) / (n - 1), -1 + (2 * j) / (n - 1), v);
        d[3 * k] = v.x;
        d[3 * k + 1] = v.y;
        d[3 * k + 2] = v.z;
        bake.sample4(v, px);
        hh[k] = px[0];
        wl[k] = px[2];
        fl[k] = px[3];
        gradient.sample4(v, px);
        g[0][k] = px[0];
        g[1][k] = px[1];
        g[2][k] = px[2];
      }
      done += 2 * n;
      if (done > GRID.slice) {
        done = 0;
        yield;
      }
    }
    dir.push(d);
    h.push(hh);
    for (let c = 0; c < 3; c++) grad[c].push(g[c]);
    wild.push(wl);
    flat.push(fl);
  }
  // each sample's ground: a quarter of each of the four squares round it (m²)
  let sum = 0;
  for (let f = 0; f < 6; f++) {
    const a = new Float32Array(N);
    const d = dir[f];
    const dist = (k0: number, k1: number): number => R * Math.hypot(d[3 * k0] - d[3 * k1], d[3 * k0 + 1] - d[3 * k1 + 1], d[3 * k0 + 2] - d[3 * k1 + 2]);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const dx = dist(j * n + Math.max(i - 1, 0), j * n + Math.min(i + 1, n - 1)) / (Math.min(i + 1, n - 1) - Math.max(i - 1, 0));
        const dy = dist(Math.max(j - 1, 0) * n + i, Math.min(j + 1, n - 1) * n + i) / (Math.min(j + 1, n - 1) - Math.max(j - 1, 0));
        a[k] = dx * dy;
        sum += Math.sqrt(dx * dy);
      }
    }
    area.push(a);
  }
  const spacing = sum / (6 * N);
  yield;
  // the one id of every sample (a shared edge's or corner's: the first face's)
  const gid: Int32Array[] = [];
  const shared = new Map<string, number>();
  let next = 0;
  for (let f = 0; f < 6; f++) {
    const g = new Int32Array(N);
    for (let k = 0; k < N; k++) {
      const i = k % n;
      const j = (k - i) / n;
      if (i > 0 && j > 0 && i < n - 1 && j < n - 1) {
        g[k] = next++;
        continue;
      }
      const key = keyOf(dir[f], k);
      const known = shared.get(key);
      if (known !== undefined) g[k] = known;
      else {
        g[k] = next;
        shared.set(key, next++);
      }
    }
    gid.push(g);
  }
  // the hills smoothed (a Gaussian, each face on its own) and their gradient with them (the smoothed hills'
  // own: a blur's gradient is the gradient blurred), then every shared sample given the faces' mean
  const sigma = GRID.smooth / spacing;
  const hs: Float32Array[] = [];
  for (let f = 0; f < 6; f++) {
    hs.push(blur(h[f], n, sigma));
    for (let c = 0; c < 3; c++) grad[c][f] = blur(grad[c][f], n, sigma);
    yield;
  }
  agree(hs, gid, n);
  for (let c = 0; c < 3; c++) agree(grad[c], gid, n);
  agree(wild, gid, n);
  agree(flat, gid, n);
  // the smoothed hills' slope: their gradient's length on the planet (the blur mixed in its neighbours' tangents)
  const slope: Float32Array[] = [];
  for (let f = 0; f < 6; f++) {
    const s = new Float32Array(N);
    const d = dir[f];
    for (let k = 0; k < N; k++) {
      const gx = grad[0][f][k];
      const gy = grad[1][f][k];
      const gz = grad[2][f][k];
      const up = gx * d[3 * k] + gy * d[3 * k + 1] + gz * d[3 * k + 2];
      s[k] = Math.hypot(gx - up * d[3 * k], gy - up * d[3 * k + 1], gz - up * d[3 * k + 2]);
    }
    slope.push(s);
  }
  return { n, R, dir, h, hs, slope, wild, flat, gid, area, spacing };
}

/** A direction's key, to a millionth (a shared edge's samples are the same floats on either face). */
function keyOf(d: Float32Array, k: number): string {
  return `${Math.round(d[3 * k] * 1e6)},${Math.round(d[3 * k + 1] * 1e6)},${Math.round(d[3 * k + 2] * 1e6)}`;
}

/** Every sample on a face's edge given the mean over the faces holding it. */
function agree(field: Float32Array[], gid: Int32Array[], n: number): void {
  const sum = new Map<number, [number, number]>();
  const edge = (k: number): boolean => {
    const i = k % n;
    const j = (k - i) / n;
    return i === 0 || j === 0 || i === n - 1 || j === n - 1;
  };
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < n * n; k++) {
      if (!edge(k)) continue;
      const s = sum.get(gid[f][k]) ?? [0, 0];
      s[0] += field[f][k];
      s[1]++;
      sum.set(gid[f][k], s);
    }
  }
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < n * n; k++) {
      if (!edge(k)) continue;
      const s = sum.get(gid[f][k]);
      if (s) field[f][k] = s[0] / s[1];
    }
  }
}

/** A separable Gaussian of σ samples over an n × n face (clamped at its edges). */
function blur(src: Float32Array, n: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const w: number[] = [];
  let total = 0;
  for (let k = -r; k <= r; k++) {
    const x = Math.exp(-(k * k) / (2 * sigma * sigma));
    w.push(x);
    total += x;
  }
  for (let k = 0; k < w.length; k++) w[k] /= total;
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += w[k + r] * src[j * n + Math.min(Math.max(i + k, 0), n - 1)];
      tmp[j * n + i] = s;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += w[k + r] * tmp[Math.min(Math.max(j + k, 0), n - 1) * n + i];
      out[j * n + i] = s;
    }
  }
  return out;
}
