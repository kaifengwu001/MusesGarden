import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EpisodePlan, Instant, InvitationId, MuseEventBody, MuseId, MuseSeed, Reach, RegionKey, ScheduleItem, SocialPolicy, StoredEvent, TopicKey } from '../../src/muse/contract';
import { openSqliteStore } from '../adapters/store/sqlite';
import { socialPolicy } from '../domain/social/policy';
import { reduceSocial } from '../domain/social/state';
import { Engine } from './engine';
import { memoryStore, stubDeps } from './testing/stubs';

const T0 = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const H = 3_600_000;
const at = (hours: number) => (T0 + hours * H) as Instant;

const seed = (id: string): MuseSeed => ({ id: id as MuseId, name: id, worldSeed: 1, timezone: 'America/Los_Angeles' });

async function world(ids: readonly string[], opts: { introduce?: boolean; work?: [string, number, number][] } = {}) {
  const store = memoryStore();
  const engine = new Engine(stubDeps(store), T0);
  for (const id of ids) await engine.addMuse(seed(id), `I am ${id}.`, '', T0);
  if (opts.introduce) await engine.introduce(ids[0] as MuseId, ids[1] as MuseId, T0);
  for (const [id, from, to] of opts.work ?? []) engine.scheduleWork(id as MuseId, at(from), at(to));
  return { store, engine };
}

const kinds = (log: readonly StoredEvent[]) => log.map((e) => e.event.kind);

/** What the log says the Muse was doing just before `t`: an activity, 'paused' for work, or null between episodes. */
function activityBefore(log: readonly StoredEvent[], t: number): string | null {
  let activity: string | null = null;
  let running: string | null = null;
  for (const { event: e } of log) {
    if (e.at >= t) break;
    if (e.kind === 'episode.started') activity = running = e.plan.activity;
    if (e.kind === 'episode.ended') activity = running = null;
    if (e.kind === 'episode.paused') activity = 'paused';
    if (e.kind === 'episode.resumed') activity = running;
  }
  return activity;
}
const strip = (log: readonly StoredEvent[]) => log.map((e) => ({ seq: e.seq, ...e.event }));

