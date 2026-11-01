// npx tsx --no-warnings server/cli/seeds.ts [--seeds 20] [--hours 504]
// Runs the cast on several run seeds and tabulates, from the logs, how friendships began, drifted and ended.
import { parseArgs } from 'node:util';
import type { Instant, MuseId, StoredEvent } from '../../src/muse/contract';
import { lifePolicy } from '../domain/policy/index';
import { distanceAfter, isUnpleasant } from '../domain/social/relationships';
import { buildGarden } from '../engine/compose';
import { loadCast } from '../fixtures/cast';
import { run, seedCast } from './run';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    hours: { type: 'string', default: '504' },
    cast: { type: 'string', default: 'server/fixtures/cast.json' },
    work: { type: 'string', default: 'server/fixtures/work-3weeks.json' },
    start: { type: 'string', default: '2026-11-01T13:00:00Z' },
  },
});

const H = 3_600_000;
const start = Date.parse(values.start) as Instant;
const hours = Number(values.hours);
const cast = loadCast(values.cast);
const key = (a: string, b: string) => [a, b].sort().join('+');
const knownMuses = new Set<string>(cast.members.filter((m) => m.role === 'known').map((m) => m.id));

interface Row {
  readonly seed: number;
  readonly sharedFirstMeetH: readonly number[];
  readonly knownOn: { readonly pairs: number; readonly friends: number };
  readonly strangers: number;
  /** Stranger friendships between Muses that aren't 'known', the cast before the known Muses joined. */
  readonly strangersBefore: number;
  readonly made: number;
  readonly drifted: number;
  readonly unshared: number;
  readonly invitations: { readonly sent: number; readonly used: number };
  readonly hangouts: number;
  /** Friend pairs at the end of the run, and those of them grown distant (distance ≥ 0.5). */
  readonly friendsAtEnd: number;
  readonly distantAtEnd: number;
  /** Pairs that were distant at some point, hangouts they had while distant, and unpleasant hangouts overall. */
  readonly grewDistant: number;
  readonly hangoutsWhileDistant: number;
  readonly unpleasant: number;
}

async function one(seed: number): Promise<Row> {
  const garden = buildGarden({ db: null, mind: 'heuristic', hero: null, start, clock: 'fast-forward', seed });
  const opts = { cast: values.cast, work: values.work, start, hours } as const;
  await seedCast(garden.engine, lifePolicy, opts);
  await run(garden.engine, opts);
  const logs = new Map<MuseId, readonly StoredEvent[]>(garden.engine.museIds().map((id) => [id, garden.engine.log(id)]));
  const friendsAtEnd = garden.engine
    .museIds()
    .flatMap((id) => [...(garden.engine.state(id)?.social.relationships.values() ?? [])].filter((r) => r.status === 'friends' && id < r.other));
  garden.store.close();

  const pairEvents = [...logs].flatMap(([self, log]) => log.filter((e) => 'other' in e.event && self < (e.event as { other: MuseId }).other));
  const firstHangout = new Map<string, number>();
  const friendsBy = new Map<string, string>();
  let drifted = 0;
  let unshared = 0;
  for (const e of pairEvents) {
    const ev = e.event;
    if (ev.kind === 'hangout') {
      const k = key(e.museId, ev.other);
      if (!firstHangout.has(k)) firstHangout.set(k, ev.at);
    }
    if (ev.kind === 'relationship.changed' && ev.to === 'friends') friendsBy.set(key(e.museId, ev.other), ev.origin);
    if (ev.kind === 'relationship.changed' && ev.to === 'ended') {
      if (ev.reason === 'owner-unshared') unshared++;
      else drifted++;
    }
  }
  const made = pairEvents.filter((e) => e.event.kind === 'relationship.changed' && e.event.to === 'friends').length;
  const pairs = new Map<string, { rapport: number; hangouts: number; distance: number; wasDistant: boolean }>();
  let hangoutsWhileDistant = 0;
  let unpleasant = 0;
  for (const e of pairEvents) {
    if (e.event.kind !== 'hangout') continue;
    const k = key(e.museId, e.event.other);
    const r = pairs.get(k) ?? { rapport: 0, hangouts: 0, distance: 0, wasDistant: false };
    if (r.distance >= 0.5) hangoutsWhileDistant++;
    const bad = isUnpleasant(e.event.pleasantness, r);
    if (bad) unpleasant++;
    const distance = distanceAfter(r.distance, bad);
    pairs.set(k, { rapport: r.rapport + e.event.pleasantness, hangouts: r.hangouts + 1, distance, wasDistant: r.wasDistant || distance >= 0.5 });
  }
  const knownPairs = cast.knownOn.map((p) => key(p.a, p.b));
  const invitationIds = (to: string) =>
    new Set([...logs.values()].flatMap((log) => log.flatMap((e) => (e.event.kind === 'invitation' && e.event.to === to ? [e.event.id] : [])))).size;
  return {
    seed,
    sharedFirstMeetH: cast.introductions.map(([a, b]) => ((firstHangout.get(key(a, b)) ?? Infinity) - start) / H),
    knownOn: { pairs: knownPairs.length, friends: knownPairs.filter((k) => friendsBy.get(k) === 'known-on').length },
    strangers: [...friendsBy.values()].filter((o) => o === 'met-beyond').length,
    strangersBefore: [...friendsBy].filter(([pair, o]) => o === 'met-beyond' && pair.split('+').every((id) => !knownMuses.has(id))).length,
    made,
    drifted,
    unshared,
    invitations: { sent: invitationIds('sent'), used: invitationIds('used') },
    hangouts: pairEvents.filter((e) => e.event.kind === 'hangout').length,
    friendsAtEnd: friendsAtEnd.length,
    distantAtEnd: friendsAtEnd.filter((r) => r.distance >= 0.5).length,
    grewDistant: [...pairs.values()].filter((p) => p.wasDistant).length,
    hangoutsWhileDistant,
    unpleasant,
  };
}

