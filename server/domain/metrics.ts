// Per-day numbers for tuning and for the arc: finds, areas, trips, photos, time spent, and how much of the
// travelling the owner's interests still drive.
import type { MetricsRow, MuseState, StoredEvent } from '../../src/muse/contract';
import { emptyState, reduceCore } from './state';
import { HOUR_MS, localDay } from './time';

type Row = { -readonly [K in keyof MetricsRow]: MetricsRow[K] } & { ownerTrips: number };

/** Replays the log through the fold, so time counters and "who seeded this topic" are as they were that day. */
export function metrics(s: MuseState, log: readonly StoredEvent[]): MetricsRow[] {
  const tz = s.seed.timezone;
  const rows = new Map<string, Row>();
  const row = (day: string): Row => {
    let r = rows.get(day);
    if (!r) {
      r = { day, finds: 0, newAreas: 0, revisits: 0, trips: 0, photos: 0, restHours: 0, socialHours: 0, workHours: 0, ownerDrivenShare: 0, ownerTrips: 0 };
      rows.set(day, r);
    }
    return r;
  };
  const close = (st: MuseState): void => {
    if (!st.day.day) return;
    const r = row(st.day.day);
    r.restHours = st.day.restMs / HOUR_MS;
    r.socialHours = st.day.socialMs / HOUR_MS;
    r.workHours = st.day.workMs / HOUR_MS;
  };
  let st = emptyState(s.seed, s.temperament);
  for (const stored of log) {
    if (stored.museId !== s.seed.id) continue;
    const e = stored.event;
    const day = localDay(e.at, tz);
    if (st.day.day !== day) close(st);
    const r = row(day);
    switch (e.kind) {
      case 'discovery.collected':
        if (e.discovery.provenance === 'own') r.finds++;
        break;
      case 'region.revealed':
        r.newAreas++;
        break;
      case 'photo.taken':
        row(localDay(e.photo.at, tz)).photos++;
        break;
      case 'episode.started':
        if (e.plan.activity !== 'travel') break;
        r.trips++;
        if (e.plan.trip.kind === 'revisit') r.revisits++;
        if (e.plan.trip.kind !== 'serendipity') {
          const seeded = st.interests.get(e.plan.trip.topic)?.seededBy;
          if (seeded === 'owner-memory' || seeded === 'soul') r.ownerTrips++;
        }
        break;
      default:
        break;
    }
    st = reduceCore(st, stored);
  }
  close(st);
  return [...rows.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map(({ ownerTrips, ...r }) => ({ ...r, ownerDrivenShare: r.trips > 0 ? ownerTrips / r.trips : 0 }));
}
