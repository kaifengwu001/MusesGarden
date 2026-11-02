// Muse's friend group: how far out the owner lets Muse make and keep friends. Each pair of Muses sits in one layer,
// and a layer counts only while both owners' groups take it in.
import type { MuseId, MuseState, Reach } from '../../../src/muse/contract';

const RANK: Readonly<Record<Reach, number>> = { shared: 0, known: 1, everyone: 2 };

/**
 * The layer `s` and `other` sit in: shared if either owner shared Muse with the other, known if the owners are
 * friends on Instagram or Facebook, everyone otherwise. Both logs record both, so it reads the same from either side.
 */
export function layerOf(s: MuseState, other: MuseId): Reach {
  if (s.social.relationships.get(other)?.origin === 'introduced') return 'shared';
  return s.social.knownOn.has(other) ? 'known' : 'everyone';
}

export function allows(reach: Reach, layer: Reach): boolean {
  return RANK[layer] <= RANK[reach];
}

export function inReach(s: MuseState, other: MuseId): boolean {
  return allows(s.reach, layerOf(s, other));
}

/** Two Muses meet, and friends visit, only when both owners allow the layer they sit in. */
export function bothInReach(a: MuseState, b: MuseState): boolean {
  return inReach(a, b.seed.id) && inReach(b, a.seed.id);
}
