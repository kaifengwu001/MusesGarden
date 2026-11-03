import { Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { Answers, rampIntegral, withTool } from './museLife';
import { COOK, FISH, HOP, LIE_BACK, PLOP, POCKET, RISE, STEP, WAKE, WAVE_LENGTH, YAWN_LENGTH, hopArc, perchBeats, type Move, type MoveKind, type MuseAction } from './museRig';
import { BENCH, CHAIR, COTTAGE, DOORSTEP, DOORWAY, FACE, FLOOR, OUTER, PIER, SIDE, STEPS, TERRACE } from './props';

// Muse's life on the planet (muse.ts draws it): it roams the meadow at
// random and does what it likes where it is, more often close to its hut.
// Some things have their places: the bench against the house's front, the
// end of the pier to fish from. Others it does wherever it has wandered:
// watering the plants, napping in the grass, fishing from a shore now and
// then, sitting down to look about. It cooks only in its hut, at the
// hearth's stove (Kai, 2026-11-01: the porch's stove is gone).
//
// Its days are drawn from a seed (the planet's), outing after outing, each a
// walk somewhere (up the porch steps, along the porch, out along the pier,
// or straight over the meadow, never through water or the house) and what
// it does there, so a time always finds it in one place doing one thing:
// the itinerary is written out lazily as time runs on, and read back by
// time. Over it go your doings and its answers (museLife.ts Answers).
//
// When you knock at its hut (and it is about), its day is cut short where it
// is (cut): what it was doing is brought to a stop and got up from, and it
// walks home and in through the door, which swings open as it comes and
// shut behind it, to greet you, cook at the hearth or go to bed; when you
// step out, it puts that by and walks out to its porch, and its days go on
// from there. Inside, its places are the room's (Room, as the garden lays it
// out), and it keeps clear of the walls and what stands on the floor.
//
// Places on the homestead are in its local meters (x across the front, z
// toward the pond, as props.ts and terrain.ts have them) and stand on its
// deck: the terrace and the pier, at FLOOR over the clearing, the steps
// between it and the meadow. Out on the meadow places are directions, and
// Muse stands on the ground there.

/** Its pace (Muse's heights a second), and the walk's share spent speeding up and slowing down at each end. */
export const PACE = 0.33;
const RAMP = 0.12;
/** A turn on the spot: its least time (s) and the time it adds for a half turn; turns smaller than `least` (rad) are taken in its stride. */
const TURN = { time: 0.35, half: 0.8, least: 0.12 } as const;
/**
 * Its paths (m): how far before and after a corner it curves round it; how
 * far into a walk it brings its heading round to the way (and how far before
 * the end round to the way it means to face) rather than turning on the spot,
 * for turns up to `swing` (rad); how far apart the path's points are; and how
 * far a long walk over the meadow wanders off the straight line (its share of
 * the way, at most `wander` m).
 */
const PATH = { corner: 0.9, sweep: 5, ease: 1.1, swing: 0.9, step: 0.2, meander: 0.12, wander: 2.5 } as const;
/** How far out round the homestead's corners its ways over the meadow go (m), to get round the house to its back or its far side. */
const ROUND = 1.6;
/** How far out it goes (m from the hut): mostly close, now and then across the meadow. */
const ROAM = { near: 5, far: 60, bias: 3 } as const;
/** What it might do next, and how likely each is. */
const LIKES = { wander: 3, water: 2.2, bench: 1.6, fish: 1.6, nap: 1.2, rest: 1 } as const;
type Like = keyof typeof LIKES;
/** In its hut, cooking at the hearth's stove: rounds of stirring and tasting a go, then a look about this long (s); greeting you: its wave this long after you come in (s), again now and then (s), its eyes on you until then. */
const INDOOR = { rounds: 4, pause: 6, wave: 0.6, again: 24, watch: 6 } as const;

/** What Muse is doing in its hut when you come in: cooking at the hearth's stove, standing in the room greeting you, asleep on its bed. */
export type Indoors = 'cook' | 'greet' | 'sleep';
/**
 * Its hut inside (local m): the room's half sizes to the walls' inner faces. Going through its door: Muse's half width
 * with its arms out as it walks (its mittens' reach and their size: Kai saw them go through the open door); the door's
 * width; the middle of the way through, between the far jamb and the door standing open on its hinge side, and how far
 * either side of it Muse's middle may go with its arms clear of both; where it stands before the door on the porch.
 */
const ROOM = { x: COTTAGE.halfX - COTTAGE.thickness / 2, z: COTTAGE.halfZ - COTTAGE.thickness / 2 } as const;
export const ARMS = 0.6;
const DOOR = (() => {
  const width = DOORWAY.x1 - DOORWAY.x0;
  const clear = DOORWAY.x1 - DOORWAY.thick;
  return { width, clear, x: (DOORWAY.x0 + clear) / 2, way: Math.max(0.02, (clear - DOORWAY.x0) / 2 - ARMS), porch: OUTER.z + 0.85 };
})();
/**
 * The door swinging: open, taking this long (s), by the time Muse comes within its sweep (as far round its hinge as it
 * reaches, and Muse's arms, with a margin: m) and a little before (m along its way); shutting, taking this long (s),
 * once Muse is out of it for good.
 */
const SWING = { open: 0.8, shut: 0.9, margin: 0.15, lead: 0.3 } as const;
/** Cut short (you knocked, or stepped out of its hut): a walk slows to a halt over this long (s), a pastime's motions ease out over this long (s). */
const HALT = 0.8;
const EASE = 0.7;
/** On its bed: how much higher its edge is than where it lies (m: sat on the edge it sinks in less), how long it takes to swing round onto it or off it (s). */
const BED = { edge: 0.07, swing: 1.5 } as const;
/** As long as a visit to its hut could last (s): what it does there is written out this long, cut short when you step out. */
const STAY = 6 * 3600;
/** How often it fishes from a shore rather than off the pier. */
const SHORE = 0.3;
/** The porch's lane along the front, clear of the bench (local m: z); the top of the steps and their foot on the meadow; where the terrace meets the pier. */
const TOP = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 - 0.5 } as const;
const FOOT = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 + STEPS.count * STEPS.tread + 0.8 } as const;
/**
 * Getting about on the deck (local m): Muse's girth (half its width, a
 * little over), and a few places to go by when the straight way is blocked
 * (by the bench, the chair, the house's corner): along the porch
 * and out onto the pier. Its ways there are straight where they can be,
 * round by these where not, the corners rounded off.
 */
const GIRTH = 0.45;
const DECK_WAYS: readonly (readonly [number, number])[] = [
  [3.2, 3.85],
  [1.8, 3.85],
  [0.4, 3.85],
  [-1, 3.85],
  [-2.4, 3.6],
  [-3.9, 3.5],
  [-5.4, 4.5],
  [-6.6, 4.9],
];
/** Where it sits to fish off the pier: how far along the pier's front edge (local m: x). */
const PIER_SPOT = -6.6;
/** The homestead's footprint with a margin (local m): paths over the meadow keep out of it. */
const HOMESTEAD = { x0: PIER.x0 - 0.6, x1: TERRACE.x1 + 0.6, z0: -4, z1: TERRACE.z1 + STEPS.count * STEPS.tread + 0.3 } as const;

type Facing = Vector3;
interface Spot {
  dir: Vector3;
  /** On the deck (the terrace, the steps or the pier), its local meters. */
  deck: { x: number; z: number } | null;
}

/** What the props need to know of what Muse is doing (museProps.ts): each pastime's time into it, and how firmly its tool is held (0 … 1, as it comes out of the pocket and goes back). */
export interface RoamCues {
  /** (watering: also how far the can is tipped, and how much water pours from it) */
  water: { time: number; grip: number; tip: number; pour: number } | null;
  fish: { time: number; grip: number; edge: boolean } | null;
  /** (cooking in the hut, at the hearth's stove: where its pot is, planet space) */
  cook: { time: number; grip: number; pot: Vector3 } | null;
  sleep: { time: number; roused: number } | null;
  /** Humming on the bench (0 … 1), being petted (s into it, < 0 for none). */
  hum: number;
  petted: number;
}

/** Muse as its life has it at a time: where its feet are (a unit direction and their height over R, m), its heading there (a unit tangent), its action for the rig, what it looks at (planet space), the props' cues, and whether it is home. */
export interface Roaming {
  dir: Vector3;
  height: number;
  heading: Vector3;
  action: MuseAction & { moves: Move[] };
  lookAt: Vector3 | null;
  cues: RoamCues;
  home: boolean;
}

/** Its hut's room as the garden lays it out (local m: x across the front, z toward the pond, y over the clearing). */
export interface Room {
  /** What stands on its floor, to keep clear of: boxes across (x0 … x1) and deep (z0 … z1). */
  things: readonly { x0: number; x1: number; z0: number; z1: number }[];
  /** Where it stands to greet you, facing the way you look in (a unit x, z). */
  greet: { x: number; z: number; facing: readonly [number, number] };
  /** Where it stands to cook, facing the hearth's pot, and the pot. */
  cook: { x: number; z: number; facing: readonly [number, number]; pot: readonly [number, number, number] };
  /** Its bed: where it lies (y: the height it lies at), facing the foot; the side it gets in from (a unit x, z out of the bed) and how far that edge is from where it lies (m). */
  bed: { x: number; z: number; y: number; foot: readonly [number, number]; side: readonly [number, number]; edge: number };
}

interface Context {
  camera: Vector3;
  gait: number;
}

