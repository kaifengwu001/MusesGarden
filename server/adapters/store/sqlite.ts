import { DatabaseSync } from 'node:sqlite';
import type {
  CommitBatch,
  Instant,
  MuseEvent,
  MuseId,
  MuseSeed,
  ScheduleItem,
  ScheduleKind,
  Store,
  StoredEvent,
} from '../../../src/muse/contract';
import { checkSeqs } from './seq';

// No table holds MEMORY.md, so the raw text never reaches disk.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS muses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  world_seed INTEGER NOT NULL,
  timezone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  muse_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body_json TEXT NOT NULL,
  PRIMARY KEY (muse_id, seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  muse_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_due ON schedule (at, muse_id, kind, id);
CREATE TABLE IF NOT EXISTS host_docs (
  muse_id TEXT PRIMARY KEY,
  soul_text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type ScheduleRow = {
  id: string;
  at: number;
  muse_id: string;
  kind: string;
  payload_json: string;
};

const toItem = (r: ScheduleRow): ScheduleItem => ({
  id: r.id,
  at: r.at as Instant,
  museId: r.muse_id as MuseId,
  kind: r.kind as ScheduleKind,
  payload: JSON.parse(r.payload_json) as ScheduleItem['payload'],
});

/**
 * The shape of the stored events this build reads. Raise it whenever a stored event's shape changes: an older garden
 * file is then refused rather than replayed wrongly (the files are local and gitignored, so starting again is cheap).
 */
export const SCHEMA_VERSION = 2;

export function openSqliteStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'").get() !== undefined;
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (existing && version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} is a garden from an older build (event shape ${version}, this build reads ${SCHEMA_VERSION}): delete it, or its folder (rm -rf .muse), and start again`);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const q = {
    lastSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE muse_id = ?'),
    insertEvent: db.prepare('INSERT INTO events (muse_id, seq, at, kind, body_json) VALUES (?, ?, ?, ?, ?)'),
    events: db.prepare('SELECT seq, body_json FROM events WHERE muse_id = ? AND seq > ? ORDER BY seq'),
    remove: db.prepare('DELETE FROM schedule WHERE id = ?'),
    upsertItem: db.prepare(
      `INSERT INTO schedule (id, at, muse_id, kind, payload_json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET at = excluded.at, muse_id = excluded.muse_id, kind = excluded.kind,
         payload_json = excluded.payload_json`,
    ),
    due: db.prepare('SELECT * FROM schedule WHERE at <= ? ORDER BY at, muse_id, kind, id LIMIT ?'),
    pending: db.prepare('SELECT * FROM schedule WHERE muse_id = ? ORDER BY at, muse_id, kind, id'),
    upsertMuse: db.prepare(
      `INSERT INTO muses (id, name, world_seed, timezone) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, world_seed = excluded.world_seed, timezone = excluded.timezone`,
    ),
    muses: db.prepare('SELECT * FROM muses ORDER BY id'),
    soul: db.prepare('SELECT soul_text FROM host_docs WHERE muse_id = ?'),
    setSoul: db.prepare(
      'INSERT INTO host_docs (muse_id, soul_text) VALUES (?, ?) ON CONFLICT (muse_id) DO UPDATE SET soul_text = excluded.soul_text',
    ),
    cacheGet: db.prepare('SELECT value FROM llm_cache WHERE key = ?'),
    cacheSet: db.prepare('INSERT INTO llm_cache (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  };

  const lastSeq = (museId: MuseId): number => (q.lastSeq.get(museId) as { last: number }).last;

  return {
    commit(batch: CommitBatch) {
      db.exec('BEGIN IMMEDIATE');
      try {
        checkSeqs(batch.events, lastSeq);
        for (const id of batch.remove) q.remove.run(id);
        for (const e of batch.events) q.insertEvent.run(e.museId, e.seq, e.event.at, e.event.kind, JSON.stringify(e.event));
        for (const s of batch.schedule) q.upsertItem.run(s.id, s.at, s.museId, s.kind, JSON.stringify(s.payload));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    addMuse(seed: MuseSeed) {
      q.upsertMuse.run(seed.id, seed.name, seed.worldSeed, seed.timezone);
    },
    muses() {
      return (q.muses.all() as { id: string; name: string; world_seed: number; timezone: string }[]).map((r) => ({
        id: r.id as MuseId,
        name: r.name,
        worldSeed: r.world_seed,
        timezone: r.timezone,
      }));
    },
    events(museId: MuseId, afterSeq = 0): readonly StoredEvent[] {
      return (q.events.all(museId, afterSeq) as { seq: number; body_json: string }[]).map((r) => ({
        museId,
        seq: r.seq,
        event: JSON.parse(r.body_json) as MuseEvent,
      }));
    },
    lastSeq,
    due(until: Instant, limit: number) {
      // SQLite reads a negative LIMIT as "no limit".
      return (q.due.all(until, Math.max(0, limit)) as ScheduleRow[]).map(toItem);
    },
    pending(museId: MuseId) {
      return (q.pending.all(museId) as ScheduleRow[]).map(toItem);
    },
    soulText(museId: MuseId) {
      return (q.soul.get(museId) as { soul_text: string } | undefined)?.soul_text ?? null;
    },
    setSoulText(museId: MuseId, text: string) {
      q.setSoul.run(museId, text);
    },
    llmCache: {
      get: (key) => Promise.resolve((q.cacheGet.get(key) as { value: string } | undefined)?.value),
      set: (key, value) => {
        q.cacheSet.run(key, value);
        return Promise.resolve();
      },
    },
    close() {
      db.close();
    },
  };
}
