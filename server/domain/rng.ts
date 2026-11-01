// Seeded randomness. Every draw is a hash of (museId, episode n, kind, k), and of the run's seed when it isn't 0, so a
// replay draws the same values and the sim can run the same cast on other seeds (run seed 0 is every earlier run).
import type { Draw, MuseId } from '../../src/muse/contract';
import { mix, salt, unit } from '../../src/core/hash';

export function drawFor(museId: MuseId, n: number, run = 0): Draw {
  const base = mix(run === 0 ? salt(museId) : mix(salt(museId), run), n);
  return (kind, k = 0) => unit(mix(mix(base, salt(kind)), k));
}

const U_MIN = 1e-12;

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function probit(u: number): number {
  const p = Math.min(1 - U_MIN, Math.max(U_MIN, u));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** A lognormal sample with the given median and log-space sigma, from one uniform. */
export function lognormal(u: number, median: number, sigma: number): number {
  return median * Math.exp(sigma * probit(u));
}

/** The waiting time of a Poisson process with `rate` events per unit time, from one uniform. */
export function exponential(u: number, rate: number): number {
  return -Math.log(1 - Math.min(u, 1 - U_MIN)) / rate;
}

/** Index i with probability weights[i] / Σ weights. -1 when every weight is 0. */
export function categorical(u: number, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return -1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]) / total;
    if (u < acc) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return -1;
}

/** P(i) = exp(score_i / tau) / Σ exp(score_j / tau). */
export function softmax(scores: readonly number[], tau: number): number[] {
  const top = Math.max(...scores);
  const e = scores.map((s) => Math.exp((s - top) / tau));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / total);
}
