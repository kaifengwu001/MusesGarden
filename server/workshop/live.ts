// The workshop's real clients: Meta's for pictures, segments and judging (server/adapters/meta), and whichever
// mesher (Tripo, lane E) and builder (Muse Code, lane G) the server wires in. Until one is, its step fails plainly.
// WORKSHOP_FAKE=1 swaps in the fakes for every client (no network, no spending).
import { metaImages } from '../adapters/meta/images';
import { metaJudge } from '../adapters/meta/judge';
import { metaSegmenter } from '../adapters/meta/sam';
import type { MetaOptions } from '../adapters/meta/http';
import type { Builder, Mesher, WorkshopClients } from './clients';
import { fakeClients } from './clients';

export interface LiveOptions {
  readonly mesher?: Mesher;
  readonly builder?: Builder;
  /** The key, base URL and fetch the Meta clients use (default: MODEL_API_KEY, MUSE_LLM_BASE_URL). */
  readonly meta?: MetaOptions;
}

const unwiredMesher: Mesher = {
  fromImage: () => Promise.reject(new Error('The 3D body maker (Tripo) isn’t wired into the workshop yet.')),
};

const unwiredBuilder: Builder = {
  available: () => Promise.resolve(false),
  run: () => Promise.resolve({ ok: false, log: 'Muse Code isn’t wired into the workshop yet.' }),
};

export function liveClients(opts: LiveOptions = {}): WorkshopClients {
  return {
    images: metaImages(opts.meta),
    segmenter: metaSegmenter(opts.meta),
    judge: metaJudge(opts.meta),
    mesher: opts.mesher ?? unwiredMesher,
    builder: opts.builder ?? unwiredBuilder,
  };
}

/** WORKSHOP_FAKE=1: every client a fake; otherwise the live ones. */
export function clientsFromEnv(opts: LiveOptions = {}, env: NodeJS.ProcessEnv = process.env): WorkshopClients {
  return env.WORKSHOP_FAKE === '1' ? fakeClients() : liveClients(opts);
}
