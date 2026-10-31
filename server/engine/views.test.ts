import { describe, expect, it } from 'vitest';
import type { Dir, Instant, InvitationId, MuseId, RegionKey } from '../../src/muse/contract';
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
};

async function setup() {
  const deps = stubDeps(memoryStore());
  const engine = new Engine(deps, T0);
  for (const id of ['moss', 'wren']) await engine.addMuse({ id: id as MuseId, name: id, worldSeed: 7, timezone: 'UTC' }, 'x', '', T0);
  const views = new Views(engine, deps.social, helpers, new Map([['moss' as MuseId, 'hero' as const]]));
  const commands = new Commands(engine, 'fast-forward');
  return { engine, views, commands };
}

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

  it('a visit outside an open invitation is forbidden', async () => {
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
});
