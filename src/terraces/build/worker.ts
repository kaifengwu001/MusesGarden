import { buildTerraces, type BuildInput, type BuildOutput } from './construct';

// The terraces' build in a worker of its own (builder.ts): the whole planet's,
// from the planet's own fields, while the page draws on; its geometry handed
// back without a copy.

const scope = self as unknown as { onmessage: ((e: MessageEvent<BuildInput>) => void) | null; postMessage(message: BuildOutput, transfer: Transferable[]): void };

scope.onmessage = (e) => {
  const out = buildTerraces(e.data);
  const transfer: Transferable[] = [out.trees.buffer];
  for (const c of out.chunks) if (c) transfer.push(c.position.buffer, c.normal.buffer, c.part.buffer, c.paddy.buffer, c.floor.buffer, c.index.buffer);
  scope.postMessage(out, transfer);
};
