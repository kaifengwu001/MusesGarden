import { Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { rampIntegral, withTool } from '../life/museLife';
import { BOUNCE_LENGTH, COOK, FISH, FLUFF, FLUFF_LENGTH, HOP, IDEA_LENGTH, LIE_BACK, LOVE_LENGTH, PET, PLOP, POCKET, RISE, STEP, WAKE, WAVE_LENGTH, YAWN_LENGTH, hopArc, perchBeats, type Move, type MoveKind } from '../life/museRig';
import { angleBetween, tangentToward } from '../planet/geo';
import type { ActedLife } from '../visit/world';
import { ACTION, type Posture } from './library';
import type { Path, Route } from './route';
import type { Actor, Beat, DirectorScene, Mark, Vec3 } from './scene';

// A take (director.ts): a scene written out as each Muse's segments in time, as Muse's own life writes its day
// (museRoam.ts): a wait for its cue, getting up from where it sits or lies, its can put away, a walk along its route
// (turning into it first if it faces well away, coming round to its mark's facing as it arrives, or turning on the spot
// after), sitting down, hopping up, the action itself, held as long as asked. Then played at any moment as a pure
// function of the take's time (no state carried from frame to frame), so the take can be paused, scrubbed and played
// again exactly; variety (a pour's length, a catch's luck) comes from each beat's seed, drawn as the take is written.

/** Muse's walking pace (× its height, m/s), the share of a walk spent speeding up and slowing down, its turns on the spot, and how far it eases its heading round at a walk's ends (m): museRoam.ts PACE, RAMP, TURN, PATH. */
const PACE = 0.33;
const RAMP = 0.12;
const TURN = { time: 0.35, half: 0.8, least: 0.12 } as const;
const PATH = { ease: 1.1, swing: 0.9 } as const;
/** A pastime's motions eased in and out over this long (s): museRoam.ts play. */
const EASE = 0.7;
/** The gap after each wave, bounce, fluff or yawn before the next (s). */
const GAP = { wave: 0.35, bounce: 0.25, fluff: 0.3, yawn: 0.3, idea: 0.3, love: 0.3 } as const;
/** The gestures done so many times on the spot: each one's length (s). */
const GESTURE = { bounce: BOUNCE_LENGTH, fluff: FLUFF_LENGTH, yawn: YAWN_LENGTH, idea: IDEA_LENGTH, love: LOVE_LENGTH } as const;
/** How long a petting takes to let go of (s): back from the hand, and its fur shaken out. */
const LET_GO = PET.out + FLUFF.shake + FLUFF.settle;
/** Nearer than this (m), a mark is where it already is: no walk. */
const HERE = 0.05;

/** A bench or a stove as a take uses it: where a Muse stands to use it and the way it faces; the bench's seat (where it sits, and how high), the stove's pot (planet space, m). */
export interface PieceSpot {
  readonly stand: Vector3;
  readonly facing: Vector3;
  readonly seat?: Vector3;
  readonly seatHeight?: number;
  readonly pot?: Vector3;
}

/** What writing a take reads of the world. */
export interface TakeWorld {
  /** The planet's radius, and the Muses' height (m). */
  readonly R: number;
  readonly H: number;
  /** The ground's height over R at a place (m). */
  ground(dir: Vector3): number;
  /** The way from one place to another (cached by the caller). */
  route(from: Vector3, to: Vector3): Route;
  /** A placed bench or stove, by id. */
  piece(id: string): PieceSpot | null;
  /** The camera (planet space) as the take is written: facing it. */
  readonly camera: Vector3;
}

/** When a beat set off, arrived at its mark (began what it does there), and ended (s into the take). */
export interface BeatTimes {
  readonly starts: number;
  readonly arrives: number;
  readonly ends: number;
}

type SegmentKind = 'wait' | 'walk' | 'turn' | 'into' | 'do' | 'out' | 'rest';

/** A stretch of a Muse's take: what it is, for which beat, from when and how long (s), its gait at its start and how far it runs (cycles of two steps), and how it plays s seconds in. */
interface Segment {
  readonly kind: SegmentKind;
  readonly label: string;
  readonly beat: string | null;
  start: number;
  length: number;
  gait: number;
  readonly steps: number;
  play(s: number, out: ActedLife, seg: Segment): void;
}

/** A block on the timeline: a beat's part (its walk, getting there; what it does). */
export interface Block {
  readonly beat: string | null;
  readonly kind: SegmentKind;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/** One Muse's part in the take. */
export interface ActorTake {
  readonly id: string;
  readonly segments: readonly Segment[];
  readonly beats: ReadonlyMap<string, BeatTimes>;
  /** Its routes, by beat, and whether each found its way round. */
  readonly routes: readonly { readonly beat: string; readonly path: Path; readonly blocked: boolean }[];
  /** Beats it couldn't do as asked (no such bench or stove), with why. */
  readonly problems: ReadonlyMap<string, string>;
  /** When its last beat ends (s). */
  readonly end: number;
}

const v = (a: Vec3): Vector3 => new Vector3(a[0], a[1], a[2]);
const scratch = new Vector3();
const scratch2 = new Vector3();
const facingTmp = new Vector3();
const lookTmp = new Vector3();

/** A tangent turned about the up by an angle (rad): museRoam.ts turned. */
function turned(t: Vector3, up: Vector3, angle: number, out: Vector3): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.crossVectors(up, t).multiplyScalar(s).addScaledVector(t, c);
  return out.normalize();
}

/** The signed angle from one tangent to another about the up (rad). */
function between(a: Vector3, b: Vector3, up: Vector3): number {
  return Math.atan2(scratch.crossVectors(a, b).dot(up), a.dot(b));
}

/** A tangent at `at` as near a facing (any vector) as can be. */
function tangent(at: Vector3, f: Vector3): Vector3 {
  return tangentToward(at, scratch2.copy(at).add(f), new Vector3());
}

/** A small seeded random source (mulberry32), as museRoam.ts's. */
function random(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moves that leave Muse seated (its eyes lower: museRoam.ts look). */
const SEATED: ReadonlySet<MoveKind> = new Set(['perch', 'fish', 'sit', 'plop']);

/** Writes one Muse's segments, beat by beat, keeping where the last left it. */
class Writer {
  readonly segments: Segment[] = [];
  readonly beats = new Map<string, BeatTimes>();
  readonly routes: { beat: string; path: Path; blocked: boolean }[] = [];
  readonly problems = new Map<string, string>();
  time = 0;
  gait = 0;
  here: Vector3;
  facing: Vector3;
  posture: Posture = 'stand';
  /** Holding its can out (watering, and between waterings). */
  can = false;
  /** Up on a bench: where it hops down to, from where, and how high the seat is. */
  seat: { front: Vector3; seat: Vector3; height: number } | null = null;
  /** The beat being written (its segments are its). */
  private beat: string | null = null;

  constructor(
    private readonly world: TakeWorld,
    start: Mark,
  ) {
    this.here = v(start.dir).normalize();
    this.facing = tangent(this.here, v(start.facing));
  }

  private get H(): number {
    return this.world.H;
  }

  private push(kind: SegmentKind, label: string, length: number, steps: number, play: Segment['play']): Segment {
    const segment: Segment = { kind, label, beat: this.beat, start: this.time, length, gait: this.gait, steps, play };
    this.segments.push(segment);
    this.time += length;
    this.gait += steps;
    return segment;
  }

  /** Stand where it is, facing as it does, with something more. */
  private stand(kind: SegmentKind, label: string, length: number, extra?: (s: number, out: ActedLife, seg: Segment) => void): Segment {
    const at = this.here.clone();
    const f = this.facing.clone();
    return this.push(kind, label, length, 0, (s, out, seg) => {
      out.dir.copy(at);
      out.height = 0;
      out.heading.copy(f);
      if (this.holdingCan(seg)) holdingCan(s, out);
      extra?.(s, out, seg);
    });
  }

  /** Whether its can is out over a segment (set as it is written: the can's state then). */
  private readonly canned = new WeakSet<Segment>();
  private holdingCan(seg: Segment): boolean {
    return this.canned.has(seg);
  }
  private mark(seg: Segment): Segment {
    if (this.can) this.canned.add(seg);
    return seg;
  }

  /** A move played where it is (its posture's own placement by `place`), eased in and out, with something more. */
  private play(kind: SegmentKind, label: string, move: MoveKind, length: number, extra?: (s: number, out: ActedLife, m: Move, seg: Segment) => void, place?: (s: number, out: ActedLife) => void): Segment {
    const at = this.here.clone();
    const f = this.facing.clone();
    return this.push(kind, label, length, 0, (s, out, seg) => {
      out.dir.copy(at);
      out.height = 0;
      out.heading.copy(f);
      place?.(s, out);
      const m: Move = { kind: move, time: s, amount: 1, ease: smoothstep(0, EASE, s) * smoothstep(0, EASE, seg.length - s) };
      out.action.moves.push(m);
      extra?.(s, out, m, seg);
    });
  }

  /** Step round on the spot to face as asked: quicker for a small turn than a half turn, none for a slight one (museRoam.ts turn). */
  turn(to: Vector3, label = 'turn'): void {
    const at = this.here.clone();
    const from = this.facing.clone();
    const want = tangent(at, to);
    const angle = between(from, want, at);
    this.facing = want;
    if (Math.abs(angle) < TURN.least) return;
    const half = Math.abs(angle) / Math.PI;
    const time = TURN.time + TURN.half * half;
    const steps = 0.3 + 0.9 * half;
    this.mark(
      this.push('turn', label, time, steps, (s, out, seg) => {
        const u = s / time;
        out.dir.copy(at);
        out.height = 0;
        turned(from, at, angle * smoothstep(0, 1, u), out.heading);
        out.action.walk = 0.55 * Math.sin(Math.PI * u) * Math.min(1, Math.abs(angle) / 1.0);
        out.action.stride = 0;
        out.action.gait = seg.gait + steps * u;
        if (this.holdingCan(seg)) holdingCan(s, out);
      }),
    );
  }

  /** Walk a path, speeding up and slowing down at its ends, its heading the path's way, eased round from `from` and into `end` (museRoam.ts walkPath). */
  private walk(path: Path, from: Vector3 | null, end: Vector3 | null): void {
    const length = path.length;
    if (length < HERE) return;
    const H = this.H;
    const R = this.world.R;
    const time = length / (PACE * H * (1 - RAMP));
    const steps = length / (2 * STEP.length * H);
    const startFacing = from?.clone() ?? null;
    const endFacing = end?.clone() ?? null;
    const along = (s: number): number => ((rampIntegral(s / time, 0, RAMP) - rampIntegral(s / time, 1 - RAMP, 1)) / (1 - RAMP)) * length;
    const paceAt = (s: number): number => smoothstep(0, RAMP, s / time) - smoothstep(1 - RAMP, 1, s / time);
    const ahead = new Vector3();
    const world = this.world;
    this.mark(
      this.push('walk', 'walk', time, steps, (s, out, seg) => {
        const d = along(s);
        path.point(d, out.dir);
        out.height = 0;
        path.heading(d, out.heading);
        if (startFacing) {
          const was = tangentToward(out.dir, scratch.copy(out.dir).add(startFacing), facingTmp);
          turned(was.clone(), out.dir, between(was, out.heading, out.dir) * smoothstep(0, PATH.ease, d), out.heading);
        }
        if (endFacing) {
          const will = tangentToward(out.dir, scratch.copy(out.dir).add(endFacing), facingTmp);
          turned(out.heading.clone(), out.dir, between(out.heading, will, out.dir) * smoothstep(length - PATH.ease, length, d), out.heading);
        }
        out.action.walk = smoothstep(0, 0.35, paceAt(s));
        out.action.gait = seg.gait + steps * (d / length);
        // looking a little ahead along the way
        path.point(Math.min(length, d + 2.5), ahead);
        out.lookAt = lookTmp.copy(ahead).multiplyScalar(R + world.ground(ahead) + 0.6 * H);
        if (this.holdingCan(seg)) holdingCan(s, out);
      }),
    );
    this.here = path.points[path.points.length - 1].clone();
    this.facing = endFacing ? tangent(this.here, endFacing) : path.heading(length, new Vector3());
  }

  /** Go to a place, facing as asked there: turning into the way first if it faces well away from it, coming round to the facing as it arrives (or on the spot after, for a big turn): museRoam.ts go. */
  private go(to: Vector3, facing: Vector3, beat: string): void {
    if (angleBetween(this.here, to) * this.world.R < HERE) {
      this.turn(facing);
      return;
    }
    const route = this.world.route(this.here, to);
    const path = route.path;
    this.routes.push({ beat, path, blocked: route.blocked });
    const set = path.heading(0, new Vector3());
    const off = Math.abs(between(this.facing, set, this.here));
    if (off > PATH.swing) this.turn(set, 'turn');
    const there = path.points[path.points.length - 1];
    const arrive = path.heading(path.length, new Vector3());
    const want = tangent(there, facing);
    const end = Math.abs(between(arrive, want, there)) <= PATH.swing;
    this.walk(path, off > PATH.swing ? null : this.facing, end ? want : null);
    if (!end) this.turn(want);
  }

  /** Wait where it is until a time: still sitting, lying or perched (what it is doing there drawn out), or standing about. */
  private waitUntil(t: number): void {
    const wait = t - this.time;
    if (wait <= 1e-6) return;
    const last = this.segments[this.segments.length - 1];
    if (this.posture !== 'stand' && last && last.kind === 'do') {
      last.length += wait;
      this.time += wait;
      return;
    }
    this.mark(this.stand('wait', 'wait', wait));
  }

  /**
   * Come out of what it is in as far as the next thing wants: awake from a nap (still sat up, for sitting or fishing
   * on), up from the grass (unless it is to lie back from there), down off its bench. What it does next sits it down,
   * lies it back or hops it up itself.
   */
  private getUp(to: Posture): void {
    const H = this.H;
    if (this.posture === to) return;
    if (this.posture === 'lie') {
      // waking: sitting up, rubbing its eyes, its snore bubble popping (museRoam.ts wake)
      const slept = this.lastLength('do');
      this.play('out', 'wake', 'wake', WAKE, (s, out) => {
        if (s < 0.4) out.cues.sleep = { time: slept + s, roused: s };
      });
      this.posture = 'sit';
      if (to === 'sit') return;
    }
    if (this.posture === 'sit') {
      if (to === 'sit' || to === 'lie') return;
      this.play('out', 'get up', 'rise', RISE);
      this.posture = 'stand';
    }
    if (this.posture === 'perch' && this.seat) {
      const { front, seat, height } = this.seat;
      const f = this.facing.clone();
      this.push('out', 'hop down', HOP.down, 0, (s, out) => {
        const { along, rise, over } = hopArc(s, false);
        out.dir.copy(seat).lerp(front, along).normalize();
        out.height = height * rise + over * H;
        out.heading.copy(f);
        out.action.moves.push({ kind: 'hopDown', time: s, amount: 1 });
      });
      this.here = front.clone();
      this.posture = 'stand';
      this.seat = null;
    }
  }

  private lastLength(kind: SegmentKind): number {
    for (let i = this.segments.length - 1; i >= 0; i--) if (this.segments[i].kind === kind) return this.segments[i].length;
    return 0;
  }

  /** The can out of its pocket, or put back (museRoam.ts can). */
  private canOut(away: boolean): void {
    this.can = false;
    this.stand(away ? 'out' : 'into', away ? 'can away' : 'can out', POCKET.time, (s, out) => {
      const t = away ? POCKET.time - s : s;
      const pocket = smoothstep(0, POCKET.in, t) * (1 - smoothstep(POCKET.out, POCKET.time, t));
      out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: smoothstep(POCKET.out, POCKET.time, t), tip: 0, glad: 0 });
      if (pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: pocket });
      out.cues.water = { time: s, grip: smoothstep(POCKET.out - 0.05, POCKET.out + 0.1, t), tip: 0, pour: 0 };
      out.lookAt = null;
    });
    this.can = !away;
  }

  /** One beat: its cue waited for, got up if it must, gone to its mark, then done. */
  write(beat: Beat, cueAt: number, toward: (beat: Beat, at: number) => Vector3 | null): void {
    const def = ACTION[beat.action];
    this.beat = beat.id;
    const world = this.world;
    // where it does it, and the way it faces there
    let piece: PieceSpot | null = null;
    if (def.piece) {
      piece = beat.piece ? world.piece(beat.piece) : null;
      if (!piece) this.problems.set(beat.id, `No ${def.piece} placed for it: place one and pick it`);
    }
    const target = piece ? piece.stand.clone() : beat.mark ? v(beat.mark.dir).normalize() : this.here.clone();
    let want: Vector3;
    if (piece) want = piece.facing.clone();
    else if (beat.facing.kind === 'camera') want = tangentToward(target, world.camera, new Vector3());
    else if (beat.facing.kind === 'actor') {
      const other = toward(beat, Math.max(this.time, cueAt));
      want = other && angleBetween(other, target) > 1e-6 ? tangentToward(target, other, new Vector3()) : beat.mark ? v(beat.mark.facing) : this.facing.clone();
    } else want = beat.mark ? v(beat.mark.facing) : this.facing.clone();
    want = tangent(target, want);
    // its cue
    this.waitUntil(cueAt);
    const starts = this.time;
    // (up on this very bench already: it stays up there)
    const onIt = this.posture === 'perch' && !!piece?.seat && !!this.seat && angleBetween(piece.seat, this.seat.seat) * world.R < HERE;
    const moving = !onIt && angleBetween(this.here, target) * world.R >= HERE;
    // up (or awake, or down off its bench) as far as it must be to walk there or do it, and the can away unless it waters next
    this.getUp(moving ? 'stand' : def.posture);
    if (this.can && def.id !== 'water') this.canOut(true);
    if (moving) this.go(target, want, beat.id);
    else if (this.posture === 'stand') this.turn(want);
    const arrives = this.time;
    this.act(beat, piece);
    this.beats.set(beat.id, { starts, arrives, ends: this.time });
    this.beat = null;
  }

  /** What the beat does where it now is. */
  private act(beat: Beat, piece: PieceSpot | null): void {
    const def = ACTION[beat.action];
    const H = this.H;
    const R = this.world.R;
    const world = this.world;
    const rand = random(beat.seed * 7919 + 17);
    const n = Math.max(1, Math.round(beat.amount));
    const seconds = Math.max(0.1, beat.amount);
    switch (def.id) {
      case 'stand':
        this.mark(this.stand('do', 'stand', seconds));
        return;
      case 'wave': {
        const each = WAVE_LENGTH + GAP.wave;
        this.mark(
          this.stand('do', n > 1 ? `wave ×${n}` : 'wave', n * each - GAP.wave, (s, out) => {
            const u = s % each;
            out.action.wave = u < WAVE_LENGTH ? u : -1;
            // (waving to whatever it faces)
            out.lookAt = lookTmp.copy(out.dir).multiplyScalar(R + world.ground(out.dir) + 0.75 * H).addScaledVector(out.heading, 3);
          }),
        );
        return;
      }
      case 'bounce':
      case 'fluff':
      case 'yawn':
      case 'idea':
      case 'love': {
        const length = GESTURE[def.id];
        const gap = GAP[def.id];
        const each = length + gap;
        const kind: MoveKind = def.id;
        // (adoring tilts its head to one side or the other, as the beat's seed has it)
        const side = kind === 'love' && rand() < 0.5 ? -1 : 1;
        this.mark(
          this.stand('do', n > 1 ? `${def.label.toLowerCase()} ×${n}` : def.label.toLowerCase(), n * each - gap, (s, out) => {
            const u = s % each;
            if (u < length) out.action.moves.push({ kind, time: u, amount: 1, side });
            if (kind === 'yawn') out.lookAt = null;
          }),
        );
        return;
      }
      case 'petted': {
        const side = rand() < 0.5 ? -1 : 1;
        this.mark(
          this.stand('do', 'petted', seconds + LET_GO, (s, out) => {
            const release = s > seconds ? s - seconds : -1;
            out.action.moves.push({ kind: 'pet', time: s, amount: 1, side, release });
            out.cues.petted = s;
          }),
        );
        return;
      }
      case 'sit': {
        if (this.posture === 'stand') this.play('into', 'sit down', 'plop', PLOP);
        this.posture = 'sit';
        this.play('do', 'sit', 'sit', seconds, (_s, out) => (out.lookAt = null));
        return;
      }
      case 'nap': {
        if (this.posture === 'stand') this.play('into', 'sit down', 'plop', PLOP);
        if (this.posture !== 'lie') this.play('into', 'lie back', 'lieBack', LIE_BACK);
        this.posture = 'lie';
        this.play('do', 'nap', 'sleep', seconds, (s, out, m) => {
          m.roused = -1;
          out.cues.sleep = { time: s, roused: -1 };
        });
        return;
      }
      case 'water': {
        if (!this.can) this.canOut(false);
        // poured here and there, now long, now short, now swept over the plants, a content look now and then; between, the can held a moment
        for (let k = 0; k < n; k++) {
          this.pour(2.4 + 3 * rand(), 0.7 + 0.3 * rand(), rand() < 0.5, rand() < 0.4);
          if (k < n - 1) this.mark(this.stand('do', 'can held', 0.5 + 0.8 * rand()));
        }
        return;
      }
      case 'fish': {
        if (this.posture === 'stand') this.play('into', 'sit down', 'plop', PLOP);
        this.posture = 'sit';
        const total = n * FISH.period + 2 * POCKET.time;
        this.play('do', n > 1 ? `fish ×${n}` : 'fish', 'fish', total, (s, out, m, seg) => {
          const tool = withTool(s, seg.length);
          m.time = tool.time;
          m.ease = tool.ease;
          m.edge = false;
          if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
          // looking at the float on the water before it
          out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(out.dir).multiplyScalar(R + world.ground(out.dir)).addScaledVector(out.heading, 1.25 * H);
          out.cues.fish = { time: tool.time, grip: tool.grip, edge: false };
        });
        return;
      }
      case 'cook': {
        const pot = piece?.pot?.clone() ?? null;
        const total = n * COOK.period + 2 * POCKET.time;
        if (!pot) {
          this.mark(this.stand('do', 'cook (no stove)', total));
          return;
        }
        const at = this.here.clone();
        const f = this.facing.clone();
        this.push('do', n > 1 ? `cook ×${n}` : 'cook', total, 0, (s, out, seg) => {
          out.dir.copy(at);
          out.height = 0;
          out.heading.copy(f);
          const tool = withTool(s, seg.length);
          out.action.moves.push({ kind: 'stir', time: tool.time, amount: 1, ease: tool.ease });
          if (tool.pocket > 0) out.action.moves.push({ kind: 'pocket', time: s, amount: tool.pocket });
          out.lookAt = tool.pocket > 0.5 ? null : lookTmp.copy(pot);
          out.cues.cook = { time: tool.time, grip: tool.grip, pot };
        });
        return;
      }
      case 'perch': {
        if (!piece?.seat || piece.seatHeight === undefined) {
          this.mark(this.stand('do', 'perch (no bench)', seconds));
          return;
        }
        const seat = piece.seat.clone();
        const height = piece.seatHeight;
        if (this.posture !== 'perch') {
          const front = this.here.clone();
          const f = this.facing.clone();
          this.push('into', 'hop up', HOP.up, 0, (s, out) => {
            const { along, rise, over } = hopArc(s, true);
            out.dir.copy(front).lerp(seat, along).normalize();
            out.height = height * rise + over * H;
            out.heading.copy(f);
            out.action.moves.push({ kind: 'hopUp', time: s, amount: 1 });
          });
          this.seat = { front, seat, height };
          this.here = seat.clone();
          this.posture = 'perch';
        }
        this.play(
          'do',
          'perch',
          'perch',
          seconds,
          (s, out) => {
            out.lookAt = null;
            out.cues.hum = perchBeats(s).hum;
          },
          (_s, out) => (out.height = height),
        );
        return;
      }
    }
  }

  /** A pour: the can tipped (as far as `tip`) and held a while, swept a little over the plants or not, righted; then a content look, or not (museRoam.ts pour). */
  private pour(time: number, tip: number, sweep: boolean, glad: boolean): void {
    const at = this.here.clone();
    const f = this.facing.clone();
    const H = this.H;
    const R = this.world.R;
    const world = this.world;
    const look = glad ? 1.8 : 0;
    this.push('do', 'pour', time + look, 0, (s, out) => {
      out.dir.copy(at);
      out.height = 0;
      const sway = sweep ? 0.22 * Math.sin((2 * Math.PI * s) / time) * smoothstep(0.3, 1, s) * smoothstep(0.3, 1, time - s) : 0;
      turned(f, at, s < time ? sway : 0, out.heading);
      const tipped = tip * smoothstep(0, 0.6, s) * smoothstep(0, 0.5, time - s);
      const content = glad ? smoothstep(time, time + 0.4, s) * smoothstep(0, 0.5, time + look - s) : 0;
      out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: 1, tip: tipped, glad: content });
      out.cues.water = { time: s, grip: 1, tip: tipped, pour: smoothstep(0.4, 0.7, tipped) };
      out.lookAt = lookTmp.copy(out.dir).multiplyScalar(R + world.ground(out.dir)).addScaledVector(out.heading, 0.6 * H);
    });
  }

  /** After its last beat: on as it is, for good (still sitting, lying, perched, or standing about). */
  finish(): number {
    const end = this.time;
    const last = this.segments[this.segments.length - 1];
    if (this.posture !== 'stand' && last && last.kind === 'do') last.length = Infinity;
    else this.mark(this.stand('rest', 'rest', Infinity));
    return end;
  }
}

