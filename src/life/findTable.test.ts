import { describe, expect, it } from 'vitest';
import { FindTable, LONG_AGO, NOT_YET, PER_ROW, STRIDE } from './findTable';

const ids = (n: number, prefix = 'find'): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** Settle every lift and mark (well past their easing times). */
function settle(table: FindTable): void {
  for (let i = 0; i < 300; i++) table.ease(1 / 30);
}

describe('FindTable', () => {
  it('gives any number of finds a row each, the texture growing a row per PER_ROW finds', () => {
    const table = new FindTable();
    const list = ids(1000);
    table.assign(list, new Set());
    expect(table.size).toBe(1000);
    expect(table.rows).toBe(Math.ceil(1000 / PER_ROW));
    expect(table.data.length).toBe(table.rows * PER_ROW * STRIDE);
    expect(new Set(list.map((id) => table.slot(id))).size).toBe(1000);
    expect(list.every((id) => table.get(id, 'planted') === LONG_AGO)).toBe(true);
  });

  it('keeps each find hidden until it is planted, then plants them one after another', () => {
    const table = new FindTable();
    const list = ids(5);
    table.assign(list, new Set(list.slice(0, 3)));
    expect(list.map((id) => table.get(id, 'planted'))).toEqual([NOT_YET, NOT_YET, NOT_YET, LONG_AGO, LONG_AGO]);
    table.plant(list.slice(0, 3), 10, 0.5);
    expect(list.slice(0, 3).map((id) => table.get(id, 'planted'))).toEqual([10, 10.5, 11]);
    table.unplant([list[4]]);
    expect(table.get(list[4], 'planted')).toBe(NOT_YET);
  });

  it('keeps a find’s planting, pulse, card and mark when the garden is laid out again round a newer basket', () => {
    const table = new FindTable();
    const old = ids(300, 'old');
    table.assign(old, new Set());
    table.plant([old[7]], 4, 0);
    table.pulse([old[7]], 6);
    table.open(old[7]);
    table.select([old[7], old[299]]);
    settle(table);
    const fresh = ids(20, 'new');
    table.assign([...fresh, ...old], new Set(fresh));
    expect(table.slot(old[7])).toBe(27);
    expect(table.get(old[7], 'planted')).toBe(4);
    expect(table.get(old[7], 'pulsed')).toBe(6);
    expect(table.get(old[7], 'open')).toBe(1);
    expect(table.get(old[7], 'mark')).toBe(1);
    expect(table.get(old[299], 'mark')).toBe(1);
    expect(table.get(old[0], 'mark')).toBe(0);
    expect(table.get(fresh[0], 'planted')).toBe(NOT_YET);
    // a find no longer hidden stands grown
    table.assign([...fresh, ...old], new Set());
    expect(table.get(fresh[0], 'planted')).toBe(LONG_AGO);
  });

  it('marks the picked basket’s finds until another basket is picked, through cards opening and closing', () => {
    const table = new FindTable();
    const a = ids(4, 'a');
    const b = ids(3, 'b');
    table.assign([...a, ...b], new Set());
    table.select(a);
    table.ease(0.1);
    const easing = table.get(a[0], 'mark') ?? 0;
    expect(easing).toBeGreaterThan(0);
    expect(easing).toBeLessThan(1);
    settle(table);
    expect(a.map((id) => table.get(id, 'mark'))).toEqual([1, 1, 1, 1]);
    expect(b.map((id) => table.get(id, 'mark'))).toEqual([0, 0, 0]);
    table.open(a[1]);
    table.open(null);
    settle(table);
    expect(table.selected).toEqual(a);
    expect(a.map((id) => table.get(id, 'mark'))).toEqual([1, 1, 1, 1]);
    table.select(b);
    settle(table);
    expect(a.map((id) => table.get(id, 'mark'))).toEqual([0, 0, 0, 0]);
    expect(b.map((id) => table.get(id, 'mark'))).toEqual([1, 1, 1]);
  });

  it('lights one card and lifts one find under the pointer at a time', () => {
    const table = new FindTable();
    const list = ids(3);
    table.assign(list, new Set());
    table.open(list[0]);
    table.open(list[1]);
    expect(list.map((id) => table.get(id, 'open'))).toEqual([0, 1, 0]);
    table.hover(list[2]);
    settle(table);
    expect(table.hovered).toBe(list[2]);
    expect(list.map((id) => table.get(id, 'lift'))).toEqual([0, 0, 1]);
    table.hover(list[0]);
    settle(table);
    expect(list.map((id) => table.get(id, 'lift'))).toEqual([1, 0, 0]);
  });

  it('starts every find with its hero flower out of focus, landed long ago and at home (the shader draws it as before)', () => {
    const table = new FindTable();
    const list = ids(300);
    table.assign(list, new Set(list.slice(0, 5)));
    for (const id of list) {
      expect(table.get(id, 'focus')).toBe(0);
      expect(table.get(id, 'landed')).toBe(LONG_AGO);
      expect(table.get(id, 'away')).toBe(0);
    }
  });

  it('brings one find’s hero into focus at a time, easing in and out', () => {
    const table = new FindTable();
    const list = ids(3);
    table.assign(list, new Set());
    table.focus(list[0]);
    table.ease(0.05);
    const easing = table.get(list[0], 'focus') ?? 0;
    expect(easing).toBeGreaterThan(0);
    expect(easing).toBeLessThan(1);
    settle(table);
    expect(table.focused).toBe(list[0]);
    expect(list.map((id) => table.get(id, 'focus'))).toEqual([1, 0, 0]);
    table.focus(list[2]);
    settle(table);
    expect(list.map((id) => table.get(id, 'focus'))).toEqual([0, 0, 1]);
    table.focus(null);
    settle(table);
    expect(list.map((id) => table.get(id, 'focus'))).toEqual([0, 0, 0]);
  });

  it('marks when a find’s flower landed, and hides or shows its hero, by find', () => {
    const table = new FindTable();
    const list = ids(3);
    table.assign(list, new Set());
    const v = table.version;
    table.land(list[1], 12.5);
    table.away(list[2], true);
    expect(table.version).toBeGreaterThan(v);
    expect(list.map((id) => table.get(id, 'landed'))).toEqual([LONG_AGO, 12.5, LONG_AGO]);
    expect(list.map((id) => table.get(id, 'away'))).toEqual([0, 0, 1]);
    table.away(list[2], false);
    expect(table.get(list[2], 'away')).toBe(0);
    // a find not in the garden is left alone
    table.land('elsewhere', 3);
    expect(table.get('elsewhere', 'landed')).toBeUndefined();
  });

  it('keeps a find’s focus, landing and absence when the garden is laid out again', () => {
    const table = new FindTable();
    const old = ids(4, 'old');
    table.assign(old, new Set());
    table.focus(old[1]);
    settle(table);
    table.land(old[1], 7);
    table.away(old[3], true);
    table.assign([...ids(2, 'new'), ...old], new Set());
    expect(table.get(old[1], 'focus')).toBe(1);
    expect(table.get(old[1], 'landed')).toBe(7);
    expect(table.get(old[3], 'away')).toBe(1);
    expect(table.get('new-0', 'landed')).toBe(LONG_AGO);
  });

  it('counts a version on every change, so the texture uploads only then', () => {
    const table = new FindTable();
    table.assign(ids(2), new Set());
    const v = table.version;
    table.ease(1 / 60);
    expect(table.version).toBe(v);
    table.pulse(['find-0'], 1);
    expect(table.version).toBeGreaterThan(v);
  });
});
