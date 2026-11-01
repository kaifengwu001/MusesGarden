import { Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { Answers, rampIntegral, withTool } from './museLife';
import { COOK, FISH, GARDEN, HOP, LIE_BACK, PLOP, POCKET, POT, RISE, STEP, WAKE, YAWN_LENGTH, hopArc, perchBeats, type Move, type MoveKind, type MuseAction } from './museRig';
import { BENCH, FLOOR, PIER, STEPS, TERRACE } from './props';

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

/** Its pace (Muse's heights a second), and the walk's share spent speeding up and slowing down at each end; a turn on the spot (s). */
const PACE = 0.33;
const RAMP = 0.12;
const TURN = 1.0;
/** How far out it goes (m from the hut): mostly close, now and then across the meadow. */
const ROAM = { near: 5, far: 60, bias: 3 } as const;
/** What it might do next, and how likely each is. */
const LIKES = { wander: 3, water: 2.2, bench: 1.6, cook: 1.4, fish: 1.6, nap: 1.2, rest: 1 } as const;
type Like = keyof typeof LIKES;
/** How often it fishes from a shore rather than off the pier. */
const SHORE = 0.3;
/** The porch's lane along the front, clear of the bench and the stove (local m: z); the top of the steps and their foot on the meadow; where the terrace meets the pier. */
const LANE = 3.6;
const TOP = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 - 0.5 } as const;
const FOOT = { x: (STEPS.x0 + STEPS.x1) / 2, z: TERRACE.z1 + STEPS.count * STEPS.tread + 0.8 } as const;
const JUNCTION = { x: TERRACE.x0 + 0.2, z: LANE } as const;
/** The little stove on the porch (local m: its middle; it stands on the floor), kept clear of the lane. */
export const STOVE = { x: -3.45, z: 4.32, half: 0.24 } as const;
/** Where it sits to fish off the pier: how far along the pier's front edge (local m: x). */
const PIER_SPOT = -6.6;
/** The homestead's footprint with a margin (local m): paths over the meadow keep out of it. */
const HOMESTEAD = { x0: PIER.x0 - 0.6, x1: TERRACE.x1 + 0.6, z0: -4, z1: TERRACE.z1 + STEPS.count * STEPS.tread + 0.3 } as const;

type Facing = Vector3 | 'you';
interface Spot {
  dir: Vector3;
  /** On the deck (the terrace, the steps or the pier), its local meters. */
  deck: { x: number; z: number } | null;
}

/** What the props need to know of what Muse is doing (museProps.ts): each pastime's time into it, and how firmly its tool is held (0 … 1, as it comes out of the pocket and goes back). */
export interface RoamCues {
  water: { time: number; grip: number } | null;
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
    const inside = (r: { x0: number; x1: number; z0: number; z1: number }): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    if (inside(TERRACE) || inside(PIER)) return FLOOR;
    const run = STEPS.count * STEPS.tread;
    if (x >= STEPS.x0 && x <= STEPS.x1 && z > TERRACE.z1 && z < TERRACE.z1 + run) return FLOOR * (1 - (z - TERRACE.z1) / run);
    return null;
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

  /** A unit tangent at a spot toward a direction. */
  private toward(at: Spot, dir: Vector3): Vector3 {
    return tangentToward(at.dir, dir, new Vector3());
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
      if (!this.clear(foot, dir)) continue;
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
      if (!this.clear(foot, dir, 1.6)) continue;
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

  /** Stand where it is for a while, facing as asked, with something more (a look, a wave). */
  private stand(name: string, time: number, f: Facing, extra?: (s: number, out: Roaming) => void): void {
    const at = this.here;
    this.push({
      name,
      time,
      gait: 0,
      play: (s, out, ctx) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(this.facingAt(f, at, ctx.camera));
        extra?.(s, out);
      },
    });
    this.facing = f;
  }

  /** A facing's heading at a spot (toward the camera for 'you'). */
  private facingAt(f: Facing, at: Spot, camera: Vector3): Vector3 {
    return f === 'you' ? tangentToward(at.dir, camera, facingTmp) : facingTmp.copy(f);
  }

