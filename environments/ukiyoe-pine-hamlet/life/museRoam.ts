import { Vector3 } from 'three';
import { RESIDENT_HOMES } from './residentLife';
import { smoothstep } from '../../../src/core/math';
import { angleBetween, tangentToward, travel } from '../../../src/planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { Answers, rampIntegral, withTool } from '../../../src/life/museLife';
import { COOK, FISH, HOP, LIE_BACK, PLOP, POCKET, POT, RISE, STEP, WAKE, YAWN_LENGTH, hopArc, perchBeats, type Move, type MoveKind, type MuseAction } from '../../../src/life/museRig';
import { BENCH, CHAIR, FACE, FLOOR, PIER, SIDE, STEPS, TERRACE, walkableHeightAt } from './props';

// Muse's life on the planet (muse.ts draws it): it roams the meadow at
// random and does what it likes where it is, more often close to its hut.
// Some things have their places: the bench against the house's front, the
// little stove on the porch, the end of the pier to fish from. Others it
// does wherever it has wandered: watering the plants, napping in the grass,
// fishing from a shore now and then, sitting down to look about.
//
// Its days are drawn from a seed (the planet's), outing after outing, each a
// walk somewhere (up the porch steps, along the porch, out along the pier,
// or straight over the meadow, never through water or the house) and what
// it does there, so a time always finds it in one place doing one thing:
// the itinerary is written out lazily as time runs on, and read back by
// time. Over it go your doings and its answers (museLife.ts Answers).
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
const ROAM = { near: 5, far: 28, bias: 3 } as const;
/** What it might do next, and how likely each is. */
const LIKES = { wander: 3, water: 0, bench: 1.6, cook: 1.4, fish: 0, nap: 1.2, rest: 1 } as const;
type Like = keyof typeof LIKES;
/** How often it fishes from a shore rather than off the pier. */
const SHORE = 0.3;
/** The porch's lane along the front, clear of the bench and the stove (local m: z); the top of the steps and their foot on the meadow; where the terrace meets the pier. */
const TOP = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 - 0.5 } as const;
const FOOT = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 + STEPS.count * STEPS.tread + 0.8 } as const;
/**
 * Getting about on the deck (local m): Muse's girth (half its width, a
 * little over), and a few places to go by when the straight way is blocked
 * (by the bench, the stove, the chair, the house's corner): along the porch
 * and out onto the pier. Its ways there are straight where they can be,
 * round by these where not, the corners rounded off.
 */