/** A stretch of the itinerary: how long (s), how far its gait runs (cycles of two steps), and how it plays s seconds in. */
interface Segment {
  name: string;
  time: number;
  gait: number;
  play(s: number, out: Roaming, ctx: Context): void;
  /** Cut short s seconds in (you knocked, or stepped out of its hut): the time it then runs to, coming to a stop (a walk slowing to a halt, a pastime's motions eased out, its tool put away). Unset, it runs to its end. */
  stop?(s: number): number;
  /** Written after it once it is cut short: getting up from it (off the bench, up out of the grass, awake, its can put away). */
  then?(): void;
}

/** A small seeded random source (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tangent turned about the up by an angle (rad). */
function turned(t: Vector3, up: Vector3, angle: number, out: Vector3): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // (t ⊥ up: Rodrigues without the axial part)
  out.crossVectors(up, t).multiplyScalar(s).addScaledVector(t, c);
  return out.normalize();
}

/** The signed angle from one tangent to another about the up (rad). */
function between(a: Vector3, b: Vector3, up: Vector3): number {
  return Math.atan2(scratch.crossVectors(a, b).dot(up), a.dot(b));
}

const scratch = new Vector3();
const scratch2 = new Vector3();
const ground = createGroundSample();

/** A path over the planet: points along it (unit directions) and each one's distance from its start (m). */
class Path {
  readonly points: Vector3[] = [];
  readonly at: number[] = [];

  constructor(private readonly R: number) {}

  get length(): number {
    return this.at.length ? this.at[this.at.length - 1] : 0;
  }

  add(p: Vector3): void {
    const n = this.points.length;
    if (n && angleBetween(this.points[n - 1], p) * this.R < 1e-4) return;
    this.at.push(n ? this.at[n - 1] + angleBetween(this.points[n - 1], p) * this.R : 0);
    this.points.push(p.clone());
  }

  /** Straight on to a point (a great circle), every `step` m. */
  line(to: Vector3, step: number): void {
    const from = this.points[this.points.length - 1];
    const steps = Math.max(1, Math.ceil((angleBetween(from, to) * this.R) / step));
    const a = from.clone();
    for (let k = 1; k <= steps; k++) this.add(a.clone().lerp(to, k / steps).normalize());
  }

  /** The point at a distance along it (m). */
  point(d: number, out: Vector3): Vector3 {
    const at = this.at;
    const n = at.length;
    if (d <= 0 || n < 2) return out.copy(this.points[0]);
    if (d >= at[n - 1]) return out.copy(this.points[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - at[lo]) / Math.max(at[hi] - at[lo], 1e-9);
    return out.copy(this.points[lo]).lerp(this.points[hi], f).normalize();
  }

  /** Its heading at a distance along it: the way along it there (a unit tangent), smoothed over a stretch either side. */
  heading(d: number, out: Vector3): Vector3 {
    const L = this.length;
    const span = Math.min(0.3, L / 2);
    const a = this.point(Math.max(0, Math.min(L - 2 * span, d - span)), pathA);
    const b = this.point(Math.min(L, Math.max(2 * span, d + span)), pathB);
    const p = this.point(d, pathC);
    out.subVectors(b, a);
    out.addScaledVector(p, -out.dot(p));
    return out.lengthSq() > 1e-18 ? out.normalize() : tangentToward(p, this.points[this.points.length - 1], out);
  }
}
const pathA = new Vector3();
const pathB = new Vector3();
const pathC = new Vector3();

/** Something it keeps doing as it walks or turns (holding its can): its moves and cues added, s into the segment. */
type Carry = (s: number, out: Roaming) => void;

export class MuseRoam {
  /** The itinerary written out so far: its segments, each one's start (s) and the gait there. */
  private readonly day: Segment[] = [];
  private readonly starts: number[] = [];
  private readonly gaits: number[] = [];
  private length = 0;
  private gait = 0;
  /** Where the last outing left it, which way it faced, and what it last did. */
  private here: Spot;
  private facing: Facing;
  private last: Like = 'rest';
  private outings = 0;
  /** Where the day's clock is from the caller's (s): seeking moves it (dev). */
  private shift = 0;
  private readonly you = new Answers();
  /** Which way round it turns to you (+1 to its left), chosen as it starts to: so a camera nearly behind it never has it turn one way and then the other. */
  private turnSide = 0;
  private readonly living: Roaming;
  /** The homestead's frame: across its front, up, toward its pond (planet space). */
  private readonly X = new Vector3();
  private readonly U = new Vector3();
  private readonly Z = new Vector3();
  /** The planet's radius and seed it was laid out for. */
  private readonly R: number;
  private readonly seed: number;
  private readonly terrain: Terrain;
  readonly height: number;
  /** The homestead's corners out on the meadow, to go round it by. */
  private readonly corners: Vector3[] = [];
  /** Its hut's room while you visit (it goes in and about it then), the places to go round what stands there by, and when its door is open (the itinerary's clock, s: opening from, open, shutting from; when Muse goes through). */
  private room: Room | null = null;
  private roomWays: { x: number; z: number }[] = [];
  private readonly doorways: { from: number; open: number; shut: number; through: number }[] = [];
  /** When its day was last cut short (the itinerary's clock, s): its door moves no sooner. */
  private cutAt = 0;
  /** A life read off to the side: where a part cut short leaves it. */
  private readonly probe: Roaming;

  /** terrain: the planet as it is now (its radius and layout fix the places); height: Muse's height (m). */
  constructor(terrain: Terrain, height: number) {
    this.terrain = terrain;
    this.height = height;
    this.R = terrain.radius;
    this.seed = terrain.layout.seed;
    const L = terrain.layout;
    this.U.copy(L.cottage);
    this.X.crossVectors(this.U, L.homeBearing).normalize();
    this.Z.crossVectors(this.X, this.U).normalize();
    // the homestead's corners out on the meadow (those on dry ground), to go round it by
    const H = HOMESTEAD;
    for (const [x, z] of [
      [H.x1 + ROUND, H.z1 + ROUND],
      [H.x1 + ROUND, H.z0 - ROUND],
      [H.x0 - ROUND, H.z0 - ROUND],
      [H.x0 - ROUND, H.z1 + ROUND],
    ]) {
      const dir = this.local(x, z);
      if (terrain.sample(dir, ground).water > 1) this.corners.push(dir);
    }
    // it starts the day on the porch, looking out
    this.here = this.deckSpot(0.4, 4.2);
    this.facing = this.toward(this.here, this.deckSpot(0.4, 8).dir);
    const life = (): Roaming => ({
      dir: this.here.dir.clone(),
      height: 0,
      heading: new Vector3(),
      action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0, moves: [] },
      lookAt: null,
      cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
      home: true,
    });
    this.living = life();
    this.probe = life();
  }

  /** Whether this life was laid out for the planet as it is (its radius and layout): if not, a new one is wanted. */
  fits(terrain: Terrain): boolean {
    return terrain === this.terrain && Math.abs(terrain.radius - this.R) < 1e-6 && terrain.layout.seed === this.seed;
  }

  // ---- places ----

  /** A direction for the homestead's local meters (as the homestead is bent round the planet: the arc out from the cottage is its local distance). */
  private local(x: number, z: number, out = new Vector3()): Vector3 {
    const d = Math.hypot(x, z);
    if (d < 1e-6) return out.copy(this.U);
    scratch.copy(this.X).multiplyScalar(x / d).addScaledVector(this.Z, z / d);
    return travel(this.U, scratch, Math.asin(Math.min(d / this.R, 1)), out);
  }

  private deckSpot(x: number, z: number): Spot {
    return { dir: this.local(x, z), deck: { x, z } };
  }

  /** The deck under local meters (its height over the clearing, m): the terrace, the pier and the hut's floor (in through its door, over the doorstep) at the floor, the steps going down to the meadow; null off it. */
  private deckAt(x: number, z: number): number | null {
    const inside = (r: { x0: number; x1: number; z0: number; z1: number }): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    if (Math.abs(x) < ROOM.x && z > -ROOM.z && z < OUTER.z && (z < ROOM.z || (x > DOORWAY.x0 && x < DOORWAY.x1))) return FLOOR + this.doorstep(x, z);
    if (inside(TERRACE) || inside(PIER)) return FLOOR + this.doorstep(x, z);
    // (four risers: down the three steps and off the last onto the meadow, a tread beyond it)
    const run = (STEPS.count + 1) * STEPS.tread;
    if (x >= STEPS.x0 && x <= STEPS.x1 && z > TERRACE.z1 && z < TERRACE.z1 + run) return FLOOR * (1 - (z - TERRACE.z1) / run);
    return null;
  }

  /** The doorstep under its feet going in or out (m over the floor): up onto it from the doorway and the porch, smoothly. */
  private doorstep(x: number, z: number): number {
    if (Math.abs(x - (DOORWAY.x0 + DOORWAY.x1) / 2) > DOORSTEP.half) return 0;
    const z1 = OUTER.z + DOORSTEP.depth;
    return DOORSTEP.height * smoothstep(OUTER.z - 0.08, OUTER.z + 0.06, z) * (1 - smoothstep(z1 - 0.04, z1 + 0.1, z));
  }

