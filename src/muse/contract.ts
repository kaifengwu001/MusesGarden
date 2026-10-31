// The shared contract for the Muse agent. The server (server/) and the overlay
// (src/muse/ui/) both import it. Types only: this file emits no runtime code.
// Plan and rationale: docs/muse-agent-plan.md.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MuseId = Brand<string, 'MuseId'>;
export type DiscoveryId = Brand<string, 'DiscoveryId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type BasketId = Brand<string, 'BasketId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type InvitationId = Brand<string, 'InvitationId'>;
/** A cell of the cube-sphere grid: `${face}:${i}:${j}`, face 0–5, i and j in [0, REGION_GRID). */
export type RegionKey = Brand<string, 'RegionKey'>;
/** A canonical English Wikipedia title after redirects, e.g. "Ultramarine". */
export type TopicKey = Brand<string, 'TopicKey'>;
/** https, lowercase host, no query tracking params, no fragment. Wikipedia: https://en.wikipedia.org/wiki/<Title_With_Underscores>. */
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

/** One page Muse looked at. A Discovery can only be made from a Candidate, so every find has a real URL. */
export interface Candidate {
  readonly origin: 'wikipedia' | 'rss';
  readonly url: string;
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  /** Plain text, at most 400 characters. */
  readonly summary: string;
  readonly thumb?: string;
  /** topics[0] is the page's own topic; the rest are its non-hidden categories (at most 6). */
  readonly topics: readonly TopicKey[];
}

/** Where pages come from. Implementations: live Wikipedia, live RSS, and a recorded offline corpus. */
export interface Source {
  /** The first hop of a trip: pages about `topic`, best first. */
  search(topic: TopicKey, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** Later hops: pages one link away from `from` (outgoing links, then "more like this"). */
  next(from: Candidate, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** A wide pool unrelated to Muse's interests, for serendipity. Deterministic for a given seed offline. */
  serendipity(limit: number, seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]>;
  /** A free-text label to its canonical topic (Wikipedia redirects resolved), or null if there is no such page. */
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
}

export interface CastMember {
  readonly id: MuseId;
  readonly name: string;
  readonly worldSeed: number;
  /** IANA zone of the owner, e.g. "America/Los_Angeles". */
  readonly timezone: string;
  /** Relative to server/fixtures/. */
  readonly dir: string;
  readonly role: 'hero' | 'friend' | 'stranger';
}

/** server/fixtures/work-*.json: when each Muse is busy with its owner's tasks. ISO 8601 with offset. */
export type WorkSchedule = Readonly<Record<string, readonly { readonly start: string; readonly end: string }[]>>;
