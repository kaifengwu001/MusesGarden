import { Vector3, type IUniform, type Vector4 } from 'three';
import type { FrameClock } from '../core/clock';
import { parseHash } from '../core/hashSync';
import type { MuseLook, PlanetId } from '../muse/contract';
import { PLANETS } from '../muse/planets';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import { unwarpPoint, warpPoint } from '../render/warp';
import { castMembers, type Studio, type StudioCast, type StudioPage } from '../visit/studio';
import type { VisitStore } from '../visit/visitUi';
import type { ActedLife, VisitBody, VisitDirection, VisitWorld } from '../visit/world';
import './director.css';
import { ACTION, COLOURS, FACES, LOOKS, MAX_ACTORS, isLook, type ActionId } from './library';
import { Overlay, type OverlayMark, type OverlayRoute, type OverlayScene } from './overlay';
import { Panel, type PanelActions } from './panel';
import { Pieces } from './pieces';
import { Path, planRoute, type Route, type RouteGround } from './route';
import { emptyScene, newBeat, newId, parseScene, sceneText, type Actor, type Beat, type DirectorScene, type Mark, type Piece, type Vec3 } from './scene';
import { aim, newLife, play, Take, type TakeWorld } from './timeline';

// The director's mode, for filming: `?director` on any planet's page (the meadow's `/?director`, a world's
// `/environments/<x>/?director`) puts the planet's own Muse and up to three more, in any of the muses' looks, under your
// direction. Each Muse has beats in order (scene.ts): an action from the library (library.ts), done at a mark it walks
// to by itself round water and walls (route.ts), facing as asked, for so long, from a cue (a time, or another Muse's
// beat); benches and stoves can be set about for it to sit on and cook at (pieces.ts). The beats are written out as a
// take (timeline.ts), played frame by frame into each Muse as a life handed over whole (VisitBody.act), so the take
// can be played, paused, scrubbed and played again exactly. Marks are moved by gumballs on the planet (overlay.ts),
// everything else is set on the panel (panel.ts); H hides it all for the shot, and the camera stays yours. The planet
// is set as a visit has it (its friend's seed: server/fixtures/cast.json), as the photo studio's is; the world's other
// residents keep out of sight; nothing of the director is drawn when the page is opened without it.

const STORE = 'muses-garden.director.';
const HIDDEN: VisitDirection = { kind: 'hidden' };
/** How far ahead a new beat's mark is put (m), and the gap a take's loop leaves after its end (s). */
const AHEAD = 2.6;
const LOOP_TAIL = 1.2;
/** Undo goes back this many changes. */
const UNDO = 80;

/** Whose planet the page is, and who its own Muse is (as the studio reads the cast). */
function castFor(planet: PlanetId): StudioCast {
  const cast = castMembers();
  const own = cast.find((m) => m.planet === planet);
  const momo = cast.find((m) => m.planet === 'meadow');
  if (planet === 'meadow') return { planet, seed: null, host: { name: momo?.name ?? 'Momo', look: momo?.look ?? 'tpose6' }, guest: null, dressHost: false };
  return { planet, seed: own?.worldSeed ?? null, host: { name: own?.name ?? 'Host', look: own?.look ?? 'tpose6' }, guest: null, dressHost: true };
}

/** Before the page makes its World: the director, with the planet's seed set to its friend's as a visit sets it (unless the URL's hash names one), and the page's own interface put away. */
export function openDirector(store: VisitStore, planet: PlanetId): Studio {
  const cast = castFor(planet);
  if (cast.seed !== null && !parseHash(location.hash).has('seed')) {
    store.set('world.seed', cast.seed);
    store.flush();
  }
  document.body.classList.add('is-studio', 'is-director');
  return { cast, open: (world, clock) => new DirectorUi(world, cast, clock) };
}

const vec = (a: Vec3, out = new Vector3()): Vector3 => out.set(a[0], a[1], a[2]);
const tuple = (p: Vector3): Vec3 => [p.x, p.y, p.z];
const markOf = (dir: Vector3, facing: Vector3): Mark => {
  const d = dir.clone().normalize();
  return { dir: tuple(d), facing: tuple(tangentToward(d, d.clone().add(facing), new Vector3())) };
};

type Placing = { kind: 'beat'; id: string } | { kind: 'start'; id: string } | { kind: 'piece'; piece: Piece['kind'] } | { kind: 'actor'; look: MuseLook };