  /** Can Muse stand here on the deck (local m), clear of its edges, the house, the bench and the chair; and while you visit, through the hut's door and about its room, clear of the walls and what stands there? */
  private deckFree(x: number, z: number): boolean {
    const room = this.room;
    if (room && z < FACE + GIRTH && z > -OUTER.z && Math.abs(x) < SIDE) {
      // (through the doorway along its middle; inside, beside the door standing open, its arms clear of it)
      if (z > ROOM.z - 0.1) return Math.abs(x - DOOR.x) < DOOR.way;
      if (z > DOORWAY.z - DOOR.width - 0.1 && x + ARMS > DOOR.clear) return false;
      if (Math.abs(x) > ROOM.x - GIRTH || z < -ROOM.z + GIRTH) return false;
      return room.things.every((t) => x < t.x0 - GIRTH || x > t.x1 + GIRTH || z < t.z0 - GIRTH || z > t.z1 + GIRTH);
    }
    const run = STEPS.count * STEPS.tread;
    const terrace = x > TERRACE.x0 + 0.35 && x < TERRACE.x1 - 0.35 && z > FACE + GIRTH && z < TERRACE.z1 - 0.3;
    const pier = x > PIER.x0 + 0.35 && x < PIER.x1 && z > PIER.z0 + 0.5 && z < PIER.z1 - 0.25;
    const steps = x > STEPS.x0 + 0.3 && x < STEPS.x1 - 0.3 && z > TERRACE.z1 - 0.6 && z < TERRACE.z1 + run + 1;
    if (!terrace && !pier && !steps) return false;
    // (the house itself, beside the pier)
    if (x > -SIDE - GIRTH && z < FACE + GIRTH) return false;
    if (Math.abs(x - BENCH.x) < BENCH.half + GIRTH && z < BENCH.z + BENCH.depth + GIRTH) return false;
    return Math.hypot(x - CHAIR.x, z - CHAIR.z) > 0.3 + GIRTH;
  }

