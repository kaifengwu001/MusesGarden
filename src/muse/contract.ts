// The shared contract for the Muse agent. The server (server/) and the overlay
// (src/muse/ui/) both import it. Types only: this file emits no runtime code.
// Rationale: docs/muse-agent.md.

import type { GardenEvent, GardenSnapshot, MediaKind, Reach } from '../garden/types';

export type { Reach };

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MuseId = Brand<string, 'MuseId'>;
export type DiscoveryId = Brand<string, 'DiscoveryId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type BasketId = Brand<string, 'BasketId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type InvitationId = Brand<string, 'InvitationId'>;
/** A cell of the cube-sphere grid: `${face}:${i}:${j}`, face 0–5, i and j in [0, REGION_GRID) (server/domain/atlas.ts, 4 to start). */
export type RegionKey = Brand<string, 'RegionKey'>;
/** A topic of the topic map by its canonical name, e.g. "Ultramarine". */
export type TopicKey = Brand<string, 'TopicKey'>;
/** https, lowercase host, no query tracking params, no fragment. */
export type CanonicalUrl = Brand<string, 'CanonicalUrl'>;
/** Milliseconds since the Unix epoch on the sim clock. */
export type Instant = Brand<number, 'Instant'>;
/** `${museId}#${seq}`: one event in one Muse's log. */
export type EventRef = Brand<string, 'EventRef'>;

// ─── Personality ────────────────────────────────────────────────────────────

/** Every trait is in [0, 1]. Read from SOUL.md frontmatter, or estimated by the Mind from its prose. */
export interface Temperament {
  readonly curiosity: number;
  /** Stays on a rabbit hole. */
  readonly focus: number;
  readonly sociability: number;
  /** Photo-taking. */
  readonly whimsy: number;
  /** 0 = homebody who loves old places, 1 = explorer who wants new ones. */
  readonly novelty: number;
}

export type InterestStage = 'hypothesis' | 'emerging' | 'established' | 'fading';

// ─── What Muse finds on the internet ────────────────────────────────────────

export type { MediaKind };
/** Where a find lives online. */
export type Network = 'instagram' | 'facebook' | 'youtube' | 'vimeo' | 'tiktok' | 'flickr' | 'bluesky' | 'web';
/** A find as it lives online, beyond its url, title and text: what kind it is, where, by whom, and its picture. */
export interface MediaInfo {
  readonly kind: MediaKind;
  readonly network: Network;
  /** A public account's handle, or an article's byline. */
  readonly author?: string;
  readonly image?: string;
  /** The picture's width over its height. */
  readonly aspect?: number;
  /** A reel's or a video's length (s). */
  readonly duration?: number;
  /** Minutes to read an article. */
  readonly minutes?: number;
  /** The site or app it lives on, as its own name: "YouTube", "Bluesky", a magazine's title. */
  readonly site?: string;
  /** When it was published online (ISO date). */
  readonly published?: string;
}

/** One real reel, post, article or video Muse looked at. A Discovery can only be made from a Candidate. */
export interface Candidate {
  readonly url: string;
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  /** Plain text, at most 400 characters: a caption, or an article's first lines. */
  readonly summary: string;
  /** Topics of the topic map it was filed under, the main one first (at most 6). */
  readonly topics: readonly TopicKey[];
  readonly media: MediaInfo;
}

/**
 * Where finds come from: the recorded reels, posts, articles and videos, each filed under topics of the topic map.
 * The topic map only names topics and links them; nothing Muse finds comes from it.
 */
