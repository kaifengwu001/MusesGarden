import { describe, expect, it } from 'vitest';
import type { Dir, Instant } from '../contract';
import { dirAlong, type Route } from './route';

const HOME: Dir = [0, 1, 0];
const EAST: Dir = [1, 0, 0];
const NORTH: Dir = [0, 0, -1];
const at = (minutes: number) => (minutes * 60_000) as Instant;
const angle = (a: Dir, b: Dir) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

// Home at 0, a jump to EAST at 10, a walk to NORTH arriving at 50.
const route: Route = [
  { dir: HOME, at: at(0) },
  { dir: EAST, at: at(10), transport: true },
  { dir: NORTH, at: at(50) },
];

describe('dirAlong', () => {
  it('waits at the start before the route begins', () => {
    expect(dirAlong(route, at(-5))).toEqual(HOME);
  });

  it('waits where it is until a transport jump, then appears at once', () => {
    expect(dirAlong(route, at(9.9))).toEqual(HOME);
    expect(angle(dirAlong(route, at(10)) ?? HOME, EAST)).toBeLessThan(1e-9);
  });

  it('walks the great circle at a steady pace between points', () => {
    const quarter = dirAlong(route, at(20)) ?? HOME;
    expect(Math.hypot(...quarter)).toBeCloseTo(1, 12);
    expect(angle(EAST, quarter)).toBeCloseTo(Math.PI / 8, 9);
    expect(angle(quarter, NORTH)).toBeCloseTo((3 * Math.PI) / 8, 9);
  });

  it('stays at the last point once the route is done', () => {
    expect(dirAlong(route, at(90))).toEqual(NORTH);
  });

  it('has nowhere to be on an empty route', () => {
    expect(dirAlong([], at(0))).toBeNull();
  });
});
