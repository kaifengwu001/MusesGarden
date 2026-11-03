import { createHash } from 'node:crypto';
import type {
  BasketId,
  BasketView,
  CommandResult,
  Dir,
  Discovery,
  DiscoveryId,
  GardenCommands,
  GardenFrame,
  GardenQueries,
  HiddenRef,
  Instant,
  Interest,
  InvitationCard,
  InvitationId,
  LikeTarget,
  MemberInfo,
  MetricsRow,
  MindView,
  MuseId,
  MuseState,
  NowView,
  Page,
  PhotoId,
  PhotoView,
  PlantCard,
  PlantPin,
  PlantPreview,
  Reach,
  RegionKey,
  RegionView,
  SharingView,
  ShelfView,
  SocialPolicy,
  StoredEvent,
  TopicKey,
  VisitMuse,
  VisitWorldView,
  WorldView,
} from '../../src/muse/contract';
import type { GardenSnapshot } from '../../src/garden/types';
import type { Engine } from './engine';
import { flowerOf, gardenFrames, gardenSnapshot, topicLabel, type GardenInput } from './garden';

/** Domain functions the views need, injected so this file depends only on the contract. */
export interface ViewHelpers {
  readonly regions: readonly RegionKey[];
  readonly regionCenter: (key: RegionKey) => Dir;
  readonly growth: (s: MuseState) => number;
  readonly salienceAt: (interest: Interest, now: Instant) => number;
  readonly shelf: (s: MuseState, now: Instant) => readonly { readonly discovery: Discovery; readonly fondness: number }[];
  readonly soulSection: (s: MuseState) => string;
  readonly journal: (s: MuseState, log: readonly StoredEvent[], day: string | null) => string;
  readonly metrics: (s: MuseState, log: readonly StoredEvent[]) => readonly MetricsRow[];
  /** YYYY-MM-DD on the owner's clock. */
  readonly localDay: (at: Instant, timezone: string) => string;
  /** SOUL.md without its frontmatter. */
  readonly soulBody: (soulMd: string) => string;
}

const SLEEP_MS = 90 * 60_000;
/** A Muse cast.json doesn't name: a stranger in the original body, on the meadow at its own seed. */
const UNLISTED: MemberInfo = { role: 'stranger', planet: 'meadow', look: 'tpose6' };

export function shareCode(s: MuseState): string {
  const h = createHash('sha256').update(`share:${s.seed.id}`).digest('hex').slice(0, 4).toUpperCase();
  return `${s.seed.name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)}-${h}`;
}

export function card(d: Discovery): PlantCard {
  return {
    id: d.id,
    title: d.title,
    url: d.url,
    summary: d.summary,
    ...(d.media.image ? { thumb: d.media.image } : {}),
    reason: d.reason,
    foundAt: d.at,
    place: d.place,
    media: d.media,
    pursuing: d.pursuing,
  };
}

function preview(d: Discovery): PlantPreview {
  return { title: d.title, ...(d.media.image ? { thumb: d.media.image } : {}), reason: d.reason };
}

function pin(d: Discovery, sent: ReadonlySet<DiscoveryId>): PlantPin {
  return {
    id: d.id,
    dir: d.place.dir,
    topic: d.topics[0] ?? (d.title as TopicKey),
    foundAt: d.at,
    sent: sent.has(d.id),
    preview: preview(d),
  };
}

function sentIds(s: MuseState): ReadonlySet<DiscoveryId> {
  return new Set(s.baskets.flatMap((b) => b.items));
}

function page<T extends { readonly id: string }>(newestFirst: readonly T[], before: string | null, limit: number): Page<T, T['id']> {
  const start = before === null ? 0 : newestFirst.findIndex((x) => x.id === before) + 1;
  const items = start <= 0 && before !== null ? [] : newestFirst.slice(start, start + limit);
  const last = items.at(-1);
  const more = last ? newestFirst.indexOf(last) < newestFirst.length - 1 : false;
  return { items, next: more && last ? last.id : null };
}

