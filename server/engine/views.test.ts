import { describe, expect, it } from 'vitest';
import type { Dir, Instant, InvitationId, MuseEvent, MuseId, RegionKey } from '../../src/muse/contract';
import { socialPolicy } from '../domain/social/policy';
import { reduceSocial } from '../domain/social/state';
import { Engine } from './engine';
import { memoryStore, stubDeps } from './testing/stubs';
import { Commands, shareCode, Views, type ViewHelpers } from './views';

const T0 = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const H = 3_600_000;

const helpers: ViewHelpers = {
  regions: ['0:0:0', '0:1:1', '5:3:3'] as RegionKey[],
  regionCenter: (): Dir => [0, 1, 0],
  growth: (s) => Math.min(1, s.regions.size / 10),
  salienceAt: (i) => i.salience.value,
  shelf: (s) => [...s.discoveries.values()].map((discovery) => ({ discovery, fondness: discovery.keepScore })),
  soulSection: (s) => `## ${s.seed.name}`,
  journal: () => '',
  metrics: () => [],
  localDay: (at) => new Date(at).toISOString().slice(0, 10),
  soulBody: (soulMd) => soulMd,
};

async function setup() {
  const deps = stubDeps(memoryStore());
  const engine = new Engine(deps, T0);
  for (const id of ['moss', 'wren']) await engine.addMuse({ id: id as MuseId, name: id, worldSeed: 7, timezone: 'UTC' }, 'x', '', T0);
  const views = new Views(engine, deps.social, helpers, new Map([['moss' as MuseId, 'hero' as const]]));
  const commands = new Commands(engine, 'fast-forward');
  return { engine, views, commands };
}

/** Moss's owner holds an invitation Wren sent at T0, replayed from the store as a restart would. */
async function invited() {
  const store = memoryStore();
  const deps = { ...stubDeps(store), social: socialPolicy, reduceSocial };
  const seeding = new Engine(deps, T0);
  for (const id of ['moss', 'wren']) await seeding.addMuse({ id: id as MuseId, name: id, worldSeed: 7, timezone: 'UTC' }, 'x', '', T0);
  const event: MuseEvent = { kind: 'invitation', id: INVITE, host: WREN, guest: MOSS, to: 'sent', at: T0 };
  store.commit({ remove: [], schedule: [], events: [WREN, MOSS].map((museId) => ({ museId, seq: store.lastSeq(museId) + 1, event })) });
  const engine = new Engine(deps, T0);
  return { engine, views: new Views(engine, socialPolicy, helpers, new Map()), commands: new Commands(engine, 'fast-forward') };
}

const MOSS = 'moss' as MuseId;
const WREN = 'wren' as MuseId;
const INVITE = 'inv:wren:moss:1' as InvitationId;
const uses = (engine: Engine, id: MuseId) => engine.log(id).filter((e) => e.event.kind === 'invitation' && e.event.to === 'used').length;

