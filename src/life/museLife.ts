import { smoothstep } from '../core/math';
import {
  BOUNCE_LENGTH,
  COOK,
  FISH,
  FLOWER,
  FLUFF,
  GARDEN,
  HOP,
  IDEA_LENGTH,
  LIE_BACK,
  LOVE_LENGTH,
  PET,
  PLOP,
  POCKET,
  POT,
  RISE,
  ROUSE,
  STEP,
  WAKE,
  WAVE_LENGTH,
  YAWN_LENGTH,
  hopArc,
  perchBeats,
  type Move,
  type MoveKind,
  type MuseAction,
} from './museRig';

// Muse's life on a little stage of its own (the lab's, museStage.ts, for
// now): where it goes and what it does there, a day of beats in closed form
// (as muse.ts's day on the terrace is), so a time always finds it in one
// place doing one thing. It looks about (and an idea comes to it: a light
// bulb over its head, its arms thrown up), waters its flowers one by one,
// hops up onto the bench and swings its legs, fishes at the pond, cooks at
// the fire, yawns and naps on its back in the grass, and comes home to you
// (adoring you, a heart over its head), waddling between them. Over whatever it is doing go its answers to you: tap it and it waves
// (the first time in a while) or bounces for joy; hold it and it leans into
// your hand, and held longer its fur stands up in a wave and it shakes it
// out when you let go; asleep, a tap only stirs it.
//
// Everything here is in Muse's heights (H) on the stage's ground: x to the
// right, z toward you (the camera's side), headings from facing +z, turning
// toward +x.

/** Its pace (H a second: its 0.36 m/s on the terrace), the walk's share spent speeding up and slowing down at each end, and a turn on the spot (s). */
const PACE = 0.33;
const RAMP = 0.12;
const TURN = 1.0;
/** A tap is a press let go within this (s); a hold shows as petting from this on. */
const TAP = 0.3;
/** It waves at a tap if it has not waved for this long (s); otherwise it bounces. */
const WAVE_AGAIN = 9;
/** Its attention to you: how long it takes to stop what it is doing and turn to you (s), and to go back to it. */
const ATTEND = { rise: 0.45, fall: 0.7 } as const;

/** The bench (the meadow's, props.ts, in Muse's heights): its middle (it runs along x), its seat's top, and where on it Muse sits and stands before it. */
export const BENCH = { x: -2.5, z: -1.5, seat: 0.44, length: 1.35, depth: 0.35, sit: 0.3, before: 0.47 } as const;
/** The pond: its middle and radius. */
export const POND = { x: 3.1, z: -0.7, r: 1.3 } as const;
/** The flower bed: its middle (it runs along x), the flowers' spacing and count; Muse waters each from behind it, facing you. */
export const BED = { x: -2.3, z: 2.0, spacing: 0.44, count: 3 } as const;
/** The fire with the pot over it: Muse stands behind it, facing you. */
export const FIRE = { x: 2.4, z: 2.0 } as const;
/** Where it naps, lying along x. */
export const NAP = { x: 0.1, z: -1.9 } as const;

interface Place {
  x: number;
  z: number;
  /** Over the ground (H): a seat. */
  y?: number;
}
type Facing = number | 'you';

const HOME: Place = { x: 0, z: 0.5 };
const AROUND: Place = { x: -0.9, z: -0.3 };
const BENCH_FRONT: Place = { x: BENCH.x + BENCH.sit, z: BENCH.z + BENCH.before };
/** (sat at the seat's front edge, its hips just over it, so its legs hang down in front of the seat, its bottom on it) */
const BENCH_SEAT: Place = { x: BENCH.x + BENCH.sit, z: BENCH.z + BENCH.depth / 2 + 0.02, y: BENCH.seat };
const FISH_AT: Place = { x: POND.x - POND.r - 0.3, z: POND.z };
const COOK_AT: Place = { x: FIRE.x - POT[0], z: FIRE.z - POT[2] };
const NAP_AT: Place = { x: NAP.x, z: NAP.z };
/** Muse's place to water flower i: the flower ahead of it and a little to its right, as the rig reaches (FLOWER). */
function bedAt(i: number): Place {
  return { x: BED.x + (i - (BED.count - 1) / 2) * BED.spacing - FLOWER[0], z: BED.z - FLOWER[2] };
}
/** Where flower i grows. */
export function flowerAt(i: number): { x: number; z: number } {
  return { x: BED.x + (i - (BED.count - 1) / 2) * BED.spacing, z: BED.z };
}
/** Where the fishing float lands (H from Muse's place, ahead of it). */
export const CAST = 1.25;
export const FISH_FACING = Math.PI / 2;

