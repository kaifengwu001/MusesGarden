# Muse's Garden: notes for everyone working here

## The first planet stays as it is

The meadow is the first planet: seed 412 at R 128 m, the defaults in `src/params.ts`. Kai tuned it against its references over seventeen review rounds. Momo, the hero Muse in `server/fixtures/cast.json` (id `hero`), lives on it.

- **Don't change its seed, its size or its look.** That covers the defaults in `src/params.ts`, Momo's `worldSeed`, and `FIRST_PLANET` in `src/planet/firstPlanet.ts`. It also covers the code that draws the meadow: terrain, layout, palette, shaders, grass, flowers, clouds, water and light. Only Kai changes how the first planet looks.
- **Build other worlds beside it.** Use `environments/` (`npm run new-environment`) or a planet of your own with its own seed. Never edit the meadow to make room for them.
- **Momo grows from the meadow's tuned size.** The engine treats a Muse on seed 412 as having explored R 128 m already (`growth` in `server/engine/compose.ts`), and the planet grows from there as it explores.
- **Prove that a change leaves it alone.** A change outside the meadow's look must leave its frames pixel-identical; the `check-frames` skill shows how. A change that alters the meadow's look waits for Kai's review.
- `npm test` guards all this (`src/dev/invariants/params.test.ts`, `server/fixtures/cast.test.ts`, `server/engine/garden.test.ts`). Don't loosen those tests to make a change pass.

If your local garden (`.muse/`, from `npm run serve`) was seeded before the cast of 2026-11-02 (Momo, and the other Muses' new ids), delete it; the next `npm run serve` seeds it again.
