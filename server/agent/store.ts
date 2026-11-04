// What the connector keeps on disk, in <dataDir>/agent.db: each real Muse's key (only its sha256) and doorbell code,
// and the reply to every write that went through, so a repeated request_id gets the same reply without running again.
import { DatabaseSync } from 'node:sqlite';
import type { MuseId } from '../../src/muse/contract';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  muse_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  doorbell_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_requests (
  muse_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (muse_id, request_id)
) WITHOUT ROWID;
`;

/** Replies are kept this long (wall time): long enough for any retry, short enough that the file stays small. */
const KEEP_REPLIES_MS = 30 * 24 * 3_600_000;

/** One write that went through: which tool, a digest of its arguments (without request_id), and its reply. */
export interface StoredReply {
  readonly tool: string;
  readonly digest: string;
  readonly value: unknown;
}

export interface AgentStore {
  /** Gives `museId` a new key (the old one stops working) and keeps its doorbell code, or sets `doorbell` if it has none. */
  setKey(museId: MuseId, keyHash: string, doorbell: string, at: number): { readonly doorbell: string };
  museForKey(keyHash: string): MuseId | null;
  museForDoorbell(code: string): MuseId | null;
  doorbellOf(museId: MuseId): string | null;
  reply(museId: MuseId, requestId: string): StoredReply | null;
  keepReply(museId: MuseId, requestId: string, reply: StoredReply, at: number): void;
  close(): void;
}

export function openAgentStore(path: string): AgentStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA);

  const doorbellOf = db.prepare('SELECT doorbell_code AS code FROM agents WHERE muse_id = ?');
  const upsert = db.prepare(`
    INSERT INTO agents (muse_id, key_hash, doorbell_code, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (muse_id) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at`);
  const byKey = db.prepare('SELECT muse_id AS museId FROM agents WHERE key_hash = ?');
  const byDoorbell = db.prepare('SELECT muse_id AS museId FROM agents WHERE doorbell_code = ?');
  const getReply = db.prepare('SELECT response_json AS json FROM agent_requests WHERE muse_id = ? AND request_id = ?');
  const putReply = db.prepare('INSERT OR REPLACE INTO agent_requests (muse_id, request_id, response_json, at) VALUES (?, ?, ?, ?)');
  const prune = db.prepare('DELETE FROM agent_requests WHERE at < ?');

  const code = (museId: MuseId): string | null => (doorbellOf.get(museId) as { code: string } | undefined)?.code ?? null;
  const muse = (row: unknown): MuseId | null => ((row as { museId: string } | undefined)?.museId as MuseId | undefined) ?? null;

  return {
    setKey(museId, keyHash, doorbell, at) {
      const kept = code(museId) ?? doorbell;
      upsert.run(museId, keyHash, kept, at);
      return { doorbell: kept };
    },
    museForKey: (keyHash) => muse(byKey.get(keyHash)),
    museForDoorbell: (doorbell) => muse(byDoorbell.get(doorbell)),
    doorbellOf: code,
    reply(museId, requestId) {
      const row = getReply.get(museId, requestId) as { json: string } | undefined;
      return row === undefined ? null : (JSON.parse(row.json) as StoredReply);
    },
    keepReply(museId, requestId, reply, at) {
      putReply.run(museId, requestId, JSON.stringify(reply), at);
      prune.run(at - KEEP_REPLIES_MS);
    },
    close: () => db.close(),
  };
}
