// The owner's clock. Day counters, caps and journals run on the owner's local day, not UTC.
import type { Instant } from '../../src/muse/contract';
import { instant } from './ids';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(timezone: string): Intl.DateTimeFormat {
  let f = formats.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formats.set(timezone, f);
  }
  return f;
}

function localParts(at: number, timezone: string): LocalParts {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  for (const p of format(timezone).formatToParts(at)) {
    if (p.type === 'year' || p.type === 'month' || p.type === 'day' || p.type === 'hour' || p.type === 'minute') out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD on the owner's clock. */
export function localDay(at: number, timezone: string): string {
  const p = localParts(at, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hours since local midnight, in [0, 24). */
export function localHour(at: number, timezone: string): number {
  const p = localParts(at, timezone);
  return p.hour + p.minute / 60;
}

/** HH:MM on the owner's clock. */
export function localClock(at: number, timezone: string): string {
  const p = localParts(at, timezone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:MM" → minutes after midnight, or null when malformed. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

function offsetAt(at: number, timezone: string): number {
  const p = localParts(at, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - (at - (at % MINUTE_MS));
}

/** The instant the owner's clock reads `hhmm` on local `day`. */
export function localInstant(day: string, hhmm: string, timezone: string): Instant {
  const [y, m, d] = day.split('-').map(Number);
  const minutes = parseClock(hhmm) ?? 0;
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = guess - offsetAt(guess, timezone);
  return instant(guess - offsetAt(first, timezone));
}

/** The local day after `day`. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
