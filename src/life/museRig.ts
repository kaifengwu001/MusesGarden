import { Euler, Matrix4, Quaternion, Vector3, Vector4 } from 'three';
import { smoothstep } from '../core/math';
import { FIELD_FIT, JOINT, JOINTS, ORDER, PARENT, type ArmTurn, type MuseFit } from './museBody';

// Muse's skeleton and its poses. Every pose is closed-form: a function of
// time and of a few numbers about what Muse is doing (how fast it walks and
// how far it has walked, how far into a wave or any other move, where it
// looks), never of the frames before, so a frozen time always draws the same
// Muse.
//
// The layers, added up per joint as turns (rad, about x, y, z of Muse's
// frame: x to its left, y up, z forward), shifts (H) and scales:
//   idle   breathing, a slow shift of weight, the arms brought in from the
//          mesh's A-pose to hang against the belly
//   walk   a waddle: each foot lifted and set down ahead in turn while the
//          other stays planted, the body rolling over the planted foot and
//          bobbing down onto each step, arms swinging against the legs with
//          a little lag, the head steadied against the roll
//   wave   the left arm thrown up beside the head (as in the reference) with
//          a little overshoot, the forearm waggling, the body leaning away
//          and the head tilting toward it
//   moves  whatever else it is doing (museLife.ts plays them, each from its
//          own start): its answers to you (a happy bounce with its arms
//          flapping; leaning into your hand as you pet it; its fur standing
//          up in a wave as it scrunches down with delight) and its pastimes
//          (perched on a bench swinging its legs, sitting in the grass,
//          asleep on its back, fishing, watering flowers, stirring a pot),
//          with the hops, plops and stretches between them. The body as a
//          whole squashes and stretches (about its feet, keeping its volume)
//          and a joint can swell on its own (the belly with a sleeping
//          breath, the head squished under your hand)
//   look   the head (and a little of the chest) turned toward a point
// then the hands: where a move wants a mitten somewhere (clasping a rod, at
// its mouth, round a pot) its arm is turned to reach it (two joints and the
// forearm's twist, solved each frame from the arm as it hangs), and each
// shoulder takes its share of its arm's turn. The face (the eyes, the smile,
// a squint, eyes squeezed shut, the blush) and the fur's standing up are set as
// the layers go.

/** A step (H): how far ahead a foot is set down, and how high it lifts. */
export const STEP = { length: 0.13, lift: 0.045 } as const;
/** Breathing: period (s) and depth (scale). */
const BREATH = { period: 3.6, depth: 0.014 } as const;
/** The wave's beats: raise, waggle, lower (s), and the waggle's rate (Hz). */
export const WAVE = { raise: 0.55, waggle: 2.1, lower: 0.7, rate: 2.2 } as const;
export const WAVE_LENGTH = WAVE.raise + WAVE.waggle + WAVE.lower;
/** The happy bounce: its hops (each this long, s, and this high, H), how fast the arms flap (Hz), and the settle after the last (s). */
export const BOUNCE = { hops: 3, period: 0.5, height: 0.1, flap: 5.5, settle: 0.45 } as const;
export const BOUNCE_LENGTH = BOUNCE.hops * BOUNCE.period + BOUNCE.settle;
/** The fur standing up (s): scrunching down, the wave rising from its feet to its head, held, shaken out, lying back. */
export const FLUFF = { tuck: 0.3, rise: 0.75, hold: 0.7, shake: 0.7, settle: 0.5 } as const;
export const FLUFF_LENGTH = FLUFF.tuck + FLUFF.rise + FLUFF.hold + FLUFF.shake + FLUFF.settle;
/** Being petted: how long a hold before its fur stands up (s), and how long it takes to come out of it once let go. */
export const PET = { fluff: 1.3, out: 0.6 } as const;
/** A yawn and a stretch (s): the arms going up, held up, coming down. */
export const YAWN = { up: 0.7, hold: 1.5, down: 0.8 } as const;
export const YAWN_LENGTH = YAWN.up + YAWN.hold + YAWN.down;
/** Hopping up onto a seat and down off it (s): the whole hop, its take-off and its landing; how high it arcs over the straight line (H). */
export const HOP = { up: 1.25, down: 1.05, upFrom: 0.3, upTo: 0.75, downFrom: 0.28, downTo: 0.7, arc: 0.12 } as const;
/** Sitting down in the grass, getting up again, lying back from sitting, and waking (sitting up, rubbing its eyes) (s). */
export const PLOP = 1.0;
export const RISE = 1.25;
export const LIE_BACK = 1.9;
export const WAKE = 3.6;
/** Fishing, sitting at the water's edge (s into each catch): the cast lands, two nibbles, the bite and the yank, the fish flying out and hung, let go, waved off, the rod back. */
export const FISH = { period: 15, cast: [0, 1.3], nibble: [6.4, 7.0], bite: 7.6, fly: [7.8, 8.6], cheer: [8.4, 10.0], free: 10.8, bye: [11.2, 12.6] } as const;
/** Watering (s into each pour): the can tipped and poured, then a content look at it. */
export const GARDEN = { period: 7.5, pour: [0.6, 4.4], glad: [4.7, 6.6] } as const;
/** Cooking (s into each taste): stirring (turns a second), the ladle up to its mouth, blown on, sipped, the yum, back to the pot. */
export const COOK = { period: 12, rate: 0.7, lift: [6.8, 7.6], blow: [7.6, 8.5], sip: [8.5, 9.1], yum: [9.1, 10.8], back: [10.8, 11.6] } as const;

/**
 * Where its pastimes' things are (H, Muse's frame as it stands to them): the
 * pot's middle at its rim (far enough out that its fur stays clear of it,
 * the ladle reaching in), the flower it waters; where its mitten stirs from
 * (held out over the pot, the arm drawn out a little) and the ladle's bowl
 * goes round in the pot.
 */
export const POT = [-0.16, 0.4, 0.58] as const;
export const FLOWER = [-0.26, 0.0, 0.5] as const;
export const STIR = { x: -0.27, y: 0.46, z: 0.3, hand: 0.03, bowl: 0.07, reach: 0.03 } as const;
/** Reaching into its belly pocket (s): the mitten in by `in`, a moment there until `out` (where a tool appears in it), back out by `time`. */
export const POCKET = { in: 0.22, out: 0.38, time: 0.75 } as const;
/**
 * Where the tools are held (H): the rod (rest, carried by the chest), the can
 * (Muse's frame), the ladle at its mouth (rest, carried by the head). Each
 * with the arm held out to the side and forward, as it hangs when idle, not
 * drawn in across the body.
 */
const ROD = { x: -0.3, y: 0.36, z: 0.27 } as const;
const CAN = { x: -0.3, y: 0.37, z: 0.27 } as const;
const TASTE = { x: -0.19, y: 0.56, z: 0.3 } as const;
/** How long a tap's stirring lasts while it sleeps (s). */
export const ROUSE = 1.8;

export type MoveKind =
  | 'bounce'
  | 'pet'
  | 'fluff'
  | 'yawn'
  | 'hopUp'
  | 'perch'
  | 'hopDown'
  | 'plop'
  | 'sit'
  | 'rise'
  | 'lieBack'
  | 'sleep'
  | 'wake'
  | 'fish'
  | 'water'
  | 'stir'
  | 'pocket';

/** Something Muse is doing besides (museLife.ts): which, how far into it (s), how much of it shows (0 … 1). */
export interface Move {
  kind: MoveKind;
  time: number;
  amount: number;
  /** Petting: the side its head tilts toward (+1 its left), and how long since it was let go (s; < 0 while still held). */
  side?: number;
  release?: number;
  /** A pastime's own motions over its posture (0 … 1): eased in as it starts and out before it ends, the posture (sitting, lying) held throughout. */
  ease?: number;
  /** Asleep: how long since a tap stirred it (s; < 0 for none). */
  roused?: number;
  /** Sitting down, fishing and getting up on a ledge's edge (the pier's) with the legs hanging over it, not on the ground with them out in front. */
  edge?: boolean;
  /** Watering: how far the can is tipped (0 … 1), and a content look (0 … 1), as its life has them (else they come in turn). */
  tip?: number;
  glad?: number;
}

export interface MuseAction {
  /** World time (s). */
  time: number;
  /** How much of a walk (0 standing … 1 a full stride), how far each step carries the foot ahead (0 stepping on the spot … 1), and the gait's phase (cycles of two steps). */
  walk: number;
  stride: number;
  gait: number;
  /** Seconds into a wave, or < 0 for none. */
  wave: number;
  /** Where the head turns (rad, + to Muse's left, + up), and how much of that it takes (0 … 1). */
  lookYaw: number;
  lookPitch: number;
  look: number;
  /** Anything else it is doing, played in order over the rest. */
  moves?: readonly Move[];
}

/** The face as the poses set it: the eyes' openness (0 shut … 1 open), the smile (0 … 1), the squint (+1 shut in happy arcs ∩, −1 in content ones ∪), the eyes squeezed shut (> <, 0 … 1), and the blush (0 … 1 more). The mouth only smiles. */
interface Expression {
  eyes?: number;
  smile?: number;
  squint?: number;
  squeeze?: number;
  blush?: number;
}

const TAU = Math.PI * 2;
const euler = new Euler();
const q = new Quaternion();
const m = new Matrix4();
const m2 = new Matrix4();
const v = new Vector3();
const sc = new Vector3();

/** Ease out with a little overshoot (back), 0 → 1. */
function easeOutBack(x: number): number {
  const c = 1.6;
  const u = x - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** A hump from a to b (0 outside, 1 at its middle), as a half sine. */
function hump(a: number, b: number, x: number): number {
  return x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a));
}

