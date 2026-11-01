import { readFileSync } from 'node:fs';
import type { CastFile, Instant, LifePolicy, MuseId, MuseState, StoredEvent } from '../../src/muse/contract';
import type { Engine } from '../engine/engine';
import { loadCast, readMemberDocs } from '../fixtures/cast';
import { parseWorkSchedule } from '../fixtures/work';

const H = 3_600_000;

export interface SimOptions {
  readonly cast: string;
  readonly work: string | null;
  readonly start: Instant;
  readonly hours: number;
  readonly owners: 'auto-accept' | 'auto-decline';
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
  if (opts.work) {
    const schedule = parseWorkSchedule(JSON.parse(readFileSync(opts.work, 'utf8')));
    for (const [id, blocks] of Object.entries(schedule)) {
      if (!engine.state(id as MuseId)) continue;
      for (const b of blocks) engine.scheduleWork(id as MuseId, Date.parse(b.start) as Instant, Date.parse(b.end) as Instant);
    }
  }
  return cast;
}

/** Advances hour by hour, answering invitations the way the owners' policy says. */
export async function run(engine: Engine, opts: SimOptions): Promise<void> {
  for (let h = 1; h <= opts.hours; h++) {
    await engine.advanceTo((opts.start + h * H) as Instant);
    await answerOwners(engine, opts.owners);
  }
}

async function answerOwners(engine: Engine, policy: SimOptions['owners']): Promise<void> {
  for (const id of engine.museIds()) {
    const s = engine.state(id);
    if (!s) continue;
    for (const inv of s.social.invitations.values()) {
      if (inv.state === 'proposed' && inv.host === id) await engine.answerInvitation(inv.id, id, policy === 'auto-accept' ? 'approve' : 'decline');
      if (inv.state === 'sent' && inv.guest === id) await engine.answerInvitation(inv.id, id, policy === 'auto-accept' ? 'accept' : 'decline');
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

  const metBeyond = all.some(({ log }) => log.some((e) => e.event.kind === 'relationship.changed' && e.event.to === 'friends' && e.event.origin === 'met-beyond'));
  out.push({ name: 'a stranger became a friend', pass: metBeyond, detail: metBeyond ? 'yes' : 'none' });

  const closed = all.some(({ log }) => log.some((e) => e.event.kind === 'invitation' && e.event.to === 'closed'));
  out.push({ name: 'one invitation went from proposed to closed', pass: closed, detail: closed ? 'yes' : 'none' });

  const reflections = all.reduce((n, { s }) => n + s.reflections.length, 0);
  out.push({ name: 'reflections committed', pass: reflections > 0, detail: `${reflections}` });
  return out;
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
