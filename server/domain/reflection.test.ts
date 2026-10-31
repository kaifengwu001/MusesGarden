import { describe, expect, it } from 'vitest';
import type { InterestDelta, MuseEventBody, ReflectionProposal, RegionKey, StoredEvent } from '../../src/muse/contract';
import { regionForNewTopic } from './atlas';
import { eventRef, instant, museId } from './ids';
import { drawFor } from './rng';
import { next } from './policy/life';
import { startTrip } from './policy/travel';
import { experiences, reflectionDue, validateReflection } from './reflection';
import { foldLog, Life, MOSS, t, TEMPERAMENTS, topic, topicsOf } from './testing';
import { DAY_MS, HOUR_MS, MINUTE_MS } from './time';

const BI = 'Botanical illustration';
const IP = 'Inorganic pigments';
const D1 = t('2026-11-02T08:00:00-08:00');
const D2 = t('2026-11-03T10:00:00-08:00');

function trip(life: Life, at: number, n: number, name: string, region: RegionKey | null): RegionKey {
  const r = region ?? regionForNewTopic(life.state, null, drawFor(MOSS.id, n));
  const tripStart = region
    ? ({ kind: 'revisit', topic: topic(name), region: r, question: null } as const)
    : ({ kind: 'new-area', topic: topic(name), region: r, relatedTo: null, question: null } as const);
  life.push(at, { kind: 'episode.started', n, plan: { activity: 'travel', trip: tripStart } });
  if (!region) life.push(at, { kind: 'region.revealed', region: r, topic: topic(name) });
  return r;
}

function proposal(...deltas: readonly Omit<InterestDelta, 'reason'>[]): ReflectionProposal {
  return { deltas: deltas.map((d) => ({ ...d, reason: 'it keeps coming back' })), narrative: 'Colours come from stones.', questions: [] };
}

function reflectNow(life: Life, at: number, p: ReflectionProposal): MuseEventBody {
  const body = validateReflection(life.state, life.log, p, at);
  life.push(at, body);
  return body;
}

/** Two days of life: owner seeds, the pigment trail, a revisit, and two reflections that cite it. */
function lived(): Life {
  const life = new Life();
  life.push(D1, { kind: 'soul.updated', version: 1, topics: topicsOf('Origami'), temperament: TEMPERAMENTS.hero });
  life.push(D1, { kind: 'memory.updated', textHash: 'h1', topics: topicsOf(BI, 'Jazz', IP) });
  const region = trip(life, D1, 1, BI, null);
  life.hop(D1 + 40 * MINUTE_MS, 1, 0, BI, region, [{ title: BI, score: 0.9, kept: true }]);
  const [pigment] = life.hop(D1 + 80 * MINUTE_MS, 1, 1, BI, region, [{ title: 'Pigment', score: 0.86, kept: true, topics: ['Pigment', IP] }]);
  life.hop(D1 + 120 * MINUTE_MS, 1, 2, 'Pigment', region, [{ title: 'Ultramarine', score: 0.93, kept: true, topics: ['Ultramarine', IP] }]);
  life.push(D1 + 120 * MINUTE_MS, { kind: 'episode.ended', n: 1 });
  reflectNow(
    life,
    D1 + 6 * HOUR_MS,
    proposal(
      { topic: topic(IP), dAffinity: 0.15, stage: 'emerging', evidence: pigment.because },
      { topic: topic('Pigment'), dAffinity: 0.1, evidence: pigment.because },
      { topic: topic('Jazz'), dAffinity: 0.2, evidence: pigment.because },
    ),
  );
  trip(life, D2, 2, 'Pigment', region);
  const [cobalt] = life.hop(D2 + 40 * MINUTE_MS, 2, 0, 'Pigment', region, [
    { title: 'Cobalt blue', score: 0.88, kept: true, topics: ['Cobalt blue', IP] },
    { title: 'Vermilion', score: 0.8, kept: true, topics: ['Vermilion', IP] },
  ]);
  life.push(D2 + 40 * MINUTE_MS, { kind: 'episode.ended', n: 2 });
  reflectNow(life, D2 + 5 * HOUR_MS, proposal({ topic: topic(IP), dAffinity: 0.1, stage: 'established', evidence: cobalt.because }));
  life.push(D2 + DAY_MS, { kind: 'memory.updated', textHash: 'h2', topics: topicsOf('Jazz', 'Sourdough') });
  return life;
}

