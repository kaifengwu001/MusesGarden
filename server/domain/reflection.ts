// Growth through reflection: what Muse lived through since it last reflected, and the validator that only
// lets evidence-backed changes through.
import type {
  CanonicalUrl,
  EventRef,
  Experience,
  MuseEventBody,
  MuseState,
  ReflectionProposal,
  StoredEvent,
  TopicKey,
} from '../../src/muse/contract';
import { eventRef } from './ids';
import { gateAll } from './interests';
import { REFLECTION_DUE_EXPERIENCES, REFLECTION_DUE_MS } from './policy/constants';
import { core } from './state';

const isReflection = (e: StoredEvent): boolean => e.event.kind === 'reflection.committed' || e.event.kind === 'reflection.no-change';

const RANK: Record<Experience['kind'], number> = { kept: 3, gift: 2, skipped: 1, hangout: 0, encounter: 0 };

/**
 * Everything Muse lived through since its last reflection, reflections excluded. Pages are grouped by
 * canonical URL, so a source seen on three hops and kept on the fourth is one experience: the kept one.
 */
export function experiences(s: MuseState, log: readonly StoredEvent[]): Experience[] {
  const mine = log.filter((e) => e.museId === s.seed.id);
  const since = mine.reduce((last, e) => (isReflection(e) ? Math.max(last, e.seq) : last), 0);
  const byUrl = new Map<CanonicalUrl, Experience>();
  const others: Experience[] = [];
  const offer = (x: Experience & { readonly canonicalUrl: CanonicalUrl }): void => {
    const prev = byUrl.get(x.canonicalUrl);
    const topics: TopicKey[] = [...new Set([...(prev?.topics ?? []), ...x.topics])];
    byUrl.set(x.canonicalUrl, prev && RANK[prev.kind] >= RANK[x.kind] ? { ...prev, topics } : { ...x, topics });
  };
  for (const stored of mine) {
    if (stored.seq <= since) continue;
    const e = stored.event;
    const ref = eventRef(stored.museId, stored.seq);
    switch (e.kind) {
      case 'trip.hop':
        for (const v of e.looked) {
          const note = v.kept ? `Kept "${v.title}": ${v.reason}` : `Looked at "${v.title}" and moved on.`;
          offer({ ref, at: e.at, kind: v.kept ? 'kept' : 'skipped', topics: v.topics, canonicalUrl: v.canonicalUrl, note });
        }
        break;
      case 'discovery.collected': {
        const d = e.discovery;
        const kind = d.provenance === 'gift' ? 'gift' : 'kept';
        offer({ ref, at: e.at, kind, topics: d.topics, canonicalUrl: d.canonicalUrl, note: `Kept "${d.title}": ${d.reason}` });
        break;
      }
      case 'hangout':
        others.push({ ref, at: e.at, kind: 'hangout', topics: [], note: e.pleasantness >= 0.3 ? 'Spent a good while with a friend.' : 'A hangout with a friend that felt off.' });
        if (e.received) offer({ ref, at: e.at, kind: 'gift', topics: e.received.topics, canonicalUrl: e.received.canonicalUrl, note: `A friend gave me "${e.received.title}".` });
        break;
      case 'encounter':
        others.push({ ref, at: e.at, kind: 'encounter', topics: [], note: 'Met another Muse out beyond the planet.' });
        break;
      default:
        break;
    }
  }
  return [...byUrl.values(), ...others].sort((a, b) => a.at - b.at);
}

/**
 * The pure validator the engine runs on a Mind's proposal. Evidence must be non-reflection events present in
 * the log; then the same gate the reducer re-runs clamps Δaffinity, drops topics without a source, and drops
 * stage moves the sources don't back. Nothing left means no change.
 */
export function validateReflection(s: MuseState, log: readonly StoredEvent[], proposal: ReflectionProposal, now: number): MuseEventBody {
  const present = new Set<EventRef>(log.filter((e) => e.museId === s.seed.id && !isReflection(e)).map((e) => eventRef(e.museId, e.seq)));
  const cited = proposal.deltas
    .map((d) => ({ ...d, evidence: d.evidence.filter((r) => present.has(r)) }))
    .filter((d) => d.evidence.length > 0);
  const { applied } = gateAll(s, cited, now);
  if (applied.length === 0) return { kind: 'reflection.no-change', reviewed: [...new Set(experiences(s, log).map((x) => x.ref))] };
  return {
    kind: 'reflection.committed',
    version: s.reflections.length + 1,
    deltas: applied,
    narrative: proposal.narrative,
    evidence: [...new Set(applied.flatMap((d) => d.evidence))],
  };
}

/** At the start of a rest: after REFLECTION_DUE_MS with something new to think about, or once experiences pile up. */
export function reflectionDue(s: MuseState, now: number): boolean {
  const fresh = s.experiencesSinceReflection;
  return fresh >= REFLECTION_DUE_EXPERIENCES || (fresh > 0 && now - core(s).lastReflectionAt >= REFLECTION_DUE_MS);
}
