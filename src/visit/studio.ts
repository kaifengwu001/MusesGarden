import GUI, { type Controller } from 'lil-gui';
import { Vector3 } from 'three';
import castFile from '../../server/fixtures/cast.json?raw';
import type { FrameClock } from '../core/clock';
import { parseHash } from '../core/hashSync';
import { FLUFF_LENGTH, WAKE, YAWN_LENGTH, type Expression, type HeldLook, type Move } from '../life/museRig';
import type { MuseLook, PlanetId } from '../muse/contract';
import { isLook } from '../muse/looks';
import { Flight, type Framing } from '../view/flight';
import { FOLLOW, Follower } from './follow';
import { headOf, homeFraming, hostFraming, musesFraming, selfieFraming } from './framing';
import './studio.css';
import type { VisitStore } from './visitUi';
import type { VisitBody, VisitDirection, VisitWorld } from './world';

// The photo studio: `?studio` on a world's page (or `/?studio` on the meadow) draws the planet as a visit to it has it,
// for photos taken by hand, with no server and no ticket. On a world, its own friend (server/fixtures/cast.json) in
// its look, with Momo beside it; on the meadow, Momo, and a friend beside it if the URL names one. Over the planet
// only a panel (lil-gui), which C puts away for the shot: where the camera goes (the two side on, a selfie at arm's
// length, the host alone, the scenery with no one in it, the host's home), what each Muse is doing (a part of the
// host's day, sought as the lab seeks it; a posture held on the guest; a wave, a bounce or a hold, as a press on it
// has them), its face, where it looks, and the time held (T) at a moment into what they do. The camera stays free.
// The world's main.ts makes it in place of its garden (prepareStudio in visitUi.ts loads this only then) and calls it
// as it would a VisitUi.
//
//   ?studio                       the planet's own friend in its look, and Momo
//   &host=museN, &guest=museN     another look for either (tpose6, muse0 … muse12, or a made body gen-<muse>-<n>)
//   /?studio&with=museN           the meadow: Momo, and a friend in that look beside it

/** Whose planet the page is, and who is drawn on it: its own Muse (Momo on the meadow) and a second beside it, if any. */
export interface StudioCast {
  readonly planet: PlanetId;
  /** The planet's seed, as its friend's (a visit's: server/fixtures/cast.json); null on the meadow, Momo's own as it is. */
  readonly seed: number | null;
  readonly host: StudioMember;
  readonly guest: StudioMember | null;
  /** Whether the host was named in the URL (on the meadow, Momo keeps its own body otherwise). */
  readonly dressHost: boolean;
}

export interface StudioMember {
  readonly name: string;
  readonly look: MuseLook;
}

/** A friend as the cast has it. */
interface Member extends StudioMember {
  readonly planet: string;
  readonly worldSeed: number;
}

/** The cast's members (server/fixtures/cast.json), as far as the studio reads them. */
export function castMembers(text: string = castFile): Member[] {
  const file = JSON.parse(text) as { members?: unknown };
  const members: unknown[] = Array.isArray(file.members) ? file.members : [];
  return members.flatMap((m) => {
    const { name, planet, look, worldSeed } = (m ?? {}) as Record<string, unknown>;
    return typeof name === 'string' && typeof planet === 'string' && isLook(look) && typeof worldSeed === 'number' ? [{ name, planet, look, worldSeed }] : [];
  });
}

/** What the URL asks of the studio on a planet's page; null when it asks for none. */
export function readStudio(planet: PlanetId, search: string, cast: readonly Member[] = castMembers()): StudioCast | null {
  const q = new URLSearchParams(search);
  if (!q.has('studio')) return null;
  const asked = (key: string): MuseLook | null => {
    const v = q.get(key);
    return isLook(v) ? v : null;
  };
  const wearing = (look: MuseLook, otherwise: string): StudioMember => ({ name: cast.find((m) => m.look === look)?.name ?? otherwise, look });
  const momo = cast.find((m) => m.planet === 'meadow') ?? { name: 'Momo', look: 'tpose6' as const };
  if (planet === 'meadow') {
    const friend = asked('with');
    const host = asked('host');
    return { planet, seed: null, host: host ? wearing(host, momo.name) : { name: momo.name, look: momo.look }, guest: friend ? wearing(friend, 'Friend') : null, dressHost: host !== null };
  }
  const own = cast.find((m) => m.planet === planet);
  const host = asked('host');
  return {
    planet,
    seed: own?.worldSeed ?? null,
    host: host ? wearing(host, own?.name ?? 'Host') : { name: own?.name ?? 'Host', look: own?.look ?? 'tpose6' },
    guest: wearing(asked('guest') ?? momo.look, momo.name),
    dressHost: true,
  };
}

