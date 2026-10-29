import { Vector3 } from 'three';

// Small spherical-geometry helpers shared by the layout and its GLSL mirror.

const tmp = new Vector3();
const q = new Vector3();

/** Great-circle arc from a to b (unit vectors) with its plane normal. */
export interface Arc {
  readonly a: Vector3;
  readonly b: Vector3;
  readonly n: Vector3;
}

export function makeArc(a: Vector3, b: Vector3): Arc {
  return { a: a.clone(), b: b.clone(), n: new Vector3().crossVectors(a, b).normalize() };
}

/** Angular distance (rad) from unit vector p to the arc. */
export function arcDistance(p: Vector3, arc: Arc): number {
  const s = p.dot(arc.n);
  q.copy(p).addScaledVector(arc.n, -s);
  const inside = tmp.crossVectors(arc.a, q).dot(arc.n) >= 0 && tmp.crossVectors(q, arc.b).dot(arc.n) >= 0;
  if (inside && q.lengthSq() > 1e-12) return Math.asin(Math.min(1, Math.abs(s)));
  return Math.min(angleBetween(p, arc.a), angleBetween(p, arc.b));
}

export function angleBetween(a: Vector3, b: Vector3): number {
  // atan2 form: accurate for small and large angles alike
  return Math.atan2(tmp.crossVectors(a, b).length(), a.dot(b));
}

/** Move unit vector p by `angle` toward unit tangent t (t ⊥ p). */
export function travel(p: Vector3, t: Vector3, angle: number, out: Vector3): Vector3 {
  return out.copy(p).multiplyScalar(Math.cos(angle)).addScaledVector(t, Math.sin(angle)).normalize();
}

/** A unit tangent at p, pointing as close to `toward` as possible. */
export function tangentToward(p: Vector3, toward: Vector3, out: Vector3): Vector3 {
  out.copy(toward).addScaledVector(p, -toward.dot(p));
  if (out.lengthSq() < 1e-12) {
    out.set(p.y, -p.x, 0);
    if (out.lengthSq() < 1e-12) out.set(0, p.z, -p.y);
  }
  return out.normalize();
}

/** Point at fraction t along the great circle from a to b. */
export function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const angle = angleBetween(a, b);
  if (angle < 1e-9) return out.copy(a);
  const s = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  return out.copy(a).multiplyScalar(wa).addScaledVector(b, wb).normalize();
}