const rows: Row[] = [];
for (let seed = 0; seed < Number(values.seeds); seed++) rows.push(await one(seed));

const pad = (x: string | number, n: number) => String(x).padStart(n);
console.info(`${pad('seed', 4)} ${pad('shared first meet (h)', 22)} ${pad('known-on', 9)} ${pad('strangers', 9)} ${pad('made', 5)} ${pad('drifted', 7)} ${pad('unshared', 8)} ${pad('inv sent/used', 13)}`);
for (const r of rows) {
  const meet = r.sharedFirstMeetH.map((h) => (Number.isFinite(h) ? h.toFixed(0) : 'never')).join(', ');
  console.info(
    `${pad(r.seed, 4)} ${pad(meet, 22)} ${pad(`${r.knownOn.friends}/${r.knownOn.pairs}`, 9)} ${pad(r.strangers, 9)} ${pad(r.made, 5)} ${pad(r.drifted, 7)} ${pad(r.unshared, 8)} ${pad(`${r.invitations.sent}/${r.invitations.used}`, 13)}`,
  );
}
const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
const meets = rows.flatMap((r) => r.sharedFirstMeetH);
const known = { friends: sum((r) => r.knownOn.friends), pairs: sum((r) => r.knownOn.pairs) };
console.info(`\nShared pairs meeting within 48 h: ${meets.filter((h) => h <= 48).length}/${meets.length} (slowest ${Math.max(...meets).toFixed(1)} h)`);
console.info(`Known-on pairs befriended: ${known.friends}/${known.pairs}${known.pairs ? ` (${((100 * known.friends) / known.pairs).toFixed(0)}%)` : ''}`);
const strangers = (f: (r: Row) => number, label: string) =>
  console.info(`Strangers befriended${label}: ${sum(f)} over ${rows.length} runs (${(sum(f) / rows.length).toFixed(2)} a run; runs with one: ${rows.filter((r) => f(r) > 0).length})`);
strangers((r) => r.strangers, '');
strangers((r) => r.strangersBefore, ' among Muses not known online');
console.info(`Friendships made: ${sum((r) => r.made)}; ended without an unshare: ${sum((r) => r.drifted)} (${((100 * sum((r) => r.drifted)) / Math.max(1, sum((r) => r.made))).toFixed(1)}%); unshared: ${sum((r) => r.unshared)}`);
console.info(`Friends at the end: ${sum((r) => r.friendsAtEnd)}, distant: ${sum((r) => r.distantAtEnd)}`);
console.info(`Unpleasant hangouts: ${sum((r) => r.unpleasant)}; pairs that grew distant: ${sum((r) => r.grewDistant)}, meeting ${sum((r) => r.hangoutsWhileDistant)} times while distant`);
console.info(`Hangouts: ${(sum((r) => r.hangouts) / rows.length).toFixed(1)} a run`);
console.info(`Invitations sent ${sum((r) => r.invitations.sent)}, used ${sum((r) => r.invitations.used)}; runs with one used: ${rows.filter((r) => r.invitations.used > 0).length}`);
