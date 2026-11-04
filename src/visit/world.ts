import type { IUniform, Object3D, PerspectiveCamera, Vector3, Vector4 } from 'three';
import type { Basket, Find } from '../garden/types';
import type { HeldLook, Move, MuseAction } from '../life/museRig';
import type { RoamCues } from '../life/museRoam';
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
  // What the photo studio (studio.ts) asks of a Muse besides, where a world's Muse has it: your doings (world s) as a
  // press on it has them, its day (to seek a part of it), its pose (to hold a look on it), and its body's spheres
  // (planet space, m: the fourth its head's).
  tap?(time: number): void;
  hold?(time: number, side: number): void;
  letGo?(time: number): void;
  readonly life?: {
    readonly names: readonly { readonly name: string; readonly start: number }[];
    seek(now: number, at: number): void;
    at(now: number, camera: Vector3): unknown;
    /** The height a Muse stands at at a place (m over R): a deck's or a porch's where the home has one, else the ground's. */
    groundAt?(dir: Vector3): number;
  } | null;
  readonly pose?: { held: HeldLook | null; readonly lying?: number };
  readonly spheres?: readonly Vector4[];
  // What the director (src/director/) asks of a Muse besides, where a world's Muse has it: a life handed over whole each
  // frame in place of its own (null gives it its own life back), what such a life can show on it, and its things.
  act?(life: ActedLife | null): void;
  readonly acts?: ActedAbilities;
  readonly props?: { readonly group: Object3D };
  /** Put it in another body (a guest's: the host's is the world's dressHost). */
  useModel?(look: MuseLook): void;
}

/**
 * A life handed to a Muse whole, frame by frame (the director's: src/director/), in place of its own: where its feet
 * are (a unit direction, and their height over the ground its own life would stand on there, m: 0 standing, a seat's
 * on a bench), its heading there (a unit tangent), its action for its rig, what it looks at (planet space, or null),
 * its things' cues, and whether it is at home. A world's Roaming (life/museRoam.ts) in shape, but for the height, so a
 * world's Muse plays it as it plays its own life.
 */
export interface ActedLife {
  readonly dir: Vector3;
  height: number;
  readonly heading: Vector3;
  readonly action: MuseAction & { moves: Move[] };
  lookAt: Vector3 | null;
  readonly cues: RoamCues;
  home: boolean;
}

/** What an acted life can show on a world's Muse: its rig's moves (sitting, lying, petting…), its things in its mittens (the can, the rod, the ladle), and its height (m). */
export interface ActedAbilities {
  readonly moves: boolean;
  readonly props: boolean;
  readonly height: number;
}

/** Where the director puts its own things in a world (its benches and stoves), and the world's shared uniforms they are lit by. */
export interface VisitStage {
  add(...objects: Object3D[]): void;
  remove(...objects: Object3D[]): void;
  readonly shared: Record<string, IUniform>;
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
  /** Where a Muse may walk on its way somewhere (as `standable`, but down the steps off a deck too), if the world knows: the director's routes. */
  walkable?(dir: Vector3): boolean;
  /** The world's own view of the host's home (its homestead, or a cabin), for the rail's home button; without it the camera flies to the house from out in front. */
  frameHome?(): void;
  /** Where the director puts its own things (src/director/), if the world lets it. */
  readonly stage?: VisitStage;
}