describe('engine clock', () => {
  it('starts work and ends it exactly when the Muse app says, and pauses the episode in place', async () => {
    const { engine } = await world(['moss'], { work: [['moss', 2.25, 3.5]] });
    await engine.advanceTo(at(6));
    const log = engine.log('moss' as MuseId);
    const started = log.find((e) => e.event.kind === 'host.work' && e.event.state === 'started');
    const ended = log.find((e) => e.event.kind === 'host.work' && e.event.state === 'ended');
    expect(started?.event.at).toBe(at(2.25));
    expect(ended?.event.at).toBe(at(3.5));
    const paused = log.find((e) => e.event.kind === 'episode.paused');
    const resumed = log.find((e) => e.event.kind === 'episode.resumed');
    expect(paused?.event.at).toBe(at(2.25));
    expect(resumed?.event.at).toBe(at(3.5));
    const between = log.filter((e) => e.event.at > at(2.25) && e.event.at < at(3.5));
    expect(between).toEqual([]);
    if (paused?.event.kind === 'episode.paused' && resumed?.event.kind === 'episode.resumed') {
      expect(resumed.event.n).toBe(paused.event.n);
    }
  });

  it('keeps going after work: the paused episode finishes its remaining time, then a new one starts', async () => {
    const { engine } = await world(['moss'], { work: [['moss', 1, 2]] });
    await engine.advanceTo(at(8));
    const log = engine.log('moss' as MuseId);
    const resumedAt = log.findIndex((e) => e.event.kind === 'episode.resumed');
    expect(resumedAt).toBeGreaterThan(0);
    expect(kinds(log.slice(resumedAt)).filter((k) => k === 'episode.started').length).toBeGreaterThan(0);
  });

  it('advancing to the same time twice changes nothing', async () => {
    const { engine } = await world(['moss', 'wren'], { introduce: true });
    await engine.advanceTo(at(12));
    const before = strip(engine.log('moss' as MuseId));
    expect(await engine.advanceTo(at(12))).toBe(0);
    expect(strip(engine.log('moss' as MuseId))).toEqual(before);
  });

  it('a crash mid-run leaves the store consistent, and a restarted engine converges to the uninterrupted log', async () => {
    const clean = await world(['moss', 'wren'], { introduce: true, work: [['wren', 3, 5]] });
    await clean.engine.advanceTo(at(24));

    const crashy = await world(['moss', 'wren'], { introduce: true, work: [['wren', 3, 5]] });
    await crashy.engine.advanceTo(at(7));
    crashy.store.failNextCommit();
    await expect(crashy.engine.advanceTo(at(24))).rejects.toThrow('injected crash');
    const restarted = new Engine(stubDeps(crashy.store), at(7));
    await restarted.advanceTo(at(24));

    for (const id of ['moss', 'wren'] as MuseId[]) {
      expect(strip(restarted.log(id))).toEqual(strip(clean.engine.log(id)));
    }
  });

  it('does not depend on the order Muses were added in', async () => {
    const a = await world(['moss', 'wren', 'fern'], { work: [['fern', 2, 4]] });
    const b = await world(['fern', 'wren', 'moss'], { work: [['fern', 2, 4]] });
    await a.engine.advanceTo(at(30));
    await b.engine.advanceTo(at(30));
    for (const id of ['moss', 'wren', 'fern'] as MuseId[]) {
      expect(strip(b.engine.log(id))).toEqual(strip(a.engine.log(id)));
    }
  });

  it('a visit is one shared episode: both logs agree on who hosts and when it ends', async () => {
    const { engine } = await world(['moss', 'wren'], { introduce: true });
    await engine.advanceTo(at(48));
    const visits = (id: string) =>
      engine
        .log(id as MuseId)
        .map((e) => e.event)
        .filter((e) => e.kind === 'episode.started' && e.plan.activity === 'visit');
    const mv = visits('moss');
    const wv = visits('wren');
    expect(mv.length).toBeGreaterThan(0);
    expect(mv.length).toBe(wv.length);
    for (let i = 0; i < mv.length; i++) {
      const a = mv[i];
      const b = wv[i];
      if (a.kind !== 'episode.started' || b.kind !== 'episode.started') continue;
      if (a.plan.activity !== 'visit' || b.plan.activity !== 'visit') continue;
      expect(a.at).toBe(b.at);
      expect(a.plan.until).toBe(b.plan.until);
      expect(new Set([a.plan.role, b.plan.role])).toEqual(new Set(['host', 'guest']));
    }
  });

  it('every Muse is always in exactly one episode or working', async () => {
    const { engine } = await world(['moss', 'wren'], { introduce: true, work: [['moss', 5, 9]] });
    await engine.advanceTo(at(36));
    for (const id of ['moss', 'wren'] as MuseId[]) {
      let open = 0;
      for (const e of engine.log(id)) {
        if (e.event.kind === 'episode.started') open++;
        if (e.event.kind === 'episode.ended') open--;
        expect(open === 0 || open === 1, `${id} at seq ${e.seq}`).toBe(true);
      }
    }
  });
});

