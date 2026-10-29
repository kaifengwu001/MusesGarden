import { Vector3, type PerspectiveCamera } from 'three';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { unwarpPoint, type WarpFrame } from '../render/warp';

// CPU picking that hits what you see. The GPU draws the warped surface, so
// the ray is marched in warped (view) space; each sample is unwarped
// exactly (the warp only moves points along U) and compared with the
// terrain height from the same functions the shaders mirror. A sign change
// is refined by bisection.

export interface Pick {
  /** Unit direction of the hit on the planet. */
  dir: Vector3;
  /** Planet-space hit point. */
  point: Vector3;
  /** Signed distance to water at the hit, m (negative = in water). */
  water: number;
}

const origin = new Vector3();
const ray = new Vector3();
const q = new Vector3();
const p = new Vector3();
const ground = createGroundSample();

function above(t: number, warp: WarpFrame, terrain: Terrain): number {
  q.copy(origin).addScaledVector(ray, t);
  unwarpPoint(warp, q, p);
  const len = p.length();
  return len - (terrain.radius + terrain.sample(p.divideScalar(len), ground).height);
}

/** Pick at normalised device coordinates; null when the ray misses the planet. */
export function pickSurface(camera: PerspectiveCamera, ndcX: number, ndcY: number, warp: WarpFrame, terrain: Terrain): Pick | null {
  origin.copy(camera.position);
  ray.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const R = terrain.radius;
  const far = Math.min(camera.far, origin.length() + 2 * R);
  let t = camera.near;
  let prev = above(t, warp, terrain);
  if (prev < 0) return null;
  while (t < far) {
    const step = Math.max(0.02, Math.min(prev * 0.5, 0.04 * t + 0.05));
    const next = t + step;
    const f = above(next, warp, terrain);
    if (f < 0) {
      let lo = t;
      let hi = next;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid, warp, terrain) > 0) lo = mid;
        else hi = mid;
      }
      above(hi, warp, terrain);
      const dir = p.clone().normalize();
      terrain.sample(dir, ground);
      return { dir, point: dir.clone().multiplyScalar(R + ground.height), water: ground.water };
    }
    t = next;
    prev = f;
  }
  return null;
}