const HOST_INPUTS = new Set<StoredEvent['event']['kind']>(['soul.updated', 'memory.updated', 'host.work', 'owner.settings']);
const REFLECTIONS = new Set<StoredEvent['event']['kind']>(['reflection.committed', 'reflection.no-change']);

describe('the evidence-gated reducer', () => {
  const life = lived();
  const full = life.state;
  const stripped = foldLog(MOSS, TEMPERAMENTS.hero, life.log.filter((e) => HOST_INPUTS.has(e.event.kind) || REFLECTIONS.has(e.event.kind)));
  const seedOnly = foldLog(MOSS, TEMPERAMENTS.hero, life.log.filter((e) => HOST_INPUTS.has(e.event.kind)));

  it('grows interests from what Muse lived through', () => {
    expect(full.reflections).toHaveLength(2);
    expect(full.interests.get(topic(IP))?.stage).toBe('established');
    expect(full.interests.get(topic(IP))?.sources).toHaveLength(4);
    expect(full.interests.get(topic(IP))?.affinity).toBeCloseTo(0.25, 9);
    expect(full.interests.get(topic('Pigment'))?.affinity).toBeCloseTo(0.1, 9);
    expect(full.interests.get(topic('Jazz'))?.affinity).toBe(0);
  });

  it('folds back to the seed-only state once the experiences are removed, reflections and all', () => {
    expect(stripped.reflections).toEqual([]);
    expect(stripped.interests).toEqual(seedOnly.interests);
    expect(full.interests).not.toEqual(seedOnly.interests);
  });

  it('decides the same as the seed-only Muse once the experiences are removed', () => {
    const now = instant(D2 + 2 * DAY_MS);
    for (let n = 0; n < 50; n++) {
      expect(startTrip(stripped, now, drawFor(MOSS.id, n))).toEqual(startTrip(seedOnly, now, drawFor(MOSS.id, n)));
      expect(next(stripped, now, drawFor(MOSS.id, n), true)).toBe(next(seedOnly, now, drawFor(MOSS.id, n), true));
    }
  });

  it('re-gates a committed reflection against the fold it lands in', () => {
    const forged = new Life();
    forged.push(D1, { kind: 'memory.updated', textHash: 'h', topics: topicsOf(BI, 'Jazz') });
    const region = trip(forged, D1, 1, BI, null);
    const [find] = forged.hop(D1 + HOUR_MS, 1, 0, BI, region, [{ title: BI, score: 0.9, kept: true }]);
    forged.push(D1 + 2 * HOUR_MS, {
      kind: 'reflection.committed',
      version: 1,
      deltas: [
        { topic: topic(BI), dAffinity: 0.9, stage: 'established', evidence: find.because, reason: 'forged' },
        { topic: topic('Jazz'), dAffinity: 0.2, evidence: find.because, reason: 'forged' },
      ],
      narrative: 'forged',
      evidence: find.because,
    });
    expect(forged.state.interests.get(topic(BI))).toMatchObject({ stage: 'hypothesis', affinity: 0.2 });
    expect(forged.state.interests.get(topic('Jazz'))?.affinity).toBe(0);
    expect(forged.state.reflections[0].deltas.map((d) => d.topic)).toEqual([topic(BI)]);
  });
});

