import { describe, it } from 'vitest';

// The stability invariants from the brief, scaffolded with the stage that
// makes each one testable. Each todo becomes a real test in that stage.

describe('no swimming (S1)', () => {
  it.todo('growing g 0.3 → 0.7 → 0.3 leaves every pre-existing feature direction and seed unchanged');
  it.todo('a point set prefix is identical whatever path g took to reach a value');
});

describe('constant density (S1, S5)', () => {
  it.todo('progressive points per m² stay within ±5 % across the growth range, globally');
  it.todo('the same holds in local patches near face centres, edges and corners (area element J)');
  it.todo('flowers per m² stay within ±5 % across the growth range');
});

describe('constant scale (S3–S6)', () => {
  it.todo('blade height, flower size, channel width and cottage size in meters match at R_min and R_max');
});

describe('everything stays attached (S6)', () => {
  it.todo('props, stones and flower bases sit on the terrain at 5 growth values (no floating, no burying)');
});

describe('macro unlocks (S9)', () => {
  it.todo('pond 2, the channel branch and the mountain spur unlock at their area thresholds and only there');
});
