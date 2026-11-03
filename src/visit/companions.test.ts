import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MuseId, MuseLook, NowView } from '../muse/contract';
import { sampleNowExploring, sampleNowHosting } from '../muse/samples';
import { Companions, type CompanionWorld } from './companions';
import { FOLLOW } from './follow';
import type { VisitBody, VisitDirection } from './world';

const R = 128;

/** A body that keeps what it is told, and stands where an 'out' puts it. */
function body(dir = new Vector3(0, 1, 0)): VisitBody & { told: VisitDirection[]; away: boolean } {
  const b = {
    where: { dir: dir.clone(), height: 0, heading: new Vector3(1, 0, 0) },
    ready: Promise.resolve(),
    told: [] as VisitDirection[],
    away: false,
    direct(d: VisitDirection) {
      b.told.push(d);
      if (d.kind === 'out') b.where.dir.copy(d.dir);
    },
  };
  return b;
}

function world() {
  const host = body();
  const made: { look: MuseLook; guest: ReturnType<typeof body> }[] = [];
  const dressed: MuseLook[] = [];
  const w: CompanionWorld = {
    host,
    growth: { radius: R },
    makeGuest: (look) => {
      const guest = body(new Vector3(1, 0, 0));
      made.push({ look, guest });
      return guest;
    },
    dress: (_guest, look) => dressed.push(look),
    ground: () => ({ water: 5 }),
  };
  return { w, host, made, dressed };
}

const visiting = (museId: string, look: MuseLook): NowView => ({ ...sampleNowHosting, companion: { museId: museId as MuseId, name: museId, look, withOwner: false } });

describe('a friend’s Muse visiting yours', () => {
  it('is made only when a friend first comes: a planet nobody visits draws nothing more', () => {
    const { w, made } = world();
    const c = new Companions(w);
    c.view(sampleNowExploring);
    c.update(1 / 60);
    expect(made).toEqual([]);
    expect(c.state()).toMatchObject({ made: false, shown: false, companion: null });
  });

  it('stands beside yours in its own body while it is here, facing it', () => {
    const { w, host, made } = world();
    const c = new Companions(w);
    c.view(visiting('juniper', 'muse6'));
    c.update(1 / 60);
    expect(made.map((m) => m.look)).toEqual(['muse6']);
    const told = made[0].guest.told.at(-1);
    expect(told).toMatchObject({ kind: 'out', walk: 0, busy: false });
    expect(c.state()).toMatchObject({ companion: 'juniper', look: 'muse6', made: true, shown: true });
    expect(c.state().apart).toBeCloseTo(FOLLOW.side, 3);
    if (told?.kind === 'out') expect(told.toward?.equals(host.where.dir)).toBe(true);
  });

  it('goes out of sight when the friend leaves, or yours is off the planet, and is the same Muse in another body for the next friend', () => {
    const { w, host, made, dressed } = world();
    const c = new Companions(w);
    c.view(visiting('juniper', 'muse6'));
    c.update(1 / 60);
    c.view(sampleNowExploring);
    c.update(1 / 60);
    expect(made[0].guest.told.at(-1)).toEqual({ kind: 'hidden' });
    c.view(visiting('wren', 'muse8'));
    host.away = true;
    c.update(1 / 60);
    expect(made[0].guest.told.at(-1)).toEqual({ kind: 'hidden' });
    host.away = false;
    c.update(1 / 60);
    expect(made[0].guest.told.at(-1)?.kind).toBe('out');
    expect(made).toHaveLength(1);
    expect(dressed).toEqual(['muse8']);
  });
});
