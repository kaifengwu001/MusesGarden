// The signed distance to a closed triangle mesh, on a grid of voxels: the
// surface rasterised into them (each voxel keeping a triangle that crosses
// it), the outside flood-filled in from the box's walls (behind the surface
// grown by `seal` voxels, so a mesh of pieces that only meet, like a sculpt's
// face set into its hood, still holds water; then grown back), the distance to the
// surface by a Euclidean distance transform (Felzenszwalb and Huttenlocher's,
// one axis at a time), and near the surface the exact distance to the
// triangles there, so the zero level is the mesh's own surface, smooth, not
// stepped by the voxels. Sampled trilinearly. museMesh.ts measures a sculpt
// by it: the shade of its creases, how near the face's plate a vertex lies,
// and the body as it would be with no arm on it, for the wave's corrective.

export interface Box {
  x: readonly [number, number];
  y: readonly [number, number];
  z: readonly [number, number];
}

const FAR = 1e20;

export class MeshField {
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly lo: [number, number, number];
  /** Signed distance at the voxels' centres (negative inside). */
  private readonly dist: Float32Array;
  /** A triangle crossing each surface voxel (−1 elsewhere). */
  private readonly tri: Int32Array;

  constructor(
    private readonly position: ArrayLike<number>,
    private readonly index: ArrayLike<number>,
    box: Box,
    private readonly voxel: number,
    seal = 0,
  ) {
    const v = voxel;
    this.lo = [box.x[0], box.y[0], box.z[0]];
    this.nx = Math.ceil((box.x[1] - box.x[0]) / v);
    this.ny = Math.ceil((box.y[1] - box.y[0]) / v);
    this.nz = Math.ceil((box.z[1] - box.z[0]) / v);
    const n = this.nx * this.ny * this.nz;
    this.tri = new Int32Array(n).fill(-1);
    // the surface: points over each triangle no farther apart than half a voxel
    const p = position;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3;
      const b = index[t + 1] * 3;
      const c = index[t + 2] * 3;
      const longest = Math.max(dist3(p, a, b), dist3(p, b, c), dist3(p, c, a));
      const steps = Math.max(1, Math.ceil(longest / (0.5 * v)));
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps;
          const w = j / steps;
          const x = p[a] + (p[b] - p[a]) * u + (p[c] - p[a]) * w;
          const y = p[a + 1] + (p[b + 1] - p[a + 1]) * u + (p[c + 1] - p[a + 1]) * w;
          const z = p[a + 2] + (p[b + 2] - p[a + 2]) * u + (p[c + 2] - p[a + 2]) * w;
          const k = this.cellOf(x, y, z);
          if (k >= 0) this.tri[k] = t / 3;
        }
      }
    }
    // the outside: everything the box's walls reach without crossing the surface (grown by seal voxels)
    const sx = 1;
    const sy = this.nx;
    const sz = this.nx * this.ny;
    const wall = new Uint8Array(n);
    for (let k = 0; k < n; k++) if (this.tri[k] >= 0) wall[k] = 1;
    for (let s = 0; s < seal; s++) {
      const grown = wall.slice();
      for (let k = 0; k < n; k++) {
        if (!wall[k]) continue;
        const x = k % this.nx;
        const y = Math.floor(k / sy) % this.ny;
        const z = Math.floor(k / sz);
        if (x > 0) grown[k - sx] = 1;
        if (x < this.nx - 1) grown[k + sx] = 1;
        if (y > 0) grown[k - sy] = 1;
        if (y < this.ny - 1) grown[k + sy] = 1;
        if (z > 0) grown[k - sz] = 1;
        if (z < this.nz - 1) grown[k + sz] = 1;
      }
      wall.set(grown);
    }
    const outside = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const push = (k: number): void => {
      if (outside[k] || wall[k]) return;
      outside[k] = 1;
      queue[tail++] = k;
    };
    for (let z = 0; z < this.nz; z++) {
      for (let y = 0; y < this.ny; y++) {
        for (let x = 0; x < this.nx; x++) {
          if (x === 0 || y === 0 || z === 0 || x === this.nx - 1 || y === this.ny - 1 || z === this.nz - 1) push(this.at(x, y, z));
        }
      }
    }
    const spread = (): void => {
      while (head < tail) {
        const k = queue[head++];
        const x = k % this.nx;
        const y = Math.floor(k / sy) % this.ny;
        const z = Math.floor(k / sz);
        if (x > 0) push(k - sx);
        if (x < this.nx - 1) push(k + sx);
        if (y > 0) push(k - sy);
        if (y < this.ny - 1) push(k + sy);
        if (z > 0) push(k - sz);
        if (z < this.nz - 1) push(k + sz);
      }
    };
    spread();
    // and grown back up to the surface itself, seal steps
    for (let s = 0; s < seal; s++) {
      const front: number[] = [];
      for (let k = 0; k < n; k++) {
        if (outside[k] || this.tri[k] >= 0) continue;
        const x = k % this.nx;
        const y = Math.floor(k / sy) % this.ny;
        const z = Math.floor(k / sz);
        if ((x > 0 && outside[k - sx]) || (x < this.nx - 1 && outside[k + sx]) || (y > 0 && outside[k - sy]) || (y < this.ny - 1 && outside[k + sy]) || (z > 0 && outside[k - sz]) || (z < this.nz - 1 && outside[k + sz])) front.push(k);
      }
      for (const k of front) outside[k] = 1;
    }
    // the distance (in voxels, squared) to the nearest surface voxel, an axis at a time
    const d = new Float64Array(n);
    for (let k = 0; k < n; k++) d[k] = this.tri[k] >= 0 ? 0 : FAR;
    const line = new Float64Array(Math.max(this.nx, this.ny, this.nz));
    const out = new Float64Array(line.length);
    const vIdx = new Int32Array(line.length);
    const zz = new Float64Array(line.length + 1);
    const pass = (count: number, stride: number, starts: number[]): void => {
      for (const s of starts) {
        for (let i = 0; i < count; i++) line[i] = d[s + i * stride];
        edt1(line, count, out, vIdx, zz);
        for (let i = 0; i < count; i++) d[s + i * stride] = out[i];
      }
    };
    const startsX: number[] = [];
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) startsX.push(this.at(0, y, z));
    pass(this.nx, sx, startsX);
    const startsY: number[] = [];
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) startsY.push(this.at(x, 0, z));
    pass(this.ny, sy, startsY);
    const startsZ: number[] = [];
    for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) startsZ.push(this.at(x, y, 0));
    pass(this.nz, sz, startsZ);
    // a surface voxel's side: most of the voxels about it that are not surface (the fill's word, not a triangle's winding)
    const side = new Int8Array(n);
    for (let k = 0; k < n; k++) {
      if (this.tri[k] < 0) {
        side[k] = outside[k] ? 1 : -1;
        continue;
      }
      const x = k % this.nx;
      const y = Math.floor(k / sy) % this.ny;
      const z = Math.floor(k / sz);
      let vote = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx;
            const Y = y + dy;
            const Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) continue;
            const j = this.at(X, Y, Z);
            if (this.tri[j] < 0) vote += outside[j] ? 1 : -1;
          }
        }
      }
      side[k] = vote >= 0 ? 1 : -1;
    }
    this.dist = new Float32Array(n);
    for (let k = 0; k < n; k++) this.dist[k] = Math.sqrt(d[k]) * v * side[k];
    // near the surface, exact: the triangles in the surface voxels about each voxel
    const c = [0, 0, 0];
    for (let z = 0; z < this.nz; z++) {
      for (let y = 0; y < this.ny; y++) {
        for (let x = 0; x < this.nx; x++) {
          const k = this.at(x, y, z);
          if (Math.abs(this.dist[k]) > 2.5 * v) continue;
          const px = this.lo[0] + (x + 0.5) * v;
          const py = this.lo[1] + (y + 0.5) * v;
          const pz = this.lo[2] + (z + 0.5) * v;
          let best = Infinity;
          const sign = side[k];
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                const X = x + dx;
                const Y = y + dy;
                const Z = z + dz;
                if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) continue;
                const t = this.tri[this.at(X, Y, Z)];
                if (t < 0) continue;
                const d2 = this.closest(t, px, py, pz, c);
                if (d2 < best) best = d2;
              }
            }
          }
          if (best < Infinity) this.dist[k] = Math.sqrt(best) * sign;
        }
      }
    }
  }

  private at(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  private cellOf(x: number, y: number, z: number): number {
    const i = Math.floor((x - this.lo[0]) / this.voxel);
    const j = Math.floor((y - this.lo[1]) / this.voxel);
    const k = Math.floor((z - this.lo[2]) / this.voxel);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return this.at(i, j, k);
  }

  /** The signed distance at a point (trilinear between the voxels' centres; far outside the box, its edge's). */
  sample(x: number, y: number, z: number): number {
    const fx = Math.min(Math.max((x - this.lo[0]) / this.voxel - 0.5, 0), this.nx - 1.001);
    const fy = Math.min(Math.max((y - this.lo[1]) / this.voxel - 0.5, 0), this.ny - 1.001);
    const fz = Math.min(Math.max((z - this.lo[2]) / this.voxel - 0.5, 0), this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const u = fx - i;
    const v = fy - j;
    const w = fz - k;
    const d = this.dist;
    const a = this.at(i, j, k);
    const sy = this.nx;
    const sz = this.nx * this.ny;
    const c00 = d[a] * (1 - u) + d[a + 1] * u;
    const c10 = d[a + sy] * (1 - u) + d[a + sy + 1] * u;
    const c01 = d[a + sz] * (1 - u) + d[a + sz + 1] * u;
    const c11 = d[a + sy + sz] * (1 - u) + d[a + sy + sz + 1] * u;
    return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
  }

  /** The triangle nearest a point (among those crossing the voxels about it), and the closest point on it, or −1. */
  nearest(x: number, y: number, z: number, out: number[]): number {
    const cx = Math.floor((x - this.lo[0]) / this.voxel);
    const cy = Math.floor((y - this.lo[1]) / this.voxel);
    const cz = Math.floor((z - this.lo[2]) / this.voxel);
    const c = [0, 0, 0];
    let best = Infinity;
    let found = -1;
    for (let r = 1; r <= 10 && found < 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const X = cx + dx;
            const Y = cy + dy;
            const Z = cz + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) continue;
            const t = this.tri[this.at(X, Y, Z)];
            if (t < 0) continue;
            const d2 = this.closest(t, x, y, z, c);
            if (d2 < best) {
              best = d2;
              found = t;
              out[0] = c[0];
              out[1] = c[1];
              out[2] = c[2];
            }
          }
        }
      }
    }
    return found;
  }

  /** The squared distance from a point to triangle t, and the closest point on it (Ericson's regions). */
  private closest(t: number, px: number, py: number, pz: number, out: number[]): number {
    const p = this.position;
    const ia = this.index[t * 3] * 3;
    const ib = this.index[t * 3 + 1] * 3;
    const ic = this.index[t * 3 + 2] * 3;
    const ax = p[ia];
    const ay = p[ia + 1];
    const az = p[ia + 2];
    const abx = p[ib] - ax;
    const aby = p[ib + 1] - ay;
    const abz = p[ib + 2] - az;
    const acx = p[ic] - ax;
    const acy = p[ic + 1] - ay;
    const acz = p[ic + 2] - az;
    const apx = px - ax;
    const apy = py - ay;
    const apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let u = 0;
    let w = 0;
    if (d1 <= 0 && d2 <= 0) {
      u = 0;
      w = 0;
    } else {
      const bpx = px - p[ib];
      const bpy = py - p[ib + 1];
      const bpz = pz - p[ib + 2];
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = px - p[ic];
      const cpy = py - p[ic + 1];
      const cpz = pz - p[ic + 2];
      const d5 = abx * cpx + aby * cpy + abz * cpz;
      const d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2;
      const vb = d5 * d2 - d1 * d6;
      const va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) {
        u = 1;
      } else if (d6 >= 0 && d5 <= d6) {
        w = 1;
      } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        u = d1 / (d1 - d3);
      } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        w = d2 / (d2 - d6);
      } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        u = 1 - w;
      } else {
        const denom = 1 / (va + vb + vc);
        u = vb * denom;
        w = vc * denom;
      }
    }
    out[0] = ax + abx * u + acx * w;
    out[1] = ay + aby * u + acy * w;
    out[2] = az + abz * u + acz * w;
    const dx = px - out[0];
    const dy = py - out[1];
    const dz = pz - out[2];
    return dx * dx + dy * dy + dz * dz;
  }
}

function dist3(p: ArrayLike<number>, a: number, b: number): number {
  return Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
}

/** One axis of the squared Euclidean distance transform (Felzenszwalb and Huttenlocher): f in, d out. */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
