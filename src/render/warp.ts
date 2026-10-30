import type { Vector3 } from 'three';

// CPU mirror of warp.glsl. Picking, placement checks and tests use these, so
// they must match the shader exactly.

export interface WarpFrame {
  /** Focus point F on the surface, planet space, m. */
  readonly focus: Vector3;
  /** Local up U at F (unit). */
  readonly up: Vector3;
  /** k = w (1/(2 R_v) − 1/(2 R)), 1/m. */
  readonly k: number;
}

/** The visual radius actually used: never below 0.15 R. */
export function effectiveVisualRadius(visualRadius: number, radius: number): number {
  return Math.max(visualRadius, 0.15 * radius);
}

/** Warp strength k for mode blend w ∈ [0,1] (0 = Overview, 1 = Wander). */
export function warpK(w: number, radius: number, visualRadius: number): number {
  const rv = effectiveVisualRadius(visualRadius, radius);
  return w * (1 / (2 * rv) - 1 / (2 * radius));
}

/** Radius the ground curves like on the way down: nearly flat, so the meadow reaches a far horizon. */
export function vistaRadius(radius: number): number {
  return radius / 0.08;
}

/**
 * Warp strength k at camera zoom z (0 Overview … 1 Wander): the true sphere
 * from orbit; on the way down the ground flattens into a broad vista (the
 * meadow reaching to a far horizon, as in the reference still); at eye level
 * it rolls away like a small world of the visual radius. In curvatures:
 * 1/R_eff = 1/R + 2k, blended between 1/R, 1/vistaRadius and 1/R_v.
 */
export function warpForZoom(z: number, radius: number, visualRadius: number): number {
  const s = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const roll = s(0.8, 0.97, z);
  const flat = s(0.42, 0.62, z) * (1 - roll);
  const c = 1 / radius;
  const curvature = c + flat * (1 / vistaRadius(radius) - c) + roll * (1 / effectiveVisualRadius(visualRadius, radius) - c);
  return (curvature - c) / 2;
}

/** |t|² for planet-space point (x, y, z): squared tangent distance from F. */
function tangentLengthSq(f: WarpFrame, x: number, y: number, z: number): number {
  const rx = x - f.focus.x;
  const ry = y - f.focus.y;
  const rz = z - f.focus.z;
  const along = rx * f.up.x + ry * f.up.y + rz * f.up.z;
  const tx = rx - along * f.up.x;
  const ty = ry - along * f.up.y;
  const tz = rz - along * f.up.z;
  return tx * tx + ty * ty + tz * tz;
}

/** Planet space → view space (warpPosition in warp.glsl). `out` may alias `p`. */
export function warpPoint(f: WarpFrame, p: Vector3, out: Vector3): Vector3 {
  const drop = f.k * tangentLengthSq(f, p.x, p.y, p.z);
  return out.set(p.x - drop * f.up.x, p.y - drop * f.up.y, p.z - drop * f.up.z);
}

/**
 * View space → planet space. The warp moves points only along U, which leaves
 * the tangent offset unchanged, so the inverse is exact.
 */
export function unwarpPoint(f: WarpFrame, q: Vector3, out: Vector3): Vector3 {
  const lift = f.k * tangentLengthSq(f, q.x, q.y, q.z);
  return out.set(q.x + lift * f.up.x, q.y + lift * f.up.y, q.z + lift * f.up.z);
}

/** warpNormal in warp.glsl: N' = normalize(N + 2k (U·N) t). `out` may alias `n`. */
export function warpNormal(f: WarpFrame, p: Vector3, n: Vector3, out: Vector3): Vector3 {
  const rx = p.x - f.focus.x;
  const ry = p.y - f.focus.y;
  const rz = p.z - f.focus.z;
  const along = rx * f.up.x + ry * f.up.y + rz * f.up.z;
  const s = 2 * f.k * (f.up.x * n.x + f.up.y * n.y + f.up.z * n.z);
  return out.set(n.x + s * (rx - along * f.up.x), n.y + s * (ry - along * f.up.y), n.z + s * (rz - along * f.up.z)).normalize();
}
