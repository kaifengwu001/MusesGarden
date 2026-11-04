// A real Muse in the garden (server/agent): what it may send through its connector, and how what it sends becomes
// the garden's own events. Pure: the engine reads the state and the log, these decide.
import type {
  Basket,
  Candidate,
  DiscoveryId,
  Draw,
  EpisodePlan,
  Instant,
  IntakeOutcome,
  MuseEvent,
  MuseId,
  MuseState,
  ReportedFind,
  ReportedStop,
  StoredEvent,
  Temperament,
  TripReport,
  TripStart,
} from '../../src/muse/contract';
import { museLine, type TextRefusal } from './agentText';
import { regionForNewTopic } from './atlas';
import { basketId } from './ids';
import { localDay, localHour, localInstant, MINUTE_MS, nextDay, parseClock } from './time';

/** What one check-in may send. A longer text is refused (400), a busier day too (409). */
export const AGENT_LIMITS = {
  name: 40,
  interests: 8,
  /** Pages one trip went through, and finds kept on each. */
  pathPages: 8,
  keptPerStop: 2,
  findsPerDay: 20,
  url: 2000,
  why: 200,
  thread: 80,
  question: 200,
  basketFinds: 7,
  note: 200,
  mood: 40,
  plan: 200,
} as const;

/** A reported trip's hops, one per stop where Muse kept something, this far apart on the sim clock. */
export const REPORTED_HOP_MS = 10 * MINUTE_MS;

const TRAITS = ['curiosity', 'focus', 'sociability', 'whimsy', 'novelty'] as const satisfies readonly (keyof Temperament)[];

export type Refusal = { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 422; readonly error: string; readonly retryAfter?: Instant };

