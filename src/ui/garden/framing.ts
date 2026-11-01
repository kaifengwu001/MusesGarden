import { PerspectiveCamera, Vector3 } from 'three';
import { smoothstep } from '../../core/math';
import type { Bed } from '../../garden/placement';
import type { Flight, Framing } from '../../view/flight';

/** The height a find lands at over its bed (m). */
export const LANDS_AT = 0.3;
/** Finds close together are seen from a little farther back than a find is, looking at the ground between them (m: off, up, looked-at height). */
const NEAR = { distance: 9.5, height: 3.6, aim: 0 } as const;
/** The view's angle from straight down (rad) a few times higher than NEAR, and from far up. */
const LOOK = { mid: 0.7, high: 0.2 } as const;
/** Where the finds must land on screen (normalized device coordinates): clear of its edges, the rail and the top line. */
export const SCREEN = { x: 0.74, bottom: -0.68, top: 0.6 } as const;

/**
 * The view a basket's flight ends on: over the middle of its finds, as low as still shows them all
 * well inside the screen (finds far apart: high above, looking down). The tiny-planet warp is left out
 * of the check: at the lowest of these views it moves a find a few centimeters.
 */
export function framingToFit(beds: readonly Bed[], flight: Flight, radius: number, ground: (dir: Vector3) => number): Framing {
  const middle = new Vector3();
  for (const bed of beds) middle.add(bed.dir);
  if (middle.lengthSq() < 1e-12) middle.copy(beds[0].dir);
  middle.normalize();
  const height = beds.reduce((sum, b) => sum + b.ground, 0) / beds.length;
  const camera = new PerspectiveCamera();
  const p = new Vector3();
  const fits = (f: Framing): boolean => {
    flight.camera(f, radius, ground, camera);
    return beds.every((bed) => {
      p.copy(bed.dir).multiplyScalar(radius + bed.ground + LANDS_AT);
      // on this side of the horizon, and inside the screen clear of its edges and the rail
      if (camera.position.dot(bed.dir) <= radius + bed.ground + LANDS_AT) return false;
      p.project(camera);
      return p.z > -1 && p.z < 1 && Math.abs(p.x) < SCREEN.x && p.y > SCREEN.bottom && p.y < SCREEN.top;
    });
  };
  let framing: Framing = { dir: middle, ground: height, ...NEAR };
  // from NEAR, up by steps, looking down more steeply (high over a small planet, nearly straight down), until all of them show
  const near = Math.atan2(NEAR.distance, NEAR.height);
  for (let s = 1; s < 160; s *= 1.15) {
    const up = NEAR.height * s;
    const look = near + (LOOK.mid - near) * smoothstep(1, 5, s) + (LOOK.high - LOOK.mid) * smoothstep(5, 30, s);
    framing = { dir: middle, ground: height, distance: up * Math.tan(look), height: up, aim: NEAR.aim };
    if (fits(framing)) break;
  }
  return framing;
}
