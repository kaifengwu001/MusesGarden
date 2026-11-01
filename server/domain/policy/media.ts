// What each hop of a trip looks for: a reel, a post, an article or a video.
import type { Draw, MediaKind, MuseState, Temperament } from '../../../src/muse/contract';
import { categorical } from '../rng';
import { MEDIUM_BASE, MEDIUM_TILT } from './constants';

const KINDS: readonly MediaKind[] = ['reel', 'post', 'video', 'article'];
/** +1: the kind suits a focused, curious Muse; −1: a whimsical one who wants something new. */
const DEPTH: Readonly<Record<MediaKind, 1 | -1>> = { reel: -1, post: -1, video: 1, article: 1 };

/** The chance of each kind for this temperament; the base mix when every trait is 0.5. */
export function mediumMix(t: Temperament): Readonly<Record<MediaKind, number>> {
  const lean = (t.focus + t.curiosity - t.whimsy - t.novelty) / 2;
  const weights = KINDS.map((k) => MEDIUM_BASE[k] * (1 + MEDIUM_TILT * lean * DEPTH[k]));
  const total = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(KINDS.map((k, i) => [k, weights[i] / total])) as Record<MediaKind, number>;
}

export function mediumFor(t: Temperament, u: number): MediaKind {
  const mix = mediumMix(t);
  return KINDS[Math.max(0, categorical(u, KINDS.map((k) => mix[k])))];
}

/** The drawn kind, then the others from most to least favoured. */
export function hopMedia(s: MuseState, k: number, draw: Draw): readonly MediaKind[] {
  const first = mediumFor(s.temperament, draw('hop.medium', k));
  const mix = mediumMix(s.temperament);
  return [first, ...KINDS.filter((x) => x !== first).sort((a, b) => mix[b] - mix[a])];
}