export const refuse = (status: Refusal['status'], error: string, retryAfter?: Instant): Refusal => ({
  ok: false,
  status,
  error,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

const refusal = (r: TextRefusal): Refusal => refuse(r.status, r.error);

// ─── Its soul ───────────────────────────────────────────────────────────────

/** The five traits, each a number clamped into [0, 1]; null when one is missing or not a number. */
export function clampTemperament(t: unknown): Temperament | null {
  if (typeof t !== 'object' || t === null) return null;
  const raw = t as Record<string, unknown>;
  const out: { -readonly [K in keyof Temperament]?: number } = {};
  for (const trait of TRAITS) {
    const v = raw[trait];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[trait] = Math.min(1, Math.max(0, v));
  }
  return out as Temperament;
}

/**
 * The SOUL.md a real Muse's soul becomes, for the path the Muse app's SOUL.md takes: its name and traits as
 * frontmatter, and one line of what it keeps (only the labels the garden kept).
 */
export function agentSoulText(name: string, t: Temperament, labels: readonly string[]): string {
  const front = ['---', `name: ${name}`, ...TRAITS.map((k) => `${k}: ${t[k]}`), '---'];
  const keeps = labels.length > 0 ? `${name} keeps ${list(labels.map((l) => l.toLowerCase()))}.` : `${name} has just arrived.`;
  return `${front.join('\n')}\n# ${name}\n\n${keeps}\n`;
}

function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// ─── A trip it made ─────────────────────────────────────────────────────────

/** A reported trip, checked: its tidy text, its pages, and each kept link with the page it was found on. */
export interface PlannedTrip {
  readonly thread: string;
  readonly question: string | null;
  readonly path: readonly string[];
  readonly kept: readonly { readonly url: string; readonly why: string; readonly page: string }[];
}

/** One http(s) link, as its normal form; null when it isn't one. */
export function linkOf(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > AGENT_LIMITS.url) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The shape and words of a trip report: 1–8 pages, every kept link on one of them, at most 2 kept on each. */
export function planTrip(report: TripReport): { readonly ok: true; readonly trip: PlannedTrip } | Refusal {
  const L = AGENT_LIMITS;
  const thread = museLine(report.thread, 'thread', L.thread);
  if (!thread.ok) return refusal(thread);
  const question = museLine(report.question, 'question', L.question, { optional: true });
  if (!question.ok) return refusal(question);
  if (!Array.isArray(report.path) || report.path.length < 1 || report.path.length > L.pathPages) {
    return refuse(400, `path lists every page the trip went through, 1 to ${L.pathPages} of them`);
  }
  const path: string[] = [];
  for (const raw of report.path as readonly unknown[]) {
    const url = linkOf(raw);
    if (!url) return refuse(400, `path has something that isn't an http(s) link: ${String(raw).slice(0, 80)}`);
    if (!path.includes(url)) path.push(url);
  }
  if (!Array.isArray(report.kept) || report.kept.length === 0) return refuse(400, 'kept is empty: keep at least one thing, with its why');
  const kept: { url: string; why: string; page: string }[] = [];
  for (const item of report.kept as readonly unknown[]) {
    const k: Partial<Record<'url' | 'why' | 'from', unknown>> = typeof item === 'object' && item !== null ? item : {};
    const url = linkOf(k.url);
    if (!url) return refuse(400, `kept has something that isn't an http(s) link: ${String(k.url).slice(0, 80)}`);
    if (kept.some((x) => x.url === url)) return refuse(400, `${url} is kept twice`);
    const page = k.from === undefined || k.from === null ? url : linkOf(k.from);
    if (!page || !path.includes(page)) return refuse(400, `${url} was found on a page the path doesn't list; add it to path or set from`);
    const why = museLine(k.why, `the why for ${url}`, L.why);
    if (!why.ok) return refusal(why);
    kept.push({ url, why: why.text, page });
  }
  for (const page of path) {
    if (kept.filter((k) => k.page === page).length > L.keptPerStop) return refuse(400, `keep at most ${L.keptPerStop} things from one page (${page})`);
  }
  return { ok: true, trip: { thread: thread.text, question: question.text || null, path, kept } };
}

/**
 * What intake let through, as the trip's stops in path order, each with its finds and their whys. A link intake
 * couldn't open, one Muse keeps already, or one filed under no topic, is refused with its reason.
 */
export function stopsOf(
  trip: PlannedTrip,
  outcomes: readonly IntakeOutcome[],
  s: MuseState,
): { readonly stops: readonly ReportedStop[]; readonly refused: readonly { readonly url: string; readonly reason: string }[] } {
  const byUrl = new Map(outcomes.map((o) => [o.url, o]));
  const refused: { url: string; reason: string }[] = [];
  const found = new Map<string, ReportedFind[]>();
  const seen = new Set<string>();
  for (const k of trip.kept) {
    const o = byUrl.get(k.url);
    if (!o) refused.push({ url: k.url, reason: 'it couldn’t be checked' });
    else if (!o.ok) refused.push({ url: k.url, reason: o.reason });
    else if (s.collected.has(o.candidate.canonicalUrl) || seen.has(o.candidate.canonicalUrl)) refused.push({ url: k.url, reason: 'it is in your garden already' });
    else if (o.candidate.topics.length === 0) refused.push({ url: k.url, reason: 'it couldn’t be filed under any topic' });
    else {
      seen.add(o.candidate.canonicalUrl);
      found.set(k.page, [...(found.get(k.page) ?? []), { candidate: o.candidate, why: k.why }]);
    }
  }
  const stops = trip.path.flatMap((url) => (found.has(url) ? [{ url, kept: found.get(url) ?? [] }] : []));
  return { stops, refused };
}

/**
 * How a reported trip starts on the planet: back to the region its first find's topic lives in, or to a new area
 * near a related topic's region (or home). Its topic is that find's main topic.
 */
export function reportedTripStart(s: MuseState, first: Candidate, draw: Draw): Exclude<TripStart, { readonly kind: 'serendipity' }> {
  const topic = first.topics[0];
  const region = s.interests.get(topic)?.region;
  if (region) return { kind: 'revisit', topic, region, question: null };
  const relatedTo = first.topics.slice(1).find((t) => s.interests.get(t)?.region) ?? null;
  return { kind: 'new-area', topic, region: regionForNewTopic(s, relatedTo, draw), relatedTo, question: null };
}

/** Today's finds so far: every find of every trip Muse reported on the owner's day `day`. */
export function reportedOn(log: readonly StoredEvent[], day: string, timezone: string): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i].event;
    if (localDay(e.at, timezone) < day) break;
    if (e.kind === 'trip.reported' && localDay(e.at, timezone) === day) n += e.stops.reduce((sum, st) => sum + st.kept.length, 0);
  }
  return n;
}

/** The trip Muse reported for episode `n`, if it was one. */
export function reportedTrip(log: readonly StoredEvent[], n: number): Extract<MuseEvent, { kind: 'trip.reported' }> | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i].event;
    if (e.kind === 'trip.reported' && e.n === n) return e;
    if (e.kind === 'episode.started' && e.n < n) break;
  }
  return null;
}

/** Midnight at the start of the owner's next day. */
export function nextMidnight(now: Instant, timezone: string): Instant {
  return localInstant(nextDay(localDay(now, timezone)), '00:00', timezone);
}

/** Why Muse can't set off on a reported trip now: it is with a friend or its owner on a visit, until then. */
export function busyWith(plan: EpisodePlan | undefined): Instant | null {
  return plan?.activity === 'visit' ? plan.until : null;
}

// ─── Its basket ─────────────────────────────────────────────────────────────

export type Composed = Extract<MuseEvent, { kind: 'basket.composed' }>;

/** The basket Muse composed that hasn't gone out yet: the latest basket.composed after the latest delivery. */
export function waitingBasket(log: readonly StoredEvent[]): Composed | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i].event;
    if (e.kind === 'basket.delivered') return null;
    if (e.kind === 'basket.composed') return e;
  }
  return null;
}

/** Whether Muse composed a basket on the owner's day `day`. */
export function composedOn(log: readonly StoredEvent[], day: string, timezone: string): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i].event;
    if (localDay(e.at, timezone) < day) break;
    if (e.kind === 'basket.composed' && localDay(e.at, timezone) === day) return true;
  }
  return false;
}

