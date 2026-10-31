import type { MuseId, StoredEvent } from '../../../src/muse/contract';

/** A commit tried to append an event out of order. */
export class SeqConflictError extends Error {
  constructor(
    readonly museId: MuseId,
    readonly expected: number,
    readonly got: number,
  ) {
    super(`seq conflict for ${museId}: expected ${expected}, got ${got}`);
    this.name = 'SeqConflictError';
  }
}

/** Throws unless each event's seq is its Muse's last seq + 1, in batch order. */
export function checkSeqs(events: readonly StoredEvent[], lastSeq: (museId: MuseId) => number): void {
  const last = new Map<MuseId, number>();
  for (const e of events) {
    const expected = (last.get(e.museId) ?? lastSeq(e.museId)) + 1;
    if (e.seq !== expected) throw new SeqConflictError(e.museId, expected, e.seq);
    last.set(e.museId, e.seq);
  }
}
