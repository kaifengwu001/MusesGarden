import { describe, expect, it } from 'vitest';
import type { MediaKind, Temperament } from '../../../src/muse/contract';
import { MEDIUM_BASE } from './constants';
import { hopMedia, mediumFor, mediumMix } from './media';
import { emptyState } from '../state';
import type { Draw, MuseId } from '../../../src/muse/contract';

const neutral: Temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };
const deep: Temperament = { ...neutral, focus: 0.9, curiosity: 0.8, whimsy: 0.2, novelty: 0.2 };
const playful: Temperament = { ...neutral, focus: 0.2, curiosity: 0.4, whimsy: 0.9, novelty: 0.9 };

/** How often each kind comes up over n evenly spread draws. */
function tally(t: Temperament, n = 10_000): Record<MediaKind, number> {
  const out: Record<MediaKind, number> = { reel: 0, post: 0, video: 0, article: 0 };
  for (let i = 0; i < n; i++) out[mediumFor(t, (i + 0.5) / n)]++;
  return out;
}

describe('the kind a hop looks for', () => {
  it('follows the base mix for a Muse whose traits are all 0.5', () => {
    const mix = mediumMix(neutral);
    for (const k of Object.keys(MEDIUM_BASE) as MediaKind[]) expect(mix[k]).toBeCloseTo(MEDIUM_BASE[k], 9);
    expect(tally(neutral)).toEqual({ reel: 2500, post: 2500, video: 1500, article: 3500 });
  });

  it('tilts a focused, curious Muse toward articles and videos, and a whimsical one toward reels and posts', () => {
    const d = mediumMix(deep);
    const p = mediumMix(playful);
    expect(d.article + d.video).toBeGreaterThan(0.65);
    expect(p.reel + p.post).toBeGreaterThan(0.65);
    expect(d.article).toBeGreaterThan(p.article);
    expect(p.reel).toBeGreaterThan(d.reel);
    for (const mix of [d, p]) expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('still leaves every kind possible at the extremes', () => {
    const extreme: Temperament = { ...neutral, focus: 1, curiosity: 1, whimsy: 0, novelty: 0 };
    expect(Math.min(...Object.values(mediumMix(extreme)))).toBeGreaterThan(0.03);
  });

  it('orders the rest after the drawn kind by what the Muse favours', () => {
    const muse = { ...emptyState({ id: 'lark' as MuseId, name: 'Lark', worldSeed: 1, timezone: 'UTC' }), temperament: playful };
    const draw: Draw = () => 0.99;
    expect(hopMedia(muse, 0, draw)).toEqual(['article', 'reel', 'post', 'video']);
  });
});