/** What the props need to know of what Muse is doing (museStage.ts): each pastime's time into it, how firmly its tool is held (0 lying where it was put … 1 in the mitten). */
export interface Cues {
  water: { time: number; flower: number; grip: number } | null;
  fish: { time: number; grip: number } | null;
  cook: { time: number; grip: number } | null;
  sleep: { time: number; roused: number } | null;
  /** Humming on the bench (0 … 1), being petted (s into it, < 0 for none). */
  hum: number;
  petted: number;
}

/** Muse as its life has it at a time: where it is on the stage, which way it faces, its action for the rig, what it looks at, and the props' cues. */
export interface Living {
  x: number;
  y: number;
  z: number;
  heading: number;
  action: MuseAction & { moves: Move[] };
  /** Where it looks (H, the stage): a point, or null to look about on its own. */
  lookAt: [number, number, number] | null;
  cues: Cues;
}

/** A stretch of the day: how long (s), how far its gait runs (cycles of two steps), and how it plays s seconds in. */
interface Segment {
  name: string;
  time: number;
  gait: number;
  play(s: number, out: Living, ctx: Context): void;
}

/** What a segment's play needs besides its own time: the camera (for facing you), the gait at its start, and its start in the day. */
interface Context {
  camera: { x: number; y: number; z: number };
  gait: number;
  start: number;
}

/** The shorter way round from one heading to another (rad). */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** ∫₀ᵘ smoothstep(a, b, x) dx. */
export function rampIntegral(u: number, a: number, b: number): number {
  if (u <= a) return 0;
  if (u >= b) return (b - a) / 2 + (u - b);
  const x = (u - a) / (b - a);
  return (b - a) * (x * x * x - (x * x * x * x) / 2);
}

function facingOf(f: Facing, at: Place, camera: { x: number; z: number }): number {
  return f === 'you' ? Math.atan2(camera.x - at.x, camera.z - at.z) : f;
}

/** A pastime's own motions eased in over its first stretch and out over its last (s), its posture held throughout. */
function ease(s: number, time: number, edge = 0.7): number {
  return smoothstep(0, edge, s) * smoothstep(0, edge, time - s);
}

/**
 * A pastime with a tool, s into it (`total` long with a reach into its belly
 * pocket at each end): the pastime's own time (from when the tool is out),
 * how much of its motions show (in as the mitten leaves the pocket, out as
 * it goes back), the pocket's reach, and the tool in the mitten (from as it
 * comes out of the pocket until it goes back in).
 */
export function withTool(s: number, total: number): { time: number; ease: number; pocket: number; grip: number } {
  const back = total - s;
  const at = (x: number): number => smoothstep(0, POCKET.in, x) * (1 - smoothstep(POCKET.out, POCKET.time, x));
  return {
    time: Math.max(0, s - POCKET.time),
    ease: smoothstep(POCKET.out, POCKET.time, s) * smoothstep(POCKET.out, POCKET.time, back),
    pocket: Math.max(at(s), at(back)),
    grip: smoothstep(POCKET.out - 0.05, POCKET.out + 0.1, s) * smoothstep(POCKET.out - 0.05, POCKET.out + 0.1, back),
  };
}

