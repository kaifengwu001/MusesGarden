import { Color, Vector3, Vector4, type Texture } from 'three';

/**
 * Look uniforms shared by every lit material: palette, sun, toon bands, haze,
 * bloom front, wind, meadow paint and water. One object, spread into each
 * material's uniforms, written once per frame by the world.
 */
export interface LookUniforms {
  uPalette: { value: Texture | null };
  uSunDir: { value: Vector3 };
  uSunTint: { value: Color };
  uShadeTint: { value: Color };
  uToon: { value: Vector4 };
  uFog: { value: Vector4 };
  uFogUp: { value: Vector3 };
  uBloom: { value: Vector4 };
  uWindVec: { value: Vector4 };
  /** Gust field: wave phase, gust strength, gustiness, wind speed. */
  uGust: { value: Vector4 };
  /** Wind sheen, flower dabs, colour variation, -. */
  uMeadowLook: { value: Vector4 };
  /** Each flower species' middle colour in sun: far drifts blend these. */
  uFloraWash: { value: Color[] };
  /** Dark band under the banks (m), depth tint, glints, time (s). */
  uWaterLook: { value: Vector4 };
  /** Reflection strength, lily pads, -, -. */
  uWaterSky: { value: Vector4 };
  uRipples: { value: Vector4[] };
  /** Radians per pixel, vertical (pattern level of detail). */
  uPixelAngle: { value: number };
  uDebug: { value: number };
}

export const MAX_RIPPLES = 6;

export function createLookUniforms(): LookUniforms {
  return {
    uPalette: { value: null },
    uSunDir: { value: new Vector3(0.3, 0.8, 0.5).normalize() },
    uSunTint: { value: new Color(1, 1, 1) },
    uShadeTint: { value: new Color(1, 1, 1) },
    uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
    uFog: { value: new Vector4(0.003, 0.5, 0, 0.85) },
    uFogUp: { value: new Vector3(0, 1, 0) },
    uBloom: { value: new Vector4(2, 0.06, 0, 0) },
    uWindVec: { value: new Vector4(0, 1, 0, 0.45) },
    uGust: { value: new Vector4(0, 0, 0.5, 0.45) },
    uMeadowLook: { value: new Vector4(0.6, 1, 0.6, 0) },
    uFloraWash: { value: Array.from({ length: 4 }, () => new Color()) },
    uWaterLook: { value: new Vector4(0.6, 0.6, 0.7, 0) },
    uWaterSky: { value: new Vector4(0.8, 0.6, 0, 0) },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 1, 0, -1)) },
    uPixelAngle: { value: 0.001 },
    uDebug: { value: 0 },
  };
}
