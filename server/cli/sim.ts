// npm run sim -- --hours 504 --work server/fixtures/work-3weeks.json --owners auto-accept [--db garden.db] [--mind meta] [--seed 7]
//   [--like "Green tea" --like-from 24 --like-days 3]
// Simulates the cast on the real engine, prints what each Muse did, and checks the plan's promises against the logs.
// --like scripts the hero's owner to like every delivered find about one topic for a few days (--like-days 0 is
// the control), and prints that topic's share of the hero's trips.
import { parseArgs } from 'node:util';
import type { Instant, MuseId, MuseState, TopicKey } from '../../src/muse/contract';
import { lifePolicy } from '../domain/policy/index';
import { renderSoulSection } from '../domain/soul';
import { localDay } from '../domain/time';
import { buildGarden } from '../engine/compose';
import { loadCast } from '../fixtures/cast';
import { checks, run, seedCast } from './run';

const { values } = parseArgs({
  options: {
    hours: { type: 'string', default: '504' },
    cast: { type: 'string', default: 'server/fixtures/cast.json' },
    work: { type: 'string', default: 'server/fixtures/work-3weeks.json' },
    owners: { type: 'string', default: 'auto-accept' },
    db: { type: 'string' },
    mind: { type: 'string', default: 'heuristic' },
    start: { type: 'string', default: '2026-11-01T13:00:00Z' },
    journal: { type: 'string' },
    seed: { type: 'string', default: '0' },
    like: { type: 'string' },
    'like-from': { type: 'string', default: '24' },
    'like-days': { type: 'string', default: '3' },
  },
});

const hours = Number(values.hours);
const start = Date.parse(values.start) as Instant;
const owners = values.owners === 'auto-decline' ? 'auto-decline' : 'auto-accept';
const cast = loadCast(values.cast);
const hero = cast.members.find((m) => m.role === 'hero')?.id ?? null;
const garden = buildGarden({
  db: values.db ?? null,
  source: 'fixture',
  mind: values.mind === 'meta' ? 'meta' : 'heuristic',
  hero,
  start,
  clock: 'fast-forward',
  roles: new Map(cast.members.map((m) => [m.id, m.role])),
  seed: Number(values.seed),
});
const likeFrom = (start + Number(values['like-from']) * 3_600_000) as Instant;
const likes = values.like && hero ? { museId: hero, topic: values.like as TopicKey, from: likeFrom, until: (likeFrom + Number(values['like-days']) * 86_400_000) as Instant } : undefined;
const opts = { cast: values.cast, work: values.work === 'none' ? null : values.work, start, hours, owners, likes } as const;

const t0 = performance.now();
if (garden.engine.museIds().length === 0) await seedCast(garden.engine, lifePolicy, opts);
await run(garden.engine, opts);
const seconds = ((performance.now() - t0) / 1000).toFixed(1);

const line = (s: MuseState) => {
  const rows = garden.views.metrics(s.seed.id);
  const sum = (k: 'finds' | 'newAreas' | 'revisits' | 'trips' | 'photos' | 'restHours' | 'socialHours' | 'workHours') =>
    rows.reduce((n, r) => n + r[k], 0);
  const friends = [...s.social.relationships.values()].filter((r) => r.status === 'friends').length;
  const top = [...s.interests.values()]
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 3)
    .map((i) => `${i.topic} (${i.stage})`)
    .join(', ');
  return [
    `${s.seed.name.padEnd(8)} finds ${String(sum('finds')).padStart(3)}  areas ${String(s.regions.size).padStart(2)}  trips ${String(sum('trips')).padStart(3)}`,
    `photos ${String(s.photos.length).padStart(3)}  baskets ${String(s.baskets.length).padStart(2)}  friends ${friends}  soul v${s.reflections.length}`,
    `work ${sum('workHours').toFixed(0)}h rest ${sum('restHours').toFixed(0)}h social ${sum('socialHours').toFixed(0)}h`,
    `top: ${top || '-'}`,
  ].join('  ');
};

console.info(`Simulated ${hours} h for ${garden.engine.museIds().length} Muses in ${seconds} s (mind: ${values.mind}).\n`);
for (const id of garden.engine.museIds()) {
  const s = garden.engine.state(id);
  if (s) console.info(line(s));
}

const pleasantness = garden.engine
  .museIds()
  .flatMap((id) => garden.engine.log(id))
  .flatMap((e) => (e.event.kind === 'hangout' ? [e.event.pleasantness] : []));
const buckets = [0, 0.3, 0.5, 0.7, 1.01].slice(0, -1).map((lo, i, a) => {
  const hi = [0.3, 0.5, 0.7, 1.01][i];
  return `${lo.toFixed(1)}–${(a[i + 1] ?? 1).toFixed(1)}: ${pleasantness.filter((p) => p >= lo && p < hi).length}`;
});
console.info(`\nHangout pleasantness: ${buckets.join('  ')}`);
const all = garden.engine.museIds().flatMap((id) => garden.engine.log(id));
const beyond = all.filter((e) => e.event.kind === 'episode.started' && e.event.plan.activity === 'beyond').length;
const encounters = all.filter((e) => e.event.kind === 'encounter');
const acquainted = all.filter((e) => e.event.kind === 'relationship.changed' && e.event.to === 'acquainted').length;
console.info(`Beyond trips: ${beyond}  encounters: ${encounters.length / 2}  acquaintances: ${acquainted / 2}  encounter pleasantness: ${encounters.map((e) => (e.event.kind === 'encounter' ? e.event.pleasantness.toFixed(2) : '')).slice(0, 12).join(' ')}`);

const owner = garden.engine.museIds().flatMap((id) => garden.views.metrics(id).map((r) => ({ id, ...r })));
const weeks = new Map<number, number[]>();
for (const r of owner) {
  const week = Math.floor((Date.parse(r.day) - Date.parse(values.start.slice(0, 10))) / (7 * 86_400_000));
  weeks.set(week, [...(weeks.get(week) ?? []), r.ownerDrivenShare]);
}
const shares = [...weeks.entries()].sort(([a], [b]) => a - b).map(([w, xs]) => `week ${w + 1}: ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`);
console.info(`Owner-driven trip share: ${shares.join('  ')}`);

if (likes) {
  const log = garden.engine.log(likes.museId);
  const share = (from: number, to: number): string => {
    const trips = log.flatMap((e) => (e.event.kind === 'episode.started' && e.event.plan.activity === 'travel' && e.event.at >= from && e.event.at < to ? [e.event.plan.trip] : []));
    const toward = trips.filter((t) => t.kind !== 'serendipity' && t.topic === likes.topic).length;
    return `${((100 * toward) / Math.max(1, trips.length)).toFixed(1)}% (${toward}/${trips.length})`;
  };
  const liked = log.filter((e) => e.event.kind === 'owner.liked').length;
  const day = 86_400_000;
  console.info(
    `Likes: ${liked} finds about ${likes.topic} liked. Its share of trips: next 3 days ${share(likes.from, likes.from + 3 * day)}  week 2 ${share(start + 7 * day, start + 14 * day)}`,
  );
}

if (hero) {
  const s = garden.engine.state(hero);
  if (s) console.info(`\n${s.seed.name}'s SOUL.md section:\n${renderSoulSection(s)}`);
}
if (values.journal) console.info(garden.views.journalMd(values.journal as MuseId, null) ?? '');

const results = checks(garden.engine, (at, tz) => localDay(at, tz));
console.info('\nChecks:');
for (const c of results) console.info(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name} (${c.detail})`);
garden.store.close();
process.exitCode = results.every((c) => c.pass) ? 0 : 1;
