// Writes work-3weeks.json and work-none.json for every cast member. Deterministic: rerunning gives the same files.
//   npx tsx server/fixtures/make-work.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mix, salt, unit } from '../../src/core/hash';
import { FIXTURES_DIR, loadCast } from './cast';

/** Monday 2 November 2026, in each owner's own time zone. */
const START = { year: 2026, month: 11, day: 2 };
const WEEKS = 3;
const QUARTER = 15;
const MIN_GAP = 2;

type Kind = 'heavy' | 'light' | 'empty';

interface Owner {
  /** Local hours the owner hands Muse work in, [from, to). */
  readonly window: readonly [number, number];
  /** One week's day kinds, reshuffled each week. Free time follows the work given, never the weekday. */
  readonly week: readonly Kind[];
}

const OWNERS: Readonly<Record<string, Owner>> = {
  hero: { window: [8, 19], week: ['heavy', 'heavy', 'heavy', 'light', 'light', 'empty', 'empty'] },
  wren: { window: [9, 20], week: ['heavy', 'heavy', 'light', 'light', 'light', 'empty', 'empty'] },
  juniper: { window: [7, 18], week: ['heavy', 'heavy', 'heavy', 'heavy', 'light', 'empty', 'empty'] },
  moss: { window: [11, 23], week: ['heavy', 'heavy', 'light', 'light', 'empty', 'empty', 'empty'] },
  lark: { window: [9, 21], week: ['heavy', 'heavy', 'heavy', 'light', 'light', 'light', 'empty'] },
  sorrel: { window: [8, 18], week: ['heavy', 'heavy', 'heavy', 'light', 'empty', 'empty', 'empty'] },
  clover: { window: [9, 19], week: ['heavy', 'heavy', 'light', 'light', 'light', 'empty', 'empty'] },
  bramble: { window: [8, 17], week: ['heavy', 'heavy', 'heavy', 'light', 'light', 'empty', 'empty'] },
  thistle: { window: [10, 20], week: ['heavy', 'heavy', 'heavy', 'heavy', 'light', 'empty', 'empty'] },
};

/** Each day kind: total work in quarter hours [min, max], block count [min, max], shortest block. */
const SHAPE: Readonly<Record<Exclude<Kind, 'empty'>, { total: [number, number]; blocks: [number, number]; shortest: number }>> = {
  heavy: { total: [24, 36], blocks: [2, 3], shortest: 4 },
  light: { total: [4, 12], blocks: [1, 2], shortest: 3 },
};

function draw(h: number, lo: number, hi: number): number {
  return lo + Math.floor(unit(h) * (hi - lo + 1));
}

/** Splits `total` into `parts` integers, each at least `least`, with weights drawn from `h`. */
function split(h: number, total: number, parts: number, least: number): number[] {
  const weights = Array.from({ length: parts }, (_, i) => 0.25 + unit(mix(h, i)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const spare = total - least * parts;
  const out = weights.map((w) => least + Math.floor((spare * w) / sum));
  out[parts - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

function shuffled<T>(items: readonly T[], h: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(unit(mix(h, i)) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function offsetMinutes(zone: string, utcMs: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  return m === null ? 0 : (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A local wall-clock time on day `dayIndex` as ISO 8601 with the zone's offset at that instant. */
function localIso(zone: string, dayIndex: number, minutes: number): string {
  const naive = Date.UTC(START.year, START.month - 1, START.day + dayIndex, 0, minutes);
  const offset = offsetMinutes(zone, naive - offsetMinutes(zone, naive) * 60_000);
  const local = new Date(naive);
  const sign = offset < 0 ? '-' : '+';
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return `${date}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** Day kinds for all weeks; reshuffled until some empty day is a weekday and some workday is a weekend. */
function dayKinds(id: string, owner: Owner): Kind[] {
  for (let attempt = 0; ; attempt++) {
    const kinds = Array.from({ length: WEEKS }, (_, w) => shuffled(owner.week, mix(mix(salt(id), w), attempt))).flat();
    const weekend = (i: number) => i % 7 >= 5;
    const emptyWeekday = kinds.some((k, i) => k === 'empty' && !weekend(i));
    const busyWeekend = kinds.some((k, i) => k !== 'empty' && weekend(i));
    if (emptyWeekday && busyWeekend) return kinds;
  }
}

function blocks(id: string, zone: string, owner: Owner, dayIndex: number, kind: Kind): { start: string; end: string }[] {
  if (kind === 'empty') return [];
  const shape = SHAPE[kind];
  const h = mix(mix(salt(id), salt('work')), dayIndex);
  const total = draw(mix(h, 1), ...shape.total);
  const count = Math.min(draw(mix(h, 2), ...shape.blocks), Math.floor(total / shape.shortest));
  const lengths = split(mix(h, 3), total, count, shape.shortest);
  const window = (owner.window[1] - owner.window[0]) * (60 / QUARTER);
  const free = window - total - MIN_GAP * (count - 1);
  const gaps = split(mix(h, 4), free, count + 1, 0).map((g, i) => (i > 0 && i < count ? g + MIN_GAP : g));
  let at = owner.window[0] * (60 / QUARTER);
  return lengths.map((length, i) => {
    at += gaps[i];
    const start = at;
    at += length;
    return { start: localIso(zone, dayIndex, start * QUARTER), end: localIso(zone, dayIndex, at * QUARTER) };
  });
}

function main(): void {
  const { members } = loadCast();
  const busy = Object.fromEntries(
    members.map((m) => {
      const owner = OWNERS[m.id];
      if (owner === undefined) throw new Error(`no owner profile for ${m.id}`);
      return [m.id, dayKinds(m.id, owner).flatMap((kind, day) => blocks(m.id, m.timezone, owner, day, kind))];
    }),
  );
  writeFileSync(join(FIXTURES_DIR, 'work-3weeks.json'), `${JSON.stringify(busy, null, 2)}\n`);
  writeFileSync(join(FIXTURES_DIR, 'work-none.json'), `${JSON.stringify(Object.fromEntries(members.map((m) => [m.id, []])), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
