// A stand-in garden that serves src/muse/samples.ts, so the overlay can talk to a live server before the engine
// exists. Only the hero Muse has samples; the rest of the cast is known but empty.
import type { GardenCommands, GardenQueries, Instant, MuseId, Page } from '../../src/muse/contract';
import {
  HERO,
  sampleBaskets,
  sampleCards,
  sampleInvitations,
  sampleJournalMd,
  sampleMetrics,
  sampleMind,
  sampleMuses,
  sampleNowExploring,
  samplePhotos,
  sampleSharing,
  sampleShelf,
  sampleSoulMd,
  sampleVisit,
  sampleWorld,
} from '../../src/muse/samples';

const HOUR = 3_600_000;
const JOURNAL_DAY = '2026-11-04';
/** The hero is the guest of the sample invitation; its visit is readable from when it was used until the view's end. */
const usedAt = sampleInvitations.find((i) => i.id === sampleVisit.invitation)!.usedAt!;

function heroOnly<T>(museId: MuseId, value: T): T | null {
  return museId === HERO ? value : null;
}

/** Newest first, as the samples are. An unknown cursor gives an empty page. */
function page<T extends { readonly id: C }, C>(items: readonly T[], before: C | null, limit: number): Page<T, C> {
  const from = before === null ? 0 : items.findIndex((item) => item.id === before) + 1;
  const rest = before !== null && from === 0 ? [] : items.slice(from);
  const chunk = rest.slice(0, limit);
  return { items: chunk, next: rest.length > limit ? chunk[chunk.length - 1].id : null };
}

export function fakeQueries(): GardenQueries {
  return {
    now: (museId) => heroOnly(museId, sampleNowExploring),
    world: (museId) => heroOnly(museId, sampleWorld),
    plant: (museId, id) => heroOnly(museId, sampleCards.find((c) => c.id === id) ?? null),
    baskets: (museId, before, limit) => page(heroOnly(museId, sampleBaskets.items) ?? [], before, limit),
    photos: (museId, before, limit) => page(heroOnly(museId, samplePhotos.items) ?? [], before, limit),
    shelf: (museId) => heroOnly(museId, sampleShelf),
    invitations: (museId) => heroOnly(museId, sampleInvitations) ?? [],
    visit: (invitation, requester, at) =>
      invitation === sampleVisit.invitation && requester === HERO && at >= usedAt && at < sampleVisit.until
        ? sampleVisit
        : 'forbidden',
    sharing: (museId) => heroOnly(museId, sampleSharing),
    mind: (museId) => heroOnly(museId, sampleMind),
    metrics: (museId) => heroOnly(museId, sampleMetrics) ?? [],
    soulMd: (museId) => heroOnly(museId, sampleSoulMd),
    journalMd: (museId, day) => (day === null || day === JOURNAL_DAY ? heroOnly(museId, sampleJournalMd) : null),
    muses: () => sampleMuses,
    garden: () => null,
  };
}

type CommandName = Exclude<keyof GardenCommands, 'clock'>;
/** One recorded command and the arguments it got. */
export type FakeCall = { [K in CommandName]: { readonly name: K; readonly args: Parameters<GardenCommands[K]> } }[CommandName];

export interface FakeCommands extends GardenCommands {
  readonly calls: readonly FakeCall[];
}

/**
 * Records every command and accepts it. The dev clock starts at the samples' "now", in fast-forward; `advance`
 * moves it, and live mode runs it on with wall time.
 */
export function fakeCommands(): FakeCommands {
  const calls: FakeCall[] = [];
  let mode: 'live' | 'fast-forward' = 'fast-forward';
  let anchor = { sim: sampleNowExploring.at as number, wall: Date.now() };
  const now = () => anchor.sim + (mode === 'live' ? Date.now() - anchor.wall : 0);
  const accept = (call: FakeCall) => {
    calls.push(call);
    return Promise.resolve({ ok: true } as const);
  };

  return {
    calls,
    setBasketTime: (...args) => accept({ name: 'setBasketTime', args }),
    setHidden: (...args) => accept({ name: 'setHidden', args }),
    introduce: (...args) => accept({ name: 'introduce', args }),
    unshare: (...args) => accept({ name: 'unshare', args }),
    like: (...args) => accept({ name: 'like', args }),
    useInvitation: (...args) => accept({ name: 'useInvitation', args }),
    withdrawInvitation: (...args) => accept({ name: 'withdrawInvitation', args }),
    hostWork: (...args) => accept({ name: 'hostWork', args }),
    hostSoul: (...args) => accept({ name: 'hostSoul', args }),
    hostMemory: (...args) => accept({ name: 'hostMemory', args }),
    advance: (hours) => {
      anchor = { sim: now() + hours * HOUR, wall: Date.now() };
      return accept({ name: 'advance', args: [hours] });
    },
    setClock: (next) => {
      anchor = { sim: now(), wall: Date.now() };
      mode = next;
      return accept({ name: 'setClock', args: [next] });
    },
    clock: () => ({ mode, now: now() as Instant }),
  };
}