describe('validateReflection', () => {
  const life = new Life();
  life.push(D1, { kind: 'memory.updated', textHash: 'h', topics: topicsOf(BI, IP) });
  const region = trip(life, D1, 1, BI, null);
  const [find] = life.hop(D1 + HOUR_MS, 1, 0, BI, region, [{ title: 'Pigment', score: 0.86, kept: true, topics: ['Pigment', IP] }]);
  const [other] = life.hop(D1 + 2 * HOUR_MS, 1, 1, 'Pigment', region, [{ title: 'Ultramarine', score: 0.9, kept: true, topics: ['Ultramarine', IP] }]);
  const now = D1 + 3 * HOUR_MS;

  it('clamps Δaffinity, keeps a stage the sources back and drops one they do not', () => {
    const out = validateReflection(
      life.state,
      life.log,
      proposal(
        { topic: topic(IP), dAffinity: 0.9, stage: 'emerging', evidence: [...find.because, ...other.because] },
        { topic: topic('Pigment'), dAffinity: -0.7, stage: 'established', evidence: find.because },
      ),
      now,
    );
    expect(out).toMatchObject({ kind: 'reflection.committed', version: 1 });
    if (out.kind !== 'reflection.committed') return;
    expect(out.deltas).toEqual([
      expect.objectContaining({ topic: topic(IP), dAffinity: 0.2, stage: 'emerging' }),
      expect.objectContaining({ topic: topic('Pigment'), dAffinity: -0.2 }),
    ]);
    expect(out.deltas[1].stage).toBeUndefined();
  });

  it('drops deltas whose evidence is missing or is itself a reflection', () => {
    const withReflection = new Life();
    for (const e of life.log) withReflection.push(e.event.at, e.event);
    withReflection.push(now, { kind: 'reflection.no-change', reviewed: [] });
    const reflectionRef = eventRef(MOSS.id, withReflection.log.length);
    const out = validateReflection(
      withReflection.state,
      withReflection.log,
      proposal(
        { topic: topic(IP), dAffinity: 0.1, evidence: [reflectionRef] },
        { topic: topic('Pigment'), dAffinity: 0.1, evidence: [eventRef(MOSS.id, 999)] },
      ),
      now,
    );
    expect(out.kind).toBe('reflection.no-change');
  });

  it('says no change when nothing survives, listing what it reviewed', () => {
    const out = validateReflection(life.state, life.log, proposal({ topic: topic('Jazz'), dAffinity: 0.1, evidence: find.because }), now);
    expect(out.kind).toBe('reflection.no-change');
    if (out.kind === 'reflection.no-change') expect(out.reviewed).toEqual(expect.arrayContaining([...find.because]));
  });
});

describe('experiences', () => {
  it('excludes reflections and counts a page once, as kept, however often Muse saw it', () => {
    const life = new Life();
    const region = trip(life, D1, 1, BI, null);
    life.hop(D1 + HOUR_MS, 1, 0, BI, region, [{ title: 'Herbarium', score: 0.6 }]);
    life.push(D1 + HOUR_MS, { kind: 'reflection.no-change', reviewed: [] });
    life.hop(D1 + 2 * HOUR_MS, 1, 1, BI, region, [{ title: 'Herbarium', score: 0.6 }]);
    life.hop(D1 + 3 * HOUR_MS, 1, 2, BI, region, [{ title: 'Herbarium', score: 0.8, kept: true }, { title: 'Lichen', score: 0.2 }]);
    const xs = experiences(life.state, life.log);
    expect(xs.map((x) => [x.kind, x.note.includes('Herbarium') ? 'Herbarium' : 'Lichen'])).toEqual([
      ['kept', 'Herbarium'],
      ['skipped', 'Lichen'],
    ]);
    expect(xs.every((x) => life.log[Number(x.ref.split('#')[1]) - 1].event.kind !== 'reflection.no-change')).toBe(true);
  });
});

describe('reflectionDue', () => {
  it('is due after 8 new experiences, or after 3 days with anything new, and not otherwise', () => {
    const life = new Life();
    life.push(D1, { kind: 'memory.updated', textHash: 'h', topics: [] });
    expect(reflectionDue(life.state, D1 + 4 * DAY_MS)).toBe(false);
    life.push(D1 + HOUR_MS, { kind: 'encounter', other: museId('wren'), pleasantness: 0.5, similarity: 0.5 });
    expect(reflectionDue(life.state, D1 + 2 * DAY_MS)).toBe(false);
    expect(reflectionDue(life.state, D1 + 3 * DAY_MS)).toBe(true);
    for (let k = 0; k < 7; k++) life.push(D1 + 2 * HOUR_MS, { kind: 'encounter', other: museId('wren'), pleasantness: 0.5, similarity: 0.5 });
    expect(reflectionDue(life.state, D1 + 3 * HOUR_MS)).toBe(true);
    life.push(D1 + 4 * HOUR_MS, { kind: 'reflection.no-change', reviewed: [] });
    expect(reflectionDue(life.state, D1 + 5 * HOUR_MS)).toBe(false);
  });
});
