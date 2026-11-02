import { Vector3 } from 'three';
import { hash32 } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';

// The veil over the planet Muse has yet to explore (the unfolding, planet/unfold.ts): a sea of ground fog on the
// meadow everywhere but a little ground round the hut, under the drifting clouds, which pass over it and over the
// clearing alike. It is dense at the ground and thins upward to a top that lies in banks, wisps on it
// (veilFog.ts draws it).
//
// Where it lies is a field over the sphere, each place's turn: how far the unfolding has to go before it clears.
// That is its distance from the hut, pushed about by a broad noise, so the clearing spreads in bays and fingers
// rather than as a circle, and by a finer one, so patches linger as islands behind the edge or clear early as
// holes ahead of it. The field is baked once per planet on the GPU (veilField.frag.glsl); this is its mirror, which
// finds how much of the planet each unveiling has cleared, so the edge moves out from the hut at an even pace.

/** The veil, in rest space (angles at R 128 m): it is laid out once and stays put as the planet grows. */
export const VEIL = {
  /** Ground always clear round the hut (m at R 128). */
  core: 24,
  /** The share of the planet clear before anything unfolds: a ragged clearing about 45 m round the hut. */
  clear: 0.035,
  /** How far the broad noise and the finer one push a place's turn about (rad of distance from the hut). */
  wander: 0.42,
  fray: 0.16,
  /** How softly the fog ends at its edge (in turns: about 1.5 m of ground at R 128). */
  edge: 0.012,
} as const;

/** The field's value round the hut: clear from the start, whatever the unveiling. */
const CORE_TURN = -10;
/** Evenly spread directions the field is read at to find how much of the planet lies below a turn. */
const SAMPLES = 20000;

/** The noise seed of a planet's veil (veilField.frag.glsl reads the same). */
export function veilSeed(seed: number): number {
  return hash32(seed ^ 0xfa11) % 100000;
}

/**
 * A place's turn (veilField.frag.glsl computes the same on the GPU): about its angle from the hut, pushed about by
 * the two noises (less near the hut, so the first clearing is round the hut rather than in holes about the planet).
 */
export function veilTurn(dir: Vector3, hut: Vector3, noise: number): number {
  const angle = Math.acos(clamp(dir.dot(hut), -1, 1));
  if (angle * 128 < VEIL.core) return CORE_TURN;
  const { x, y, z } = dir;
  const broad = 0.62 * gnoise(x * 1.6, y * 1.6, z * 1.6, noise) + 0.38 * gnoise(x * 3.4, y * 3.4, z * 3.4, noise + 1);
  const fine = 0.6 * gnoise(x * 9, y * 9, z * 9, noise + 2) + 0.4 * gnoise(x * 21, y * 21, z * 21, noise + 3);
  const far = 0.25 + 0.75 * smoothstep(0, 1, angle);
  return angle + far * (VEIL.wander * broad + VEIL.fray * fine);
}

export class Veil {
  /** How far the planet has unveiled (planet/unfold.ts unveiling): 1, and nothing of the veil is left. */
  progress = 1;
  /** The turns of evenly spread directions, sorted: the share of the planet below a turn. */
  private sorted = new Float32Array(0);
  private seed = Number.NaN;
  private readonly centre = new Vector3();

  /** Lay the veil out over a planet (once per seed and hut); true when it was laid out afresh. */
  build(seed: number, centre: Vector3): boolean {
    if (seed === this.seed && centre.equals(this.centre)) return false;
    this.seed = seed;
    this.centre.copy(centre);
    const noise = veilSeed(seed);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const turns = new Float32Array(SAMPLES);
    const d = new Vector3();
    for (let i = 0; i < SAMPLES; i++) {
      const z = 1 - (2 * (i + 0.5)) / SAMPLES;
      const r = Math.sqrt(1 - z * z);
      turns[i] = veilTurn(d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z), centre, noise);
    }
    this.sorted = turns.sort();
    return true;
  }

  /** The noise seed the field was laid out with. */
  get noise(): number {
    return veilSeed(this.seed);
  }

  /**
   * The turn below which the planet is clear at an unveiling `progress` (0 … 1): the share of the planet a cap of
   * angle θ holds, θ moving at an even pace from the first clearing's to the whole planet's; +∞ once all is clear.
   */
  threshold(progress: number): number {
    if (progress >= 1 || this.sorted.length === 0) return Number.POSITIVE_INFINITY;
    const first = Math.acos(1 - 2 * Math.max(VEIL.clear, this.coreShare()));
    const angle = first + (Math.PI - first) * clamp(progress, 0, 1);
    const at = clamp(((1 - Math.cos(angle)) / 2) * this.sorted.length, 0, this.sorted.length - 1);
    const i = Math.floor(at);
    const j = Math.min(i + 1, this.sorted.length - 1);
    return this.sorted[i] + (this.sorted[j] - this.sorted[i]) * (at - i);
  }

  /** The share of the planet with a turn below `turn` (the clear share, at the threshold). */
  share(turn: number): number {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] < turn) lo = mid + 1;
      else hi = mid;
    }
    return lo / Math.max(this.sorted.length, 1);
  }

  private coreShare(): number {
    return this.share(CORE_TURN + 1);
  }
}
