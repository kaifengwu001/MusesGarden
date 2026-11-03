/**
 * The first planet: the meadow, seed 412 at R 128 m, tuned against its references over seventeen review rounds. Momo,
 * the hero Muse (server/fixtures/cast.json), lives on it. These are src/params.ts's defaults for the seed and the
 * growth slider; the Muse server reads them from here because it can't import params.ts, and params.test.ts holds the
 * two equal. Only Kai changes how the first planet looks: see docs/development-guidelines.md.
 */
export const FIRST_PLANET = { seed: 412, growth: 0.1886 } as const;
