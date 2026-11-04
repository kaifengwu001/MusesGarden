import { ACTION, COLOURS, FACES, isActionId, isLook, type ActionId } from './library';
import type { MuseLook, PlanetId } from '../muse/contract';

// A director's scene (director.ts): who is on the planet, where each starts, and its beats in order: each beat an
// action from the library (library.ts) done at a mark (where it walks to, the way it faces there), for so long, from a
// cue; and the set pieces placed about (benches, stoves). Plain data, as kept in the browser and as a JSON file:
// unit directions and tangents in planet space, so a scene is for one planet (at one seed, any size).

export type Vec3 = readonly [number, number, number];

/** A place on the planet: a unit direction, and the way a Muse faces there (a unit tangent). */
export interface Mark {
  readonly dir: Vec3;
  readonly facing: Vec3;
}

/** The way a Muse faces for a beat: its mark's arrow, the camera (as it is when the take is set), or another Muse. */
export type Facing = { readonly kind: 'mark' } | { readonly kind: 'camera' } | { readonly kind: 'actor'; readonly actor: string };

/** Where its head turns during a beat: its own way (as the action has it), the camera, another Muse, or ahead. */
export type Gaze = { readonly kind: 'own' } | { readonly kind: 'camera' } | { readonly kind: 'actor'; readonly actor: string } | { readonly kind: 'ahead' };

/**
 * When a beat sets off: right after the last one, not before a time (s into the take), or not before another Muse's
 * beat sets off, arrives at its mark (begins what it does there), or ends.
 */
export type Cue =
  | { readonly kind: 'after' }
  | { readonly kind: 'at'; readonly time: number }
  | { readonly kind: 'event'; readonly actor: string; readonly beat: string; readonly when: 'starts' | 'arrives' | 'ends' };

export interface Beat {
  readonly id: string;
  readonly action: ActionId;
  /** Where it goes to do it: a mark of its own, or null where the last beat left it (a seat or a stove: the piece's own place). */
  readonly mark: Mark | null;
  /** The bench or stove it is done at. */
  readonly piece: string | null;
  readonly facing: Facing;
  /** Seconds held, or times done (the action's unit). */
  readonly amount: number;
  readonly cue: Cue;
  /** A face held over it (library.ts FACES), and where it looks. */
  readonly face: string;
  readonly gaze: Gaze;
  /** Its own variety (a pour's length, a catch's luck). */
  readonly seed: number;
}

export interface Actor {
  readonly id: string;
  readonly name: string;
  readonly look: MuseLook;
  /** The planet's own Muse (Momo on the meadow): always in the scene, never deleted. */
  readonly host: boolean;
  readonly shown: boolean;
  readonly colour: string;
  /** Where it stands as the take begins. */
  readonly start: Mark;
  readonly beats: readonly Beat[];
}

export interface Piece {
  readonly id: string;
  readonly kind: 'bench' | 'stove';
  /** Its middle on the planet, and the way its front faces. */
  readonly at: Mark;
}

export interface DirectorScene {
  readonly version: 1;
  readonly planet: PlanetId;
  readonly actors: readonly Actor[];
  readonly pieces: readonly Piece[];
  /** Whether the take plays over again from its start once it is over. */
  readonly loop: boolean;
}

let counter = 0;
/** A new id, unique on this page and unlikely to meet one from a file. */
export function newId(prefix: string): string {
  counter++;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** A beat of an action, at a mark (or where it is), with the action's own length and no cue. */
export function newBeat(action: ActionId, mark: Mark | null, piece: string | null = null): Beat {
  return {
    id: newId('b'),
    action,
    mark,
    piece,
    facing: { kind: 'mark' },
    amount: ACTION[action].amount,
    cue: { kind: 'after' },
    face: 'its own',
    gaze: { kind: 'own' },
    seed: Math.floor(Math.random() * 1e6),
  };
}

export function emptyScene(planet: PlanetId): DirectorScene {
  return { version: 1, planet, actors: [], pieces: [], loop: false };
}

// ---- reading a scene back (from the browser's storage or a file): whatever is malformed is dropped ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;

function vec(v: unknown, unit: boolean): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return null;
  const [x, y, z] = v;
  const l = Math.hypot(x, y, z);
  if (l < 1e-9) return null;
  // (as written where it is unit already: a scene reads back exactly)
  return unit && Math.abs(l - 1) > 1e-9 ? [x / l, y / l, z / l] : [x, y, z];
}

