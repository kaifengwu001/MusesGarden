import { hash32, salt, unit } from '../../core/hash';
import type { PhotoLook } from '../../garden/types';
import type { PhotoSubject } from '../../muse/contract';

/** What a postcard's photo shows: one of the subjects of Muse's photos, the whole planet from beyond it, or an invitation. */
export type StillKey = PhotoSubject | 'beyond' | 'invitation';

/**
 * The photos a postcard can show, by what each shows: file names in this folder. The numbered ones are stills of the
 * meadow, rendered by tools/workflows/drive-app/scripts/postcard-stills.mjs (npm run postcard-stills). (The named
 * ones beside them, the first stand-ins, are kept for the placeholder post only.)
 */
export const STILLS: Readonly<Record<StillKey, readonly string[]>> = {
  scenery: ['scenery-1.jpg', 'scenery-2.jpg', 'scenery-3.jpg', 'scenery-4.jpg', 'scenery-5.jpg', 'scenery-6.jpg', 'scenery-7.jpg', 'scenery-8.jpg'],
  sky: ['sky-1.jpg', 'sky-2.jpg', 'sky-3.jpg', 'sky-4.jpg'],
  closeup: ['closeup-1.jpg', 'closeup-2.jpg', 'closeup-3.jpg', 'closeup-4.jpg', 'closeup-5.jpg', 'closeup-6.jpg', 'closeup-7.jpg', 'closeup-8.jpg', 'closeup-9.jpg', 'closeup-10.jpg'],
  creature: ['creature-1.jpg', 'creature-2.jpg', 'creature-3.jpg', 'creature-4.jpg', 'creature-5.jpg'],
  find: ['find-1.jpg', 'find-2.jpg', 'find-3.jpg'],
  selfie: ['selfie-1.jpg', 'selfie-2.jpg', 'selfie-3.jpg', 'selfie-4.jpg', 'selfie-5.jpg', 'selfie-6.jpg', 'selfie-7.jpg', 'selfie-8.jpg', 'selfie-9.jpg', 'selfie-10.jpg', 'selfie-11.jpg', 'selfie-12.jpg', 'selfie-13.jpg', 'selfie-14.jpg'],
  work: ['work-1.jpg', 'work-2.jpg', 'work-3.jpg', 'work-4.jpg', 'work-5.jpg', 'work-6.jpg'],
  home: ['home-1.jpg', 'home-2.jpg', 'home-3.jpg', 'home-4.jpg', 'home-5.jpg', 'home-6.jpg', 'home-7.jpg', 'home-8.jpg', 'home-9.jpg', 'home-10.jpg', 'home-11.jpg', 'home-12.jpg'],
  friend: ['friend-1.jpg', 'friend-2.jpg', 'friend-3.jpg', 'friend-4.jpg', 'friend-5.jpg', 'friend-6.jpg'],
  'new-friend': ['new-friend-1.jpg', 'new-friend-2.jpg', 'new-friend-3.jpg'],
  beyond: ['beyond-1.jpg', 'beyond-2.jpg', 'beyond-3.jpg'],
  invitation: ['invitation-1.jpg', 'invitation-2.jpg', 'invitation-3.jpg'],
};

/** A photo that needs a still: its key, and the day it arrived. */
export interface PhotoToShow {
  readonly id: string;
  readonly key: StillKey;
  readonly day: string;
}

export interface Shown {
  readonly file: string;
  readonly look: PhotoLook;
}

export const PLAIN: PhotoLook = { flip: false, zoom: 1, x: 0.5, y: 0.5, tone: 'none' };
const TONES = ['warm', 'cool', 'dusk', 'mist', 'bright'] as const;

/** A still's look on its `round`th time round: as rendered the first time; after that mirrored or not, cropped in on its own spot, toned for the round. */
function lookFor(seed: string, key: StillKey, round: number, file: string): PhotoLook {
  if (round === 0) return PLAIN;
  const h = salt(`${seed}|${key}|${round}|${file}`);
  return {
    flip: round % 2 === 1 ? true : (h & 1) === 1,
    zoom: Number((1.14 + 0.18 * unit(h)).toFixed(3)),
    x: Number((0.25 + 0.5 * unit(hash32(h))).toFixed(3)),
    y: Number((0.3 + 0.4 * unit(hash32(h ^ 0x9e3779b9))).toFixed(3)),
    tone: TONES[(round - 1) % TONES.length],
  };
}

/** A round's order of a key's stills, shuffled by the seed, never opening on the still the last round ended on. */
function round(stills: readonly string[], seed: string, after: string | null): string[] {
  const order = [...stills];
  for (let i = order.length - 1; i > 0; i--) {
    const j = salt(`${seed}|${i}`) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && order[0] === after) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/**
 * The still each photo shows, in the order Muse took them (`photos`, oldest first; `seed`, the Muse). A key's stills
 * are dealt in shuffled rounds, so none comes again before all the others have been shown, and a still shown already
 * that day is passed over for the next. A still that comes round again has a look of its own (lookFor). Taking more
 * photos never changes what the earlier ones show.
 */
export function assignStills(photos: readonly PhotoToShow[], seed: string): Map<string, Shown> {
  const out = new Map<string, Shown>();
  const rounds = new Map<StillKey, { n: number; order: string[]; next: number }>();
  const shownOn = new Map<string, Set<string>>();
  for (const p of photos) {
    let r = rounds.get(p.key);
    if (!r || r.next >= r.order.length) {
      const n = r ? r.n + 1 : 0;
      r = { n, order: round(STILLS[p.key], `${seed}|${p.key}|${n}`, r ? r.order[r.order.length - 1] : null), next: 0 };
      rounds.set(p.key, r);
    }
    const day = shownOn.get(p.day) ?? new Set<string>();
    shownOn.set(p.day, day);
    const fresh = r.order.findIndex((f, k) => k >= r.next && !day.has(f));
    if (fresh > r.next) [r.order[r.next], r.order[fresh]] = [r.order[fresh], r.order[r.next]];
    const file = r.order[r.next++];
    day.add(file);
    out.set(p.id, { file, look: lookFor(seed, p.key, r.n, file) });
  }
  return out;
}
