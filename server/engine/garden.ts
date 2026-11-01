// The garden's interface (src/garden/types.ts) filled from the engine: one Muse's snapshot, and the events that
// change it, read from its state and its log. Pure: Views gathers the input.
import { hash32, salt, unit } from '../../src/core/hash';
import type {
  Basket,
  Find,
  GardenEvent,
  GardenSnapshot,
  Interest,
  Invitation,
  Media,
  MuseFriend,
  MuseStatus,
  Postcard,
} from '../../src/garden/types';
import type {
  Basket as DeliveredBasket,
  Discovery,
  DiscoveryId,
  EpisodePlan,
  GardenFrame,
  Instant,
  Interest as MuseInterest,
  Invitation as MuseInvitation,
  InvitationState,
  MuseEvent,
  MuseId,
  MuseState,
  Network,
  NowView,
  PhotoId,
  PhotoSpec,
  PhotoSubject,
  PublicProfile,
  Relationship,
  StoredEvent,
  TopicKey,
} from '../../src/muse/contract';

/** Everything the garden reads of one Muse. */
export interface GardenInput {
  readonly s: MuseState;
  /** Muse's log, read only when a find's trip or a photo's moment is needed. */
  readonly log: () => readonly StoredEvent[];
  /** SOUL.md without its frontmatter, as the Muse app last sent it. */
  readonly soul: string | null;
  readonly now: NowView;
  readonly g: number;
  /** The owner's local YYYY-MM-DD. */
  readonly day: (at: Instant) => string;
  /** Any Muse's public profile, this one's included. */
  readonly profile: (id: MuseId) => PublicProfile | null;
  readonly salienceAt: (i: MuseInterest, at: Instant) => number;
}

export const topicLabel = (t: TopicKey): string => t.replace(/_/g, ' ');

const SOUL_CHARS = 160;
const TOP_INTERESTS = 12;
/** A friend's card names this many interests the two share, the ones Muse cares for most. */
const SHARED_SHOWN = 3;
const COATS = ['#f2c4a0', '#c3d6b8', '#c4d0e6', '#efe6c8', '#e8c6d0', '#d4c8e6', '#c8e2dc', '#ead0b0'] as const;
const NETWORKS: Readonly<Record<Exclude<Network, 'web'>, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  tiktok: 'TikTok',
  flickr: 'Flickr',
  bluesky: 'Bluesky',
};
/** Stand-ins in src/assets/postcards/ until a photo is rendered from its pose. */
const POSTCARD_IMAGES: Readonly<Record<PhotoSubject | 'invitation', string>> = {
  selfie: 'close',
  friend: 'terrace',
  'new-friend': 'pier',
  scenery: 'meadow',
  creature: 'meadow',
  find: 'cottage',
  invitation: 'pier',
};
/** Invitation states the guest's owner still holds: sent (kept for later) or used. A withdrawn one is gone. */
const RECEIVED: ReadonlySet<InvitationState> = new Set(['sent', 'used']);

// ─── What the log adds to the state ─────────────────────────────────────────

/** What Muse was doing when a photo was taken. */
interface Moment {
  readonly plan: EpisodePlan | null;
  readonly hop: TopicKey | null;
}

interface LogIndex {
  /** The topic of the trip that found each of Muse's own finds. */
  readonly tripTopic: ReadonlyMap<DiscoveryId, TopicKey>;
  readonly moments: ReadonlyMap<PhotoId, Moment>;
  /** When each topic first came up. */
  readonly firstSeen: ReadonlyMap<TopicKey, Instant>;
  /** When each friend last became a friend. */
  readonly friendsSince: ReadonlyMap<MuseId, Instant>;
}

