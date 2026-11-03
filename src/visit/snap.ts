import { Vector3 } from 'three';
import { angleBetween, tangentToward, travel } from '../planet/geo';

// A friend's finds were placed on the server's own ground, the meadow's (server/domain/atlas.ts), so on another world a
// few may fall in its water. The world's own layout (layOut) nudges each bed to room nearby; this is a second, wider
// pass for the beds it left on the water: each moves to the nearest dry ground within SNAP.reach, clear of the others.

export const SNAP = {
  /** The least distance from a bed's middle to the water (m): a bed of 0.75 m and a little margin. */
  clear: 0.9,
  /** The least distance between two beds' middles (m). */
  spacing: 1.8,
  /** The search: a sunflower spiral this far apart (m), out to this far (m). */
  step: 1.2,
  reach: 120,
} as const;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** A bed as a world lays it out: its find, its basket, where it is and its ground's height over R (m). */
export interface SnapBed {
  readonly find: string;
  readonly basket: string;
  readonly dir: Vector3;
  readonly ground: number;
}

/** What the world's ground is at a place: its height over R (m), and its signed distance to the shore (m, negative on water). */
export type Probe = (dir: Vector3) => { readonly height: number; readonly water: number };

/**
 * The beds, each still on the water moved to the nearest dry ground within reach, clear of every other bed; the rest
 * as they were (the same objects). A bed with no dry ground in reach stays where it is.
 */
export function snapBeds<B extends SnapBed>(beds: ReadonlyMap<string, B>, radius: number, probe: Probe): Map<string, B | SnapBed> {
  const out = new Map<string, B | SnapBed>(beds);
  const minDot = Math.cos(SNAP.spacing / radius);
  for (const [id, bed] of beds) {
    if (probe(bed.dir).water >= SNAP.clear) continue;
    const others = [...out.values()].filter((b) => b.find !== id);
    const room = (dir: Vector3): boolean => probe(dir).water >= SNAP.clear && others.every((b) => b.dir.dot(dir) <= minDot);
    const dir = nearestDry(bed.dir, radius, room);
    if (dir) out.set(id, { find: bed.find, basket: bed.basket, dir, ground: probe(dir).height });
  }
  return out;
}

/** How far each bed moved (m), by find: for a check, and for the probe. */
export function moved(before: ReadonlyMap<string, SnapBed>, after: ReadonlyMap<string, SnapBed>, radius: number): Map<string, number> {
  return new Map([...after].map(([id, b]) => [id, before.has(id) ? angleBetween(before.get(id)!.dir, b.dir) * radius : 0]));
}

function nearestDry(place: Vector3, radius: number, room: (dir: Vector3) => boolean): Vector3 | null {
  const north = tangentToward(place, new Vector3(0, 1, 0), new Vector3());
  const east = new Vector3().crossVectors(place, north);
  const t = new Vector3();
  for (let k = 1; ; k++) {
    const r = SNAP.step * Math.sqrt(k);
    if (r > SNAP.reach) return null;
    const a = k * GOLDEN;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
    const candidate = travel(place, t, r / radius, new Vector3());
    if (room(candidate)) return candidate;
  }
}
