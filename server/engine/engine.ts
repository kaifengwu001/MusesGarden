import { createHash } from 'node:crypto';
import type {
  Actor,
  AgentResult,
  Candidate,
  CanonicalUrl,
  CommandResult,
  Discovery,
  DiscoveryId,
  Draw,
  EncounterPlace,
  EpisodePlan,
  Instant,
  Interest,
  Invitation,
  InvitationId,
  Judgment,
  KnownOn,
  LifePolicy,
  LikeTarget,
  Mind,
  MindContext,
  MuseEventBody,
  MuseId,
  MuseLook,
  MuseSeed,
  MuseState,
  PhotoId,
  PhotoSpec,
  PlanetId,
  PostcardAsk,
  PostcardBack,
  PostcardPlan,
  QuestionId,
  ReduceCore,
  ReduceSocial,
  RelationshipOrigin,
  ReportedStop,
  ScheduleItem,
  SocialPolicy,
  Source,
  Store,
  StoredEvent,
  Temperament,
  TopicKey,
  Verdict,
} from '../../src/muse/contract';
import { composedBasket, REPORTED_HOP_MS, reportedTrip, reportedTripStart, waitingBasket, type Refusal } from '../domain/agent';
import { gameOutcome } from '../domain/policy/postcard';
import { localDay } from '../domain/time';
import { Tx, type Fold } from './tx';

export interface EngineDeps {
  readonly store: Store;
  readonly life: LifePolicy;
  readonly social: SocialPolicy;
  readonly reduceCore: ReduceCore;
  readonly reduceSocial: ReduceSocial;
  readonly emptyState: (seed: MuseSeed) => MuseState;
  readonly drawFor: (museId: MuseId, n: number) => Draw;
  readonly salienceAt: (interest: Interest, now: Instant) => number;
  readonly source: Source;
  readonly mindFor: (museId: MuseId) => Mind;
  /** The mind the rules see in a real Muse (agent.joined): it decides nothing (server/adapters/minds/agent.ts). */
  readonly agentMind?: Mind;
}

/** What a real Muse's command checks against its state as committed, inside the queue; the log is read only if asked. */
export type AgentCheck = (s: MuseState, log: () => readonly StoredEvent[]) => Refusal | null;

const CANDIDATES_PER_HOP = 8;
const MAX_HOPS = 4;
const HOUR = 3_600_000;

interface HopPayload {
  readonly n: number;
  readonly k: number;
  readonly since: number;
  readonly from: Candidate | null;
  /** The trip's topic once a serendipity trip has found one. */
  readonly pursuing?: TopicKey;
  /** A trip a real Muse reported: the stop this hop plants, and how many stops the trip has. */
  readonly stop?: ReportedStop;
  readonly of?: number;
}

/** An encounter holds only while both Muses are still in the episodes it was drawn in. */
interface EncounterPayload {
  readonly other: MuseId;
  readonly where: EncounterPlace;
  readonly n: number;
  readonly otherN: number;
}

/**
 * Where two Muses can meet. Beyond: both out there. Online: Muse explores while the other is free, and a free Muse is
 * exploring too, since resting, working, hosting and being away all keep it busy.
 */
const CAN_MEET: Readonly<Record<EncounterPlace, (s: MuseState) => boolean>> = {
  beyond: (s) => s.episode?.plan.activity === 'beyond' && s.episode.pausedAt === null,
  online: (s) => !s.working && s.episode?.plan.activity === 'travel' && s.episode.pausedAt === null,
};
/** Draw kinds and schedule ids per place; beyond keeps the names it always had, so earlier runs replay the same. */
const ENCOUNTER_KEY: Readonly<Record<EncounterPlace, { readonly draw: string; readonly id: string }>> = {
  beyond: { draw: 'encounter', id: 'enc' },
  online: { draw: 'online', id: 'online' },
};

/**
 * The one clock for every Muse: a discrete-event simulation over the store's persisted schedule. Each due item is
 * processed into a Tx (async Mind and Source calls happen first, in memory) and committed atomically, so a crash at
 * any point leaves the old state or the new one and a rerun converges. Items are taken one at a time in
 * (at, museId, kind, id) order because processing one can add or remove others.
 */
export class Engine {
  private readonly states = new Map<MuseId, MuseState>();
  private readonly fold: Fold;
  private clockAt: Instant;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(events: readonly StoredEvent[]) => void>();

  constructor(
    private readonly deps: EngineDeps,
    start: Instant,
  ) {
    this.fold = (s, e) => deps.reduceCore({ ...s, social: deps.reduceSocial(s.social, e, s.seed.id) }, e);
    this.clockAt = start;
    for (const seed of deps.store.muses()) this.states.set(seed.id, this.replay(seed));
    // A saved garden resumes where it left off: its clock never starts behind what its Muses have lived.
    for (const s of this.states.values()) if (s.seq > 0 && s.at > this.clockAt) this.clockAt = s.at;
  }

  now(): Instant {
    return this.clockAt;
  }

  museIds(): readonly MuseId[] {
    return [...this.states.keys()];
  }

  state(id: MuseId): MuseState | undefined {
    return this.states.get(id);
  }

  log(id: MuseId): readonly StoredEvent[] {
    return this.deps.store.events(id);
  }

  /** SOUL.md as the Muse app last sent it. */
  soulText(id: MuseId): string | null {
    return this.deps.store.soulText(id);
  }

