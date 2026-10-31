import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type {
  CanonicalUrl,
  CommitBatch,
  DiscoveryId,
  Instant,
  MuseEvent,
  MuseId,
  RegionKey,
  ScheduleItem,
  ScheduleKind,
  Store,
  StoredEvent,
  TopicKey,
} from '../../../src/muse/contract';
import { openMemoryStore } from './memory';
import { SeqConflictError } from './seq';
import { openSqliteStore } from './sqlite';

const A = 'ada' as MuseId;
const B = 'bo' as MuseId;
const T0 = Date.UTC(2026, 9, 31, 9) as Instant;
const at = (min: number) => (T0 + min * 60_000) as Instant;

const work = (museId: MuseId, seq: number, state: 'started' | 'ended' = 'started'): StoredEvent => ({
  museId,
  seq,
  event: { kind: 'host.work', state, at: at(seq) },
});

const item = (id: string, min: number, museId: MuseId = A, kind: ScheduleKind = 'trip.hop', payload = {}): ScheduleItem => ({
  id,
  at: at(min),
  museId,
  kind,
  payload,
});

const batch = (b: Partial<CommitBatch>): CommitBatch => ({ remove: [], events: [], schedule: [], ...b });

const snapshot = (s: Store) => ({
  muses: s.muses(),
  a: s.events(A),
  b: s.events(B),
  lastA: s.lastSeq(A),
  lastB: s.lastSeq(B),
  pendingA: s.pending(A),
  pendingB: s.pending(B),
  soulA: s.soulText(A),
});

const impls: [string, () => Store][] = [
  ['memory', () => openMemoryStore()],
  ['sqlite', () => openSqliteStore(':memory:')],
];

