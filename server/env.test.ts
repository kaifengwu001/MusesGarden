import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hash32, mix, salt, unit } from '../src/core/hash';

describe('server environment', () => {
  it('reuses the world renderer hashing in Node', () => {
    const draw = unit(hash32(mix(salt('muse'), 7)));
    expect(draw).toBe(unit(hash32(mix(salt('muse'), 7))));
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
  });

  it('has node:sqlite', () => {
    const db = new DatabaseSync(':memory:');
    expect(db.prepare('select 1 as a').get()).toEqual({ a: 1 });
    db.close();
  });
});
