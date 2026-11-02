import type { Vector3, WebGLCubeRenderTarget, WebGLRenderer } from 'three';

// A baked cube map read back to the CPU, sampled as the GPU samples it
// (textureLod with linear filtering, each face as bake.frag.glsl lays it
// out), so the survey of the hills (survey.ts) reads the very ground the
// shaders draw, a few hundred nanoseconds a sample instead of the fields'
// tens of microseconds. Half floats are kept as they come and decoded on
// reading.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** An IEEE half float (its 16 bits) as a number. */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) {
    if (mant === 0) {
      u32[0] = sign;
      return f32[0];
    }
    // subnormal
    return (sign ? -1 : 1) * mant * 2 ** -24;
  }
  if (exp === 31) {
    u32[0] = sign | 0x7f800000 | (mant << 13);
    return f32[0];
  }
  u32[0] = sign | ((exp + 112) << 23) | (mant << 13);
  return f32[0];
}

/** Which face a direction falls on, and where on it (s, t in [-1, 1]): the inverse of faceDirection in bake.frag.glsl. */
function faceOf(x: number, y: number, z: number, out: { face: number; s: number; t: number }): void {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    if (x > 0) {
      out.face = 0;
      out.s = -z / ax;
      out.t = -y / ax;
    } else {
      out.face = 1;
      out.s = z / ax;
      out.t = -y / ax;
    }
  } else if (ay >= az) {
    if (y > 0) {
      out.face = 2;
      out.s = x / ay;
      out.t = z / ay;
    } else {
      out.face = 3;
      out.s = x / ay;
      out.t = -z / ay;
    }
  } else if (z > 0) {
    out.face = 4;
    out.s = x / az;
    out.t = -y / az;
  } else {
    out.face = 5;
    out.s = -x / az;
    out.t = -y / az;
  }
}

const at = { face: 0, s: 0, t: 0 };

export class CubeReadback {
  private constructor(
    readonly size: number,
    private readonly faces: Uint16Array[],
  ) {}

  /** Read a half-float RGBA cube target back (a stall of a few ms: once per full bake). */
  static read(renderer: WebGLRenderer, target: WebGLCubeRenderTarget): CubeReadback {
    const size = target.width;
    const faces: Uint16Array[] = [];
    for (let f = 0; f < 6; f++) {
      const data = new Uint16Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, data, f);
      faces.push(data);
    }
    return new CubeReadback(size, faces);
  }

  /** Channel c (0 r … 3 a) at a direction, filtered as textureLod does (within a face; clamped at its edges). */
  sample(dir: Vector3, c: number): number {
    faceOf(dir.x, dir.y, dir.z, at);
    const n = this.size;
    const fx = Math.min(Math.max(((at.s + 1) / 2) * n - 0.5, 0), n - 1);
    const fy = Math.min(Math.max(((at.t + 1) / 2) * n - 0.5, 0), n - 1);
    const x0 = Math.min(Math.floor(fx), n - 2);
    const y0 = Math.min(Math.floor(fy), n - 2);
    const tx = fx - x0;
    const ty = fy - y0;
    const d = this.faces[at.face];
    const i00 = (y0 * n + x0) * 4 + c;
    const i10 = i00 + 4;
    const i01 = i00 + n * 4;
    const i11 = i01 + 4;
    const a = halfToFloat(d[i00]) * (1 - tx) + halfToFloat(d[i10]) * tx;
    const b = halfToFloat(d[i01]) * (1 - tx) + halfToFloat(d[i11]) * tx;
    return a * (1 - ty) + b * ty;
  }

  /** All four channels at a direction into out (r, g, b, a), filtered as sample() does. */
  sample4(dir: Vector3, out: Float32Array): Float32Array {
    faceOf(dir.x, dir.y, dir.z, at);
    const n = this.size;
    const fx = Math.min(Math.max(((at.s + 1) / 2) * n - 0.5, 0), n - 1);
    const fy = Math.min(Math.max(((at.t + 1) / 2) * n - 0.5, 0), n - 1);
    const x0 = Math.min(Math.floor(fx), n - 2);
    const y0 = Math.min(Math.floor(fy), n - 2);
    const tx = fx - x0;
    const ty = fy - y0;
    const d = this.faces[at.face];
    const i00 = (y0 * n + x0) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + n * 4;
    const i11 = i01 + 4;
    for (let c = 0; c < 4; c++) {
      const a = halfToFloat(d[i00 + c]) * (1 - tx) + halfToFloat(d[i10 + c]) * tx;
      const b = halfToFloat(d[i01 + c]) * (1 - tx) + halfToFloat(d[i11 + c]) * tx;
      out[c] = a * (1 - ty) + b * ty;
    }
    return out;
  }

  /** Channel c of the texel nearest a direction (no filtering: a cell's key). */
  nearest(dir: Vector3, c: number): number {
    faceOf(dir.x, dir.y, dir.z, at);
    const n = this.size;
    const x = Math.min(Math.max(Math.floor(((at.s + 1) / 2) * n), 0), n - 1);
    const y = Math.min(Math.max(Math.floor(((at.t + 1) / 2) * n), 0), n - 1);
    return halfToFloat(this.faces[at.face][(y * n + x) * 4 + c]);
  }
}