export class DirectorUi implements StudioPage {
  readonly ready: Promise<void>;
  readonly gizmo = false;
  private markReady: () => void = () => undefined;
  private began = false;
  private scene: DirectorScene;
  private take: Take | null = null;
  private dirty = true;
  /** While a gumball drags: routes not yet found are drawn straight, found again once it lets go. */
  private quick = false;
  private readonly bodies = new Map<string, VisitBody>();
  private readonly looks = new Map<VisitBody, MuseLook>();
  private readonly spare: VisitBody[] = [];
  /** The bodies in place (meshed, dressed): a guest takes a few seconds on some worlds. */
  private readonly loaded = new WeakSet<VisitBody>();
  private readonly lives = new Map<string, ActedLife>();
  private readonly routeCache = new Map<string, Route>();
  private readonly routeGround: RouteGround;
  /** The world's time at the take's start (s), and the take's time held while paused (null: playing). */
  private start: number;
  private paused: number | null = 0;
  private scrubFrom: boolean | null = null;
  private picked: { actor: string | null; beat: string | null; piece: string | null } = { actor: null, beat: null, piece: null };
  private placing: Placing | null = null;
  private readonly root: HTMLElement;
  private readonly overlay: Overlay;
  private readonly panel: Panel;
  private readonly pieces: Pieces | null;
  private shown = true;
  private renderWanted = true;
  private saveTimer = 0;
  private readonly undo: DirectorScene[] = [];
  private readonly redo: DirectorScene[] = [];
  private dragging = false;
  private seen: { radius: number; shape: object | null } = { radius: 0, shape: null };
  private readonly camera = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly planet: PlanetId;
  /** What the director's own work costs a frame (ms, summed since last read), and how often the take was written (dev: __director.costs). */
  private readonly spent = { update: 0, frame: 0, frames: 0, rewrites: 0 };

  constructor(
    private readonly world: VisitWorld,
    private readonly cast: StudioCast,
    private readonly clock: FrameClock,
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.planet = world.planet;
    this.start = clock.time;
    this.clock.freeze(this.start);
    if (cast.dressHost) world.dressHost(cast.host.look);
    this.looks.set(world.host, cast.host.look);
    this.routeGround = { water: (dir) => world.ground(dir).water, standable: (dir) => (world.walkable ?? world.standable)?.(dir) ?? true, height: (dir) => this.standAt(dir) };
    this.scene = this.load() ?? emptyScene(this.planet);
    this.root = document.createElement('div');
    this.root.className = 'director';
    document.body.append(this.root);
    this.overlay = new Overlay(
      this.root,
      {
        camera: world.scene.rig.camera,
        warp: world.scene.warp,
        get R() {
          return world.scene.growth.radius;
        },
        ground: (dir) => this.standAt(dir),
        pick: (x, y) => world.scene.pick(x, y)?.dir.clone() ?? null,
      },
      { select: (key) => this.pickKey(key), move: (key, dir, facing, done) => this.moveKey(key, dir, facing, done) },
    );
    this.panel = new Panel(this.root, this.actions());
    this.pieces = world.stage ? new Pieces(world.stage.shared) : null;
    if (this.pieces && world.stage) world.stage.add(this.pieces.group);
    window.addEventListener('keydown', (e) => this.key(e), true);
    if (import.meta.env.DEV || import.meta.env.VITE_PROBE) this.installProbe();
    void this.begin();
  }

  // ---- starting --------------------------------------------------------------------------------------

