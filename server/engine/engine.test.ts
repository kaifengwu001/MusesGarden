import { describe, expect, it } from 'vitest';
import type { Instant, MuseId, MuseSeed, StoredEvent } from '../../src/muse/contract';
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
