// A real Muse's connector on the engine (server/agent serves it as MCP tools and REST). Each command checks what
// Muse sent, does any slow work (the link checks) before it queues, and then commits through the engine's queue,
// where its state is checked again. The queries read its letterbox and the planets' guidebooks.
import { createHash } from 'node:crypto';
import type {
  AgentCommands,
  AgentQueries,
  AgentResult,
  AgentSoul,
  Discovery,
  DiscoveryId,
  Doodle,
  Guidebook,
  Instant,
  Intake,
  IntakeOutcome,
  Interest,
  Letterbox,
  MuseId,
  MuseLook,
  MuseState,
  PhotoId,
  PlanetId,
  PostcardBack,
  PostcardWords,
  SocialPolicy,
  StoredEvent,
  TopicKey,
  TripReceipt,
  TripReport,
} from '../../src/muse/contract';
import { isPlanetId, planetOf } from '../../src/muse/planets';
import { parsePostcard } from '../adapters/minds/prompts/postcard';
import {
  AGENT_LIMITS,
  agentSoulText,
  busyWith,
  clampTemperament,
  composedOn,
  happenings,
  nextMidnight,
  planTrip,
  refuse,
  REPORTED_HOP_MS,
  reportedOn,
  reportedTrip,
  sentFinds,
  stopsOf,
  waitingBasket,
  type Refusal,
} from '../domain/agent';
import { instructionLike, museLine } from '../domain/agentText';
import { nextBasketCheck } from '../domain/policy/basket';
import { kindsFor, planOf } from '../domain/policy/postcard';
import { tooClose, wordsOf } from '../domain/postcardWords';
import { personalFact, privacyFilterIn } from '../domain/privacy';
import { localDay } from '../domain/time';
import type { AgentCheck, Engine } from './engine';
import { topicLabel, waitingPostcards } from './garden';
import type { Views } from './views';

export interface AgentOptions {
  /** Opens each kept link logged out and files it (server/agent/intake.ts). */
  readonly intake: Intake;
  /** How long one report's link checks may take; a link still unanswered then is refused. */
  readonly intakeMs?: number;
  /** An interest's salience at a time (server/domain/interests.ts). */
  readonly salienceAt: (i: Interest, at: Instant) => number;
}

/** The intake until the real one is wired: it opens nothing, so every link is refused. */
export const refuseEveryLink: Intake = (urls) => Promise.resolve(urls.map((url) => ({ ok: false, url, reason: 'link checks aren’t wired' })));

const INTAKE_MS = 30_000;
/** Interests intake may file a link under when the topic map has no better topic: Muse's strongest. */
const INTAKE_INTERESTS = 12;
const LOOK = /^(?:tpose6|muse(?:1[0-2]|[0-9])|gen-[a-z0-9][a-z0-9-]*)$/;
const MUSE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DOODLES: ReadonlySet<string> = new Set<Doodle>(['sun', 'cloud', 'rain', 'muse', 'laptop', 'flower', 'bird', 'fish', 'house', 'planet', 'heart', 'leaf', 'boat', 'stars']);
const NEUTRAL = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 } as const;

const isLook = (v: unknown): v is MuseLook => typeof v === 'string' && LOOK.test(v);

function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A refusal for a Muse that isn't a real one, or isn't here; null for a real Muse. */
function notAgent(s: MuseState | undefined): Refusal | null {
  if (!s) return refuse(404, 'no such Muse');
  return s.agent ? null : refuse(403, 'this Muse isn’t a real one (it has no connector)');
}

const agentOnly: AgentCheck = (s) => notAgent(s);

