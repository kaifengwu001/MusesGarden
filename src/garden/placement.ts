import { Vector3 } from 'three';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import { createGroundSample, type GroundSample } from '../planet/terrain';
import type { Basket, Find } from './types';

// Where the finds grow. Each basket is a patch of its own, and the patches
// wind outward from the cottage day by day, the oldest nearest home (Muse
// explores a little farther each day): the first some 30 m out, each next
// one about 14 m farther and two-thirds of a radian round. Within a patch
// the first find grows in the middle and the others round it on a golden-
// angle spiral, a few meters apart. Every bed stands on dry land, clear of
// the cottage's clearing and of the other patches. A find the backend has
// placed itself (Find.place) keeps its place.

/** What placement reads of the terrain (Terrain has it; tests pass a stand-in). */
export interface PlacementGround {
  readonly radius: number;
  readonly layout: { readonly cottage: Vector3; readonly homeBearing: Vector3 };
  sample(dir: Vector3, out: GroundSample): GroundSample;
}

/** A find's bed on the planet: its direction and its ground's height over R (m). */
export interface Bed {
  readonly find: string;
  readonly basket: string;
  readonly dir: Vector3;
  readonly ground: number;
}

export interface Patch {
  readonly basket: string;
  /** The patch's middle and its reach (m): every bed lies within it. */
  readonly dir: Vector3;
  readonly reach: number;
}

export interface GardenLayout {
  readonly beds: ReadonlyMap<string, Bed>;
  readonly patches: ReadonlyMap<string, Patch>;
}

/** A bed's radius (m): its flowers stand within it, and a tap this near picks it. */
export const BED_RADIUS = 0.75;
/** Patches: the first's distance from the cottage, the step outward each day (m), the turn each day (rad). */
const SPIRAL = { first: 30, step: 14, turn: 0.68 } as const;
/** Clearances (m): from water for a bed, from the cottage, between patch middles. */
const CLEAR = { water: 1.6, cottage: 20, patches: 15 } as const;

const sample = createGroundSample();
const tmp = new Vector3();

function dry(ground: PlacementGround, dir: Vector3, margin: number): boolean {
  ground.sample(dir, sample);
  return sample.water > margin && sample.clearing < 0.05;
}

/** Lay out every basket's finds. Baskets in any order; the oldest day grows nearest home. */
export function layOut(ground: PlacementGround, baskets: readonly Basket[], finds: readonly Find[]): GardenLayout {
  const R = ground.radius;
  const { cottage, homeBearing } = ground.layout;
  const byId = new Map(finds.map((f) => [f.id, f]));
  const beds = new Map<string, Bed>();
  const patches = new Map<string, Patch>();
  const middles: Vector3[] = [];
  const east = new Vector3().crossVectors(homeBearing, cottage).normalize();
  const ordered = [...baskets].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  ordered.forEach((basket, k) => {
    // the patch's middle: on the spiral, nudged round and outward until it is dry and clear
    let middle: Vector3 | null = null;
    for (let attempt = 0; attempt < 60 && !middle; attempt++) {
      const turn = SPIRAL.turn * k + 0.9 + 0.21 * (attempt % 6) * (attempt % 2 ? 1 : -1);
      const dist = SPIRAL.first + SPIRAL.step * k + 5 * Math.floor(attempt / 6);
      const t = tmp.copy(homeBearing).multiplyScalar(Math.cos(turn)).addScaledVector(east, Math.sin(turn));
      const candidate = travel(cottage, t, dist / R, new Vector3());
      if (angleBetween(candidate, cottage) * R < CLEAR.cottage) continue;
      if (middles.some((m) => angleBetween(m, candidate) * R < CLEAR.patches)) continue;
      if (dry(ground, candidate, CLEAR.water + 2.5)) middle = candidate;
    }
    middle ??= travel(cottage, homeBearing, (SPIRAL.first + SPIRAL.step * k) / R, new Vector3());
    middles.push(middle);
    // the beds: the first in the middle, the rest on a golden-angle spiral round it
    const north = tangentToward(middle, cottage, new Vector3()).negate();
    const side = new Vector3().crossVectors(middle, north);
    let reach = BED_RADIUS;
    basket.finds.forEach((id, i) => {
      const find = byId.get(id);
      if (!find) return;
      let dir: Vector3 | null = null;
      if (find.place) dir = new Vector3(...find.place).normalize();
      for (let attempt = 0; attempt < 24 && !dir; attempt++) {
        const r = i === 0 && attempt === 0 ? 0 : 2.4 + 0.5 * Math.sqrt(i) + 0.45 * attempt;
        const a = i * 2.39996 + 0.5 * attempt + k;
        const t = tmp.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
        const candidate = travel(middle, t, r / R, new Vector3());
        if (dry(ground, candidate, CLEAR.water) && ![...beds.values()].some((b) => angleBetween(b.dir, candidate) * R < 2 * BED_RADIUS + 0.4)) dir = candidate;
      }
      dir ??= middle.clone();
      ground.sample(dir, sample);
      beds.set(id, { find: id, basket: basket.id, dir, ground: sample.height });
      reach = Math.max(reach, angleBetween(dir, middle) * R + BED_RADIUS);
    });
    patches.set(basket.id, { basket: basket.id, dir: middle, reach });
  });
  return { beds, patches };
}

/** The bed under a point on the planet, if any: the nearest within its radius plus `slack` meters. */
export function bedAt(layout: GardenLayout, dir: Vector3, radius: number, slack = 0.6): Bed | null {
  let best: Bed | null = null;
  let bestD = BED_RADIUS + slack;
  for (const bed of layout.beds.values()) {
    const d = angleBetween(bed.dir, dir) * radius;
    if (d < bestD) {
      bestD = d;
      best = bed;
    }
  }
  return best;
}
