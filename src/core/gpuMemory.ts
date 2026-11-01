import type { BufferGeometry } from 'three';

// A ledger of GPU allocations we make ourselves (render targets, atlases,
// instance buffers). WebGL cannot report real usage, so systems record byte
// estimates here and the perf HUD checks the total against the 256 MB budget.

const entries = new Map<string, number>();

export const gpuMemory = {
  set(name: string, bytes: number): void {
    entries.set(name, bytes);
  },
  delete(name: string): void {
    entries.delete(name);
  },
  total(): number {
    let sum = 0;
    for (const bytes of entries.values()) sum += bytes;
    return sum;
  },
  entries(): ReadonlyMap<string, number> {
    return entries;
  },
};

/** Bytes a geometry holds on the GPU: every attribute and the index. */
export function geometryBytes(g: BufferGeometry): number {
  const index = g.getIndex()?.array.byteLength ?? 0;
  return Object.values(g.attributes).reduce((sum, a) => sum + a.array.byteLength, index);
}
