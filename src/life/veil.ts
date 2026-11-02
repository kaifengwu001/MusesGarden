import { Vector3 } from 'three';
import { hash32, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';
import type { Puff } from './clouds';

// The veil over the planet Muse has yet to explore (the unfolding, planet/unfold.ts): low cloud lying on the
// meadow everywhere but a little ground round the hut, under the drifting clouds, which pass over it and over
// the clearing alike. It clears heap by heap as the planet unfolds. A heap's turn comes by its distance from the
// hut, pushed about by a broad noise, so the clearing spreads in bays and fingers rather than as a circle, and by a
// little of its own, so the odd heap lingers as an island behind the edge or clears early as a hole ahead of it.
// When its turn comes its lobes go one by one, each shrinking away as a cloud does that fades.
//
// The heaps are the clouds' own (clouds.ts draws, shadows and mirrors them with the rest): the same lumpy puffs,
// only broader and lower, sunk to their middles in the ground like a sea of cloud, and still.

/** The veil at R 128 m (it scales with R, so it stays closed at any size). */
export const VEIL = {
  /** Between neighbouring heaps (m). */
  spacing: 22,
  /** Ground always clear round the hut (m). */
  core: 24,
  /** The share of the planet's heaps already clear before anything unfolds (a ragged clearing about 45 m round the hut). */
  clear: 0.035,
  /** How far the broad noise and each heap's own push its turn about (rad). */
  wander: 0.42,
  jitter: 0.2,
  /** How long a lobe takes to shrink away, and how far behind one another a heap's lobes go (shares of the unveiling). */
  fade: 0.1,
  stagger: 0.06,
  /** The heaps' height (m: their shading's scale) and where their base lies (m over the water table). */
  height: 9,
  base: -0.5,
} as const;

/** Puff arrangements to pick from. */
const TEMPLATES = 32;

export interface VeilHeap {
  /** Where it lies (rest space) and the way its lobes are laid out along. */
  readonly dir: Vector3;
  readonly along: Vector3;
  readonly seed: number;
  /** The unveiling (0 … 1) at which it starts to clear; below 0: clear from the start. */
  readonly turn: number;
  /** How long after that each of its lobes starts to go (shares of the unveiling, 0 … stagger). */
  readonly lobes: Float32Array;
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

/**
 * A heap of the veil (× VEIL.spacing): six broad lobes in a ring round two in the middle, sunk to their middles in
 * the ground, so they are low domes, wide enough that neighbouring heaps close over the ground between them.
 */
function veilPuffs(rand: () => number): Puff[] {
  const puffs: Puff[] = [];
  const turn = rand() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const a = turn + (i / 6) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const d = 0.34 + 0.08 * rand();
    puffs.push({ x: Math.cos(a) * d, y: -0.04 + 0.06 * rand(), z: Math.sin(a) * d, r: 0.26 + 0.05 * rand(), phase: rand() * Math.PI * 2 });
  }
  for (let i = 0; i < 2; i++) {
    const a = turn + i * Math.PI + (rand() - 0.5) * 0.6;
    puffs.push({ x: Math.cos(a) * 0.12, y: 0.03 + 0.04 * rand(), z: Math.sin(a) * 0.12, r: 0.28 + 0.04 * rand(), phase: rand() * Math.PI * 2 });
  }
  return puffs;
}

export class Veil {
  readonly heaps: VeilHeap[] = [];
  readonly templates: Puff[][] = [];
  /** How far the planet has unveiled (planet/unfold.ts unveiling): 1, and nothing of the veil is left. */
  progress = 1;
  private seed = Number.NaN;
  private readonly centre = new Vector3();

  /** Lay the veil out over a planet (once per seed and hut): its heaps and the order they clear in, out from `centre`. */
  build(seed: number, centre: Vector3): void {
    if (seed === this.seed && centre.equals(this.centre)) return;
    this.seed = seed;
    this.centre.copy(centre);
    const rand = rng(seed ^ 0x7e11);
    const noise = hash32(seed ^ 0xfa11) % 100000;
    this.templates.length = 0;
    for (let i = 0; i < TEMPLATES; i++) this.templates.push(veilPuffs(rand));

    // evenly over the sphere (a Fibonacci lattice, turned and jittered by the seed), about VEIL.spacing apart at R 128
    const step = VEIL.spacing / 128;
    const count = Math.round((4 * Math.PI) / (step * step * Math.sqrt(0.75)));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const turn = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const spin = rand() * Math.PI * 2;
    const sites: Array<{ dir: Vector3; along: Vector3; seed: number; score: number }> = [];
    for (let i = 0; i < count; i++) {
      const z = 1 - (2 * (i + 0.5)) / count;
      const r = Math.sqrt(1 - z * z);
      const dir = new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z).applyAxisAngle(turn, spin);
      const h = hash32(seed * 7919 + i * 104729);
      const t1 = new Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      const t2 = new Vector3().crossVectors(dir, t1);
      const a = unit(hash32(h + 1)) * Math.PI * 2;
      const j = 0.22 * step * unit(hash32(h + 2));
      dir.addScaledVector(t1, Math.cos(a) * j).addScaledVector(t2, Math.sin(a) * j).normalize();
      const b = unit(hash32(h + 3)) * Math.PI * 2;
      const along = t1.multiplyScalar(Math.cos(b)).addScaledVector(t2, Math.sin(b));
      along.addScaledVector(dir, -along.dot(dir)).normalize();
      // its turn: out from the hut, pushed about by the broad noise and a little of its own
      const angle = Math.acos(Math.min(1, Math.max(-1, dir.dot(centre))));
      const broad = 0.62 * gnoise(dir.x * 1.6, dir.y * 1.6, dir.z * 1.6, noise) + 0.38 * gnoise(dir.x * 3.4, dir.y * 3.4, dir.z * 3.4, noise + 1);
      const own = (unit(hash32(h + 4)) - 0.5) * 2;
      // (near the hut the noise pushes less, so the first clearing is round it, not in holes about the planet)
      const far = 0.25 + 0.75 * smoothstep(0, 1, angle);
      const score = angle * 128 < VEIL.core ? -Infinity : angle + far * (VEIL.wander * broad + VEIL.jitter * own);
      sites.push({ dir, along, seed: h, score });
    }
    sites.sort((p, q) => p.score - q.score);
    // the first few are clear from the start (the ground round the hut); the rest take their turns one after
    // another, the edge moving out from the hut at an even pace (each heap's turn by the angle of a cap holding as
    // many heaps as come before it), the last one's lobes gone just as the unveiling ends
    const open = Math.max(sites.filter((s) => s.score === -Infinity).length, Math.round(VEIL.clear * count));
    const cap = (n: number): number => Math.acos(1 - (2 * n) / count);
    const first = cap(open);
    const last = 1 - VEIL.fade - VEIL.stagger;
    this.heaps.length = 0;
    sites.forEach((s, rank) => {
      const lobes = new Float32Array(8);
      for (let k = 0; k < 8; k++) lobes[k] = VEIL.stagger * unit(hash32(s.seed + 10 + k));
      const turn = rank < open ? -1 : (last * (cap(rank) - first)) / (cap(count - 1) - first);
      this.heaps.push({ dir: s.dir, along: s.along, seed: s.seed, turn, lobes });
    });
  }

  /** A lobe's size now (1 whole … 0 gone) at an unveiling `progress`. */
  static lobe(heap: VeilHeap, k: number, progress: number): number {
    const start = heap.turn + heap.lobes[k];
    return smoothstep(start + VEIL.fade, start, progress);
  }

  /** Whether anything of a heap is left at an unveiling `progress`. */
  static stands(heap: VeilHeap, progress: number): boolean {
    return progress < heap.turn + VEIL.stagger + VEIL.fade;
  }
}
