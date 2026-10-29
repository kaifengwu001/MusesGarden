import type { Vector3 } from 'three';

// The cube-sphere. Six faces, each parameterised by (a, b) ∈ [-1, 1]² (or
// uv = (a, b)/2 + ½ ∈ [0, 1]²), mapped onto the unit sphere with the
// "spherified cube" (Nowell):
//
//   x' = x √(1 − y²/2 − z²/2 + y²z²/3)    and cyclic permutations
//
// It is much closer to equal-area than normalize() (cells vary by ×1.33
// instead of ×5.2); the remaining variation is the area element J(a, b),
// which density-sensitive code divides out. cubesphere.glsl mirrors this.

export const FACE_COUNT = 6;

type Axis = readonly [number, number, number];

/** Outward normal N, and in-face axes U, V with U × V = N (CCW from outside). */
export const FACE_N: readonly Axis[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const FACE_U: readonly Axis[] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
];
export const FACE_V: readonly Axis[] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
];

/** A point on the cube (one coordinate ±1) → unit sphere. */
export function cubeToSphere(x: number, y: number, z: number, out: Vector3): Vector3 {
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  out.set(
    x * Math.sqrt(Math.max(0, 1 - 0.5 * y2 - 0.5 * z2 + (y2 * z2) / 3)),
    y * Math.sqrt(Math.max(0, 1 - 0.5 * z2 - 0.5 * x2 + (z2 * x2) / 3)),
    z * Math.sqrt(Math.max(0, 1 - 0.5 * x2 - 0.5 * y2 + (x2 * y2) / 3)),
  );
  return out.normalize();
}

/** Face point (a, b) ∈ [-1, 1]² → unit direction. */
export function faceToSphere(face: number, a: number, b: number, out: Vector3): Vector3 {
  const n = FACE_N[face];
  const u = FACE_U[face];
  const v = FACE_V[face];
  return cubeToSphere(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2], out);
}

/** Face uv ∈ [0, 1]² → unit direction. */
export function uvToSphere(face: number, u: number, v: number, out: Vector3): Vector3 {
  return faceToSphere(face, 2 * u - 1, 2 * v - 1, out);
}

export interface FacePoint {
  face: number;
  a: number;
  b: number;
}

/** The face a direction lies on: the axis of its largest component. */
export function faceOf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? 0 : 1;
  if (ay >= az) return y >= 0 ? 2 : 3;
  return z >= 0 ? 4 : 5;
}

/**
 * Unit direction → face point, in closed form. Within a face the map is
 * X = a√(½ − b²/6), Y = b√(½ − a²/6) (the components along U and V), which
 * inverts to a quadratic in a²; the stable root form avoids cancellation.
 */
export function sphereToFace(d: Vector3, out: FacePoint): FacePoint {
  const face = faceOf(d.x, d.y, d.z);
  const len = Math.hypot(d.x, d.y, d.z);
  const u = FACE_U[face];
  const v = FACE_V[face];
  const x = (d.x * u[0] + d.y * u[1] + d.z * u[2]) / len;
  const y = (d.x * v[0] + d.y * v[1] + d.z * v[2]) / len;
  const x2 = x * x;
  const y2 = y * y;
  const p = 3 + 2 * (x2 - y2);
  const q = 3 - 2 * (x2 - y2);
  const a2 = (12 * x2) / (p + Math.sqrt(Math.max(0, p * p - 24 * x2)));
  const b2 = (12 * y2) / (q + Math.sqrt(Math.max(0, q * q - 24 * y2)));
  out.face = face;
  out.a = Math.min(1, Math.sqrt(a2)) * Math.sign(x);
  out.b = Math.min(1, Math.sqrt(b2)) * Math.sign(y);
  return out;
}

/**
 * Area element J(a, b) = |∂s/∂a × ∂s/∂b|: steradians per unit of (a, b) area.
 * Identical on every face. 0.5 at the centre, 0.577 at edge midpoints, 0.433
 * at corners; it integrates to 4π/6 over a face.
 */
export function areaElement(a: number, b: number): number {
  const a2 = a * a;
  const b2 = b * b;
  const ga = Math.sqrt(0.5 - a2 / 6);
  const gb = Math.sqrt(0.5 - b2 / 6);
  const h = Math.sqrt(1 - 0.5 * a2 - 0.5 * b2 + (a2 * b2) / 3);
  // s(a, b) = (a·g(b), b·g(a), h(a, b)) in face-local axes (U, V, N)
  const ax = gb;
  const ay = (-b * a) / (6 * ga);
  const az = (a * (-1 + (2 * b2) / 3)) / (2 * h);
  const bx = (-a * b) / (6 * gb);
  const by = ga;
  const bz = (b * (-1 + (2 * a2) / 3)) / (2 * h);
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Area element in uv units (uv area 1 per face): 4·J. */
export function areaElementUv(u: number, v: number): number {
  return 4 * areaElement(2 * u - 1, 2 * v - 1);
}

/** Upper bound of the uv area element over any face (attained at edge midpoints). */
export const AREA_ELEMENT_UV_MAX = 4 * Math.sqrt(1 / 3) + 1e-9;
