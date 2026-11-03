import type { PerspectiveCamera, Vector3 } from 'three';
import type { Basket, Find } from '../garden/types';
import type { MuseLook, PlanetId } from '../muse/contract';
import type { WarpFrame } from '../render/warp';
import type { Flight } from '../view/flight';
import type { SnapBed } from './snap';

// What a world gives the visit runtime: its camera, its Muses, its finds' beds and its ground. Typed only by
// structure, so src/visit never imports a world, and each world's adapter (environments/<x>/visit.ts) fills it in its
// own folder. Types only.

/** What a visit asks of a Muse: the same directions a world's Muse takes from the garden's engine. */
export type VisitDirection =
  | { readonly kind: 'home'; readonly busy: boolean }
  | { readonly kind: 'out'; readonly dir: Vector3; readonly toward: Vector3 | null; readonly walk: number; readonly busy: boolean }
  | { readonly kind: 'hidden' };

/** A Muse the visit directs. */
export interface VisitBody {
  /** Where it is now: a unit direction, its feet's height over R (m), the way it faces. */
  readonly where: { readonly dir: Vector3; readonly height: number; readonly heading: Vector3 };
  /** Resolved once its body is meshed and in place. */
  readonly ready: Promise<void>;
  direct(direction: VisitDirection): void;
}

/** A find's bed as it grows: its bed, and the flower it grows as (the find's topic's, from the visit view). */
export interface VisitBedLook {
  readonly bed: SnapBed;
  readonly species: 0 | 1 | 2 | 3;
  readonly variant: number;
  readonly topic: string;
}

/** The finds' marks on the planet: their beds of flowers, and whatever else the world draws for a find. */
export interface VisitMarks {
  /** Grow these beds, all at once (the whole visit's; called again when the planet's ground changes). */
  set(looks: readonly VisitBedLook[], radius: number): void;
  /** Once a frame: the camera's height (m). */
  update(altitude: number): void;
  /** Light up the find whose card is up (null: none). */
  open(id: string | null): void;
}

/** The world's own surface the visit reads: its camera, its warp, its size, and picking. */
export interface VisitScene {
  readonly rig: ConstructorParameters<typeof Flight>[0] & { readonly camera: PerspectiveCamera; readonly altitude: number };
  readonly warp: WarpFrame;
  readonly growth: { readonly radius: number };
  /** The point on the planet under a point of the screen (normalised device coordinates), if any. */
  pick(ndcX: number, ndcY: number): { readonly dir: Vector3; readonly water: number } | null;
  /** The world's own view of its Muse, which knows its home (from out in front of its terrace, not through a wall). */
  frameMuse?(): void;
}

/** A world as a visit's destination: environments/<x>/visit.ts makes one. */
export interface VisitWorld {
  /** Which planet this page is. */
  readonly planet: PlanetId;
  readonly scene: VisitScene;
  /** The world's own Muse, here the host. */
  readonly host: VisitBody;
  /** Draw the host in a body. */
  dressHost(look: MuseLook): void;
  /** A second Muse, the guest, in a body: drawn and kept up to date with the world's, never pressing its grass. */
  makeGuest(look: MuseLook): VisitBody;
  /** Keep the world's own inhabitants (its residents) out of sight while the visit lasts: called each frame. */
  hideOthers(): void;
  readonly marks: VisitMarks;
  /** The world's own layout of a basket's finds: each where it was found, nudged to room nearby. */
  layOut(baskets: readonly Basket[], finds: readonly Find[]): ReadonlyMap<string, SnapBed>;
  /** The bed at a place on the planet, if any, by the world's own rule. */
  bedAt(beds: ReadonlyMap<string, SnapBed>, dir: Vector3): SnapBed | null;
  /** The ground at a place: its height over R (m), and its signed distance to the shore (m, negative on water). Read it at once: the object is reused. */
  ground(dir: Vector3): { readonly height: number; readonly water: number };
  /** Changes (by identity) whenever the planet's ground does: the beds are laid out again then. */
  shape(): object;
  /** The two Muses' framing here, where the usual one (visitUi.ts MUSES_VIEW) would be down among what grows: the camera's distance and height (m), and where it looks (m). */
  readonly musesView?: { readonly distance: number; readonly height: number; readonly aim: number };
  /** Where a Muse may stand beyond dry ground (off the walls of a house, on a deck's free part), if the world knows. */
  standable?(dir: Vector3): boolean;
}
