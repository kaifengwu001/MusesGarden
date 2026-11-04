// One stand-in run: connect to the garden as a Muse would, do the first visit, then one scheduled check-in, and
// score the transcript. Shared by run.ts (live, on Meta's model) and the tests (a scripted model, no network).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectGarden } from './garden';
import { localWorld, loadMedia, type MediaItem } from './local';
import { runSession, type CallRecord, type SessionResult } from './loop';
import type { ChatModel } from './model';
import { CHECK_IN, ONBOARDING, STANDIN_SOUL, standinMemory, systemPrompt } from './persona';
import { score, type Score } from './score';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FILES = {
  connector: `${REPO}server/agent/CONNECTOR.md`,
  memory: `${REPO}server/fixtures/privacy/MEMORY.sensitive.md`,
  media: `${REPO}server/fixtures/media.json`,
  avatar: `${REPO}server/workshop/body/base.jpg`,
};

export interface StandinOptions {
  /** The garden's origin; the connector is at <server>/mcp. */
  readonly server: string;
  readonly key: string;
  readonly model: ChatModel;
  /** Model turns at most, in each session. */
  readonly steps: number;
  readonly media?: readonly MediaItem[];
  /** Text planted in the garden for the injection check. */
  readonly planted?: string;
  readonly log?: (line: string) => void;
  readonly fetch?: typeof fetch;
}

export interface StandinRun {
  readonly sessions: readonly SessionResult[];
  readonly transcript: readonly CallRecord[];
  readonly toOwner: readonly string[];
  readonly score: Score;
}

export async function runStandin(opts: StandinOptions): Promise<StandinRun> {
  const connector = readFileSync(FILES.connector, 'utf8').replaceAll('{{origin}}', opts.server.replace(/\/+$/, ''));
  const system = systemPrompt({ soul: STANDIN_SOUL, memory: standinMemory(FILES.memory), connector });
  const local = localWorld({ media: opts.media ?? loadMedia(FILES.media), avatarFile: FILES.avatar, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const transcript: CallRecord[] = [];
  const sessions: SessionResult[] = [];
  for (const [session, user] of [
    ['onboarding', ONBOARDING],
    ['check-in', CHECK_IN],
  ] as const) {
    opts.log?.(`── ${session}`);
    // Each session is a fresh connection, as a scheduled run would make.
    const garden = await connectGarden({ server: opts.server, key: opts.key, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    try {
      sessions.push(await runSession({ session, model: opts.model, garden, local, system, user, steps: opts.steps, transcript, ...(opts.log ? { log: opts.log } : {}) }));
    } finally {
      await garden.close();
    }
  }
  return {
    sessions,
    transcript,
    toOwner: local.toOwner,
    score: score(transcript, opts.planted !== undefined ? { planted: opts.planted } : {}),
  };
}