export class AgentApi implements AgentCommands, AgentQueries {
  constructor(
    private readonly engine: Engine,
    private readonly views: Views,
    private readonly social: SocialPolicy,
    private readonly opts: AgentOptions,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────────

  isAgent(museId: MuseId): boolean {
    return this.engine.state(museId)?.agent === true;
  }

  letterbox(museId: MuseId, at: Instant): Letterbox | null {
    const s = this.engine.state(museId);
    const input = this.views.gardenInput(museId, at);
    if (!s || !input) return null;
    const log = this.engine.log(museId);
    const tz = s.seed.timezone;
    const today = localDay(at, tz);
    const { planet, look } = this.views.member(museId);
    const last = s.baskets.at(-1);
    return {
      museId,
      name: s.seed.name,
      at,
      since: s.lastCheckout?.at ?? null,
      planet: { id: planet, name: s.planet?.name ?? planetOf(planet).title, growth: this.views.growth(s), regions: s.regions.size },
      look,
      interests: strongest(s, at, this.opts.salienceAt).map((i) => ({ topic: topicLabel(i.topic), stage: i.stage })),
      happenings: happenings(s, log, at, (id) => this.engine.state(id)?.seed.name ?? 'a friend'),
      postcards: waitingPostcards(input),
      allowances: {
        findsLeft: Math.max(0, AGENT_LIMITS.findsPerDay - reportedOn(log, today, tz)),
        photosLeft: Math.max(0, this.social.photoSlotsLeft(s, at)),
        basketSentToday: composedOn(log, today, tz) || (last !== undefined && localDay(last.at, tz) === today),
      },
      lastCheckout: s.lastCheckout ?? null,
    };
  }

  guidebook(museId: MuseId, requester: MuseId, at: Instant): Guidebook | null | 'forbidden' {
    const host = this.engine.state(museId);
    if (!host) return null;
    const own = museId === requester;
    if (!own && !this.visiting(requester, museId, at)) return 'forbidden';
    const shared = own ? null : this.social.publicProfile(host);
    const publicTopics = shared ? new Set(shared.interests.map((i) => i.topic)) : null;
    const finds: Discovery[] = own
      ? [...host.discoveries.values()].sort((a, b) => b.at - a.at)
      : (shared?.discoveries ?? []).flatMap((d) => host.discoveries.get(d.id) ?? []);
    const { planet } = this.views.member(museId);
    return {
      museId,
      name: host.seed.name,
      planet: { id: planet, name: host.planet?.name ?? planetOf(planet).title },
      regions: [...host.regions].map(([region, topics]) => ({
        region,
        topics: topics.filter((t) => !publicTopics || publicTopics.has(t)).map(topicLabel),
      })),
      finds: finds.map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        why: d.reason,
        topic: topicLabel(d.pursuing ?? d.topics[0] ?? (d.title as TopicKey)),
        picture: d.media.image ?? null,
      })),
    };
  }

  /**
   * Whether `requester` is on `host`'s planet at `at`: its Muse there as a guest, or its owner on a ticket to it whose
   * visit is still open (the visit access the garden's visit page checks).
   */
  private visiting(requester: MuseId, host: MuseId, at: Instant): boolean {
    const r = this.engine.state(requester);
    if (!r) return false;
    const plan = r.episode?.plan;
    if (plan?.activity === 'visit' && plan.role === 'guest' && plan.other === host && at < plan.until) return true;
    return [...r.social.invitations.values()].some((inv) => {
      const until = this.social.visitUntil(inv, requester);
      return inv.host === host && until !== null && at < until;
    });
  }

  // ─── Commands ───────────────────────────────────────────────────────────

  async addAgentMuse(
    museId: MuseId,
    opts: { readonly name: string; readonly planet: PlanetId; readonly look: MuseLook; readonly worldSeed: number; readonly timezone: string },
  ): Promise<AgentResult<{ readonly added: boolean }>> {
    if (typeof museId !== 'string' || !MUSE_ID.test(museId)) return refuse(400, 'a Muse id is lowercase letters, digits and hyphens, at most 40');
    const known = this.engine.state(museId);
    if (!known) {
      const name = museLine(opts.name, 'name', AGENT_LIMITS.name);
      if (!name.ok) return name;
      if (!isPlanetId(opts.planet)) return refuse(400, `no such planet: ${String(opts.planet)}`);
      if (!isLook(opts.look)) return refuse(400, `no such look: ${String(opts.look)}`);
      if (!Number.isSafeInteger(opts.worldSeed) || opts.worldSeed < 0) return refuse(400, 'worldSeed is a whole number, 0 or more');
      if (!validZone(opts.timezone)) return refuse(400, `no such timezone: ${String(opts.timezone)}`);
      const seed = { id: museId, name: name.text, worldSeed: opts.worldSeed, timezone: opts.timezone };
      const made = { look: opts.look, planet: opts.planet, planetName: planetOf(opts.planet).title };
      const value = await this.engine.addAgent(seed, made, agentSoulText(name.text, NEUTRAL, []));
      return { ok: true, value };
    }
    const value = await this.engine.addAgent(known.seed, { look: opts.look, planet: opts.planet, planetName: planetOf(opts.planet).title }, '');
    return { ok: true, value };
  }

  async agentSoul(museId: MuseId, soul: AgentSoul): Promise<AgentResult<{ readonly topics: readonly string[]; readonly dropped: readonly string[] }>> {
    const refused = notAgent(this.engine.state(museId));
    if (refused) return refused;
    if (typeof soul !== 'object' || soul === null) return refuse(400, 'a soul has a name, interests and a temperament');
    const name = museLine(soul.name, 'name', AGENT_LIMITS.name);
    if (!name.ok) return name;
    const temperament = clampTemperament(soul.temperament);
    if (!temperament) return refuse(400, 'temperament needs curiosity, focus, sociability, whimsy and novelty, each a number from 0 to 1');
    if (!Array.isArray(soul.interests) || soul.interests.length > AGENT_LIMITS.interests) {
      return refuse(400, `interests is a list of at most ${AGENT_LIMITS.interests} topics`);
    }
    const labels: string[] = [];
    for (const raw of soul.interests as unknown[]) {
      if (typeof raw !== 'string') return refuse(400, 'each interest is a short topic, as text');
      const label = raw.replace(/\s+/g, ' ').trim();
      if (label.length > 60) return refuse(400, `“${label.slice(0, 40)}…” is long for a topic; keep each to 60 characters`);
      if (label && !labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
    }
    // Each label on a line of its own: a label that names someone or something private is dropped, as Memory's are.
    const passed = privacyFilterIn(labels, labels.join('\n')).filter((l) => !instructionLike(l) && !personalFact(l));
    const kept: { label: string; topic: TopicKey }[] = [];
    for (const label of passed) {
      const topic = await this.engine.resolveTopic(label);
      if (topic && !kept.some((k) => k.topic === topic)) kept.push({ label, topic });
    }
    const keptLabels = new Set(kept.map((k) => k.label));
    const text = agentSoulText(name.text, temperament, kept.map((k) => k.label));
    const hash = createHash('sha256').update(labels.join('\n')).digest('hex');
    const r = await this.engine.agentSoul(museId, text, kept.map((k) => k.topic), hash, agentOnly);
    if (!r.ok) return r;
    return { ok: true, value: { topics: kept.map((k) => topicLabel(k.topic)), dropped: labels.filter((l) => !keptLabels.has(l)) } };
  }

  async agentTrip(museId: MuseId, report: TripReport): Promise<AgentResult<TripReceipt>> {
    const s = this.engine.state(museId);
    const refused = notAgent(s);
    if (refused || !s) return refused ?? refuse(404, 'no such Muse');
    const planned = planTrip(report);
    if (!planned.ok) return planned;
    const { trip } = planned;
    const early = this.tripRefusal(s, this.engine.log(museId), trip.kept.length);
    if (early) return early;
    const urls = trip.kept.map((k) => k.url);
    const outcomes = await this.checkLinks(urls, s, trip.thread);
    const { stops, refused: dropped } = stopsOf(trip, outcomes, this.engine.state(museId) ?? s);
    const planted = stops.reduce((n, st) => n + st.kept.length, 0);
    if (planted === 0) {
      return refuse(422, `nothing could be planted: ${dropped.map((d) => `${d.url} (${d.reason})`).join('; ')}`);
    }
    const r = await this.engine.reportTrip(
      museId,
      { thread: trip.thread, path: trip.path, stops, question: trip.question },
      (now, log) => notAgent(now) ?? this.tripRefusal(now, log(), planted),
    );
    if (!r.ok) return r;
    return { ok: true, value: { trip: r.value.trip, planted, refused: dropped, doneAt: r.value.doneAt } };
  }

  /** Why a trip of `finds` finds can't be reported now: today's finds are used up, or Muse is busy until then. */
  private tripRefusal(s: MuseState, log: readonly StoredEvent[], finds: number): Refusal | null {
    const tz = s.seed.timezone;
    const now = this.engine.now();
    const left = AGENT_LIMITS.findsPerDay - reportedOn(log, localDay(now, tz), tz);
    if (finds > left) {
      const say = left <= 0 ? 'today’s finds are all planted' : `only ${left} more ${left === 1 ? 'find' : 'finds'} can be planted today`;
      return refuse(409, `${say} (${AGENT_LIMITS.findsPerDay} a day); try again tomorrow`, nextMidnight(now, tz));
    }
    const visit = busyWith(s.episode?.plan);
    if (visit !== null) return refuse(409, 'you are with a friend or your owner on a visit; report the trip once it is over', visit);
    const ep = s.episode;
    const planting = ep?.plan.activity === 'travel' ? reportedTrip(log, ep.n) : null;
    if (ep && planting) {
      const until = ep.pausedAt === null ? ((ep.start + planting.stops.length * REPORTED_HOP_MS) as Instant) : undefined;
      return refuse(409, 'your last trip is still being planted; report this one when it is done', until);
    }
    return null;
  }

  /** Intake on `urls`, outside the queue, cut off after intakeMs; it never throws, and every link gets an outcome. */
  private async checkLinks(urls: readonly string[], s: MuseState, thread: string): Promise<readonly IntakeOutcome[]> {
    const interests = strongest(s, this.engine.now(), this.opts.salienceAt)
      .slice(0, INTAKE_INTERESTS)
      .map((i) => i.topic);
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<readonly IntakeOutcome[]>((done) => {
      timer = setTimeout(() => {
        stop.abort();
        done([]);
      }, this.opts.intakeMs ?? INTAKE_MS);
    });
    try {
      const outcomes = await Promise.race([this.opts.intake(urls, { interests, thread, signal: stop.signal }), late]);
      const byUrl = new Map(outcomes.map((o) => [o.url, o]));
      return urls.map((url) => byUrl.get(url) ?? { ok: false, url, reason: 'checking the link took too long' });
    } catch {
      return urls.map((url) => ({ ok: false, url, reason: 'the link couldn’t be checked' }));
    } finally {
      clearTimeout(timer);
    }
  }

  async agentPostcardBack(museId: MuseId, photo: PhotoId, words: PostcardWords): Promise<AgentResult<{ readonly written: PhotoId }>> {
    const s = this.engine.state(museId);
    const refused = notAgent(s);
    if (refused || !s) return refused ?? refuse(404, 'no such Muse');
    const spec = s.photos.find((p) => p.id === photo);
    if (!spec) return refuse(404, 'you took no such photo');
    const kinds = kindsFor(spec);
    const kind = (words as { kind?: unknown } | null)?.kind;
    if (typeof kind !== 'string' || !kinds.includes(kind as PostcardBack['kind'])) {
      return refuse(400, `this photo’s back can be: ${kinds.join(', ')}`);
    }
    const parsed = parsePostcard(words, kind as PostcardBack['kind']);
    if (!parsed) return refuse(400, `those words don’t fit a ${kind} back: check its parts and keep each short`);
    const said = wordsOf(parsed);
    const why = instructionLike(said) ?? personalFact(said);
    if (why) return refuse(422, `the postcard was refused: ${why}. Write it again in your own words, without that.`);
    if (tooClose(said, s.recentWords)) return refuse(422, 'you wrote nearly the same on a recent postcard; say something new');
    const plan = planOf(parsed.kind, s, spec, this.engine.draw(museId, 0));
    const doodle = (words as { doodle?: unknown }).doodle;
    const chosen = plan.kind === 'doodle' && typeof doodle === 'string' && DOODLES.has(doodle) ? { doodle: doodle as Doodle } : {};
    const back = { ...plan, ...chosen, ...parsed, kind: plan.kind } as PostcardBack;
    if (back.kind !== parsed.kind) return refuse(400, `this photo’s back can be: ${kinds.join(', ')}`);
    const r = await this.engine.writeBack(museId, photo, back, (now, log) => notAgent(now) ?? (written(log(), photo) ? refuse(409, 'that postcard’s back is written already') : null));
    return r.ok ? { ok: true, value: { written: photo } } : r;
  }

  async agentBasket(museId: MuseId, finds: readonly DiscoveryId[], note: string): Promise<AgentResult<{ readonly sendAfter: Instant }>> {
    const s = this.engine.state(museId);
    const refused = notAgent(s);
    if (refused || !s) return refused ?? refuse(404, 'no such Muse');
    if (!Array.isArray(finds) || finds.length === 0 || finds.length > AGENT_LIMITS.basketFinds) {
      return refuse(400, `a basket holds 1 to ${AGENT_LIMITS.basketFinds} finds`);
    }
    if (new Set(finds).size !== finds.length) return refuse(400, 'a find is in the basket twice');
    const words = museLine(note, 'note', AGENT_LIMITS.note, { optional: true });
    if (!words.ok) return words;
    const r = await this.engine.composeBasket(museId, finds, words.text, (now, log) => notAgent(now) ?? this.basketRefusal(now, log(), finds));
    if (!r.ok) return r;
    const after = this.engine.state(museId) ?? s;
    const sendAfter = after.baskets.at(-1)?.at === r.value.at ? r.value.at : (nextBasketCheck(after, r.value.at) ?? r.value.at);
    return { ok: true, value: { sendAfter } };
  }

  /** Why these finds can't go in a basket now: not Muse's, sent already, or today's basket is chosen or gone. */
  private basketRefusal(s: MuseState, log: readonly StoredEvent[], finds: readonly DiscoveryId[]): Refusal | null {
    const missing = finds.find((id) => !s.discoveries.has(id));
    if (missing) return refuse(404, `you keep no find ${missing}`);
    const sent = sentFinds(s);
    const again = finds.find((id) => sent.has(id));
    if (again) return refuse(409, `${s.discoveries.get(again)?.title ?? again} went out in a basket already`);
    const tz = s.seed.timezone;
    const now = this.engine.now();
    const today = localDay(now, tz);
    const tomorrow = nextMidnight(now, tz);
    if (waitingBasket(log)) return refuse(409, 'a basket you chose is still waiting to go out', nextBasketCheck(s, now) ?? tomorrow);
    if (composedOn(log, today, tz)) return refuse(409, 'you chose today’s basket already; one a day', tomorrow);
    const last = s.baskets.at(-1);
    if (s.basketTime === null && last && localDay(last.at, tz) === today) return refuse(409, 'today’s basket has gone out; one a day', tomorrow);
    return null;
  }

  async agentCheckout(museId: MuseId, mood: string, plan: string): Promise<AgentResult<{ readonly at: Instant }>> {
    const refused = notAgent(this.engine.state(museId));
    if (refused) return refused;
    const m = museLine(mood, 'mood', AGENT_LIMITS.mood);
    if (!m.ok) return m;
    const p = museLine(plan, 'plan', AGENT_LIMITS.plan, { optional: true });
    if (!p.ok) return p;
    return this.engine.agentEvent(museId, { kind: 'muse.checkedOut', mood: m.text, plan: p.text }, 'muse', agentOnly);
  }

  async applyLook(museId: MuseId, look: MuseLook): Promise<AgentResult<{ readonly look: MuseLook }>> {
    if (!isLook(look)) return refuse(400, `no such look: ${String(look)}`);
    const r = await this.engine.agentEvent(museId, { kind: 'look.changed', look }, 'garden', agentOnly);
    return r.ok ? { ok: true, value: { look } } : r;
  }

  async applyPlanet(museId: MuseId, planet: PlanetId, worldSeed: number, name: string): Promise<AgentResult<{ readonly planet: PlanetId }>> {
    if (!isPlanetId(planet)) return refuse(400, `no such planet: ${String(planet)}`);
    if (!Number.isSafeInteger(worldSeed) || worldSeed < 0) return refuse(400, 'worldSeed is a whole number, 0 or more');
    const n = museLine(name, 'name', AGENT_LIMITS.name);
    if (!n.ok) return n;
    const r = await this.engine.agentEvent(museId, { kind: 'planet.changed', planet, worldSeed, name: n.text }, 'garden', agentOnly);
    return r.ok ? { ok: true, value: { planet } } : r;
  }
}

/** Whether the log has the back of `photo` written. */
function written(log: readonly StoredEvent[], photo: PhotoId): boolean {
  return log.some((e) => e.event.kind === 'photo.written' && e.event.photo === photo);
}

/** Muse's twelve strongest interests, by affinity plus salience at `at`. */
function strongest(s: MuseState, at: Instant, salienceAt: (i: Interest, at: Instant) => number): Interest[] {
  const weight = (i: Interest) => i.affinity + salienceAt(i, at);
  return [...s.interests.values()].sort((a, b) => weight(b) - weight(a)).slice(0, 12);
}