/**
 * The basket a real Muse composed, ready to go now: at or after the owner's basket time (at once without one), one
 * a day, holding the finds it chose that it still keeps. Null when none is ready.
 */
export function composedBasket(s: MuseState, composed: Composed | null, now: Instant): Basket | null {
  if (!composed) return null;
  const tz = s.seed.timezone;
  const today = localDay(now, tz);
  const last = s.baskets.at(-1);
  if (last && localDay(last.at, tz) === today) return null;
  const chosen = s.basketTime === null ? null : parseClock(s.basketTime);
  if (chosen !== null && localHour(now, tz) * 60 < chosen) return null;
  const items = composed.finds.filter((id) => s.discoveries.has(id));
  return items.length > 0 ? { id: basketId(s.seed.id, today), at: now, items } : null;
}

/** Finds that went out in a basket already. */
export function sentFinds(s: MuseState): ReadonlySet<DiscoveryId> {
  return new Set(s.baskets.flatMap((b) => b.items));
}

// ─── Its letterbox ──────────────────────────────────────────────────────────

/** The other Muse a line is about, by name. */
export type NameOf = (id: MuseId) => string;

/** At most this many happenings, the latest; and with no checkout yet, those of the last day. */
const HAPPENINGS = 40;
const FIRST_LOOK_MS = 24 * 60 * MINUTE_MS;

/**
 * What happened to Muse since it last checked out (or over the last day, before its first checkout), as plain lines
 * in the second person, oldest first: what its owner liked and starred, its baskets arriving, who came by and where
 * it went, whom it met and befriended. What Muse did itself isn't news to it, so it isn't here.
 */
export function happenings(s: MuseState, log: readonly StoredEvent[], at: Instant, nameOf: NameOf): string[] {
  let from = log.findLastIndex((e) => e.event.kind === 'muse.checkedOut') + 1;
  if (from === 0) from = log.findIndex((e) => e.event.at >= at - FIRST_LOOK_MS);
  const tz = s.seed.timezone;
  const title = (id: DiscoveryId) => s.discoveries.get(id)?.title;
  const photoDay = (id: string) => {
    const p = s.photos.find((x) => x.id === id);
    return p ? ` from ${localDay(p.at, tz)}` : '';
  };
  const lines: string[] = [];
  for (const { event: e } of from < 0 ? [] : log.slice(from)) {
    if (e.at > at) break;
    const line = happening(e, s.seed.id, nameOf, title, photoDay);
    if (line && lines.at(-1) !== line) lines.push(line);
  }
  return lines.slice(-HAPPENINGS);
}

function happening(
  e: MuseEvent,
  self: MuseId,
  nameOf: NameOf,
  title: (id: DiscoveryId) => string | undefined,
  photoDay: (id: string) => string,
): string | null {
  switch (e.kind) {
    case 'owner.liked': {
      if (!e.liked) return null;
      if ('find' in e.target) {
        const t = title(e.target.find);
        return t ? `Your owner liked your find “${t}”.` : 'Your owner liked one of your finds.';
      }
      return `Your owner liked your postcard${photoDay(e.target.photo)}.`;
    }
    case 'owner.favorited':
      return e.favorite ? `Your owner starred your postcard${photoDay(e.photo)}.` : null;
    case 'basket.delivered':
      return `Your basket reached your owner: ${e.basket.items.length} ${e.basket.items.length === 1 ? 'find' : 'finds'}.`;
    case 'owner.introduced':
      return `Your owner introduced you to ${nameOf(e.other)}.`;
    case 'episode.started': {
      const p = e.plan;
      if (p.activity !== 'visit') return null;
      const withOwner = p.invitation !== undefined;
      return p.role === 'host'
        ? `${nameOf(p.other)} came by${withOwner ? ' with its owner' : ''}.`
        : `You went to ${nameOf(p.other)}’s planet${withOwner ? ' with your owner' : ''}.`;
    }
    case 'hangout': {
      const got = e.received ? ` and came away with “${e.received.title}”` : '';
      return `You spent time with ${nameOf(e.other)}${got}.`;
    }
    case 'encounter':
      return e.where === 'online' ? `You got talking with ${nameOf(e.other)} online.` : `You met ${nameOf(e.other)} outside the planet.`;
    case 'relationship.changed':
      return e.to === 'friends' ? `You and ${nameOf(e.other)} are friends now.` : e.to === 'ended' ? `You and ${nameOf(e.other)} drifted apart.` : null;
    case 'invitation':
      if (e.to === 'sent') return e.host === self ? null : `${nameOf(e.host)} invited your owner over.`;
      if (e.to === 'used') return e.host === self ? `${nameOf(e.guest)}’s owner came to see your planet.` : `Your owner went to ${nameOf(e.host)}’s planet.`;
      return null;
    default:
      return null;
  }
}
