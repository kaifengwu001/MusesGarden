// A stand-in garden that serves src/muse/samples.ts, so the overlay can talk to a live server before the engine
// exists. Only the hero Muse has samples; the rest of the cast is known but empty.
import type { Find, GardenSnapshot, Postcard } from '../../src/garden/types';
import type { GardenCommands, GardenQueries, Instant, MuseId, Page, TopicKey } from '../../src/muse/contract';
import { PLANETS } from '../../src/muse/planets';
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
import { localDay } from '../domain/time';
import { assignStills } from '../../src/assets/postcards/stills';
import { coatOf, flowerOf, museStatus, shownAs, soulLine, stillKey, topicLabel } from '../engine/garden';

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

const day = (at: number) => localDay(at, 'America/Los_Angeles');

/** The samples as the garden's interface sees them. A find comes home in the first basket that holds it. */
function sampleGarden(): GardenSnapshot {
  const topicOf = new Map(sampleWorld.plants.map((p) => [p.id as string, p.topic]));
  const shared = new Set(sampleSharing.interests.filter((i) => !i.hidden).map((i) => i.topic as string));
  const hiddenFinds = new Set(sampleSharing.finds.filter((f) => f.hidden).map((f) => f.id as string));
  const placed = new Set<string>();
  const baskets = [...sampleBaskets.items].reverse().map((b) => {
    const cards = b.items.filter((c) => !placed.has(c.id));
    for (const c of cards) placed.add(c.id);
    return { basket: { id: b.id, day: day(b.at), finds: cards.map((c) => c.id) }, cards };
  });
  const finds: Find[] = baskets.flatMap(({ basket, cards }) =>
    cards.map((c) => ({
      id: c.id,
      basket: basket.id,
      topic: topicOf.get(c.id) ?? c.title,
      media: { kind: 'article', url: c.url, source: 'en.wikipedia.org', title: c.title, text: c.summary, image: c.thumb },
      note: c.reason,
      place: c.place.dir,
      shared: !hiddenFinds.has(c.id),
    })),
  );
  const topics = [...new Set([...sampleMind.interests.map((i) => i.topic as string), ...finds.map((f) => f.topic)])];
  const invitation = sampleInvitations.find((i) => i.id === sampleVisit.invitation)!;
  const host = sampleVisit.host;
  const shown = assignStills(
    [...samplePhotos.items.map((p) => ({ id: p.id, key: stillKey(p), day: day(p.at) })), { id: invitation.id, key: 'invitation' as const, day: day(invitation.sentAt) }],
    HERO,
  );
  const postcards: Postcard[] = [
    ...samplePhotos.items.map((p) => ({
      id: p.id,
      day: day(p.at),
      ...shownAs(shown.get(p.id)),
      place: p.planetOf === HERO ? 'Out exploring' : `On ${p.companionNames[0]}’s planet`,
      with: p.companions[0],
    })),
    {
      id: invitation.id,
      day: day(invitation.sentAt),
      ...shownAs(shown.get(invitation.id)),
      place: `From ${host.name}’s planet`,
      with: host.museId,
      invitation: {
        from: host.museId,
        fromName: host.name,
        coat: coatOf(host.museId),
        world: sampleVisit.planet,
        worldName: PLANETS[sampleVisit.planet].title,
        blurb: `${host.name}’s planet · Where ${host.name} keeps Lichen.`,
        seed: sampleVisit.worldSeed,
        g: sampleVisit.g,
        look: host.look,
        used: false,
      },
    },
  ];
  return {
    today: day(sampleNowExploring.at),
    world: { seed: sampleWorld.worldSeed, g: sampleWorld.g },
    muse: { name: sampleNowExploring.name, soul: soulLine(sampleSoulMd), status: museStatus(sampleNowExploring), reach: 'shared' },
    interests: topics.map((topic) => ({
      id: topic,
      name: topicLabel(topic as TopicKey),
      ...flowerOf(topic),
      shared: shared.has(topic),
      since: day(sampleCards[0].foundAt),
    })),
    friends: sampleSharing.friends.map((f) => ({
      id: f.museId,
      name: f.name,
      coat: coatOf(f.museId),
      shared: [...shared].map((t) => topicLabel(t as TopicKey)),
      met: day(sampleMind.relationships.find((r) => r.other === f.museId)?.lastMetAt ?? sampleNowExploring.at),
    })),
    baskets: baskets.map(({ basket }) => basket),
    finds,
    postcards,
  };
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
        ? { ...sampleVisit, now: at }
        : 'forbidden',
    sharing: (museId) => heroOnly(museId, sampleSharing),
    mind: (museId) => heroOnly(museId, sampleMind),
    metrics: (museId) => heroOnly(museId, sampleMetrics) ?? [],
    soulMd: (museId) => heroOnly(museId, sampleSoulMd),
    journalMd: (museId, day) => (day === null || day === JOURNAL_DAY ? heroOnly(museId, sampleJournalMd) : null),
    muses: () => sampleMuses,
    garden: (museId) => heroOnly(museId, sampleGarden()),
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
    setReach: (...args) => accept({ name: 'setReach', args }),
    introduce: (...args) => accept({ name: 'introduce', args }),
    unshare: (...args) => accept({ name: 'unshare', args }),
    like: (...args) => accept({ name: 'like', args }),
    favorite: (...args) => accept({ name: 'favorite', args }),
    useInvitation: (...args) => accept({ name: 'useInvitation', args }),
    withdrawInvitation: (...args) => accept({ name: 'withdrawInvitation', args }),
    returnFromVisit: (...args) => accept({ name: 'returnFromVisit', args }),
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
