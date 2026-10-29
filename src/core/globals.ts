import { Vector2, Vector3 } from 'three';

/**
 * Uniform objects shared by reference across every material: spread them into
 * a material's `uniforms` and one write per frame updates all of them.
 */
export interface Globals {
  /** World time, s. */
  uTime: { value: number };
  /** Planet radius R, m. */
  uRadius: { value: number };
  /** R_lag: R followed with a 1.5 s log-space lag; drives the growth fades. */
  uRadiusLag: { value: number };
  /** Growth fade band in ln R: (hi, lo, 1/width) — see GrowthBand. */
  uGrowthBand: { value: Vector3 };
  /** Tiny-planet warp: focus point F on the surface, planet space, m. */
  uWarpFocus: { value: Vector3 };
  /** Tiny-planet warp: local up U at F. */
  uWarpUp: { value: Vector3 };
  /** Tiny-planet warp: k = w (1/(2 R_v) − 1/(2 R)), 1/m. */
  uWarpK: { value: number };
  /** Drawing-buffer size, px. */
  uResolution: { value: Vector2 };
}

export function createGlobals(): Globals {
  return {
    uTime: { value: 0 },
    uRadius: { value: 128 },
    uRadiusLag: { value: 128 },
    uGrowthBand: { value: new Vector3(Math.log(128), Math.log(128), 1 / 0.015) },
    uWarpFocus: { value: new Vector3(0, 128, 0) },
    uWarpUp: { value: new Vector3(0, 1, 0) },
    uWarpK: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  };
}