/** The day, built from places and pastimes: each walk turned toward first and turned out of after. */
function buildDay(): Segment[] {
  const day: Segment[] = [];
  let facing: Facing = 'you';
  let here: Place = HOME;
  const stand = (name: string, time: number, f: Facing, extra?: (s: number, out: Living) => void): void => {
    const at = here;
    day.push({
      name,
      time,
      gait: 0,
      play(s, out, ctx) {
        out.x = at.x;
        out.z = at.z;
        out.heading = facingOf(f, at, ctx.camera);
        extra?.(s, out);
      },
    });
    facing = f;
  };
  const turn = (to: Facing, name = 'turn'): void => {
    const at = here;
    const from = facing;
    day.push({
      name,
      time: TURN,
      gait: 1,
      play(s, out, ctx) {
        // stepping round on the spot
        const u = s / TURN;
        const a = facingOf(from, at, ctx.camera);
        const b = facingOf(to, at, ctx.camera);
        out.x = at.x;
        out.z = at.z;
        out.heading = a + wrap(b - a) * smoothstep(0, 1, u);
        out.action.walk = 0.55 * Math.sin(Math.PI * u);
        out.action.stride = 0;
        out.action.gait = ctx.gait + u;
      },
    });
    facing = to;
  };
  const walk = (to: Place): void => {
    const from = here;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const time = length / (PACE * (1 - RAMP));
    const steps = length / (2 * STEP.length);
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    day.push({
      name: 'walk',
      time,
      gait: steps,
      play(s, out, ctx) {
        // speeding up and slowing down at the ends; the feet keep pace with the ground covered
        const u = s / time;
        const covered = (rampIntegral(u, 0, RAMP) - rampIntegral(u, 1 - RAMP, 1)) / (1 - RAMP);
        const speed = smoothstep(0, RAMP, u) - smoothstep(1 - RAMP, 1, u);
        out.x = from.x + (to.x - from.x) * covered;
        out.z = from.z + (to.z - from.z) * covered;
        out.heading = heading;
        out.action.walk = smoothstep(0, 0.35, speed);
        out.action.gait = ctx.gait + steps * covered;
        out.lookAt = [to.x, 0.5, to.z];
      },
    });
    here = to;
    facing = heading;
  };
  /** Turn toward a place, walk there, turn to face as asked; the first turn named for where it is going. */
  const go = (to: Place, f: Facing, name = 'turn'): void => {
    turn(Math.atan2(to.x - here.x, to.z - here.z), name);
    walk(to);
    turn(f);
  };
  /** A move played where Muse is, with its own placement (a hop's arc) and look. */
  const play = (name: string, kind: MoveKind, time: number, f: number, extra?: (s: number, out: Living, move: Move) => void): void => {
    const at = here;
    day.push({
      name,
      time,
      gait: 0,
      play(s, out) {
        out.x = at.x;
        out.y = at.y ?? 0;
        out.z = at.z;
        out.heading = f;
        const move: Move = { kind, time: s, amount: 1, ease: ease(s, time) };
        out.action.moves.push(move);
        extra?.(s, out, move);
      },
    });
    facing = f;
  };
  const hop = (kind: 'hopUp' | 'hopDown', to: Place): void => {
    const from = here;
    const time = kind === 'hopUp' ? HOP.up : HOP.down;
    const f = facing as number;
    day.push({
      name: kind,
      time,
      gait: 0,
      play(s, out) {
        const { along, over } = hopArc(s, kind === 'hopUp');
        out.x = from.x + (to.x - from.x) * along;
        out.z = from.z + (to.z - from.z) * along;
        out.y = (from.y ?? 0) + ((to.y ?? 0) - (from.y ?? 0)) * along + over;
        out.heading = f;
        out.action.moves.push({ kind, time: s, amount: 1 });
      },
    });
    here = to;
  };

  // looking about at home, a wave to you
  stand('home', 4, 'you', (s, out) => {
    out.action.wave = s - 0.8;
    out.lookAt = null;
  });
  // a little wander
  go(AROUND, 0.6);
  stand('look about', 2.5, 0.6);
  // an idea comes to it (a light bulb over its head, its arms up): the flowers!
  stand('idea', IDEA_LENGTH + 0.2, 0.6, (s, out) => {
    out.action.moves.push({ kind: 'idea', time: s, amount: 1 });
    out.lookAt = null;
  });
  // the flowers, one after another (the can out of its pocket first, back in after)
  go(bedAt(0), 0, 'to the flowers');
  const water = GARDEN.period * BED.count;
  const watering = water + 2 * POCKET.time;
  day.push({
    name: 'garden',
    time: watering,
    gait: 2 * (BED.count - 1),
    play(at, out, ctx) {
      const tool = withTool(at, watering);
      const s = Math.min(tool.time, water);
      const n = Math.min(BED.count - 1, Math.floor(s / GARDEN.period));
      const u = s - n * GARDEN.period;
      // a few steps sideways to the next flower at the start of each watering
      const a = bedAt(Math.max(0, n - 1));
      const b = bedAt(n);
      const k = n > 0 ? smoothstep(0, 0.8, u) : 1;
      out.x = a.x + (b.x - a.x) * k;
      out.z = a.z + (b.z - a.z) * k;
      out.heading = 0;
      if (n > 0 && u < 0.8) {
        out.action.walk = 0.5 * Math.sin((Math.PI * u) / 0.8);
        out.action.stride = 0.4;
        out.action.gait = ctx.gait + 2 * (n - 1) + 2 * (u / 0.8);
      } else out.action.gait = ctx.gait + 2 * n;
      out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: tool.ease * (n > 0 ? smoothstep(0.5, 0.9, u) : 1) });
      if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: at, amount: tool.pocket });
      const f = flowerAt(n);
      out.lookAt = tool.pocket > 0.5 ? null : [f.x, 0.1, f.z];
      out.cues.water = { time: s, flower: n, grip: tool.grip };
    },
  });
  here = bedAt(BED.count - 1);
  // the bench: up onto it, swinging its legs, humming, down again
  go(BENCH_FRONT, 0, 'to the bench');
  hop('hopUp', BENCH_SEAT);
  play('bench', 'perch', 16, 0, (s, out) => {
    out.lookAt = null;
    out.cues.hum = perchBeats(s).hum;
  });
  hop('hopDown', BENCH_FRONT);
  // fishing at the pond
  go(FISH_AT, FISH_FACING, 'to the pond');
  play('plop', 'plop', PLOP, FISH_FACING);
  const fishing = 2 * FISH.period + 2 * POCKET.time;
  play('pond', 'fish', fishing, FISH_FACING, (s, out, move) => {
    const tool = withTool(s, fishing);
    move.time = tool.time;
    move.ease = tool.ease;
    if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
    out.lookAt = tool.pocket > 0.5 ? null : [FISH_AT.x + CAST, 0, FISH_AT.z];
    out.cues.fish = { time: tool.time, grip: tool.grip };
  });
  play('rise', 'rise', RISE, FISH_FACING);
  // cooking at the fire
  go(COOK_AT, 0, 'to the fire');
  const cooking = 2 * COOK.period + 2 * POCKET.time;
  play('fire', 'stir', cooking, 0, (s, out, move) => {
    const tool = withTool(s, cooking);
    move.time = tool.time;
    move.ease = tool.ease;
    if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
    out.lookAt = tool.pocket > 0.5 ? null : [FIRE.x, POT[1], FIRE.z];
    out.cues.cook = { time: tool.time, grip: tool.grip };
  });
  // a nap in the grass
  go(NAP_AT, -Math.PI / 2, 'to the nap');
  play('yawn', 'yawn', YAWN_LENGTH, -Math.PI / 2, (_s, out) => (out.lookAt = null));
  play('plop', 'plop', PLOP, -Math.PI / 2);
  play('lie back', 'lieBack', LIE_BACK, -Math.PI / 2);
  const nap = 22;
  play('nap', 'sleep', nap, -Math.PI / 2, (s, out) => {
    out.cues.sleep = { time: s, roused: -1 };
  });
  play('wake', 'wake', WAKE, -Math.PI / 2, (s, out) => {
    // (the snore bubble pops as it wakes)
    out.cues.sleep = s < 0.4 ? { time: nap + s, roused: s } : null;
  });
  play('rise', 'rise', RISE, -Math.PI / 2);
  // home, adoring you (its head tilted, a heart over it), and a bounce for the day
  go(HOME, 'you', 'home again');
  stand('love', LOVE_LENGTH + 0.2, 'you', (s, out) => {
    out.action.moves.push({ kind: 'love', time: s, amount: 1, side: 1 });
  });
  stand('happy', 3, 'you', (s, out) => {
    out.action.moves.push({ kind: 'bounce', time: s - 0.3, amount: s > 0.3 ? 1 : 0 });
  });
  return day;
}