export class Views implements GardenQueries {
  constructor(
    private readonly engine: Engine,
    private readonly social: SocialPolicy,
    private readonly helpers: ViewHelpers,
    private readonly members: ReadonlyMap<MuseId, MemberInfo>,
  ) {}

  private s(id: MuseId): MuseState | null {
    return this.engine.state(id) ?? null;
  }

  private name(id: MuseId): string {
    return this.engine.state(id)?.seed.name ?? 'a friend';
  }

  private member(id: MuseId): MemberInfo {
    return this.members.get(id) ?? UNLISTED;
  }

  private visitMuse(museId: MuseId): VisitMuse {
    return { museId, name: this.name(museId), look: this.member(museId).look };
  }

  muses(): ReturnType<GardenQueries['muses']> {
    return this.engine.museIds().map((museId) => ({ museId, name: this.name(museId), ...this.member(museId) }));
  }

  garden(museId: MuseId, at: Instant): GardenSnapshot | null {
    const input = this.gardenInput(museId, at);
    return input && gardenSnapshot(input);
  }

  /** Replays the garden events after log seq `after`, sends Muse's status, then sends what each commit brings; returns the way to stop. */
  subscribeGarden(museId: MuseId, after: number | null, send: (frame: GardenFrame) => void): () => void {
    const input = this.gardenInput(museId, this.engine.now());
    if (!input) return () => undefined;
    const missed = after === null ? [] : this.engine.log(museId).filter((e) => e.seq > after);
    for (const frame of gardenFrames(input, missed, 'always')) send(frame);
    return this.engine.subscribe((events) => {
      const mine = events.filter((e) => e.museId === museId);
      const latest = mine.length > 0 ? this.gardenInput(museId, this.engine.now()) : null;
      if (latest) for (const frame of gardenFrames(latest, mine, 'if-moved')) send(frame);
    });
  }

  private gardenInput(museId: MuseId, at: Instant): GardenInput | null {
    const s = this.s(museId);
    const now = this.now(museId, at);
    if (!s || !now) return null;
    const soul = this.engine.soulText(museId);
    return {
      s,
      log: () => this.engine.log(museId),
      soul: soul === null ? null : this.helpers.soulBody(soul),
      now,
      g: this.helpers.growth(s),
      day: (t) => this.helpers.localDay(t, s.seed.timezone),
      profile: (id) => {
        const other = this.s(id);
        return other ? this.social.publicProfile(other) : null;
      },
      salienceAt: this.helpers.salienceAt,
      inReach: (id) => this.social.inReach(s, id),
      planetOf: (id) => {
        const other = this.s(id);
        const { planet, look } = this.member(id);
        return other ? { planet, seed: other.seed.worldSeed, g: this.helpers.growth(other), look } : null;
      },
    };
  }

