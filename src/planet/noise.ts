// CPU mirror of noise.glsl: gradient noise over an integer lattice hash.
// The hash is bit-identical to the GLSL uint version (Math.imul and >>>
// reproduce 32-bit wrap-around); interpolation differs only by float rounding.

function latticeHash(x: number, y: number, z: number, seed: number): number {
  const h = Math.imul((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ seed) >>> 0, 0x27d4eb2d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function gradDot(h: number, fx: number, fy: number, fz: number): number {
  // Perlin's 16-entry table of the 12 cube-edge gradients (4 repeated)
  const k = (h >>> 4) & 15;
  const u = k < 8 ? fx : fy;
  const v = k < 4 ? fy : k === 12 || k === 14 ? fx : fz;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Gradient noise, range ≈ [-1, 1]. */
export function gnoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const wx = fade(fx);
  const wy = fade(fy);
  const wz = fade(fz);
  const s = seed >>> 0;
  const n000 = gradDot(latticeHash(ix, iy, iz, s), fx, fy, fz);
  const n100 = gradDot(latticeHash(ix + 1, iy, iz, s), fx - 1, fy, fz);
  const n010 = gradDot(latticeHash(ix, iy + 1, iz, s), fx, fy - 1, fz);
  const n110 = gradDot(latticeHash(ix + 1, iy + 1, iz, s), fx - 1, fy - 1, fz);
  const n001 = gradDot(latticeHash(ix, iy, iz + 1, s), fx, fy, fz - 1);
  const n101 = gradDot(latticeHash(ix + 1, iy, iz + 1, s), fx - 1, fy, fz - 1);
  const n011 = gradDot(latticeHash(ix, iy + 1, iz + 1, s), fx, fy - 1, fz - 1);
  const n111 = gradDot(latticeHash(ix + 1, iy + 1, iz + 1, s), fx - 1, fy - 1, fz - 1);
  return mix(mix(mix(n000, n100, wx), mix(n010, n110, wx), wy), mix(mix(n001, n101, wx), mix(n011, n111, wx), wy), wz);
}