/** Muse's head over its place (H), roughly, for where it looks from: standing, perched, sitting. */
function headHeight(living: Living): number {
  const moves = living.action.moves;
  const seated = moves.some((m) => m.kind === 'perch' || m.kind === 'fish' || m.kind === 'sit' || m.kind === 'plop');
  return (seated ? 0.62 : 0.77) + living.y;
}

/**
 * Your doings with Muse and its answers, layered over whatever its day has it
 * doing (the lab's stage here, the planet in museRoam.ts). A tap and it waves
 * (the first time in a while) or bounces for joy; a hold and it leans into
 * your hand (held longer, its fur stands up, and it shakes it out when you
 * let go); asleep, a tap only stirs it. While it answers it stops what it is
 * doing, its day's clock held back (heldBack), and, standing or walking,
 * turns to you (attending).
 */
export class Answers {
  private answer: { kind: 'wave' | 'bounce' | 'rouse'; at: number } | null = null;
  private lastWave = -Infinity;
  private press: { at: number; release: number; side: number } | null = null;
  /** Its attention to you: from when, until when (Infinity while you hold it); and the day it has lost to answers gone by (s). */
  private attention: { from: number; to: number } | null = null;
  private lost = 0;

  /** The day's time held back so far by answering you (s). */
  heldBack(now: number): number {
    return this.lost + this.attended(now);
  }