  now(museId: MuseId, at: Instant): NowView | null {
    const s = this.s(museId);
    if (!s) return null;
    const home = this.helpers.regionCenter(s.home);
    const ep = s.episode;
    const base = { museId, name: s.seed.name, at, working: s.working, companion: null, away: null } as const;
    if (!ep) {
      return { ...base, activity: 'rest', sleeping: false, since: s.at, until: null, label: s.working ? 'Working' : 'At home', path: [{ dir: home, at }] };
    }
    const plan = ep.plan;
    const working = (where: string) => (s.working ? `Working${where}` : null);
    switch (plan.activity) {
      case 'rest': {
        const sleeping = plan.until - ep.start >= SLEEP_MS;
        return { ...base, activity: 'rest', sleeping, since: ep.start, until: plan.until, label: working('') ?? (sleeping ? 'Asleep' : 'Napping'), path: [{ dir: home, at }] };
      }
      case 'beyond':
        return { ...base, activity: 'beyond', sleeping: false, since: ep.start, until: plan.until, label: working(' outside the planet') ?? 'Traveling outside the planet', path: null, away: { kind: 'beyond' } };
      case 'visit': {
        const other = { museId: plan.other, name: this.name(plan.other) };
        if (plan.role === 'host') {
          return { ...base, activity: 'visit', sleeping: false, since: ep.start, until: plan.until, label: working('') ?? `${other.name} is visiting`, path: [{ dir: home, at }], companion: other };
        }
        return {
          ...base,
          activity: 'visit',
          sleeping: false,
          since: ep.start,
          until: plan.until,
          label: working(` at ${other.name}'s planet`) ?? `Away at ${other.name}'s planet`,
          path: null,
          away: { kind: 'planet', of: plan.other, name: other.name },
        };
      }
      case 'travel': {
        const hops = this.engine.log(museId).filter((e) => e.event.kind === 'trip.hop' && e.event.n === ep.n);
        const topics = hops.map((e) => (e.event.kind === 'trip.hop' ? topicLabel(e.event.topic) : ''));
        const first = plan.trip.kind === 'serendipity' ? topics[0] ?? 'somewhere new' : topicLabel(plan.trip.topic);
        const trail = [first, ...topics.slice(1)].slice(-2).join(' → ');
        const path: { dir: Dir; at: Instant; transport?: true }[] = [{ dir: home, at: ep.start }, { dir: this.helpers.regionCenter(plan.trip.region), at: ep.start, transport: true }];
        for (const e of hops) if (e.event.kind === 'trip.hop') path.push({ dir: e.event.place.dir, at: e.event.at });
        return { ...base, activity: 'travel', sleeping: false, since: ep.start, until: null, label: working('') ?? `Exploring: ${trail}`, path };
      }
    }
  }

  world(museId: MuseId): WorldView | null {
    const s = this.s(museId);
    if (!s) return null;
    const sent = sentIds(s);
    return { museId, worldSeed: s.seed.worldSeed, g: this.helpers.growth(s), regions: this.regionViews(s), plants: [...s.discoveries.values()].map((d) => pin(d, sent)) };
  }

  private regionViews(s: MuseState): RegionView[] {
    return this.helpers.regions.map((key) => {
      const topics = s.regions.get(key);
      return topics ? { key, fogged: false, topics: topics.map((topic) => ({ topic, label: topicLabel(topic) })) } : { key, fogged: true };
    });
  }

  plant(museId: MuseId, id: DiscoveryId): PlantCard | null {
    const d = this.s(museId)?.discoveries.get(id);
    return d ? card(d) : null;
  }

  baskets(museId: MuseId, before: BasketId | null, limit: number): Page<BasketView, BasketId> {
    const s = this.s(museId);
    if (!s) return { items: [], next: null };
    const views: BasketView[] = [...s.baskets].reverse().map((b) => ({
      id: b.id,
      at: b.at,
      items: b.items.map((id) => s.discoveries.get(id)).filter((d): d is Discovery => !!d).map(card),
    }));
    return page(views, before, limit);
  }

  photos(museId: MuseId, before: PhotoId | null, limit: number): Page<PhotoView, PhotoId> {
    const s = this.s(museId);
    if (!s) return { items: [], next: null };
    const views: PhotoView[] = [...s.photos].reverse().map((p) => {
      const planet = this.s(p.planetOf) ?? s;
      return { ...p, worldSeed: planet.seed.worldSeed, g: this.helpers.growth(planet), companionNames: p.companions.map((c) => this.name(c)) };
    });
    return page(views, before, limit);
  }

  shelf(museId: MuseId): ShelfView | null {
    const s = this.s(museId);
    if (!s) return null;
    return { items: this.helpers.shelf(s, this.engine.now()).slice(0, 10).map(({ discovery, fondness }) => ({ ...card(discovery), fondness })) };
  }