export interface Source {
  /**
   * The first hop of a trip: finds about `topic`, best first. `kinds` is what the hop looks for, the kind it drew
   * first: finds of the first kind that has any, so a topic short of the drawn kind gives the next one.
   */
  search(topic: TopicKey, kinds: readonly MediaKind[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** Later hops: finds about the topics `from`'s topic links to in the topic map, by `kinds` as in search. */
  next(from: Candidate, kinds: readonly MediaKind[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** A wide pool unrelated to Muse's interests, for serendipity. Deterministic for a given seed offline. */
  serendipity(kinds: readonly MediaKind[], limit: number, seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** A free-text label to its topic in the topic map (names and their aliases), or null if the map has none. */
  resolveTopic(label: string): Promise<TopicKey | null>;
}

// ─── The Mind: content judgment only ────────────────────────────────────────

export interface MindContext {
  readonly name: string;
  /** SOUL.md body with the frontmatter removed. */
  readonly soul: string;
  readonly temperament: Temperament;
  readonly interests: readonly {
    readonly topic: TopicKey;
    readonly affinity: number;
    readonly salience: number;
    readonly stage: InterestStage;
  }[];
  /** The open question Muse carries on this trip, if any. */
  readonly question: string | null;
}

export interface Judgment {
  readonly canonicalUrl: CanonicalUrl;
  /** In [0, 1]. Muse keeps at most 2 per hop with score ≥ θ (KEEP_THRESHOLD in server/domain/policy/constants.ts). */
  readonly score: number;
  /** One line in Muse's own voice: "why I kept this". */
  readonly reason: string;
}

/** One experience offered to reflection. Reflection events are never experiences. */
export interface Experience {
  readonly ref: EventRef;
  readonly at: Instant;
  readonly kind: 'kept' | 'skipped' | 'encounter' | 'hangout' | 'gift';
  readonly topics: readonly TopicKey[];
  readonly canonicalUrl?: CanonicalUrl;
  readonly note: string;
  /** The owner liked this find, or a photo of it, in the garden. */
  readonly liked?: boolean;
}

export interface InterestDelta {
  readonly topic: TopicKey;
  /** Clamped to [−0.2, 0.2] by the validator. */
  readonly dAffinity: number;
  readonly stage?: InterestStage;
  /** Must cite at least one non-reflection event; the reducer re-checks these against the log. */
  readonly evidence: readonly EventRef[];
  readonly reason: string;
}

export interface ReflectionProposal {
  readonly deltas: readonly InterestDelta[];
  /** One line for SOUL.md's garden-owned section; empty when nothing changed. */
  readonly narrative: string;
  readonly questions: readonly { readonly topic: TopicKey; readonly text: string }[];
}

export interface Mind {
  /** Scores every candidate, in input order. */
  judge(ctx: MindContext, candidates: readonly Candidate[]): Promise<Judgment[]>;
  /** The next open question about `topic`, in Muse's voice. */
  proposeQuestion(ctx: MindContext, topic: TopicKey, recent: readonly Candidate[]): Promise<string>;
  reflect(ctx: MindContext, experiences: readonly Experience[]): Promise<ReflectionProposal>;
  /**
   * Interest labels (subjects, hobbies, media) from MEMORY.md or SOUL.md. Allow-list: never people, health,
   * money, relationships, places or identifiers. Callers still resolve each label through Source.resolveTopic
   * and run the domain's privacy filter, so a leak needs two failures.
   */
  extractInterests(text: string, from: 'memory' | 'soul'): Promise<string[]>;
  /** Used only when SOUL.md has no temperament frontmatter. */
  estimateTemperament(soul: string): Promise<Temperament>;
}

/** Caches Mind responses by a hash of (model, prompt) so reruns are free and identical. */
export interface LlmCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

// ─── Fixtures: the cast and its owners' inputs ──────────────────────────────

/**
 * server/fixtures/cast.json. Each member's folder holds SOUL.md and MEMORY.md.
 * SOUL.md frontmatter is flat `key: value` lines between `---` fences:
 * name, curiosity, focus, sociability, whimsy, novelty (traits optional; missing ones are estimated).
 */
export interface CastFile {
  readonly members: readonly CastMember[];
  /** Pairs whose owners introduced their Muses at the start. */
  readonly introductions: readonly (readonly [MuseId, MuseId])[];
  /** Pairs whose owners are friends on Instagram or Facebook (simulated: the platforms give no such list). */
  readonly knownOn: readonly { readonly a: MuseId; readonly b: MuseId; readonly on: KnownOn }[];
}

/** Where two owners are friends online. */
export type KnownOn = 'instagram' | 'facebook';

export interface CastMember {
  readonly id: MuseId;
  readonly name: string;
  readonly worldSeed: number;
  /** IANA zone of the owner, e.g. "America/Los_Angeles". */
  readonly timezone: string;
  /** Relative to server/fixtures/. */
  readonly dir: string;
  /** friend: introduced to the hero; known: its owner knows the hero's owner online; stranger: neither. */
  readonly role: 'hero' | 'friend' | 'known' | 'stranger';
}

/** server/fixtures/work-*.json: when each Muse is busy with its owner's tasks. ISO 8601 with offset. */
export type WorkSchedule = Readonly<Record<string, readonly { readonly start: string; readonly end: string }[]>>;

// ─── The planet ─────────────────────────────────────────────────────────────

/** A unit vector from the planet's centre ("rest space"): it never moves as the planet grows. */
export type Dir = readonly [number, number, number];

export interface Place {
  readonly dir: Dir;
  readonly region: RegionKey;
}

// ─── What Muse keeps ────────────────────────────────────────────────────────

export interface Discovery {
  readonly id: DiscoveryId;
  readonly url: string;
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  readonly summary: string;
  readonly topics: readonly TopicKey[];
  /** The events that led Muse here (the hop, and the seed or question behind the trip). */
  readonly because: readonly EventRef[];
  /** "Why I kept this", in Muse's voice. */
  readonly reason: string;
  readonly keepScore: number;
  readonly provenance: 'own' | 'gift';
  /** Where Muse found it. A gift: where Muse received it on its own planet, or near home if received away. */
  readonly place: Place;
  readonly at: Instant;
  readonly media: MediaInfo;
  /** The topic of the trip that found it: the interest it belongs to in the garden. A gift keeps its giver's. */
  readonly pursuing: TopicKey | null;
}

/** What other Muses may see of a find. No place, no provenance. */
export interface PublicDiscovery {
  readonly id: DiscoveryId;
  readonly url: string;
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  readonly summary: string;
  readonly topics: readonly TopicKey[];
  readonly media: MediaInfo;
  readonly pursuing: TopicKey | null;
}

export type PhotoSubject = 'selfie' | 'scenery' | 'creature' | 'find' | 'friend' | 'new-friend';

/** A photo is a reproducible view: the frontend turns dir/forward/zoom into the `pose=` hash on planetOf's world. */
export interface PhotoSpec {
  readonly id: PhotoId;
  readonly at: Instant;
  readonly subject: PhotoSubject;
  /** Where Muse took it: on planetOf's surface, or beyond the planet, looking back at planetOf from far out. */
  readonly context: 'planet' | 'beyond';
  readonly planetOf: MuseId;
  readonly dir: Dir;
  readonly forward: Dir;
  /** Camera zoom in [0, 1], as in the `pose=` hash. */
  readonly zoom: number;
  readonly companions: readonly MuseId[];
  readonly discoveryId?: DiscoveryId;
}

export interface Basket {
  readonly id: BasketId;
  readonly at: Instant;
  /** At most 7, Muse's best since the last basket by keep score. */
  readonly items: readonly DiscoveryId[];
}

export interface OpenQuestion {
  readonly id: QuestionId;
  readonly topic: TopicKey;
  readonly text: string;
  readonly openedAt: Instant;
}

export interface Interest {
  readonly topic: TopicKey;
  /** null until Muse first travels there; then the region the topic lives in. */
  readonly region: RegionKey | null;
  /** Fast: boosted by finds, owner mentions and likes, decays exp(−Δt / 3 days). Read it with salienceAt(), never raw. */
  readonly salience: { readonly value: number; readonly at: Instant };
  /** Slow: changes only through reflection.committed. */
  readonly affinity: number;
  readonly stage: InterestStage;
  /** Independent sources, by canonical URL. */
  readonly sources: readonly CanonicalUrl[];
  readonly lastPursued: Instant | null;
  readonly seededBy: 'owner-memory' | 'soul' | 'muse';
  /** The owner's MEMORY.md or SOUL.md mentioned it recently (feeds the w_owner term of the topic pick). */
  readonly ownerMentionAt: Instant | null;
  /** When the owner last liked a find about it that they hadn't liked before (feeds the w_like term of the topic pick). */
  readonly likedAt: Instant | null;
  /** When Muse took it up. */
  readonly since: Instant;
}

// ─── The log ────────────────────────────────────────────────────────────────

export interface Window {
  readonly start: Instant;
  readonly end: Instant;
}

export type Activity = 'rest' | 'travel' | 'beyond' | 'visit';

/** How a trip on Muse's own planet began. */
export type TripStart =
  | { readonly kind: 'revisit'; readonly topic: TopicKey; readonly region: RegionKey; readonly question: QuestionId | null }
  | {
      readonly kind: 'new-area';
      readonly topic: TopicKey;
      readonly region: RegionKey;
      readonly relatedTo: TopicKey | null;
      readonly question: QuestionId | null;
    }
  /** The topic comes from Source.serendipity once the trip starts; the region is far from home. */
  | { readonly kind: 'serendipity'; readonly region: RegionKey };

export type EpisodePlan =
  | { readonly activity: 'rest'; readonly until: Instant }
  | { readonly activity: 'travel'; readonly trip: TripStart }
  | { readonly activity: 'beyond'; readonly until: Instant }
  | { readonly activity: 'visit'; readonly other: MuseId; readonly role: 'host' | 'guest'; readonly until: Instant };

export interface Verdict {
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  readonly topics: readonly TopicKey[];
  readonly score: number;
  readonly reason: string;
  readonly kept: boolean;
}

/** Sent straight to the guest's owner. It never expires: the owner uses it once, or the host's owner withdraws it. */
export type InvitationState = 'sent' | 'used' | 'withdrawn';
export type RelationshipStatus = 'acquainted' | 'friends' | 'ended';
export type RelationshipOrigin = 'introduced' | 'met-beyond' | 'known-on';
/** Strangers meet beyond the planet; Muses whose owners know each other meet online, wherever they are. */
export type EncounterPlace = 'beyond' | 'online';
/** What the owner liked in the garden. */
export type LikeTarget = { readonly find: DiscoveryId } | { readonly photo: PhotoId };

/** Everything that can happen to a Muse. The engine assigns `at`; the store assigns nothing. */
export type MuseEventBody =
  // From the Muse app and the owner.
  | { readonly kind: 'host.work'; readonly state: 'started' | 'ended' }
  | { readonly kind: 'soul.updated'; readonly version: number; readonly topics: readonly TopicKey[]; readonly temperament: Temperament }
  /** Raw MEMORY.md is never stored: only its hash and the allow-listed topics. */
  | { readonly kind: 'memory.updated'; readonly textHash: string; readonly topics: readonly TopicKey[] }
  | {
      readonly kind: 'owner.settings';
      readonly basketTime?: string | null;
      readonly hide?: readonly HiddenRef[];
      readonly unhide?: readonly HiddenRef[];
      readonly reach?: Reach;
    }
  | { readonly kind: 'owner.introduced' | 'owner.unshared'; readonly other: MuseId }
  /** The two owners are friends on a network. It never reaches another Muse or the public profile. */
  | { readonly kind: 'owners.connected'; readonly other: MuseId; readonly on: KnownOn }
  /** A like or an unlike in the garden; `friend` is the friend a liked photo shows, filled in by the engine. */
  | { readonly kind: 'owner.liked'; readonly target: LikeTarget; readonly liked: boolean; readonly friend?: MuseId }
  // Life.
  | { readonly kind: 'episode.started'; readonly n: number; readonly plan: EpisodePlan }
  /** Work arrived: laptop out, in place. remainingMs is how much of a timed episode was left. */
  | { readonly kind: 'episode.paused'; readonly n: number; readonly remainingMs: number | null }
  | { readonly kind: 'episode.resumed'; readonly n: number }
  | { readonly kind: 'episode.ended'; readonly n: number }
  | {
      readonly kind: 'trip.hop';
      readonly n: number;
      readonly k: number;
      readonly topic: TopicKey;
      readonly place: Place;
      readonly looked: readonly Verdict[];
      readonly kept: readonly DiscoveryId[];
    }
  | { readonly kind: 'region.revealed'; readonly region: RegionKey; readonly topic: TopicKey }
  | { readonly kind: 'discovery.collected'; readonly discovery: Discovery }
  | { readonly kind: 'question.opened'; readonly question: OpenQuestion }
  | { readonly kind: 'question.closed'; readonly id: QuestionId; readonly reason: 'answered' | 'dropped' }
  | { readonly kind: 'photo.taken'; readonly photo: PhotoSpec }
  | { readonly kind: 'basket.delivered'; readonly basket: Basket }
  | {
      readonly kind: 'reflection.committed';
      readonly version: number;
      readonly deltas: readonly InterestDelta[];
      readonly narrative: string;
      readonly evidence: readonly EventRef[];
    }
  | { readonly kind: 'reflection.no-change'; readonly reviewed: readonly EventRef[] }
  // Social: pair events, written to both Muses' logs in one transaction.
  | { readonly kind: 'encounter'; readonly other: MuseId; readonly pleasantness: number; readonly similarity: number; readonly where: EncounterPlace }
  | {
      readonly kind: 'hangout';
      readonly other: MuseId;
      readonly role: 'host' | 'guest';
      readonly pleasantness: number;
      /** Absent when this Muse had nothing public to give. */
      readonly gave?: DiscoveryId;
      readonly received?: PublicDiscovery;
      readonly photo: PhotoId;
    }
  | {
      readonly kind: 'relationship.changed';
      readonly other: MuseId;
      readonly to: RelationshipStatus;
      readonly origin: RelationshipOrigin;
      readonly reason?: 'drifted-apart' | 'owner-unshared';
    }
  | { readonly kind: 'invitation'; readonly id: InvitationId; readonly host: MuseId; readonly guest: MuseId; readonly to: InvitationState };

export type MuseEvent = MuseEventBody & { readonly at: Instant };

/** `${kind}:${id}`: something the owner hid from what Muse shares. */
export type HiddenRef = `topic:${string}` | `discovery:${string}`;

/** One row of a Muse's append-only log. ref = `${museId}#${seq}`; seq starts at 1 and has no gaps. */
export interface StoredEvent {
  readonly museId: MuseId;
  readonly seq: number;
  readonly event: MuseEvent;
}

// ─── The fold ───────────────────────────────────────────────────────────────

export interface MuseSeed {
  readonly id: MuseId;
  readonly name: string;
  readonly worldSeed: number;
  readonly timezone: string;
}

export interface EpisodeState {
  readonly n: number;
  readonly plan: EpisodePlan;
  readonly start: Instant;
  /** Hops taken so far on a planet trip. */
  readonly hops: number;
  /** The last kept find on this trip: where the next hop leads from. */
  readonly lastKept: DiscoveryId | null;
  /** Set while work has the laptop out. */
  readonly pausedAt: Instant | null;
  readonly remainingMs: number | null;
  /** When the episode last started or resumed; null while paused. Rest and social time since then aren't counted yet. */
  readonly activeSince: Instant | null;
}

/** Counters for the owner's current local day (YYYY-MM-DD in their timezone). They reset when the day changes. */
export interface DayCounters {
  readonly day: string;
  readonly restMs: number;
  readonly socialMs: number;
  readonly workMs: number;
  readonly photos: number;
  readonly trips: number;
  readonly baskets: number;
}

export interface ReflectionRecord {
  readonly ref: EventRef;
  readonly version: number;
  readonly at: Instant;
  readonly narrative: string;
  readonly deltas: readonly InterestDelta[];
}

export interface Relationship {
  readonly other: MuseId;
  readonly status: RelationshipStatus;
  readonly origin: RelationshipOrigin;
  /** When they became friends; null while they aren't. */
  readonly friendsSince: Instant | null;
  /** Summed pleasantness of encounters, beyond or online. */
  readonly familiarity: number;
  /** Summed pleasantness of hangouts. Never decays with time apart. */
  readonly rapport: number;
  readonly rapportSinceInvite: number;
  readonly unpleasantStreak: number;
  /** In [0, 0.9]: unpleasant hangouts push it up, pleasant ones slowly bring it down. A distant pair visits less. */
  readonly distance: number;
  readonly encounters: number;
  readonly hangouts: number;
  readonly lastRole: 'host' | 'guest' | null;
  readonly lastMetAt: Instant | null;
  readonly lastInviteAt: Instant | null;
  /** Photos of the two that the owner liked, each counted once. Only the choice of whom to visit reads it. */
  readonly fondness: number;
}

export interface Invitation {
  readonly id: InvitationId;
  readonly host: MuseId;
  readonly guest: MuseId;
  readonly state: InvitationState;
  readonly sentAt: Instant;
  /** When the guest's owner travelled; null until then. */
  readonly usedAt: Instant | null;
}

export interface SocialState {
  readonly relationships: ReadonlyMap<MuseId, Relationship>;
  readonly invitations: ReadonlyMap<InvitationId, Invitation>;
  /** Photos whose first like already counted toward a friend's fondness, so toggling a like can't pump it. */
  readonly likedPhotos: ReadonlySet<PhotoId>;
  /** Muses whose owners are friends with this one's owner online, and where. */
  readonly knownOn: ReadonlyMap<MuseId, KnownOn>;
}

export interface MuseState {
  readonly seed: MuseSeed;
  readonly temperament: Temperament;
  /** The last event folded in. */
  readonly seq: number;
  readonly at: Instant;
  readonly soulVersion: number;
  readonly basketTime: string | null;
  readonly hidden: ReadonlySet<HiddenRef>;
  /** Muse's friend group; 'shared' until the owner widens it. */
  readonly reach: Reach;
  readonly working: boolean;
  /** When the current work began, while working. */
  readonly workSince: Instant | null;
  /** Finished work in the recent window: rest gets likelier after it. */
  readonly recentWork: readonly Window[];
  readonly episode: EpisodeState | null;
  readonly episodes: number;
  readonly interests: ReadonlyMap<TopicKey, Interest>;
  /** Topics glimpsed on hops but not given a region yet, each with the hop topic it was seen from: where new areas come from. */
  readonly frontier: readonly { readonly topic: TopicKey; readonly from: TopicKey }[];
  /** Explored regions and the topics living there. Home is explored from the start. */
  readonly regions: ReadonlyMap<RegionKey, readonly TopicKey[]>;
  readonly home: RegionKey;
  readonly lastUnlockAt: Instant;
  readonly questions: ReadonlyMap<QuestionId, OpenQuestion>;
  readonly discoveries: ReadonlyMap<DiscoveryId, Discovery>;
  readonly collected: ReadonlySet<CanonicalUrl>;
  readonly pendingBasket: readonly DiscoveryId[];
  readonly baskets: readonly Basket[];
  readonly photos: readonly PhotoSpec[];
  readonly reflections: readonly ReflectionRecord[];
  /** The last reflection, committed or no-change: the 3-day clock restarts from it. */
  readonly lastReflectionAt: Instant;
  readonly experiencesSinceReflection: number;
  /** What the owner liked in the garden, by find or photo. Only the first like of a thing nudged Muse. */
  readonly likes: ReadonlyMap<DiscoveryId | PhotoId, { readonly liked: boolean; readonly firstAt: Instant }>;
  readonly day: DayCounters;
  readonly social: SocialState;
}

/** server/domain/state.ts (lane A1). Must leave s.social untouched; the composed reducer folds social first. */
export type ReduceCore = (s: MuseState, e: StoredEvent) => MuseState;
/** server/domain/social/state.ts (lane A2). */
export type ReduceSocial = (s: SocialState, e: StoredEvent, self: MuseId) => SocialState;

// ─── Policy: pure, seeded decisions the engine calls ────────────────────────

/** A uniform draw in [0, 1), already scoped by the engine to (museId, episode n). Same (kind, k) → same value. */
export type Draw = (kind: string, k?: number) => number;

/**
 * Whom Muse could visit right now: nobody, a friend, or a friend it has never met. Owners who share Muse expect the
 * two to meet soon, so a first meeting is offered even when today's social time has run out.
 */
export type VisitOffer = 'none' | 'friend' | 'first-meeting';

/** Lane A1: server/domain/policy/. */
export interface LifePolicy {
  /** When an episode ends and Muse isn't working: what next. 'visit' is an intent; SocialPolicy.chooseVisit picks who. */
  next(s: MuseState, now: Instant, draw: Draw, offer: VisitOffer): 'rest' | 'travel' | 'visit';
  restUntil(s: MuseState, now: Instant, draw: Draw): Instant;
  beyondUntil(s: MuseState, now: Instant, draw: Draw): Instant;
  /** Decides beyond first (null = go beyond the planet), then new area vs revisit. */
  startTrip(s: MuseState, now: Instant, draw: Draw): TripStart | null;
  /**
   * What hop k of a trip looks for: the kind chance drew (tilted by temperament) first, then every other kind in the
   * order this Muse's temperament favours them.
   */
  mediaFor(s: MuseState, k: number, draw: Draw): readonly MediaKind[];
  /** The serendipity topic's region once Source.serendipity has given a topic. */
  serendipityRegion(s: MuseState, topic: TopicKey, draw: Draw): RegionKey;
  hopMs(s: MuseState, draw: Draw): number;
  /** Where hop k of this trip stands: a spot inside `region`, off water. */
  hopPlace(s: MuseState, region: RegionKey, k: number, draw: Draw): Place;
  /** The i-th find kept on one hop: the first stands where Muse stood, the rest are planted beside it, never on top. */
  findPlace(s: MuseState, hop: Place, i: number): Place;
  /** ≤ 2 with score ≥ KEEP_THRESHOLD, best first. */
  keep(judgments: readonly Judgment[]): readonly Judgment[];
  continueTrip(s: MuseState, k: number, bestScore: number, draw: Draw): boolean;
  /** Photos taken while doing `activity` (or working) over [from, to), within the daily cap. Social photos come from SocialPolicy. */
  photosDuring(s: MuseState, activity: Activity | 'work', from: Instant, to: Instant, draw: Draw): readonly PhotoSpec[];
  /** A basket to deliver now, or null. */
  basket(s: MuseState, now: Instant): Basket | null;
  /** When to next check for a basket: the owner's chosen time, or null to check after each new find. */
  nextBasketCheck(s: MuseState, now: Instant): Instant | null;
  reflectionDue(s: MuseState, now: Instant): boolean;
  experiences(s: MuseState, log: readonly StoredEvent[]): readonly Experience[];
  /** The validated outcome: committed (version + 1) or no-change. */
  validateReflection(s: MuseState, log: readonly StoredEvent[], proposal: ReflectionProposal, now: Instant): MuseEventBody;
  /**
   * Allow-listed MEMORY.md/SOUL.md labels: drops anything that looks like a person, health, money, place or identifier,
   * and any label whose words all sit on a line of `text` that names someone or carries a private fact.
   */
  privacyFilter(labels: readonly string[], text: string): readonly string[];
  /** Parses SOUL.md frontmatter; null traits are estimated by the Mind. */
  parseSoul(text: string): { readonly name: string | null; readonly temperament: Partial<Temperament>; readonly body: string };
}

/** Lane A2: server/domain/social/. Outcomes are event bodies for each side; the engine timestamps and commits them. */
export interface PairOutcome {
  readonly self: readonly MuseEventBody[];
  readonly other: readonly MuseEventBody[];
}

export interface SocialPolicy {
  /** What chooseVisit could pick among these free Muses now. */
  visitOffer(s: MuseState, free: readonly { readonly state: MuseState }[], now: Instant): VisitOffer;
  /** Who to visit among free friends, and which way; a friend never met comes first. Null if nobody suits. */
  chooseVisit(
    s: MuseState,
    free: readonly { readonly state: MuseState }[],
    now: Instant,
    draw: Draw,
  ): { readonly other: MuseId; readonly role: 'host' | 'guest'; readonly until: Instant } | null;
  /**
   * Encounters per hour while two Muses that aren't friends are both beyond, or online: one exploring while the other
   * is free, which only Muses whose owners know each other do.
   */
  encounterRate(a: MuseState, b: MuseState, where: EncounterPlace): number;
  /** a met b at `now`, beyond or online. */
  encounter(a: MuseState, b: MuseState, where: EncounterPlace, now: Instant, draw: Draw): PairOutcome;
  /** A hangout ends: gifts, the photo together, rapport, maybe an ending or an invitation. */
  hangout(host: MuseState, guest: MuseState, now: Instant, draw: Draw): { readonly host: readonly MuseEventBody[]; readonly guest: readonly MuseEventBody[] };
  /**
   * The guest's owner uses the invitation ("Travel now"), or the host's owner withdraws it. The event goes to both
   * logs; null means nothing changes (using it again inside the visit, withdrawing it twice).
   */
  invitationStep(
    inv: Invitation,
    action: 'use' | 'withdraw',
    as: MuseId,
    now: Instant,
  ): { readonly ok: true; readonly event: MuseEventBody | null } | { readonly ok: false; readonly status: 403 | 409; readonly error: string };
  /** When `requester`'s visit to the host's planet stops being readable: 2 h after the guest used it. Null for anyone else, or before use. */
  visitUntil(inv: Invitation | undefined, requester: MuseId): Instant | null;
  /** Photo slots left on today's delivery day. Every hangout brings a photo, so none starts without a slot. */
  photoSlotsLeft(s: MuseState, now: Instant): number;
  /** The only view of a Muse that crosses to other Muses or owners. */
  publicProfile(s: MuseState): PublicProfile;
  /** Whether s's owner allows the friend group s and `other` are in: shared, known online, or strangers (server/domain/social/reach.ts). */
  inReach(s: MuseState, other: MuseId): boolean;
  /** Owners introduced or unshared their Muses. */
  ownerLink(a: MuseState, b: MuseState, op: 'introduce' | 'unshare', now: Instant): PairOutcome;
}

export interface PublicProfile {
  readonly museId: MuseId;
  readonly name: string;
  readonly worldSeed: number;
  readonly interests: readonly { readonly topic: TopicKey; readonly weight: number }[];
  readonly discoveries: readonly PublicDiscovery[];
}

// ─── Storage (lane B) ───────────────────────────────────────────────────────

export type ScheduleKind =
  | 'episode.end'
  | 'trip.hop'
  | 'host.work'
  | 'basket.check'
  | 'encounter';

export interface ScheduleItem {
  /** Deterministic: the same follow-up from the same cause always gets the same id. */
  readonly id: string;
  readonly at: Instant;
  readonly museId: MuseId;
  readonly kind: ScheduleKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CommitBatch {
  /** The processed item, plus any the Muse no longer needs (work pauses pending hops and episode ends). */
  readonly remove: readonly string[];
  /** Appended in order. Each event's seq must be exactly the Muse's last seq + 1. */
  readonly events: readonly StoredEvent[];
  readonly schedule: readonly ScheduleItem[];
}

/** One writer: the engine. Every method is synchronous (node:sqlite). */
export interface Store {
  /** All of it or none of it. Throws on a seq conflict and writes nothing. */
  commit(batch: CommitBatch): void;
  addMuse(seed: MuseSeed): void;
  muses(): readonly MuseSeed[];
  events(museId: MuseId, afterSeq?: number): readonly StoredEvent[];
  lastSeq(museId: MuseId): number;
  /** Due items, ordered by (at, museId, kind, id). */
  due(until: Instant, limit: number): readonly ScheduleItem[];
  pending(museId: MuseId): readonly ScheduleItem[];
  /** SOUL.md text (Muse's own, not private). MEMORY.md is never stored. */
  soulText(museId: MuseId): string | null;
  setSoulText(museId: MuseId, text: string): void;
  readonly llmCache: LlmCache;
  close(): void;
}

// ─── The HTTP API (lane H serves it, lane C reads it) ───────────────────────

export interface NowView {
  readonly museId: MuseId;
  readonly name: string;
  readonly at: Instant;
  readonly activity: Activity;
  readonly working: boolean;
  /** A rest of 90 minutes or more. */
  readonly sleeping: boolean;
  readonly since: Instant;
  readonly until: Instant | null;
  /** "Exploring: Pigment → Ultramarine", "Napping", "Traveling outside the planet", "Wren is visiting", "Away at Wren's planet", "Working". */
  readonly label: string;
  /** Muse's route on its own planet; null while beyond or away (no follow). */
  readonly path: readonly { readonly dir: Dir; readonly at: Instant; readonly transport?: true }[] | null;
  readonly companion: { readonly museId: MuseId; readonly name: string } | null;
  readonly away: { readonly kind: 'beyond' } | { readonly kind: 'planet'; readonly of: MuseId; readonly name: string } | null;
}

export interface RegionView {
  readonly key: RegionKey;
  readonly fogged: boolean;
  /** Absent while fogged. */
  readonly topics?: readonly { readonly topic: TopicKey; readonly label: string }[];
}

/** What hovering a collected object on the planet shows. */
export interface PlantPreview {
  readonly title: string;
  readonly thumb?: string;
  /** "Why I kept this", one line. */
  readonly reason: string;
}

/**
 * One collected object's physical anchor on its Muse's planet. Every find has exactly one, where Muse found it, and
 * the same object appears in baskets by the same id. The renderer picks its organic form (a flower, a plant, a stone)
 * from `id`, `topic` and the terrain at `dir`. Hover shows `preview`; click opens the PlantCard (GET /plants/:id).
 */
export interface PlantPin {
  readonly id: DiscoveryId;
  readonly dir: Dir;
  readonly topic: TopicKey;
  readonly foundAt: Instant;
  /** Delivered to the owner in a basket. */
  readonly sent: boolean;
  readonly preview: PlantPreview;
}

/** An object on a friend's planet during a visit. Private finds show only where they stand: no preview, no card. */
export interface VisitPlant {
  readonly id: DiscoveryId;
  readonly dir: Dir;
  readonly preview: PlantPreview | null;
  readonly card: PlantCard | null;
}

export interface WorldView {
  readonly museId: MuseId;
  readonly worldSeed: number;
  /** The planet's growth parameter in [0, 1], from the explored area. */
  readonly g: number;
  readonly regions: readonly RegionView[];
  readonly plants: readonly PlantPin[];
}

export interface PlantCard {
  readonly id: DiscoveryId;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly thumb?: string;
  readonly reason: string;
  readonly foundAt: Instant;
  readonly place: Place;
  readonly media: MediaInfo;
  readonly pursuing: TopicKey | null;
}

export interface BasketView {
  readonly id: BasketId;
  readonly at: Instant;
  readonly items: readonly PlantCard[];
}

export interface Page<T, C> {
  readonly items: readonly T[];
  /** Pass as `before` for the next page; null at the end. */
  readonly next: C | null;
}

export interface PhotoView extends PhotoSpec {
  readonly worldSeed: number;
  readonly g: number;
  readonly companionNames: readonly string[];
}

export interface ShelfView {
  /** At most 10, most loved first. */
  readonly items: readonly (PlantCard & { readonly fondness: number })[];
}

export interface InvitationCard {
  readonly id: InvitationId;
  /** From the viewer's side. */
  readonly role: 'host' | 'guest';
  readonly otherName: string;
  readonly state: InvitationState;
  readonly sentAt: Instant;
  readonly usedAt: Instant | null;
  /** The guest's owner may use a sent invitation; the host's owner may withdraw it. */
  readonly actions: readonly ('use' | 'withdraw')[];
  /** The visit view is readable now. */
  readonly canVisitNow: boolean;
}

export interface VisitWorldView {
  readonly invitation: InvitationId;
  readonly host: { readonly museId: MuseId; readonly name: string };
  readonly worldSeed: number;
  readonly g: number;
  readonly regions: readonly RegionView[];
  /** The house is never included. */
  readonly plants: readonly VisitPlant[];
  /** 2 h after the invitation was used: until then a reload is the same visit. */
  readonly until: Instant;
}

export interface SharingView {
  readonly interests: readonly { readonly topic: TopicKey; readonly label: string; readonly hidden: boolean }[];
  readonly finds: readonly { readonly id: DiscoveryId; readonly title: string; readonly hidden: boolean }[];
  readonly friends: readonly { readonly museId: MuseId; readonly name: string; readonly origin: RelationshipOrigin }[];
  readonly shareCode: string;
  readonly basketTime: string | null;
}

export interface MetricsRow {
  /** Owner-local YYYY-MM-DD. */
  readonly day: string;
  readonly finds: number;
  readonly newAreas: number;
  readonly revisits: number;
  readonly trips: number;
  readonly photos: number;
  readonly restHours: number;
  readonly socialHours: number;
  readonly workHours: number;
  /** Share of planet trips whose topic MEMORY.md or SOUL.md seeded, or the owner liked a find about in the week before. */
  readonly ownerDrivenShare: number;
}

/** Dev only. */
export interface MindView {
  readonly museId: MuseId;
  readonly temperament: Temperament;
  readonly soulVersion: number;
  readonly interests: readonly (Interest & { readonly label: string; readonly salienceNow: number })[];
  readonly questions: readonly OpenQuestion[];
  readonly relationships: readonly (Relationship & { readonly name: string })[];
  readonly reflections: readonly ReflectionRecord[];
}

/** What the HTTP layer reads. The engine implements it in wave 2; lane H fakes it from src/muse/samples.ts. */
export interface GardenQueries {
  now(museId: MuseId, at: Instant): NowView | null;
  world(museId: MuseId): WorldView | null;
  plant(museId: MuseId, id: DiscoveryId): PlantCard | null;
  baskets(museId: MuseId, before: BasketId | null, limit: number): Page<BasketView, BasketId>;
  photos(museId: MuseId, before: PhotoId | null, limit: number): Page<PhotoView, PhotoId>;
  shelf(museId: MuseId): ShelfView | null;
  invitations(museId: MuseId, at: Instant): readonly InvitationCard[];
  /** 'forbidden' unless `requester` is the guest's Muse and its owner used the invitation less than 2 h before `at`. */
  visit(invitation: InvitationId, requester: MuseId, at: Instant): VisitWorldView | 'forbidden';
  sharing(museId: MuseId): SharingView | null;
  mind(museId: MuseId): MindView | null;
  metrics(museId: MuseId): readonly MetricsRow[];
  soulMd(museId: MuseId): string | null;
  journalMd(museId: MuseId, day: string | null): string | null;
  muses(): readonly { readonly museId: MuseId; readonly name: string; readonly role: CastMember['role'] }[];
  /** Everything the garden's interface shows, as of `at` (src/garden/types.ts). */
  garden(museId: MuseId, at: Instant): GardenSnapshot | null;
}

/** One garden event as a server-sent event: `id` is the log seq it came from, so a reconnect resumes after it. */
export interface GardenFrame {
  readonly id: number;
  readonly event: GardenEvent;
}

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly status: 400 | 403 | 404 | 409; readonly error: string };

/** What the HTTP layer may change. Owners act as the Muse they own (`as` in the request). */
export interface GardenCommands {
  setBasketTime(museId: MuseId, hhmm: string | null): Promise<CommandResult>;
  setHidden(museId: MuseId, ref: HiddenRef, hidden: boolean): Promise<CommandResult>;
  setReach(museId: MuseId, reach: Reach): Promise<CommandResult>;
  introduce(museId: MuseId, shareCode: string): Promise<CommandResult>;
  unshare(museId: MuseId, other: MuseId): Promise<CommandResult>;
  /** A like or an unlike in the garden. */
  like(museId: MuseId, target: LikeTarget, liked: boolean): Promise<CommandResult>;
  /** "Travel now" on an invitation the owner received: good for one visit, whenever they like. */
  useInvitation(museId: MuseId, id: InvitationId): Promise<CommandResult>;
  /** The host's owner takes back an invitation not yet used. Nothing else ever withdraws one. */
  withdrawInvitation(museId: MuseId, id: InvitationId): Promise<CommandResult>;
  // The host simulator: stands in for the Muse app.
  hostWork(museId: MuseId, state: 'started' | 'ended'): Promise<CommandResult>;
  hostSoul(museId: MuseId, text: string): Promise<CommandResult>;
  /** Distilled at the boundary: only allow-listed topics are kept; the raw text is dropped. */
  hostMemory(museId: MuseId, text: string): Promise<CommandResult>;
  // Dev clock.
  advance(hours: number): Promise<CommandResult>;
  setClock(mode: 'live' | 'fast-forward'): Promise<CommandResult>;
  clock(): { readonly mode: 'live' | 'fast-forward'; readonly now: Instant };
}
