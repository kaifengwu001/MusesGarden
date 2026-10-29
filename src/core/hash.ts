// Deterministic integer hashing. Every random choice in the world is a hash
// of stable integers (seed, class, face, level, cell), never Math.random, so
// the same seed always gives the same world.

/** lowbias32 (Chris Wellons): a fast 32-bit hash with strong avalanche. */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Fold one more 32-bit integer into a running hash. */
export function mix(h: number, v: number): number {
  return hash32((h ^ (Math.imul(v | 0, 0x9e3779b9) + 0x7f4a7c15)) >>> 0);
}

/** A hash as a float in [0, 1) with 24 bits of resolution. */
export function unit(h: number): number {
  return (h >>> 8) * (1 / 16777216);
}

/** Stable 32-bit salt for a class name (FNV-1a), e.g. salt('grass'). */
export function salt(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h >>> 0);
}