  /** Forget the time held back (the day was moved on). */
  reset(): void {
    this.lost = 0;
    this.attention = null;
  }

  /** How much it is turned to you at a time (0 … 1). */
  attending(now: number): number {
    const a = this.attention;
    if (!a) return 0;
    return smoothstep(a.from, a.from + ATTEND.rise, now) * (1 - smoothstep(a.to - ATTEND.fall, a.to, now));
  }

  /** The day's time the answer now has held back so far (s): its attention summed. */
  private attended(now: number): number {
    const a = this.attention;
    if (!a) return 0;
    const into = rampIntegral(now - a.from, 0, ATTEND.rise);
    const out = a.to === Infinity ? 0 : rampIntegral(now - a.from, a.to - a.from - ATTEND.fall, a.to - a.from);
    return into - out;
  }

  /** Turn to you from now until `until` (s), drawing out an answer already under way. */
  private attend(now: number, until: number): void {
    const a = this.attention;
    if (a && now < a.to) {
      a.to = Math.max(a.to, until);
      return;
    }
    if (a) this.lost += this.attended(a.to);
    this.attention = { from: now, to: Math.max(until, now + ATTEND.rise + ATTEND.fall) };
  }

  /** You tapped it: asleep, it stirs; otherwise it waves if it has not for a while, else bounces for joy. */
  tap(now: number, asleep: boolean): void {
    if (asleep) this.answer = { kind: 'rouse', at: now };
    else if (now - this.lastWave > WAVE_AGAIN) {
      this.answer = { kind: 'wave', at: now };
      this.lastWave = now;
      this.attend(now, now + WAVE_LENGTH + 0.3);
    } else {
      this.answer = { kind: 'bounce', at: now };
      this.attend(now, now + BOUNCE_LENGTH + 0.3);
    }
  }

  /** You pressed on it (side: +1 toward its own left, where its head tilts), and let go. */
  hold(now: number, side: number, asleep: boolean): void {
    this.press = { at: now, release: -1, side };
    if (!asleep) this.attend(now, Infinity);
  }

  letGo(now: number, asleep: boolean): void {
    if (!this.press) return;
    const held = now - this.press.at;
    if (held < TAP) {
      this.press = null;
      if (this.attention && this.attention.to === Infinity) this.attention.to = now + ATTEND.rise + ATTEND.fall;
      this.tap(now, asleep);
      return;
    }
    this.press.release = now;
    // (long enough for its fur to stand: it shakes it out before it turns back)
    const fluffed = held - TAP * 0.8 > PET.fluff;
    if (this.attention && this.attention.to === Infinity) this.attention.to = now + PET.out + (fluffed ? FLUFF.shake + FLUFF.settle : 0.2);
  }

  /** Close an attention that is over (each frame, after reading the clock). */
  settle(now: number): void {
    if (this.attention && now >= this.attention.to) {
      this.lost += this.attended(this.attention.to);
      this.attention = null;
    }
  }

  /** Layer the answers over the action: the wave or the bounce for a tap, petting while you hold it, stirring in its sleep. Returns whether it looks at you. */
  apply(now: number, a: MuseAction & { moves: Move[] }, cues: { sleep: { roused: number } | null; petted: number }): boolean {
    const moves = a.moves;
    let toYou = false;
    if (this.answer) {
      const t = now - this.answer.at;
      // (its own wave, held back by the answer, gives way to it)
      if (this.answer.kind !== 'rouse' && t < BOUNCE_LENGTH + WAVE_LENGTH) a.wave = -1;
      if (this.answer.kind === 'wave' && t < WAVE_LENGTH) {
        a.wave = t;
        toYou = true;
      } else if (this.answer.kind === 'bounce' && t < BOUNCE_LENGTH) {
        moves.push({ kind: 'bounce', time: t, amount: 1 });
        toYou = true;
      } else if (this.answer.kind === 'rouse' && t < ROUSE) {
        for (const m of moves) if (m.kind === 'sleep') m.roused = t;
        if (cues.sleep) cues.sleep.roused = t;
      }
    }
    if (this.press) {
      const held = now - this.press.at;
      const release = this.press.release >= 0 ? now - this.press.release : -1;
      const over = release >= 0 && release > PET.out + FLUFF.shake + FLUFF.settle;
      if (over) this.press = null;
      else if (held > TAP * 0.8) {
        moves.push({ kind: 'pet', time: held - TAP * 0.8, amount: 1, side: this.press.side, release });
        cues.petted = held - TAP * 0.8;
        toYou = !cues.sleep;
      }
    }
    return toYou;
  }
}

