import type {
  CommitBatch,
  EventRef,
  Instant,
  MuseEvent,
  Actor,
  MuseEventBody,
  MuseId,
  MuseState,
  ScheduleItem,
  StoredEvent,
} from '../../src/muse/contract';

export type Fold = (s: MuseState, e: StoredEvent) => MuseState;

/**
 * Everything one schedule item changes, built in memory and committed at once. Events fold into a working copy as
 * they are emitted, so later decisions in the same item see them; nothing touches the store until commit.
 */
export class Tx {
  private readonly events: StoredEvent[] = [];
  private readonly adds = new Map<string, ScheduleItem>();
  private readonly removes = new Set<string>();
  private readonly working = new Map<MuseId, MuseState>();

  constructor(
    private readonly base: (id: MuseId) => MuseState,
    private readonly fold: Fold,
    readonly now: Instant,
  ) {}

  state(id: MuseId): MuseState {
    return this.working.get(id) ?? this.base(id);
  }

  /** `by` names who acted; leave it out for the garden's own rules (read as 'garden'). */
  emit(id: MuseId, body: MuseEventBody, by?: Actor): EventRef {
    const s = this.state(id);
    const event = (by === undefined ? { ...body, at: this.now } : { ...body, at: this.now, by }) as MuseEvent;
    const stored: StoredEvent = { museId: id, seq: s.seq + 1, event };
    this.events.push(stored);
    this.working.set(id, this.fold(s, stored));
    return `${id}#${stored.seq}` as EventRef;
  }

  emitAll(id: MuseId, bodies: readonly MuseEventBody[], by?: Actor): void {
    for (const b of bodies) this.emit(id, b, by);
  }

  schedule(item: ScheduleItem): void {
    this.removes.delete(item.id);
    this.adds.set(item.id, item);
  }

  remove(id: string): void {
    this.adds.delete(id);
    this.removes.add(id);
  }

  emitted(): readonly StoredEvent[] {
    return this.events;
  }

  touched(): ReadonlyMap<MuseId, MuseState> {
    return this.working;
  }

  batch(): CommitBatch {
    return { remove: [...this.removes], events: this.events, schedule: [...this.adds.values()] };
  }
}