  /** Step round on the spot to face as asked. */
  private turn(to: Facing, name = 'turn'): void {
    const at = this.here;
    const from = this.facing;
    this.push({
      name,
      time: TURN,
      gait: 1,
      play: (s, out, ctx) => {
        const u = s / TURN;
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        const a = this.facingAt(from, at, ctx.camera).clone();
        const b = this.facingAt(to, at, ctx.camera);
        turned(a, at.dir, between(a, b, at.dir) * smoothstep(0, 1, u), out.heading);
        out.action.walk = 0.55 * Math.sin(Math.PI * u);
        out.action.stride = 0;
        out.action.gait = ctx.gait + u;
      },
    });
    this.facing = to;
  }

  /** Walk straight to a spot (a great circle over the meadow, a straight line over the deck), speeding up and slowing down at the ends. */
  private walk(to: Spot): void {
    const from = this.here;
    const length = angleBetween(from.dir, to.dir) * this.R;
    if (length < 0.05) return;
    const time = length / (PACE * this.height * (1 - RAMP));
    const steps = length / (2 * STEP.length * this.height);
    const heading = this.toward(from, to.dir);
    this.push({
      name: 'walk',
      time,
      gait: steps,
      play: (s, out, ctx) => {
        const u = s / time;
        const covered = (rampIntegral(u, 0, RAMP) - rampIntegral(u, 1 - RAMP, 1)) / (1 - RAMP);
        const speed = smoothstep(0, RAMP, u) - smoothstep(1 - RAMP, 1, u);
        travel(from.dir, heading, (covered * length) / this.R, out.dir);
        out.height = this.groundAt(out.dir);
        tangentToward(out.dir, to.dir, out.heading);
        out.action.walk = smoothstep(0, 0.35, speed);
        out.action.gait = ctx.gait + steps * covered;
        out.lookAt = lookTmp.copy(to.dir).multiplyScalar(this.R + this.groundAt(to.dir) + 0.5 * this.height);
      },
    });
    // (facing on along the way it came, as it arrives)
    this.facing = tangentToward(to.dir, from.dir, new Vector3()).negate();
    this.here = to;
  }

  /** The way from where it is to a spot: down off the deck by the steps, over the meadow straight, up onto the deck by the steps, along the porch's lane, out along the pier. */
  private route(to: Spot): Spot[] {
    const from = this.here;
    const way: Spot[] = [];
    const lane = (s: Spot): Spot | null => {
      const d = s.deck;
      if (!d || d.x < TERRACE.x0 || Math.abs(d.z - LANE) < 0.05) return null;
      return this.deckSpot(Math.min(Math.max(d.x, TERRACE.x0 + 0.3), TERRACE.x1 - 0.3), LANE);
    };
    const onPier = (s: Spot): boolean => s.deck !== null && s.deck.x < TERRACE.x0;
    if (from.deck && to.deck) {
      const a = lane(from);
      if (a) way.push(a);
      if (onPier(from) !== onPier(to)) way.push(this.deckSpot(JUNCTION.x, JUNCTION.z));
      const b = lane(to);
      if (b && !onPier(to)) way.push(b);
      way.push(to);
      return way;
    }
    if (from.deck) {
      // off the deck: along it to the top of the steps, down them
      const a = lane(from);
      if (a) way.push(a);
      if (onPier(from)) way.push(this.deckSpot(JUNCTION.x, JUNCTION.z));
      way.push(this.deckSpot(TOP.x, LANE), this.deckSpot(TOP.x, TOP.z), { dir: this.local(FOOT.x, FOOT.z), deck: null });
      if (to.deck) return [...way, to];
      way.push(to);
      return way;
    }
    if (to.deck) {
      // up the steps from the meadow (by way of their foot), along the lane
      if (angleBetween(from.dir, this.local(FOOT.x, FOOT.z)) * this.R > 0.3) way.push({ dir: this.local(FOOT.x, FOOT.z), deck: null });
      way.push(this.deckSpot(TOP.x, TOP.z), this.deckSpot(TOP.x, LANE));
      if (onPier(to)) way.push(this.deckSpot(JUNCTION.x, JUNCTION.z));
      else {
        const b = lane(to);
        if (b) way.push(b);
      }
      way.push(to);
      return way;
    }
    // over the meadow: straight if it can, else by way of the steps' foot
    if (!this.clear(from.dir, to.dir)) way.push({ dir: this.local(FOOT.x, FOOT.z), deck: null });
    way.push(to);
    return way;
  }