describe('an invitation, through the commands', () => {
  it('Travel now records one use in both logs, opens the host planet for 2 h, and refuses a use after that', async () => {
    const { engine, views, commands } = await invited();
    await commands.advance(5 * 24);
    expect(await commands.useInvitation(WREN, INVITE)).toMatchObject({ ok: false, status: 403 });
    expect(await commands.useInvitation(MOSS, INVITE)).toEqual({ ok: true });
    const usedAt = engine.now();
    expect(views.invitations(MOSS, usedAt)).toEqual([expect.objectContaining({ role: 'guest', state: 'used', usedAt, actions: [], canVisitNow: true })]);
    expect(views.visit(INVITE, MOSS, usedAt)).toMatchObject({ host: { museId: WREN }, until: usedAt + 2 * H });
    expect(views.visit(INVITE, WREN, usedAt)).toBe('forbidden');

    await commands.advance(1);
    expect(await commands.useInvitation(MOSS, INVITE)).toEqual({ ok: true });
    expect([uses(engine, MOSS), uses(engine, WREN)]).toEqual([1, 1]);

    await commands.advance(1);
    expect(await commands.useInvitation(MOSS, INVITE)).toMatchObject({ ok: false, status: 409 });
    expect(views.visit(INVITE, MOSS, engine.now())).toBe('forbidden');
    expect(views.invitations(MOSS, engine.now())[0].canVisitNow).toBe(false);
  });

  it('lets the host withdraw it before it is used, and then it cannot be used', async () => {
    const { views, commands } = await invited();
    expect(views.invitations(WREN, T0)).toEqual([expect.objectContaining({ role: 'host', state: 'sent', actions: ['withdraw'] })]);
    expect(views.invitations(MOSS, T0)).toEqual([expect.objectContaining({ role: 'guest', state: 'sent', actions: ['use'] })]);
    expect(await commands.withdrawInvitation(MOSS, INVITE)).toMatchObject({ ok: false, status: 403 });
    expect(await commands.withdrawInvitation(WREN, INVITE)).toEqual({ ok: true });
    expect(await commands.useInvitation(MOSS, INVITE)).toMatchObject({ ok: false, status: 409 });
    expect(views.invitations(MOSS, T0)[0]).toMatchObject({ state: 'withdrawn', actions: [] });
  });

  it('answers 404 for an invitation nobody holds', async () => {
    const { commands } = await invited();
    expect(await commands.useInvitation(MOSS, 'inv:nobody' as InvitationId)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('views', () => {
  it('describe what Muse is doing, and hide the path whenever Muse is beyond or away', async () => {
    const { engine, views } = await setup();
    const seen = new Set<string>();
    for (let h = 1; h <= 72; h++) {
      await engine.advanceTo((T0 + h * H) as Instant);
      for (const id of ['moss', 'wren'] as MuseId[]) {
        const now = views.now(id, engine.now());
        expect(now).not.toBeNull();
        if (!now) continue;
        seen.add(now.activity);
        expect(now.label.length).toBeGreaterThan(0);
        if (now.away) expect(now.path).toBeNull();
        if (now.activity === 'beyond') expect(now.away).toEqual({ kind: 'beyond' });
      }
    }
    expect(seen.has('travel') || seen.has('rest')).toBe(true);
  });

  it('a fogged region shows no topics', async () => {
    const { engine, views } = await setup();
    await engine.advanceTo((T0 + 24 * H) as Instant);
    for (const r of views.world('moss' as MuseId)?.regions ?? []) {
      if (r.fogged) expect(r.topics).toBeUndefined();
    }
  });

  it('a visit with no invitation used is forbidden', async () => {
    const { views } = await setup();
    expect(views.visit('nope' as InvitationId, 'moss' as MuseId, T0)).toBe('forbidden');
  });

  it('introduces two Muses by share code, and refuses your own code', async () => {
    const { engine, views, commands } = await setup();
    const wren = engine.state('wren' as MuseId);
    if (!wren) throw new Error('missing');
    expect(await commands.introduce('moss' as MuseId, shareCode(wren).toLowerCase())).toEqual({ ok: true });
    expect(views.sharing('moss' as MuseId)?.friends.map((f) => f.museId)).toEqual(['wren']);
    const moss = engine.state('moss' as MuseId);
    if (!moss) throw new Error('missing');
    expect((await commands.introduce('moss' as MuseId, shareCode(moss))).ok).toBe(false);
  });

  it('refuses a manual advance while the clock is live', async () => {
    const { commands } = await setup();
    await commands.setClock('live');
    expect((await commands.advance(1)).ok).toBe(false);
  });

  it('a live clock moves the engine on by the wall time passed, even when the engine is ahead of the wall', async () => {
    const { engine, commands } = await setup();
    await commands.advance(48);
    const ahead = engine.now();
    await commands.setClock('live');
    const wall = (T0 + 1 * H) as Instant;
    await commands.tick(wall);
    expect(engine.now()).toBe(ahead);
    await commands.tick((wall + 60_000) as Instant);
    expect(engine.now()).toBe(ahead + 60_000);
    await commands.tick((wall + 3 * 60_000) as Instant);
    expect(engine.now()).toBe(ahead + 3 * 60_000);
  });

  it('a live clock first catches an engine that is behind up to the wall clock', async () => {
    const { engine, commands } = await setup();
    await commands.setClock('live');
    await commands.tick((T0 + 2 * H) as Instant);
    expect(engine.now()).toBe(T0 + 2 * H);
  });
});
