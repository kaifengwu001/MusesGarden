import { beforeAll, describe, expect, it } from 'vitest';
import { FRAME_BUDGET_MS, QualityController, type QualityChange } from '../../core/quality';

// The quality controller (core/quality.ts): Auto keeps the frame rate by the
// render scale and does not rebuild the meadow by changing tiers as you go
// (iterations 6–10 did, and it read as the grass reloading and flickering).

const desktop = { mobile: false, dprCap: 2, gpu: 'test' };

/** Feed `ms` of frames of `frameMs` each; the changes it asked for. */
function run(q: QualityController, frameMs: number, ms: number): QualityChange[] {
  const changes: QualityChange[] = [];
  for (let t = 0; t < ms; t += frameMs) {
    const c = q.observe(frameMs);
    if (c) changes.push(c);
  }
  return changes;
}

beforeAll(() => {
  // the controller skips frames while the page is hidden
  (globalThis as { document?: unknown }).document ??= { hidden: false };
});

describe('quality controller', () => {
  it('starts a desktop on medium under Auto, and on what was chosen otherwise', () => {
    const q = new QualityController(desktop);
    q.choose('auto', 0.4);
    expect(q.tier.name).toBe('medium');
    q.choose('high', 0.4);
    expect(q.tier.name).toBe('high');
    q.choose('auto', 3);
    expect(q.tier.name).toBe('low');
  });

  it('meets slow frames with the render scale, never the tier, down to its floor', () => {
    const q = new QualityController(desktop);
    q.choose('auto', 0.4);
    const changes = run(q, 24, 30000);
    expect(changes.every((c) => c === 'scale')).toBe(true);
    expect(q.tier.name).toBe('medium');
    expect(q.renderScale).toBeCloseTo(0.6, 2);
  });

  it('never puts the scale back up when it steps down', () => {
    const q = new QualityController(desktop);
    q.choose('auto', 0.4);
    let last = q.renderScale;
    for (let t = 0; t < 20000; t += 24) {
      if (q.observe(24) === 'scale') {
        expect(q.renderScale).toBeLessThan(last);
        last = q.renderScale;
      }
    }
  });

  it('steps an Auto tier down only when far too slow at the floor, keeping the scale, and never back up', () => {
    const q = new QualityController(desktop);
    q.choose('auto', 0.4);
    run(q, 40, 60000);
    expect(q.tier.name).toBe('low');
    expect(q.renderScale).toBeCloseTo(0.6, 2);
    run(q, FRAME_BUDGET_MS, 120000);
    expect(q.tier.name).toBe('low');
  });

  it('steps the scale back up on steady frames, waiting twice as long after a step up that did not hold', () => {
    const q = new QualityController(desktop);
    q.choose('auto', 0.4);
    run(q, 24, 5000);
    const low = q.renderScale;
    expect(low).toBeLessThan(1);
    // steady: one step up about 6 s after the frames settle (their average takes a moment to fall)
    expect(run(q, FRAME_BUDGET_MS, 5500)).toEqual([]);
    expect(run(q, FRAME_BUDGET_MS, 2000)).toEqual(['scale']);
    // too much: slow again at once, so it steps down, and the next try waits about 12 s
    expect(run(q, 24, 2500)).toEqual(['scale']);
    expect(run(q, FRAME_BUDGET_MS, 11000)).toEqual([]);
    expect(run(q, FRAME_BUDGET_MS, 2000)).toEqual(['scale']);
  });

  it('leaves a chosen tier alone, however slow', () => {
    const q = new QualityController(desktop);
    q.choose('high', 0.4);
    run(q, 40, 60000);
    expect(q.tier.name).toBe('high');
  });
});
