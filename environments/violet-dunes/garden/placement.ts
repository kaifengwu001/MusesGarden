import { Vector3 } from 'three';
import { angleBetween, tangentToward, travel } from '../../../src/planet/geo';
import { createGroundSample, type GroundSample } from '../planet/terrain';
import type { Basket, Find } from '../../../src/garden/types';

// Where the finds grow: each where Muse found it (Find.place). A bed needs
// dry ground under all its flowers, room from the beds already there and to
// be out of the cottage's clearing, so a find whose place is short of that
// is nudged to the nearest spot that has it. Finds are placed oldest first,
// so a new basket never moves a bed that is already growing. A find with no
// place grows near the cottage.
// (Golden Rye's, as it is: here it lays out a visiting owner's friend's finds, src/visit/, round the shelter.)

/** What placement reads of the terrain (Terrain has it; tests pass a stand-in). */
export interface PlacementGround {
  readonly radius: number;
  readonly layout: { readonly cottage: Vector3 };
  sample(dir: Vector3, out: GroundSample): GroundSample;
}

/** A find's bed on the planet: its direction and its ground's height over R (m). */
export interface Bed {
  readonly find: string;
  readonly basket: string;
  readonly dir: Vector3;
  readonly ground: number;
}

export interface GardenLayout {
  readonly beds: ReadonlyMap<string, Bed>;
}

/** A bed's radius (m): its flowers stand within it, and a tap this near picks it. */
export const BED_RADIUS = 0.75;
/** The least distance (m) from a bed's middle to the water, and between two beds' middles. */
const CLEAR = { water: BED_RADIUS + 0.15, beds: 2 * BED_RADIUS + 0.3 } as const;
/** The search for room round a place: candidates on a sunflower spiral this far apart (m), out to this far (m). */
const NUDGE = { step: 0.45, reach: 24 } as const;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const sample = createGroundSample();
const north = new Vector3();
const side = new Vector3();
const t = new Vector3();

/** Lay out every basket's finds. Baskets in any order; the oldest day is placed first. */
export function layOut(ground: PlacementGround, baskets: readonly Basket[], finds: readonly Find[]): GardenLayout {
  const R = ground.radius;
  const byId = new Map(finds.map((f) => [f.id, f]));
  const beds = new Map<string, Bed>();
  const minDot = Math.cos(CLEAR.beds / R);
  const fits = (dir: Vector3): boolean => {
    ground.sample(dir, sample);
    if (sample.water <= CLEAR.water || sample.clearing >= 0.05) return false;
    for (const bed of beds.values()) if (bed.dir.dot(dir) > minDot) return false;
    return true;
  };
  const ordered = [...baskets].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  for (const basket of ordered) {
    for (const id of basket.finds) {
      const find = byId.get(id);
      if (!find || beds.has(id)) continue;
      const found = find.place ? new Vector3(...find.place).normalize() : ground.layout.cottage.clone();
      const dir = nearestRoom(found, R, fits) ?? found;
      ground.sample(dir, sample);
      beds.set(id, { find: id, basket: basket.id, dir, ground: sample.height });
    }
  }
  return { beds };
}

/** The nearest spot to `place` that fits, searching outward; null when none within reach does. */
function nearestRoom(place: Vector3, radius: number, fits: (dir: Vector3) => boolean): Vector3 | null {
  tangentToward(place, new Vector3(0, 1, 0), north);
  side.crossVectors(place, north);
  const candidate = new Vector3();
  for (let k = 0; ; k++) {
    const r = NUDGE.step * Math.sqrt(k);
    if (r > NUDGE.reach) return null;
    const a = k * GOLDEN;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
    travel(place, t, r / radius, candidate);
    if (fits(candidate)) return candidate;
  }
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