/** In over the first edge, out over the second: smoothsteps at a…b and c…d. */
function during(a: number, b: number, c: number, d: number, x: number): number {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

/**
 * Sitting (H, rad), on a seat and on the ground: how far the body comes down
 * onto its bottom; how far the whole of it leans back; the hips rolled back
 * under it (the lower body turning with the legs, so its bottom sits down
 * flat and the legs bend from it, not out of the belly) and the waist and
 * chest bringing it back upright over them, its weight over its bottom; the
 * legs' swing forward (from straight down, as they end up) and splay.
 */
const PERCH = { drop: 0.07, lean: 0, hips: -0.38, waist: 0.25, chest: 0.12, legs: -0.75, splay: 0.08 } as const;
const SIT = { drop: 0.075, lean: 0.05, hips: -0.42, waist: 0.26, chest: 0.12, legs: -1.32, splay: 0.14 } as const;
/** Lying on its back: how far it tips (rad); the legs' bend from the body (back toward the ground, rad); the head turned aside; how much it flattens under its own weight (its depth less, its width more). */
const LIE = { tip: 1.48, legs: 0.32, head: 0.42, flat: 0.11, wide: 0.045 } as const;
/**
 * Muse's back in profile (H, rest, about the middle: height, depth), measured
 * off the sculpts: the points it rolls over as it lies back. The fur pressed
 * under it is a little over half its length.
 */
const BACK: readonly (readonly [number, number])[] = [
  [0.132, 0.0],
  [0.136, -0.07],
  [0.15, -0.14],
  [0.2, -0.192],
  [0.25, -0.219],
  [0.3, -0.23],
  [0.4, -0.24],
  [0.5, -0.244],
  [0.6, -0.241],
  [0.7, -0.232],
  [0.8, -0.219],
  [0.85, -0.196],
  [0.9, -0.16],
  [0.95, -0.111],
];
const PRESSED = 0.02;

/** How far up its feet must come for Muse, tipped back by a (rad), to rest on the lowest point of its back. */
function restOn(a: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let low = Infinity;
  for (const [y, z] of BACK) low = Math.min(low, y * c + z * s);
  return PRESSED - low;
}

/** The root's height, tipped back by a on the ground: sitting's drop at its lean, rolling onto the back beyond. */
function groundLift(a: number): number {
  const sat = -SIT.drop;
  return sat + (restOn(a) - sat) * smoothstep(SIT.lean, SIT.lean + 0.6, a);
}

/** Where a hop onto a seat (up) or down off it has Muse: how far across (0 … 1) and how far up (0 … 1 of the seat's height), and how high over that (H). */
export function hopArc(t: number, up: boolean): { along: number; rise: number; over: number } {
  const from = up ? HOP.upFrom : HOP.downFrom;
  const to = up ? HOP.upTo : HOP.downTo;
  const along = Math.max(0, Math.min(1, (t - from) / (to - from)));
  return { along, rise: up ? along : 1 - along, over: HOP.arc * 4 * along * (1 - along) * (up ? 1 : 0.5) };
}

/** A number in [0, 1) for an integer (a catch's luck, its timing). */
function luck(n: number, salt: number): number {
  const h = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Where fishing is at (s into it): each catch (FISH.period long) its own, its
 * nibbles and bite a little sooner or later (shift, s), and not always lucky:
 * the line out (0 … 1 landed), the float's dip (0 … 1 under), the yank, the
 * fish (0 in the water … 1 hung from the rod), let go (0 … 1 back in); the
 * cast's swing back and throw; nibbling, cheering, waving the fish off, or
 * (unlucky) drooping at the bite that got away.
 */
export function fishBeats(t: number): {
  cast: number;
  back: number;
  throwIt: number;
  dip: number;
  nibble: number;
  yank: number;
  fish: number;
  free: number;
  cheer: number;
  bye: number;
  missed: number;
  lucky: boolean;
  shift: number;
} {
  const n = Math.floor(t / FISH.period);
  const u = t - n * FISH.period;
  const lucky = luck(n, 1) < 0.6;
  const j = (luck(n, 2) - 0.5) * 1.6;
  const v = u - j;
  const cast = smoothstep(FISH.cast[0] + 0.55, FISH.cast[1], u);
  const back = hump(FISH.cast[0], FISH.cast[0] + 0.7, u);
  const throwIt = hump(FISH.cast[0] + 0.5, FISH.cast[1], u);
  const nibbles = hump(FISH.nibble[0], FISH.nibble[0] + 0.25, v) * 0.4 + hump(FISH.nibble[1], FISH.nibble[1] + 0.25, v) * 0.5;
  const dip = Math.max(nibbles, during(FISH.bite - 0.1, FISH.bite, FISH.fly[0], FISH.fly[0] + 0.1, v));
  const yank = during(FISH.bite, FISH.bite + 0.25, lucky ? FISH.free - 0.6 : FISH.fly[1], lucky ? FISH.free : FISH.fly[1] + 0.6, v);
  const fish = lucky ? during(FISH.fly[0], FISH.fly[1], FISH.free, FISH.free + 0.01, v) : 0;
  const free = lucky && v >= FISH.free ? smoothstep(FISH.free, FISH.free + 0.5, v) : 0;
  const cheer = lucky ? during(FISH.cheer[0], FISH.cheer[0] + 0.2, FISH.cheer[1] - 0.3, FISH.cheer[1], v) : 0;
  const bye = lucky ? during(FISH.bye[0], FISH.bye[0] + 0.3, FISH.bye[1] - 0.3, FISH.bye[1], v) : 0;
  const missed = lucky ? 0 : during(FISH.fly[0] + 0.3, FISH.fly[0] + 0.8, FISH.cheer[1] - 0.4, FISH.cheer[1] + 0.4, v);
  return { cast, back, throwIt, dip, nibble: dip * (v < FISH.bite ? 1 : 0), yank, fish, free: u < FISH.cast[1] ? 0 : free, cheer, bye, missed, lucky, shift: j };
}

/** Where watering is at (s): the can tipped (0 … 1), water pouring, and which pour (the count of them). */
export function gardenBeats(t: number): { tip: number; pour: number; flower: number } {
  const n = Math.floor(t / GARDEN.period);
  const u = t - n * GARDEN.period;
  const tip = during(GARDEN.pour[0], GARDEN.pour[0] + 0.6, GARDEN.pour[1] - 0.4, GARDEN.pour[1] + 0.2, u);
  const pour = during(GARDEN.pour[0] + 0.4, GARDEN.pour[0] + 0.7, GARDEN.pour[1] - 0.4, GARDEN.pour[1], u);
  return { tip, pour, flower: n };
}

/** Where cooking is at (s): the stirring's turn (rad), the ladle at its mouth (0 … 1), blowing on it. */
export function cookBeats(t: number): { turn: number; taste: number; blow: number } {
  const u = ((t % COOK.period) + COOK.period) % COOK.period;
  const taste = during(COOK.lift[0], COOK.lift[1], COOK.back[0], COOK.back[1], u);
  return { turn: TAU * COOK.rate * t, taste, blow: during(COOK.blow[0], COOK.blow[0] + 0.2, COOK.blow[1] - 0.15, COOK.blow[1], u) };
}

/** Asleep (s): the breath (0 out … 1 in) and the snore bubble's size (0 … 1), blown on each breath out. */
export function sleepBeats(t: number): { breath: number; bubble: number } {
  const period = 4.6;
  const breath = 0.5 - 0.5 * Math.cos((TAU * t) / period);
  const u = ((t % period) + period) % period;
  // breathing out (the second half) blows the bubble up; breathing in draws it back down to a bead
  const out = u > period / 2 ? smoothstep(period / 2, period, u) : 1 - smoothstep(0, period * 0.35, u);
  return { breath, bubble: 0.25 + 0.75 * out };
}

/** Perched on a seat (s): the legs swinging (0 … 1), and humming to itself (0 … 1). */
export function perchBeats(t: number): { kick: number; hum: number } {
  const k = t % 9;
  const h = t % 14;
  return { kick: during(0.6, 1.4, 5.2, 6, k), hum: t > 6 ? during(6, 6.6, 10.6, 11.2, h) : 0 };
}

/** One arm's reach toward a point: the side, the point (H, rest), the joint that carries it as posed (−1: Muse's frame), how much. */
interface Reach {
  side: number;
  x: number;
  y: number;
  z: number;
  joint: number;
  amount: number;
}

export class MuseRig {
  /** Per joint: turn (rad about x, y, z, applied y, x, z), shift (H) and its own swelling (scale − 1, not passed on to the joints after it). */
  private readonly turn = new Float64Array(JOINTS * 3);
  private readonly shift = new Float64Array(JOINTS * 3);
  private readonly swell = new Float64Array(JOINTS * 3);
  /** The whole body stretched (+) or squashed (−) about its feet, keeping its volume. */
  private stretch = 0;
  /** Each joint's posed frame, and the skin transforms (as the mesh was made → posed, H): as matrices (muse.vert.glsl, the shadow's) and as dual quaternions, the rotation then the translation part (the lab's comparison). */
  private readonly frame = Array.from({ length: JOINTS }, () => new Matrix4());
  readonly skin = Array.from({ length: JOINTS }, () => new Matrix4());
  readonly dual = Array.from({ length: JOINTS * 2 }, () => new Vector4());
  /** Each joint's frame as the mesh was made (its arms turned as the fit binds them), inverted. */
  private readonly unbind = Array.from({ length: JOINTS }, () => new Matrix4());
  /** The face: the eyes' openness (0 shut … 1 open), the smile (0 at rest … 1 beaming), the squint (+1 happy arcs, −1 content ones), the eyes squeezed shut (> <), the blush. */
  eyes = 1;
  smile = 0;
  squint = 0;
  squeeze = 0;
  blush = 0;
  /** The fur standing up: how far up the body the wave has come (H, at rest), how much stands behind it, the crest's extra at its front, the front's width (H). */
  readonly fluff = new Vector4(0, 0, 0, 0.12);
  /**
   * How much of each shoulder's correctives (museMesh.ts) the arm's pose
   * calls for: raised, the wave's (0 at the sculpt's own pose … 1 at the top
   * of a wave), and hung, the hanging arm's (1 hanging … 0 at the sculpt's
   * pose). Each is read off where the upper arm points (in the chest's frame)
   * along the arc from hanging, through the pose it was made in, up to the
   * top of a wave; off that arc (reaching forward or back) both give way, as
   * neither was made for it.
   */
  raised = 0;
  raisedRight = 0;
  hung = 1;
  hungRight = 1;
  /** How far it is lying on its back (0 up … 1 flat): only then does it press the grass down round it. */
  lying = 0;
  /** Where the hands are wanted this pose. */
  private readonly reaches: Reach[] = [];
  /** Each mitten's middle in its forearm's own frame. */
  private readonly hands = [new Vector3(), new Vector3()];
  /** The left upper arm's direction (the chest's frame) as it hangs, and the arc it rises along (its plane's normal, the way along it from hanging); the arc's angles at the pose it was made in and at the top of a wave. */
  private readonly arc = { hang: new Vector3(), normal: new Vector3(), toward: new Vector3(), made: 1, wave: 2 };

  constructor(readonly fit: MuseFit = FIELD_FIT) {
    // the frames the mesh was made in: the skeleton's rest, the arms turned as bound
    this.turn.fill(0);
    this.shift.fill(0);
    this.armTurns(fit.bind, 1);
    this.shoulders();
    this.compute();
    for (let j = 0; j < JOINTS; j++) this.unbind[j].copy(this.frame[j]).invert();
    // each mitten's middle (the left's as the fit has it, else a little out past the elbow; the right's mirrored)
    const J = JOINT;
    const e = fit.rest[J.foreArmL];
    const u = fit.rest[J.upperArmL];
    const along = new Vector3(e[0] - u[0], e[1] - u[1], e[2] - u[2]).normalize();
    const hand = fit.hand ?? [e[0] + 0.07 * along.x, e[1] + 0.07 * along.y, e[2] + 0.07 * along.z];
    this.hands[0].set(hand[0], hand[1], hand[2]).applyMatrix4(this.unbind[J.foreArmL]);
    this.hands[1].set(-hand[0], hand[1], hand[2]).applyMatrix4(this.unbind[J.foreArmR]);
    // the arc the arm rises along: hung, as made, at the top of a wave
    const made = this.armDirection(1, new Vector3());
    this.hang();
    const hung = this.armDirection(1, new Vector3());
    this.raiseLeft();
    const up = this.armDirection(1, new Vector3());
    const c = this.arc;
    c.hang.copy(hung);
    c.normal.crossVectors(hung, up).normalize();
    c.toward.crossVectors(c.normal, hung).normalize();
    c.made = Math.max(0.1, Math.atan2(made.dot(c.toward), made.dot(hung)));
    c.wave = Math.max(c.made + 0.1, Math.atan2(up.dot(c.toward), up.dot(hung)));
    // and back as made
    this.turn.fill(0);
    this.shift.fill(0);
    this.armTurns(fit.bind, 1);
    this.shoulders();
    this.compute();
  }

  /** Turn both arms (the right mirrored) by a share of an arm turn. */
  private armTurns(t: ArmTurn, share: number): void {
    const J = JOINT;
    this.addTurn(J.upperArmL, t.x * share, 0, t.z * share);
    this.addTurn(J.upperArmR, t.x * share, 0, -t.z * share);
    this.addTurn(J.foreArmL, 0, 0, t.fore * share);
    this.addTurn(J.foreArmR, 0, 0, -t.fore * share);
  }

  /** Turn one arm from where it is (side 1 its left, −1 its right, mirrored): the upper arm about x, y, z and the forearm's bend (about z). */
  private armBy(side: number, x: number, y: number, z: number, fore: number): void {
    const J = JOINT;
    this.addTurn(side > 0 ? J.upperArmL : J.upperArmR, x, side * y, side * z);
    this.addTurn(side > 0 ? J.foreArmL : J.foreArmR, 0, 0, side * fore);
  }

  /** The arms hung as the fit hangs them. */
  private hangArms(): void {
    this.armTurns(this.fit.hang, 1);
  }

  /** Each shoulder takes its share of its upper arm's turn (the turn split, so the two add up to it). */
  private shoulders(): void {
    const s = this.fit.shoulder ?? 0;
    if (s === 0) return;
    for (const [upper, shoulder] of [
      [JOINT.upperArmL, JOINT.shoulderL],
      [JOINT.upperArmR, JOINT.shoulderR],
    ]) {
      for (let a = 0; a < 3; a++) {
        this.turn[shoulder * 3 + a] += s * this.turn[upper * 3 + a];
        this.turn[upper * 3 + a] *= 1 - s;
      }
    }
  }

  /** The arms drawn as long as the fit has them. */
  private reach(): void {
    const r = this.fit.reach ?? 0;
    if (r === 0) return;
    this.lengthen(JOINT.upperArmL, JOINT.foreArmL, r);
    this.lengthen(JOINT.upperArmR, JOINT.foreArmR, r);
  }

  /** An arm drawn longer (H): its forearm moved out along its upper arm. */
  private lengthen(upper: number, fore: number, by: number): void {
    const a = this.fit.rest[upper];
    const b = this.fit.rest[fore];
    const k = by / (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1);
    this.addShift(fore, k * (b[0] - a[0]), k * (b[1] - a[1]), k * (b[2] - a[2]));
  }

  private addTurn(j: number, x: number, y: number, z: number): void {
    this.turn[j * 3] += x;
    this.turn[j * 3 + 1] += y;
    this.turn[j * 3 + 2] += z;
  }

  private addShift(j: number, x: number, y: number, z: number): void {
    this.shift[j * 3] += x;
    this.shift[j * 3 + 1] += y;
    this.shift[j * 3 + 2] += z;
  }

  /** A joint swollen (+) or shrunk (−) along its own axes, without what hangs from it. */
  private addSwell(j: number, x: number, y: number, z: number): void {
    this.swell[j * 3] += x;
    this.swell[j * 3 + 1] += y;
    this.swell[j * 3 + 2] += z;
  }

  /** Ease the face toward an expression by an amount (0 … 1). */
  private express(k: number, e: Expression): void {
    if (k <= 0) return;
    if (e.eyes !== undefined) this.eyes += (e.eyes - this.eyes) * k;
    if (e.smile !== undefined) this.smile += (e.smile - this.smile) * k;
    if (e.squint !== undefined) this.squint += (e.squint - this.squint) * k;
    if (e.squeeze !== undefined) this.squeeze += (e.squeeze - this.squeeze) * k;
    if (e.blush !== undefined) this.blush += (e.blush - this.blush) * k;
  }

  /** Want a mitten at a point (H, rest), carried as a joint is posed (−1: Muse's own frame): reachArms turns the arm to it. */
  private reachFor(side: number, x: number, y: number, z: number, joint: number, amount: number): void {
    if (amount > 0) this.reaches.push({ side, x, y, z, joint, amount });
  }

  /** Pose the skeleton for an action and compute the skin matrices. */
  pose(a: MuseAction): void {
    this.turn.fill(0);
    this.shift.fill(0);
    this.swell.fill(0);
    this.stretch = 0;
    this.reaches.length = 0;
    this.fluff.set(0, 0, 0, 0.12);
    const waving = a.wave >= 0 && a.wave < WAVE_LENGTH;
    this.eyes = blink(a.time);
    // a little smile always, beaming while it waves
    this.smile = 0.15;
    this.squint = 0;
    this.squeeze = 0;
    this.blush = 0;
    this.lying = 0;
    this.reach();
    this.idle(a.time, a.walk);
    if (a.walk > 0) this.walkPose(a.gait, a.walk, a.stride);
    if (waving) this.wavePose(a.wave);
    for (const move of a.moves ?? []) if (move.amount > 0) this.move(move);
    if (a.look > 0) this.lookPose(a.lookYaw * a.look, a.lookPitch * a.look);
    this.reachArms();
    this.shoulders();
    this.compute();
    this.correctives(1);
    this.correctives(-1);
  }

  private move(mv: Move): void {
    const t = mv.time;
    const k = Math.min(1, mv.amount);
    const e = k * (mv.ease ?? 1);
    switch (mv.kind) {
      case 'bounce':
        return this.bounce(t, k);
      case 'pet':
        return this.pet(t, mv.release ?? -1, mv.side ?? 1, k);
      case 'fluff':
        return this.fluffUp(t, t - FLUFF.tuck - FLUFF.rise - FLUFF.hold, k, true);
      case 'yawn':
        return this.yawn(t, k);
      case 'hopUp':
        return this.hopUp(t, k);
      case 'perch':
        return this.perch(t, k, e);
      case 'hopDown':
        return this.hopDown(t, k);
      case 'plop':
        return this.plop(t, k, mv.edge === true);
      case 'sit':
        return this.sit(t, k, e);
      case 'rise':
        return this.rise(t, k, mv.edge === true);
      case 'lieBack':
        return this.lieBack(t, k);
      case 'sleep':
        return this.sleep(t, k, e, mv.roused ?? -1);
      case 'wake':
        return this.wake(t, k);
      case 'fish':
        return this.fish(t, k, e, mv.edge === true);
      case 'water':
        return this.water(t, e, mv.tip, mv.glad);
      case 'stir':
        return this.stir(t, e);
      case 'pocket':
        return this.pocket(k);
    }
  }

  private idle(time: number, walk: number): void {
    const J = JOINT;
    const still = 1 - 0.7 * walk;
    // breathing: the chest rises and opens a touch, the head riding up on it (rigid, as the skinning wants)
    const b = 0.5 - 0.5 * Math.cos((TAU * time) / BREATH.period);
    const d = BREATH.depth * b * still;
    this.addShift(J.chest, 0, d * 0.35, d * 0.25);
    this.addTurn(J.chest, -d * 0.6, 0, 0);
    this.addShift(J.head, 0, d * 0.15, 0);
    // a slow shift of weight from foot to foot, the head keeping level
    const sway = 0.018 * Math.sin((TAU * time) / 8.3) * still;
    this.addTurn(J.pelvis, 0, 0.02 * Math.sin((TAU * time) / 11.7) * still, sway);
    this.addTurn(J.head, 0, 0, -0.6 * sway);
    // the arms hanging against the belly, rising a touch with each breath
    this.hangArms();
    this.addTurn(J.upperArmL, 0, 0, 0.012 * b);
    this.addTurn(J.upperArmR, 0, 0, -0.012 * b);
  }

  private walkPose(gait: number, amount: number, stride: number): void {
    const J = JOINT;
    const w = amount;
    const phase = TAU * gait;
    for (const [leg, offset] of [
      [J.legL, 0],
      [J.legR, 0.5],
    ] as const) {
      // half the cycle swinging forward through the air, half planted and sliding back under the body
      const u = (((gait + offset) % 1) + 1) % 1;
      let z: number;
      let lift = 0;
      let pitch = 0;
      if (u < 0.5) {
        const k = u * 2;
        z = STEP.length * (smoothstep(0, 1, k) - 0.5);
        lift = STEP.lift * Math.sin(Math.PI * k);
        pitch = -0.28 * Math.sin(Math.PI * k);
      } else {
        z = STEP.length * (0.5 - (u - 0.5) * 2);
      }
      this.addShift(leg, 0, lift * w, z * w * stride);
      this.addTurn(leg, pitch * w, 0, 0);
    }
    // the body rolls over the planted foot (the right while the left swings) and bobs down onto each step
    const roll = 0.1 * Math.sin(phase) * w;
    const step = Math.abs(Math.sin(phase));
    this.addTurn(J.pelvis, 0.02 * w, 0.07 * Math.sin(phase) * w, roll);
    this.addShift(J.pelvis, 0, 0.012 * (step - 0.6) * w, 0);
    this.addTurn(J.spine, 0.045 * w, -0.03 * Math.sin(phase) * w, -0.25 * roll);
    // the head steadied against the roll, a beat behind it
    this.addTurn(J.head, 0.02 * w * Math.cos(2 * phase), 0, -0.55 * 0.1 * Math.sin(phase - 0.5) * w);
    // arms swinging against the legs, a little late, flung out a touch by the roll
    const swing = 0.24 * w;
    const late = phase - 0.45;
    this.addTurn(J.upperArmL, swing * Math.cos(late), 0, 0.07 * Math.sin(phase - 0.6) * w);
    this.addTurn(J.upperArmR, -swing * Math.cos(late), 0, 0.07 * Math.sin(phase - 0.6) * w);
    this.addTurn(J.foreArmL, -0.35 * swing * Math.cos(late - 0.7) - 0.08 * w, 0, 0);
    this.addTurn(J.foreArmR, 0.35 * swing * Math.cos(late - 0.7) - 0.08 * w, 0, 0);
  }

  /** The wave's left arm at its height (0 hanging … 1 up), the waggle about the elbow on top. */
  private waveArm(side: number, raise: number, waggle: number): void {
    // the arm up beside the head as the fit has it (its hang undone as it rises), the hand clear of
    // the face; the waggle swings the forearm about the elbow. (Turns apply about z first: the arm
    // swings up out to the side, then forward or back.)
    const h = this.fit.hang;
    const w = this.fit.wave;
    this.armBy(side, (w.x - h.x) * raise, w.y * raise, (w.z - h.z) * raise, (w.fore - h.fore) * raise + 0.3 * waggle * raise);
    // (stretching a little as it reaches up)
    const J = JOINT;
    if (side > 0) this.lengthen(J.upperArmL, J.foreArmL, (w.reach ?? 0) * raise);
    else this.lengthen(J.upperArmR, J.foreArmR, (w.reach ?? 0) * raise);
  }

  private wavePose(time: number): void {
    const J = JOINT;
    // up with a little overshoot, waggle, down with a settle
    const up = time < WAVE.raise ? easeOutBack(time / WAVE.raise) : 1;
    const downT = time - WAVE.raise - WAVE.waggle;
    const down = downT > 0 ? smoothstep(0, 1, downT / WAVE.lower) : 0;
    const raise = up * (1 - down);
    // a dip before it rises (anticipation)
    const dip = time < WAVE.raise ? -0.12 * Math.sin(Math.PI * Math.min(1, time / (0.3 * WAVE.raise))) * (1 - smoothstep(0.2, 0.35, time / WAVE.raise)) : 0;
    const waggleT = time - WAVE.raise;
    const waggleIn = smoothstep(0, 0.25, waggleT) * (1 - smoothstep(WAVE.waggle - 0.2, WAVE.waggle + 0.1, waggleT));
    const waggle = Math.sin(TAU * WAVE.rate * Math.max(0, waggleT)) * waggleIn;
    this.waveArm(1, raise, waggle);
    this.addTurn(J.upperArmL, 0, 0, dip);
    // the body turns a touch toward you, upright; the head tips a little away from the raised arm (as in the references); the other arm lifts a touch
    this.addTurn(J.spine, 0, 0.05 * raise, 0);
    this.addTurn(J.chest, 0, 0.04 * raise, 0);
    this.addTurn(J.head, 0.04 * raise, 0.06 * raise, 0.08 * raise + 0.03 * waggle * raise);
    this.addTurn(J.upperArmR, 0, 0, -0.08 * raise);
    // the waggle's tremor in the body, barely
    this.addTurn(J.chest, 0, 0, 0.006 * waggle * raise);
    this.smile = Math.max(this.smile, 0.15 + 0.85 * Math.max(0, Math.min(1, raise)));
  }

  // ---- its answers to you ----

  /**
   * Three hops on the spot, squashing onto each landing and stretching out of
   * it, beaming. The arms, held out a little, are only carried by the hops:
   * pressed down as it lands and springs off (they lag the body's push),
   * floating up through the flight, the forearms a beat behind; after the
   * last landing they settle.
   */
  private bounce(t: number, k: number): void {
    const J = JOINT;
    const B = BOUNCE;
    const end = B.hops * B.period;
    const env = k * smoothstep(0, 0.1, t) * (1 - smoothstep(end + B.settle - 0.2, end + B.settle, t));
    let lift = 0;
    let stretch: number;
    if (t < end) {
      const n = Math.floor(t / B.period);
      const u = t / B.period - n;
      // the share of each hop on the ground: landing from the one before (stretched, then squashed), springing off
      const g = 0.32;
      if (u < g) {
        const s = u / g;
        stretch = (n > 0 ? 0.07 * (1 - smoothstep(0, 0.3, s)) : 0) - 0.14 * Math.sin(Math.PI * s) + 0.07 * smoothstep(0.65, 1, s);
      } else {
        const s = (u - g) / (1 - g);
        lift = 4 * B.height * s * (1 - s);
        stretch = 0.07 * (1 - 2 * s) * (1 - 2 * s);
      }
    } else {
      // the last landing, and a little rebound
      const s = (t - end) / B.settle;
      stretch = 0.07 * (1 - smoothstep(0, 0.12, s)) - 0.12 * hump(0, 0.5, s) + 0.03 * hump(0.5, 0.85, s);
    }
    this.addShift(J.root, 0, lift * env, 0);
    this.stretch += stretch * env;
    // the head nods down onto each landing
    this.addTurn(J.head, -0.5 * Math.min(0, stretch) * env, 0, 0);
    // the arms swung by the hops: lowest just as it leaves the ground, highest as it comes down (dying away after the last)
    const phase = t / B.period;
    const after = Math.max(0, t - end) / B.settle;
    const fade = 1 - smoothstep(0, 1, after);
    const swing = -Math.cos(TAU * (phase - 0.3)) * fade;
    const lag = -Math.cos(TAU * (phase - 0.4)) * fade;
    for (const side of [1, -1]) this.armBy(side, 0.22 * env, 0, (0.42 + 0.3 * swing) * env, (0.18 + 0.14 * lag) * env);
    this.express(env, { squint: 1, smile: 1, blush: 0.55 });
  }

  /**
   * Being petted (t since your hold began; release since you let go, < 0
   * while held): the head tilts into your hand (toward side), the body
   * leaning in after it, the paws up shyly, eyes squeezed shut (> <),
   * blushing; it keeps its height. Held a while, its fur stands up in a wave
   * from its feet to its head; let go, it shakes it out.
   */
  private pet(t: number, release: number, side: number, k: number): void {
    const J = JOINT;
    const held = release < 0;
    const on = k * smoothstep(0, 0.35, t) * (held ? 1 : 1 - smoothstep(0, PET.out, release));
    const sway = Math.sin(TAU * 0.42 * t);
    this.addTurn(J.head, 0.07 * on, 0.05 * side * on, (0.3 * side + 0.05 * sway) * on);
    this.addTurn(J.chest, 0, 0, 0.06 * side * on);
    this.addTurn(J.pelvis, 0, 0, 0.03 * sway * on);
    // its mittens up to its cheeks
    this.reachFor(1, 0.2, 0.6, 0.2, J.head, 0.9 * on);
    this.reachFor(-1, -0.2, 0.6, 0.2, J.head, 0.9 * on);
    this.express(on, { squeeze: 1, smile: 0.9, blush: 0.85 });
    // held long enough: the fur (time into it, and the shake from the let-go)
    const held0 = held ? t : t - release;
    const into = held0 - PET.fluff;
    if (into <= 0) return;
    const peak = FLUFF.tuck + FLUFF.rise + FLUFF.hold * 0.5;
    // (petted, it stands its full height: the fur stands up, the body is not squashed down)
    this.fluffUp(Math.min(into, peak), held ? -1 : release, k, false, false);
  }

  /**
   * The fur standing up: scrunched down (no neck, so the whole body goes
   * shorter and rounder, the head sinking in, the shoulders up), eyes
   * squeezed shut, while the fur stands up in a wave from its feet to its
   * head; then (from shake ≥ 0) it shakes itself out, pops back up to its
   * height and the fur lies back down. alone: the whole of it, its own face;
   * scrunch: squashed down as it goes (not as it is petted).
   */
  private fluffUp(t: number, shake: number, k: number, alone: boolean, scrunch = true): void {
    const J = JOINT;
    const F = FLUFF;
    const tuck = smoothstep(0, F.tuck, t) * (shake >= 0 ? 1 - smoothstep(0.05, 0.3, shake) : 1);
    // the wave up the body: its front from below the feet to over the head
    const rise = smoothstep(F.tuck * 0.4, F.tuck + F.rise, t);
    const down = shake >= 0 ? smoothstep(F.shake * 0.4, F.shake + F.settle, shake) : 0;
    const standing = rise * (1 - down);
    this.fluff.set(Math.max(this.fluff.x, -0.15 + 1.35 * rise), Math.max(this.fluff.y, standing * k), Math.max(this.fluff.z, 0.6 * hump(0, 1, rise) * k), 0.12);
    // scrunched down, the head in, the shoulders up; a tremble of delight
    if (scrunch) {
      const pop = shake >= 0 ? 0.045 * hump(0.08, 0.42, shake) : 0;
      this.stretch += (-0.1 * tuck + pop) * k;
      this.addShift(J.head, 0, -0.02 * tuck * k, 0);
      for (const side of [1, -1]) this.armBy(side, -0.15 * tuck * k, 0, 0.28 * tuck * k, 0.35 * tuck * k);
    }
    this.addTurn(J.chest, 0, 0.012 * Math.sin(TAU * 11 * t) * tuck * k, 0);
    // shaken out: the body twisting back and forth, the head after it
    if (shake >= 0 && shake < F.shake) {
      const s = Math.sin(TAU * 5 * shake) * (1 - shake / F.shake) * smoothstep(0, 0.08, shake);
      this.addTurn(J.pelvis, 0, 0.16 * s * k, 0.04 * s * k);
      this.addTurn(J.head, 0, -0.1 * s * k, -0.08 * s * k);
    }
    const shut = tuck * (shake >= 0 ? 1 - smoothstep(F.shake * 0.6, F.shake + 0.2, shake) : 1);
    this.express(shut * k, alone ? { squint: 1, smile: 0.7 } : { squeeze: 1, smile: 0.7 });
    if (alone) this.express(k * smoothstep(F.shake, F.shake + F.settle, shake) * (1 - smoothstep(F.shake + F.settle * 0.6, F.shake + F.settle, shake)), { smile: 1 });
  }

  /** A big yawn and a stretch: the arms up over its head, the body drawn up tall, the head back, the mouth wide, the eyes screwed shut. */
  private yawn(t: number, k: number): void {
    const J = JOINT;
    const Y = YAWN;
    const up = during(0, Y.up, Y.up + Y.hold, YAWN_LENGTH, t) * k;
    for (const side of [1, -1]) this.waveArm(side, 0.92 * up, 0);
    for (const side of [1, -1]) this.armBy(side, 0, 0, 0.2 * up, -0.2 * up);
    this.stretch += 0.06 * up;
    this.addShift(J.root, 0, 0.012 * up, 0);
    this.addTurn(J.head, -0.2 * up, 0, 0);
    this.addTurn(J.chest, -0.07 * up, 0, 0.03 * Math.sin(TAU * 7 * t) * up * hump(Y.up, Y.up + Y.hold, t) * 0.3);
    const open = during(Y.up * 0.5, Y.up + 0.25, Y.up + Y.hold - 0.3, Y.up + Y.hold + 0.25, t);
    this.express(open * k, { squint: -1, smile: 0.3 });
  }

  // ---- sitting, lying, and getting there ----

  /** Sat (0 standing … 1 sat) as `how` has it: down onto its bottom, the hips rolled back under it and the body upright again over them, the legs swung forward. */
  private seated(how: typeof PERCH | typeof SIT, k: number): void {
    const J = JOINT;
    this.addShift(J.root, 0, -how.drop * k, 0);
    this.addTurn(J.root, -how.lean * k, 0, 0);
    this.addTurn(J.pelvis, how.hips * k, 0, 0);
    this.addTurn(J.spine, how.waist * k, 0, 0);
    this.addTurn(J.chest, how.chest * k, 0, 0);
    this.addTurn(J.legL, (how.legs + how.lean) * k, 0, how.splay * k);
    this.addTurn(J.legR, (how.legs + how.lean) * k, 0, -how.splay * k);
  }

  /** Perched on a seat (0 standing … 1 sat): sat on its bottom at the seat's edge, upright, the legs hanging over it. */
  private perchBase(k: number): void {
    this.seated(PERCH, k);
    // the arms down at its sides, a little out
    for (const side of [1, -1]) this.armBy(side, 0.1 * k, 0, 0.12 * k, 0.1 * k);
  }

  /** Sitting on the ground (0 standing … 1 sat): down on its bottom, upright, the legs out in front. */
  private sitBase(k: number): void {
    this.seated(SIT, k);
    for (const side of [1, -1]) this.armBy(side, 0.05 * k, 0, 0.2 * k, 0.15 * k);
  }

  /**
   * From sitting (lying 0) to lying on its back (1), as much as k shows:
   * tipped back onto its back (its hips and waist straightening as it goes),
   * the body flattening a little under its weight, the legs bending back
   * toward the ground, the arms out to its sides, the head turned aside.
   */
  private lieBase(lying: number, k: number): void {
    const J = JOINT;
    const tip = SIT.lean + (LIE.tip - SIT.lean) * lying;
    const sat = 1 - smoothstep(0, 0.6, lying);
    const flat = smoothstep(0.5, 1, lying);
    this.lying = Math.max(this.lying, Math.min(1, lying) * k);
    // (the hips' roll lowered its bottom: as they straighten it rolls onto its back; flattened, it settles lower)
    this.addShift(J.root, 0, (groundLift(tip) - 0.024 * flat) * k, 0);
    this.addTurn(J.root, -tip * k, 0, 0);
    this.addTurn(J.pelvis, SIT.hips * sat * k, 0, 0);
    this.addTurn(J.spine, SIT.waist * sat * k, 0, 0);
    this.addTurn(J.chest, SIT.chest * sat * k, 0, 0);
    for (const j of [J.pelvis, J.spine, J.chest]) this.addSwell(j, LIE.wide * flat * k, 0, -LIE.flat * flat * k);
    this.addSwell(J.head, 0.5 * LIE.wide * flat * k, 0, -0.5 * LIE.flat * flat * k);
    // (the legs' turn from the body: sitting's, then bending back toward the ground as it lies)
    const legs = SIT.legs + SIT.lean + (LIE.legs - SIT.legs - SIT.lean) * lying;
    this.addTurn(J.legL, legs * k, 0, SIT.splay * k);
    this.addTurn(J.legR, legs * k, 0, -SIT.splay * k);
    // the arms out as the sculpt has them (its hang undone), the forearms bent up toward its head
    const h = this.fit.hang;
    const l = lying;
    for (const side of [1, -1]) this.armBy(side, (-h.x * l + 0.05 * (1 - l)) * k, 0, ((-h.z + 0.15) * l + 0.2 * (1 - l)) * k, ((-h.fore + 0.5) * l + 0.15 * (1 - l)) * k);
    this.addTurn(J.head, 0, LIE.head * l * k, 0.12 * l * k);
  }

  /** Onto a seat behind it: a crouch, a spring up and back with the legs swinging out, a bump down onto its bottom and a wiggle. */
  private hopUp(t: number, k: number): void {
    const J = JOINT;
    const sat = smoothstep(HOP.upFrom + 0.05, HOP.upTo - 0.05, t);
    this.perchBase(sat * k);
    const crouch = hump(0, HOP.upFrom + 0.04, t);
    const air = hump(HOP.upFrom - 0.02, HOP.upTo, t);
    const land = hump(HOP.upTo, HOP.upTo + 0.2, t);
    const settle = hump(HOP.upTo + 0.18, HOP.up, t);
    this.stretch += (-0.12 * crouch + 0.07 * air * (1 - sat) - 0.11 * land + 0.025 * settle) * k;
    this.addTurn(J.pelvis, (0.16 * crouch - 0.05 * land) * k, 0, 0.05 * Math.sin(TAU * 3 * t) * settle * k);
    // the arms swung back for the spring, up and out in the air
    for (const side of [1, -1]) this.armBy(side, (0.45 * crouch - 0.2 * air) * k, 0, (0.55 * air + 0.25 * land) * k, 0.2 * air * k);
    this.express(settle * k, { squint: 1, smile: 0.9 });
  }

  /** Perched: the legs swinging in turns now and then, humming to itself (eyes shut, swaying) now and then. */
  private perch(t: number, k: number, e: number): void {
    const J = JOINT;
    this.perchBase(k);
    const { kick, hum } = perchBeats(t);
    const swing = Math.sin(TAU * 1.25 * t);
    this.addTurn(J.legL, 0.3 * swing * kick * e, 0, 0);
    this.addTurn(J.legR, -0.3 * swing * kick * e, 0, 0);
    this.addTurn(J.pelvis, 0.015 * Math.sin(TAU * 2.5 * t) * kick * e, 0, 0);
    for (const side of [1, -1]) this.armBy(side, 0.08 * side * swing * kick * e, 0, 0, 0);
    const sway = Math.sin(TAU * 0.5 * t);
    this.addTurn(J.head, 0, 0, 0.13 * sway * hum * e);
    this.addTurn(J.pelvis, 0, 0, 0.05 * Math.sin(TAU * 0.5 * t - 0.6) * hum * e);
    this.express(hum * e, { squint: -1, smile: 0.75 });
  }

  /** Off the seat: shuffling forward, a spring off, landing on its feet with a squash. */
  private hopDown(t: number, k: number): void {
    const J = JOINT;
    const sat = 1 - smoothstep(HOP.downFrom, HOP.downTo - 0.1, t);
    this.perchBase(sat * k);
    const lean = hump(0, HOP.downFrom + 0.15, t);
    const air = hump(HOP.downFrom, HOP.downTo, t);
    const land = hump(HOP.downTo, HOP.downTo + 0.18, t);
    const settle = hump(HOP.downTo + 0.16, HOP.down, t);
    this.stretch += (0.05 * air - 0.12 * land + 0.025 * settle) * k;
    this.addTurn(J.pelvis, (0.2 * lean + 0.06 * land) * k, 0, 0);
    for (const side of [1, -1]) this.armBy(side, -0.3 * lean * k, 0, (0.5 * air + 0.3 * land) * k, 0.2 * air * k);
  }

  /** Down onto the ground (or a ledge's edge): a little bob, the bottom dropping, the legs swinging out (or over), a bump. */
  private plop(t: number, k: number, edge: boolean): void {
    const J = JOINT;
    const s = Math.max(0, Math.min(1, (t - 0.3) / 0.32));
    if (edge) this.perchBase(s * s * k);
    else this.sitBase(s * s * k);
    const bob = hump(0, 0.3, t);
    const bump = hump(0.6, 0.8, t);
    this.stretch += (-0.05 * bob - 0.12 * bump + 0.03 * hump(0.78, PLOP, t)) * k;
    for (const side of [1, -1]) this.armBy(side, -0.15 * bob * k, 0, 0.35 * bump * k, 0.2 * bump * k);
    this.addTurn(J.head, 0.1 * bump * k, 0, 0);
  }

  /** Sitting in the grass, looking about, swaying now and then. */
  private sit(t: number, k: number, e: number): void {
    const J = JOINT;
    this.sitBase(k);
    this.addTurn(J.pelvis, 0, 0, 0.03 * Math.sin(TAU * 0.3 * t) * e);
  }

  /** Up off the ground (or a ledge's edge): leaning forward onto its hands, pushing up, a little hop onto its feet. */
  private rise(t: number, k: number, edge: boolean): void {
    const J = JOINT;
    const sat = 1 - smoothstep(0.35, 0.85, t);
    if (edge) this.perchBase(sat * k);
    else this.sitBase(sat * k);
    const lean = during(0, 0.35, 0.7, 0.95, t);
    const hop = hump(0.8, 0.98, t);
    const land = hump(0.98, RISE, t);
    this.addTurn(J.pelvis, 0.3 * lean * k, 0, 0);
    this.addShift(J.root, 0, 0.025 * hop * k, 0);
    this.stretch += (0.05 * hop - 0.07 * land) * k;
    for (const side of [1, -1]) this.armBy(side, -0.4 * lean * k, 0, 0.15 * lean * k + 0.2 * land * k, 0);
  }

  /** From sitting, back onto the ground: the arms out, a slow tip back with a little bounce on its back, the eyes drooping shut. */
  private lieBack(t: number, k: number): void {
    const s = smoothstep(0.35, 1.45, t);
    const bounce = 0.06 * hump(1.4, LIE_BACK, t);
    this.lieBase(Math.min(1.04, s + bounce), k);
    this.express(smoothstep(0.6, 1.2, t) * k, { eyes: 0.35 });
    this.express(smoothstep(1.3, 1.8, t) * k, { squint: -1, eyes: 1, smile: 0.4 });
  }

  /** Asleep on its back: big slow breaths (the belly rising), a snore, a stir now and then; tapped (roused s ago), it half wakes, smacks its lips and rolls over a little, and sleeps on. */
  private sleep(t: number, k: number, e: number, roused: number): void {
    const J = JOINT;
    this.lieBase(1, k);
    const { breath } = sleepBeats(t);
    this.addSwell(J.spine, 0.02 * breath * k, 0, 0.07 * breath * k);
    this.addSwell(J.chest, 0.015 * breath * k, 0, 0.05 * breath * k);
    this.addTurn(J.head, 0.03 * breath * k, 0, 0);
    // a stir every so often: rolling a little onto its side, a kick, smacking its lips
    const u = t % 13;
    const stir = hump(8, 10.5, u) * e;
    this.addTurn(J.root, 0, 0, 0.12 * stir);
    this.addTurn(J.legL, -0.35 * hump(8.6, 9.2, u) * e, 0, 0);
    const smack = (hump(9.2, 9.5, u) + hump(9.6, 9.9, u)) * e;
    // roused: an eye opened a crack, a mumble, a roll the other way
    const r = roused >= 0 ? hump(0, ROUSE, roused) : 0;
    this.addTurn(J.root, 0, 0, -0.16 * r * k);
    this.addTurn(J.head, 0, -0.25 * r * k, 0);
    this.express(k, { squint: -1, smile: 0.35 + 0.2 * smack });
    this.express(r * k, { squint: 0, eyes: 0.25, smile: 0.2 });
  }

  /** Woken: eyes open with a start, sitting up, rubbing an eye with a mitten, blinking about. */
  private wake(t: number, k: number): void {
    const J = JOINT;
    this.lieBase(1 - smoothstep(0.25, 1.3, t), k);
    this.stretch += 0.04 * hump(0, 0.25, t) * k;
    const rub = during(1.3, 1.6, 2.7, 3.0, t);
    const r = 0.018;
    const a = TAU * 3 * t;
    this.reachFor(-1, -0.12 + r * Math.cos(a), 0.74 + r * Math.sin(a), 0.27, J.head, rub * k);
    this.addTurn(J.head, 0.1 * rub * k, -0.1 * rub * k, -0.12 * rub * k);
    this.express(k * smoothstep(0, 0.12, t), { eyes: 1, squint: 0 });
    this.express(rub * k, { squint: -1, smile: 0.2 });
  }

  // ---- its pastimes ----

  /** Fishing from the ground (or a ledge's edge, the legs hanging over): the rod in its right mitten, cast, the float watched, a bite yanked, the fish cheered and let go and waved off (or, the one that got away, a little droop). */
  private fish(t: number, k: number, e: number, edge: boolean): void {
    const J = JOINT;
    if (edge) this.perchBase(k);
    else this.sitBase(k);
    const u = ((t % FISH.period) + FISH.period) % FISH.period;
    const { back, throwIt, nibble: nib, yank, fish, cheer, bye, missed, shift } = fishBeats(t);
    // the rod held out before it, up and back for the cast and the yank, dipping to the nibbles
    const lift = 0.14 * back - 0.03 * throwIt + 0.11 * yank - 0.03 * nib;
    const out = -0.12 * back + 0.06 * throwIt - 0.08 * yank + 0.03 * nib;
    this.reachFor(-1, ROD.x, ROD.y + lift, ROD.z + out, J.chest, e);
    // leaning in to the nibbles, back with the yank, bouncing for the catch; drooping for the one that got away
    this.addTurn(J.spine, (0.1 * nib - 0.08 * yank + 0.08 * missed) * e, 0, 0);
    this.addTurn(J.head, 0.14 * missed * e, 0, 0.1 * Math.sin(TAU * 1.2 * u) * missed * e);
    this.addShift(J.root, 0, 0.03 * Math.abs(Math.sin(TAU * 2.2 * (u - shift - FISH.cheer[0]))) * cheer * e, 0);
    // the free mitten flung up for the catch, then waving the fish off
    this.waveArm(1, (0.55 * cheer + 0.75 * bye) * e, Math.sin(TAU * 2.4 * u) * bye);
    this.express(Math.min(1, nib * 2) * e, { eyes: 1, smile: 0.2 });
    this.express(cheer * e, { squint: 1, smile: 1, blush: 0.5 });
    this.express(fish * (1 - cheer) * e, { smile: 0.8 });
    this.express(bye * e, { smile: 0.9, blush: 0.3 });
    this.express(missed * e, { eyes: 0.55, smile: 0 });
  }

  /** Watering the meadow with a can in its right mitten: poured over the plants ahead of it, then a content look at them. */
  private water(t: number, e: number, tipped?: number, content?: number): void {
    const J = JOINT;
    const n = Math.floor(t / GARDEN.period);
    const u = t - n * GARDEN.period;
    // (as its life tips the can and looks, or, given nothing, poured and looked at in turn)
    const tip = tipped ?? gardenBeats(t).tip;
    const glad = content ?? during(GARDEN.glad[0], GARDEN.glad[0] + 0.4, GARDEN.glad[1] - 0.5, GARDEN.glad[1], u);
    // the can held out over the plants, lifted a little as it pours
    this.reachFor(-1, CAN.x, CAN.y + 0.04 * tip, CAN.z + 0.03 * tip, -1, e);
    this.addTurn(J.spine, 0.06 * tip * e, 0, 0);
    this.addTurn(J.chest, 0.04 * tip * e, 0, 0);
    this.addTurn(J.head, (0.06 * tip + 0.04 * glad) * e, 0, 0.06 * glad * e);
    this.express(glad * e, { squint: -1, smile: 0.7 });
  }

  /** Stirring a pot with a ladle in its right mitten, swaying with it; now and then a taste: the ladle to its mouth, blown on, sipped, and a shiver of yum. */
  private stir(t: number, e: number): void {
    const J = JOINT;
    const u = ((t % COOK.period) + COOK.period) % COOK.period;
    const { turn, taste, blow } = cookBeats(t);
    const stirring = 1 - taste;
    const sip = during(COOK.sip[0], COOK.sip[0] + 0.15, COOK.sip[1] - 0.1, COOK.sip[1], u);
    const yum = during(COOK.yum[0], COOK.yum[0] + 0.15, COOK.yum[1] - 0.3, COOK.yum[1], u);
    // the mitten held out over the pot going round (the arm drawn out a little), the ladle's bowl round in the pot
    this.reachFor(-1, STIR.x + STIR.hand * Math.cos(turn), STIR.y, STIR.z + STIR.hand * Math.sin(turn), -1, e * stirring);
    this.lengthen(J.upperArmR, J.foreArmR, STIR.reach * e * stirring);
    // the ladle up to its mouth (its bowl before the mouth, the mitten below and out to the side)
    this.reachFor(-1, TASTE.x, TASTE.y, TASTE.z, J.head, e * taste);
    this.addTurn(J.pelvis, 0, 0.05 * Math.sin(turn) * stirring * e, 0.02 * Math.cos(turn) * stirring * e);
    this.addTurn(J.head, 0.12 * stirring * e, -0.05 * Math.sin(turn) * stirring * e, 0);
    this.addTurn(J.chest, 0.04 * stirring * e, 0, 0);
    // the yum: a wiggle, a pat of the belly, the fur shivering up
    this.addTurn(J.pelvis, 0, 0, 0.06 * Math.sin(TAU * 3 * u) * yum * e);
    this.waveArm(1, 0.3 * yum * e, 0.6 * Math.sin(TAU * 4 * u) * yum);
    if (u > COOK.yum[0]) {
      const f = u - COOK.yum[0];
      this.fluff.set(Math.max(this.fluff.x, -0.15 + 1.35 * smoothstep(0, 0.7, f)), Math.max(this.fluff.y, 0.55 * yum * e), Math.max(this.fluff.z, 0.4 * hump(0, 0.7, f) * e), 0.12);
    }
    this.express(blow * e, { smile: 0 });
    this.express(sip * e, { squint: -1 });
    this.express(yum * e, { squint: 1, smile: 1, blush: 0.9 });
    this.express(stirring * e, { smile: 0.35 });
  }

  /** A mitten dipped into its belly pocket and out again, quickly, with a glance down: for a tool, or to put one away. */
  private pocket(k: number): void {
    const J = JOINT;
    // (the pocket low on the belly's front, a little to the right: as far in as its short arm goes, the mitten half into it)
    this.reachFor(-1, -0.1, 0.31, 0.21, J.spine, k);
    this.addTurn(J.head, 0.07 * k, 0, 0);
  }

  /** The arms hung as the fit hangs them, nothing else moved: a sculpt's roots are measured so (museMesh.ts). */
  hang(): void {
    this.turn.fill(0);
    this.shift.fill(0);
    this.swell.fill(0);
    this.stretch = 0;
    this.reach();
    this.hangArms();
    this.shoulders();
    this.compute();
  }

  /** The left arm at the top of a wave, nothing else moved: the wave's corrective is measured so (museMesh.ts). */
  raiseLeft(): void {
    const J = JOINT;
    const h = this.fit.hang;
    const w = this.fit.wave;
    this.turn.fill(0);
    this.shift.fill(0);
    this.swell.fill(0);
    this.stretch = 0;
    this.reach();
    this.lengthen(J.upperArmL, J.foreArmL, w.reach ?? 0);
    this.hangArms();
    this.addTurn(J.upperArmL, w.x - h.x, w.y, w.z - h.z);
    this.addTurn(J.foreArmL, 0, 0, w.fore - h.fore);
    this.shoulders();
    this.compute();
  }

  private lookPose(yaw: number, pitch: number): void {
    const J = JOINT;
    const y = Math.max(-1.1, Math.min(1.1, yaw));
    const p = Math.max(-0.35, Math.min(0.3, pitch));
    this.addTurn(J.chest, -0.15 * p, 0.3 * y, 0);
    this.addTurn(J.head, -0.85 * p, 0.6 * y, 0);
  }

  // ---- the hands ----

  /**
   * Turn each arm whose mitten is wanted somewhere so that it reaches there:
   * the upper arm's three turns, the elbow's bend and the forearm's twist,
   * found from where the arm is now (hanging, swinging) by damped steps along
   * the reach's slope, preferring small turns. The shoulder's share of the
   * upper arm's turn (shoulders()) is taken into account as it will be.
   * Each arm's wants are blended by their amounts and it goes that far.
   */
  private reachArms(): void {
    for (const side of [1, -1]) {
      let wx = 0;
      let wy = 0;
      let wz = 0;
      let total = 0;
      for (const r of this.reaches) {
        if (r.side !== side) continue;
        const at = this.carried(r.joint, r.x, r.y, r.z, reachAt);
        wx += at.x * r.amount;
        wy += at.y * r.amount;
        wz += at.z * r.amount;
        total += r.amount;
      }
      if (total <= 0) continue;
      target.set(wx / total, wy / total, wz / total);
      const p = this.solveArm(side, target);
      const k = Math.min(1, total);
      this.armBy(side, p[0] * k, p[1] * k, p[2] * k, p[3] * k);
      this.addTurn(side > 0 ? JOINT.foreArmL : JOINT.foreArmR, 0, side * p[4] * k, 0);
    }
  }

  /** A point (H, rest) carried as a joint is posed now (−1: as given, Muse's frame). */
  private carried(joint: number, x: number, y: number, z: number, out: Vector3): Vector3 {
    out.set(x, y, z);
    if (joint < 0) return out;
    this.frameNow(joint, chain);
    return out.applyMatrix4(this.unbind[joint]).applyMatrix4(chain);
  }

  /** A joint's frame from the turns and shifts as they are now (its parents' composed). */
  private frameNow(j: number, out: Matrix4): Matrix4 {
    const path: number[] = [];
    for (let k = j; k >= 0; k = PARENT[k]) path.push(k);
    out.identity();
    for (let i = path.length - 1; i >= 0; i--) {
      const k = path[i];
      out.multiply(this.local(k, this.turn[k * 3], this.turn[k * 3 + 1], this.turn[k * 3 + 2], m2));
    }
    return out;
  }

  /** The arm's turns (upper x, y, z, the elbow's bend, the forearm's twist, from where it is now) that bring its mitten nearest a point. */
  private solveArm(side: number, goal: Vector3): Float64Array {
    const J = JOINT;
    const shoulder = side > 0 ? J.shoulderL : J.shoulderR;
    const upper = side > 0 ? J.upperArmL : J.upperArmR;
    const fore = side > 0 ? J.foreArmL : J.foreArmR;
    const share = this.fit.shoulder ?? 0;
    this.frameNow(PARENT[shoulder], chest);
    const hand = this.hands[side > 0 ? 0 : 1];
    const ux = this.turn[upper * 3];
    const uy = this.turn[upper * 3 + 1];
    const uz = this.turn[upper * 3 + 2];
    const bend = this.turn[fore * 3 + 2] * side;
    const reachOf = (p: ArrayLike<number>, out: Vector3): Vector3 => {
      const tx = ux + p[0];
      const ty = uy + side * p[1];
      const tz = uz + side * p[2];
      arm.copy(chest);
      arm.multiply(this.local(shoulder, this.turn[shoulder * 3] + share * tx, this.turn[shoulder * 3 + 1] + share * ty, this.turn[shoulder * 3 + 2] + share * tz, m2));
      arm.multiply(this.local(upper, (1 - share) * tx, (1 - share) * ty, (1 - share) * tz, m2));
      arm.multiply(this.local(fore, this.turn[fore * 3], this.turn[fore * 3 + 1] + side * p[4], this.turn[fore * 3 + 2] + side * p[3], m2));
      return out.copy(hand).applyMatrix4(arm);
    };
    const p = new Float64Array(5);
    const at = new Vector3();
    const moved = new Vector3();
    const jac = new Float64Array(15);
    const A = new Float64Array(25);
    const b = new Float64Array(5);
    for (let iteration = 0; iteration < 12; iteration++) {
      reachOf(p, at);
      const ex = goal.x - at.x;
      const ey = goal.y - at.y;
      const ez = goal.z - at.z;
      if (ex * ex + ey * ey + ez * ez < 1e-7) break;
      for (let c = 0; c < 5; c++) {
        const keep = p[c];
        p[c] += 1e-3;
        reachOf(p, moved);
        p[c] = keep;
        jac[c] = (moved.x - at.x) / 1e-3;
        jac[5 + c] = (moved.y - at.y) / 1e-3;
        jac[10 + c] = (moved.z - at.z) / 1e-3;
      }
      // (JᵀJ + damping + prior) step = Jᵀe − prior·p
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) A[r * 5 + c] = jac[r] * jac[c] + jac[5 + r] * jac[5 + c] + jac[10 + r] * jac[10 + c];
        A[r * 5 + r] += 2e-3 + PRIOR[r];
        b[r] = jac[r] * ex + jac[5 + r] * ey + jac[10 + r] * ez - PRIOR[r] * p[r];
      }
      solve5(A, b);
      for (let c = 0; c < 5; c++) p[c] += b[c];
      // the elbow bends one way only, and so far
      p[3] = Math.max(-0.5 - bend, Math.min(2.3 - bend, p[3]));
      p[4] = Math.max(-0.45, Math.min(0.45, p[4]));
    }
    return p;
  }

  /** An upper arm's direction in the chest's frame (unit; the right's mirrored into the left's). */
  private armDirection(side: number, out: Vector3): Vector3 {
    const J = JOINT;
    const a = this.frame[side > 0 ? J.upperArmL : J.upperArmR].elements;
    const b = this.frame[side > 0 ? J.foreArmL : J.foreArmR].elements;
    const c = this.frame[J.chest].elements;
    const dx = b[12] - a[12];
    const dy = b[13] - a[13];
    const dz = b[14] - a[14];
    // (the chest's axes are its frame's columns, scaled as the body is stretched)
    const along = (k: number): number => (dx * c[k] + dy * c[k + 1] + dz * c[k + 2]) / (Math.hypot(c[k], c[k + 1], c[k + 2]) || 1);
    return out.set(side * along(0), along(4), along(8)).normalize();
  }

  /** How much of its shoulder's correctives an arm's pose calls for (raised, hung): by how far along the arc it is, given way off it. */
  private correctives(side: number): void {
    const c = this.arc;
    const d = this.armDirection(side, v);
    const off = Math.asin(Math.max(-1, Math.min(1, d.dot(c.normal))));
    const along = Math.atan2(d.dot(c.toward), d.dot(c.hang));
    const on = 1 - smoothstep(0.35, 0.75, Math.abs(off));
    const raised = Math.max(0, Math.min(1, (along - c.made) / (c.wave - c.made))) * on;
    const hung = Math.max(0, Math.min(1, 1 - along / c.made)) * on;
    if (side > 0) {
      this.raised = raised;
      this.hung = hung;
    } else {
      this.raisedRight = raised;
      this.hungRight = hung;
    }
  }

  /** A point given in a joint's own frame (the A-pose's axes, about the joint), as posed (H, Muse's frame). */
  posed(joint: number, x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x, y, z).applyMatrix4(this.frame[joint]);
  }

  /** A joint's frame as posed (H, Muse's frame), and a mitten's (side 1 the left): where a prop is held. */
  frameOf(joint: number, out: Matrix4): Matrix4 {
    return out.copy(this.frame[joint]);
  }

  handFrame(side: number, out: Matrix4): Matrix4 {
    const hand = this.hands[side > 0 ? 0 : 1];
    return out.copy(this.frame[side > 0 ? JOINT.foreArmL : JOINT.foreArmR]).multiply(m2.makeTranslation(hand.x, hand.y, hand.z));
  }

  /** Where each joint is as posed (H, Muse's frame): x, y, z per joint. */
  joints(out = new Float32Array(JOINTS * 3)): Float32Array {
    for (let j = 0; j < JOINTS; j++) {
      const e = this.frame[j].elements;
      out[j * 3] = e[12];
      out[j * 3 + 1] = e[13];
      out[j * 3 + 2] = e[14];
    }
    return out;
  }

  /** A joint's frame from its parent's: shifted from the parent's joint, turned about itself (the root also stretched, the whole body with it). */
  private local(j: number, x: number, y: number, z: number, out: Matrix4): Matrix4 {
    const p = PARENT[j];
    const r = this.fit.rest[j];
    const o = p >= 0 ? this.fit.rest[p] : ORIGIN;
    v.set(r[0] - o[0] + this.shift[j * 3], r[1] - o[1] + this.shift[j * 3 + 1], r[2] - o[2] + this.shift[j * 3 + 2]);
    q.setFromEuler(euler.set(x, y, z, 'YXZ'));
    if (p < 0) {
      const tall = 1 + this.stretch;
      const wide = 1 / Math.sqrt(tall);
      sc.set(wide, tall, wide);
    } else sc.set(1, 1, 1);
    return out.compose(v, q, sc);
  }

  /** Each joint's frame from its parent's, and the skin matrices: posed frame · own swelling · back from rest. */
  private compute(): void {
    for (const j of ORDER) {
      const p = PARENT[j];
      this.local(j, this.turn[j * 3], this.turn[j * 3 + 1], this.turn[j * 3 + 2], m);
      if (p >= 0) this.frame[j].multiplyMatrices(this.frame[p], m);
      else this.frame[j].copy(m);
      const sx = this.swell[j * 3];
      const sy = this.swell[j * 3 + 1];
      const sz = this.swell[j * 3 + 2];
      if (sx !== 0 || sy !== 0 || sz !== 0) this.skin[j].multiplyMatrices(this.frame[j], m.makeScale(1 + sx, 1 + sy, 1 + sz)).multiply(this.unbind[j]);
      else this.skin[j].multiplyMatrices(this.frame[j], this.unbind[j]);
      // as a dual quaternion: the turn, and half the translation times it
      const e = this.skin[j].elements;
      this.skin[j].decompose(v, dq, sc);
      const tx = e[12];
      const ty = e[13];
      const tz = e[14];
      this.dual[j * 2].set(dq.x, dq.y, dq.z, dq.w);
      this.dual[j * 2 + 1].set(
        0.5 * (tx * dq.w + ty * dq.z - tz * dq.y),
        0.5 * (-tx * dq.z + ty * dq.w + tz * dq.x),
        0.5 * (tx * dq.y - ty * dq.x + tz * dq.w),
        -0.5 * (tx * dq.x + ty * dq.y + tz * dq.z),
      );
    }
  }

  /**
   * Skin a mesh on the CPU as muse.vert.glsl does (the joints' matrices
   * blended, or with `dual` their dual quaternions, blended and normalised):
   * the lab's stretch view, and checks.
   */
  deform(position: Float32Array, skinIndex: Uint16Array, skinWeight: Float32Array, out: Float32Array, dual = false): Float32Array {
    if (!dual) {
      for (let i = 0; i < position.length / 3; i++) {
        const px = position[i * 3];
        const py = position[i * 3 + 1];
        const pz = position[i * 3 + 2];
        let x = 0;
        let y = 0;
        let z = 0;
        for (let k = 0; k < 4; k++) {
          const w = skinWeight[i * 4 + k];
          if (w === 0) continue;
          const e = this.skin[skinIndex[i * 4 + k]].elements;
          x += w * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
          y += w * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
          z += w * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
        }
        out[i * 3] = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = z;
      }
      return out;
    }
    const d = this.dual;
    for (let i = 0; i < position.length / 3; i++) {
      const j0 = skinIndex[i * 4];
      const r0 = d[j0 * 2];
      let rx = 0;
      let ry = 0;
      let rz = 0;
      let rw = 0;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let dw = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[i * 4 + k];
        if (w === 0) continue;
        const j = skinIndex[i * 4 + k];
        const r = d[j * 2];
        const t = d[j * 2 + 1];
        const s = r.x * r0.x + r.y * r0.y + r.z * r0.z + r.w * r0.w < 0 ? -w : w;
        rx += r.x * s;
        ry += r.y * s;
        rz += r.z * s;
        rw += r.w * s;
        dx += t.x * s;
        dy += t.y * s;
        dz += t.z * s;
        dw += t.w * s;
      }
      const l = Math.hypot(rx, ry, rz, rw) || 1;
      rx /= l;
      ry /= l;
      rz /= l;
      rw /= l;
      dx /= l;
      dy /= l;
      dz /= l;
      dw /= l;
      const px = position[i * 3];
      const py = position[i * 3 + 1];
      const pz = position[i * 3 + 2];
      // p + 2 r × (r × p + w p) + 2 (w d − dw r + r × d)
      const cx = ry * pz - rz * py + rw * px;
      const cy = rz * px - rx * pz + rw * py;
      const cz = rx * py - ry * px + rw * pz;
      out[i * 3] = px + 2 * (ry * cz - rz * cy) + 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
      out[i * 3 + 1] = py + 2 * (rz * cx - rx * cz) + 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
      out[i * 3 + 2] = pz + 2 * (rx * cy - ry * cx) + 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
    }
    return out;
  }
}
const dq = new Quaternion();
const ORIGIN = [0, 0, 0] as const;
const target = new Vector3();
const reachAt = new Vector3();
const chain = new Matrix4();
const chest = new Matrix4();
const arm = new Matrix4();
/** The reach's preference for small turns (per turn: the upper arm's x, y, z, the elbow, the forearm's twist; H² per rad²). */
const PRIOR = [0.002, 0.004, 0.002, 0.001, 0.03] as const;

/** Solve a 5 × 5 system in place (A row by row; the answer left in b), by elimination with partial pivoting. */
function solve5(A: Float64Array, b: Float64Array): void {
  const n = 5;
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[best * n + c])) best = r;
    if (best !== c) {
      for (let k = 0; k < n; k++) {
        const t = A[c * n + k];
        A[c * n + k] = A[best * n + k];
        A[best * n + k] = t;
      }
      const t = b[c];
      b[c] = b[best];
      b[best] = t;
    }
    const pivot = A[c * n + c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / pivot;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * b[k];
    b[r] = s / (A[r * n + r] || 1e-12);
  }
}

/** The eyes' openness at a time: a blink every few seconds (now and then two), closed-form. */
export function blink(time: number): number {
  const period = 3.7;
  const k = Math.floor(time / period);
  const h = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  const at = k * period + 0.4 + r * (period - 1.2);
  const one = (dt: number): number => (dt < 0 || dt > 0.18 ? 0 : Math.sin((Math.PI * dt) / 0.18));
  let shut = one(time - at);
  if (r > 0.72) shut = Math.max(shut, one(time - at - 0.3));
  return 1 - shut;
}