  /** Is the straight way between two places on the deck clear (its ends, which may be close by things, let be)? */
  private deckClear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / 0.08));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      if (Math.min(f, 1 - f) * length < 0.3) continue;
      if (!this.deckFree(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f)) return false;
    }
    return true;
  }

  /** The shortest way over the deck (the places after the first, the last the place itself): straight if it can, else by the deck's ways. */
  private deckWay(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] {
    if (this.deckClear(a, b)) return [b];
    const nodes = [a, ...DECK_WAYS.map(([x, z]) => ({ x, z })), ...this.roomWays, b];
    const n = nodes.length;
    const best = new Array<number>(n).fill(Infinity);
    const back = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    best[0] = 0;
    for (;;) {
      let k = -1;
      for (let i = 0; i < n; i++) if (!done[i] && best[i] < Infinity && (k < 0 || best[i] < best[k])) k = i;
      if (k < 0 || k === n - 1) break;
      done[k] = true;
      for (let i = 1; i < n; i++) {
        if (done[i]) continue;
        const d = best[k] + Math.hypot(nodes[i].x - nodes[k].x, nodes[i].z - nodes[k].z);
        if (d < best[i] && this.deckClear(nodes[k], nodes[i])) {
          best[i] = d;
          back[i] = k;
        }
      }
    }
    if (best[n - 1] === Infinity) return [b];
    const way: { x: number; z: number }[] = [];
    for (let k = n - 1; k > 0; k = back[k]) way.unshift(nodes[k]);
    return way;
  }

  /** The height under a direction (m over R): the deck, or the ground. */
  groundAt(dir: Vector3): number {
    const c = this.terrain.cottageLocal(dir, localTmp);
    if (Math.abs(c.x) < 14 && Math.abs(c.z) < 14) {
      const deck = this.deckAt(c.x, c.z);
      if (deck !== null) return this.terrain.cottageGround + deck;
    }
    return this.terrain.sample(dir, ground).height;
  }

  /**
   * Whether a Muse could stand at a place: on the deck where it is free (clear of its edges, the house, the bench and
   * the chair), off it anywhere but against the house's walls. For a friend's Muse standing by this one (src/visit/).
   */
  standable(dir: Vector3): boolean {
    const c = this.terrain.cottageLocal(dir, localTmp);
    if (Math.abs(c.x) >= 14 || Math.abs(c.z) >= 14) return true;
    if (this.deckAt(c.x, c.z) !== null) return this.deckFree(c.x, c.z);
    return !(Math.abs(c.x) < SIDE + GIRTH && c.z > -OUTER.z - GIRTH && c.z < OUTER.z + GIRTH);
  }

  /** A unit tangent at a spot toward a direction. */
  private toward(at: Spot, dir: Vector3): Vector3 {
    return tangentToward(at.dir, dir, new Vector3());
  }

  /** Its seat on the bench, facing out, for sitting there longer than its life would: working at home (muse.ts). */
  benchSeat(): { dir: Vector3; height: number; heading: Vector3 } {
    const seat = this.deckSpot(BENCH.x, BENCH.z + BENCH.depth + 0.02 * this.height);
    return { dir: seat.dir, height: this.groundAt(seat.dir) + BENCH.seat, heading: this.out(seat) };
  }

  /** The heading for "facing +z" (toward the pond) at a spot on the homestead. */
  private out(at: Spot): Vector3 {
    return tangentToward(at.dir, scratch2.copy(at.dir).addScaledVector(this.Z, 0.5), new Vector3());
  }

  /** Is a stretch of the meadow walkable (dry, out of the homestead)? Sampled every 0.4 m. */
  private clear(a: Vector3, b: Vector3, endsFree = 1.2): boolean {
    const length = angleBetween(a, b) * this.R;
    const steps = Math.max(1, Math.ceil(length / 0.4));
    const p = new Vector3();
    const c = { x: 0, z: 0 };
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      p.copy(a).lerp(b, f).normalize();
      const fromEnd = Math.min(f, 1 - f) * length;
      if (this.terrain.sample(p, ground).water < (fromEnd < endsFree ? 0.35 : 0.6)) return false;
      if (fromEnd < endsFree) continue;
      this.terrain.cottageLocal(p, c);
      if (c.x > HOMESTEAD.x0 && c.x < HOMESTEAD.x1 && c.z > HOMESTEAD.z0 && c.z < HOMESTEAD.z1) return false;
    }
    return true;
  }

  /**
   * The shortest way over the meadow from one place to another (the places
   * after the first, the last the place itself): straight if it can, else
   * round the homestead by its corners; null if there is none.
   */
  private meadowWay(from: Vector3, to: Vector3): Vector3[] | null {
    if (this.clear(from, to)) return [to];
    const nodes = [from, ...this.corners, to];
    const n = nodes.length;
    const best = new Array<number>(n).fill(Infinity);
    const back = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    best[0] = 0;
    for (;;) {
      let k = -1;
      for (let i = 0; i < n; i++) if (!done[i] && best[i] < Infinity && (k < 0 || best[i] < best[k])) k = i;
      if (k < 0 || k === n - 1) break;
      done[k] = true;
      for (let i = 1; i < n; i++) {
        if (done[i]) continue;
        const d = best[k] + angleBetween(nodes[k], nodes[i]) * this.R;
        if (d < best[i] && this.clear(nodes[k], nodes[i])) {
          best[i] = d;
          back[i] = k;
        }
      }
    }
    if (best[n - 1] === Infinity) return null;
    const way: Vector3[] = [];
    for (let k = n - 1; k > 0; k = back[k]) way.unshift(nodes[k]);
    return way;
  }

  /** A place out on the meadow to go to: random, more often close to the hut; dry, not steep, reachable from the steps' foot. */
  private meadowSpot(rand: () => number, dry = 1.2): Spot | null {
    const foot = this.local(FOOT.x, FOOT.z);
    for (let tries = 0; tries < 24; tries++) {
      const far = Math.min(ROAM.near + ROAM.far * Math.pow(rand(), ROAM.bias), 0.45 * Math.PI * this.R);
      const a = rand() * Math.PI * 2;
      // (from the hut's front, out into the meadow)
      scratch.copy(this.X).multiplyScalar(Math.cos(a)).addScaledVector(this.Z, Math.sin(a));
      const dir = travel(foot, tangentToward(foot, scratch.add(foot), new Vector3()), far / this.R, new Vector3());
      const g = this.terrain.sample(dir, ground);
      if (g.water < dry || g.clearing > 0.1) continue;
      // not on a slope it would stand crooked on
      const h0 = g.height;
      const t = tangentToward(dir, this.U, new Vector3());
      const h1 = this.terrain.height(travel(dir, t, 0.8 / this.R, scratch));
      if (Math.abs(h1 - h0) > 0.3) continue;
      if (!this.meadowWay(foot, dir)) continue;
      return { dir, deck: null };
    }
    return null;
  }

  /** A place on the home pond's shore to fish from (on the bank, the water before it), reachable from the steps' foot; and the way to the water. */
  private shoreSpot(rand: () => number): { spot: Spot; facing: Vector3 } | null {
    const foot = this.local(FOOT.x, FOOT.z);
    const pond = this.terrain;
    const centre = this.local(-7, pond.pondCentre);
    for (let tries = 0; tries < 24; tries++) {
      const a = rand() * Math.PI * 2;
      scratch.copy(this.X).multiplyScalar(Math.cos(a)).addScaledVector(this.Z, Math.sin(a));
      const outward = tangentToward(centre, scratch.add(centre), new Vector3());
      // out from the pond's middle to its bank: the first place 0.7 m onto dry land
      let d = 0;
      let dir: Vector3 | null = null;
      for (let r = 2; r < 3 * pond.pondRadius; r += 0.25) {
        const p = travel(centre, outward, r / this.R, new Vector3());
        if (this.terrain.sample(p, ground).water > 0.7) {
          dir = p;
          d = r;
          break;
        }
      }
      if (!dir || d < 1) continue;
      // the water close before it, the homestead behind it nowhere near, and a way there
      const ahead = travel(dir, tangentToward(dir, centre, new Vector3()), (1.2 * this.height) / this.R, new Vector3());
      if (this.terrain.sample(ahead, ground).water > -0.5) continue;
      const c = this.terrain.cottageLocal(dir, localTmp);
      if (c.x > HOMESTEAD.x0 - 1 && c.x < HOMESTEAD.x1 + 1 && c.z > HOMESTEAD.z0 && c.z < HOMESTEAD.z1 + 1) continue;
      if (!this.meadowWay(foot, dir)) continue;
      return { spot: { dir, deck: null }, facing: tangentToward(dir, centre, new Vector3()) };
    }
    return null;
  }

  // ---- writing the itinerary ----

  private push(segment: Segment): Segment {
    this.day.push(segment);
    this.starts.push(this.length);
    this.gaits.push(this.gait);
    this.length += segment.time;
    this.gait += segment.gait;
    return segment;
  }

  /** Stand where it is for a while, facing as asked, with something more (a look, holding its can). */
  private stand(name: string, time: number, f: Facing, extra?: (s: number, out: Roaming) => void): Segment {
    const at = this.here;
    const heading = f.clone();
    const segment = this.push({
      name,
      time,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(heading);
        extra?.(s, out);
      },
    });
    this.facing = heading;
    return segment;
  }

  /** A stand that may be cut short at once (a look about, a rest), and what to write after it then. */
  private halting(segment: Segment, then?: () => void): Segment {
    segment.stop = (s) => s;
    segment.then = then;
    return segment;
  }

  /** A pastime sat or lain in that may be cut short: its motions eased out where it is, then getting up from it. */
  private easing(segment: Segment, then: () => void): Segment {
    segment.stop = (s) => Math.min(segment.time, s + EASE);
    segment.then = then;
    return segment;
  }

  /** Step round on the spot to face as asked: quicker for a small turn than a half turn, none at all for a slight one. */
  private turn(to: Facing, name = 'turn', carry?: Carry): void {
    const at = this.here;
    const from = this.facing.clone();
    const angle = between(from, to, at.dir);
    this.facing = to.clone();
    if (Math.abs(angle) < TURN.least) return;
    const half = Math.abs(angle) / Math.PI;
    const time = TURN.time + TURN.half * half;
    const steps = 0.3 + 0.9 * half;
    this.push({
      name,
      time,
      gait: steps,
      play: (s, out, ctx) => {
        const u = s / time;
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        turned(from, at.dir, angle * smoothstep(0, 1, u), out.heading);
        out.action.walk = 0.55 * Math.sin(Math.PI * u) * Math.min(1, Math.abs(angle) / 1.0);
        out.action.stride = 0;
        out.action.gait = ctx.gait + steps * u;
        carry?.(s, out);
      },
    });
  }

  /**
   * A path through waypoints (unit directions, where it is first): each
   * corner rounded off (a curve from a little before it to a little after,
   * inside it), and a long walk over the meadow wandering a little off the
   * straight line, where the ground there allows.
   */
  private pathThrough(way: Vector3[], rand?: () => number): Path {
    const points: Vector3[] = [way[0]];
    for (let i = 1; i < way.length; i++) {
      const a = points[points.length - 1];
      const b = way[i];
      const length = angleBetween(a, b) * this.R;
      // (over the meadow, long: a bend or two off the straight line, each leg still walkable)
      if (rand && length > 7 && !this.onDeck(a) && !this.onDeck(b)) {
        const bends = length > 20 ? 2 : 1;
        const side = new Vector3().crossVectors(tangentToward(a, b, new Vector3()), a).normalize();
        const tries: Vector3[] = [];
        let sign = rand() < 0.5 ? -1 : 1;
        for (let k = 1; k <= bends; k++) {
          const f = k / (bends + 1);
          const off = sign * Math.min(PATH.meander * length, PATH.wander) * (0.5 + 0.5 * rand());
          tries.push(travel(a.clone().lerp(b, f).normalize(), side, off / this.R, new Vector3()));
          sign = -sign;
        }
        const legs = [a, ...tries, b];
        if (legs.every((p, k) => k === 0 || (this.clear(legs[k - 1], p, 0.6) && this.terrain.sample(p, ground).water > 0.8))) points.push(...tries);
      }
      points.push(b);
    }
    // (wide, sweeping corners out on the meadow, if the curve keeps to dry ground out of the homestead; tight ones on the deck)
    const wide = this.rounded(points, true);
    return this.walkable(wide) ? wide : this.rounded(points, false);
  }

  /** Is a path over dry ground and off the homestead, and on the deck clear of what is on it? */
  private walkable(path: Path): boolean {
    const c = { x: 0, z: 0 };
    const n = path.points.length;
    for (let i = 0; i < n; i += 2) {
      const p = path.points[i];
      if (this.onDeck(p)) {
        // (its ends, which may be close by things, let be)
        if (Math.min(path.at[i], path.length - path.at[i]) < 0.3) continue;
        this.terrain.cottageLocal(p, c);
        if (!this.deckFree(c.x, c.z)) return false;
        continue;
      }
      if (this.terrain.sample(p, ground).water < 0.3) return false;
      this.terrain.cottageLocal(p, c);
      if (c.x > HOMESTEAD.x0 + 0.4 && c.x < HOMESTEAD.x1 - 0.4 && c.z > HOMESTEAD.z0 + 0.4 && c.z < HOMESTEAD.z1 - 0.6) return false;
    }
    return true;
  }

  /** A path through points, each corner rounded off by a curve from a little before it to a little after (wide: as far as two fifths of either leg, out on the meadow). */
  private rounded(points: Vector3[], wide: boolean): Path {
    const path = new Path(this.R);
    path.add(points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      const c = points[i];
      const before = angleBetween(points[i - 1], c) * this.R;
      const after = angleBetween(c, points[i + 1]) * this.R;
      const open = wide && !this.onDeck(c) && !this.onDeck(points[i - 1]) && !this.onDeck(points[i + 1]);
      const d = open ? Math.min(PATH.sweep, 0.4 * before, 0.4 * after) : Math.min(wide ? 1.3 : PATH.corner, 0.45 * before, 0.45 * after);
      const into = travel(c, tangentToward(c, points[i - 1], scratch), d / this.R, new Vector3());
      const out = travel(c, tangentToward(c, points[i + 1], scratch), d / this.R, new Vector3());
      path.line(into, PATH.step);
      // (a quadratic curve with the corner for its pull: it stays inside the corner)
      const curve = Math.max(10, Math.ceil((2 * d) / PATH.step));
      for (let k = 1; k <= curve; k++) {
        const u = k / curve;
        path.add(new Vector3().addScaledVector(into, (1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(out, u * u).normalize());
      }
    }
    path.line(points[points.length - 1], PATH.step);
    return path;
  }

  /** Is a direction on the homestead's deck (the terrace, the steps, the pier)? */
  private onDeck(dir: Vector3): boolean {
    const c = this.terrain.cottageLocal(dir, localTmp);
    return Math.abs(c.x) < 14 && Math.abs(c.z) < 14 && this.deckAt(c.x, c.z) !== null;
  }

  /**
   * Walk a path, speeding up and slowing down at its ends, its heading the
   * path's way; setting off from the way it faced (`from`) it brings its
   * heading round to the path over the first stretch, and arriving, round to
   * the way it means to face (`end`). Cut short, it slows to a halt where it
   * is. Through the hut's door, the door swings open as it comes and shut
   * once it is through.
   */
  private walkPath(path: Path, to: Spot, name: string, from?: Vector3, end?: Vector3, carry?: Carry): void {
    const length = path.length;
    if (length < 0.05) return;
    const time = length / (PACE * this.height * (1 - RAMP));
    const steps = length / (2 * STEP.length * this.height);
    const startFacing = from?.clone();
    const endFacing = end?.clone();
    const ahead = new Vector3();
    /** How far along it is s seconds in (m), and its pace then (its share of a full one). */
    const along = (s: number): number => ((rampIntegral(s / time, 0, RAMP) - rampIntegral(s / time, 1 - RAMP, 1)) / (1 - RAMP)) * length;
    const paceAt = (s: number): number => smoothstep(0, RAMP, s / time) - smoothstep(1 - RAMP, 1, s / time);
    // (cut short: slowing to a halt from here, s seconds in, so far along, at this pace)
    const halt = { s: Infinity, d: 0, pace: 0 };
    const full = PACE * this.height;
    const start = this.length;
    const through = this.doorCrossing(path);
    if (through !== null) {
      // (open by the time it comes within the door's sweep, shutting once it is out of it for good)
      let near = through;
      let far = through;
      const c = { x: 0, z: 0 };
      path.points.forEach((p, i) => {
        this.terrain.cottageLocal(p, c);
        if (!this.swept(c.x, c.z, SWING.margin)) return;
        near = Math.min(near, path.at[i]);
        far = Math.max(far, path.at[i]);
      });
      // (when it is so far along: the walk's own ramps inverted)
      const when = (d: number): number => {
        if (d <= 0) return 0;
        if (d >= length) return time;
        let lo = 0;
        let hi = time;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          if (along(mid) < d) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      };
      const open = start + when(near - SWING.lead);
      const from = Math.max(this.cutAt, open - SWING.open);
      this.doorways.push({ from, open: Math.max(open, from + 0.3), shut: Math.max(start + when(far) + 0.2, open), through: start + when(through) });
    }
    const segment = this.push({
      name,
      time,
      gait: steps,
      play: (s, out, ctx) => {
        let d = along(s);
        let speed = paceAt(s);
        if (s > halt.s) {
          const t = Math.min(s - halt.s, HALT);
          d = Math.min(length, halt.d + halt.pace * full * (t - (t * t) / (2 * HALT)));
          speed = halt.pace * (1 - t / HALT);
        }
        const covered = d / length;
        path.point(d, out.dir);
        out.height = this.groundAt(out.dir);
        path.heading(d, out.heading);
        // (the facing it set off with, carried along to here, coming round to the path's way; arriving, round to the facing it means to have)
        if (startFacing) {
          const was = tangentToward(out.dir, scratch.copy(out.dir).add(startFacing), facingTmp);
          turned(was.clone(), out.dir, between(was, out.heading, out.dir) * smoothstep(0, PATH.ease, d), out.heading);
        }
        if (endFacing) {
          const will = tangentToward(out.dir, scratch.copy(out.dir).add(endFacing), facingTmp);
          turned(out.heading.clone(), out.dir, between(out.heading, will, out.dir) * smoothstep(length - PATH.ease, length, d), out.heading);
        }
        out.action.walk = smoothstep(0, 0.35, speed);
        out.action.gait = ctx.gait + steps * covered;
        // looking a little ahead along the way
        path.point(Math.min(length, d + 2.5), ahead);
        out.lookAt = lookTmp.copy(ahead).multiplyScalar(this.R + this.groundAt(ahead) + 0.6 * this.height);
        carry?.(s, out);
      },
      stop: (s) => {
        // (near its end it slows to a stop as it is)
        if (time - s < HALT * 1.5) return time;
        halt.s = s;
        halt.d = along(s);
        halt.pace = paceAt(s);
        segment.gait = (steps * Math.min(length, halt.d + (halt.pace * full * HALT) / 2)) / length;
        return s + HALT;
      },
    });
    this.facing = endFacing ?? path.heading(length, new Vector3());
    this.here = to;
  }

  /** Would the door, swinging, touch Muse here (local m), to within a margin (m)? Within its sweep round the hinge (and Muse's arms), on the room's side of its plane (or within reach of it). */
  private swept(x: number, z: number, margin = 0): boolean {
    return z < DOORWAY.z + ARMS + margin && Math.hypot(x - DOORWAY.hinge[0], z - DOORWAY.hinge[1]) < DOOR.width + ARMS + margin;
  }

  /** Where a path goes through the hut's front door (m along it), if it does. */
  private doorCrossing(path: Path): number | null {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    for (let i = 1; i < path.points.length; i++) {
      this.terrain.cottageLocal(path.points[i - 1], a);
      this.terrain.cottageLocal(path.points[i], b);
      const da = a.z - DOORWAY.z;
      const db = b.z - DOORWAY.z;
      if (da * db > 0 || da === db) continue;
      const f = da / (da - db);
      const x = a.x + (b.x - a.x) * f;
      if (x > DOORWAY.x0 && x < DOORWAY.x1) return path.at[i - 1] + (path.at[i] - path.at[i - 1]) * f;
    }
    return null;
  }

  /** The way from where it is to a spot: over the deck (straight, or round what is in the way), down or up its steps, over the meadow (straight, or round the homestead). */
  private route(to: Spot): Spot[] {
    const from = this.here;
    const way: Spot[] = [];
    const deck = (ps: { x: number; z: number }[]): void => {
      for (const p of ps) way.push(this.deckSpot(p.x, p.z));
    };
    const meadow = (ps: Vector3[]): void => {
      for (const p of ps) way.push({ dir: p, deck: null });
    };
    const foot = this.local(FOOT.x, FOOT.z);
    if (from.deck && to.deck) {
      deck(this.deckWay(from.deck, to.deck));
      way[way.length - 1] = to;
      return way;
    }
    if (from.deck) {
      // off the deck: to the top of its steps, down them, on over the meadow
      deck(this.deckWay(from.deck, TOP));
      way.push({ dir: foot, deck: null });
      meadow(this.meadowWay(foot, to.dir) ?? [to.dir]);
      way[way.length - 1] = to;
      return way;
    }
    if (to.deck) {
      // over the meadow to the foot of the steps, up them, on over the deck
      if (angleBetween(from.dir, foot) * this.R > 0.3) meadow(this.meadowWay(from.dir, foot) ?? [foot]);
      way.push(this.deckSpot(TOP.x, TOP.z));
      deck(this.deckWay(TOP, to.deck));
      way[way.length - 1] = to;
      return way;
    }
    meadow(this.meadowWay(from.dir, to.dir) ?? [foot, to.dir]);
    way[way.length - 1] = to;
    return way;
  }

  /**
   * Go to a spot and face as asked: along one smooth path through the way
   * there, turning into it as it sets off (on the spot first if it is facing
   * well away from it) and coming round to its facing as it arrives (or on
   * the spot after, for a big turn). The first segment named for where it is
   * going.
   */
  private go(to: Spot, f: Facing, name: string, rand?: () => number, carry?: Carry): void {
    const way = [this.here.dir, ...this.route(to).map((s) => s.dir)].filter((p, k, all) => k === 0 || angleBetween(all[k - 1], p) * this.R > 0.05);
    if (way.length < 2) {
      this.turn(f, name, carry);
      return;
    }
    const path = this.pathThrough(way, rand);
    const set = path.heading(0, new Vector3());
    const off = Math.abs(between(this.facing, set, this.here.dir));
    if (off > PATH.swing) this.turn(set, name, carry);
    const arrive = path.heading(path.length, new Vector3());
    const end = Math.abs(between(arrive, f, to.dir)) <= PATH.swing;
    this.walkPath(path, to, off > PATH.swing ? 'walk' : name, off > PATH.swing ? undefined : this.facing, end ? f : undefined, carry);
    if (!end) this.turn(f, 'turn', carry);
  }

  /** A move played where it is (its posture's own placement given by `place`), with something more (told how long it now runs: it may be cut short). */
  private play(name: string, kind: MoveKind, time: number, extra?: (s: number, out: Roaming, move: Move, time: number) => void, place?: (s: number, out: Roaming) => void): Segment {
    const at = this.here;
    const f = this.facing.clone();
    const segment: Segment = this.push({
      name,
      time,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(f);
        place?.(s, out);
        const move: Move = { kind, time: s, amount: 1, ease: smoothstep(0, 0.7, s) * smoothstep(0, 0.7, segment.time - s) };
        out.action.moves.push(move);
        extra?.(s, out, move, segment.time);
      },
    });
    return segment;
  }

  /** Write the next outing: choose what to do (not the same twice running), go there, do it. */
  private outing(): void {
    const rand = random(this.seed * 7919 + this.outings * 104729 + 17);
    this.outings++;
    const pick = (): Like => {
      const likes = Object.entries(LIKES) as [Like, number][];
      const total = likes.reduce((t, [, w]) => t + w, 0);
      let r = rand() * total;
      for (const [like, w] of likes) {
        r -= w;
        if (r <= 0) return like;
      }
      return 'rest';
    };
    let like = pick();
    if (like === this.last) like = pick();
    this.last = like;
    const H = this.height;
    switch (like) {
      case 'rest': {
        // out on the porch, looking over the meadow
        const spot = this.deckSpot(-0.6 + 2.4 * rand(), TERRACE.z1 - 0.45);
        this.go(spot, this.out(spot), 'home', rand);
        this.halting(this.stand('rest', 10 + 12 * rand(), this.facing, (_s, out) => (out.lookAt = null)));
        return;
      }
      case 'wander': {
        const spot = this.meadowSpot(rand);
        if (!spot) return this.outingHome(rand);
        this.go(spot, this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), -1 / this.R, new Vector3())), 'wander', rand);
        this.halting(this.stand('look about', 6 + 6 * rand(), this.facing, (_s, out) => (out.lookAt = null)));
        if (rand() < 0.5) {
          this.play('plop', 'plop', PLOP);
          this.easing(
            this.play('sit', 'sit', 15 + 25 * rand(), (_s, out) => (out.lookAt = null)),
            () => this.play('rise', 'rise', RISE),
          );
          this.play('rise', 'rise', RISE);
        }
        return;
      }
      case 'water': {
        const spot = this.meadowSpot(rand);
        if (!spot) return this.outingHome(rand);
        const facing = this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), -1 / this.R, new Vector3()));
        this.go(spot, facing, 'to water', rand);
        // the can out of its pocket; poured here and there, as it goes, now long, now short, now sweeping it over
        // the plants, a content look now and then; between, a shuffle aside, a turn, a few steps, a look about
        this.can(false);
        const holding = this.day.length;
        const pours = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < pours; k++) {
          this.pour(2.4 + 3 * rand(), 0.7 + 0.3 * rand(), rand() < 0.5, rand() < 0.4);
          if (k === pours - 1) break;
          const r = rand();
          if (r < 0.35) this.shuffle(rand);
          else if (r < 0.65) this.turn(turned(this.facing, this.here.dir, (rand() < 0.5 ? -1 : 1) * (0.35 + 0.75 * rand()), new Vector3()), 'turn', holdingCan);
          else if (r < 0.9) this.stroll(rand);
          else this.halting(this.stand('look about', 1.5 + 1.5 * rand(), this.facing, holdingCan));
        }
        // (cut short with the can out: put away)
        for (let i = holding; i < this.day.length; i++) this.day[i].then = () => this.can(true);
        this.can(true);
        return;
      }
      case 'bench': {
        // up onto the bench, its back to the house, swinging its legs, humming, down again
        const x = BENCH.x + 0.4 * (rand() - 0.5) * BENCH.half;
        const front = this.deckSpot(x, BENCH.z + BENCH.depth + 0.47 * H);
        const seatZ = BENCH.z + BENCH.depth + 0.02 * H;
        const seat = this.deckSpot(x, seatZ);
        this.go(front, this.out(front), 'to the bench', rand);
        this.hop('hopUp', front, seat, BENCH.seat);
        const perch = this.play('bench', 'perch', 30 + 45 * rand(), (s, out) => {
          out.lookAt = null;
          out.cues.hum = perchBeats(s).hum;
        }, (_s, out) => (out.height += BENCH.seat));
        this.easing(perch, () => this.hop('hopDown', seat, front, BENCH.seat));
        this.hop('hopDown', seat, front, BENCH.seat);
        return;
      }
      case 'fish': {
        const shore = rand() < SHORE ? this.shoreSpot(rand) : null;
        const fishing = (3 + Math.floor(3 * rand())) * FISH.period + 2 * POCKET.time;
        if (shore) {
          // from a bank it has wandered to, sitting in the grass
          this.go(shore.spot, shore.facing, 'to the shore', rand);
          this.play('plop', 'plop', PLOP);
          this.fishing(fishing, false).then = () => this.play('rise', 'rise', RISE);
          this.play('rise', 'rise', RISE);
          return;
        }
        // off the end of the pier: sat on its edge, the legs over the water
        const edgeZ = PIER.z1;
        const stand = this.deckSpot(PIER_SPOT, edgeZ - 0.25 * H);
        const sit = this.deckSpot(PIER_SPOT, edgeZ + 0.02 * H);
        this.go(stand, this.out(stand), 'to the pier', rand);
        const along = (s: number, a: number, b: number, from: Spot, to: Spot, out: Roaming): void => {
          out.dir.copy(from.dir).lerp(to.dir, smoothstep(a, b, s)).normalize();
          out.height = this.terrain.cottageGround + FLOOR;
        };
        this.play('plop', 'plop', PLOP, (_s, _out, move) => (move.edge = true), (s, out) => along(s, 0.25, 0.65, stand, sit, out));
        this.here = sit;
        const rise = (): void => {
          this.play('rise', 'rise', RISE, (_s, _out, move) => (move.edge = true), (s, out) => along(s, 0.35, 0.85, sit, stand, out));
          this.here = stand;
        };
        this.fishing(fishing, true).then = rise;
        rise();
        return;
      }
      case 'nap': {
        const spot = this.meadowSpot(rand, 2);
        if (!spot) return this.outingHome(rand);
        const facing = this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), (rand() - 0.5) * 4 / this.R, new Vector3()));
        this.go(spot, facing, 'to a nap', rand);
        this.play('yawn', 'yawn', YAWN_LENGTH, (_s, out) => (out.lookAt = null));
        this.play('plop', 'plop', PLOP);
        this.play('lie back', 'lieBack', LIE_BACK);
        const nap = this.play('nap', 'sleep', 45 + 50 * rand(), (s, out) => (out.cues.sleep = { time: s, roused: -1 }));
        const wake = (): void => {
          this.wake(nap.time);
          this.play('rise', 'rise', RISE);
        };
        this.easing(nap, wake);
        wake();
        return;
      }
    }
  }

  /** The can taken out of its pocket (or put back): the mitten's dip into the pocket, the can held from as it comes out. */
  private can(away: boolean): void {
    this.stand(away ? 'can away' : 'can out', POCKET.time, this.facing, (s, out) => {
      const t = away ? POCKET.time - s : s;
      const pocket = smoothstep(0, POCKET.in, t) * (1 - smoothstep(POCKET.out, POCKET.time, t));
      out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: smoothstep(POCKET.out, POCKET.time, t), tip: 0, glad: 0 });
      if (pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: pocket });
      out.cues.water = { time: s, grip: smoothstep(POCKET.out - 0.05, POCKET.out + 0.1, t), tip: 0, pour: 0 };
      out.lookAt = null;
    });
  }

  /** A pour: the can tipped (as far as `tip`) and held a while, sweeping it a little over the plants or not, righted; then a content look, or not. */
  private pour(time: number, tip: number, sweep: boolean, glad: boolean): void {
    const at = this.here;
    const f = this.facing.clone();
    const H = this.height;
    const look = glad ? 1.8 : 0;
    // (cut short here, s: the can righted and the look gone over the half second after)
    let cut = Infinity;
    const segment = this.push({
      name: 'pour',
      time: time + look,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        const left = s > cut ? 1 - smoothstep(cut, cut + 0.5, s) : 1;
        const sway = sweep ? 0.22 * Math.sin((2 * Math.PI * s) / time) * smoothstep(0.3, 1, s) * smoothstep(0.3, 1, time - s) * left : 0;
        turned(f, at.dir, s < time ? sway : 0, out.heading);
        const tipped = tip * smoothstep(0, 0.6, s) * smoothstep(0, 0.5, time - s) * left;
        const content = glad ? smoothstep(time, time + 0.4, s) * smoothstep(0, 0.5, time + look - s) * left : 0;
        out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: 1, tip: tipped, glad: content });
        out.cues.water = { time: s, grip: 1, tip: tipped, pour: smoothstep(0.4, 0.7, tipped) };
        out.lookAt = lookTmp.copy(out.dir).multiplyScalar(this.R + out.height).addScaledVector(out.heading, 0.6 * H);
      },
      stop: (s) => {
        cut = s;
        return Math.min(segment.time, s + 0.5);
      },
    });
  }

  /** A shuffle aside (to its left or right, where the ground is dry), the can held, facing as it was. */
  private shuffle(rand: () => number): void {
    const at = this.here;
    const f = this.facing.clone();
    const H = this.height;
    const right = new Vector3().crossVectors(f, at.dir).normalize();
    const d = (0.18 + 0.2 * rand()) * H;
    let to: Vector3 | null = null;
    for (const side of rand() < 0.5 ? [1, -1] : [-1, 1]) {
      const p = travel(at.dir, right, (side * d) / this.R, new Vector3());
      if (this.terrain.sample(p, ground).water > 1 && this.clear(at.dir, p, 0)) {
        to = p;
        break;
      }
    }
    if (!to) return;
    const end = to;
    const time = 0.8 + d / H;
    const steps = (2 * d) / (2 * STEP.length * H);
    this.push({
      name: 'shuffle',
      time,
      gait: steps,
      play: (s, out, ctx) => {
        const u = s / time;
        out.dir.copy(at.dir).lerp(end, smoothstep(0, 1, u)).normalize();
        out.height = this.groundAt(out.dir);
        out.heading.copy(tangentToward(out.dir, scratch.copy(out.dir).add(f), facingTmp));
        out.action.walk = 0.5 * Math.sin(Math.PI * u);
        out.action.stride = 0.45;
        out.action.gait = ctx.gait + steps * u;
        holdingCan(s, out);
      },
    });
    this.here = { dir: end, deck: null };
  }

  /** A few steps on to the next plants (a metre or two, roughly the way it faces, where the ground is dry), the can held. */
  private stroll(rand: () => number): void {
    const at = this.here;
    for (let tries = 0; tries < 6; tries++) {
      const way = turned(this.facing, at.dir, (rand() - 0.5) * 2.4, new Vector3());
      const p = travel(at.dir, way, ((0.5 + 0.6 * rand()) * this.height) / this.R, new Vector3());
      if (this.terrain.sample(p, ground).water < 1.2 || !this.clear(at.dir, p, 0)) continue;
      // (it faces on the way it went, a little round)
      const onward = turned(tangentToward(p, at.dir, new Vector3()).negate(), p, (rand() - 0.5) * 0.8, new Vector3());
      this.go({ dir: p, deck: null }, onward, 'stroll', rand, holdingCan);
      return;
    }
  }

  /** Nowhere out there would do: home to the porch to look out a while. */
  private outingHome(rand: () => number): void {
    const spot = this.deckSpot(-0.6 + 2.4 * rand(), TERRACE.z1 - 0.45);
    this.go(spot, this.out(spot), 'home', rand);
    this.halting(this.stand('rest', 6 + 4 * rand(), this.facing, (_s, out) => (out.lookAt = null)));
  }

  /** Waking from a sleep this long (s): sitting up, rubbing its eyes, the snore bubble popping; `place` sets it where it lies. */
  private wake(slept: number, place?: (s: number, out: Roaming) => void): void {
    this.play('wake', 'wake', WAKE, (s, out) => {
      if (s < 0.4) out.cues.sleep = { time: slept + s, roused: s };
    }, place);
  }

  /** Fishing where it sits (on a bank, or on the pier's edge), the rod out of its pocket and back (cut short, back at once). */
  private fishing(time: number, edge: boolean): Segment {
    const H = this.height;
    const segment = this.play('fish', 'fish', time, (s, out, move, T) => {
      const tool = withTool(s, T);
      move.time = tool.time;
      move.ease = tool.ease;
      move.edge = edge;
      if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
      // looking at the float on the water before it
      out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(out.dir).multiplyScalar(this.R).addScaledVector(out.heading, 1.25 * H);
      out.cues.fish = { time: tool.time, grip: tool.grip, edge };
    }, edge ? (_s, out) => (out.height = this.terrain.cottageGround + FLOOR) : undefined);
    segment.stop = (s) => Math.min(segment.time, s + POCKET.time);
    return segment;
  }

  /** A hop up onto a seat behind it (or down off it to its front): from one spot to the other in an arc, `seat` over the floor. */
  private hop(kind: 'hopUp' | 'hopDown', from: Spot, to: Spot, seat: number): void {
    const time = kind === 'hopUp' ? HOP.up : HOP.down;
    const f = this.facing.clone();
    const H = this.height;
    this.push({
      name: kind,
      time,
      gait: 0,
      play: (s, out) => {
        const { along, rise, over } = hopArc(s, kind === 'hopUp');
        out.dir.copy(from.dir).lerp(to.dir, along).normalize();
        out.height = this.terrain.cottageGround + FLOOR + seat * rise + over * H;
        out.heading.copy(f);
        out.action.moves.push({ kind, time: s, amount: 1 });
      },
    });
    this.here = to;
  }

  /** Write the itinerary on until it reaches a time (s). */
  private writeTo(t: number): void {
    while (this.length <= t + 1) {
      const before = this.day.length;
      this.outing();
      // (an outing that went nowhere: a breath on the spot, so time still moves on)
      if (this.day.length === before) this.stand('rest', 5, this.facing);
    }
  }

  // ---- visits to its hut ----

  /**
   * You knocked at its hut's door at `now` (while it was about): it puts by what it was doing and comes home, up the
   * steps, along the porch and in through the door (open as it comes, shut behind it), to do there what it does this
   * time (`doing`): greet you on the rug, cook at the hearth, or go to bed. `room`: the hut inside, as laid out.
   */
  comeIn(now: number, doing: Indoors, room: Room): void {
    this.enter(room);
    this.cut(now);
    if (doing === 'greet') this.greetYou(room);
    else if (doing === 'cook') this.cookAt(room);
    else this.toBed(room);
  }

  /** You stepped out of its hut at `now`: it puts by what it was doing in there and goes out onto its porch, a look about there, and its days go on from there. */
  goOut(now: number): void {
    if (!this.room) return;
    this.cut(now);
    if (this.inHut(this.here.dir)) {
      const porch = this.deckSpot(DOOR.x, DOOR.porch);
      this.go(porch, this.out(porch), 'out');
      this.halting(this.stand('look about', 2 + 2 * random(this.seed * 13 + this.outings)(), this.facing, (_s, out) => (out.lookAt = null)));
    }
    this.room = null;
    this.roomWays = [];
  }

  /** Its room for this visit, and the places to go round what stands there by (a little out from each corner, where it may stand), the way in among them. */
  private enter(room: Room): void {
    this.room = room;
    const m = GIRTH + 0.12;
    this.roomWays = [
      { x: DOOR.x, z: DOOR.porch },
      { x: DOOR.x, z: ROOM.z - 0.6 },
      { x: DOOR.x, z: DOORWAY.z - DOOR.width - 0.2 },
    ];
    for (const t of room.things) {
      for (const [x, z] of [
        [t.x0 - m, t.z0 - m],
        [t.x1 + m, t.z0 - m],
        [t.x0 - m, t.z1 + m],
        [t.x1 + m, t.z1 + m],
      ]) {
        if (this.deckFree(x, z)) this.roomWays.push({ x, z });
      }
    }
  }

  /**
   * Cut its day short at `now` (you knocked, or stepped out of its hut): what it is doing comes to a stop there (a
   * walk slowing to a halt, a pastime's motions eased out, its tool put away), what can't be cut short (a hop,
   * sitting down, a turn) running to its end first, and how it gets up from it written after (off the bench, up out
   * of the grass, awake); the rest of the outing goes. The next walk starts where it then is, as it faces.
   */
  private cut(now: number): void {
    const u = this.clock(now);
    this.writeTo(u);
    let k = this.segmentAt(u);
    let s = u - this.starts[k];
    while (!this.day[k].stop && k + 1 < this.day.length) {
      k++;
      s = 0;
    }
    const segment = this.day[k];
    if (segment.stop) segment.time = segment.stop(Math.min(s, segment.time));
    this.day.length = this.starts.length = this.gaits.length = k + 1;
    this.length = this.starts[k] + segment.time;
    this.gait = this.gaits[k] + segment.gait;
    this.cutAt = u;
    // its door: what was to open it later goes; open for a way it now won't go through, it shuts as it halts
    for (let i = this.doorways.length - 1; i >= 0; i--) {
      const d = this.doorways[i];
      if (d.from >= u) this.doorways.splice(i, 1);
      else if (d.through > u) d.shut = Math.min(d.shut, this.length);
    }
    // where it now is, and which way it faces
    const p = this.probe;
    p.action.moves.length = 0;
    p.cues.water = p.cues.fish = p.cues.cook = p.cues.sleep = null;
    segment.play(segment.time, p, { camera: p.dir, gait: this.gaits[k] });
    this.here = this.spotAt(p.dir);
    this.facing = p.heading.clone();
    segment.then?.();
  }

  /** The spot at a direction: on the deck (its local meters), or out on the meadow. */
  private spotAt(dir: Vector3): Spot {
    const c = this.terrain.cottageLocal(dir, { x: 0, z: 0 });
    const deck = Math.abs(c.x) < 14 && Math.abs(c.z) < 14 && this.deckAt(c.x, c.z) !== null;
    return { dir: dir.clone(), deck: deck ? { x: c.x, z: c.z } : null };
  }

  /** The heading at a spot toward a way across the homestead (a unit x, z in its frame). */
  private facingWay(at: Spot, way: readonly [number, number]): Vector3 {
    const c = at.deck ?? this.terrain.cottageLocal(at.dir, { x: 0, z: 0 });
    return tangentToward(at.dir, this.local(c.x + 0.5 * way[0], c.z + 0.5 * way[1]), new Vector3());
  }

  /** In its room to where it greets you, and greeting you there: a wave as it gets there and now and then after, its eyes on you till then. */
  private greetYou(room: Room): void {
    const spot = this.deckSpot(room.greet.x, room.greet.z);
    this.go(spot, this.facingWay(spot, room.greet.facing), 'to greet you');
    const at = this.here;
    const f = this.facing.clone();
    const waving = (s: number): number => (s < INDOOR.wave ? -1 : (s - INDOOR.wave) % INDOOR.again);
    this.push({
      name: 'greet',
      time: STAY,
      gait: 0,
      play: (s, out, ctx) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(f);
        const w = waving(s);
        if (w >= 0 && w < WAVE_LENGTH) out.action.wave = w;
        if (s < INDOOR.watch || (w >= 0 && w < WAVE_LENGTH)) out.lookAt = lookTmp.copy(ctx.camera);
      },
      // (a wave seen through)
      stop: (s) => {
        const w = waving(s);
        return w >= 0 && w < WAVE_LENGTH ? s + WAVE_LENGTH - w : s;
      },
    });
  }

  /** In its room to the hearth, and cooking there: the ladle out of its pocket, rounds of stirring and tasting, put back, a look about, again (cut short, the ladle put back at once). */
  private cookAt(room: Room): void {
    const c = room.cook;
    const spot = this.deckSpot(c.x, c.z);
    this.go(spot, this.facingWay(spot, c.facing), 'to the hearth');
    const at = this.here;
    const f = this.facing.clone();
    const pot = this.local(c.pot[0], c.pot[2]).multiplyScalar(this.R + this.terrain.cottageGround + c.pot[1]);
    const cooking = INDOOR.rounds * COOK.period + 2 * POCKET.time;
    const cycle = cooking + INDOOR.pause;
    // (cut short: the ladle back in its pocket by then, s)
    let end = Infinity;
    this.push({
      name: 'cook',
      time: STAY,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(f);
        const from = Math.floor(s / cycle) * cycle;
        const t = s - from;
        const total = Math.min(cooking, end - from);
        if (t >= total) return;
        const tool = withTool(t, total);
        out.action.moves.push({ kind: 'stir', time: tool.time, amount: 1, ease: tool.ease });
        if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: t, amount: tool.pocket });
        out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(pot);
        out.cues.cook = { time: tool.time, grip: tool.grip, pot };
      },
      stop: (s) => {
        const from = Math.floor(s / cycle) * cycle;
        if (s - from >= cooking) return s;
        end = Math.min(from + cooking, s + POCKET.time);
        return end;
      },
    });
  }

  /**
   * In its room to bed: before it, its back to it, a yawn, up onto its edge, round and back onto it (its legs swung
   * up), lying back, asleep, its head on the pillow; cut short, awake, round with its legs over the edge, down.
   */
  private toBed(room: Room): void {
    const b = room.bed;
    const H = this.height;
    const [sx, sz] = b.side;
    const ex = b.x + sx * b.edge;
    const ez = b.z + sz * b.edge;
    const seat = this.deckSpot(ex, ez);
    const front = this.deckSpot(ex + sx * 0.45 * H, ez + sz * 0.45 * H);
    const lie = this.deckSpot(b.x, b.z);
    const away = this.facingWay(front, b.side);
    const foot = this.facingWay(lie, b.foot);
    const edge = b.y + BED.edge;
    const onBed = (_s: number, out: Roaming): void => {
      out.height = this.terrain.cottageGround + b.y;
    };
    this.go(front, away, 'to bed');
    this.play('yawn', 'yawn', YAWN_LENGTH, (_s, out) => (out.lookAt = null));
    this.hop('hopUp', front, seat, edge - FLOOR);
    this.swivel(seat, lie, away, foot, edge, b.y, true);
    this.play('lie back', 'lieBack', LIE_BACK, (_s, out) => (out.lookAt = null), onBed);
    const asleep = this.play('asleep', 'sleep', STAY, (s, out) => (out.cues.sleep = { time: s, roused: -1 }), onBed);
    this.easing(asleep, () => {
      this.wake(asleep.time, onBed);
      this.swivel(lie, seat, foot, away, b.y, edge, false);
      this.hop('hopDown', seat, front, edge - FLOOR);
    });
  }

  /** On its bed: from perched on its edge facing out of it, round and back onto it, sat facing its foot (into), or back out again (heights over the clearing, m). */
  private swivel(from: Spot, to: Spot, fromHeading: Vector3, toHeading: Vector3, fromHeight: number, toHeight: number, into: boolean): void {
    const time = BED.swing;
    const f = fromHeading.clone();
    const angle = between(fromHeading, toHeading, from.dir);
    this.push({
      name: into ? 'into bed' : 'out of bed',
      time,
      gait: 0,
      play: (s, out) => {
        const u = smoothstep(0, 1, s / time);
        out.dir.copy(from.dir).lerp(to.dir, u).normalize();
        out.height = this.terrain.cottageGround + fromHeight + (toHeight - fromHeight) * u;
        turned(f, out.dir, angle * u, out.heading);
        const sat = into ? u : 1 - u;
        out.action.moves.push({ kind: 'perch', time: s, amount: 1 - sat, ease: 0 }, { kind: 'sit', time: s, amount: sat, ease: 0 });
        out.lookAt = null;
      },
    });
    this.here = to;
    this.facing = toHeading.clone();
  }

  /** Is a direction in its hut (inside its walls' outer faces)? */
  private inHut(dir: Vector3): boolean {
    const c = this.terrain.cottageLocal(dir, localTmp);
    return Math.abs(c.x) < OUTER.x && Math.abs(c.z) < OUTER.z;
  }

  // ---- reading it back ----

  /** Move the day on so that at time `now` it is `at` seconds into its itinerary (dev). */
  seek(now: number, at: number): void {
    this.shift = at - now;
    this.you.reset();
  }

  /** The itinerary's clock at a time: the caller's, less what it has spent answering you. */
  clock(now: number): number {
    return Math.max(0, now + this.shift - this.you.heldBack(now));
  }

  /** The part of the itinerary under its clock at a time (by halves: it only grows). */
  private segmentAt(u: number): number {
    let lo = 0;
    let hi = this.day.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= u) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** How far its hut's front door stands open at a time (0 shut … 1): opening as Muse comes to it, shutting once it is through. */
  doorAt(now: number): number {
    const u = this.clock(now);
    let open = 0;
    for (const d of this.doorways) open = Math.max(open, smoothstep(d.from, d.open, u) * (1 - smoothstep(d.shut, d.shut + SWING.shut, u)));
    return open;
  }

  /** How far into its hut a direction is (0 out of it … 1 in its room past the doorway): how much its walls hide it. */
  indoors(dir: Vector3): number {
    const c = this.terrain.cottageLocal(dir, localTmp);
    if (Math.abs(c.x) > OUTER.x || Math.abs(c.z) > OUTER.z + 0.3) return 0;
    return 1 - smoothstep(ROOM.z - 0.3, OUTER.z + 0.3, c.z);
  }

  /** The itinerary's parts so far and their starts (s) (dev). */
  get names(): { name: string; start: number }[] {
    return this.day.map((s, k) => ({ name: s.name, start: this.starts[k] }));
  }

  tap(now: number): void {
    this.you.tap(now, this.living.cues.sleep !== null);
  }

  hold(now: number, side: number): void {
    this.you.hold(now, side, this.living.cues.sleep !== null);
  }

  letGo(now: number): void {
    this.you.letGo(now, this.living.cues.sleep !== null);
  }

  /** Muse at a time: where it stands, its heading and action, what it looks at, the props' cues. camera: planet space, for turning to you and looking at you. */
  at(now: number, camera: Vector3): Roaming {
    const out = this.living;
    const a = out.action;
    a.time = now;
    a.walk = 0;
    a.stride = 1;
    a.wave = -1;
    a.look = 1;
    a.moves.length = 0;
    out.lookAt = null;
    const c = out.cues;
    c.water = c.fish = c.cook = c.sleep = null;
    c.hum = 0;
    c.petted = -1;
    const u = this.clock(now);
    this.writeTo(u);
    const k = this.segmentAt(u);
    const s = Math.min(this.day[k].time, u - this.starts[k]);
    a.gait = this.gaits[k];
    this.day[k].play(s, out, { camera, gait: this.gaits[k] });
    this.answer(now, out, camera);
    const local = this.terrain.cottageLocal(out.dir, localTmp);
    out.home = local.x > HOMESTEAD.x0 && local.x < HOMESTEAD.x1 && local.z > -3 && local.z < HOMESTEAD.z1 + 5;
    return out;
  }

  /**
   * Muse in its hut while you are there (the cutaway, view/cutaway.ts; muse.ts's `inside`), where it is put and
   * facing as it is put, doing one of three things: at the hearth's stove, cooking as at the porch's (the ladle out
   * of its pocket, stirring and tasting, a few rounds, a moment's look about, again); standing in the room greeting
   * you (a wave as you come in, its eyes on you, a wave again now and then); or asleep on its bed (lying back,
   * breathing slow, its snore bubble; a tap and it stirs). Your doings and its answers over it as anywhere.
   * `since`: when you came in (world s). camera: planet space.
   */
  inside(now: number, camera: Vector3, at: { doing: Indoors; dir: Vector3; height: number; heading: Vector3; pot: Vector3 | null; since: number }): Roaming {
    const out = this.living;
    const a = out.action;
    a.time = now;
    a.walk = 0;
    a.stride = 1;
    a.wave = -1;
    a.look = 1;
    a.gait = 0;
    a.moves.length = 0;
    out.lookAt = null;
    const c = out.cues;
    c.water = c.fish = c.cook = c.sleep = null;
    c.hum = 0;
    c.petted = -1;
    out.dir.copy(at.dir);
    out.height = at.height;
    out.heading.copy(at.heading);
    const since = now - at.since;
    if (at.doing === 'sleep') {
      a.moves.push({ kind: 'sleep', time: since, amount: 1, ease: 1, roused: -1 });
      c.sleep = { time: since, roused: -1 };
    } else if (at.doing === 'greet') {
      const w = since < INDOOR.wave ? -1 : (since - INDOOR.wave) % INDOOR.again;
      if (w >= 0 && w < WAVE_LENGTH) a.wave = w;
      if (since < INDOOR.watch || (w >= 0 && w < WAVE_LENGTH)) out.lookAt = lookTmp.copy(camera);
    } else if (at.pot) {
      const cooking = INDOOR.rounds * COOK.period + 2 * POCKET.time;
      const cycle = cooking + INDOOR.pause;
      const s = (((now - at.since) % cycle) + cycle) % cycle;
      if (s < cooking) {
        const tool = withTool(s, cooking);
        a.moves.push({ kind: 'stir', time: tool.time, amount: 1, ease: tool.ease });
        if (tool.pocket > 0) a.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
        out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(at.pot);
        c.cook = { time: tool.time, grip: tool.grip, pot: at.pot };
      }
    }
    this.answer(now, out, camera);
    out.home = true;
    return out;
  }

  /** Your doings and its answers over what it is doing: turned to you while it answers, if it is standing or walking; where it looks. */
  private answer(now: number, out: Roaming, camera: Vector3): void {
    const a = out.action;
    const c = out.cues;
    // turned to you while it answers you, if it is standing or walking (stepping round as it turns)
    const w = this.you.attending(now);
    if (w <= 0) this.turnSide = 0;
    if (w > 0 && a.moves.length === 0) {
      const toYou = tangentToward(out.dir, camera, facingTmp);
      let turn = between(out.heading, toYou, out.dir);
      if (this.turnSide === 0) this.turnSide = turn >= 0 ? 1 : -1;
      // (the long way round rather than flipping sides, once it has started round one way)
      if (Math.sign(turn) !== this.turnSide && Math.abs(turn) > 0.75 * Math.PI) turn += 2 * Math.PI * this.turnSide;
      turned(out.heading.clone(), out.dir, turn * w, out.heading);
      a.walk = Math.max(a.walk * (1 - w), 0.5 * Math.sin(Math.PI * w) * Math.min(1, Math.abs(turn) / 0.8));
      a.stride *= 1 - w;
      a.gait += w;
    }
    this.you.settle(now);
    if (this.you.apply(now, a, c)) out.lookAt = lookTmp.copy(camera);
    this.look(now, out);
  }

  /** Where it looks: its own way about, or at a point (its bearing from its heading, its height over its eyes). */
  private look(now: number, out: Roaming): void {
    const a = out.action;
    const idleYaw = 0.32 * Math.sin(0.47 * now + 1) + 0.14 * Math.sin(1.27 * now);
    const idlePitch = -0.04 + 0.06 * Math.sin(0.37 * now + 2);
    // (the segment and the answers set it: read afresh)
    const look = out.lookAt;
    if (look) {
      const seated = a.moves.some((m) => m.kind === 'perch' || m.kind === 'fish' || m.kind === 'sit' || m.kind === 'plop');
      const eye = scratch.copy(out.dir).multiplyScalar(this.R + out.height + (seated ? 0.62 : 0.77) * this.height);
      const d = scratch2.subVectors(look, eye);
      const up = out.dir;
      const ahead = d.dot(out.heading);
      const left = d.dot(facingTmp.crossVectors(up, out.heading));
      a.lookYaw = Math.atan2(left, ahead);
      a.lookPitch = Math.atan2(d.dot(up), Math.max(Math.hypot(ahead, left), 0.3));
      const far = smoothstep(1.4, 2.0, Math.abs(a.lookYaw));
      a.lookYaw += (idleYaw - a.lookYaw) * far;
      a.lookPitch += (idlePitch - a.lookPitch) * far;
    } else {
      a.lookYaw = idleYaw;
      a.lookPitch = idlePitch;
    }
    if (a.walk > 0.5) a.look = 0.4;
    if (out.cues.sleep || a.moves.some((m) => m.kind === 'lieBack' || m.kind === 'wake' || m.kind === 'yawn')) a.look = 0;
  }
}

const localTmp = { x: 0, z: 0 };
/** Holding its can as it goes (walking, turning, standing between pours). */
const holdingCan: Carry = (s, out) => {
  out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: 1, tip: 0, glad: 0 });
  out.cues.water = { time: s, grip: 1, tip: 0, pour: 0 };
};
const facingTmp = new Vector3();
const lookTmp = new Vector3();
