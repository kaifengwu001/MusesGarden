// The outside services the workshop calls, as ports, with fakes for tests and for WORKSHOP_FAKE=1.
// Real ones: server/adapters/meta/* (lane D: muse-image-1.0, sam-3.1, muse-spark-1.3), server/adapters/tripo.ts
// (lane E), server/workshop/planet/builder.ts (lane G: Muse Code). Every real call takes a timeout.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Box = readonly [x1: number, y1: number, x2: number, y2: number];

export interface ImageGen {
  /** muse-image-1.0 /v1/images/generations: n pictures (PNG bytes). `search` lets it look up references on the web. */
  generate(req: { readonly prompt: string; readonly n: number; readonly size?: string; readonly search?: boolean; readonly signal?: AbortSignal }): Promise<Buffer[]>;
  /** muse-image-1.0 /v1/images/edits: images[0] is the picture being edited; the rest are references. PNG bytes out. */
  edit(req: { readonly prompt: string; readonly images: readonly Buffer[]; readonly n: number; readonly size?: string; readonly signal?: AbortSignal }): Promise<Buffer[]>;
}

export interface Segment {
  /** Pixels of the picture it was found in, corners inclusive. */
  readonly box: Box;
  /** A PNG the picture's size: white where the thing is, black elsewhere. Null when the service gave only a box. */
  readonly mask: Buffer | null;
  readonly confidence?: number;
}

export interface Segmenter {
  /** sam-3.1: every instance of one short noun phrase ("plush toy", "armchair") in one picture. Empty if none. */
  find(image: Buffer, phrase: string, signal?: AbortSignal): Promise<readonly Segment[]>;
}

export interface Judge {
  /** muse-spark-1.3 with structured output: an object matching `schema` (JSON Schema), from text and pictures. */
  json<T>(req: {
    readonly name: string;
    readonly system: string;
    readonly prompt: string;
    readonly images?: readonly Buffer[];
    readonly schema: Readonly<Record<string, unknown>>;
    readonly signal?: AbortSignal;
  }): Promise<T>;
}

export interface MeshOptions {
  /** Tripo Smart Mesh P2 quad topology (the body). Quad comes back as FBX; the adapter converts it to GLB. */
  readonly quad?: boolean;
  /** Target polygon count: 5000 for a body. */
  readonly faceLimit?: number;
  readonly seed?: number;
  /** Why this run is worth a Tripo credit, for the spending ledger. */
  readonly purpose: string;
}

export interface Mesher {
  /** Tripo image-to-model: a GLB. Frugal: cached by the picture's hash, capped per day (server/workshop/budget.ts). */
  fromImage(image: Buffer, opts: MeshOptions, signal?: AbortSignal): Promise<Buffer>;
}

export interface Builder {
  /** Whether Muse Code (`muse`) is installed here. */
  available(): Promise<boolean>;
  /** Runs Muse Code headless, rooted at `workspace`, with `instructions` written to its AGENTS.md. */
  run(req: { readonly workspace: string; readonly instructions: string; readonly prompt: string; readonly timeoutMs: number }): Promise<{ readonly ok: boolean; readonly log: string }>;
}

export interface WorkshopClients {
  readonly images: ImageGen;
  readonly segmenter: Segmenter;
  readonly judge: Judge;
  readonly mesher: Mesher;
  readonly builder: Builder;
}

const MUSE6 = fileURLToPath(new URL('../../src/assets/muse/muses/muse6.glb', import.meta.url));

/**
 * Fakes for every client: no network, no spending. Images come back as the first input (or `picture`), segments as
 * one centred box with no mask, meshes as muse6.glb, and the judge answers from `judged` by request name.
 */
export function fakeClients(opts: {
  readonly picture?: Buffer;
  readonly judged?: Readonly<Record<string, unknown>>;
  readonly builder?: Builder;
} = {}): WorkshopClients {
  const picture = (): Buffer => opts.picture ?? readFileSync(fileURLToPath(new URL('./body/base.jpg', import.meta.url)));
  return {
    images: {
      generate: ({ n }) => Promise.resolve(Array.from({ length: n }, () => picture())),
      edit: ({ images, n }) => Promise.resolve(Array.from({ length: n }, () => images[0] ?? picture())),
    },
    segmenter: {
      find: () => Promise.resolve([{ box: [200, 200, 800, 800] as const, mask: null, confidence: 0.9 }]),
    },
    judge: {
      json: <T>({ name }: { readonly name: string }): Promise<T> => {
        if (!opts.judged || !(name in opts.judged)) return Promise.reject(new Error(`fake judge: no answer for "${name}"`));
        return Promise.resolve(opts.judged[name] as T);
      },
    },
    mesher: { fromImage: () => Promise.resolve(readFileSync(MUSE6)) },
    builder: opts.builder ?? { available: () => Promise.resolve(false), run: () => Promise.resolve({ ok: false, log: 'no builder in fakes' }) },
  };
}
