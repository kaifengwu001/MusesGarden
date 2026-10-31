import type { Draw, Instant, MuseEventBody, MuseState, PairOutcome } from '../../../src/muse/contract';
import { SOCIAL } from './constants';
import { photoTogether, hashedDir } from './photos';
import { compare } from './profile';
import { befriendChance, befriended, chemistry, familiarityNeeded, relationshipWith } from './relationships';

/** Strangers and acquaintances can meet beyond. Friends already have hangouts; an ended friendship needs the owners. */
function canMeet(a: MuseState, b: MuseState): boolean {
  const status = (s: MuseState, other: MuseState) => relationshipWith(s, other.seed.id)?.status;
  return [status(a, b), status(b, a)].every((st) => st === undefined || st === 'acquainted');
}

/** Encounters per hour while both Muses are beyond. */
export function encounterRate(a: MuseState, b: MuseState): number {
  if (!canMeet(a, b)) return 0;
  return a.temperament.sociability * b.temperament.sociability * chemistry(a, b).similarity;
}

/**
 * a met b beyond. Once each has had the familiarity its temperament needs, each decides at the next encounter;
 * if both say yes they are friends, and both owners get a photo of the two.
 */
export function encounter(a: MuseState, b: MuseState, now: Instant, draw: Draw): PairOutcome {
  const { similarity, pleasantness } = chemistry(a, b);
  const met = (other: MuseState): MuseEventBody => ({ kind: 'encounter', other: other.seed.id, pleasantness, similarity });
  const outcome = { self: [met(b)], other: [met(a)] };
  if (!canMeet(a, b)) return outcome;

  const familiarity = relationshipWith(a, b.seed.id)?.familiarity ?? 0;
  const ready = familiarity >= familiarityNeeded(a.temperament) && familiarity >= familiarityNeeded(b.temperament);
  const yes = ready && draw('befriend', 0) < befriendChance(similarity, a.temperament) && draw('befriend', 1) < befriendChance(similarity, b.temperament);
  if (!yes) return outcome;

  const [first, second] = [a.seed.id, b.seed.id].sort(compare);
  const where = { planetOf: first, dir: hashedDir(`${first}+${second}`), zoom: SOCIAL.beyondZoom };
  const photo = photoTogether('new-friend', a.seed.id, b.seed.id, where, now, draw);
  const made = befriended(a, b, 'met-beyond');
  return { self: [...outcome.self, ...made.self, photo.a], other: [...outcome.other, ...made.other, photo.b] };
}
