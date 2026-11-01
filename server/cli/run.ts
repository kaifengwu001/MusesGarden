import { readFileSync } from 'node:fs';
import type { CastFile, Discovery, Instant, InvitationState, LifePolicy, MediaKind, MuseId, MuseState, Network, RelationshipOrigin, StoredEvent, TopicKey } from '../../src/muse/contract';
import type { Engine } from '../engine/engine';
import { loadCast, readMemberDocs } from '../fixtures/cast';
import { parseWorkSchedule } from '../fixtures/work';

const H = 3_600_000;
/** The scripted guest's owner keeps an invitation for later, then travels this long after it arrived. */
const TRAVEL_AFTER_MS = 48 * H;

export interface SimOptions {
  readonly cast: string;
  readonly work: string | null;
  readonly start: Instant;
  readonly hours: number;
  /** A scripted owner who, from `from` until `until`, likes every delivered find about `topic`. */
  readonly likes?: { readonly museId: MuseId; readonly topic: TopicKey; readonly from: Instant; readonly until: Instant };
}

/**
 * Seeds the cast. The hero's real SOUL.md and MEMORY.md win over the placeholders, and a name in SOUL.md's
 * frontmatter wins over cast.json. Raw MEMORY.md is only read here and handed to the engine, which keeps topics.
 */
export async function seedCast(engine: Engine, life: LifePolicy, opts: SimOptions): Promise<CastFile> {
  const cast = loadCast(opts.cast);
  for (const m of cast.members) {
    const docs = readMemberDocs(m);
    const name = life.parseSoul(docs.soul).name ?? m.name;
    await engine.addMuse({ id: m.id, name, worldSeed: m.worldSeed, timezone: m.timezone }, docs.soul, docs.memory, opts.start);
  }
  for (const [a, b] of cast.introductions) await engine.introduce(a, b, opts.start);
  for (const { a, b, on } of cast.knownOn) await engine.connectOwners(a, b, on, opts.start);
  if (opts.work) {
    const schedule = parseWorkSchedule(JSON.parse(readFileSync(opts.work, 'utf8')));
    for (const [id, blocks] of Object.entries(schedule)) {
      if (!engine.state(id as MuseId)) continue;
      for (const b of blocks) engine.scheduleWork(id as MuseId, Date.parse(b.start) as Instant, Date.parse(b.end) as Instant);
    }
  }
  return cast;
}

/** Advances hour by hour. Each guest's owner keeps an invitation for later and uses it a couple of days on. */
export async function run(engine: Engine, opts: SimOptions): Promise<void> {
  for (let h = 1; h <= opts.hours; h++) {
    await engine.advanceTo((opts.start + h * H) as Instant);
    await travelOnKeptInvitations(engine);
    if (opts.likes) await likeFinds(engine, opts.likes);
  }
}

async function likeFinds(engine: Engine, likes: NonNullable<SimOptions['likes']>): Promise<void> {
  const s = engine.state(likes.museId);
  if (!s || engine.now() < likes.from || engine.now() >= likes.until) return;
  for (const find of s.baskets.flatMap((b) => b.items)) {
    if (!s.likes.has(find) && s.discoveries.get(find)?.topics.includes(likes.topic)) await engine.like(likes.museId, { find }, true);
  }
}

async function travelOnKeptInvitations(engine: Engine): Promise<void> {
  for (const id of engine.museIds()) {
    for (const inv of engine.state(id)?.social.invitations.values() ?? []) {
      if (inv.guest === id && inv.state === 'sent' && engine.now() - inv.sentAt >= TRAVEL_AFTER_MS) await engine.invitationAction(inv.id, id, 'use');
    }
  }
}

export interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** The plan's promises, checked against the logs rather than trusted. */
export function checks(engine: Engine, localDay: (at: Instant, tz: string) => string): Check[] {
  const out: Check[] = [];
  const all = engine.museIds().map((id) => ({ s: engine.state(id) as MuseState, log: engine.log(id) }));
  const perDay = (log: readonly StoredEvent[], tz: string, pick: (e: StoredEvent) => number) => {
    const days = new Map<string, number>();
    for (const e of log) days.set(localDay(e.event.at, tz), (days.get(localDay(e.event.at, tz)) ?? 0) + pick(e));
    return [...days.values()];
  };
  const maxOver = (f: (x: { s: MuseState; log: readonly StoredEvent[] }) => number[]) => Math.max(0, ...all.flatMap(f));

  const photos = maxOver(({ s, log }) => perDay(log, s.seed.timezone, (e) => (e.event.kind === 'photo.taken' ? 1 : 0)));
  out.push({ name: 'photos ≤ 5 a day', pass: photos <= 5, detail: `max ${photos}` });

  const baskets = maxOver(({ s, log }) => perDay(log, s.seed.timezone, (e) => (e.event.kind === 'basket.delivered' ? 1 : 0)));
  const basketItems = Math.max(0, ...all.flatMap(({ log }) => log.map((e) => (e.event.kind === 'basket.delivered' ? e.event.basket.items.length : 0))));
  out.push({ name: 'baskets ≤ 1 a day, ≤ 7 items', pass: baskets <= 1 && basketItems <= 7, detail: `max ${baskets}/day, ${basketItems} items` });

  const rest = maxOver(({ s, log }) => restHoursPerDay(log, s.seed.timezone, localDay));
  out.push({ name: 'rest ≤ 4 h a day', pass: rest <= 4 + 1e-6, detail: `max ${rest.toFixed(2)} h` });

  let movedWhileWorking = 0;
  for (const { log } of all) {
    let working = false;
    for (const e of log) {
      if (e.event.kind === 'host.work') working = e.event.state === 'started';
      if (working && (e.event.kind === 'trip.hop' || e.event.kind === 'episode.started')) movedWhileWorking++;
    }
  }
  out.push({ name: 'work happens in place (no hops or new episodes while working)', pass: movedWhileWorking === 0, detail: `${movedWhileWorking} during work` });

  const hangouts = all.flatMap(({ log }) => log.filter((e) => e.event.kind === 'hangout'));
  const withPhoto = hangouts.filter((e) => e.event.kind === 'hangout' && e.event.photo);
  const withGift = hangouts.filter((e) => e.event.kind === 'hangout' && (e.event.gave || e.event.received));
  out.push({
    name: 'every hangout has a photo, and gifts flow',
    pass: hangouts.length > 0 && withPhoto.length === hangouts.length && withGift.length > 0,
    detail: `${hangouts.length} hangouts, ${withGift.length} with a gift`,
  });

  const made = friendships(engine);
  const metBeyond = all.reduce((n, { log }) => n + log.filter((e) => e.event.kind === 'encounter' && e.event.where === 'beyond').length, 0) / 2;
  out.push({
    name: 'each path made a friend (strangers, rarer, at least met beyond)',
    pass: made.introduced > 0 && made['known-on'] > 0 && made['met-beyond'] + metBeyond > 0,
    detail: `shared ${made.introduced}, known online ${made['known-on']}, strangers ${made['met-beyond']} (${metBeyond} meetings beyond)`,
  });

  const invitations = (to: InvitationState) => new Set(all.flatMap(({ log }) => log.flatMap((e) => (e.event.kind === 'invitation' && e.event.to === to ? [e.event.id] : [])))).size;
  const [sent, used] = [invitations('sent'), invitations('used')];
  out.push({ name: 'an invitation was sent and used', pass: sent > 0 && used > 0, detail: `${sent} sent, ${used} used` });

  const reflections = all.reduce((n, { s }) => n + s.reflections.length, 0);
  out.push({ name: 'reflections committed', pass: reflections > 0, detail: `${reflections}` });

  const finds = all.flatMap(({ s }) => [...s.discoveries.values()]);
  const kinds = new Set(all.flatMap(({ s }) => delivered(s)).map((d) => d.media.kind));
  const unknown = finds.filter((d) => !KINDS.includes(d.media.kind)).length;
  out.push({
    name: 'every find is a reel, post, article or video, and baskets hold all four',
    pass: finds.length > 0 && unknown === 0 && kinds.size === KINDS.length,
    detail: `${finds.length} finds, ${unknown} without a kind; kinds in baskets: ${[...kinds].sort().join(', ')}`,
  });
  return out;
}

/** Friendships made over the run, by how they began, counted once per pair. */
export function friendships(engine: Engine): Record<RelationshipOrigin, number> {
  const out: Record<RelationshipOrigin, number> = { introduced: 0, 'known-on': 0, 'met-beyond': 0 };
  for (const id of engine.museIds()) {
    for (const { event: e } of engine.log(id)) if (e.kind === 'relationship.changed' && e.to === 'friends' && id < e.other) out[e.origin]++;
  }
  return out;
}

const KINDS: readonly MediaKind[] = ['reel', 'post', 'article', 'video'];

/** The finds a Muse has handed over in baskets. */
export function delivered(s: MuseState): Discovery[] {
  return s.baskets.flatMap((b) => b.items.flatMap((id) => s.discoveries.get(id) ?? []));
}

/** Shares of kinds and networks among `finds`, as percentages. */
export function mediaMix(finds: readonly Discovery[]): { kinds: Record<MediaKind, number>; networks: Partial<Record<Network, number>> } {
  const pct = (n: number) => Math.round((100 * n) / Math.max(1, finds.length));
  const kinds = Object.fromEntries(KINDS.map((k) => [k, pct(finds.filter((d) => d.media.kind === k).length)])) as Record<MediaKind, number>;
  const networks: Partial<Record<Network, number>> = {};
  for (const d of finds) networks[d.media.network] = (networks[d.media.network] ?? 0) + 1;
  for (const n of Object.keys(networks) as Network[]) networks[n] = pct(networks[n] ?? 0);
  return { kinds, networks };
}

/** Rest counted the way the engine counts it: each stretch to the day it ended, a pause for work ending a stretch. */
function restHoursPerDay(log: readonly StoredEvent[], tz: string, localDay: (at: Instant, tz: string) => string): number[] {
  const days = new Map<string, number>();
  let resting = false;
  let since: number | null = null;
  const count = (at: Instant) => {
    if (since === null) return;
    const d = localDay(at, tz);
    days.set(d, (days.get(d) ?? 0) + (at - since) / H);
    since = null;
  };
  for (const e of log) {
    const ev = e.event;
    if (ev.kind === 'episode.started') {
      resting = ev.plan.activity === 'rest';
      since = resting ? ev.at : null;
    }
    if (!resting) continue;
    if (ev.kind === 'episode.paused') count(ev.at);
    if (ev.kind === 'episode.resumed') since = ev.at;
    if (ev.kind === 'episode.ended') {
      count(ev.at);
      resting = false;
    }
  }
  return [...days.values()];
}