/** Holding its can as it goes (walking, turning, standing between pours): museRoam.ts holdingCan. */
function holdingCan(s: number, out: ActedLife): void {
  out.action.moves.push({ kind: 'water', time: s, amount: 1, ease: 1, tip: 0, glad: 0 });
  out.cues.water = { time: s, grip: 1, tip: 0, pour: 0 };
}

/** A whole take: each Muse's part, and how long it runs (s: until the last beat ends). */
export class Take {
  private constructor(
    readonly actors: ReadonlyMap<string, ActorTake>,
    readonly length: number,
    /** Whether the cues came to rest (no cue waits, in a ring, on itself). */
    readonly settled: boolean,
  ) {}

  /**
   * Write a scene's take. A cue on another Muse's beat waits on that Muse's take, which may itself wait on others:
   * written over until no beat's times move (at most a few times; a ring of cues is left as it then stands).
   */
  static write(scene: DirectorScene, world: TakeWorld): Take {
    let events = new Map<string, BeatTimes>();
    let actors = new Map<string, ActorTake>();
    let settled = false;
    for (let pass = 0; pass < 8; pass++) {
      const next = new Map<string, ActorTake>();
      const nextEvents = new Map<string, BeatTimes>();
      for (const actor of scene.actors) {
        const take = writeActor(actor, world, events, (other, at) => {
          const a = actors.get(other);
          if (a) return placeAt(a, at);
          const o = scene.actors.find((x) => x.id === other);
          return o ? v(o.start.dir).normalize() : null;
        });
        next.set(actor.id, take);
        for (const [id, t] of take.beats) nextEvents.set(id, t);
      }
      const same = [...nextEvents].every(([id, t]) => {
        const was = events.get(id);
        return was && Math.abs(was.starts - t.starts) < 1e-6 && Math.abs(was.arrives - t.arrives) < 1e-6 && Math.abs(was.ends - t.ends) < 1e-6;
      });
      actors = next;
      events = nextEvents;
      if (same) {
        settled = true;
        break;
      }
    }
    const length = Math.max(0, ...[...actors.values()].map((a) => a.end));
    return new Take(actors, length, settled);
  }