/** The studio a page's URL asks for, ready to open once the page has its World (visitUi.ts prepareStudio). */
export interface Studio {
  readonly cast: StudioCast;
  open(world: VisitWorld, clock: FrameClock): StudioUi;
}

/**
 * Before the page makes its World: the studio its URL asks for, with the planet's seed set to its friend's as a visit
 * sets it (unless the URL's hash names one), and the page's own interface put away. Null when it asks for none.
 */
export function openStudio(store: VisitStore, planet: PlanetId, search: string = location.search): Studio | null {
  const cast = readStudio(planet, search);
  if (!cast) return null;
  if (cast.seed !== null && !parseHash(location.hash).has('seed')) {
    store.set('world.seed', cast.seed);
    store.flush();
  }
  document.body.classList.add('is-studio');
  return { cast, open: (world, clock) => new StudioUi(world, cast, clock) };
}

// ---- what the Muses do -------------------------------------------------------------------------------

type Shot = 'together' | 'selfie' | 'host' | 'scenery' | 'home';
const SHOTS: Readonly<Record<string, Shot>> = { Together: 'together', Selfie: 'selfie', 'Host alone': 'host', Scenery: 'scenery', Home: 'home' };

/**
 * The parts of a day the host can be sought to (each by the names its life gives it, museRoam.ts), and the moment into
 * one a photo is first held at (s): the legs swinging on the bench, the can tipped, the yum after a taste of the pot
 * (the ladle out of the pocket first), the catch cheered, the arms up in a yawn, an eye rubbed awake.
 */
const PARTS: readonly { readonly label: string; readonly names: readonly string[]; readonly at: number }[] = [
  { label: 'on the bench', names: ['bench'], at: 4 },
  { label: 'sitting in the grass', names: ['sit'], at: 3 },
  { label: 'napping', names: ['nap'], at: 6 },
  { label: 'watering', names: ['pour'], at: 1.6 },
  { label: 'cooking', names: ['cook'], at: 10.6 },
  { label: 'fishing', names: ['fish'], at: 10 },
  { label: 'walking', names: ['wander', 'walk'], at: 3 },
  { label: 'yawning', names: ['yawn'], at: 1.3 },
  { label: 'waking up', names: ['wake'], at: 2 },
  { label: 'looking about', names: ['look about'], at: 2 },
  { label: 'resting at home', names: ['rest'], at: 3 },
];
const OWN_DAY = 'its own day';
const STANDING = 'standing, turned to you';
const BENCH_WORK = 'at work on its bench';
/** How far into its day the host's life is written, to find its parts in (s). */
const DAY_AHEAD = 3 * 3600;

/** The guest's postures, held on its pose over standing beside the host: each a move (museRig.ts), how long before it plays again (s; Infinity: held), the moment first shown (s). */
const POSTURES: Readonly<Record<string, { readonly kind: 'sit' | 'sleep' | 'yawn' | 'wake' | 'fluff'; readonly length: number; readonly at: number }>> = {
  'sitting in the grass': { kind: 'sit', length: Infinity, at: 3 },
  napping: { kind: 'sleep', length: Infinity, at: 6 },
  yawning: { kind: 'yawn', length: YAWN_LENGTH, at: 1.3 },
  'waking up': { kind: 'wake', length: WAKE, at: 2 },
  'fur standing up': { kind: 'fluff', length: FLUFF_LENGTH, at: 1.6 },
};
const BESIDE = 'standing beside';

