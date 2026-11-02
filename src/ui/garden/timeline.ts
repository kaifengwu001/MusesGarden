import { smoothstep } from '../../core/math';
import { basketDay } from './dom';

// The day picker under an open basket: a dot per basket along a track, placed
// by its day, the oldest at the left end and the newest at the right. Round a
// focus (the pointer, or the picked day) the track bulges like a lens: the
// dots nearest it spread at least MIN_SPREAD px apart so a dense run of days
// stays easy to hit, the rest close up to make room, the ends stay where they
// are and no dot passes another. A track already roomy enough is left as its
// days put it.

/** The least distance (px) between the dots round the focus. */
export const MIN_SPREAD = 28;
/** Month names closer than this (px) to the last one named go unnamed. */
const LABEL_GAP = 32;
/** The lens's core, in gaps either side of the focus at most (it fades out over half as many again), and the share of the track it may take. */
const CORE = 2;
const LENS_SHARE = 0.55;
/** The share of each side's own length its far dots keep, however hard the lens presses. */
const KEEP = 0.2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface MonthTick {
  /** Where the month starts on the track (px). */
  readonly x: number;
  /** 'Nov', or 'Jan 2027' at a new year; null where the last name is too near. */
  readonly label: string | null;
}

export interface TimelineLayout {
  /** Each day's dot (px from the track's left end), in the order the days were given. */
  readonly xs: readonly number[];
  readonly ticks: readonly MonthTick[];
}

const DAY = 86_400_000;

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / DAY;
}

/** The scale c at which a side's gaps, max(c · base, need) each, fill `room`. */
function squeeze(base: readonly number[], need: readonly number[], room: number): number {
  const total = (c: number): number => base.reduce((sum, b, i) => sum + Math.max(c * b, need[i]), 0);
  const length = base.reduce((sum, b) => sum + b, 0);
  if (length <= 0) return 0;
  let lo = 0;
  let hi = Math.max(1, room / length) * 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) < room) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fill `room` with these gaps: each max(c · base, need), or (no base length to scale) shared out by need. */
function fill(base: readonly number[], need: readonly number[], room: number): number[] {
  const c = squeeze(base, need, room);
  const gaps = base.map((b, i) => Math.max(c * b, need[i]));
  const sum = gaps.reduce((s, g) => s + g, 0);
  if (sum > 0) return gaps.map((g) => (g * room) / sum);
  return gaps.map(() => room / Math.max(1, gaps.length));
}

/**
 * The track for these days (ISO dates, any order) on a track `width` px long, with the lens at `focusX`
 * (px along the track; null: no lens).
 */
export function timelineLayout(days: readonly string[], focusX: number | null, width: number): TimelineLayout {
  const n = days.length;
  if (n === 0) return { xs: [], ticks: [] };
  const order = days.map((_, i) => i).sort((a, b) => (days[a] < days[b] ? -1 : days[a] > days[b] ? 1 : a - b));
  const t = order.map((i) => dayNumber(days[i]));
  const span = t[n - 1] - t[0];
  if (n === 1) return { xs: [width / 2], ticks: [] };
  // where the days put the dots, and the gaps between them
  const u = t.map((d, k) => (span > 0 ? ((d - t[0]) / span) * width : (k / (n - 1)) * width));
  const base = u.slice(1).map((x, k) => x - u[k]);
  const xs = focusX === null ? u : lens(u, base, Math.min(width, Math.max(0, focusX)), width);
  xs[0] = 0;
  xs[n - 1] = width;
  const out = new Array<number>(n);
  order.forEach((i, k) => (out[i] = xs[k]));
  return { xs: out, ticks: span > 0 ? months(t, xs) : [] };
}

/**
 * The dots (sorted) with the lens at `at`: the days nearest it spread, the point there kept where it is, unless
 * it is too near an end for the spread dots on that side: then the lens stands in from the end just far enough.
 */