  /** Once the planet's own Muse is in its body and placed: it joins the scene (where it stands, if the scene has it not), the Muses are made, the shot framed. */
  private async begin(): Promise<void> {
    await this.world.host.ready;
    // (its first frames place it; then the shot is framed on it, and it starts facing the camera there)
    const frames = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    };
    await frames(3);
    if (!/(^|[#&])pose=/.test(location.hash)) this.world.scene.frameMuse?.();
    await frames(1);
    if (!this.scene.actors.some((a) => a.host)) {
      const w = this.world.host.where;
      const host: Actor = {
        id: newId('a'),
        name: this.cast.host.name,
        look: this.cast.host.look,
        host: true,
        shown: true,
        colour: COLOURS[0],
        start: markOf(w.dir, this.cameraWay(w.dir) ?? w.heading),
        beats: [],
      };
      this.scene = { ...this.scene, actors: [host, ...this.scene.actors] };
    }
    this.picked.actor = this.scene.actors.find((a) => a.host)?.id ?? null;
    this.began = true;
    this.dirty = true;
    this.renderWanted = true;
    this.markReady();
  }

  /** The height a Muse stands at at a place (m over R): on a deck or a porch where its world has one (its life knows), else on the ground. */
  private standAt(dir: Vector3): number {
    return this.world.host.life?.groundAt?.(dir) ?? this.world.ground(dir).height;
  }

  private load(): DirectorScene | null {
    try {
      const text = localStorage.getItem(STORE + this.planet);
      return text ? parseScene(text, this.planet) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE + this.planet, sceneText(this.scene));
      } catch {
        // (no storage here: the scene lasts as long as the page)
      }
    }, 300);
  }

  // ---- the scene changing ---------------------------------------------------------------------------

  /** Change the scene (undoably): the take written again, the panel shown again, the scene kept. */
  private change(next: DirectorScene, undoable = true): void {
    if (undoable) {
      this.undo.push(this.scene);
      if (this.undo.length > UNDO) this.undo.shift();
      this.redo.length = 0;
    }
    this.scene = next;
    this.dirty = true;
    this.renderWanted = true;
    this.save();
  }

  private actorPatch(id: string, f: (a: Actor) => Actor, undoable = true): void {
    this.change({ ...this.scene, actors: this.scene.actors.map((a) => (a.id === id ? f(a) : a)) }, undoable);
  }

  private beatPatch(id: string, f: (b: Beat) => Beat, undoable = true): void {
    this.change({ ...this.scene, actors: this.scene.actors.map((a) => (a.beats.some((b) => b.id === id) ? { ...a, beats: a.beats.map((b) => (b.id === id ? f(b) : b)) } : a)) }, undoable);
  }

  private actorOf(beat: string): Actor | null {
    return this.scene.actors.find((a) => a.beats.some((b) => b.id === beat)) ?? null;
  }

  private undoLast(redo: boolean): void {
    const from = redo ? this.redo : this.undo;
    const to = redo ? this.undo : this.redo;
    const scene = from.pop();
    if (!scene) return;
    to.push(this.scene);
    this.scene = scene;
    this.dirty = true;
    this.renderWanted = true;
    this.save();
  }

  /** Where a Muse is left by its beats so far (its last mark or piece, or where it starts), and the way it faces there. */
  private lastPlace(actor: Actor, before = actor.beats.length): { dir: Vector3; facing: Vector3 } {
    let dir = vec(actor.start.dir);
    let facing = vec(actor.start.facing);
    for (const b of actor.beats.slice(0, before)) {
      const spot = b.piece ? this.pieces?.spot(b.piece) : null;
      if (spot) {
        dir = spot.stand.clone();
        facing = spot.facing.clone();
      } else if (b.mark) {
        dir = vec(b.mark.dir);
        facing = vec(b.mark.facing);
      }
    }
    return { dir, facing };
  }

  /** The way to the camera on the ground at a place (null right under it). */
  private cameraWay(dir: Vector3): Vector3 | null {
    unwarpPoint(this.world.scene.warp, this.world.scene.rig.camera.position, this.camera);
    const t = this.camera.clone().addScaledVector(dir, -this.camera.dot(dir));
    return t.lengthSq() > 1e-8 ? tangentToward(dir, this.camera, new Vector3()) : null;
  }

  private actions(): PanelActions {
    return {
      play: () => this.play(),
      pause: () => this.pause(),
      restart: () => this.seek(0, true),
      seek: (t, done) => this.scrub(t, done),
      setLoop: (on) => this.change({ ...this.scene, loop: on }),
      hide: () => this.toggle(),
      addActor: (look) => {
        if (!isLook(look) || this.scene.actors.length >= MAX_ACTORS) return;
        this.placing = { kind: 'actor', look };
        this.renderWanted = true;
      },
      selectActor: (id) => this.select(id, null, null),
      setActor: (id, patch) => this.actorPatch(id, (a) => ({ ...a, ...patch })),
      removeActor: (id) => {
        const a = this.scene.actors.find((x) => x.id === id);
        if (!a || a.host) return;
        // (cues on its beats and looks at it fall back)
        const gone = new Set(a.beats.map((b) => b.id));
        const actors = this.scene.actors
          .filter((x) => x.id !== id)
          .map((x) => ({
            ...x,
            beats: x.beats.map((b) => ({
              ...b,
              cue: b.cue.kind === 'event' && (b.cue.actor === id || gone.has(b.cue.beat)) ? { kind: 'after' as const } : b.cue,
              facing: b.facing.kind === 'actor' && b.facing.actor === id ? { kind: 'mark' as const } : b.facing,
              gaze: b.gaze.kind === 'actor' && b.gaze.actor === id ? { kind: 'own' as const } : b.gaze,
            })),
          }));
        if (this.picked.actor === id) this.picked = { actor: this.scene.actors.find((x) => x.host)?.id ?? null, beat: null, piece: null };
        this.change({ ...this.scene, actors });
      },
      placeStart: (id) => {
        this.placing = { kind: 'start', id };
        this.renderWanted = true;
      },
      addBeat: (actorId, action) => this.addBeat(actorId, action),
      selectBeat: (id) => {
        const a = id ? this.actorOf(id) : null;
        this.select(a?.id ?? this.picked.actor, id, null);
      },
      setBeat: (id, patch) => this.beatPatch(id, (b) => ({ ...b, ...patch })),
      placeBeat: (id) => {
        this.placing = { kind: 'beat', id };
        this.renderWanted = true;
      },
      moveBeat: (id, by) => {
        const a = this.actorOf(id);
        if (!a) return;
        const i = a.beats.findIndex((b) => b.id === id);
        const j = i + by;
        if (j < 0 || j >= a.beats.length) return;
        const beats = [...a.beats];
        [beats[i], beats[j]] = [beats[j], beats[i]];
        this.actorPatch(a.id, (x) => ({ ...x, beats }));
      },
      duplicateBeat: (id) => {
        const a = this.actorOf(id);
        if (!a) return;
        const i = a.beats.findIndex((b) => b.id === id);
        const copy: Beat = { ...a.beats[i], id: newId('b'), seed: Math.floor(Math.random() * 1e6) };
        const beats = [...a.beats.slice(0, i + 1), copy, ...a.beats.slice(i + 1)];
        this.actorPatch(a.id, (x) => ({ ...x, beats }));
        this.picked.beat = copy.id;
      },
      removeBeat: (id) => this.removeBeat(id),
      addPiece: (kind) => {
        this.placing = { kind: 'piece', piece: kind };
        this.renderWanted = true;
      },
      selectPiece: (id) => this.select(this.picked.actor, null, id),
      removePiece: (id) => {
        const actors = this.scene.actors.map((a) => ({ ...a, beats: a.beats.map((b) => (b.piece === id ? { ...b, piece: null } : b)) }));
        if (this.picked.piece === id) this.picked.piece = null;
        this.change({ ...this.scene, actors, pieces: this.scene.pieces.filter((p) => p.id !== id) });
      },
      exportScene: () => this.exportScene(),
      importScene: (file) => void this.importScene(file),
      newScene: () => {
        if (!window.confirm('Start a new scene? (The planet’s own Muse stays; Undo brings this one back.)')) return;
        const host = this.scene.actors.find((a) => a.host);
        this.change({ ...emptyScene(this.planet), actors: host ? [{ ...host, beats: [] }] : [] });
        this.picked = { actor: host?.id ?? null, beat: null, piece: null };
      },
      cancelPlacing: () => {
        this.placing = null;
        this.renderWanted = true;
      },
    };
  }

  private select(actor: string | null, beat: string | null, piece: string | null): void {
    this.picked = { actor, beat, piece };
    this.renderWanted = true;
  }

  private addBeat(actorId: string, action: ActionId): void {
    const actor = this.scene.actors.find((a) => a.id === actorId);
    if (!actor) return;
    const def = ACTION[action];
    let beat: Beat;
    if (def.piece) {
      const piece = this.scene.pieces.find((p) => p.kind === def.piece);
      beat = newBeat(action, null, piece?.id ?? null);
    } else if (def.posture === 'stand' && def.id !== 'stand' && def.id !== 'water') {
      // (a gesture: where it is)
      beat = newBeat(action, null);
    } else {
      // (somewhere to go: a little ahead of where it is left, facing on that way, if that is in sight clear of the
      // panels; else on the ground in the middle of the view; and a click on the planet is asked for, to put it there)
      const { dir, facing } = this.lastPlace(actor);
      const R = this.world.scene.growth.radius;
      let to = travel(dir, facing, AHEAD / R, new Vector3());
      if (!this.inSight(to)) {
        const hit = this.world.scene.pick(this.shown ? -0.25 : 0, this.shown ? -0.3 : -0.4);
        if (hit) to = hit.dir.clone().normalize();
      }
      const way = angleBetween(dir, to) > 1e-7 ? tangentToward(to, to.clone().sub(dir).add(to), new Vector3()) : facing;
      beat = newBeat(action, markOf(to, way));
      this.placing = { kind: 'beat', id: beat.id };
    }
    this.actorPatch(actorId, (a) => ({ ...a, beats: [...a.beats, beat] }));
    this.picked = { actor: actorId, beat: beat.id, piece: null };
  }

  /** Whether a place on the ground is in sight, clear of the panel and the timeline (when they are shown). */
  private inSight(dir: Vector3): boolean {
    const camera = this.world.scene.rig.camera;
    camera.updateMatrixWorld();
    const p = warpPoint(this.world.scene.warp, dir.clone().multiplyScalar(this.world.scene.growth.radius + this.standAt(dir)), new Vector3()).project(camera);
    if (p.z < -1 || p.z > 1) return false;
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    const right = this.shown ? window.innerWidth - 380 : window.innerWidth - 40;
    const bottom = this.shown ? window.innerHeight - 160 : window.innerHeight - 40;
    return x > 40 && y > 40 && x < right && y < bottom;
  }

  private removeBeat(id: string): void {
    const a = this.actorOf(id);
    if (!a) return;
    const actors = this.scene.actors.map((x) => ({
      ...x,
      beats: x.beats.filter((b) => b.id !== id).map((b) => (b.cue.kind === 'event' && b.cue.beat === id ? { ...b, cue: { kind: 'after' as const } } : b)),
    }));
    if (this.picked.beat === id) this.picked.beat = null;
    this.change({ ...this.scene, actors });
  }

  private exportScene(): void {
    const blob = new Blob([sceneText(this.scene)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `director-${this.planet}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importScene(file: File): Promise<void> {
    const text = await file.text();
    const scene = parseScene(text, this.planet);
    if (!scene) {
      window.alert(`That isn't a director's scene for ${PLANETS[this.planet].title}.`);
      return;
    }
    // (the planet's own Muse is always in it)
    const host = this.scene.actors.find((a) => a.host);
    const actors = scene.actors.some((a) => a.host) || !host ? scene.actors : [{ ...host, beats: [] }, ...scene.actors];
    this.change({ ...scene, actors: actors.slice(0, MAX_ACTORS) });
    this.picked = { actor: actors.find((a) => a.host)?.id ?? actors[0]?.id ?? null, beat: null, piece: null };
  }

  // ---- on the planet: picking and placing --------------------------------------------------------------

  private pickKey(key: string): void {
    const [kind, id] = key.split(':');
    if (kind === 'beat') this.select(this.actorOf(id)?.id ?? this.picked.actor, id, null);
    else if (kind === 'start' || kind === 'actor') this.select(id, null, null);
    else if (kind === 'piece') this.select(this.picked.actor, null, id);
  }

  /** A gumball moved a mark: the scene follows as it drags (undoable once, as the drag began), the routes found again as it lets go. */
  private moveKey(key: string, dir: Vector3, facing: Vector3, done: boolean): void {
    const [kind, id] = key.split(':');
    const undoable = !this.dragging;
    this.dragging = !done;
    this.quick = !done;
    const mark = markOf(dir, facing);
    if (kind === 'beat') this.beatPatch(id, (b) => ({ ...b, mark }), undoable);
    else if (kind === 'start') this.actorPatch(id, (a) => ({ ...a, start: mark }), undoable);
    else if (kind === 'piece') this.change({ ...this.scene, pieces: this.scene.pieces.map((p) => (p.id === id ? { ...p, at: mark } : p)) }, undoable);
    // (the take is shown at the moved beat's start, paused, so you see it there)
    if (done && kind === 'beat') {
      this.rewrite();
      const t = this.take?.times(id);
      if (t && this.paused !== null) this.seek(t.arrives, true);
    }
  }

  /** A tap on the planet: placing what was asked, where it was tapped. */
  tap(x: number, y: number, width: number, height: number): boolean {
    const p = this.placing;
    if (!p) return false;
    const hit = this.world.scene.pick((x / width) * 2 - 1, 1 - (y / height) * 2);
    if (!hit) return true;
    const dir = hit.dir.clone().normalize();
    const toCamera = this.cameraWay(dir) ?? tangentToward(dir, new Vector3(0, 0, 1), new Vector3());
    this.placing = null;
    if (p.kind === 'actor') {
      if (this.scene.actors.length >= MAX_ACTORS) return true;
      const used = new Set(this.scene.actors.map((a) => a.colour));
      const named = LOOKS.find((l) => l.look === p.look)?.name ?? 'Muse';
      const names = new Set(this.scene.actors.map((a) => a.name));
      let name = named;
      for (let k = 2; names.has(name); k++) name = `${named} ${k}`;
      const actor: Actor = { id: newId('a'), name, look: p.look, host: false, shown: true, colour: COLOURS.find((c) => !used.has(c)) ?? COLOURS[this.scene.actors.length % COLOURS.length], start: markOf(dir, toCamera), beats: [] };
      this.change({ ...this.scene, actors: [...this.scene.actors, actor] });
      this.picked = { actor: actor.id, beat: null, piece: null };
    } else if (p.kind === 'start') {
      this.actorPatch(p.id, (a) => ({ ...a, start: markOf(dir, vec(a.start.facing)) }));
      this.picked = { actor: p.id, beat: null, piece: null };
    } else if (p.kind === 'beat') {
      const a = this.actorOf(p.id);
      const i = a ? a.beats.findIndex((b) => b.id === p.id) : -1;
      const from = a ? this.lastPlace(a, i).dir : dir;
      const along = angleBetween(from, dir) > 1e-7 ? tangentToward(dir, dir.clone().sub(from).add(dir), new Vector3()) : toCamera;
      const was = a?.beats[i]?.mark;
      this.beatPatch(p.id, (b) => ({ ...b, mark: markOf(dir, was ? vec(was.facing) : along) }));
    } else {
      const piece: Piece = { id: newId('p'), kind: p.piece, at: markOf(dir, toCamera) };
      // (the beats that want one and have none get this one)
      const actors = this.scene.actors.map((a) => ({ ...a, beats: a.beats.map((b) => (!b.piece && ACTION[b.action].piece === p.piece ? { ...b, piece: piece.id } : b)) }));
      this.change({ ...this.scene, actors, pieces: [...this.scene.pieces, piece] });
      this.picked = { ...this.picked, beat: null, piece: piece.id };
    }
    this.renderWanted = true;
    return true;
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

  interrupt(): void {
    // (the camera is yours: nothing of the director's flies it)
  }

  // ---- the take's time ---------------------------------------------------------------------------------

  /** The take's time now (s). */
  private get time(): number {
    return this.paused ?? Math.max(0, this.clock.time - this.start);
  }

  private play(): void {
    if (this.paused === null) return;
    const length = this.take?.length ?? 0;
    if (this.paused >= length + LOOP_TAIL && length > 0) this.seek(0, false);
    // (the world's clock frozen at the take's moment runs on from there)
    this.start = this.clock.time - (this.paused ?? 0);
    this.paused = null;
    this.clock.freeze(null);
    // (facing the camera as it is now)
    this.dirty = true;
  }

  private pause(): void {
    if (this.paused !== null) return;
    this.paused = this.time;
    this.clock.freeze(this.start + this.paused);
  }

  /** Hold the take at a time (the world with it). */
  private seek(t: number, keepPlaying: boolean): void {
    const playing = this.paused === null;
    this.paused = Math.max(0, t);
    this.clock.freeze(this.start + this.paused);
    if (playing && keepPlaying) this.play();
  }

  /** Dragging the playhead: paused while it drags, playing on after if it was. */
  private scrub(t: number, done: boolean): void {
    this.scrubFrom ??= this.paused === null;
    this.seek(t, false);
    if (done) {
      if (this.scrubFrom) this.play();
      this.scrubFrom = null;
    }
  }

  // ---- each frame ----------------------------------------------------------------------------------------

  /** Before the world moves: each Muse handed its life for the moment, the planet's residents kept out of sight. */
  update(_dt: number): void {
    const t0 = performance.now();
    this.act();
    this.spent.update += performance.now() - t0;
    this.spent.frames++;
  }

  private act(): void {
    this.world.hideOthers();
    if (!this.began) return;
    this.checkShape();
    this.bind();
    if (this.dirty) this.rewrite();
    const take = this.take;
    if (!take) return;
    let t = this.time;
    if (this.paused === null && this.scene.loop && take.length > 0 && t > take.length + LOOP_TAIL) {
      this.start = this.clock.time;
      t = 0;
    }
    const R = this.world.scene.growth.radius;
    const H = this.height;
    unwarpPoint(this.world.scene.warp, this.world.scene.rig.camera.position, this.camera);
    for (const actor of this.scene.actors) {
      const body = this.bodies.get(actor.id);
      const part = take.actors.get(actor.id);
      if (!body || !part) continue;
      if (!actor.shown) {
        body.act?.(null);
        body.direct(HIDDEN);
        if (body.pose) body.pose.held = null;
        continue;
      }
      let life = this.lives.get(actor.id);
      if (!life) {
        life = newLife();
        this.lives.set(actor.id, life);
      }
      const seg = play(part, t, this.clock.time, life);
      const beat = seg?.beat ? (actor.beats.find((b) => b.id === seg.beat) ?? null) : null;
      aim(life, this.gaze(beat, life, R, H), R, H, this.standAt(life.dir));
      if (body.act) body.act(life);
      else {
        // (a Muse that takes no life whole: walked and turned as a visit directs one)
        body.direct({ kind: 'out', dir: life.dir, toward: life.dir.clone().add(life.heading), walk: life.action.walk, busy: false });
      }
      if (body.pose) {
        const face = beat ? (FACES[beat.face] ?? null) : null;
        body.pose.held = face ? { face } : null;
      }
    }
  }

  /** Where a Muse looks during a beat: as its beat asks (the camera, another Muse's face, straight ahead), else its life's own way. */
  private gaze(beat: Beat | null, life: ActedLife, R: number, H: number): Vector3 | null {
    const g = beat?.gaze;
    if (!g || g.kind === 'own') return life.lookAt;
    if (g.kind === 'camera') return this.camera;
    if (g.kind === 'ahead') {
      const ground = this.standAt(life.dir);
      return this.lookAt.copy(life.dir).multiplyScalar(R + ground + life.height + 0.77 * H).addScaledVector(life.heading, 4);
    }
    const other = this.bodies.get(g.actor);
    if (!other) return life.lookAt;
    const w = other.where;
    return this.lookAt.copy(w.dir).multiplyScalar(R + w.height + 0.8 * H);
  }

  /** After the world's update: the marks drawn where the frame has them, the stoves' fire, the grass pressed under a Muse that lies in it. */
  frame(_dt: number): void {
    const t0 = performance.now();
    this.draw();
    this.spent.frame += performance.now() - t0;
  }

  private draw(): void {
    if (!this.began) return;
    const t = this.time;
    this.pieces?.update(this.clock.time, [...this.lives.values()].some((l) => l.cues.cook !== null));
    this.press();
    if (this.renderWanted) {
      this.renderWanted = false;
      this.panel.render({
        scene: this.scene,
        take: this.take,
        actor: this.picked.actor,
        beat: this.picked.beat,
        piece: this.picked.piece,
        abilities: this.abilities,
        planet: PLANETS[this.planet].title,
        placing: this.placingNote(),
        playing: this.paused === null,
        loading: this.loading,
      });
    }
    this.panel.tick(t, this.paused === null);
    if (this.overlay.visible) {
      this.overlay.set(this.overlayScene());
      this.overlay.draw(window.innerWidth, window.innerHeight);
    }
  }

  private placingNote(): string | null {
    const p = this.placing;
    if (!p) return null;
    if (p.kind === 'actor') return `Click the planet where ${LOOKS.find((l) => l.look === p.look)?.name ?? 'the Muse'} starts`;
    if (p.kind === 'start') return 'Click the planet where it starts';
    if (p.kind === 'beat') return 'Click the planet where it goes';
    return `Click the planet where the ${p.piece} stands`;
  }

  /**
   * The grass is pressed under one Muse lying in it (the world's press takes one: its own Muse's, uMusePress): while
   * its own lies down it is its own, otherwise the first that does.
   */
  private press(): void {
    const shared = this.world.stage?.shared;
    const press = shared?.uMusePress?.value as Vector4[] | undefined;
    const k = shared?.uMusePressK as IUniform<number> | undefined;
    if (!press || !k || (this.world.host.pose?.lying ?? 0) > 0.01) return;
    for (const actor of this.scene.actors) {
      if (actor.host || !actor.shown) continue;
      const body = this.bodies.get(actor.id);
      const lying = body?.pose?.lying ?? 0;
      if (!body?.spheres || lying <= 0.01) continue;
      body.spheres.forEach((s, i) => press[i]?.copy(s));
      k.value = lying;
      return;
    }
  }

  /** What the world's Muses can do here: the planet's own tells for all (the guests are made as it is). */
  private get abilities(): { moves: boolean; props: boolean; plainFaces: boolean; pieces: boolean } {
    const acts = this.world.host.acts;
    const pose = this.world.host.pose as object | undefined;
    return { moves: acts?.moves ?? false, props: acts?.props ?? false, plainFaces: !pose || !('squeeze' in pose), pieces: !!this.world.stage };
  }

  private get height(): number {
    return this.world.host.acts?.height ?? 1.65;
  }

  /** The planet changed size or shape (a planet grows): the routes are found again, the pieces set down again. */
  private checkShape(): void {
    const radius = this.world.scene.growth.radius;
    const shape = this.world.shape();
    if (radius === this.seen.radius && shape === this.seen.shape) return;
    this.seen = { radius, shape };
    this.routeCache.clear();
    this.dirty = true;
  }

  /** Each Muse in the scene its body: the planet's own, and guests made (or kept from before) in their looks. */
  private bind(): void {
    const keep = new Set(this.scene.actors.map((a) => a.id));
    for (const [id, body] of this.bodies) {
      if (keep.has(id)) continue;
      this.bodies.delete(id);
      this.lives.delete(id);
      if (body === this.world.host) continue;
      body.act?.(null);
      body.direct(HIDDEN);
      this.spare.push(body);
    }
    for (const actor of this.scene.actors) {
      let body = this.bodies.get(actor.id);
      if (!body) {
        body = actor.host ? this.world.host : (this.spare.pop() ?? this.world.makeGuest(actor.look));
        if (!actor.host && !this.looks.has(body)) this.looks.set(body, actor.look);
        // (a guest's things drawn with it, where its world doesn't already)
        if (body.props && !body.props.group.parent) this.world.stage?.add(body.props.group);
        this.bodies.set(actor.id, body);
        this.whenLoaded(body);
      }
      if (this.looks.get(body) !== actor.look) {
        if (actor.host) this.world.dressHost(actor.look);
        else body.useModel?.(actor.look);
        this.looks.set(body, actor.look);
        this.loaded.delete(body);
        this.whenLoaded(body);
      }
    }
  }

  /** Shown on the panel as loading until its body is in. */
  private whenLoaded(body: VisitBody): void {
    void body.ready.then(() => {
      this.loaded.add(body);
      this.renderWanted = true;
    });
  }

  /** The Muses whose bodies are still being made. */
  private get loading(): Set<string> {
    return new Set(this.scene.actors.filter((a) => {
      const b = this.bodies.get(a.id);
      return !b || !this.loaded.has(b);
    }).map((a) => a.id));
  }

  /** Write the take again from the scene as it is. */
  private rewrite(): void {
    this.dirty = false;
    this.spent.rewrites++;
    const R = this.world.scene.growth.radius;
    const H = this.height;
    const ground = (dir: Vector3): number => this.standAt(dir);
    this.pieces?.set(this.scene.pieces, R, H, ground);
    unwarpPoint(this.world.scene.warp, this.world.scene.rig.camera.position, this.camera);
    const world: TakeWorld = {
      R,
      H,
      ground,
      route: (from, to) => this.route(from, to, R),
      piece: (id) => this.pieces?.spot(id) ?? null,
      camera: this.camera.clone(),
    };
    this.take = Take.write(this.scene, world);
    this.renderWanted = true;
  }

  private route(from: Vector3, to: Vector3, R: number): Route {
    const key = `${from.x.toFixed(7)},${from.y.toFixed(7)},${from.z.toFixed(7)}>${to.x.toFixed(7)},${to.y.toFixed(7)},${to.z.toFixed(7)}`;
    const known = this.routeCache.get(key);
    if (known) return known;
    if (this.quick) {
      const path = new Path(R);
      path.add(from);
      path.line(to, 0.2);
      return { path, blocked: false };
    }
    const route = planRoute(from, to, R, this.routeGround);
    if (this.routeCache.size > 400) this.routeCache.clear();
    this.routeCache.set(key, route);
    return route;
  }

  /** The marks to draw: each Muse's start and its beats' marks, the pieces, the routes, the Muses' tags, the gumball on what is picked. */
  private overlayScene(): OverlayScene {
    const marks: OverlayMark[] = [];
    const routes: OverlayRoute[] = [];
    const p = this.picked;
    const R = this.world.scene.growth.radius;
    for (const actor of this.scene.actors) {
      const mine = actor.id === p.actor;
      marks.push({ key: `start:${actor.id}`, dir: vec(actor.start.dir), facing: vec(actor.start.facing), label: '', colour: actor.colour, kind: 'start', picked: mine && !p.beat && !p.piece, dim: !mine });
      actor.beats.forEach((b, i) => {
        if (!b.mark || ACTION[b.action].piece) return;
        marks.push({ key: `beat:${b.id}`, dir: vec(b.mark.dir), facing: vec(b.mark.facing), label: String(i + 1), colour: actor.colour, kind: 'beat', picked: b.id === p.beat, dim: !mine });
      });
      const part = this.take?.actors.get(actor.id);
      part?.routes.forEach((r, k) => routes.push({ key: `${actor.id}:${r.beat}:${k}`, points: r.path.points, colour: actor.colour, blocked: r.blocked, dim: !mine }));
    }
    for (const piece of this.scene.pieces) {
      marks.push({ key: `piece:${piece.id}`, dir: vec(piece.at.dir), facing: vec(piece.at.facing), label: piece.kind === 'bench' ? 'B' : 'S', colour: '#7a5b33', kind: piece.kind, picked: piece.id === p.piece, dim: false });
    }
    const actors = this.scene.actors
      .filter((a) => a.shown)
      .flatMap((a) => {
        const body = this.bodies.get(a.id);
        if (!body) return [];
        const w = body.where;
        return [{ key: `actor:${a.id}`, feet: w.dir.clone().multiplyScalar(R + w.height), up: w.dir.clone(), name: a.name, colour: a.colour, picked: a.id === p.actor }];
      });
    // (the gumball steps aside while the take plays)
    const gumball = this.paused === null ? null : p.piece ? `piece:${p.piece}` : p.beat ? (marks.some((m) => m.key === `beat:${p.beat}`) ? `beat:${p.beat}` : null) : p.actor ? `start:${p.actor}` : null;
    return { marks, routes, actors, gumball };
  }

  // ---- keys ------------------------------------------------------------------------------------------------

  private toggle(): void {
    this.shown = !this.shown;
    this.panel.visible = this.shown;
    this.overlay.visible = this.shown;
  }

  private key(e: KeyboardEvent): void {
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.placing) this.placing = null;
      else this.picked.beat = null;
      this.renderWanted = true;
      if (typing) (t as HTMLElement).blur();
      return;
    }
    if (typing) return;
    let used = true;
    if (meta && k === 'z') this.undoLast(e.shiftKey);
    else if (meta && k === 'y') this.undoLast(true);
    else if (meta || e.altKey) used = false;
    else if (k === ' ') {
      if (this.paused === null) this.pause();
      else this.play();
    } else if (k === 'h') this.toggle();
    else if (e.key === 'Home') this.seek(0, true);
    else if (k === ',' || k === '.') {
      this.pause();
      this.seek(this.time + (k === '.' ? 1 : -1) / 30, false);
    } else if ((k === 'delete' || k === 'backspace') && this.picked.beat) this.removeBeat(this.picked.beat);
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // ---- the dev harness: window.__director ----------------------------------------------------------------

  private installProbe(): void {
    (window as unknown as { __director: unknown }).__director = {
      ready: this.ready,
      scene: () => JSON.parse(sceneText(this.scene)) as unknown,
      setScene: (scene: unknown) => {
        const s = parseScene(JSON.stringify(scene), this.planet);
        if (s) this.change(s);
        return s !== null;
      },
      take: () => ({
        length: this.take?.length ?? 0,
        settled: this.take?.settled ?? true,
        actors: [...(this.take?.actors.values() ?? [])].map((a) => ({ id: a.id, end: a.end, beats: Object.fromEntries(a.beats), problems: Object.fromEntries(a.problems), blocked: a.routes.filter((r) => r.blocked).map((r) => r.beat) })),
      }),
      time: () => this.time,
      play: () => this.play(),
      pause: () => this.pause(),
      seek: (t: number) => this.seek(t, false),
      select: (actor: string | null, beat: string | null = null, piece: string | null = null) => this.select(actor, beat, piece),
      hide: (on: boolean) => {
        if (on === this.shown) this.toggle();
      },
      where: () => Object.fromEntries([...this.bodies].map(([id, b]) => [id, { dir: b.where.dir.toArray(), height: b.where.height, heading: b.where.heading.toArray() }])),
      abilities: () => this.abilities,
      /** The director's own work a frame since last asked (ms), and the takes written since. */
      costs: () => {
        const n = Math.max(1, this.spent.frames);
        const out = { update: this.spent.update / n, frame: this.spent.frame / n, frames: this.spent.frames, rewrites: this.spent.rewrites };
        Object.assign(this.spent, { update: 0, frame: 0, frames: 0, rewrites: 0 });
        return out;
      },
      /** Whether every Muse's body is in. */
      loaded: () => this.loading.size === 0,
      /** A mark a step ahead of where a Muse is left, toward a bearing (rad from its facing), this far (m): for scripted checks. */
      markFrom: (actor: string, distance: number, bearing = 0) => {
        const a = this.scene.actors.find((x) => x.id === actor);
        if (!a) return null;
        const { dir, facing } = this.lastPlace(a);
        const way = facing.clone().applyAxisAngle(dir, bearing);
        const to = travel(dir, way, distance / this.world.scene.growth.radius, new Vector3());
        return markOf(to, tangentToward(to, travel(dir, way, (distance + 1) / this.world.scene.growth.radius, new Vector3()), new Vector3()));
      },
      pick: (x: number, y: number) => this.world.scene.pick(x, y)?.dir.toArray() ?? null,
      /** A mark on the ground under a point of the screen (normalised device coordinates), facing the camera. */
      markAt: (x: number, y: number) => {
        const hit = this.world.scene.pick(x, y);
        if (!hit) return null;
        const dir = hit.dir.clone().normalize();
        return markOf(dir, this.cameraWay(dir) ?? tangentToward(dir, new Vector3(0, 0, 1), new Vector3()));
      },
    };
  }
}
