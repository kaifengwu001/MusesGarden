import type { Draw, EncounterPlace, Instant, MuseEventBody, MuseState, PairOutcome } from '../../../src/muse/contract';
import { SOCIAL } from './constants';
import { hashedDir, photoSlotsLeft, photoTogether } from './photos';
import { compare } from './profile';
import { befriendChance, befriended, chemistry, familiarityNeeded, relationshipWith } from './relationships';

function canMeet(a: MuseState, b: MuseState): boolean {
  const status = (s: MuseState, other: MuseState) => relationshipWith(s, other.seed.id)?.status;
  return [status(a, b), status(b, a)].every((st) => st === undefined || st === 'acquainted');
}

/**
 * Strangers meet beyond only when they share something public. Muses whose owners know each other online meet
 * whatever their interests, more often the more alike they are.
 */
export function encounterRate(a: MuseState, b: MuseState, where: EncounterPlace): number {
  if (!canMeet(a, b)) return 0;
  const both = a.temperament.sociability * b.temperament.sociability;
  if (where === 'beyond') return SOCIAL.encountersPerHour * both * chemistry(a, b).similarity;
  return a.social.knownOn.has(b.seed.id) ? SOCIAL.knownPerHour * both * (SOCIAL.knownBase + chemistry(a, b).similarity) : 0;
}

/** Beyond, both must want it, and the friendship starts with a photo of the two out there. */
function befriendBeyond(a: MuseState, b: MuseState, similarity: number, now: Instant, draw: Draw): PairOutcome | null {
  const familiarity = relationshipWith(a, b.seed.id)?.familiarity ?? 0;
  const ready =
    familiarity >= familiarityNeeded(a.temperament) &&
    familiarity >= familiarityNeeded(b.temperament) &&
    photoSlotsLeft(a, now) > 0 &&
    photoSlotsLeft(b, now) > 0;
  const yes = ready && draw('befriend', 0) < befriendChance(similarity, a.temperament) && draw('befriend', 1) < befriendChance(similarity, b.temperament);
  if (!yes) return null;
  const [first, second] = [a.seed.id, b.seed.id].sort(compare);
  const where = { planetOf: first, dir: hashedDir(`${first}+${second}`), zoom: SOCIAL.beyondZoom };
  const photo = photoTogether('new-friend', a.seed.id, b.seed.id, where, now, draw);
  const made = befriended(a, b, 'met-beyond');
  return { self: [...made.self, photo.a], other: [...made.other, photo.b] };
}

/** Online, the owners' friendship vouches for them: a little familiarity, then one draw that the shyer one sets. */
function befriendOnline(a: MuseState, b: MuseState, draw: Draw): PairOutcome | null {
  const familiarity = relationshipWith(a, b.seed.id)?.familiarity ?? 0;
  const chance = SOCIAL.knownBefriendBase + (1 - SOCIAL.knownBefriendBase) * Math.min(a.temperament.sociability, b.temperament.sociability);
  return familiarity >= SOCIAL.knownFamiliarity && draw('befriend', 0) < chance ? befriended(a, b, 'known-on') : null;
}

export function encounter(a: MuseState, b: MuseState, where: EncounterPlace, now: Instant, draw: Draw): PairOutcome {
  const { similarity, pleasantness } = chemistry(a, b);
  const met = (other: MuseState): MuseEventBody => ({ kind: 'encounter', other: other.seed.id, pleasantness, similarity, where });
  const outcome = { self: [met(b)], other: [met(a)] };
  if (!canMeet(a, b)) return outcome;
  const made = where === 'beyond' ? befriendBeyond(a, b, similarity, now, draw) : befriendOnline(a, b, draw);
  return made ? { self: [...outcome.self, ...made.self], other: [...outcome.other, ...made.other] } : outcome;
}