function lens(u: readonly number[], base: readonly number[], at: number, width: number): number[] {
  const n = u.length;
  // the focus as a place among the dots: gap k, a fraction f of the way across it
  let k = 0;
  while (k < n - 2 && u[k + 1] < at) k++;
  const f = base[k] > 0 ? Math.min(1, Math.max(0, (at - u[k]) / base[k])) : 0.5;
  const focus = k + f;
  const core = Math.max(0.5, Math.min(CORE, (LENS_SHARE * width) / (2.5 * MIN_SPREAD)));
  // near an end, the few days between the focus and it open up too (the newest days most of all)
  const toEnd = (days: number): number => 1 - smoothstep(1.5 * core, 6 * core, days);
  const ends = { left: toEnd(focus), right: toEnd(n - 1 - focus) };
  const need = base.map((_, g) => {
    const away = g + 0.5 - focus;
    return MIN_SPREAD * Math.max(1 - smoothstep(core, 1.5 * core, Math.abs(away)), away < 0 ? ends.left : ends.right);
  });
  // each side's pieces: the gaps before the focus and the part of gap k before it; then the rest
  const leftBase = [...base.slice(0, k), f * base[k]];
  const leftNeed = [...need.slice(0, k), f * need[k]];
  const rightBase = [(1 - f) * base[k], ...base.slice(k + 1)];
  const rightNeed = [(1 - f) * need[k], ...need.slice(k + 1)];
  const sum = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0);
  const lo = sum(leftNeed) + KEEP * sum(leftBase);
  const hi = width - sum(rightNeed) - KEEP * sum(rightBase);
  const x = lo <= hi ? Math.min(hi, Math.max(lo, at)) : (lo + hi) / 2;
  const left = fill(leftBase, leftNeed, x);
  const right = fill(rightBase, rightNeed, width - x);
  const xs = new Array<number>(n);
  xs[k] = x - left[k];
  for (let g = k - 1; g >= 0; g--) xs[g] = xs[g + 1] - left[g];
  xs[k + 1] = x + right[0];
  for (let g = k + 1; g < n - 1; g++) xs[g + 1] = xs[g] + right[g - k];
  return xs;
}

/** A tick where each month after the first day starts, carried through the lens as the dots are. */
function months(t: readonly number[], xs: readonly number[]): MonthTick[] {
  const n = t.length;
  const first = new Date(t[0] * DAY);
  const ticks: MonthTick[] = [];
  let named = -Infinity;
  for (let m = 1; ; m++) {
    const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m, 1));
    const d = start.getTime() / DAY;
    if (d > t[n - 1]) break;
    // between the dots either side of it, as far along as its day
    let k = 0;
    while (k < n - 2 && t[k + 1] < d) k++;
    const along = t[k + 1] > t[k] ? Math.min(1, Math.max(0, (d - t[k]) / (t[k + 1] - t[k]))) : 0;
    const x = xs[k] + (xs[k + 1] - xs[k]) * along;
    const month = MONTHS[start.getUTCMonth()];
    const label = x - named >= LABEL_GAP ? (start.getUTCMonth() === 0 ? `${month} ${start.getUTCFullYear()}` : month) : null;
    if (label) named = x;
    ticks.push({ x, label });
  }
  return ticks;
}

/** The dot nearest a point on the track (its index in the days given). */
export function nearestDot(layout: TimelineLayout, x: number): number {
  let best = 0;
  layout.xs.forEach((dot, i) => {
    if (Math.abs(dot - x) < Math.abs(layout.xs[best] - x)) best = i;
  });
  return best;
}

/** Over the picked or hovered dot: 'Today, Nov 1 Sun · Ferns and ink', 'Oct 28 Wed', 'Oct 21 Wed · Ferns and ink'. */
export function dayLabel(day: string, title?: string, now = new Date()): string {
  const date = basketDay(day, now);
  return title ? `${date} · ${title}` : date;
}