export class MuseLife {
  private readonly day = buildDay();
  /** Each segment's start in the day (s), and the gait there; the day's length. */
  private readonly starts: number[] = [];
  private readonly gaits: number[] = [];
  readonly length: number;
  /** Where the day's clock is from the caller's (s): seeking moves it. */
  private shift = 0;
  /** Your doings, and its answers. */
  private readonly you = new Answers();
  private readonly living: Living = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0, moves: [] },
    lookAt: null,
    cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
  };

  constructor() {
    let t = 0;
    let gait = 0;
    for (const segment of this.day) {
      this.starts.push(t);
      this.gaits.push(gait);
      t += segment.time;
      gait += segment.gait;
    }
    this.length = t;
  }

  /** The day's segments by name, in order, with their starts (s): for seeking. */
  get names(): { name: string; start: number }[] {
    return this.day.map((s, k) => ({ name: s.name, start: this.starts[k] }));
  }

  /** Move the day on so that at time `now` it is `at` seconds into it. */
  seek(now: number, at: number): void {
    this.shift = at - now;
    this.you.reset();
  }

  /** The day's clock at a time: the caller's, less what it has spent answering you. */
  clock(now: number): number {
    const t = now + this.shift - this.you.heldBack(now);
    return ((t % this.length) + this.length) % this.length;
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

  /**
   * Muse at a time: its place, heading and action (for the rig), what it
   * looks at, the props' cues. camera: where you are (H, the stage), for
   * turning to you and looking at you.
   */
  at(now: number, camera: { x: number; y: number; z: number }): Living {
    const out = this.living;
    const a = out.action;
    a.time = now;
    a.walk = 0;
    a.stride = 1;
    a.wave = -1;
    a.look = 1;
    a.moves.length = 0;
    out.y = 0;
    out.lookAt = null;
    out.cues.water = null;
    out.cues.fish = null;
    out.cues.cook = null;
    out.cues.sleep = null;
    out.cues.hum = 0;
    out.cues.petted = -1;
    const u = this.clock(now);
    let k = this.day.length - 1;
    while (k > 0 && this.starts[k] > u) k--;
    const s = Math.min(this.day[k].time, u - this.starts[k]);
    a.gait = this.gaits[k];
    this.day[k].play(s, out, { camera, gait: this.gaits[k], start: this.starts[k] });
    // turned to you while it answers you, if it is standing or walking (stepping round as it turns)
    const w = this.you.attending(now);
    if (w > 0 && a.moves.length === 0) {
      const toYou = Math.atan2(camera.x - out.x, camera.z - out.z);
      const turn = wrap(toYou - out.heading);
      out.heading += turn * w;
      a.walk = Math.max(a.walk * (1 - w), 0.5 * Math.sin(Math.PI * w) * Math.min(1, Math.abs(turn) / 0.8));
      a.stride *= 1 - w;
      a.gait += w;
    }
    this.you.settle(now);
    if (this.you.apply(now, a, out.cues)) out.lookAt = [camera.x, camera.y, camera.z];
    // where it looks: its own way about, or at a point (its bearing from its heading, its height over its eyes)
    const idleYaw = 0.32 * Math.sin(0.47 * now + 1) + 0.14 * Math.sin(1.27 * now);
    const idlePitch = -0.04 + 0.06 * Math.sin(0.37 * now + 2);
    // (the segment and the answers set it: read afresh)
    const look = out.lookAt;
    if (look) {
      const [x, y, z] = look;
      const dx = x - out.x;
      const dz = z - out.z;
      a.lookYaw = wrap(Math.atan2(dx, dz) - out.heading);
      a.lookPitch = Math.atan2(y - headHeight(out), Math.max(Math.hypot(dx, dz), 0.3));
      // (beyond a turn of the head it looks about instead)
      const far = smoothstep(1.4, 2.0, Math.abs(a.lookYaw));
      a.lookYaw += (idleYaw - a.lookYaw) * far;
      a.lookPitch += (idlePitch - a.lookPitch) * far;
    } else {
      a.lookYaw = idleYaw;
      a.lookPitch = idlePitch;
    }
    if (a.walk > 0.5) a.look = 0.4;
    if (out.cues.sleep || a.moves.some((m) => m.kind === 'lieBack' || m.kind === 'wake' || m.kind === 'yawn')) a.look = 0;
    return out;
  }
}