function indexLog(log: readonly StoredEvent[]): LogIndex {
  const tripTopic = new Map<DiscoveryId, TopicKey>();
  const moments = new Map<PhotoId, Moment>();
  const firstSeen = new Map<TopicKey, Instant>();
  const friendsSince = new Map<MuseId, Instant>();
  const seen = (topics: readonly TopicKey[], at: Instant) => {
    for (const t of topics) if (!firstSeen.has(t)) firstSeen.set(t, at);
  };
  let plan: EpisodePlan | null = null;
  let trip: TopicKey | null = null;
  let hop: TopicKey | null = null;
  for (const { event: e } of log) {
    switch (e.kind) {
      case 'episode.started':
        plan = e.plan;
        trip = e.plan.activity === 'travel' && e.plan.trip.kind !== 'serendipity' ? e.plan.trip.topic : null;
        hop = null;
        break;
      case 'episode.ended':
        plan = trip = hop = null;
        break;
      case 'trip.hop':
        trip ??= e.topic;
        hop = e.topic;
        seen([e.topic], e.at);
        break;
      case 'discovery.collected':
        if (trip) tripTopic.set(e.discovery.id, trip);
        seen(e.discovery.topics, e.at);
        break;
      case 'photo.taken':
        moments.set(e.photo.id, { plan, hop });
        break;
      case 'soul.updated':
      case 'memory.updated':
        seen(e.topics, e.at);
        break;
      case 'hangout':
        seen(e.received?.topics ?? [], e.at);
        break;
      case 'relationship.changed':
        if (e.to === 'friends') friendsSince.set(e.other, e.at);
        break;
      case 'owner.introduced':
        friendsSince.set(e.other, e.at);
        break;
    }
  }
  return { tripTopic, moments, firstSeen, friendsSince };
}

// ─── One thing at a time ────────────────────────────────────────────────────

