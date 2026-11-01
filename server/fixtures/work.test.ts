import { describe, expect, it } from 'vitest';
import { loadCast } from './cast';
import { loadWork } from './work';

const cast = loadCast();

describe('work schedules', () => {
  const ids = cast.members.map((m) => m.id).sort();
  const wallClock = (zone: string, iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(iso))
      .replace(', ', 'T');

  it('work-none is empty for everyone', () => {
    const none = loadWork('work-none');
    expect(Object.keys(none).sort()).toEqual(ids);
    expect(Object.values(none).every((blocks) => blocks.length === 0)).toBe(true);
  });

  it.each(cast.members.map((m) => [m.id, m] as const))('%s works three weeks of heavy, light and free days, not by weekday', (_, member) => {
    const work = loadWork('work-3weeks');
    expect(Object.keys(work).sort()).toEqual(ids);
    const hoursByDay = new Map<string, number[]>();
    for (const { start, end } of work[member.id]) {
      expect(wallClock(member.timezone, start), 'the offset is the owner’s real offset').toBe(start.slice(0, 16));
      expect(start.slice(0, 10), 'a block stays within one local day').toBe(end.slice(0, 10));
      hoursByDay.set(start.slice(0, 10), [...(hoursByDay.get(start.slice(0, 10)) ?? []), (Date.parse(end) - Date.parse(start)) / 3.6e6]);
    }
    const days = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10));
    expect([...hoursByDay.keys()].every((d) => days.includes(d))).toBe(true);
    const kind = (day: string) => {
      const blocks = hoursByDay.get(day) ?? [];
      const total = blocks.reduce((a, b) => a + b, 0);
      if (total === 0) return 'empty';
      if (total >= 6 && total <= 9 && blocks.length >= 2 && blocks.length <= 3) return 'heavy';
      return total < 6 ? 'light' : 'other';
    };
    const kinds = days.map(kind);
    expect(kinds).not.toContain('other');
    expect(new Set(kinds)).toEqual(new Set(['heavy', 'light', 'empty']));
    const weekend = (i: number) => i % 7 >= 5;
    expect(kinds.some((k, i) => k === 'empty' && !weekend(i)), 'a free weekday').toBe(true);
    expect(kinds.some((k, i) => k !== 'empty' && weekend(i)), 'a working weekend day').toBe(true);
  });
});
