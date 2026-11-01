// The favorites shelf at home: Muse's ten most loved objects, which shift as its interests shift.
import type { Discovery, MuseState } from '../../src/muse/contract';
import { giverOf } from './ids';
import { salienceAt } from './interests';
import { SHELF_GIFT, SHELF_KEEP, SHELF_PULL, SHELF_SIZE } from './policy/constants';

export interface ShelfItem {
  readonly discovery: Discovery;
  readonly fondness: number;
}

/** Rapport with the giver over the best rapport Muse has with anyone: 1 for its closest friend. */
function closeness(s: MuseState, d: Discovery): number {
  const giver = giverOf(d.id);
  const rel = giver ? s.social.relationships.get(giver) : undefined;
  if (!rel || rel.status === 'ended') return 0;
  let best = 0;
  for (const r of s.social.relationships.values()) best = Math.max(best, r.rapport);
  return best > 0 ? rel.rapport / best : 0;
}

/** The strongest pull among the find's topics: (affinity + salience now) / 2, in [0, 1]. */
function pull(s: MuseState, d: Discovery, now: number): number {
  let best = 0;
  for (const t of d.topics) {
    const i = s.interests.get(t);
    if (i) best = Math.max(best, (i.affinity + salienceAt(i, now)) / 2);
  }
  return best;
}

/** fondness = 0.5 · keep score + 0.5 · topic pull, plus 0.1 · closeness for a gift. Most loved first. */
export function shelf(s: MuseState, now: number): ShelfItem[] {
  return [...s.discoveries.values()]
    .map((discovery) => ({
      discovery,
      fondness:
        SHELF_KEEP * discovery.keepScore +
        SHELF_PULL * pull(s, discovery, now) +
        (discovery.provenance === 'gift' ? SHELF_GIFT * closeness(s, discovery) : 0),
    }))
    .sort((a, b) => b.fondness - a.fondness || b.discovery.at - a.discovery.at || (a.discovery.id < b.discovery.id ? -1 : 1))
    .slice(0, SHELF_SIZE);
}
