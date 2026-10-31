// What Muse does next when an episode ends: a semi-Markov choice over travel, rest and visits, weighted by
// its traits, its interests, its recent work and the budgets left today. No clock hour appears anywhere.
import type { Draw, Instant, MuseState } from '../../../src/muse/contract';
import { instant } from '../ids';
import { salienceAt } from '../interests';
import { categorical, lognormal } from '../rng';
import { core } from '../state';
import { localDay } from '../time';
import {
  BEYOND_MEDIAN_MS,
  BEYOND_SIGMA,
  RECENT_WORK_FULL_MS,
  RECENT_WORK_WINDOW_MS,
  REST_BASE,
  REST_CAP_MS,
  REST_MEDIAN_MS,
  REST_PER_WORK,
  REST_SIGMA,
  SOCIAL_BUDGET_MS,
  TRAVEL_BASE,
  VISIT_SCALE,
} from './constants';

const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** min(1, work in the last 12 h ÷ 6 h). */
export function recentWork(s: MuseState, now: number): number {
  const x = core(s);
  const from = now - RECENT_WORK_WINDOW_MS;
  let ms = x.workSince === null ? 0 : overlap(x.workSince, now, from, now);
  for (const w of x.recentWork) ms += overlap(w.start, w.end, from, now);
  return Math.min(1, ms / RECENT_WORK_FULL_MS);
}

/** Today's counters, or zero if nothing has been counted yet on the owner's current day. */
function today(s: MuseState, now: number): { readonly restMs: number; readonly socialMs: number } {
  return s.day.day === localDay(now, s.seed.timezone) ? s.day : { restMs: 0, socialMs: 0 };
}

export const socialBudget = (s: MuseState): number => SOCIAL_BUDGET_MS * s.temperament.sociability;

export function socialLeft(s: MuseState, now: number): number {
  return Math.max(0, socialBudget(s) - today(s, now).socialMs);
}

export function restLeft(s: MuseState, now: number): number {
  return Math.max(0, REST_CAP_MS - today(s, now).restMs);
}

const ACTIVITIES = ['travel', 'rest', 'visit'] as const;

export function next(s: MuseState, now: Instant, draw: Draw, friendFree: boolean): 'rest' | 'travel' | 'visit' {
  const { curiosity, sociability } = s.temperament;
  let top = 0;
  for (const i of s.interests.values()) top = Math.max(top, salienceAt(i, now));
  const budget = socialBudget(s);
  const weights = [
    TRAVEL_BASE + curiosity + top,
    restLeft(s, now) > 0 ? REST_BASE + REST_PER_WORK * recentWork(s, now) : 0,
    friendFree && budget > 0 ? VISIT_SCALE * sociability * (socialLeft(s, now) / budget) : 0,
  ];
  return ACTIVITIES[Math.max(0, categorical(draw('life.next'), weights))];
}

/** Lognormal around 40 min, cut to the rest left today. */
export function restUntil(s: MuseState, now: Instant, draw: Draw): Instant {
  return instant(now + Math.min(lognormal(draw('rest.ms'), REST_MEDIAN_MS, REST_SIGMA), restLeft(s, now)));
}

export function beyondUntil(_s: MuseState, now: Instant, draw: Draw): Instant {
  return instant(now + lognormal(draw('beyond.ms'), BEYOND_MEDIAN_MS, BEYOND_SIGMA));
}