/** Its answers to you, as a tap or a hold on it has them, and the moment first shown (s): the arm up, a hop, the fur up as it is held. */
const ANSWERS: Readonly<Record<string, number>> = { none: 0, waving: 1.2, 'bouncing for joy': 0.85, 'being petted': 3 };

/** The faces held on a Muse: every part of its face set, so none of its pose's shows through. */
const FACES: Readonly<Record<string, Expression | null>> = {
  'its own': null,
  smiling: { eyes: 1, smile: 0.55, squint: 0, squeeze: 0, blush: 0.1 },
  beaming: { eyes: 1, smile: 1, squint: 0, squeeze: 0, blush: 0.3 },
  'happy squint ∩': { eyes: 1, smile: 1, squint: 1, squeeze: 0, blush: 0.55 },
  'content squint ∪': { eyes: 1, smile: 0.7, squint: -1, squeeze: 0, blush: 0.15 },
  'eyes squeezed shut > <': { eyes: 1, smile: 0.9, squint: 0, squeeze: 1, blush: 0.85 },
  sleepy: { eyes: 0.35, smile: 0.2, squint: 0, squeeze: 0, blush: 0 },
  blushing: { eyes: 1, smile: 0.6, squint: 0, squeeze: 0, blush: 1 },
};
/** The faces a rig that draws only the eyes and the smile (Violet Dunes' own) can show. */
const PLAIN_FACES = ['its own', 'smiling', 'beaming', 'sleepy'];
const LOOKS = { own: 'its own way', camera: 'at the camera' } as const;
const TURNS = { host: 'to the host', camera: 'to the camera' } as const;

/**
 * A new start for what they do waits on what went before (s): a wave answers a tap only when it hasn't waved for nine
 * seconds (museLife.ts WAVE_AGAIN; the bounce otherwise), and a hold let go takes a moment to shake its fur out (PET.out
 * and the fur's shake, museRig.ts). A hold let go sooner than TAP after it began is a tap.
 */
const AGAIN = 9.5;
const LET_GO = 2.5;
const TAP = 0.35;
/** The furthest moment into what they do the panel goes (s), and the reach of a selfie at first (m). */
const MOMENT_MAX = 30;
const REACH = 1;
/** The longest a shot waits for the guest to come to the host's side before it is framed (s). */
const FRAME_WAIT = 6;

/** One of the two Muses as the studio has it: what it is doing, its face and look, and what its pose is held to. */
interface Sitter {
  readonly body: VisitBody;
  readonly name: string;
  readonly role: 'host' | 'guest';
  doing: string;
  take: number;
  answer: string;
  face: string;
  look: string;
  turn: string;
  /** Where it stands while it stands for you. */
  spot: Vector3 | null;
  /** When it was last tapped, and when the hold on it began (world s; null: none). */
  tapped: number | null;
  pressed: number | null;
  readonly held: HeldLook & { moves: Move[] };
  readonly gaze: { yaw: number; pitch: number };
}

const HIDDEN: VisitDirection = { kind: 'hidden' };
const HOME: VisitDirection = { kind: 'home', busy: false };
const BUSY: VisitDirection = { kind: 'home', busy: true };
const eye = new Vector3();
const toCamera = new Vector3();
const side = new Vector3();

export class StudioUi {
  private readonly flight: Flight;
  private readonly follower = new Follower();
  private readonly host: Sitter;
  private readonly guest: Sitter | null;
  private readonly settings = { shot: 'Together', reach: REACH };
  /** When what they do began (world s): the moment into it is the clock's time less this. */
  private start = 0;
  private gui: GUI | null = null;
  private shown = true;
  /**
   * Frames until the shot is framed (it waits for the Muses to be placed as they are now asked to be), and how much
   * longer it waits for the guest to walk to its place beside the host (s).
   */
  private frameIn = -1;
  private frameWait = 0;
  private following = false;
  /** The parts of the host's day it can be sought to, each with the starts of every time it comes in its day (s). */
  private parts: { label: string; takes: number[] }[] = [];
  private readonly camera = new Vector3();
  private markReady: () => void = () => undefined;
  readonly ready: Promise<void>;
  // (the meadow's page asks its garden for these too: no hut here, its doors stay shut)
  readonly gizmo = false;

