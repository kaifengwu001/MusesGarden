import { clamp, smoothstep } from '../core/math';
import { FIRST_PLANET } from './firstPlanet';

// The unfolding (Kai, 2026-11-01): how the planet opens up to a new player as Muse explores it, one value
// u ∈ [0, 1], the control bar's Unfold (in place of the radius slider).
//
//   u = 0          the meadow at its tuned size (R 128 m) under a veil of ground fog (life/veil.ts) but for a
//                  little ground round the hut: grass there, and no flowers; the drifting clouds thicker
//   0 … UNVEILED   the fog clears raggedly outward from the hut, the flowers come out behind it, from the hut
//                  outward (the bloom front, planet/meadow.glsl bloomAt), and the clouds thin to their own
//   UNVEILED       the meadow as tuned: unveiled and all in flower (the default)
//   UNVEILED … 1   the planet grows, from R 128 m to the largest (g = 1), the orbit camera held where it is
//                  (CameraRig.holdThrough), so it grows in the window
//
// The drifting clouds (life/clouds.ts) pass over the fog and the clearing alike, cloudier at first (Kai: not overcast,
// but well over the meadow's) and back to their own coverage once the planet is unveiled.

/** The unfolding at which the planet is unveiled and in flower, at its tuned size. */
export const UNVEILED = 0.5;

/** How far the veil has cleared and the flowers have spread: 0 … 1, and 1 from UNVEILED on. */
export function unveiling(u: number): number {
  return clamp(u / UNVEILED, 0, 1);
}

/**
 * The bloom the unfolding has reached, as `world.bloom`: its front lies b·(π + 0.45) − 0.25 from the hut, so at 0
 * there are no flowers and at 1 the whole planet is in flower, and it moves out at an even pace, a little behind the
 * veil's edge (life/veil.ts), which moves out as evenly.
 */
export function unfoldBloom(u: number): number {
  return unveiling(u);
}

/** How cloudy the drifting clouds are at the start (their coverage): not overcast, but well over the meadow's 0.45. */
export const VEILED_COVERAGE = 0.75;

/**
 * The drifting clouds' coverage at u: VEILED_COVERAGE at the start (or the setting, if that is cloudier), easing back
 * to the setting as the veil clears; the setting itself from UNVEILED on.
 */
export function unfoldCoverage(coverage: number, u: number): number {
  return coverage + (Math.max(coverage, VEILED_COVERAGE) - coverage) * (1 - smoothstep(0, 1, unveiling(u)));
}

/** The growth (`world.growth`) at u: the meadow's tuned size up to UNVEILED, then on up to the largest. */
export function unfoldGrowth(u: number): number {
  const t = clamp((u - UNVEILED) / (1 - UNVEILED), 0, 1);
  return t <= 0 ? FIRST_PLANET.growth : FIRST_PLANET.growth + (1 - FIRST_PLANET.growth) * t;
}
