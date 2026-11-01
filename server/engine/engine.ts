import { createHash } from 'node:crypto';
import type {
  Candidate,
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
  MuseSeed,
  MuseState,
  PhotoSpec,
  QuestionId,
  ReduceCore,
  ReduceSocial,
  ScheduleItem,
  SocialPolicy,
  Source,
  Store,
  StoredEvent,
  Temperament,
  TopicKey,
  Verdict,
} from '../../src/muse/contract';
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
}

const CANDIDATES_PER_HOP = 8;
const MAX_HOPS = 4;
const HOUR = 3_600_000;

interface HopPayload {
  readonly n: number;
  readonly k: number;
  readonly since: number;
  readonly from: Candidate | null;
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
      const friend = photo && (photo.subject === 'friend' || photo.subject === 'new-friend') ? photo.companions.at(0) : undefined;
      const tx = this.tx(this.clockAt);
      tx.emit(museId, { kind: 'owner.liked', target, liked, ...(friend ? { friend } : {}) });
      this.commit(tx);
      return true;
    });
  }

  /** The guest's owner uses an invitation, or the host's owner withdraws it. `as` is the Muse whose owner acts. */
  invitationAction(id: InvitationId, as: MuseId, action: 'use' | 'withdraw'): Promise<CommandResult> {
    return this.exclusive((): CommandResult => {
      const inv = this.invitation(id);
      if (!inv) return { ok: false, status: 404, error: 'no such invitation' };
      const r = this.deps.social.invitationStep(inv, action, as, this.clockAt);
      if (!r.ok) return r;
      if (r.event) {
        const tx = this.tx(this.clockAt);
        tx.emit(inv.host, r.event);
        tx.emit(inv.guest, r.event);
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
    }
    this.commit(tx);
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
      const other = ep.plan.other;
      const os = tx.state(other);
      const together = os.episode?.plan.activity === 'visit' && os.episode.plan.other === m;
      if (together) {
        const out = this.deps.social.hangout(s, os, tx.now, draw);
        tx.emitAll(m, out.host);
        tx.emitAll(other, out.guest);
        const guestEp = tx.state(other).episode;
        if (guestEp) {
          tx.emit(other, { kind: 'episode.ended', n: guestEp.n });
          await this.startNext(tx, other);
        }
      }
    }
    tx.emit(m, { kind: 'episode.ended', n });
    await this.startNext(tx, m);
  }

  private async onHop(tx: Tx, m: MuseId, p: HopPayload): Promise<void> {
    const s = tx.state(m);
    const ep = s.episode;
    if (!ep || ep.n !== p.n || ep.pausedAt !== null || ep.plan.activity !== 'travel') return;
    const trip = ep.plan.trip;
    const draw = this.deps.drawFor(m, p.n);
    const exclude = s.collected;
    let topic: TopicKey | null = trip.kind === 'serendipity' ? null : trip.topic;
    let candidates: Candidate[];
    if (p.k === 0 && trip.kind === 'serendipity') {
      candidates = await this.deps.source.serendipity(CANDIDATES_PER_HOP, Math.floor(draw('serendipity') * 2 ** 31), exclude);
      topic = candidates[0]?.topics[0] ?? null;
    } else if (p.k === 0 || !p.from) {
      candidates = topic ? await this.deps.source.search(topic, CANDIDATES_PER_HOP, exclude) : [];
    } else {
      candidates = await this.deps.source.next(p.from, CANDIDATES_PER_HOP, exclude);
      topic = p.from.topics[0] ?? topic;
    }
    if (!topic || candidates.length === 0) {
      tx.emit(m, { kind: 'episode.ended', n: p.n });
      await this.startNext(tx, m);
      return;
    }
    if (p.k === 0 && trip.kind !== 'revisit' && !s.regions.has(trip.region)) {
      tx.emit(m, { kind: 'region.revealed', region: trip.region, topic });
    }
    const question = trip.kind === 'serendipity' ? null : trip.question;
    const ctx = this.mindContext(tx.state(m), question);
    const mind = this.deps.mindFor(m);
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
        ...(c.thumb ? { thumb: c.thumb } : {}),
        topics: c.topics,
        because: [hopRef],
        reason: j.reason,
        keepScore: j.score,
        provenance: 'own',
        place: this.deps.life.findPlace(s, place, i),
        at: tx.now,
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
      this.scheduleHop(tx, m, { n: p.n, k: p.k + 1, since: tx.now, from: next }, tx.now + this.deps.life.hopMs(tx.state(m), draw));
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
    tx.emit(m, { kind: 'host.work', state: 'ended' });
    const ep = tx.state(m).episode;
    if (!ep) {
      await this.startNext(tx, m);
      return;
    }
    if (ep.pausedAt === null) return;
    tx.emit(m, { kind: 'episode.resumed', n: ep.n });
    const at = (tx.now + (ep.remainingMs ?? 0)) as Instant;
    if (ep.plan.activity === 'travel') {
      const from = ep.lastKept ? candidateOf(tx.state(m).discoveries.get(ep.lastKept)) : null;
      this.scheduleHop(tx, m, { n: ep.n, k: ep.hops, since: tx.now, from }, at);
    } else if (ep.plan.activity !== 'visit' || ep.plan.role === 'host') {
      this.scheduleEnd(tx, m, ep.n, at);
    }
  }

  private onEncounter(tx: Tx, a: MuseId, p: EncounterPayload): void {
    const as = tx.state(a);
    const bs = tx.state(p.other);
    const still = (s: MuseState, n: number) => s.episode?.n === n && CAN_MEET[p.where](s);
    if (!still(as, p.n) || !still(bs, p.otherN)) return;
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

  /** Picks and starts Muse's next episode. Does nothing while Muse works or is mid-episode. */
  private async startNext(tx: Tx, m: MuseId): Promise<void> {
    const s = tx.state(m);
    if (s.working || s.episode) return;
    const n = s.episodes + 1;
    const draw = this.deps.drawFor(m, n);
    const { life, social } = this.deps;
    const free = this.freeFriends(tx, s).map((state) => ({ state }));
    let choice = life.next(s, tx.now, draw, social.visitOffer(s, free, tx.now));
    if (choice === 'visit') {
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
      if (a === 'rest' || a === 'travel') out.push(os);
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
    const proposal = await this.deps.mindFor(m).reflect(this.mindContext(s, null), experiences);
    tx.emit(m, this.deps.life.validateReflection(s, log, proposal, tx.now));
  }

  private deliverBasket(tx: Tx, m: MuseId): void {
    const basket = this.deps.life.basket(tx.state(m), tx.now);
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

  private async applySoul(tx: Tx, m: MuseId, text: string): Promise<void> {
    const { life, source } = this.deps;
    const mind = this.deps.mindFor(m);
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
    tx.emit(m, { kind: 'soul.updated', version: tx.state(m).soulVersion + 1, topics, temperament });
  }

  /** The raw text stops here: only allow-listed, resolvable topics and a hash go into the log. */
  private async applyMemory(tx: Tx, m: MuseId, text: string): Promise<void> {
    const labels = this.deps.life.privacyFilter(await this.deps.mindFor(m).extractInterests(text, 'memory'), text);
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

function bestOf(judgments: readonly Judgment[]): Judgment | null {
  let best: Judgment | null = null;
  for (const j of judgments) if (!best || j.score > best.score) best = j;
  return best;
}

function candidateOf(d: Discovery | undefined): Candidate | null {
  if (!d) return null;
  return {
    origin: d.url.includes('wikipedia.org') ? 'wikipedia' : 'rss',
    url: d.url,
    canonicalUrl: d.canonicalUrl,
    title: d.title,
    summary: d.summary,
    ...(d.thumb ? { thumb: d.thumb } : {}),
    topics: d.topics,
  };
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

