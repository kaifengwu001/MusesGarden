import { clamp } from '../core/math';

// The growth model: g ∈ [0,1] → A = lerp(A_min, A_max, smoothstep(g)) → R = √(A/4π).
// Surface area is the quantity that grows; radius follows from it.

export interface GrowthState {
  /** growth parameter, 0..1 */
  g: number;
  /** surface area, m² */
  area: number;
  /** radius, m */
  radius: number;
}

/** smoothstep on [0,1] */
export function ease(g: number): number {
  const t = clamp(g, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Inverse of `ease` on [0,1]. */
export function easeInverse(s: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * clamp(s, 0, 1)) / 3);
}

export function areaOfRadius(r: number): number {
  return 4 * Math.PI * r * r;
}

export function radiusOfArea(a: number): number {
  return Math.sqrt(a / (4 * Math.PI));
}

export function areaAt(g: number, areaMin: number, areaMax: number): number {
  return areaMin + (areaMax - areaMin) * ease(g);
}

/** The growth value that produces area `a`. */
export function growthForArea(a: number, areaMin: number, areaMax: number): number {
  return easeInverse((a - areaMin) / (areaMax - areaMin));
}

export function growthState(g: number, areaMin: number, areaMax: number, out: GrowthState = { g: 0, area: 0, radius: 0 }): GrowthState {
  out.g = clamp(g, 0, 1);
  out.area = areaAt(out.g, areaMin, areaMax);
  out.radius = radiusOfArea(out.area);
  return out;
}