  invitations(museId: MuseId, at: Instant): readonly InvitationCard[] {
    const s = this.s(museId);
    if (!s) return [];
    return [...s.social.invitations.values()]
      .filter((inv) => inv.host === museId || inv.guest === museId)
      .map((inv) => {
        const role = inv.host === museId ? ('host' as const) : ('guest' as const);
        const until = this.social.visitUntil(inv, museId);
        return {
          id: inv.id,
          role,
          otherName: this.name(role === 'host' ? inv.guest : inv.host),
          state: inv.state,
          sentAt: inv.sentAt,
          usedAt: inv.usedAt,
          actions: inv.state !== 'sent' ? [] : role === 'guest' ? ['use'] : ['withdraw'],
          canVisitNow: until !== null && at < until,
        };
      });
  }

  visit(invitation: InvitationId, requester: MuseId, at: Instant): VisitWorldView | 'forbidden' {
    const inv = this.engine.invitation(invitation);
    const until = this.social.visitUntil(inv, requester);
    if (!inv || until === null || at >= until) return 'forbidden';
    const host = this.s(inv.host);
    if (!host) return 'forbidden';
    const shared = new Map(this.social.publicProfile(host).discoveries.map((d) => [d.id, d]));
    return {
      invitation,
      planet: this.member(inv.host).planet,
      host: this.visitMuse(inv.host),
      guest: this.visitMuse(inv.guest),
      worldSeed: host.seed.worldSeed,
      g: this.helpers.growth(host),
      regions: this.regionViews(host),
      plants: [...host.discoveries.values()].map((d) => {
        const pub = shared.get(d.id);
        // The public copy says which trip found it only when that trip's topic is public; a bed grows from it only then.
        return pub
          ? { id: d.id, dir: d.place.dir, bed: flowerOf(pub.pursuing ?? d.id), preview: preview(d), card: { ...card(d), pursuing: pub.pursuing } }
          : { id: d.id, dir: d.place.dir, bed: flowerOf(d.id), preview: null, card: null };
      }),
      until,
    };
  }

  sharing(museId: MuseId): SharingView | null {
    const s = this.s(museId);
    if (!s) return null;
    const unhidden = this.social.publicProfile({ ...s, hidden: new Set() });
    return {
      interests: unhidden.interests.map((i) => ({ topic: i.topic, label: topicLabel(i.topic), hidden: s.hidden.has(`topic:${i.topic}`) })),
      finds: unhidden.discoveries.map((d) => ({ id: d.id, title: d.title, hidden: s.hidden.has(`discovery:${d.id}`) })),
      friends: [...s.social.relationships.values()]
        .filter((r) => r.status === 'friends')
        .map((r) => ({ museId: r.other, name: this.name(r.other), origin: r.origin })),
      shareCode: shareCode(s),
      basketTime: s.basketTime,
    };
  }

  mind(museId: MuseId): MindView | null {
    const s = this.s(museId);
    if (!s) return null;
    const now = this.engine.now();
    return {
      museId,
      temperament: s.temperament,
      soulVersion: s.soulVersion,
      interests: [...s.interests.values()].map((i) => ({ ...i, label: topicLabel(i.topic), salienceNow: this.helpers.salienceAt(i, now) })),
      questions: [...s.questions.values()],
      relationships: [...s.social.relationships.values()].map((r) => ({ ...r, name: this.name(r.other) })),
      reflections: s.reflections,
    };
  }

  metrics(museId: MuseId): readonly MetricsRow[] {
    const s = this.s(museId);
    return s ? this.helpers.metrics(s, this.engine.log(museId)) : [];
  }

  soulMd(museId: MuseId): string | null {
    const s = this.s(museId);
    return s ? this.helpers.soulSection(s) : null;
  }

  journalMd(museId: MuseId, day: string | null): string | null {
    const s = this.s(museId);
    return s ? this.helpers.journal(s, this.engine.log(museId), day) : null;
  }
}

const ok: CommandResult = { ok: true };
const fail = (status: 400 | 403 | 404 | 409, error: string): CommandResult => ({ ok: false, status, error });

/** The write side of the HTTP API, over the engine. The clock mode decides whether wall time drives the engine. */
export class Commands implements GardenCommands {
  private mode: 'live' | 'fast-forward';
  /** The wall time at the last live tick: live mode moves the engine on by the wall time since, as it may be ahead of the wall clock after fast-forwarding. */
  private lastWall: Instant | null = null;