describe.each(impls)('%s store', (_, open) => {
  let store: Store;
  afterEach(() => store.close());

  it('appends events in seq order and reads them back after a seq', () => {
    store = open();
    expect(store.lastSeq(A)).toBe(0);
    store.commit(batch({ events: [work(A, 1), work(A, 2, 'ended'), work(B, 1)] }));
    store.commit(batch({ events: [work(A, 3)] }));
    expect(store.lastSeq(A)).toBe(3);
    expect(store.lastSeq(B)).toBe(1);
    expect(store.events(A)).toEqual([work(A, 1), work(A, 2, 'ended'), work(A, 3)]);
    expect(store.events(A, 1)).toEqual([work(A, 2, 'ended'), work(A, 3)]);
    expect(store.events(A, 3)).toEqual([]);
    expect(store.events(B)).toEqual([work(B, 1)]);
  });

  it('round-trips a nested event body', () => {
    store = open();
    const hop: MuseEvent = {
      kind: 'trip.hop',
      at: at(5),
      n: 2,
      k: 1,
      topic: 'Pigment' as TopicKey,
      place: { dir: [0, 0.6, 0.8], region: '1:0:2' as RegionKey },
      looked: [{ canonicalUrl: 'https://en.wikipedia.org/wiki/Ultramarine' as CanonicalUrl, title: 'Ultramarine', topics: [], score: 0.81, reason: 'Blue!', kept: true }],
      kept: ['d1' as DiscoveryId],
    };
    store.commit(batch({ events: [{ museId: A, seq: 1, event: hop }] }));
    expect(store.events(A)).toEqual([{ museId: A, seq: 1, event: hop }]);
  });

  it('throws SeqConflictError on a gap and writes nothing, not even the removes or the schedule', () => {
    store = open();
    store.commit(batch({ events: [work(A, 1)], schedule: [item('hop-1', 10)] }));
    const before = snapshot(store);
    const bad = batch({ remove: ['hop-1'], events: [work(A, 2), work(A, 4)], schedule: [item('hop-2', 20)] });
    expect(() => store.commit(bad)).toThrow(SeqConflictError);
    expect(snapshot(store)).toEqual(before);
  });

  it('checks seq per Muse in batch order, so a pair batch can write two logs', () => {
    store = open();
    store.commit(batch({ events: [work(A, 1)] }));
    store.commit(batch({ events: [work(A, 2), work(B, 1), work(A, 3), work(B, 2)] }));
    expect([store.lastSeq(A), store.lastSeq(B)]).toEqual([3, 2]);
    expect(() => store.commit(batch({ events: [work(B, 3), work(B, 3)] }))).toThrow(SeqConflictError);
    expect(store.lastSeq(B)).toBe(2);
  });

  it('writes nothing when a commit throws partway through', () => {
    store = open();
    store.commit(batch({ events: [work(A, 1)], schedule: [item('hop-1', 10)] }));
    const before = snapshot(store);
    const unstorable = item('hop-2', 20, A, 'trip.hop', { n: 1n });
    expect(() => store.commit(batch({ remove: ['hop-1'], events: [work(A, 2)], schedule: [unstorable] }))).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
  });

  it('rerunning a processed item changes nothing', () => {
    store = open();
    store.commit(batch({ schedule: [item('end-1', 5, A, 'episode.end'), item('basket-1', 6, A, 'basket.check')] }));
    const withEvents = batch({ remove: ['end-1'], events: [work(A, 1)], schedule: [item('hop-1', 30)] });
    const withoutEvents = batch({ remove: ['basket-1'], schedule: [item('basket-2', 60, A, 'basket.check')] });
    store.commit(withEvents);
    store.commit(withoutEvents);
    const after = snapshot(store);
    expect(() => store.commit(withEvents)).toThrow(SeqConflictError);
    store.commit(withoutEvents);
    expect(snapshot(store)).toEqual(after);
  });

  it('accepts removing an id that is not scheduled', () => {
    store = open();
    store.commit(batch({ remove: ['never-scheduled'], events: [work(A, 1)] }));
    expect(store.lastSeq(A)).toBe(1);
  });

  it('replaces an item scheduled again under the same id, even in the batch that removes it', () => {
    store = open();
    store.commit(batch({ schedule: [item('hop-1', 10)] }));
    store.commit(batch({ remove: ['hop-1'], schedule: [item('hop-1', 70, A, 'trip.hop', { k: 2 })] }));
    expect(store.pending(A)).toEqual([item('hop-1', 70, A, 'trip.hop', { k: 2 })]);
  });

  it('returns due items up to and including `until`, ordered by (at, museId, kind, id), within the limit', () => {
    store = open();
    const items = [
      item('z', 10, B, 'encounter'),
      item('late', 90, A),
      item('y', 10, A, 'trip.hop'),
      item('x', 10, A, 'trip.hop'),
      item('w', 10, A, 'episode.end'),
      item('first', 1, B, 'host.work'),
    ];
    store.commit(batch({ schedule: items }));
    expect(store.due(at(10), 10).map((s) => s.id)).toEqual(['first', 'w', 'x', 'y', 'z']);
    expect(store.due(at(10), 2).map((s) => s.id)).toEqual(['first', 'w']);
    expect(store.due(at(0), 10)).toEqual([]);
    expect(store.due(at(10), 0)).toEqual([]);
    expect(store.due(at(90), 10).at(-1)).toEqual(item('late', 90, A));
  });

  it('lists one Muse’s pending items in due order', () => {
    store = open();
    store.commit(batch({ schedule: [item('b-hop', 5, B), item('a-late', 50, A), item('a-early', 20, A, 'episode.end')] }));
    expect(store.pending(A).map((s) => s.id)).toEqual(['a-early', 'a-late']);
    expect(store.pending(B)).toEqual([item('b-hop', 5, B)]);
    expect(store.pending('nobody' as MuseId)).toEqual([]);
  });

  it('keeps muses sorted by id and upserts on a repeat add', () => {
    store = open();
    store.addMuse({ id: B, name: 'Bo', worldSeed: 2, timezone: 'Europe/Paris' });
    store.addMuse({ id: A, name: 'Ada', worldSeed: 1, timezone: 'America/Los_Angeles' });
    store.addMuse({ id: B, name: 'Bo', worldSeed: 3, timezone: 'Europe/Paris' });
    expect(store.muses()).toEqual([
      { id: A, name: 'Ada', worldSeed: 1, timezone: 'America/Los_Angeles' },
      { id: B, name: 'Bo', worldSeed: 3, timezone: 'Europe/Paris' },
    ]);
  });

  it('stores SOUL.md text per Muse', () => {
    store = open();
    expect(store.soulText(A)).toBeNull();
    store.setSoulText(A, '# Ada\nLoves ferns.');
    store.setSoulText(A, '# Ada\nLoves ferns and lichen.');
    expect(store.soulText(A)).toBe('# Ada\nLoves ferns and lichen.');
    expect(store.soulText(B)).toBeNull();
  });

  it('round-trips the LLM cache', async () => {
    store = open();
    expect(await store.llmCache.get('k')).toBeUndefined();
    await store.llmCache.set('k', '{"score":0.8}');
    expect(await store.llmCache.get('k')).toBe('{"score":0.8}');
    await store.llmCache.set('k', '{"score":0.9}');
    expect(await store.llmCache.get('k')).toBe('{"score":0.9}');
  });
});

describe('sqlite file store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'muse-store-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reopens to the same muses, events, schedule, soul text and cache as the memory store given the same writes', async () => {
    const path = join(dir, 'garden.db');
    const file = openSqliteStore(path);
    const memory = openMemoryStore();
    const writes = async (s: Store) => {
      s.addMuse({ id: A, name: 'Ada', worldSeed: 1, timezone: 'America/Los_Angeles' });
      s.addMuse({ id: B, name: 'Bo', worldSeed: 2, timezone: 'Europe/Paris' });
      s.setSoulText(A, '---\nname: Ada\n---\nI love ferns.');
      s.commit(batch({ events: [work(A, 1), work(B, 1)], schedule: [item('hop-1', 10, A, 'trip.hop', { n: 1, k: 0 })] }));
      s.commit(batch({ remove: ['hop-1'], events: [work(A, 2, 'ended')], schedule: [item('end-1', 40, B, 'episode.end')] }));
      await s.llmCache.set('model:abc', 'cached');
    };
    await writes(file);
    await writes(memory);
    file.close();

    const reopened = openSqliteStore(path);
    expect(snapshot(reopened)).toEqual(snapshot(memory));
    expect(reopened.due(at(1000), 10)).toEqual(memory.due(at(1000), 10));
    expect(await reopened.llmCache.get('model:abc')).toBe('cached');
    expect(snapshot(reopened).a).toHaveLength(2);
    reopened.close();
  });
});
