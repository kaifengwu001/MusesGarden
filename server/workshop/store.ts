// The workshop's jobs on disk: <dataDir>/workshop.db (node:sqlite), one row per job, its brief, working data and
// packet as JSON. Files a job makes live beside it in <dataDir>/workshop/<job>/, served at /w/<job>/<file>.
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Instant, MuseId } from '../../src/muse/contract';
import type { Brief, JobId, JobKind, JobRecord, JobState, Packet } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  muse_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  round INTEGER NOT NULL,
  drafts INTEGER NOT NULL,
  views INTEGER NOT NULL,
  message TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  data_json TEXT NOT NULL,
  packet_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_by_muse ON jobs (muse_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_by_state ON jobs (state, created_at);
`;

/** A job as the runner keeps it: the record pipelines see, plus the runner's own counts. */
export interface StoredJob extends JobRecord {
  /** 'approve' rounds shown so far: notes on the third are refused. */
  readonly drafts: number;
  /** Extra views asked for in the current round. */
  readonly views: number;
}

type Row = {
  id: string;
  muse_id: string;
  kind: string;
  state: string;
  stage: string;
  round: number;
  drafts: number;
  views: number;
  message: string;
  brief_json: string;
  data_json: string;
  packet_json: string | null;
  created_at: number;
  updated_at: number;
};

const toJob = (r: Row): StoredJob => ({
  id: r.id,
  museId: r.muse_id as MuseId,
  kind: r.kind as JobKind,
  state: r.state as JobState,
  stage: r.stage,
  round: r.round,
  drafts: r.drafts,
  views: r.views,
  message: r.message,
  brief: JSON.parse(r.brief_json) as Brief,
  data: JSON.parse(r.data_json) as Record<string, unknown>,
  packet: r.packet_json === null ? null : (JSON.parse(r.packet_json) as Packet),
  createdAt: r.created_at as Instant,
  updatedAt: r.updated_at as Instant,
});

export interface JobStore {
  /** Inserts the job, or replaces it whole. */
  save(job: StoredJob): void;
  get(id: JobId): StoredJob | null;
  /** One Muse's jobs, newest first. */
  byMuse(museId: MuseId): StoredJob[];
  /** Every job in a state, oldest first (the order they resume in). */
  inState(state: JobState): StoredJob[];
  close(): void;
}

/** 128 random bits as 32 hex characters: /w/<job>/ needs no key, so the id is the secret. */
export const newJobId = (): JobId => randomBytes(16).toString('hex');

export const isJobId = (id: string): boolean => /^[0-9a-f]{32}$/.test(id);

/** Where a job's files go: <dataDir>/workshop/<job>/. */
export const jobDir = (dataDir: string, id: JobId): string => join(dataDir, 'workshop', id);

/** Where finished bodies go, served at /api/looks/<id>.(glb|jpg|json): <dataDir>/workshop/looks/. */
export const looksDir = (dataDir: string): string => join(dataDir, 'workshop', 'looks');

export function openJobStore(path: string): JobStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA);
  const upsert = db.prepare(`
    INSERT INTO jobs (id, muse_id, kind, state, stage, round, drafts, views, message, brief_json, data_json, packet_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      state = excluded.state, stage = excluded.stage, round = excluded.round, drafts = excluded.drafts,
      views = excluded.views, message = excluded.message, brief_json = excluded.brief_json,
      data_json = excluded.data_json, packet_json = excluded.packet_json, updated_at = excluded.updated_at`);
  const one = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const ofMuse = db.prepare('SELECT * FROM jobs WHERE muse_id = ? ORDER BY created_at DESC, rowid DESC');
  const ofState = db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at, rowid');
  return {
    save: (j) => {
      upsert.run(
        j.id,
        j.museId,
        j.kind,
        j.state,
        j.stage,
        j.round,
        j.drafts,
        j.views,
        j.message,
        JSON.stringify(j.brief),
        JSON.stringify(j.data),
        j.packet === null ? null : JSON.stringify(j.packet),
        j.createdAt,
        j.updatedAt,
      );
    },
    get: (id) => {
      const r = one.get(id) as Row | undefined;
      return r === undefined ? null : toJob(r);
    },
    byMuse: (museId) => (ofMuse.all(museId) as Row[]).map(toJob),
    inState: (state) => (ofState.all(state) as Row[]).map(toJob),
    close: () => db.close(),
  };
}
