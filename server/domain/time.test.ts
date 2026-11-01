import { describe, expect, it } from 'vitest';
import { localClock, localDay, localHour, localInstant, nextDay } from './time';

const LA = 'America/Los_Angeles';

describe("the owner's clock", () => {
  it('names the local day, not the UTC day', () => {
    const t = Date.parse('2026-11-04T03:30:00Z');
    expect(localDay(t, LA)).toBe('2026-11-03');
    expect(localDay(t, 'Asia/Tokyo')).toBe('2026-11-04');
    expect(localHour(t, LA)).toBeCloseTo(19.5, 9);
  });

  it('finds the instant a local clock time happens, across DST', () => {
    expect(localInstant('2026-11-04', '09:00', LA)).toBe(Date.parse('2026-11-04T09:00:00-08:00'));
    expect(localInstant('2026-07-04', '09:00', LA)).toBe(Date.parse('2026-07-04T09:00:00-07:00'));
    expect(localClock(localInstant('2026-11-01', '07:15', LA), LA)).toBe('07:15');
  });

  it('steps days across month ends', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});