/** SOUL.md's first paragraph of prose, as one line of at most 160 characters: whole sentences when they fit. */
export function soulLine(soul: string | null): string {
  const paragraph = (soul ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)))
    .find((lines) => lines.length > 0 && !lines.every((line) => /^\s*([-*+]|\d+\.)\s/.test(line) || line.trim() === ''))
    ?.join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!paragraph) return '';
  if (paragraph.length <= SOUL_CHARS) return paragraph;
  const sentences = /^.*[.!?…](?=\s)/.exec(paragraph.slice(0, SOUL_CHARS + 1))?.[0];
  if (sentences) return sentences;
  const cut = paragraph.slice(0, SOUL_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:]+$/, '')}…`;
}

export function museStatus(now: NowView): MuseStatus {
  const out = now.activity === 'travel' || now.away !== null;
  return { home: !out, where: now.activity === 'travel' ? now.path?.at(-1)?.dir : undefined, note: now.label };
}

/** The flower an interest grows as, from its topic alone, so it never changes. */
export function flowerOf(topic: string): Pick<Interest, 'species' | 'variant'> {
  const h = salt(topic);
  return { species: (h % 4) as Interest['species'], variant: unit(hash32(h)) };
}

export function coatOf(id: string): string {
  return COATS[salt(id) % COATS.length];
}

export function postcardImage(subject: PhotoSubject | 'invitation'): string {
  return `/api/postcards/${POSTCARD_IMAGES[subject]}.jpg`;
}

/** Kai's card for a find: its own network's name, or an article site's own name, and the picture the server can show. */
function mediaOf(d: Discovery): Media {
  const info = d.media;
  const titled = info.kind === 'article' || info.kind === 'video';
  return {
    kind: info.kind,
    url: d.url,
    source: info.site ?? (info.network === 'web' ? new URL(d.url).hostname.replace(/^www\./, '') : NETWORKS[info.network]),
    author: info.author,
    title: titled ? d.title : undefined,
    text: titled ? d.summary : d.summary || d.title,
    image: info.image,
    aspect: info.aspect,
    duration: info.duration,
    minutes: info.minutes,
    published: info.published,
  };
}

function findTopic(d: Discovery, index: LogIndex): TopicKey {
  return d.pursuing ?? index.tripTopic.get(d.id) ?? d.topics[0] ?? (d.title as TopicKey);
}

function basketOf(input: GardenInput, b: DeliveredBasket): { readonly basket: Basket; readonly finds: readonly Discovery[] } {
  const finds = b.items.map((id) => input.s.discoveries.get(id)).filter((d): d is Discovery => d !== undefined);
  return { basket: { id: b.id, day: input.day(b.at), finds: finds.map((d) => d.id) }, finds };
}

function findOf(s: MuseState, d: Discovery, basket: string, index: LogIndex): Find {
  return {
    id: d.id,
    basket,
    topic: findTopic(d, index),
    media: mediaOf(d),
    note: d.reason,
    place: d.place.dir,
    shared: !s.hidden.has(`discovery:${d.id}`),
    liked: s.likes.get(d.id)?.liked ?? false,
  };
}

function nameOf(input: GardenInput, id: MuseId): string {
  return input.profile(id)?.name ?? 'a friend';
}

/** Where a photo was taken, as Muse would put it. */
function placeOf(input: GardenInput, p: PhotoSpec, moment: Moment | undefined): string {
  if (p.planetOf !== input.s.seed.id) return `On ${nameOf(input, p.planetOf)}’s planet`;
  const plan = moment?.plan;
  switch (plan?.activity) {
    case 'beyond':
      return 'Beyond the planet';
    case 'travel':
      return moment?.hop ? `Out exploring ${topicLabel(moment.hop)}` : 'Out exploring';
    case 'visit':
      return `${nameOf(input, plan.other)} came by`;
    default:
      return 'At home';
  }
}

function photoCard(input: GardenInput, p: PhotoSpec, index: LogIndex): Postcard {
  return {
    id: p.id,
    day: input.day(p.at),
    image: postcardImage(p.subject),
    place: placeOf(input, p, index.moments.get(p.id)),
    with: p.companions[0],
    liked: input.s.likes.get(p.id)?.liked ?? false,
  };
}

function interestSince(s: MuseState, topic: TopicKey, index: LogIndex): Instant {
  return s.interests.get(topic)?.since ?? index.firstSeen.get(topic) ?? s.at;
}

function friendsSince(s: MuseState, r: Relationship, index: LogIndex): Instant {
  return r.friendsSince ?? index.friendsSince.get(r.other) ?? r.lastMetAt ?? s.at;
}

/** An invitation this Muse's owner received, as a postcard; null for any other invitation. */
function invitationCard(input: GardenInput, inv: MuseInvitation): Postcard | null {
  if (inv.guest !== input.s.seed.id || !RECEIVED.has(inv.state)) return null;
  const host = input.profile(inv.host);
  const name = host?.name ?? 'a friend';
  const loves = (host?.interests ?? []).slice(0, 3).map((i) => topicLabel(i.topic));
  const invitation: Invitation = {
    from: inv.host,
    world: inv.host,
    worldName: `${name}’s planet`,
    blurb: loves.length > 0 ? `Where ${name} keeps ${list(loves)}.` : `${name} would like to show you round.`,
    used: inv.state === 'used',
  };
  return { id: inv.id, day: input.day(inv.sentAt), image: postcardImage('invitation'), place: `From ${name}’s planet`, with: inv.host, invitation };
}

function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// ─── The snapshot ───────────────────────────────────────────────────────────

export function gardenSnapshot(input: GardenInput): GardenSnapshot {
  const { s } = input;
  const index = indexLog(input.log());
  const delivered = s.baskets.map((b) => basketOf(input, b));
  const finds = delivered.flatMap(({ basket, finds }) => finds.map((d) => findOf(s, d, basket.id, index)));
  const postcards = [
    ...s.photos.map((p) => photoCard(input, p, index)),
    ...[...s.social.invitations.values()].map((inv) => invitationCard(input, inv)).filter((p): p is Postcard => p !== null),
  ];
  return {
    world: { seed: s.seed.worldSeed, g: input.g },
    muse: { name: s.seed.name, soul: soulLine(input.soul), status: museStatus(input.now) },
    interests: interests(input, finds, index),
    friends: friends(input, index),
    baskets: delivered.map(({ basket }) => basket),
    finds,
    postcards,
  };
}

/** Muse's top interests, then every other one a delivered find grows as. */
function interests(input: GardenInput, finds: readonly Find[], index: LogIndex): Interest[] {
  const { s } = input;
  const at = input.now.at;
  const weight = (i: MuseInterest) => i.affinity + input.salienceAt(i, at);
  const top = [...s.interests.values()].sort((a, b) => weight(b) - weight(a)).slice(0, TOP_INTERESTS).map((i) => i.topic);
  const shared = new Set(input.profile(s.seed.id)?.interests.map((i) => i.topic));
  const topics = new Set<TopicKey>([...top, ...finds.map((f) => f.topic as TopicKey)]);
  return [...topics].map((topic) => ({
    id: topic,
    name: topicLabel(topic),
    ...flowerOf(topic),
    shared: shared.has(topic),
    since: input.day(interestSince(s, topic, index)),
  }));
}

function friends(input: GardenInput, index: LogIndex): MuseFriend[] {
  const { s } = input;
  const mine = input.profile(s.seed.id)?.interests ?? [];
  return [...s.social.relationships.values()]
    .filter((r) => r.status === 'friends')
    .map((r) => {
      const other = input.profile(r.other);
      const theirs = new Set(other?.interests.map((i) => i.topic));
      return {
        id: r.other,
        name: other?.name ?? 'a friend',
        coat: coatOf(r.other),
        shared: mine.filter((i) => theirs.has(i.topic)).slice(0, SHARED_SHOWN).map((i) => topicLabel(i.topic)),
        met: input.day(friendsSince(s, r, index)),
        ...(s.social.knownOn.has(r.other) ? { knownOn: s.social.knownOn.get(r.other) } : {}),
      };
    });
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Events that change what Muse is doing or where. */
const MOVES: ReadonlySet<MuseEvent['kind']> = new Set(['episode.started', 'episode.ended', 'episode.paused', 'episode.resumed', 'trip.hop', 'host.work']);

/**
 * The garden events that `events` (this Muse's, in log order) bring, each framed with the seq it came from, then
 * Muse's status: always, or only if one of them moved Muse. The status is framed with the last seq folded in.
 * A like, or a find made public or private, sends its basket or its postcard again as it now stands.
 */
export function gardenFrames(input: GardenInput, events: readonly StoredEvent[], withStatus: 'always' | 'if-moved'): GardenFrame[] {
  const { s } = input;
  let index: LogIndex | null = null;
  const indexed = () => (index ??= indexLog(input.log()));
  const frames: GardenFrame[] = [];
  const frame = (id: number, event: GardenEvent) => frames.push({ id, event });
  const basketEvent = (b: DeliveredBasket): GardenEvent => {
    const { basket, finds } = basketOf(input, b);
    return { type: 'basket', basket, finds: finds.map((d) => findOf(s, d, basket.id, indexed())) };
  };
  const holding = (ids: readonly string[]) => s.baskets.filter((b) => b.items.some((id) => ids.includes(id)));
  for (const { seq, event: e } of events) {
    if (e.kind === 'basket.delivered') {
      frame(seq, basketEvent(e.basket));
    } else if (e.kind === 'photo.taken') {
      frame(seq, { type: 'postcard', postcard: photoCard(input, e.photo, indexed()) });
    } else if (e.kind === 'owner.liked') {
      const { target } = e;
      const photo = 'photo' in target ? s.photos.find((p) => p.id === target.photo) : undefined;
      if (photo) frame(seq, { type: 'postcard', postcard: photoCard(input, photo, indexed()) });
      if ('find' in target) for (const b of holding([target.find])) frame(seq, basketEvent(b));
    } else if (e.kind === 'owner.settings') {
      const finds = [...(e.hide ?? []), ...(e.unhide ?? [])].filter((r) => r.startsWith('discovery:')).map((r) => r.slice('discovery:'.length));
      for (const b of holding(finds)) frame(seq, basketEvent(b));
    } else if (e.kind === 'invitation') {
      const inv = s.social.invitations.get(e.id);
      const postcard = inv ? invitationCard(input, inv) : null;
      if (postcard) frame(seq, { type: 'postcard', postcard });
    }
  }
  if (withStatus === 'always' || events.some((e) => MOVES.has(e.event.kind))) frame(s.seq, { type: 'status', status: museStatus(input.now) });
  return frames;
}
