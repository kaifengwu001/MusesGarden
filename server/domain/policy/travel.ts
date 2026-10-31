// Trips: beyond or on the planet, a new area or a revisit, which topic, and how a trip runs hop by hop.
import type { Candidate, Draw, Interest, Judgment, MuseState, QuestionId, RegionKey, TopicKey, TripStart } from '../../../src/muse/contract';
import { farRegion, regionForNewTopic } from '../atlas';
import { salienceAt, wOwner } from '../interests';
import { categorical, lognormal, softmax } from '../rng';
import { DAY_MS } from '../time';
import {
  BEYOND_SCALE,
  HOP_MEDIAN_MS,
  HOP_SIGMA,
  KEEP_MAX,
  KEEP_THRESHOLD,
  NOVELTY_SCALE,
  PICK_AFFINITY,
  PICK_FATIGUE,
  PICK_FATIGUE_TAU_MS,
  PICK_OWNER,
  PICK_OWNER_RECENT_MS,
  PICK_QUESTION,
  PICK_SALIENCE,
  PICK_TAU,
  SERENDIPITY_SCALE,
  UNLOCK_PRESSURE_PER_DAY,
} from './constants';

/** The oldest open question about `topic`. */
function questionOn(s: MuseState, topic: TopicKey): QuestionId | null {
  let best: { id: QuestionId; at: number } | null = null;
  for (const q of s.questions.values()) if (q.topic === topic && (!best || q.openedAt < best.at)) best = { id: q.id, at: q.openedAt };
  return best?.id ?? null;
}

/** Decides beyond first (null), then a new area with P = min(1, 0.3·novelty + 0.1·days since unlock), else a revisit. */
export function startTrip(s: MuseState, now: number, draw: Draw): TripStart | null {
  const { curiosity, sociability, novelty } = s.temperament;
  if (draw('trip.beyond') < BEYOND_SCALE * curiosity * sociability) return null;
  const known = revisitable(s);
  const pNew = Math.min(1, NOVELTY_SCALE * novelty + (UNLOCK_PRESSURE_PER_DAY * (now - s.lastUnlockAt)) / DAY_MS);
  if (known.length === 0 || draw('trip.new-area') < pNew) return newArea(s, now, draw);
  return revisit(s, now, draw, known);
}

function newArea(s: MuseState, now: number, draw: Draw): TripStart {
  const pick = draw('trip.serendipity') < SERENDIPITY_SCALE * s.temperament.curiosity ? null : newTopic(s, now);
  if (!pick) return { kind: 'serendipity', region: farRegion(s, draw) };
  return {
    kind: 'new-area',
    topic: pick.topic,
    region: regionForNewTopic(s, pick.relatedTo, draw),
    relatedTo: pick.relatedTo,
    question: questionOn(s, pick.topic),
  };
}

/** Where a new area's topic comes from: an owner or soul seed not yet visited, the frontier, then an open question. */
function newTopic(s: MuseState, now: number): { topic: TopicKey; relatedTo: TopicKey | null } | null {
  const seeds = [...s.interests.values()]
    .filter((i) => i.region === null && i.seededBy !== 'muse')
    .sort((a, b) => salienceAt(b, now) - salienceAt(a, now) || (a.topic < b.topic ? -1 : 1));
  if (seeds.length > 0) return { topic: seeds[0].topic, relatedTo: null };
  for (let k = s.frontier.length - 1; k >= 0; k--) {
    const { topic, from } = s.frontier[k];
    if (!s.interests.get(topic)?.region) return { topic, relatedTo: from };
  }
  const asked = [...s.questions.values()].filter((q) => !s.interests.get(q.topic)?.region).sort((a, b) => a.openedAt - b.openedAt);
  return asked.length > 0 ? { topic: asked[0].topic, relatedTo: null } : null;
}

function revisitable(s: MuseState): { readonly interest: Interest; readonly region: RegionKey }[] {
  const out: { interest: Interest; region: RegionKey }[] = [];
  for (const interest of s.interests.values()) if (interest.region) out.push({ interest, region: interest.region });
  return out;
}

/** score = 0.35·affinity + 0.30·salience + 0.15·[open question] + 0.20·w_owner·[recent owner mention] − 0.25·fatigue. */
export function pickScore(s: MuseState, i: Interest, now: number): number {
  const mentioned = i.ownerMentionAt !== null && now - i.ownerMentionAt <= PICK_OWNER_RECENT_MS;
  const fatigue = i.lastPursued === null ? 0 : Math.exp(-Math.max(0, now - i.lastPursued) / PICK_FATIGUE_TAU_MS);
  return (
    PICK_AFFINITY * i.affinity +
    PICK_SALIENCE * salienceAt(i, now) +
    PICK_QUESTION * (questionOn(s, i.topic) ? 1 : 0) +
    PICK_OWNER * wOwner(s) * (mentioned ? 1 : 0) -
    PICK_FATIGUE * fatigue
  );
}

function revisit(s: MuseState, now: number, draw: Draw, known: ReturnType<typeof revisitable>): TripStart {
  const p = softmax(
    known.map((k) => pickScore(s, k.interest, now)),
    PICK_TAU,
  );
  const { interest, region } = known[Math.max(0, categorical(draw('trip.pick'), p))];
  return { kind: 'revisit', topic: interest.topic, region, question: questionOn(s, interest.topic) };
}

/** The serendipity topic's region: where it already lives, or the far region the trip opened. */
export function serendipityRegion(s: MuseState, topic: TopicKey, draw: Draw): RegionKey {
  return s.interests.get(topic)?.region ?? farRegion(s, draw);
}

/** Pages Muse hasn't collected yet: old places keep turning up something new. */
export function freshCandidates(s: MuseState, candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((c) => !s.collected.has(c.canonicalUrl));
}

export function hopMs(s: MuseState, draw: Draw): number {
  return lognormal(draw('hop.ms', s.episode?.hops ?? 0), HOP_MEDIAN_MS, HOP_SIGMA);
}

/** At most KEEP_MAX with score ≥ θ, best first. */
export function keep(judgments: readonly Judgment[]): readonly Judgment[] {
  return judgments
    .filter((j) => j.score >= KEEP_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, KEEP_MAX);
}

/** P(another hop) = focus × the best score this hop. */
export function continueTrip(s: MuseState, k: number, bestScore: number, draw: Draw): boolean {
  return draw('trip.continue', k) < s.temperament.focus * bestScore;
}