  /** Go to a spot along the way there, then turn to face as asked; the first turn named for where it is going. */
  private go(to: Spot, f: Facing, name: string): void {
    let first = true;
    for (const step of this.route(to)) {
      if (angleBetween(this.here.dir, step.dir) * this.R < 0.05) {
        this.here = step;
        continue;
      }
      this.turn(this.toward(this.here, step.dir), first ? name : 'turn');
      first = false;
      this.walk(step);
    }
    this.turn(f);
  }

  /** A move played where it is (its posture's own placement given by `place`), with something more. */
  private play(name: string, kind: MoveKind, time: number, extra?: (s: number, out: Roaming, move: Move) => void, place?: (s: number, out: Roaming) => void): void {
    const at = this.here;
    const f = this.facing;
    this.push({
      name,
      time,
      gait: 0,
      play: (s, out, ctx) => {
        out.dir.copy(at.dir);
        out.height = this.groundAt(at.dir);
        out.heading.copy(this.facingAt(f, at, ctx.camera));
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
        this.go(spot, this.out(spot), 'home');
        this.stand('rest', 6 + 6 * rand(), this.facing, (_s, out) => (out.lookAt = null));
        return;
      }
      case 'wander': {
        const spot = this.meadowSpot(rand);
        if (!spot) return this.outingHome(rand);
        this.go(spot, this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), -1 / this.R, new Vector3())), 'wander');
        this.stand('look about', 4 + 4 * rand(), this.facing, (_s, out) => (out.lookAt = null));
        if (rand() < 0.4) {
          this.play('plop', 'plop', PLOP);
          this.play('sit', 'sit', 8 + 8 * rand(), (_s, out) => (out.lookAt = null));
          this.play('rise', 'rise', RISE);
        }
        return;
      }
      case 'water': {
        const spot = this.meadowSpot(rand);
        if (!spot) return this.outingHome(rand);
        const facing = this.toward(spot, travel(spot.dir, tangentToward(spot.dir, this.U, scratch), -1 / this.R, new Vector3()));
        this.go(spot, facing, 'to water');
        // poured here and there, a shuffle along to its right between
        const pours = 3;
        const time = pours * GARDEN.period;
        const total = time + 2 * POCKET.time;
        const start = spot.dir.clone();
        const side = new Vector3().crossVectors(facing, start).normalize();
        // (along to its right if the ground there is as good, else to its left, else on the spot)
        const reach = (0.45 * H * (pours - 1)) / this.R;
        const fine = (way: Vector3): boolean => {
          const end = travel(start, way, reach, new Vector3());
          return this.terrain.sample(end, ground).water > 1.2 && this.clear(start, end, 0);
        };
        if (!fine(side)) side.negate();
        const step = fine(side) ? (0.45 * H) / this.R : 0;
        this.push({
          name: 'water',
          time: total,
          gait: 2 * (pours - 1),
          play: (at, out, ctx) => {
            const tool = withTool(at, total);
            const s = Math.min(tool.time, time);
            const n = Math.min(pours - 1, Math.floor(s / GARDEN.period));
            const u = s - n * GARDEN.period;
            const k = n > 0 ? smoothstep(0, 0.8, u) : 1;
            travel(start, side, step * (n - 1 + k) * (n > 0 ? 1 : 0), out.dir);
            out.height = this.groundAt(out.dir);
            out.heading.copy(tangentToward(out.dir, scratch.copy(out.dir).addScaledVector(facing, 1), facingTmp));
            if (n > 0 && u < 0.8) {
              out.action.walk = 0.5 * Math.sin((Math.PI * u) / 0.8);
              out.action.stride = 0.4;
              out.action.gait = ctx.gait + 2 * (n - 1) + 2 * (u / 0.8);
            } else out.action.gait = ctx.gait + 2 * n;
            out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: tool.ease * (n > 0 ? smoothstep(0.5, 0.9, u) : 1) });
            if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: at, amount: tool.pocket });
            out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(out.dir).multiplyScalar(this.R + out.height).addScaledVector(out.heading, 0.6 * H);
            out.cues.water = { time: s, grip: tool.grip };
          },
        });
        this.here = { dir: travel(start, side, step * (pours - 1), new Vector3()), deck: null };
        return;
      }
      case 'bench': {
        // up onto the bench, its back to the house, swinging its legs, humming, down again
        const x = BENCH.x + 0.4 * (rand() - 0.5) * BENCH.half;
        const front = this.deckSpot(x, BENCH.z + BENCH.depth + 0.47 * H);
        const seatZ = BENCH.z + BENCH.depth + 0.02 * H;
        const seat = this.deckSpot(x, seatZ);
        this.go(front, this.out(front), 'to the bench');
        this.hop('hopUp', front, seat, BENCH.seat);
        this.play('bench', 'perch', 14 + 8 * rand(), (s, out) => {
          out.lookAt = null;
          out.cues.hum = perchBeats(s).hum;
        }, (_s, out) => (out.height += BENCH.seat));
        this.hop('hopDown', seat, front, BENCH.seat);
        return;
      }
      case 'cook': {
        // at the little stove on the porch: the ladle out of its pocket, stirring and tasting, put back
        const at = this.deckSpot(STOVE.x - POT[0] * H, STOVE.z - POT[2] * H);
        this.go(at, this.out(at), 'to the stove');
        const cooking = 2 * COOK.period + 2 * POCKET.time;
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
        const fishing = 2 * FISH.period + 2 * POCKET.time;
        if (shore) {
          // from a bank it has wandered to, sitting in the grass
          this.go(shore.spot, shore.facing, 'to the shore');
          this.play('plop', 'plop', PLOP);
          this.fishing(fishing, false);
          this.play('rise', 'rise', RISE);
          return;
        }
        // off the end of the pier: sat on its edge, the legs over the water
        const edgeZ = PIER.z1;
        const stand = this.deckSpot(PIER_SPOT, edgeZ - 0.25 * H);
        const sit = this.deckSpot(PIER_SPOT, edgeZ + 0.02 * H);
        this.go(stand, this.out(stand), 'to the pier');
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
        this.go(spot, facing, 'to a nap');
        this.play('yawn', 'yawn', YAWN_LENGTH, (_s, out) => (out.lookAt = null));
        this.play('plop', 'plop', PLOP);
        this.play('lie back', 'lieBack', LIE_BACK);
        const nap = 18 + 14 * rand();
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

  /** Nowhere out there would do: home to the porch to look out a while. */
  private outingHome(rand: () => number): void {
    const spot = this.deckSpot(-0.6 + 2.4 * rand(), TERRACE.z1 - 0.45);
    this.go(spot, this.out(spot), 'home');
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
    const f = this.facing;
    const H = this.height;
    this.push({
      name: kind,
      time,
      gait: 0,
      play: (s, out, ctx) => {
        const { along, rise, over } = hopArc(s, kind === 'hopUp');
        out.dir.copy(from.dir).lerp(to.dir, along).normalize();
        out.height = this.terrain.cottageGround + FLOOR + seat * rise + over * H;
        out.heading.copy(this.facingAt(f, from, ctx.camera));
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
    if (w > 0 && a.moves.length === 0) {
      const toYou = tangentToward(out.dir, camera, facingTmp);
      const turn = between(out.heading, toYou, out.dir);
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
const facingTmp = new Vector3();
const lookTmp = new Vector3();