  constructor(
    private readonly world: VisitWorld,
    cast: StudioCast,
    private readonly clock: FrameClock,
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.flight = new Flight(world.scene.rig);
    if (cast.dressHost) world.dressHost(cast.host.look);
    this.host = this.sitter(world.host, cast.host.name, 'host');
    this.guest = cast.guest ? this.sitter(world.makeGuest(cast.guest.look), cast.guest.name, 'guest') : null;
    window.addEventListener('keydown', (e) => this.key(e), true);
    if (import.meta.env.DEV || import.meta.env.VITE_PROBE) this.installProbe();
    void this.begin();
  }

  private sitter(body: VisitBody, name: string, role: Sitter['role']): Sitter {
    return {
      body,
      name,
      role,
      doing: role === 'host' ? OWN_DAY : BESIDE,
      take: 1,
      answer: 'none',
      face: 'its own',
      look: LOOKS.own,
      turn: TURNS.host,
      spot: null,
      tapped: null,
      pressed: null,
      held: { moves: [] },
      gaze: { yaw: 0, pitch: 0 },
    };
  }

  /** Once both are in their bodies and the host's day is under way: its parts found, the panel made, the two framed. */
  private async begin(): Promise<void> {
    await Promise.all([this.host.body.ready, this.guest?.body.ready]);
    // (its day is made with the first frame it is drawn in)
    while (this.host.body.life === null) await new Promise((resolve) => setTimeout(resolve, 50));
    const life = this.host.body.life;
    if (life) {
      life.at(DAY_AHEAD, this.world.scene.rig.camera.position);
      const names = life.names;
      this.parts = PARTS.map((p) => ({ label: p.label, takes: names.filter((n) => p.names.includes(n.name)).map((n) => n.start) })).filter((p) => p.takes.length > 0);
    }
    this.start = this.clock.time;
    this.gui = this.panel();
    if (!/(^|[#&])pose=/.test(location.hash)) this.reframe();
    this.markReady();
  }

  // ---- each frame --------------------------------------------------------------------------------------

  /** Before the world moves: a flight drives the camera, and the two Muses are told what to do and how to look. */
  update(dt: number): void {
    this.flight.update(dt);
    this.world.hideOthers();
    this.camera.copy(this.world.scene.rig.camera.position).normalize();
    const shot = SHOTS[this.settings.shot];
    const host = this.host;
    if (shot === 'scenery') host.body.direct(HIDDEN);
    else if (host.doing === BENCH_WORK) host.body.direct(BUSY);
    else if (host.doing === STANDING && host.spot) host.body.direct({ kind: 'out', dir: host.spot, toward: this.camera, walk: 0, busy: false });
    else host.body.direct(HOME);
    const guest = this.guest;
    if (guest) {
      if (shot === 'scenery' || shot === 'host') {
        this.follower.reset();
        this.following = false;
        guest.body.direct(HIDDEN);
      } else {
        const stands = (dir: Vector3) => this.world.ground(dir).water > FOLLOW.dry && (this.world.standable?.(dir) ?? true);
        const f = this.follower.step(host.body.where, dt, this.world.scene.growth.radius, stands);
        // (turned to the camera where asked, for a selfie, and while it answers you, as the host's own life turns it)
        const turned = guest.turn === TURNS.camera || shot === 'selfie' || guest.answer !== 'none';
        guest.body.direct({ kind: 'out', dir: f.dir, toward: turned && f.walk === 0 ? this.camera : f.toward, walk: f.walk, busy: false });
        this.following = f.walk > 0;
      }
    }
    for (const s of [host, guest]) if (s) this.holdLook(s);
    if (this.frameIn >= 0) {
      this.frameWait -= dt;
      if (this.frameIn > 0) this.frameIn--;
      else if (!this.following || this.frameWait <= 0) {
        this.frameIn = -1;
        this.frameShot();
      }
    }
  }

  /** After the world's update: nothing of the studio's moves then. */
  frame(_dt: number): void {
    // (no beds and no card here)
  }

  /** A tap on the canvas: nothing of the studio's is there to take it (a press on a Muse is the page's own). */
  tap(_x: number, _y: number, _width: number, _height: number): boolean {
    return false;
  }

  drag(): boolean {
    return false;
  }

  zoom(): boolean {
    return false;
  }

  claims(): boolean {
    return false;
  }

  /** You took the camera (a drag, the wheel, a key): any flight ends there. */
  interrupt(): void {
    this.flight.cancel();
  }

  /** A Muse's pose held to its face, its look and its posture, as the panel has them (each frame: a body put in place anew has a pose of its own). */
  private holdLook(s: Sitter): void {
    const pose = s.body.pose;
    if (!pose) return;
    const held = s.held;
    held.face = FACES[s.face] ?? undefined;
    held.look = s.look === LOOKS.camera ? this.gaze(s) : undefined;
    const posture = s.role === 'guest' ? POSTURES[s.doing] : undefined;
    held.moves.length = 0;
    if (posture) {
      const into = Math.max(0, this.clock.time - this.start);
      const time = posture.length === Infinity ? into : into % posture.length;
      held.moves.push({ kind: posture.kind, time, amount: 1, ease: 1, roused: -1 });
    }
    pose.held = held.face || held.look || held.moves.length > 0 ? held : null;
  }

  /** Where a Muse's head turns to look into the camera (rad, as its action's look: + to its left, + up). */
  private gaze(s: Sitter): { yaw: number; pitch: number } {
    const w = s.body.where;
    eye.copy(headOf(s.body, this.world.scene.growth.radius));
    toCamera.subVectors(this.world.scene.rig.camera.position, eye);
    const ahead = toCamera.dot(w.heading);
    const left = toCamera.dot(side.crossVectors(w.dir, w.heading));
    s.gaze.yaw = Math.atan2(left, ahead);
    s.gaze.pitch = Math.atan2(toCamera.dot(w.dir), Math.max(Math.hypot(ahead, left), 0.3));
    return s.gaze;
  }

  // ---- what they do, from a start --------------------------------------------------------------------

  /** The time into what they do now (s); set, the time is held there. */
  get moment(): number {
    return Math.min(MOMENT_MAX, Math.max(0, this.clock.time - this.start));
  }

  set moment(s: number) {
    this.clock.freeze(this.start + s);
  }

  /** Whether the time is held (the moment stays where it is), or runs on. */
  get holding(): boolean {
    return this.clock.frozen;
  }

  set holding(on: boolean) {
    this.clock.freeze(on ? this.clock.time : null);
  }

  /**
   * Begin what the two do again, `moment` seconds ago: each Muse's part of its day sought, its answer given (a tap,
   * two for a bounce, a hold), the guest's posture from there. A wave again, or a hold just let go, wants its time
   * first: the start then moves on, and the clock with it.
   */
  private play(moment: number): void {
    const now = this.clock.time;
    let start = now - moment;
    const sitters = [this.host, this.guest].filter((s): s is Sitter => s !== null);
    for (const s of sitters) {
      if (s.pressed !== null && s.answer !== 'being petted') {
        const at = Math.max(s.pressed + TAP, start - LET_GO);
        s.body.letGo?.(at);
        s.pressed = null;
        start = Math.max(start, at + LET_GO);
      }
      if (s.answer === 'waving' && s.tapped !== null) start = Math.max(start, s.tapped + AGAIN);
    }
    this.start = start;
    for (const s of sitters) this.stage(s, start);
    const at = start + moment;
    if (at !== now) {
      const held = this.clock.frozen;
      this.clock.freeze(at);
      if (!held) this.clock.freeze(null);
    }
  }

  /** One Muse's part in it, from the start: its part of its day (sought first: seeking forgets its answers), then its answer. */
  private stage(s: Sitter, start: number): void {
    const body = s.body;
    if (s.doing === STANDING) s.spot = body.where.dir.clone();
    const part = s.role === 'host' ? this.parts.find((p) => p.label === s.doing) : undefined;
    if (part && body.life) body.life.seek(start, part.takes[(s.take - 1) % part.takes.length]);
    if (s.answer === 'waving') {
      body.tap?.(start);
      s.tapped = start;
    } else if (s.answer === 'bouncing for joy') {
      // (a tap soon after a wave is a bounce)
      body.tap?.(start - 0.05);
      body.tap?.(start);
      s.tapped = start;
    } else if (s.answer === 'being petted' && body.hold) {
      // (pressed again from the start, if it was held already)
      body.hold(start, 1);
      s.pressed = start;
    }
  }

  // ---- the camera ----------------------------------------------------------------------------------

  private frameShot(): void {
    this.interrupt();
    const w = this.world;
    const R = w.scene.growth.radius;
    const ground = (dir: Vector3): number => w.ground(dir).height;
    const fly = (f: Framing): void => this.flight.to(f, R, ground);
    const host = this.host.body;
    const guest = this.guest?.body ?? null;
    switch (SHOTS[this.settings.shot]) {
      case 'together': {
        const f = musesFraming(w, guest?.where ?? null);
        if (f) fly(f);
        else if (w.scene.frameMuse) w.scene.frameMuse();
        else fly(hostFraming(w));
        return;
      }
      case 'selfie':
        fly(selfieFraming(w, guest ? [host, guest] : [host], this.settings.reach));
        return;
      case 'host':
        if (w.scene.frameMuse) w.scene.frameMuse();
        else fly(hostFraming(w));
        return;
      case 'home':
        if (w.frameHome) w.frameHome();
        else fly(homeFraming(w));
        return;
      case 'scenery':
        return;
    }
  }

  /** Frame the shot once the Muses stand as it has them: a frame or two on, once the guest is at the host's side. */
  private reframe(): void {
    this.frameIn = 2;
    this.frameWait = FRAME_WAIT;
  }

  // ---- the panel -------------------------------------------------------------------------------------

  private panel(): GUI {
    const gui = new GUI({ title: 'Studio · C hides it', width: 320 });
    gui.domElement.classList.add('studio-panel');
    gui.add(this.settings, 'shot', Object.keys(SHOTS)).name('Shot').onChange(() => this.reframe());
    gui.add({ frame: () => this.reframe() }, 'frame').name('Frame the shot again');
    gui
      .add(this.settings, 'reach', 0.6, 3, 0.05)
      .name('Selfie reach (m)')
      .onFinishChange(() => SHOTS[this.settings.shot] === 'selfie' && this.reframe());
    gui.add(this, 'holding').name('Hold time (T)').listen();
    gui.add(this, 'moment', 0, MOMENT_MAX, 0.05).name('Moment (s)').listen();
    gui.add({ again: () => this.play(this.moment) }, 'again').name('Play it again');
    for (const s of [this.host, this.guest]) if (s) this.sitterPanel(gui, s);
    return gui;
  }

  /** A Muse's folder: what it does (only what it can), its answer, its face, where it looks (and the guest's way it faces). */
  private sitterPanel(gui: GUI, s: Sitter): void {
    const body = s.body;
    const folder = gui.addFolder(`${s.name}${s.role === 'host' ? ', the host' : ''}`);
    const full = body.pose !== undefined && 'squeeze' in body.pose;
    const doings =
      s.role === 'host'
        ? [OWN_DAY, STANDING, ...(body.life ? [BENCH_WORK] : []), ...this.parts.map((p) => p.label)]
        : [`${BESIDE} ${this.host.name}`, ...(full ? Object.keys(POSTURES) : [])];
    if (s.role === 'guest') s.doing = doings[0];
    const answers = ['none', ...(body.tap ? ['waving'] : []), ...(body.tap && body.life ? ['bouncing for joy'] : []), ...(body.hold ? ['being petted'] : [])];
    let take: Controller | null = null;
    folder
      .add(s, 'doing', doings)
      .name('Doing')
      .onChange((v: string) => {
        take?.show(this.parts.some((p) => p.label === v));
        this.changed(s, 'doing');
      });
    if (s.role === 'host' && this.parts.length > 0) {
      take = folder
        .add(s, 'take', 1, 9, 1)
        .name('Which time in its day')
        .onChange(() => this.changed(s, 'take'))
        .show(false);
    }
    if (answers.length > 1) folder.add(s, 'answer', answers).name('Answering you').onChange(() => this.changed(s, 'answer'));
    if (body.pose) {
      folder.add(s, 'face', full ? Object.keys(FACES) : PLAIN_FACES).name('Face');
      folder.add(s, 'look', Object.values(LOOKS)).name('Looking');
    }
    if (s.role === 'guest') folder.add(s, 'turn', Object.values(TURNS)).name('Turned');
  }

  /**
   * What a Muse does, or its answer, changed: the two begin again, at the moment first shown of what changed (its
   * part, its posture, its answer), and the shot follows the host where it went.
   */
  private changed(s: Sitter, what: 'doing' | 'take' | 'answer'): void {
    this.play(what === 'answer' ? (ANSWERS[s.answer] ?? 0) : (PARTS.find((p) => p.label === s.doing)?.at ?? POSTURES[s.doing]?.at ?? 0));
    if (s.role === 'host' && what !== 'answer') this.reframe();
  }

  /** Show or put away the panel (C), or hold the time (T: the page's own, where it has one, is not run as well). */
  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if ((t instanceof HTMLInputElement && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (key !== 'c' && key !== 't') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (t instanceof HTMLElement && t !== document.body) t.blur();
    if (key === 't') this.holding = !this.holding;
    else this.toggle();
  }

  private toggle(): void {
    this.shown = !this.shown;
    this.gui?.show(this.shown);
  }

  // ---- the dev harness -----------------------------------------------------------------------------------

  private installProbe(): void {
    (window as unknown as { __studio: unknown }).__studio = {
      ready: this.ready,
      state: () => this.state(),
      set: (role: 'host' | 'guest', what: Partial<Pick<Sitter, 'doing' | 'answer' | 'face' | 'look' | 'turn' | 'take'>>) => this.set(role, what),
      shot: (shot: string) => {
        this.settings.shot = shot;
        this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
        this.reframe();
      },
      hold: (on: boolean) => (this.holding = on),
      moment: (s: number) => (this.moment = s),
      flying: () => this.flight.flying || this.frameIn >= 0,
      toggle: () => this.toggle(),
    };
  }

  /** Set a Muse's doing, answer, face or look as the panel would. */
  private set(role: 'host' | 'guest', what: Partial<Pick<Sitter, 'doing' | 'answer' | 'face' | 'look' | 'turn' | 'take'>>): void {
    const s = role === 'host' ? this.host : this.guest;
    if (!s || !this.gui) return;
    Object.assign(s, what);
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
    if (what.doing !== undefined) this.changed(s, 'doing');
    else if (what.take !== undefined) this.changed(s, 'take');
    else if (what.answer !== undefined) this.changed(s, 'answer');
  }

  /** What the studio has the two doing, and what each could do here, for checks. */
  state(): object {
    const sitter = (s: Sitter | null) => {
      if (!s) return null;
      const folder = this.gui?.folders.find((f) => f._title.startsWith(s.name));
      const options = (property: string): string[] => {
        const c = folder?.controllers.find((x) => x.property === property);
        return c ? [...(c.domElement.querySelectorAll('option') ?? [])].map((o) => o.textContent ?? '') : [];
      };
      return { name: s.name, doing: s.doing, answer: s.answer, face: s.face, look: s.look, doings: options('doing'), answers: options('answer'), faces: options('face'), held: s.body.pose?.held !== null && s.body.pose?.held !== undefined };
    };
    return {
      planet: this.world.planet,
      shot: this.settings.shot,
      panel: this.gui !== null && this.shown,
      hold: this.clock.frozen,
      moment: this.moment,
      host: sitter(this.host),
      guest: sitter(this.guest),
    };
  }
}