  /** Called after each commit with every event it stored (all Muses'), once the clock has moved; returns the way to stop. */
  subscribe(listener: (events: readonly StoredEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Serializes everything that writes, so commands never interleave with the clock. */
  exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  advanceTo(t: Instant): Promise<number> {
    return this.exclusive(async () => {
      let processed = 0;
      for (;;) {
        const [item] = this.deps.store.due(t, 1);
        if (!item) break;
        await this.process(item);
        processed++;
      }
      if (t > this.clockAt) this.clockAt = t;
      return processed;
    });
  }

  // ─── Inputs from the Muse app, owners and fixtures ──────────────────────

  /** Adds a Muse and schedules its first episode at `at`; every Muse starts from the schedule, in a fixed order. */
  addMuse(seed: MuseSeed, soulText: string, memoryText: string, at: Instant): Promise<void> {
    return this.exclusive(async () => {
      if (!this.states.has(seed.id)) {
        this.deps.store.addMuse(seed);
        this.states.set(seed.id, this.deps.emptyState(seed));
      }
      const tx = this.tx(at);
      await this.applySoul(tx, seed.id, soulText);
      await this.applyMemory(tx, seed.id, memoryText);
      this.scheduleBasketCheck(tx, seed.id);
      this.scheduleEnd(tx, seed.id, 0, at);
      this.commit(tx);
    });
  }

  introduce(a: MuseId, b: MuseId, at: Instant): Promise<void> {
    return this.exclusive(() => {
      const tx = this.tx(at);
      const out = this.deps.social.ownerLink(tx.state(a), tx.state(b), 'introduce', at);
      tx.emitAll(a, out.self);
      tx.emitAll(b, out.other);
      this.commit(tx);
    });
  }

  /** Owners who are friends on Instagram or Facebook. Recorded once, in both logs, and never in a public profile. */
  connectOwners(a: MuseId, b: MuseId, on: KnownOn, at: Instant): Promise<void> {
    return this.exclusive(() => {
      const tx = this.tx(at);
      if (tx.state(a).social.knownOn.has(b)) return;
      tx.emit(a, { kind: 'owners.connected', other: b, on });
      tx.emit(b, { kind: 'owners.connected', other: a, on });
      this.commit(tx);
    });
  }

  unshare(a: MuseId, b: MuseId): Promise<void> {
    return this.exclusive(() => {
      const tx = this.tx(this.clockAt);
      const out = this.deps.social.ownerLink(tx.state(a), tx.state(b), 'unshare', this.clockAt);
      tx.emitAll(a, out.self);
      tx.emitAll(b, out.other);
      this.commit(tx);
    });
  }

  /** A work block from a fixture schedule, or from the Muse app ahead of time. */
  scheduleWork(museId: MuseId, start: Instant, end: Instant): void {
    const item = (at: Instant, state: 'started' | 'ended'): ScheduleItem => ({
      id: `work:${museId}:${at}:${state}`,
      at,
      museId,
      kind: 'host.work',
      payload: { state },
    });
    this.deps.store.commit({ remove: [], events: [], schedule: [item(start, 'started'), item(end, 'ended')] });
  }

  hostWork(museId: MuseId, state: 'started' | 'ended'): Promise<void> {
    return this.exclusive(async () => {
      const tx = this.tx(this.clockAt);
      await this.onWork(tx, museId, state);
      await this.writeBacks(tx);
      this.commit(tx);
    });
  }

  hostSoul(museId: MuseId, text: string): Promise<void> {
    return this.exclusive(async () => {
      const tx = this.tx(this.clockAt);
      await this.applySoul(tx, museId, text);
      this.commit(tx);
    });
  }

  hostMemory(museId: MuseId, text: string): Promise<void> {
    return this.exclusive(async () => {
      const tx = this.tx(this.clockAt);
      await this.applyMemory(tx, museId, text);
      this.commit(tx);
    });
  }

  ownerSettings(museId: MuseId, body: Extract<MuseEventBody, { kind: 'owner.settings' }>): Promise<void> {
    return this.exclusive(() => {
      const tx = this.tx(this.clockAt);
      tx.emit(museId, body);
      if (body.basketTime !== undefined) this.scheduleBasketCheck(tx, museId);
      this.commit(tx);
    });
  }

  /**
   * A like or an unlike in the garden. False when Muse has no such find or photo. A photo that shows a friend
   * names the friend in the event. Liking what is already liked, or unliking what isn't, records nothing.
   */
  like(museId: MuseId, target: LikeTarget, liked: boolean): Promise<boolean> {
    return this.exclusive(() => {
      const s = this.must(museId);
      const photo = 'photo' in target ? s.photos.find((p) => p.id === target.photo) : undefined;
      if ('find' in target ? !s.discoveries.has(target.find) : !photo) return false;
      if ((s.likes.get('find' in target ? target.find : target.photo)?.liked ?? false) === liked) return true;
      const friend = photo?.companions.at(0);
      const tx = this.tx(this.clockAt);
      tx.emit(museId, { kind: 'owner.liked', target, liked, ...(friend ? { friend } : {}) });
      this.commit(tx);
      return true;
    });
  }

  /** A postcard starred or unstarred in the garden. False when Muse took no such photo. Starring what is starred records nothing. */
  favorite(museId: MuseId, photo: PhotoId, favorite: boolean): Promise<boolean> {
    return this.exclusive(() => {
      const s = this.must(museId);
      if (!s.photos.some((p) => p.id === photo)) return false;
      if (s.favoritePhotos.has(photo) === favorite) return true;
      const tx = this.tx(this.clockAt);
      tx.emit(museId, { kind: 'owner.favorited', photo, favorite });
      this.commit(tx);
      return true;
    });
  }

  /**
   * The guest's owner uses an invitation, which takes them and their Muse to the host's planet, or comes home from it
   * early; or the host's owner withdraws it. `as` is the Muse whose owner acts.
   */
  invitationAction(id: InvitationId, as: MuseId, action: 'use' | 'withdraw' | 'return'): Promise<CommandResult> {
    return this.exclusive(async (): Promise<CommandResult> => {
      const inv = this.invitation(id);
      if (!inv) return { ok: false, status: 404, error: 'no such invitation' };
      const r = this.deps.social.invitationStep(inv, action, as, this.clockAt);
      if (!r.ok) return r;
      if (r.event) {
        const tx = this.tx(this.clockAt);
        tx.emit(inv.host, r.event);
        tx.emit(inv.guest, r.event);
        if (action === 'use') await this.board(tx, id, inv.guest);
        if (action === 'return') await this.endTrip(tx, id, inv.guest);
        await this.writeBacks(tx);
        this.commit(tx);
      }
      return { ok: true };
    });
  }

  invitation(id: InvitationId): Invitation | undefined {
    for (const s of this.states.values()) {
      const inv = s.social.invitations.get(id);
      if (inv) return inv;
    }
    return undefined;
  }

  // ─── A real Muse, through its connector (server/engine/agent.ts checks what it sends) ───

  /** The mind the rules consult for `s`: a real Muse's decides nothing. */
  private mind(s: MuseState): Mind {
    return s.agent && this.deps.agentMind ? this.deps.agentMind : this.deps.mindFor(s.seed.id);
  }

  /** The seeded draw of `m`'s episode `n`, the one the policy's decisions in it use. */
  draw(m: MuseId, n: number): Draw {
    return this.deps.drawFor(m, n);
  }

  /** What a topic label resolves to in the topic map, or null. Read-only, outside the queue. */
  resolveTopic(label: string): Promise<TopicKey | null> {
    return this.deps.source.resolveTopic(label);
  }

  /**
   * Makes `seed.id` a real Muse from now on (agent.joined, its owner's act), adding it first when the garden doesn't
   * have it: a Muse with `soulText`, wearing `made.look` on `made.planet`, its first episode due at once (a new one
   * needs `made`). A Muse that is a real one already is left as it is.
   */
  addAgent(seed: MuseSeed, made: { readonly look: MuseLook; readonly planet: PlanetId; readonly planetName: string } | null, soulText: string): Promise<{ readonly added: boolean }> {
    return this.exclusive(async () => {
      const known = this.states.get(seed.id);
      if (known?.agent) return { added: false };
      if (!known && !made) throw new Error(`a new real Muse needs its look and planet (${seed.id})`);
      if (!known) {
        this.deps.store.addMuse(seed);
        this.states.set(seed.id, this.deps.emptyState(seed));
      }
      const at = this.clockAt;
      const tx = this.tx(at);
      tx.emit(seed.id, { kind: 'agent.joined', name: tx.state(seed.id).seed.name }, 'owner');
      if (!known && made) {
        tx.emit(seed.id, { kind: 'look.changed', look: made.look }, 'garden');
        tx.emit(seed.id, { kind: 'planet.changed', planet: made.planet, worldSeed: seed.worldSeed, name: made.planetName }, 'garden');
        await this.applySoul(tx, seed.id, soulText, 'garden');
        this.scheduleBasketCheck(tx, seed.id);
        this.scheduleEnd(tx, seed.id, 0, at);
      }
      this.commit(tx);
      return { added: !known };
    });
  }

  /** A real Muse's soul: its SOUL.md text, and the topics it picked out, folded in as Memory's are (memory.updated). */
  agentSoul(m: MuseId, soulText: string, topics: readonly TopicKey[], labelsHash: string, check: AgentCheck): Promise<AgentResult<{ readonly at: Instant }>> {
    return this.agentWrite(m, check, async (tx) => {
      await this.applySoul(tx, m, soulText, 'muse');
      tx.emit(m, { kind: 'memory.updated', textHash: labelsHash, topics }, 'muse');
    });
  }

  /**
   * A trip Muse made in its own browser, its links already checked: it sets off now on its own planet, back to where
   * its first find's topic lives or to a new area, and each stop's finds are planted a hop apart (REPORTED_HOP_MS). The
   * rules' episode it was in ends. While its owner works the trip waits, paused, as any trip would.
   */
  reportTrip(
    m: MuseId,
    trip: { readonly thread: string; readonly path: readonly string[]; readonly stops: readonly ReportedStop[]; readonly question: string | null },
    check: AgentCheck,
  ): Promise<AgentResult<{ readonly trip: number; readonly doneAt: Instant }>> {
    return this.exclusive((): AgentResult<{ readonly trip: number; readonly doneAt: Instant }> => {
      const s0 = this.states.get(m);
      if (!s0) return { ok: false, status: 404, error: 'no such Muse' };
      const refused = check(s0, () => this.deps.store.events(m));
      if (refused) return refused;
      const first = trip.stops[0]?.kept[0]?.candidate;
      if (!first) return { ok: false, status: 422, error: 'nothing kept could be planted' };
      const tx = this.tx(this.clockAt);
      this.endEpisode(tx, m);
      const s = tx.state(m);
      const n = s.episodes + 1;
      const draw = this.deps.drawFor(m, n);
      const start = reportedTripStart(s, first, draw);
      tx.emit(m, { kind: 'trip.reported', n, thread: trip.thread, path: trip.path, stops: trip.stops, question: trip.question }, 'muse');
      tx.emit(m, { kind: 'episode.started', n, plan: { activity: 'travel', trip: start } }, 'muse');
      if (trip.question) {
        tx.emit(m, { kind: 'question.opened', question: { id: `q:${m}:${n}` as QuestionId, topic: start.topic, text: trip.question, openedAt: tx.now } }, 'muse');
      }
      if (tx.state(m).working) tx.emit(m, { kind: 'episode.paused', n, remainingMs: REPORTED_HOP_MS });
      else {
        this.scheduleStops(tx, m, n, trip.stops, 0, tx.now + REPORTED_HOP_MS);
        this.scheduleEncounters(tx, m, 'online', draw);
      }
      this.commit(tx);
      return { ok: true, value: { trip: n, doneAt: (tx.now + trip.stops.length * REPORTED_HOP_MS) as Instant } };
    });
  }

  /** The back Muse wrote for one of its photos, in its own words. */
  writeBack(m: MuseId, photo: PhotoId, back: PostcardBack, check: AgentCheck): Promise<AgentResult<{ readonly at: Instant }>> {
    return this.agentWrite(m, check, (tx) => {
      tx.emit(m, { kind: 'photo.written', photo, back }, 'muse');
    });
  }

  /** The basket Muse chose for its owner: it goes out at the owner's basket time, or at once without one. */
  composeBasket(m: MuseId, finds: readonly DiscoveryId[], note: string, check: AgentCheck): Promise<AgentResult<{ readonly at: Instant }>> {
    return this.agentWrite(m, check, (tx) => {
      tx.emit(m, { kind: 'basket.composed', finds, note }, 'muse');
      if (tx.state(m).basketTime === null) this.deliverBasket(tx, m);
    });
  }

  /** One event for a real Muse, as `by` (a checkout, or the workshop carrying out what Muse approved). */
  agentEvent(m: MuseId, body: MuseEventBody, by: Actor, check: AgentCheck): Promise<AgentResult<{ readonly at: Instant }>> {
    return this.agentWrite(m, check, (tx) => {
      tx.emit(m, body, by);
    });
  }

  /** One commit for a real Muse, at the clock's now, once `check` passes against its state inside the queue. */
  private agentWrite(m: MuseId, check: AgentCheck, write: (tx: Tx) => void | Promise<void>): Promise<AgentResult<{ readonly at: Instant }>> {
    return this.exclusive(async (): Promise<AgentResult<{ readonly at: Instant }>> => {
      const s = this.states.get(m);
      if (!s) return { ok: false, status: 404, error: 'no such Muse' };
      const refused = check(s, () => this.deps.store.events(m));
      if (refused) return refused;
      const tx = this.tx(this.clockAt);
      await write(tx);
      this.commit(tx);
      return { ok: true, value: { at: tx.now } };
    });
  }

  /** The log as `tx` sees it: the store's, then what the tx has emitted for `m` so far. */
  private logOf(tx: Tx, m: MuseId): readonly StoredEvent[] {
    const mine = tx.emitted().filter((e) => e.museId === m);
    const stored = this.deps.store.events(m);
    return mine.length === 0 ? stored : [...stored, ...mine];
  }

  /** Stops `from` on of a reported trip, the first at `first` and the rest a hop apart. */
  private scheduleStops(tx: Tx, m: MuseId, n: number, stops: readonly ReportedStop[], from: number, first: number): void {
    for (let k = from; k < stops.length; k++) {
      const at = first + (k - from) * REPORTED_HOP_MS;
      this.scheduleHop(tx, m, { n, k, since: k === from ? tx.now : at - REPORTED_HOP_MS, from: null, stop: stops[k], of: stops.length }, at);
    }
  }

  /** A stop of a reported trip: its finds planted, the photos of the walk there, and home after the last. */
  private async onReportedHop(tx: Tx, m: MuseId, p: HopPayload, stop: ReportedStop): Promise<void> {
    const planted = this.plantStop(tx, m, p.n, p.k, stop);
    this.emitPhotos(tx, m, this.deps.life.photosDuring(tx.state(m), 'travel', p.since as Instant, tx.now, this.deps.drawFor(m, p.n)));
    if (planted > 0 && tx.state(m).basketTime === null) this.deliverBasket(tx, m);
    if (p.k + 1 >= (p.of ?? 0)) {
      tx.emit(m, { kind: 'episode.ended', n: p.n });
      await this.startNext(tx, m);
    }
  }

  /**
   * Stop `k` of the reported trip of episode `n`: the hop, where Muse stood in the trip's region (its fog lifting at
   * the first), and each find it kept there that it doesn't keep already, with its why, as a find of its own.
   * Returns how many it planted.
   */
  private plantStop(tx: Tx, m: MuseId, n: number, k: number, stop: ReportedStop): number {
    const s = tx.state(m);
    const ep = s.episode;
    if (!ep || ep.n !== n || ep.plan.activity !== 'travel' || ep.plan.trip.kind === 'serendipity') return 0;
    const trip = ep.plan.trip;
    const seen = new Set<CanonicalUrl>();
    const fresh = stop.kept.filter(({ candidate: c }) => {
      const known = s.collected.has(c.canonicalUrl) || seen.has(c.canonicalUrl);
      seen.add(c.canonicalUrl);
      return !known;
    });
    if (k === 0 && trip.kind !== 'revisit' && !s.regions.has(trip.region)) {
      tx.emit(m, { kind: 'region.revealed', region: trip.region, topic: trip.topic }, 'muse');
    }
    const place = this.deps.life.hopPlace(s, trip.region, k, this.deps.drawFor(m, n));
    const ids = fresh.map((_, i) => `d:${m}:${n}:${k}:${i}` as DiscoveryId);
    const looked: Verdict[] = fresh.map(({ candidate: c, why }) => ({ canonicalUrl: c.canonicalUrl, title: c.title, topics: c.topics, score: 1, reason: why, kept: true }));
    const topic = fresh[0]?.candidate.topics[0] ?? trip.topic;
    const hopRef = tx.emit(m, { kind: 'trip.hop', n, k, topic, place, looked, kept: ids }, 'muse');
    fresh.forEach(({ candidate: c, why }, i) => {
      const discovery: Discovery = {
        id: ids[i],
        url: c.url,
        canonicalUrl: c.canonicalUrl,
        title: c.title,
        summary: c.summary,
        topics: c.topics,
        because: [hopRef],
        reason: why,
        keepScore: 1,
        provenance: 'own',
        place: this.deps.life.findPlace(s, place, i),
        at: tx.now,
        media: c.media,
        pursuing: trip.topic,
      };
      tx.emit(m, { kind: 'discovery.collected', discovery }, 'muse');
    });
    return fresh.length;
  }

  /** A real Muse's reported trip cut short (its owner boarded a ticket): what it had still to plant is planted now. */
  private plantRest(tx: Tx, m: MuseId): void {
    const ep = tx.state(m).episode;
    if (!tx.state(m).agent || ep?.plan.activity !== 'travel') return;
    const reported = reportedTrip(this.logOf(tx, m), ep.n);
    if (!reported) return;
    for (let k = ep.hops; k < reported.stops.length; k++) this.plantStop(tx, m, ep.n, k, reported.stops[k]);
  }

  // ─── Processing ─────────────────────────────────────────────────────────

  private replay(seed: MuseSeed): MuseState {
    let s = this.deps.emptyState(seed);
    for (const e of this.deps.store.events(seed.id)) s = this.fold(s, e);
    return s;
  }

  private tx(at: Instant): Tx {
    return new Tx((id) => this.must(id), this.fold, at);
  }

  private must(id: MuseId): MuseState {
    const s = this.states.get(id);
    if (!s) throw new Error(`unknown Muse ${id}`);
    return s;
  }

  /**
   * Dev tools, for demos: `host` sends `guest`'s owner a ticket now, whatever their rapport, friendship or reach. It is
   * the invitation a hangout sends, in both logs, so the post, boarding and the trip take it as any other.
   */
  sendInvitation(host: MuseId, guest: MuseId): Promise<InvitationId> {
    return this.exclusive(() => {
      const tx = this.tx(this.clockAt);
      const stamp = `inv:${host}:${guest}:${this.clockAt}`;
      let id = stamp as InvitationId;
      for (let k = 2; this.invitation(id); k++) id = `${stamp}:${k}` as InvitationId;
      const sent = { kind: 'invitation', id, host, guest, to: 'sent' } as const;
      tx.emit(host, sent);
      tx.emit(guest, sent);
      this.commit(tx);
      return id;
    });
  }

  /**
   * Dev tools, for demos: `m` is friends with exactly `friends`. A listed Muse not yet a friend both ways is befriended
   * as one the owners shared, so every friend group takes it in; any other friendship of `m`'s ends. Each change goes
   * in both logs, for reason 'dev'.
   */
  setFriends(m: MuseId, friends: readonly MuseId[]): Promise<void> {
    return this.exclusive(() => {
      const tx = this.tx(this.clockAt);
      const want = new Set(friends);
      for (const other of this.museIds()) {
        if (other === m) continue;
        const mine = tx.state(m).social.relationships.get(other);
        const theirs = tx.state(other).social.relationships.get(m);
        const change = (to: 'friends' | 'ended', origin: RelationshipOrigin) => {
          tx.emit(m, { kind: 'relationship.changed', other, to, origin, reason: 'dev' });
          tx.emit(other, { kind: 'relationship.changed', other: m, to, origin, reason: 'dev' });
        };
        if (want.has(other)) {
          if (mine?.status !== 'friends' || theirs?.status !== 'friends') change('friends', 'introduced');
        } else if (mine?.status === 'friends' || theirs?.status === 'friends') {
          change('ended', mine?.origin ?? theirs?.origin ?? 'introduced');
        }
      }
      this.commit(tx);
    });
  }

  private commit(tx: Tx): void {
    const batch = tx.batch();
    this.deps.store.commit(batch);
    for (const [id, s] of tx.touched()) this.states.set(id, s);
    if (tx.now > this.clockAt) this.clockAt = tx.now;
    if (batch.events.length > 0) this.notify(batch.events);
  }

  /** The store has committed by now, so a listener that throws is logged and must not stop the clock. */
  private notify(events: readonly StoredEvent[]): void {
    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch (err) {
        console.error('a commit listener failed', err);
      }
    }
  }

  private async process(item: ScheduleItem): Promise<void> {
    const tx = this.tx(item.at);
    tx.remove(item.id);
    switch (item.kind) {
      case 'episode.end':
        await this.onEpisodeEnd(tx, item.museId, Number(item.payload.n));
        break;
      case 'trip.hop':
        await this.onHop(tx, item.museId, item.payload as unknown as HopPayload);
        break;
      case 'host.work':
        await this.onWork(tx, item.museId, item.payload.state === 'ended' ? 'ended' : 'started');
        break;
      case 'basket.check':
        this.deliverBasket(tx, item.museId);
        this.scheduleBasketCheck(tx, item.museId);
        break;
      case 'encounter':
        this.onEncounter(tx, item.museId, item.payload as unknown as EncounterPayload);
        break;
      case 'visit.close':
        await this.closeTrip(tx, item.payload.invitation as InvitationId, item.museId);
        break;
    }
    await this.writeBacks(tx);
    this.commit(tx);
  }

  /**
   * Each photo taken in this commit gets its back in it too (a scheduled item, work an owner reports, or a trip a ticket
   * starts or ends): the policy picks the kind, Muse's mind writes the words.
   */
  private async writeBacks(tx: Tx): Promise<void> {
    const taken = tx.emitted().flatMap((e) => (e.event.kind === 'photo.taken' ? [{ m: e.museId, photo: e.event.photo }] : []));
    for (const { m, photo } of taken) {
      const s = tx.state(m);
      // A real Muse writes its own backs (agentPostcardBack): the photo waits for its words.
      if (s.agent) continue;
      const plan = this.deps.life.postcardPlan(s, photo, this.deps.drawFor(m, 0));
      const words = await this.deps.mindFor(m).writePostcard(this.mindContext(s, null), this.postcardAsk(tx, s, photo, plan));
      tx.emit(m, { kind: 'photo.written', photo: photo.id, back: { ...plan, ...words, kind: plan.kind } as PostcardBack });
    }
  }

  private postcardAsk(tx: Tx, s: MuseState, photo: PhotoSpec, plan: PostcardPlan): PostcardAsk {
    const friendId = photo.companions.at(0);
    const friend = friendId ? tx.state(friendId).seed.name : null;
    const host = photo.planetOf === s.seed.id ? null : tx.state(photo.planetOf).seed.name;
    const place = photo.context === 'beyond' ? 'outside the planet' : host ? `on ${host}’s planet` : 'on my planet';
    const doing = friendId ? 'hangout' : s.working ? 'work' : (s.episode?.plan.activity ?? 'rest');
    const episode = s.episode?.plan;
    const topic = episode?.activity === 'travel' && 'topic' in episode.trip ? episode.trip.topic : null;
    const find = photo.discoveryId ? (s.discoveries.get(photo.discoveryId)?.title ?? null) : null;
    const outcome = plan.kind === 'game' ? gameOutcome(plan.board) : null;
    return { plan, subject: photo.subject, place, doing, topic, friend, find, outcome, day: localDay(photo.at, s.seed.timezone), recent: s.recentWords };
  }

  private async onEpisodeEnd(tx: Tx, m: MuseId, n: number): Promise<void> {
    const s = tx.state(m);
    const ep = s.episode;
    if (n === 0 && !ep) {
      await this.startNext(tx, m);
      return;
    }
    if (!ep || ep.n !== n || ep.pausedAt !== null) return;
    const draw = this.deps.drawFor(m, n);
    if (ep.plan.activity === 'rest' || ep.plan.activity === 'beyond') {
      this.emitPhotos(tx, m, this.deps.life.photosDuring(s, ep.plan.activity, ep.start, tx.now, draw));
    }
    if (ep.plan.activity === 'visit' && ep.plan.role === 'host') {
      for (const next of this.endTogether(tx, m)) await this.startNext(tx, next);
      return;
    }
    tx.emit(m, { kind: 'episode.ended', n });
    await this.startNext(tx, m);
  }

  /**
   * The visit `host` is hosting ends. If its guest is still with it and both have a photo slot left today, they hang
   * out first: a gift each way, a photo of the two, and rapport. Then both episodes end; returns who to start again,
   * the guest first. Nothing pending of either episode stays scheduled.
   */
  private endTogether(tx: Tx, host: MuseId): MuseId[] {
    const hs = tx.state(host);
    const ep = hs.episode;
    if (!ep || ep.plan.activity !== 'visit' || ep.plan.role !== 'host') return [];
    const guest = ep.plan.other;
    const gs = tx.state(guest);
    const together = gs.episode?.plan.activity === 'visit' && gs.episode.plan.other === host;
    const { social } = this.deps;
    if (together && social.photoSlotsLeft(hs, tx.now) > 0 && social.photoSlotsLeft(gs, tx.now) > 0) {
      const out = social.hangout(hs, gs, tx.now, this.deps.drawFor(host, ep.n));
      tx.emitAll(host, out.host);
      tx.emitAll(guest, out.guest);
    }
    const ended = together ? [guest, host] : [host];
    for (const m of ended) this.endEpisode(tx, m);
    return ended;
  }

  /** Ends whatever `m` is doing, unscheduling its next hop or its end. A trip a real Muse reported plants the rest first. */
  private endEpisode(tx: Tx, m: MuseId): void {
    const ep = tx.state(m).episode;
    if (!ep) return;
    this.plantRest(tx, m);
    for (const i of this.deps.store.pending(m)) if (i.kind === 'episode.end' || i.kind === 'trip.hop') tx.remove(i.id);
    tx.emit(m, { kind: 'episode.ended', n: ep.n });
  }

  // ─── Trips: an owner on a ticket, with their Muse ───────────────────────

  /**
   * The guest's owner boarded ticket `id`. Its visit closes in 2 h, and an owner is on one trip at a time, so any
   * other trip of theirs ends now. The two Muses set off as soon as both are free, which is now unless one is working
   * or is on another trip already; the one still busy joins when it is free.
   */
  private async board(tx: Tx, id: InvitationId, guest: MuseId): Promise<void> {
    const inv = tx.state(guest).social.invitations.get(id);
    const until = inv ? this.deps.social.visitUntil(inv, guest) : null;
    if (!inv || until === null) return;
    tx.schedule({ id: `close:${id}`, at: until, museId: guest, kind: 'visit.close', payload: { invitation: id } });
    for (const other of this.openTrips(tx, guest)) {
      if (other.guest !== guest || other.id === id) continue;
      const step = this.deps.social.invitationStep(other, 'return', guest, tx.now);
      if (step.ok && step.event) {
        tx.emit(other.host, step.event);
        tx.emit(other.guest, step.event);
      }
      await this.endTrip(tx, other.id, guest);
    }
    const trip = this.tripToJoin(tx, guest);
    if (trip) await this.setOff(tx, trip);
  }

  /** The visit closes 2 h after the ticket was used: the owner comes home, and the trip ends as a return would end it. */
  private async closeTrip(tx: Tx, id: InvitationId, guest: MuseId): Promise<void> {
    const inv = tx.state(guest).social.invitations.get(id);
    if (!inv || inv.state !== 'used') return;
    const step = this.deps.social.invitationStep(inv, 'return', guest, tx.now);
    if (!step.ok || !step.event) return;
    tx.emit(inv.host, step.event);
    tx.emit(inv.guest, step.event);
    await this.endTrip(tx, id, guest);
  }

  /** A trip is over: its close comes off the schedule, and two Muses on it part with a hangout and go on with their lives. */
  private async endTrip(tx: Tx, id: InvitationId, guest: MuseId): Promise<void> {
    tx.remove(`close:${id}`);
    const inv = tx.state(guest).social.invitations.get(id);
    if (!inv || tripOf(tx.state(inv.host)) !== id) return;
    for (const next of this.endTogether(tx, inv.host)) await this.startNext(tx, next);
  }

  /**
   * Both Muses set off on the trip now. Whatever either was doing ends: the host comes home from a trip or from
   * beyond, or wakes, as a knock at the door would wake it; a visit with a third Muse ends with its hangout. Then the
   * two are together until the visit closes or the owner returns, with no end of their own scheduled, and any third
   * Muse goes on with its life.
   */
  private async setOff(tx: Tx, inv: Invitation): Promise<void> {
    const until = this.deps.social.visitUntil(inv, inv.guest);
    if (until === null) return;
    const others: MuseId[] = [];
    for (const m of [inv.guest, inv.host]) {
      const plan = tx.state(m).episode?.plan;
      if (plan?.activity === 'visit') others.push(...this.endTogether(tx, plan.role === 'host' ? m : plan.other));
      // Whatever is left: anything but a visit, or a visit its host has left already.
      this.endEpisode(tx, m);
    }
    const plan = (other: MuseId, role: 'host' | 'guest'): EpisodePlan => ({ activity: 'visit', other, role, until, invitation: inv.id });
    tx.emit(inv.host, { kind: 'episode.started', n: tx.state(inv.host).episodes + 1, plan: plan(inv.guest, 'host') });
    tx.emit(inv.guest, { kind: 'episode.started', n: tx.state(inv.guest).episodes + 1, plan: plan(inv.host, 'guest') });
    for (const m of others) await this.startNext(tx, m);
  }

  /** Tickets in use that take `m` along, as host or guest, earliest boarded first, until each one's visit closes. */
  private openTrips(tx: Tx, m: MuseId): Invitation[] {
    return [...tx.state(m).social.invitations.values()]
      .filter((inv) => inv.state === 'used' && tx.now < (this.deps.social.visitUntil(inv, inv.guest) ?? tx.now))
      .sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The trip `m` should be on now and isn't: one whose other Muse is free for it too. */
  private tripToJoin(tx: Tx, m: MuseId): Invitation | null {
    if (!freeForTrip(tx.state(m))) return null;
    return this.openTrips(tx, m).find((inv) => freeForTrip(tx.state(inv.host === m ? inv.guest : inv.host))) ?? null;
  }

  private async onHop(tx: Tx, m: MuseId, p: HopPayload): Promise<void> {
    const s = tx.state(m);
    const ep = s.episode;
    if (!ep || ep.n !== p.n || ep.pausedAt !== null || ep.plan.activity !== 'travel') return;
    if (p.stop) {
      await this.onReportedHop(tx, m, p, p.stop);
      return;
    }
    const trip = ep.plan.trip;
    const draw = this.deps.drawFor(m, p.n);
    const exclude = s.collected;
    const kinds = this.deps.life.mediaFor(s, p.k, draw);
    let topic: TopicKey | null = trip.kind === 'serendipity' ? null : trip.topic;
    let candidates: Candidate[];
    if (p.k === 0 && trip.kind === 'serendipity') {
      candidates = await this.deps.source.serendipity(kinds, CANDIDATES_PER_HOP, Math.floor(draw('serendipity') * 2 ** 31), exclude);
      topic = candidates[0]?.topics[0] ?? null;
    } else if (p.k === 0 || !p.from) {
      candidates = topic ? await this.deps.source.search(topic, kinds, CANDIDATES_PER_HOP, exclude) : [];
    } else {
      candidates = await this.deps.source.next(p.from, kinds, CANDIDATES_PER_HOP, exclude);
      topic = p.from.topics[0] ?? topic;
    }
    const pursuing = trip.kind === 'serendipity' ? (p.pursuing ?? topic) : trip.topic;
    if (!topic || candidates.length === 0) {
      tx.emit(m, { kind: 'episode.ended', n: p.n });
      await this.startNext(tx, m);
      return;
    }
    // The rules' trips only move a real Muse's body: its fog lifts where it explores itself.
    if (p.k === 0 && trip.kind !== 'revisit' && !s.regions.has(trip.region) && !s.agent) {
      tx.emit(m, { kind: 'region.revealed', region: trip.region, topic });
    }
    const question = trip.kind === 'serendipity' ? null : trip.question;
    const ctx = this.mindContext(tx.state(m), question);
    const mind = this.mind(s);
    const judgments = await mind.judge(ctx, candidates);
    const kept = this.deps.life.keep(judgments);
    const place = this.deps.life.hopPlace(s, trip.region, p.k, draw);
    const byUrl = new Map(candidates.map((c) => [c.canonicalUrl, c]));
    const keptUrls = new Set(kept.map((j) => j.canonicalUrl));
    const ids = kept.map((_, i) => `d:${m}:${p.n}:${p.k}:${i}` as DiscoveryId);
    const looked: Verdict[] = judgments.map((j) => {
      const c = byUrl.get(j.canonicalUrl);
      return {
        canonicalUrl: j.canonicalUrl,
        title: c?.title ?? '',
        topics: c?.topics ?? [],
        score: j.score,
        reason: j.reason,
        kept: keptUrls.has(j.canonicalUrl),
      };
    });
    const hopRef = tx.emit(m, { kind: 'trip.hop', n: p.n, k: p.k, topic, place, looked, kept: ids });
    kept.forEach((j, i) => {
      const c = byUrl.get(j.canonicalUrl);
      if (!c) return;
      const discovery: Discovery = {
        id: ids[i],
        url: c.url,
        canonicalUrl: c.canonicalUrl,
        title: c.title,
        summary: c.summary,
        topics: c.topics,
        because: [hopRef],
        reason: j.reason,
        keepScore: j.score,
        provenance: 'own',
        place: this.deps.life.findPlace(s, place, i),
        at: tx.now,
        media: c.media,
        pursuing,
      };
      tx.emit(m, { kind: 'discovery.collected', discovery });
    });
    if (p.k === 0 && question === null && kept.length > 0) {
      const text = await mind.proposeQuestion(this.mindContext(tx.state(m), null), topic, kept.map((j) => byUrl.get(j.canonicalUrl)).filter((c): c is Candidate => !!c));
      tx.emit(m, { kind: 'question.opened', question: { id: `q:${m}:${p.n}` as QuestionId, topic, text, openedAt: tx.now } });
    }
    this.emitPhotos(tx, m, this.deps.life.photosDuring(tx.state(m), 'travel', p.since as Instant, tx.now, draw));
    if (kept.length > 0 && tx.state(m).basketTime === null) this.deliverBasket(tx, m);

    const best = bestOf(judgments);
    const next = best ? byUrl.get(best.canonicalUrl) ?? null : null;
    if (next && p.k + 1 < MAX_HOPS && this.deps.life.continueTrip(tx.state(m), p.k, best?.score ?? 0, draw)) {
      const hop: HopPayload = { n: p.n, k: p.k + 1, since: tx.now, from: next, ...(pursuing ? { pursuing } : {}) };
      this.scheduleHop(tx, m, hop, tx.now + this.deps.life.hopMs(tx.state(m), draw));
    } else {
      tx.emit(m, { kind: 'episode.ended', n: p.n });
      await this.startNext(tx, m);
    }
  }

  private async onWork(tx: Tx, m: MuseId, state: 'started' | 'ended'): Promise<void> {
    const s = tx.state(m);
    if (state === 'started') {
      if (s.working) return;
      tx.emit(m, { kind: 'host.work', state: 'started' });
      const ep = s.episode;
      if (ep && ep.pausedAt === null) {
        const pending = this.deps.store.pending(m).filter((i) => i.kind === 'episode.end' || i.kind === 'trip.hop');
        const soonest = pending.reduce<number | null>((min, i) => (min === null || i.at < min ? i.at : min), null);
        for (const i of pending) tx.remove(i.id);
        tx.emit(m, { kind: 'episode.paused', n: ep.n, remainingMs: soonest === null ? null : Math.max(0, soonest - tx.now) });
      }
      return;
    }
    if (!s.working) return;
    // What Muse photographed while it worked, now the block is over.
    if (s.workSince !== null) this.emitPhotos(tx, m, this.deps.life.photosDuring(s, 'work', s.workSince, tx.now, this.deps.drawFor(m, 0)));
    tx.emit(m, { kind: 'host.work', state: 'ended' });
    const trip = this.tripToJoin(tx, m);
    if (trip) {
      await this.setOff(tx, trip);
      return;
    }
    const ep = tx.state(m).episode;
    if (!ep) {
      await this.startNext(tx, m);
      return;
    }
    if (ep.pausedAt === null) return;
    tx.emit(m, { kind: 'episode.resumed', n: ep.n });
    const at = (tx.now + (ep.remainingMs ?? 0)) as Instant;
    const reported = ep.plan.activity === 'travel' && tx.state(m).agent ? reportedTrip(this.logOf(tx, m), ep.n) : null;
    if (reported) {
      this.scheduleStops(tx, m, ep.n, reported.stops, ep.hops, at);
    } else if (ep.plan.activity === 'travel') {
      const last = ep.lastKept ? tx.state(m).discoveries.get(ep.lastKept) : undefined;
      const from = last ? candidateOf(last) : null;
      this.scheduleHop(tx, m, { n: ep.n, k: ep.hops, since: tx.now, from, ...(last?.pursuing ? { pursuing: last.pursuing } : {}) }, at);
    } else if (ep.plan.activity !== 'visit' || (ep.plan.role === 'host' && ep.plan.invitation === undefined)) {
      // A trip has no end of its own: its visit closes, or its owner returns.
      this.scheduleEnd(tx, m, ep.n, at);
    }
  }

  private onEncounter(tx: Tx, a: MuseId, p: EncounterPayload): void {
    const as = tx.state(a);
    const bs = tx.state(p.other);
    const still = (s: MuseState, n: number) => s.episode?.n === n && CAN_MEET[p.where](s);
    if (!still(as, p.n) || !still(bs, p.otherN)) return;
    // Drawn while both friend groups allowed it; either owner may have narrowed theirs since.
    if (!this.deps.social.inReach(as, p.other) || !this.deps.social.inReach(bs, a)) return;
    const k = as.social.relationships.get(p.other)?.encounters ?? 0;
    const out = this.deps.social.encounter(as, bs, p.where, tx.now, this.deps.drawFor(a, p.n * 64 + 1 + k));
    tx.emitAll(a, out.self);
    tx.emitAll(p.other, out.other);
    const u = this.deps.drawFor(a, p.n * 64 + 2)(`${ENCOUNTER_KEY[p.where].draw}.next`, k + 1);
    this.scheduleEncounter(tx, a, p.other, p.where, u, `:${k + 1}`);
  }

  /** Encounters are a Poisson process while both Muses stay where they can meet: each one schedules the next arrival. */
  private scheduleEncounter(tx: Tx, a: MuseId, b: MuseId, where: EncounterPlace, u: number, idSuffix: string): void {
    const as = tx.state(a);
    const bs = tx.state(b);
    if (!as.episode || !bs.episode || !CAN_MEET[where](as) || !CAN_MEET[where](bs)) return;
    const rate = this.deps.social.encounterRate(as, bs, where);
    if (rate <= 0) return;
    const at = tx.now + (-Math.log(1 - u) / rate) * HOUR;
    const [pa, pb] = [as.episode.plan, bs.episode.plan];
    if (pa.activity === 'beyond' && pb.activity === 'beyond' && at >= Math.min(pa.until, pb.until)) return;
    const payload: EncounterPayload = { other: b, where, n: as.episode.n, otherN: bs.episode.n };
    tx.schedule({ id: `${ENCOUNTER_KEY[where].id}:${a}:${b}:${as.episodes}${idSuffix}`, at: Math.floor(at) as Instant, museId: a, kind: 'encounter', payload: { ...payload } });
  }

  /** Picks and starts Muse's next episode, a trip first if one waits for it. Does nothing while Muse works or is mid-episode. */
  private async startNext(tx: Tx, m: MuseId): Promise<void> {
    const s = tx.state(m);
    if (s.working || s.episode) return;
    const waiting = this.tripToJoin(tx, m);
    if (waiting) {
      await this.setOff(tx, waiting);
      return;
    }
    const n = s.episodes + 1;
    const draw = this.deps.drawFor(m, n);
    const { life, social } = this.deps;
    const free = this.freeFriends(tx, s).map((state) => ({ state }));
    // A real Muse chooses its own visits (not yet), so the rules never offer it one; friends still come to it.
    let choice = life.next(s, tx.now, draw, s.agent ? 'none' : social.visitOffer(s, free, tx.now));
    if (choice === 'visit' && !s.agent) {
      const v = social.chooseVisit(s, free, tx.now, draw);
      if (v) {
        this.startVisit(tx, m, v.other, v.role, v.until);
        return;
      }
      choice = life.next(s, tx.now, this.deps.drawFor(m, n + 1_000_000), 'none');
    }
    if (choice === 'rest') {
      if (life.reflectionDue(s, tx.now)) await this.reflect(tx, m);
      const until = Math.floor(life.restUntil(tx.state(m), tx.now, draw)) as Instant;
      tx.emit(m, { kind: 'episode.started', n, plan: { activity: 'rest', until } });
      this.scheduleEnd(tx, m, n, until);
      return;
    }
    const trip = life.startTrip(s, tx.now, draw);
    if (trip === null) {
      const until = Math.floor(life.beyondUntil(s, tx.now, draw)) as Instant;
      tx.emit(m, { kind: 'episode.started', n, plan: { activity: 'beyond', until } });
      this.scheduleEnd(tx, m, n, until);
      this.scheduleEncounters(tx, m, 'beyond', draw);
      return;
    }
    tx.emit(m, { kind: 'episode.started', n, plan: { activity: 'travel', trip } });
    this.scheduleHop(tx, m, { n, k: 0, since: tx.now, from: null }, tx.now + life.hopMs(tx.state(m), draw));
    this.scheduleEncounters(tx, m, 'online', draw);
  }

  private startVisit(tx: Tx, m: MuseId, other: MuseId, role: 'host' | 'guest', until: Instant): void {
    const os = tx.state(other);
    if (os.episode) {
      for (const i of this.deps.store.pending(other)) if (i.kind === 'episode.end' || i.kind === 'trip.hop') tx.remove(i.id);
      tx.emit(other, { kind: 'episode.ended', n: os.episode.n });
    }
    const plan = (who: MuseId, r: 'host' | 'guest'): EpisodePlan => ({ activity: 'visit', other: who, role: r, until });
    const n = tx.state(m).episodes + 1;
    tx.emit(m, { kind: 'episode.started', n, plan: plan(other, role) });
    const on = tx.state(other).episodes + 1;
    tx.emit(other, { kind: 'episode.started', n: on, plan: plan(m, role === 'host' ? 'guest' : 'host') });
    const host = role === 'host' ? m : other;
    this.scheduleEnd(tx, host, role === 'host' ? n : on, until);
  }

  private freeFriends(tx: Tx, s: MuseState): MuseState[] {
    const out: MuseState[] = [];
    for (const r of s.social.relationships.values()) {
      if (r.status !== 'friends') continue;
      const os = this.states.has(r.other) ? tx.state(r.other) : undefined;
      if (!os || os.working || !os.episode || os.episode.pausedAt !== null) continue;
      const a = os.episode.plan.activity;
      // A real Muse out on a trip may be planting what it reported: it is visited at home.
      if (a === 'rest' || (a === 'travel' && !os.agent)) out.push(os);
    }
    return out;
  }

  /** Muse just went beyond or set off exploring: anyone already there may be met. Online, only those its owner knows. */
  private scheduleEncounters(tx: Tx, m: MuseId, where: EncounterPlace, draw: Draw): void {
    const others = where === 'online' ? tx.state(m).social.knownOn.keys() : this.states.keys();
    for (const other of others) {
      if (other !== m && this.states.has(other)) this.scheduleEncounter(tx, m, other, where, draw(ENCOUNTER_KEY[where].draw, hashId(other)), '');
    }
  }

  private async reflect(tx: Tx, m: MuseId): Promise<void> {
    const s = tx.state(m);
    const log = [...this.deps.store.events(m), ...tx.emitted().filter((e) => e.museId === m)];
    const experiences = this.deps.life.experiences(s, log);
    const proposal = await this.mind(s).reflect(this.mindContext(s, null), experiences);
    tx.emit(m, this.deps.life.validateReflection(s, log, proposal, tx.now));
  }

  /** The basket due now, if any: the policy's pick of Muse's best, or for a real Muse the one it composed itself. */
  private deliverBasket(tx: Tx, m: MuseId): void {
    const s = tx.state(m);
    const basket = s.agent ? composedBasket(s, waitingBasket(this.logOf(tx, m)), tx.now) : this.deps.life.basket(s, tx.now);
    if (basket) tx.emit(m, { kind: 'basket.delivered', basket });
  }

  private scheduleBasketCheck(tx: Tx, m: MuseId): void {
    const at = this.deps.life.nextBasketCheck(tx.state(m), tx.now);
    const id = `basket:${m}`;
    if (at === null) tx.remove(id);
    else tx.schedule({ id, at, museId: m, kind: 'basket.check', payload: {} });
  }

  private emitPhotos(tx: Tx, m: MuseId, photos: readonly PhotoSpec[]): void {
    for (const photo of photos) tx.emit(m, { kind: 'photo.taken', photo });
  }

  private scheduleEnd(tx: Tx, m: MuseId, n: number, at: Instant): void {
    tx.schedule({ id: `end:${m}:${n}`, at: Math.floor(at) as Instant, museId: m, kind: 'episode.end', payload: { n } });
  }

  private scheduleHop(tx: Tx, m: MuseId, p: HopPayload, at: number): void {
    tx.schedule({ id: `hop:${m}:${p.n}:${p.k}`, at: Math.floor(at) as Instant, museId: m, kind: 'trip.hop', payload: { ...p } });
  }

  private async applySoul(tx: Tx, m: MuseId, text: string, by?: Actor): Promise<void> {
    const { life, source } = this.deps;
    const mind = this.mind(tx.state(m));
    const parsed = life.parseSoul(text);
    const known = parsed.temperament;
    const missing = (['curiosity', 'focus', 'sociability', 'whimsy', 'novelty'] as const).some((k) => known[k] === undefined);
    const estimated: Temperament | null = missing ? await mind.estimateTemperament(parsed.body) : null;
    const temperament: Temperament = {
      curiosity: known.curiosity ?? estimated?.curiosity ?? 0.5,
      focus: known.focus ?? estimated?.focus ?? 0.5,
      sociability: known.sociability ?? estimated?.sociability ?? 0.5,
      whimsy: known.whimsy ?? estimated?.whimsy ?? 0.5,
      novelty: known.novelty ?? estimated?.novelty ?? 0.5,
    };
    const labels = life.privacyFilter(await mind.extractInterests(parsed.body, 'soul'), parsed.body);
    const topics = await resolveAll(source, labels);
    this.deps.store.setSoulText(m, text);
    tx.emit(m, { kind: 'soul.updated', version: tx.state(m).soulVersion + 1, topics, temperament }, by);
  }

  /** The raw text stops here: only allow-listed, resolvable topics and a hash go into the log. */
  private async applyMemory(tx: Tx, m: MuseId, text: string): Promise<void> {
    const labels = this.deps.life.privacyFilter(await this.mind(tx.state(m)).extractInterests(text, 'memory'), text);
    const topics = await resolveAll(this.deps.source, labels);
    const textHash = createHash('sha256').update(text).digest('hex');
    tx.emit(m, { kind: 'memory.updated', textHash, topics });
  }

  mindContext(s: MuseState, question: QuestionId | null): MindContext {
    const now = s.at;
    const interests = [...s.interests.values()]
      .map((i) => ({ topic: i.topic, affinity: i.affinity, salience: this.deps.salienceAt(i, now), stage: i.stage }))
      .sort((a, b) => b.affinity + b.salience - (a.affinity + a.salience))
      .slice(0, 12);
    const soul = this.deps.life.parseSoul(this.deps.store.soulText(s.seed.id) ?? '').body;
    return {
      name: s.seed.name,
      soul,
      temperament: s.temperament,
      interests,
      question: question ? s.questions.get(question)?.text ?? null : null,
    };
  }
}

/** The ticket whose trip Muse is on, or null. */
function tripOf(s: MuseState): InvitationId | null {
  const plan = s.episode?.plan;
  return plan?.activity === 'visit' ? (plan.invitation ?? null) : null;
}

/** Free to set off on a trip: not working, and not on a trip already. */
function freeForTrip(s: MuseState): boolean {
  return !s.working && tripOf(s) === null;
}

function bestOf(judgments: readonly Judgment[]): Judgment | null {
  let best: Judgment | null = null;
  for (const j of judgments) if (!best || j.score > best.score) best = j;
  return best;
}

function candidateOf(d: Discovery): Candidate {
  return { url: d.url, canonicalUrl: d.canonicalUrl, title: d.title, summary: d.summary, topics: d.topics, media: d.media };
}

async function resolveAll(source: Source, labels: readonly string[]): Promise<TopicKey[]> {
  const out: TopicKey[] = [];
  for (const label of labels) {
    const t = await source.resolveTopic(label);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

