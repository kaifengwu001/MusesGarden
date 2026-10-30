import { Vector3 } from 'three';
import { smoothstep } from '../core/math';

// The sun as each place on the planet sees it. A tiny planet keeps one kind
// of light everywhere: late morning, the sun at the same elevation and on
// the same bearing from local north (toward world +Y). So the sunlight is a
// field fixed to the planet: a cloud's shadow falls the same way under it
// however the globe is turned, and where you look the field is the very sun
// the scene is lit by. North means nothing at the two poles, so near them
// the sun climbs to the zenith, which keeps the field smooth everywhere.
// GPU mirror: localSun() in sun.glsl. Change both together.

/** Distance from a pole (as the sine of the angle): overhead at the first, the day's elevation from the second. */
export const POLE_CAP = [0.0998, 0.435] as const;

const north = new Vector3();
const east = new Vector3();

/**
 * The direction toward the sun seen from `dir` (unit, planet space), for a
 * sun at elevation `elevation` and bearing `azimuth` from north (clockwise
 * seen from above, east = π/2). `out` may not alias `dir`.
 */
export function localSun(dir: Vector3, elevation: number, azimuth: number, out: Vector3): Vector3 {
  north.set(-dir.x * dir.y, 1 - dir.y * dir.y, -dir.z * dir.y);
  const n = north.length();
  if (n > 1e-5) north.divideScalar(n);
  else north.set(1, 0, 0);
  east.crossVectors(north, dir);
  const ce = Math.cos(elevation);
  out
    .copy(dir)
    .multiplyScalar(Math.sin(elevation))
    .addScaledVector(north, Math.cos(azimuth) * ce)
    .addScaledVector(east, Math.sin(azimuth) * ce);
  return out.lerp(dir, 1 - smoothstep(POLE_CAP[0], POLE_CAP[1], n)).normalize();
}