  constructor(
    private readonly engine: Engine,
    mode: 'live' | 'fast-forward',
  ) {
    this.mode = mode;
  }

  private known(id: MuseId): boolean {
    return this.engine.state(id) !== undefined;
  }

  async setBasketTime(museId: MuseId, hhmm: string | null): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.ownerSettings(museId, { kind: 'owner.settings', basketTime: hhmm });
    return ok;
  }

  async setHidden(museId: MuseId, ref: HiddenRef, hidden: boolean): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.ownerSettings(museId, hidden ? { kind: 'owner.settings', hide: [ref] } : { kind: 'owner.settings', unhide: [ref] });
    return ok;
  }

  async setReach(museId: MuseId, reach: Reach): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.ownerSettings(museId, { kind: 'owner.settings', reach });
    return ok;
  }

  async introduce(museId: MuseId, code: string): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    const other = this.engine.museIds().find((id) => {
      const s = this.engine.state(id);
      return s && shareCode(s) === code.trim().toUpperCase();
    });
    if (!other) return fail(404, 'no Muse has that share code');
    if (other === museId) return fail(400, 'that is your own code');
    await this.engine.introduce(museId, other, this.engine.now());
    return ok;
  }

  async unshare(museId: MuseId, other: MuseId): Promise<CommandResult> {
    if (!this.known(museId) || !this.known(other)) return fail(404, 'no such Muse');
    await this.engine.unshare(museId, other);
    return ok;
  }

  async like(museId: MuseId, target: LikeTarget, liked: boolean): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    return (await this.engine.like(museId, target, liked)) ? ok : fail(404, 'Muse has no such find or photo');
  }

  async favorite(museId: MuseId, photo: PhotoId, favorite: boolean): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    return (await this.engine.favorite(museId, photo, favorite)) ? ok : fail(404, 'Muse took no such photo');
  }

  useInvitation(museId: MuseId, id: InvitationId): Promise<CommandResult> {
    return this.engine.invitationAction(id, museId, 'use');
  }

  withdrawInvitation(museId: MuseId, id: InvitationId): Promise<CommandResult> {
    return this.engine.invitationAction(id, museId, 'withdraw');
  }

  async hostWork(museId: MuseId, state: 'started' | 'ended'): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.hostWork(museId, state);
    return ok;
  }

  async hostSoul(museId: MuseId, text: string): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.hostSoul(museId, text);
    return ok;
  }

  async hostMemory(museId: MuseId, text: string): Promise<CommandResult> {
    if (!this.known(museId)) return fail(404, 'no such Muse');
    await this.engine.hostMemory(museId, text);
    return ok;
  }

  async advance(hours: number): Promise<CommandResult> {
    if (this.mode === 'live') return fail(409, 'switch the clock to fast-forward first');
    await this.engine.advanceTo((this.engine.now() + hours * 3_600_000) as Instant);
    return ok;
  }

  setClock(mode: 'live' | 'fast-forward'): Promise<CommandResult> {
    this.mode = mode;
    this.lastWall = null;
    return Promise.resolve(ok);
  }

  clock(): { readonly mode: 'live' | 'fast-forward'; readonly now: Instant } {
    return { mode: this.mode, now: this.engine.now() };
  }

  /**
   * The live clock's tick: in live mode the engine moves on as much as the wall clock has since the last tick. The
   * first tick catches an engine that is behind up to the wall clock (a restart) and leaves one that is ahead alone.
   */
  async tick(wall: Instant): Promise<void> {
    if (this.mode !== 'live') {
      this.lastWall = null;
      return;
    }
    const last = this.lastWall;
    this.lastWall = wall;
    if (last === null) {
      if (this.engine.now() < wall) await this.engine.advanceTo(wall);
      return;
    }
    if (wall > last) await this.engine.advanceTo((this.engine.now() + (wall - last)) as Instant);
  }
}