const GIRTH = 0.45;
const DECK_WAYS: readonly (readonly [number, number])[] = [
  [3.2, 3.65], [1.8, 3.65], [0.4, 3.65], [-1, 3.65], [-2.4, 3.65], [-3.8, 3.65],
];
/** The little stove on the porch (local m: its middle; it stands on the floor), kept clear of the lane. */
export const STOVE = { x: -1.1, z: 2.9, half: 0.24 } as const;
/** Where it sits to fish off the pier: how far along the pier's front edge (local m: x). */
const PIER_SPOT = -3.3;
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
  cook: { time: number; grip: number } | null;
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
    this.living = {
      dir: this.here.dir.clone(),
      height: 0,
      heading: new Vector3(),
      action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0, moves: [] },
      lookAt: null,
      cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
      home: true,
    };
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

  /** The deck under local meters (its height over the clearing, m): the terrace and the pier at the floor, the steps going down to the meadow; null off it. */
  private deckAt(x: number, z: number): number | null {
    return walkableHeightAt(x, z);
  }

  /** Can Muse stand here on the deck (local m), clear of its edges, the house, the bench, the stove and the chair? */
  private deckFree(x: number, z: number): boolean {
    const run = STEPS.count * STEPS.tread;
    const terrace = x > TERRACE.x0 + 0.35 && x < TERRACE.x1 - 0.35 && z > FACE + GIRTH && z < TERRACE.z1 - 0.3;
    const pier = x > PIER.x0 + 0.35 && x < PIER.x1 && z > PIER.z0 + 0.5 && z < PIER.z1 - 0.25;
    const steps = x > STEPS.x0 + 0.3 && x < STEPS.x1 - 0.3 && z > TERRACE.z1 - 0.6 && z < TERRACE.z1 + run + 1;
    if (!terrace && !pier && !steps) return false;
    // (the house itself, beside the pier)
    if (x > -SIDE - GIRTH && z < FACE + GIRTH) return false;
    if (Math.abs(x - STOVE.x) < STOVE.half + GIRTH && Math.abs(z - STOVE.z) < STOVE.half + GIRTH) return false;
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
    const nodes = [a, ...DECK_WAYS.map(([x, z]) => ({ x, z })), b];
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
    if (Math.abs(c.x) < 20 && Math.abs(c.z) < 20) {
      const deck = this.deckAt(c.x, c.z);
      if (deck !== null) return this.terrain.cottageGround + deck;
    }
    return this.terrain.sample(dir, ground).height;
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

  /** Neighbour lanes include room for two bodies to pass without intersecting. */
  private residentLane(x: number, z: number): boolean {
    return RESIDENT_HOMES.some(home => ((x - home.x) / 3.15) ** 2 + ((z - home.z) / 2.35) ** 2 < 1);
  }

  /** Is a stretch of the meadow walkable (dry, out of the homestead)? Sampled every 0.4 m. */
  private clear(a: Vector3, b: Vector3, endsFree = 1.2): boolean {
    const length = angleBetween(a, b) * this.R;
    const steps = Math.max(1, Math.ceil(length / 0.4));
    const p = new Vector3();
    const c = { x: 0, z: 0 };
    let previousHeight = 0;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      p.copy(a).lerp(b, f).normalize();
      const fromEnd = Math.min(f, 1 - f) * length;
      if (this.terrain.sample(p, ground).water < (fromEnd < endsFree ? 0.35 : 0.6)) return false;
      if (i > 0 && Math.abs(ground.height - previousHeight) > (length / steps) * 0.5 + 0.03) return false;
      previousHeight = ground.height;
      this.terrain.cottageLocal(p, c);
      if (this.residentLane(c.x, c.z)) return false;
      if (fromEnd < endsFree) continue;
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

  private push(segment: Segment): void {
    this.day.push(segment);
    this.starts.push(this.length);
    this.gaits.push(this.gait);
    this.length += segment.time;
    this.gait += segment.gait;
  }

  /** Stand where it is for a while, facing as asked, with something more (a look, holding its can). */
  private stand(name: string, time: number, f: Facing, extra?: (s: number, out: Roaming) => void): void {
    const at = this.here;
    const heading = f.clone();
    this.push({
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
    if (this.walkable(wide)) return wide;
    const tight = this.rounded(points, false);
    if (this.walkable(tight)) return tight;
    // Keep the verified straight segments if a rounded corner clips a lane.
    const direct = new Path(this.R);
    direct.add(points[0]);
    for (let i = 1; i < points.length; i++) direct.line(points[i], PATH.step);
    return direct;
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
      if (this.residentLane(c.x, c.z)) return false;
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
   * the way it means to face (`end`).
   */
  private walkPath(path: Path, to: Spot, name: string, from?: Vector3, end?: Vector3, carry?: Carry): void {
    const length = path.length;
    if (length < 0.05) return;
    const time = length / (PACE * this.height * (1 - RAMP));
    const steps = length / (2 * STEP.length * this.height);
    const startFacing = from?.clone();
    const endFacing = end?.clone();
    const ahead = new Vector3();
    this.push({
      name,
      time,
      gait: steps,
      play: (s, out, ctx) => {
        const u = s / time;
        const covered = (rampIntegral(u, 0, RAMP) - rampIntegral(u, 1 - RAMP, 1)) / (1 - RAMP);
        const speed = smoothstep(0, RAMP, u) - smoothstep(1 - RAMP, 1, u);
        const d = covered * length;
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
    });
    this.facing = endFacing ?? path.heading(length, new Vector3());
    this.here = to;
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

  /** A move played where it is (its posture's own placement given by `place`), with something more. */
  private play(name: string, kind: MoveKind, time: number, extra?: (s: number, out: Roaming, move: Move) => void, place?: (s: number, out: Roaming) => void): void {
    const at = this.here;
    const f = this.facing.clone();
    this.push({
      name,
      time,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(f);
        place?.(s, out);
        const move: Move = { kind, time: s, amount: 1, ease: smoothstep(0, 0.7, s) * smoothstep(0, 0.7, time - s) };
        out.action.moves.push(move);
        extra?.(s, out, move);
      },
    });
  }

  /** Write the next outing: choose what to do (not the same twice running), go there, do it. */
  private outing(): void {
    const rand = random(this.seed * 7919 + this.outings * 104729 + 17);
    this.outings++;
    const pick = (): Like => {
      const likes = (Object.entries(LIKES) as [Like, number][]).filter(([, weight]) => weight > 0);
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
        this.stand('rest', 10 + 12 * rand(), this.facing, (_s, out) => (out.lookAt = null));
        return;
      }
      case 'wander': {
        const spot = this.meadowSpot(rand);
        if (!spot) return this.outingHome(rand);
        this.go(spot, this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), -1 / this.R, new Vector3())), 'wander', rand);
        this.stand('look about', 6 + 6 * rand(), this.facing, (_s, out) => (out.lookAt = null));
        if (rand() < 0.5) {
          this.play('plop', 'plop', PLOP);
          this.play('sit', 'sit', 15 + 25 * rand(), (_s, out) => (out.lookAt = null));
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
        const pours = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < pours; k++) {
          this.pour(2.4 + 3 * rand(), 0.7 + 0.3 * rand(), rand() < 0.5, rand() < 0.4);
          if (k === pours - 1) break;
          const r = rand();
          if (r < 0.35) this.shuffle(rand);
          else if (r < 0.65) this.turn(turned(this.facing, this.here.dir, (rand() < 0.5 ? -1 : 1) * (0.35 + 0.75 * rand()), new Vector3()), 'turn', holdingCan);
          else if (r < 0.9) this.stroll(rand);
          else this.stand('look about', 1.5 + 1.5 * rand(), this.facing, holdingCan);
        }
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
        this.play('bench', 'perch', 30 + 45 * rand(), (s, out) => {
          out.lookAt = null;
          out.cues.hum = perchBeats(s).hum;
        }, (_s, out) => (out.height += BENCH.seat));
        this.hop('hopDown', seat, front, BENCH.seat);
        return;
      }
      case 'cook': {
        // at the little stove on the porch: the ladle out of its pocket, stirring and tasting, put back
        // Facing across the narrow veranda keeps both feet clear of the wall.
        const at = this.deckSpot(STOVE.x + POT[2] * H, STOVE.z - POT[0] * H);
        const towardStove = this.toward(at, this.local(at.deck!.x - 1, at.deck!.z));
        this.go(at, towardStove, 'to the stove', rand);
        const cooking = (3 + Math.floor(2 * rand())) * COOK.period + 2 * POCKET.time;
        const pot = this.local(STOVE.x, STOVE.z).multiplyScalar(this.R + this.terrain.cottageGround + FLOOR + POT[1] * H);
        this.play('cook', 'stir', cooking, (s, out, move) => {
          const tool = withTool(s, cooking);
          move.time = tool.time;
          move.ease = tool.ease;
          if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
          out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(pot);
          out.cues.cook = { time: tool.time, grip: tool.grip };
        });
        return;
      }
      case 'fish': {
        const shore = rand() < SHORE ? this.shoreSpot(rand) : null;
        const fishing = (3 + Math.floor(3 * rand())) * FISH.period + 2 * POCKET.time;
        if (shore) {
          // from a bank it has wandered to, sitting in the grass
          this.go(shore.spot, shore.facing, 'to the shore', rand);
          this.play('plop', 'plop', PLOP);
          this.fishing(fishing, false);
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
        this.fishing(fishing, true);
        this.play('rise', 'rise', RISE, (_s, _out, move) => (move.edge = true), (s, out) => along(s, 0.35, 0.85, sit, stand, out));
        this.here = stand;
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
        const nap = 45 + 50 * rand();
        this.play('nap', 'sleep', nap, (s, out) => (out.cues.sleep = { time: s, roused: -1 }));
        this.play('wake', 'wake', WAKE, (s, out) => {
          // (the snore bubble pops as it wakes)
          if (s < 0.4) out.cues.sleep = { time: nap + s, roused: s };
        });
        this.play('rise', 'rise', RISE);
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
    this.push({
      name: 'pour',
      time: time + look,
      gait: 0,
      play: (s, out) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        const sway = sweep ? 0.22 * Math.sin((2 * Math.PI * s) / time) * smoothstep(0.3, 1, s) * smoothstep(0.3, 1, time - s) : 0;
        turned(f, at.dir, s < time ? sway : 0, out.heading);
        const tipped = tip * smoothstep(0, 0.6, s) * smoothstep(0, 0.5, time - s);
        const content = glad ? smoothstep(time, time + 0.4, s) * smoothstep(0, 0.5, time + look - s) : 0;
        out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: 1, tip: tipped, glad: content });
        out.cues.water = { time: s, grip: 1, tip: tipped, pour: smoothstep(0.4, 0.7, tipped) };
        out.lookAt = lookTmp.copy(out.dir).multiplyScalar(this.R + out.height).addScaledVector(out.heading, 0.6 * H);
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
    this.stand('rest', 6 + 4 * rand(), this.facing, (_s, out) => (out.lookAt = null));
  }

  /** Fishing where it sits (on a bank, or on the pier's edge), the rod out of its pocket and back. */
  private fishing(time: number, edge: boolean): void {
    const H = this.height;
    this.play('fish', 'fish', time, (s, out, move) => {
      const tool = withTool(s, time);
      move.time = tool.time;
      move.ease = tool.ease;
      move.edge = edge;
      if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
      // looking at the float on the water before it
      out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(out.dir).multiplyScalar(this.R).addScaledVector(out.heading, 1.25 * H);
      out.cues.fish = { time: tool.time, grip: tool.grip, edge };
    }, edge ? (_s, out) => (out.height = this.terrain.cottageGround + FLOOR) : undefined);
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
    // the segment under the clock (by halves: the itinerary only grows)
    let lo = 0;
    let hi = this.day.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= u) lo = mid;
      else hi = mid - 1;
    }
    const s = Math.min(this.day[lo].time, u - this.starts[lo]);
    a.gait = this.gaits[lo];
    this.day[lo].play(s, out, { camera, gait: this.gaits[lo] });
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
    const local = this.terrain.cottageLocal(out.dir, localTmp);
    out.home = local.x > HOMESTEAD.x0 && local.x < HOMESTEAD.x1 && local.z > -3 && local.z < HOMESTEAD.z1 + 5;
    return out;
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