  /** When a beat sets off, arrives and ends, if it is in the take. */
  times(beat: string): BeatTimes | null {
    for (const a of this.actors.values()) {
      const t = a.beats.get(beat);
      if (t) return t;
    }
    return null;
  }

  /** A Muse's blocks for the timeline: its segments, each walk and turn kept with the beat it is for. */
  blocks(actor: string): Block[] {
    const a = this.actors.get(actor);
    if (!a) return [];
    return a.segments.map((s) => ({ beat: s.beat, kind: s.kind, label: s.label, start: s.start, end: s.start + s.length }));
  }
}

/** Where a Muse's take has it at a time (a unit direction). */
function placeAt(take: ActorTake, t: number): Vector3 {
  const out = scratchLife();
  play(take, t, 0, out);
  return out.dir.clone();
}

let scratchOut: ActedLife | null = null;
function scratchLife(): ActedLife {
  scratchOut ??= newLife();
  return scratchOut;
}

/** A Muse's part: its beats in order, each from its cue (a time, another's beat as the last writing of the take had it). */
function writeActor(actor: Actor, world: TakeWorld, events: ReadonlyMap<string, BeatTimes>, where: (actor: string, at: number) => Vector3 | null): ActorTake {
  const w = new Writer(world, actor.start);
  for (const beat of actor.beats) {
    const cue = beat.cue;
    let at = 0;
    if (cue.kind === 'at') at = cue.time;
    else if (cue.kind === 'event' && cue.actor !== actor.id) {
      const t = events.get(cue.beat);
      if (t) at = t[cue.when];
    }
    w.write(beat, at, (b, time) => (b.facing.kind === 'actor' ? where(b.facing.actor, time) : null));
  }
  const end = w.finish();
  return { id: actor.id, segments: w.segments, beats: w.beats, routes: w.routes, problems: w.problems, end };
}

