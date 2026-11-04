import { BOUNCE_LENGTH, COOK, FISH, FLUFF_LENGTH, WAVE_LENGTH, YAWN_LENGTH, type Expression } from '../life/museRig';
import type { MuseLook } from '../muse/contract';

// What the director can have a Muse do (director.ts, timeline.ts): the moves Muse's rig already has (museRig.ts), each
// as Muse's own life plays it on the planet (museRoam.ts): its gestures, sitting in the grass and napping, its things
// out of its belly pocket (the can, the rod, the ladle), and up onto a bench. Each says how its length is given (held
// so many seconds, or done so many times), what it needs (the rig's moves, the things, a bench or a stove placed on the
// planet), and the posture it leaves Muse in.

export type ActionId = 'stand' | 'wave' | 'bounce' | 'petted' | 'fluff' | 'yawn' | 'sit' | 'nap' | 'water' | 'fish' | 'cook' | 'perch';

/** What Muse is left in after an action: on its feet, sat in the grass, lying asleep, up on a bench. */
export type Posture = 'stand' | 'sit' | 'lie' | 'perch';

export interface ActionDef {
  readonly id: ActionId;
  readonly label: string;
  readonly group: 'Gestures' | 'Sitting and lying' | 'With its things' | 'On a seat';
  /** How long: held for so many seconds, or done so many times. */
  readonly unit: 'seconds' | 'times';
  readonly amount: number;
  readonly min: number;
  readonly max: number;
  /** For times: about how long each takes (s), for the panel. */
  readonly each?: number;
  readonly posture: Posture;
  /** Whether it needs the rig's moves (beyond a walk, a wave and a look) or the things in its mittens. */
  readonly needs: 'moves' | 'props' | null;
  /** The set piece it is done at, which sets where it stands and the way it faces. */
  readonly piece?: 'bench' | 'stove';
  /** A note for the panel. */
  readonly note?: string;
}

export const ACTIONS: readonly ActionDef[] = [
  { id: 'stand', label: 'Stand', group: 'Gestures', unit: 'seconds', amount: 3, min: 0.5, max: 120, posture: 'stand', needs: null, note: 'Stands at its mark, looking about.' },
  { id: 'wave', label: 'Wave', group: 'Gestures', unit: 'times', amount: 1, min: 1, max: 8, each: WAVE_LENGTH + 0.35, posture: 'stand', needs: null },
  { id: 'bounce', label: 'Bounce for joy', group: 'Gestures', unit: 'times', amount: 1, min: 1, max: 8, each: BOUNCE_LENGTH + 0.25, posture: 'stand', needs: 'moves' },
  { id: 'petted', label: 'Being petted', group: 'Gestures', unit: 'seconds', amount: 3.5, min: 0.8, max: 30, posture: 'stand', needs: 'moves', note: 'Leans into a hand: > < eyes, hearts, its fur up on a long hold, shaken out after.' },
  { id: 'fluff', label: 'Fur stands up', group: 'Gestures', unit: 'times', amount: 1, min: 1, max: 6, each: FLUFF_LENGTH + 0.3, posture: 'stand', needs: 'moves' },
  { id: 'yawn', label: 'Yawn', group: 'Gestures', unit: 'times', amount: 1, min: 1, max: 4, each: YAWN_LENGTH + 0.3, posture: 'stand', needs: 'moves' },
  { id: 'sit', label: 'Sit in the grass', group: 'Sitting and lying', unit: 'seconds', amount: 10, min: 1, max: 300, posture: 'sit', needs: 'moves', note: 'Plops down; gets up again before it walks on.' },
  { id: 'nap', label: 'Nap', group: 'Sitting and lying', unit: 'seconds', amount: 20, min: 2, max: 300, posture: 'lie', needs: 'moves', note: 'Plops down and lies back asleep; wakes and gets up before it walks on.' },
  { id: 'water', label: 'Water the flowers', group: 'With its things', unit: 'times', amount: 3, min: 1, max: 10, each: 5, posture: 'stand', needs: 'props', note: 'The can out of its pocket, poured now long, now short; kept out for the next watering.' },
  { id: 'fish', label: 'Fish', group: 'With its things', unit: 'times', amount: 2, min: 1, max: 8, each: FISH.period, posture: 'sit', needs: 'props', note: 'Sits on the bank, the rod out; not every catch bites. Face it to the water.' },
  { id: 'cook', label: 'Cook at the stove', group: 'With its things', unit: 'times', amount: 2, min: 1, max: 8, each: COOK.period, posture: 'stand', needs: 'props', piece: 'stove', note: 'Stirs the pot on a stove you place, tasting now and then.' },
  { id: 'perch', label: 'Sit on the bench', group: 'On a seat', unit: 'seconds', amount: 15, min: 2, max: 300, posture: 'perch', needs: 'moves', piece: 'bench', note: 'Hops up onto a bench you place, legs swinging, humming; hops down before it walks on.' },
];

export const ACTION: Readonly<Record<ActionId, ActionDef>> = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionDef>;

export const isActionId = (v: unknown): v is ActionId => typeof v === 'string' && Object.hasOwn(ACTION, v);

/** The faces a beat can hold on a Muse, every part of its face set (as the studio's: studio.ts). */
export const FACES: Readonly<Record<string, Expression | null>> = {
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
export const PLAIN_FACES = ['its own', 'smiling', 'beaming', 'sleepy'];

/** The muses' looks, each by the name of the friend in the cast who wears it (server/fixtures/cast.json), or its own. */
export const LOOKS: readonly { readonly look: MuseLook; readonly name: string }[] = [
  { look: 'tpose6', name: 'Momo' },
  { look: 'muse0', name: 'Dorie' },
  { look: 'muse1', name: 'Fife' },
  { look: 'muse2', name: 'Potato' },
  { look: 'muse3', name: 'Nemo' },
  { look: 'muse4', name: 'Muse 4' },
  { look: 'muse5', name: 'Kiki' },
  { look: 'muse6', name: 'Hoji' },
  { look: 'muse7', name: 'Van' },
  { look: 'muse8', name: 'Moss' },
  { look: 'muse9', name: 'Muse 9' },
  { look: 'muse10', name: 'Muse 10' },
  { look: 'muse11', name: 'Pooh' },
  { look: 'muse12', name: 'Pina' },
];

const LOOK = /^(tpose6|muse([0-9]|1[0-2]))$/;
export const isLook = (v: unknown): v is MuseLook => typeof v === 'string' && LOOK.test(v);

/** The actors' colours on the panel, the timeline and the planet (marks, routes). */
export const COLOURS = ['#e05a4f', '#2f7cc4', '#4f8f34', '#b0721c', '#8a6fd0', '#c2566e'] as const;

/** How many Muses a shot holds at most (the planet's own and three more). */
export const MAX_ACTORS = 4;
