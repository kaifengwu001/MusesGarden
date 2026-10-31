import { describe, expect, it } from 'vitest';
import { museId } from './ids';
import { categorical, drawFor, exponential, lognormal, probit, softmax } from './rng';

describe('drawFor', () => {
  it('gives the same value for the same (museId, n, kind, k)', () => {
    const a = drawFor(museId('moss'), 7);
    const b = drawFor(museId('moss'), 7);
    expect(a('rest.ms')).toBe(b('rest.ms'));
    expect(a('hop.ms', 3)).toBe(b('hop.ms', 3));
    expect(a('next')).toBe(a('next', 0));
  });

  it('changes with any part of the key', () => {
    const base = drawFor(museId('moss'), 7)('next');
    expect(drawFor(museId('wren'), 7)('next')).not.toBe(base);
    expect(drawFor(museId('moss'), 8)('next')).not.toBe(base);
    expect(drawFor(museId('moss'), 7)('rest')).not.toBe(base);
    expect(drawFor(museId('moss'), 7)('next', 1)).not.toBe(base);
  });

  it('is uniform on [0, 1)', () => {
    const draw = drawFor(museId('moss'), 1);
    const n = 20_000;
    const bins = new Array<number>(10).fill(0);
    for (let k = 0; k < n; k++) {
      const u = draw('u', k);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      bins[Math.floor(u * 10)]++;
    }
    for (const count of bins) expect(Math.abs(count - n / 10)).toBeLessThan(4 * Math.sqrt(n * 0.1 * 0.9));
  });
});

describe('samplers', () => {
  it('probit inverts the normal CDF at known quantiles', () => {
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.01)).toBeCloseTo(-2.326348, 5);
  });

  it('lognormal has the stated median', () => {
    expect(lognormal(0.5, 40, 0.8)).toBeCloseTo(40, 9);
    expect(lognormal(0.9, 40, 0.8)).toBeGreaterThan(40);
  });

  it('exponential has the stated mean', () => {
    const n = 10_000;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += exponential((k + 0.5) / n, 2);
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it('categorical follows the weights and skips zero weights', () => {
    expect(categorical(0.1, [1, 0, 3])).toBe(0);
    expect(categorical(0.3, [1, 0, 3])).toBe(2);
    expect(categorical(0.5, [0, 0])).toBe(-1);
  });

  it('softmax reproduces the plan example (0.55, 0.45, 0.10 at τ 0.15)', () => {
    const p = softmax([0.55, 0.45, 0.1], 0.15);
    expect(p[0]).toBeCloseTo(0.64, 2);
    expect(p[1]).toBeCloseTo(0.33, 2);
    expect(p[2]).toBeCloseTo(0.03, 2);
  });
});