/** A fresh life to play into (one per Muse, reused frame to frame). */
export function newLife(): ActedLife {
  return {
    dir: new Vector3(0, 1, 0),
    height: 0,
    heading: new Vector3(1, 0, 0),
    action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 1, moves: [] },
    lookAt: null,
    cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
    home: false,
  };
}

/** A Muse's take played at a time t (s into it; world time `now`, for its idle motions): into `out`. Returns the segment's beat. */
export function play(take: ActorTake, t: number, now: number, out: ActedLife): Segment | null {
  const a = out.action;
  a.time = now;
  a.walk = 0;
  a.stride = 1;
  a.wave = -1;
  a.look = 1;
  a.moves.length = 0;
  out.lookAt = null;
  out.height = 0;
  const c = out.cues;
  c.water = c.fish = c.cook = c.sleep = null;
  c.hum = 0;
  c.petted = -1;
  out.home = false;
  const segs = take.segments;
  if (segs.length === 0) return null;
  const u = Math.max(0, t);
  // (the segment under way: the last one starting at or before u)
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= u) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  const s = Math.min(u - seg.start, seg.length);
  a.gait = seg.gait;
  seg.play(s, out, seg);
  return seg;
}

/** Whether a life sits (its eyes lower), and whether it shouldn't turn its head (yawning, lying back, asleep). */
export function seated(life: ActedLife): boolean {
  return life.action.moves.some((m) => SEATED.has(m.kind));
}

/**
 * Where its head turns: toward what it looks at (planet space; null, its own way about), from its eyes, as museRoam.ts
 * look; its gaze held on a point instead where the beat asks. `ground`: the ground's height under it (m over R).
 */
export function aim(life: ActedLife, look: Vector3 | null, R: number, H: number, ground: number): void {
  const a = life.action;
  const now = a.time;
  const idleYaw = 0.32 * Math.sin(0.47 * now + 1) + 0.14 * Math.sin(1.27 * now);
  const idlePitch = -0.04 + 0.06 * Math.sin(0.37 * now + 2);
  if (look) {
    const eye = scratch.copy(life.dir).multiplyScalar(R + ground + life.height + (seated(life) ? 0.62 : 0.77) * H);
    const d = scratch2.subVectors(look, eye);
    const up = life.dir;
    const ahead = d.dot(life.heading);
    const left = d.dot(facingTmp.crossVectors(up, life.heading));
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
  if (life.cues.sleep || a.moves.some((m) => m.kind === 'lieBack' || m.kind === 'wake' || m.kind === 'yawn')) a.look = 0;
}
