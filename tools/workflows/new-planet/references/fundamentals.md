# The shared fundamentals, and how a planet plugs in

How it is built is in ARCHITECTURE.md (the meadow's design as built); read its sections when you touch a system. This page says what each system gives a new planet, where it is, and what has gone wrong with it.

The terraces branch adds `src/planetWorld.ts`: the interface a planet's world implements, a planet choice in params, and travel between planets behind a mist. A planet's own files live in their own folder (`src/terraces/`: fields, bake, ground, paddies, palette, fog, water, world). Once that branch is merged, follow its pattern; until then, read it in the terraces worktree.

## The four spaces (the rule under everything)

| Space | Holds | Changes with growth |
|---|---|---|
| Rest: a unit direction on the sphere | each feature's identity: direction, seed, rank | never |
| Face: the spherified cube's 6 faces | quadtrees, chunks, point hierarchies | never |
| Planet: meters, P = ω(R + h) | what the GPU draws before the warp | R and h |
| View: warp(P) | what you see | every frame |

Identity and placement come from rest space, and sizes come from meters. Only the distance between things depends on R. Nothing is ever placed by "a random position at the current size".

## Systems

| System | Where | Gives | A planet decides | Watch for |
|---|---|---|---|---|
| Spherified cube, CDLOD | `planet/cubesphere.ts/.glsl`, `chunks.ts`, `surface.ts/.vert/.frag` | 6 quadtrees, morphing nodes, one instanced grid; per-node defines (the near-home and away split) | grid steps; what the ground shader draws | rings or popping in a 10 s dolly (the invariant); `normalize()` mapping makes uneven cells |
| Rest space, ranked blue noise | `planet/rest.ts/.glsl` | stable points per class; constant density per m² (N = ρ·A·coverage); `presence()` thins at full size | each feature class and its density | no swimming and ±5 % density (Vitest); never re-place on growth |
| Growth | `planet/growth.ts` | R = √(A/4π) from g; R 40–400, default 128 | what stretches (macro, in direction space) and what stays in meters | meter things scaled with R; zoom stops not in meters |
| Terrain fields and bake | `planet/fields.ts/.glsl`, `terrain.ts/.glsl`, `bake.ts`, `bake.frag.glsl` | a cubemap of fields (height, lush, wet, variant, plus a flora bake) read per pixel, so shores stay crisp at any mesh density; a CPU mirror for the camera, picking and placement | the field functions (the meadow: hills, hollows and wetlands; the terraces: terraces and paddies) | the bake needs R if shapes are in meters; CPU and GPU must agree (`parity()`); features finer than a bake texel (0.4 m at R 128) must stay per pixel |
| Water | `planet/terrain.glsl` (water table, `bankedAt`), `planet/water.glsl`, `life/waterMask.ts` | level water at a table; banks; the mirror (sky, clouds, banks, the cottage) shaded only where a lake can show it | water bodies (the terraces: paddies with their own levels and states) | an outline instead of a reflection; jagged banks; teeth at a pond's edge |
| Tiny-planet warp | `render/warp.ts`, `warp.glsl` | pull-down by d²/2R_v − d²/2R in every vertex shader; the CPU mirror for picking | R_visual, and its follow-the-zoom curve | any pass without the warp (the shadow pass and reflections too) |
| Light and look | `render/palette.ts` (16×16), `toon.glsl`, `sun.ts/.glsl`, `fog.glsl`, `sky.ts`, `post.ts` (tone, bloom, grain), `look.ts` | palette rows and columns (light → shade, then hues); 3 soft toon bands; the sun fixed to the planet (each place its own); aerial haze | the palette rows, measured from the colour reference; the grade | colours by eye instead of measured; light from the view instead of the planet |
| Clouds | `life/clouds.ts`, `cloud*.glsl`, `cloudShadow*` | one system: puffs to traced billboards, a sun-space shadow cube plus a sharp window near the focus, the mirror | coverage, altitude, banks against terrain (the terraces: valley fog) | shadows stuttering (judge from a few meters up with clouds drifting); clouds, shadows and reflections disagreeing |
| Near field (grass, flowers) | `life/grass.ts`, `flowers.ts`, `scatter.ts`, `fieldMap.ts`, `core/buildQueue.ts`, `buildBudget.ts` | tiles built in view first, pools as textures, a field map the blades read; builds in the time each frame leaves | the cover (rice, crops, forest floor); its density per m² | chunks loading slowly or late; a missing strip for a frame; blades that grow in |
| Life | `life/birds.ts`, `butterflies.ts`, `petals.ts` | flocks on routes (with silhouette shadows), butterflies when close, petals in gusts | which creatures, and where | birds that fly like butterflies; wings beating too fast; anything left fixed while the globe turns |
| Buildings and props | `life/props.ts`, `props.vert/.frag` | bent to the planet (each vertex placed from local meters, so walls stay square to the ground) | the buildings (match a reference one to one if Kai asks) | floating parts; feet lifting off small planets; painted-on details that should be geometry |
| Frame and quality | `main.ts`, `core/quality.ts`, `render/post.ts` (`setView`) | a resize only before the update; Auto trims the render scale (floor 0.5) and holds the tier; no reallocation | nothing, usually | a resize after the draw is a blank frame; switching tiers live reads as the world reloading |
| State and harness | `params.ts`, `core/hashSync.ts`, `dev/harness.ts`, `dev/harnessApi.ts` | one typed schema with URL keys; the whole view in the hash; `window.__meadow` | the planet's parameters and URL keys (unique); presets and views | a key clash; a view not reproducible from its URL |
| Tests | `dev/invariants/*.test.ts`, `dev/invariants.spec.ts`, `dev/shots.spec.ts`, `dev/squint.spec.ts` | determinism, no swimming, density, scale, attached, picking, frames, MSAA range, budgets, squint | the planet's own cases (its shots, its vista still) | a squint test that still points at the meadow's still |

## Budgets (from the brief, still the bar)

- 60 fps on an M1 Air at 1440p (DPR ≤ 2) and an iPhone 15 (DPR ≤ 1.5).
- At most 120 draw calls and 4 ms of JS a frame, with no allocations in hot paths.
- GPU memory under 256 MB; first frame within 2 s.

Kai also judges smoothness by feel (measure-perf).
