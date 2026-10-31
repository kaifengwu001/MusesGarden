// Test support: a fixed temperament table, a seed, and a log builder that folds as it goes.
import type {
  CanonicalUrl,
  Discovery,
  Instant,
  MuseEventBody,
  MuseSeed,
  RegionKey,
  StoredEvent,
  Temperament,
  TopicKey,
  Verdict,
} from '../../src/muse/contract';
import { hopPlace } from './atlas';
import { canonicalUrl, discoveryId, eventRef, instant, museId, topicKey } from './ids';
import { drawFor } from './rng';
import { type CoreState, emptyState, reduceCore } from './state';

export const TEMPERAMENTS = {
  hero: { curiosity: 0.6, focus: 0.7, sociability: 0.5, whimsy: 0.6, novelty: 0.5 },
  homebody: { curiosity: 0.4, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0 },
  explorer: { curiosity: 0.4, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 1 },
  shutterbug: { curiosity: 0.6, focus: 0.5, sociability: 0.5, whimsy: 1, novelty: 0.5 },
  loner: { curiosity: 0.6, focus: 0.5, sociability: 0, whimsy: 0.5, novelty: 0.5 },
} as const satisfies Record<string, Temperament>;

export const MOSS: MuseSeed = { id: museId('moss'), name: 'Moss', worldSeed: 412, timezone: 'America/Los_Angeles' };

export const t = (iso: string): Instant => instant(Date.parse(iso));
export const topic = topicKey;
export const wiki = (title: string): CanonicalUrl => canonicalUrl(`https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}`);

export interface Page {
  readonly title: string;
  readonly score: number;
  readonly kept?: boolean;
  readonly topics?: readonly string[];
}

export class Life {
  readonly log: StoredEvent[] = [];
  state: CoreState;

  constructor(
    readonly seed: MuseSeed = MOSS,
    temperament: Temperament = TEMPERAMENTS.hero,
  ) {
    this.state = emptyState(seed, temperament);
  }

  push(at: number, body: MuseEventBody): StoredEvent {
    const stored: StoredEvent = { museId: this.seed.id, seq: this.log.length + 1, event: { ...body, at: instant(at) } };
    this.log.push(stored);
    this.state = reduceCore(this.state, stored) as CoreState;
    return stored;
  }

  /** One hop the way the engine writes it: the hop record, then a discovery per kept page, planted where Muse stood. */
  hop(at: number, n: number, k: number, hopTopic: string, region: RegionKey, pages: readonly Page[]): Discovery[] {
    const place = hopPlace(this.seed.worldSeed, region, k, drawFor(this.seed.id, n));
    const looked: Verdict[] = pages.map((p) => ({
      canonicalUrl: wiki(p.title),
      title: p.title,
      topics: (p.topics ?? [p.title]).map(topicKey),
      score: p.score,
      reason: `${p.title} caught my eye.`,
      kept: p.kept ?? false,
    }));
    const kept = pages.filter((p) => p.kept);
    const ids = kept.map((_, i) => discoveryId(`d:${this.seed.id}:${n}:${k}:${i}`));
    const ref = this.push(at, { kind: 'trip.hop', n, k, topic: topicKey(hopTopic), place, looked, kept: ids });
    return kept.map((p, i) => {
      const discovery: Discovery = {
        id: ids[i],
        url: wiki(p.title),
        canonicalUrl: wiki(p.title),
        title: p.title,
        summary: `${p.title}.`,
        topics: (p.topics ?? [p.title]).map(topicKey),
        because: [eventRef(ref.museId, ref.seq)],
        reason: `I kept ${p.title}.`,
        keepScore: p.score,
        provenance: 'own',
        place,
        at: instant(at),
      };
      this.push(at, { kind: 'discovery.collected', discovery });
      return discovery;
    });
  }
}

/** Folds a log from scratch, renumbering seq so a filtered log is still gapless. */
export function foldLog(seed: MuseSeed, temperament: Temperament, events: readonly StoredEvent[]): CoreState {
  let s = emptyState(seed, temperament);
  events.forEach((e, i) => {
    s = reduceCore(s, { ...e, seq: i + 1 }) as CoreState;
  });
  return s;
}

export const topicsOf = (...titles: string[]): TopicKey[] => titles.map(topicKey);
