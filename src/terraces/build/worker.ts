import buildHash from 'virtual:terraces-build-hash';
import { buildTerraces, type BuildInput, type BuildOutput, type ChunkData } from './construct';

// The terraces' build in a worker of its own (builder.ts): the whole planet's,
// from the planet's own fields, while the page draws on; its geometry handed
// back without a copy. Each finished build is kept in the browser (IndexedDB),
// under its seed and a hash of the build's own code (vite.config.ts), so a page
// loads it again in a moment rather than build it, unless that code changed
// (Kai: no rebuild unless the geometry changed). One build is kept, the last.

/** What the worker says: the build (built, or loaded as kept), then, if it is keeping it, when that is done. */
export type BuildMessage = { kind: 'built'; out: BuildOutput; kept: boolean; keeping: boolean; ms: number } | { kind: 'kept' };

const scope = self as unknown as { onmessage: ((e: MessageEvent<BuildInput>) => void) | null; postMessage(message: BuildMessage, transfer?: Transferable[]): void };

const DB = 'terraces-builds';
const STORE = 'builds';
/** The kept builds' own format: bumped if what is kept changes shape. */
const FORMAT = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(new Error(String(req.error)));
  });
}

/** A kept build's first record: all of it but its chunks, and how many chunks it has (each its own record, `key/i`: a store takes no value over about 128 MB, a whole build is some 420). */
type Head = Omit<BuildOutput, 'chunks'> & { readonly chunks: number };

function load(db: IDBDatabase, key: string): Promise<BuildOutput | null> {
  return new Promise((done) => {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const req = store.get(`${key}/head`);
    req.onerror = () => done(null);
    req.onsuccess = () => {
      const head = req.result as Head | undefined;
      if (!head) return done(null);
      const chunks: Array<ChunkData | null> = new Array<ChunkData | null>(head.chunks).fill(null);
      let left = head.chunks;
      if (left === 0) return done({ ...head, chunks });
      for (let i = 0; i < head.chunks; i++) {
        const c = store.get(`${key}/${i}`);
        c.onsuccess = () => {
          chunks[i] = (c.result as ChunkData | undefined) ?? null;
          if (--left === 0) done({ ...head, chunks });
        };
        c.onerror = () => done(null);
      }
    };
  });
}

/** Keep a build, the only one kept, in one go (all its records or none): the store takes its copy as this is called, so its arrays can be handed over at once. */
function keep(db: IDBDatabase, key: string, out: BuildOutput): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  store.clear();
  const { chunks, ...rest } = out;
  const head: Head = { ...rest, chunks: chunks.length };
  store.put(head, `${key}/head`);
  chunks.forEach((c, i) => {
    if (c) store.put(c, `${key}/${i}`);
  });
  return new Promise((done) => {
    const failed = (): void => {
      console.warn('The terraces build was not kept:', String(tx.error));
      done();
    };
    tx.oncomplete = () => done();
    tx.onerror = failed;
    tx.onabort = failed;
  });
}

async function build(input: BuildInput): Promise<void> {
  const started = performance.now();
  const key = `${FORMAT}:${buildHash}:${input.seed}`;
  const db = await open().catch(() => null);
  const found = db ? await load(db, key).catch(() => null) : null;
  const out = found ?? buildTerraces(input);
  // (kept on a desktop only: the store's copy holds as much again while it is written)
  const keeping = db !== null && found === null && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  let written: Promise<void> | null = null;
  if (keeping && db) {
    try {
      written = keep(db, key, out);
    } catch {
      written = null;
    }
  }
  const transfer: Transferable[] = [out.trees.buffer, out.peaks.buffer, out.houses.buffer];
  for (const c of out.chunks) if (c) transfer.push(c.position.buffer, c.normal.buffer, c.part.buffer, c.paddy.buffer, c.floor.buffer, c.index.buffer);
  scope.postMessage({ kind: 'built', out, kept: found !== null, keeping: written !== null, ms: performance.now() - started }, transfer);
  if (written) {
    await written;
    scope.postMessage({ kind: 'kept' });
  }
}

scope.onmessage = (e) => {
  void build(e.data);
};