function mark(v: unknown): Mark | null {
  const m = (v ?? {}) as Record<string, unknown>;
  const dir = vec(m.dir, true);
  const facing = vec(m.facing, true);
  if (!dir || !facing) return null;
  // (the facing made tangent to the direction, where it isn't)
  const d = facing[0] * dir[0] + facing[1] * dir[1] + facing[2] * dir[2];
  if (Math.abs(d) < 1e-9) return { dir, facing };
  const t: [number, number, number] = [facing[0] - d * dir[0], facing[1] - d * dir[1], facing[2] - d * dir[2]];
  const l = Math.hypot(...t);
  if (l < 1e-6) return null;
  return { dir, facing: [t[0] / l, t[1] / l, t[2] / l] };
}

function facing(v: unknown): Facing {
  const f = (v ?? {}) as Record<string, unknown>;
  if (f.kind === 'camera') return { kind: 'camera' };
  if (f.kind === 'actor' && isStr(f.actor)) return { kind: 'actor', actor: f.actor };
  return { kind: 'mark' };
}

function gaze(v: unknown): Gaze {
  const g = (v ?? {}) as Record<string, unknown>;
  if (g.kind === 'camera' || g.kind === 'ahead') return { kind: g.kind };
  if (g.kind === 'actor' && isStr(g.actor)) return { kind: 'actor', actor: g.actor };
  return { kind: 'own' };
}

function cue(v: unknown): Cue {
  const c = (v ?? {}) as Record<string, unknown>;
  if (c.kind === 'at' && isNum(c.time)) return { kind: 'at', time: Math.max(0, c.time) };
  if (c.kind === 'event' && isStr(c.actor) && isStr(c.beat) && (c.when === 'starts' || c.when === 'arrives' || c.when === 'ends')) return { kind: 'event', actor: c.actor, beat: c.beat, when: c.when };
  return { kind: 'after' };
}

function beat(v: unknown): Beat | null {
  const b = (v ?? {}) as Record<string, unknown>;
  if (!isStr(b.id) || !isActionId(b.action)) return null;
  const def = ACTION[b.action];
  const amount = isNum(b.amount) ? Math.min(def.max, Math.max(def.min, def.unit === 'times' ? Math.round(b.amount) : b.amount)) : def.amount;
  return {
    id: b.id,
    action: b.action,
    mark: b.mark === null || b.mark === undefined ? null : mark(b.mark),
    piece: isStr(b.piece) ? b.piece : null,
    facing: facing(b.facing),
    amount,
    cue: cue(b.cue),
    face: typeof b.face === 'string' && Object.hasOwn(FACES, b.face) ? b.face : 'its own',
    gaze: gaze(b.gaze),
    seed: isNum(b.seed) ? Math.floor(b.seed) : 0,
  };
}

function actor(v: unknown, i: number): Actor | null {
  const a = (v ?? {}) as Record<string, unknown>;
  const start = mark(a.start);
  if (!isStr(a.id) || !start) return null;
  return {
    id: a.id,
    name: isStr(a.name) ? a.name.slice(0, 40) : `Muse ${i + 1}`,
    look: isLook(a.look) ? a.look : 'tpose6',
    host: a.host === true,
    shown: a.shown !== false,
    colour: typeof a.colour === 'string' && /^#[0-9a-f]{6}$/i.test(a.colour) ? a.colour : COLOURS[i % COLOURS.length],
    start,
    beats: Array.isArray(a.beats) ? a.beats.map(beat).filter((b): b is Beat => b !== null) : [],
  };
}

function piece(v: unknown): Piece | null {
  const p = (v ?? {}) as Record<string, unknown>;
  const at = mark(p.at);
  if (!isStr(p.id) || (p.kind !== 'bench' && p.kind !== 'stove') || !at) return null;
  return { id: p.id, kind: p.kind, at };
}

/** A scene read back for a planet: null if it isn't one, or is another planet's. */
export function parseScene(text: string, planet: PlanetId): DirectorScene | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const s = (raw ?? {}) as Record<string, unknown>;
  if (s.version !== 1 || s.planet !== planet) return null;
  const actors = (Array.isArray(s.actors) ? s.actors : []).map(actor).filter((a): a is Actor => a !== null);
  // (one host at most, the first; ids unique)
  const seen = new Set<string>();
  let host = false;
  const kept = actors
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .map((a) => {
      const isHost = a.host && !host;
      host ||= isHost;
      return isHost === a.host ? a : { ...a, host: isHost };
    });
  const pieces = (Array.isArray(s.pieces) ? s.pieces : []).map(piece).filter((p): p is Piece => p !== null);
  return { version: 1, planet, actors: kept, pieces, loop: s.loop === true };
}

export function sceneText(scene: DirectorScene): string {
  return JSON.stringify(scene, null, 1);
}