describe('engine listeners', () => {
  it('hear every stored event once the clock has reached it, and one that throws stops nothing', async () => {
    const reference = await world(['moss', 'wren'], { introduce: true });
    await reference.engine.advanceTo(at(12));

    const { engine } = await world(['moss', 'wren'], { introduce: true });
    const before = engine.log('moss' as MuseId).length;
    const heard: StoredEvent[] = [];
    const stopBroken = engine.subscribe(() => {
      throw new Error('a broken listener');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = engine.subscribe((events) => {
      for (const e of events) expect(engine.now()).toBeGreaterThanOrEqual(e.event.at);
      heard.push(...events);
    });
    await engine.advanceTo(at(12));
    stop();
    stopBroken();

    expect(strip(engine.log('moss' as MuseId))).toEqual(strip(reference.engine.log('moss' as MuseId)));
    const mossHeard = heard.filter((e) => e.museId === 'moss').map((e) => ({ seq: e.seq, ...e.event }));
    expect(mossHeard).toEqual(strip(reference.engine.log('moss' as MuseId)).slice(before));
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();

    const count = heard.length;
    await engine.advanceTo(at(24));
    expect(heard.length, 'nothing after stop').toBe(count);
  });
});

describe('engine on SQLite', () => {
  it('a restarted engine on the same database file picks up exactly where it left off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'muse-engine-'));
    try {
      const path = join(dir, 'garden.db');
      const reference = await world(['moss', 'wren'], { introduce: true, work: [['moss', 4, 6]] });
      await reference.engine.advanceTo(at(30));

      const first = new Engine(stubDeps(memoryStore(openSqliteStore(path))), T0);
      for (const id of ['moss', 'wren']) await first.addMuse(seed(id), `I am ${id}.`, '', T0);
      await first.introduce('moss' as MuseId, 'wren' as MuseId, T0);
      first.scheduleWork('moss' as MuseId, at(4), at(6));
      await first.advanceTo(at(11));

      const store = openSqliteStore(path);
      const second = new Engine(stubDeps(memoryStore(store)), at(11));
      await second.advanceTo(at(30));
      for (const id of ['moss', 'wren'] as MuseId[]) expect(strip(second.log(id))).toEqual(strip(reference.engine.log(id)));
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Muses on the real social policy whose owners' friend groups are `reach`; moss's and wren's owners know each other online. */
async function online(reach: Readonly<Record<string, Reach>>) {
  const store = memoryStore();
  const engine = new Engine({ ...stubDeps(store), social: socialPolicy, reduceSocial }, T0);
  for (const id of Object.keys(reach)) await engine.addMuse(seed(id), `I am ${id}.`, '', T0);
  for (let i = 0; i < 2; i++) await engine.connectOwners('moss' as MuseId, 'wren' as MuseId, 'instagram', T0);
  for (const [id, r] of Object.entries(reach)) await engine.ownerSettings(id as MuseId, { kind: 'owner.settings', reach: r });
  return { store, engine };
}

const encounters = (engine: Engine, id: string) => engine.log(id as MuseId).filter((e) => e.event.kind === 'encounter');

describe('meeting online', () => {
  it('happens only while both Muses explore, and only between those whose owners know each other', async () => {
    const { engine } = await online({ moss: 'everyone', wren: 'everyone', lark: 'everyone' });
    await engine.advanceTo(at(7 * 24));

    const moss = engine.log('moss' as MuseId);
    expect(moss.filter((e) => e.event.kind === 'owners.connected')).toHaveLength(1);
    const met = moss.filter((e) => e.event.kind === 'encounter');
    expect(met.length).toBeGreaterThan(2);
    for (const e of met) {
      expect(e.event).toMatchObject({ other: 'wren', where: 'online' });
      for (const id of ['moss', 'wren']) expect(activityBefore(engine.log(id as MuseId), e.event.at)).toBe('travel');
    }
    expect(engine.log('lark' as MuseId).some((e) => e.event.kind === 'encounter')).toBe(false);
  });
});

describe('the friend group', () => {
  it('lets no Muses meet unless both owners take in the layer they are in', async () => {
    for (const reach of [{ moss: 'known', wren: 'shared' }, { moss: 'shared', wren: 'everyone' }] as const) {
      const { engine } = await online(reach);
      await engine.advanceTo(at(7 * 24));
      expect(encounters(engine, 'moss'), JSON.stringify(reach)).toEqual([]);
    }
    const { engine } = await online({ moss: 'known', wren: 'known' });
    await engine.advanceTo(at(7 * 24));
    expect(encounters(engine, 'moss').length).toBeGreaterThan(0);
  });

  it('calls off a meeting already drawn when an owner narrows the group before it, and widening lets them meet again', async () => {
    const kept = await online({ moss: 'known', wren: 'known' });
    await kept.engine.advanceTo(at(7 * 24));
    const first = encounters(kept.engine, 'moss')[0]?.event.at;
    expect(first, 'left alone, they meet').toBeDefined();

    const { engine, store } = await online({ moss: 'known', wren: 'known' });
    await engine.advanceTo((first - 1) as Instant);
    const drawn = [...store.pending('moss' as MuseId), ...store.pending('wren' as MuseId)].filter((i) => i.kind === 'encounter' && i.at === first);
    expect(drawn, 'the meeting is drawn before the narrowing').toHaveLength(1);
    await engine.ownerSettings('wren' as MuseId, { kind: 'owner.settings', reach: 'shared' });
    await engine.advanceTo(at(9 * 24));
    expect(encounters(engine, 'moss')).toEqual([]);

    await engine.ownerSettings('wren' as MuseId, { kind: 'owner.settings', reach: 'everyone' });
    const widenedAt = engine.now();
    await engine.advanceTo(at(16 * 24));
    expect(encounters(engine, 'moss').filter((e) => e.event.at >= widenedAt).length).toBeGreaterThan(0);
  });
});

// ─── Trips: an owner on a ticket, with their Muse ─────────────────────────

const MOSS = 'moss' as MuseId;
const WREN = 'wren' as MuseId;
const LARK = 'lark' as MuseId;
const JUNIPER = 'juniper' as MuseId;
const TICKET = 'inv:wren:moss' as InvitationId;
const JUNIPERS = 'inv:juniper:moss' as InvitationId;
const LARKS = 'inv:wren:lark' as InvitationId;
const MIN = 60_000;
const atMin = (minutes: number) => (T0 + minutes * MIN) as Instant;

const rest = (minutes: number): EpisodePlan => ({ activity: 'rest', until: atMin(minutes) });
const beyondFor = (minutes: number): EpisodePlan => ({ activity: 'beyond', until: atMin(minutes) });
const exploring: EpisodePlan = { activity: 'travel', trip: { kind: 'revisit', topic: 'Pigment' as TopicKey, region: '0:1:1' as RegionKey, question: null } };
const visiting = (other: MuseId, role: 'host' | 'guest', minutes = 50): EpisodePlan => ({ activity: 'visit', other, role, until: atMin(minutes) });

/**
 * Moss, Wren, Lark and Juniper, all friends, on the real social policy, as a restarted engine finds them at T0: each
 * doing what `doing` says (an episode, its next hop or end scheduled as the engine schedules it, or work), the rest
 * at home with nothing planned. Wren and Juniper have each sent Moss's owner a ticket, and Wren sent Lark's one.
 */
function scene(doing: Partial<Record<MuseId, EpisodePlan | 'working'>>, social: SocialPolicy = socialPolicy) {
  const store = memoryStore();
  const ids = [MOSS, WREN, LARK, JUNIPER];
  for (const id of ids) store.addMuse(seed(id));
  const events: StoredEvent[] = [];
  const emit = (museId: MuseId, body: MuseEventBody) =>
    events.push({ museId, seq: events.filter((e) => e.museId === museId).length + 1, event: { ...body, at: T0 } });
  for (const a of ids) for (const b of ids) if (a !== b) emit(a, { kind: 'relationship.changed', other: b, to: 'friends', origin: 'introduced' });
  for (const [id, host, guest] of [[TICKET, WREN, MOSS], [JUNIPERS, JUNIPER, MOSS], [LARKS, WREN, LARK]] as const) {
    for (const m of [host, guest]) emit(m, { kind: 'invitation', id, host, guest, to: 'sent' });
  }
  const schedule: ScheduleItem[] = [];
  for (const [id, d] of Object.entries(doing) as [MuseId, EpisodePlan | 'working'][]) {
    if (d === 'working') {
      emit(id, { kind: 'host.work', state: 'started' });
    } else {
      emit(id, { kind: 'episode.started', n: 1, plan: d });
      if (d.activity === 'travel') schedule.push({ id: `hop:${id}:1:0`, at: atMin(20), museId: id, kind: 'trip.hop', payload: { n: 1, k: 0, since: T0, from: null } });
      else if (d.activity !== 'visit' || d.role === 'host') schedule.push({ id: `end:${id}:1`, at: d.until, museId: id, kind: 'episode.end', payload: { n: 1 } });
    }
  }
  store.commit({ remove: [], events, schedule });
  const engine = new Engine({ ...stubDeps(store), social, reduceSocial }, T0);
  /** What happened to a Muse since the scene was set, from `minutes` after T0 on: each event's body, and its minute. */
  const log = (id: MuseId, minutes = 0) =>
    engine
      .log(id)
      .filter((e) => e.seq > events.filter((x) => x.museId === id).length && e.event.at >= atMin(minutes))
      .map(({ event: { at, ...body } }) => ({ min: (at - T0) / MIN, ...body }));
  return { store, engine, log };
}
const onTrip = (id: InvitationId, other: MuseId, role: 'host' | 'guest', until: number) => ({
  kind: 'episode.started',
  plan: { activity: 'visit', other, role, until: atMin(until), invitation: id },
});
const ofKind = (log: readonly { kind: string }[], kind: string) => log.filter((e) => e.kind === kind);
const timed = (store: ReturnType<typeof memoryStore>, id: MuseId) => store.pending(id).filter((i) => i.kind === 'episode.end' || i.kind === 'trip.hop');

describe('a ticket used: the owner travels with their Muse', () => {
  it.each<[string, EpisodePlan]>([
    ['asleep', rest(180)],
    ['exploring', exploring],
    ['beyond the planet', beyondFor(180)],
  ])('takes Moss to Wren’s planet at once, and Wren comes home or wakes though it was %s', async (_, plan) => {
    const { engine, store, log } = scene({ [MOSS]: rest(60), [WREN]: plan });
    expect(await engine.invitationAction(TICKET, MOSS, 'use')).toEqual({ ok: true });
    for (const [id, other, role] of [[MOSS, WREN, 'guest'], [WREN, MOSS, 'host']] as const) {
      expect(log(id).slice(-3), id).toMatchObject([
        { kind: 'invitation', id: TICKET, to: 'used' },
        { kind: 'episode.ended', n: 1 },
        { ...onTrip(TICKET, other, role, 120), n: 2 },
      ]);
      expect(timed(store, id), `${id} has no end of its own`).toEqual([]);
    }
    expect(store.pending(MOSS).filter((i) => i.kind === 'visit.close')).toEqual([
      { id: `close:${TICKET}`, at: atMin(120), museId: MOSS, kind: 'visit.close', payload: { invitation: TICKET } },
    ]);
  });

  it('ends a visit either Muse was on with a third, with that visit’s hangout, and the third goes on with its life', async () => {
    const { engine, store, log } = scene({ [MOSS]: visiting(LARK, 'guest'), [LARK]: visiting(MOSS, 'host'), [WREN]: visiting(JUNIPER, 'host'), [JUNIPER]: visiting(WREN, 'guest') });
    await engine.invitationAction(TICKET, MOSS, 'use');
    expect(log(LARK).slice(-4)).toMatchObject([{ kind: 'photo.taken' }, { kind: 'hangout', other: MOSS, role: 'host' }, { kind: 'episode.ended', n: 1 }, { kind: 'episode.started', n: 2 }]);
    expect(log(JUNIPER).slice(-4)).toMatchObject([{ kind: 'photo.taken' }, { kind: 'hangout', other: WREN, role: 'guest' }, { kind: 'episode.ended', n: 1 }, { kind: 'episode.started', n: 2 }]);
    expect(engine.state(LARK)?.episode?.plan).not.toMatchObject({ other: MOSS });
    expect(store.pending(LARK).some((i) => i.id === `end:${LARK}:1`), 'the visit’s own end is gone').toBe(false);
    expect(engine.state(MOSS)?.episode?.plan).toEqual(onTrip(TICKET, WREN, 'guest', 120).plan);
    expect(engine.state(WREN)?.episode?.plan).toEqual(onTrip(TICKET, MOSS, 'host', 120).plan);
  });

  it('closes at 2 h: the owner is home, the two hang out, and each goes on with its life', async () => {
    const { engine, store, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180) });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(119));
    expect(ofKind(log(MOSS, 1), 'hangout'), 'nothing before the close').toEqual([]);
    await engine.advanceTo(atMin(120));
    for (const [id, other, role] of [[MOSS, WREN, 'guest'], [WREN, MOSS, 'host']] as const) {
      expect(log(id, 120)).toMatchObject([
        { min: 120, kind: 'invitation', id: TICKET, to: 'returned' },
        { min: 120, kind: 'photo.taken' },
        { min: 120, kind: 'hangout', other, role },
        { min: 120, kind: 'episode.ended', n: 2 },
        { min: 120, kind: 'episode.started', n: 3 },
      ]);
    }
    expect(engine.invitation(TICKET)).toMatchObject({ state: 'returned', usedAt: T0, returnedAt: atMin(120) });
    expect(store.pending(MOSS).filter((i) => i.kind === 'visit.close')).toEqual([]);
    expect(await engine.invitationAction(TICKET, MOSS, 'use')).toMatchObject({ ok: false, status: 409 });
  });

  it('comes home early when the owner returns: the trip ends at once with its hangout, and the close never comes', async () => {
    const { engine, store, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180) });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(40));
    expect(await engine.invitationAction(TICKET, WREN, 'return')).toMatchObject({ ok: false, status: 403 });
    expect(await engine.invitationAction(TICKET, MOSS, 'return')).toEqual({ ok: true });
    for (const id of [MOSS, WREN]) {
      expect(log(id, 40).map((e) => e.kind)).toEqual(['invitation', 'photo.taken', 'hangout', 'episode.ended', 'episode.started']);
    }
    expect(store.pending(MOSS).some((i) => i.kind === 'visit.close')).toBe(false);
    expect(await engine.invitationAction(TICKET, MOSS, 'return'), 'returning twice').toEqual({ ok: true });
    await engine.advanceTo(atMin(180));
    expect(log(MOSS).filter((e) => e.kind === 'invitation').map((e) => [e.min, (e as { to?: string }).to])).toEqual([
      [0, 'used'],
      [40, 'returned'],
    ]);
    expect(engine.invitation(TICKET)).toMatchObject({ state: 'returned', returnedAt: atMin(40) });
  });

  it('waits for a working guest: Moss joins Wren when its work ends, until the same close', async () => {
    const { engine, log } = scene({ [MOSS]: 'working', [WREN]: rest(180) });
    await engine.invitationAction(TICKET, MOSS, 'use');
    expect(log(WREN).map((e) => e.kind), 'Wren sleeps on meanwhile').toEqual(['invitation']);
    expect(log(MOSS).map((e) => e.kind)).toEqual(['invitation']);
    await engine.advanceTo(atMin(30));
    await engine.hostWork(MOSS, 'ended');
    expect(log(MOSS, 30)).toMatchObject([{ kind: 'host.work', state: 'ended' }, { ...onTrip(TICKET, WREN, 'guest', 120), n: 1 }]);
    expect(log(WREN, 30)).toMatchObject([{ kind: 'episode.ended', n: 1 }, { ...onTrip(TICKET, MOSS, 'host', 120), n: 2 }]);
    await engine.advanceTo(atMin(120));
    expect(ofKind(log(MOSS, 120), 'hangout')).toHaveLength(1);
  });

  it('waits for a working host: Wren takes Moss in when its work ends, whatever Moss has started meanwhile', async () => {
    const { engine, log } = scene({ [MOSS]: rest(30), [WREN]: 'working' });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(90));
    const meanwhile = engine.state(MOSS)?.episode;
    expect(meanwhile?.plan.activity, 'Moss went on with its life').not.toBe('visit');
    await engine.hostWork(WREN, 'ended');
    expect(log(MOSS, 90)).toMatchObject([{ kind: 'episode.ended', n: meanwhile?.n }, onTrip(TICKET, WREN, 'guest', 120)]);
    expect(log(WREN, 90)).toMatchObject([{ kind: 'host.work', state: 'ended' }, onTrip(TICKET, MOSS, 'host', 120)]);
  });

  it('never sets off if the work outlasts the visit: the owner comes home at 2 h, with no hangout', async () => {
    const { engine, log } = scene({ [MOSS]: rest(30), [WREN]: 'working' });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(150));
    await engine.hostWork(WREN, 'ended');
    for (const id of [MOSS, WREN]) {
      const since = log(id);
      expect(ofKind(since, 'invitation').map((e) => (e as { to?: string }).to)).toEqual(['used', 'returned']);
      expect(ofKind(since, 'hangout')).toEqual([]);
      const plans = ofKind(since, 'episode.started').map((e) => (e as { plan?: EpisodePlan }).plan);
      expect(plans.some((p) => p?.activity === 'visit' && p.invitation !== undefined), 'never on the trip').toBe(false);
    }
  });

  it('pauses in place for work in the middle of the trip and carries on after, with no end of its own', async () => {
    const { engine, store, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180) });
    engine.scheduleWork(WREN, atMin(30), atMin(60));
    engine.scheduleWork(MOSS, atMin(45), atMin(75));
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(100));
    for (const id of [MOSS, WREN]) {
      expect(ofKind(log(id, 1), 'episode.started'), `${id} stays on the trip`).toEqual([]);
      expect(ofKind(log(id, 1), 'episode.resumed')).toHaveLength(1);
      expect(timed(store, id), `${id} has no end of its own`).toEqual([]);
    }
    await engine.advanceTo(atMin(120));
    expect(ofKind(log(WREN, 120), 'hangout')).toHaveLength(1);
  });

  it('closes on time even while a Muse works, which then starts its next episode when the work ends', async () => {
    const { engine, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180) });
    engine.scheduleWork(MOSS, atMin(100), atMin(150));
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(149));
    expect(log(MOSS, 120).map((e) => e.kind)).toEqual(['invitation', 'photo.taken', 'hangout', 'episode.ended']);
    expect(engine.state(MOSS)?.episode).toBeNull();
    expect(engine.state(WREN)?.episode?.plan.activity).toBeDefined();
    await engine.advanceTo(atMin(150));
    expect(log(MOSS, 150).map((e) => e.kind)).toEqual(['host.work', 'episode.started']);
  });

  it('brings no hangout home when either Muse has no photo slot left today', async () => {
    const full: SocialPolicy = { ...socialPolicy, photoSlotsLeft: (s, now) => (s.seed.id === WREN ? 0 : socialPolicy.photoSlotsLeft(s, now)) };
    const { engine, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180) }, full);
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(120));
    for (const id of [MOSS, WREN]) expect(log(id, 120).map((e) => e.kind)).toEqual(['invitation', 'episode.ended', 'episode.started']);
  });

  it('takes the owner on one trip at a time: boarding another ticket returns from the first', async () => {
    const { engine, store, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180), [JUNIPER]: rest(180) });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(30));
    expect(await engine.invitationAction(JUNIPERS, MOSS, 'use')).toEqual({ ok: true });
    expect(log(WREN, 30)).toMatchObject([
      { kind: 'invitation', id: TICKET, to: 'returned' },
      { kind: 'photo.taken' },
      { kind: 'hangout', other: MOSS, role: 'host' },
      { kind: 'episode.ended', n: 2 },
      { kind: 'episode.started', n: 3 },
    ]);
    expect(engine.state(MOSS)?.episode?.plan).toEqual(onTrip(JUNIPERS, JUNIPER, 'guest', 150).plan);
    expect(engine.state(JUNIPER)?.episode?.plan).toEqual(onTrip(JUNIPERS, MOSS, 'host', 150).plan);
    expect(store.pending(MOSS).filter((i) => i.kind === 'visit.close').map((i) => i.id)).toEqual([`close:${JUNIPERS}`]);
    expect(engine.invitation(TICKET)).toMatchObject({ state: 'returned', returnedAt: atMin(30) });
    expect(await engine.invitationAction(TICKET, MOSS, 'use')).toMatchObject({ ok: false, status: 409 });
  });

  it('lets a host on one trip take the next guest in when that trip ends', async () => {
    const { engine, log } = scene({ [MOSS]: rest(60), [WREN]: rest(180), [LARK]: rest(240) });
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(30));
    expect(await engine.invitationAction(LARKS, LARK, 'use')).toEqual({ ok: true });
    expect(log(LARK, 30).map((e) => e.kind), 'Lark sleeps on while Wren has Moss over').toEqual(['invitation']);
    await engine.advanceTo(atMin(60));
    await engine.invitationAction(TICKET, MOSS, 'return');
    expect(log(WREN, 60)).toMatchObject([
      { kind: 'invitation', id: TICKET, to: 'returned' },
      { kind: 'photo.taken' },
      { kind: 'hangout', other: MOSS },
      { kind: 'episode.ended' },
      onTrip(LARKS, LARK, 'host', 150),
    ]);
    expect(log(LARK, 60)).toMatchObject([{ kind: 'episode.ended', n: 1 }, onTrip(LARKS, WREN, 'guest', 150)]);
  });

  it('keeps every Muse in exactly one episode or working, and never starts one while working', async () => {
    const { engine, log } = scene({ [MOSS]: rest(60), [WREN]: exploring, [LARK]: rest(40), [JUNIPER]: beyondFor(70) });
    for (const [id, a, b] of [[MOSS, 20, 50], [WREN, 100, 130], [JUNIPER, 200, 260], [MOSS, 300, 420]] as const) engine.scheduleWork(id, atMin(a), atMin(b));
    await engine.invitationAction(TICKET, MOSS, 'use');
    await engine.advanceTo(atMin(150));
    await engine.invitationAction(JUNIPERS, MOSS, 'use');
    await engine.advanceTo(atMin(280));
    await engine.invitationAction(JUNIPERS, MOSS, 'return');
    await engine.advanceTo(atMin(24 * 60));
    for (const id of [MOSS, WREN, LARK, JUNIPER]) {
      let open = 0;
      let working = false;
      for (const e of engine.log(id)) {
        if (e.event.kind === 'host.work') working = e.event.state === 'started';
        if (e.event.kind === 'episode.started') {
          expect(working, `${id} started an episode while working, at seq ${e.seq}`).toBe(false);
          open++;
        }
        if (e.event.kind === 'episode.ended') open--;
        expect(open === 0 || open === 1, `${id} at seq ${e.seq}`).toBe(true);
      }
    }
    expect(ofKind(log(MOSS), 'hangout').length).toBeGreaterThanOrEqual(2);
  });

  it('a restarted engine picks a trip up where it left off', async () => {
    const run = async (stopAt: number | null) => {
      const { engine, store } = scene({ [MOSS]: rest(60), [WREN]: exploring, [LARK]: rest(30) });
      engine.scheduleWork(WREN, atMin(10), atMin(40));
      engine.scheduleWork(MOSS, atMin(70), atMin(90));
      await engine.invitationAction(TICKET, MOSS, 'use');
      if (stopAt === null) {
        await engine.advanceTo(atMin(6 * 60));
        return engine;
      }
      await engine.advanceTo(atMin(stopAt));
      const restarted = new Engine({ ...stubDeps(store), social: socialPolicy, reduceSocial }, atMin(stopAt));
      await restarted.advanceTo(atMin(6 * 60));
      return restarted;
    };
    const clean = await run(null);
    for (const stopAt of [25, 80]) {
      const restarted = await run(stopAt);
      for (const id of [MOSS, WREN, LARK]) expect(strip(restarted.log(id)), `${id}, stopped at ${stopAt} min`).toEqual(strip(clean.log(id)));
    }
  });
});
