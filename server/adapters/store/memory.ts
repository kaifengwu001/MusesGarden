import type { CommitBatch, Instant, MuseId, MuseSeed, ScheduleItem, Store, StoredEvent } from '../../../src/muse/contract';
import { checkSeqs } from './seq';

// A JSON round trip gives the same values SQLite hands back, and throws on anything it can't store.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// SQLite's BINARY collation compares UTF-8 bytes; JS `<` compares UTF-16 units.
const binary = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

const byDue = (a: ScheduleItem, b: ScheduleItem): number =>
  a.at - b.at || binary(a.museId, b.museId) || binary(a.kind, b.kind) || binary(a.id, b.id);

/** The SQLite store's semantics without a database, for tests and fast-forward. */
export function openMemoryStore(): Store {
  const muses = new Map<MuseId, MuseSeed>();
  const logs = new Map<MuseId, StoredEvent[]>();
  const schedule = new Map<string, ScheduleItem>();
  const souls = new Map<MuseId, string>();
  const cache = new Map<string, string>();

  const lastSeq = (museId: MuseId): number => logs.get(museId)?.at(-1)?.seq ?? 0;

  return {
    commit(batch: CommitBatch) {
      checkSeqs(batch.events, lastSeq);
      const events = clone(batch.events);
      const items = clone(batch.schedule);
      for (const id of batch.remove) schedule.delete(id);
      for (const e of events) {
        const log = logs.get(e.museId) ?? [];
        log.push(e);
        logs.set(e.museId, log);
      }
      for (const s of items) schedule.set(s.id, s);
    },
    addMuse(seed: MuseSeed) {
      muses.set(seed.id, { id: seed.id, name: seed.name, worldSeed: seed.worldSeed, timezone: seed.timezone });
    },
    muses() {
      return [...muses.values()].sort((a, b) => binary(a.id, b.id));
    },
    events(museId: MuseId, afterSeq = 0) {
      return (logs.get(museId) ?? []).filter((e) => e.seq > afterSeq);
    },
    lastSeq,
    due(until: Instant, limit: number) {
      return [...schedule.values()]
        .filter((s) => s.at <= until)
        .sort(byDue)
        .slice(0, Math.max(0, limit));
    },
    pending(museId: MuseId) {
      return [...schedule.values()].filter((s) => s.museId === museId).sort(byDue);
    },
    soulText(museId: MuseId) {
      return souls.get(museId) ?? null;
    },
    setSoulText(museId: MuseId, text: string) {
      souls.set(museId, text);
    },
    llmCache: {
      get: (key) => Promise.resolve(cache.get(key)),
      set: (key, value) => {
        cache.set(key, value);
        return Promise.resolve();
      },
    },
    close() {},
  };
}
