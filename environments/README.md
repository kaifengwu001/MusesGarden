# Environments

Each folder here is a world of its own, beside the meadow. The meadow, "Muse's
Garden", lives in `src/` and stays exactly as it is: no world is made by editing
or refactoring it.

## How a world is made

`npm run new-environment -- <name> --title "<Title>"` creates
`environments/<name>/`. It holds:

- **Copies of the meadow's world-specific modules.** These are modules that
  hold the meadow's content (colours, field recipe, flowers, the cottage, Muse's
  day on its terrace, parameters, wording), or that import one of those, even
  only as a type. The list is `COPIED` in `scripts/new-environment.ts`. Files
  keep their paths from `src/`, so imports between copies stay as written.
- **Imports of everything else from `src/`, unchanged.** That covers the engine:
  the cube-sphere, point sets, growth, CDLOD, the warp, scatter, clouds, post,
  the camera, Muse's body and rig, the finds' `FindTable` state, and every shader file not copied. The
  scaffolder rewrites those imports to point into `src/`.
- **Its own page** (`index.html`), a build config (`vite.config.ts`), copies of
  the meadow's tests that cover copied modules, and a `README.md`.

A new world starts as a faithful copy: on the day it is made, its frames match
the meadow's byte for byte. From then on, it changes only inside its folder.

## Rules

- Never edit `src/` for a world. When a world needs a shared file to differ,
  copy that file into its folder at the same relative path and repoint the
  import in the world's copy.
- Shader chunks keep their `meadow_` names (`meadow_terrain`, `meadow_paint`,
  `meadow_water`, `meadow_fields`, `meadow_toon`). The shared shader files in
  `src/` include them by those names. Each world's `render/glsl.ts` registers
  its own copies under the same names, so in that world's page the shared
  shaders compile against the world's chunks.
- The test harness global stays `window.__meadow`, so the copied specs work
  unchanged.

## Running, testing and building a world

| | Command |
|---|---|
| Open | `npm run dev`, then `http://localhost:5173/environments/<name>/` |
| Type check and lint | `npm run check` (covers `environments/`) |
| CPU tests | `npm test` (covers `environments/**/*.test.ts`) |
| Browser invariants | `npx playwright test --project=<name>:invariants` |
| Frame lock | `npx playwright test --project=<name>:lock` (writes `shots/<name>/lock/`; set `LOCK_BASELINE=<hashes.json>` to compare) |
| Build | `npx vite build --config environments/<name>/vite.config.ts` (to `dist-environments/<name>/`) |

The meadow keeps its own commands (`npm run dev` at `/`, `npm run build`) and its own build output (`dist/`). Each world's `README.md`
records the meadow commit it was copied from.

## Worlds in this checkout

[Lantern Reed Gardens](lantern-reed-gardens/README.md) is available at http://localhost:5225/environments/lantern-reed-gardens/ using `npm run dev:lantern`. Its storage and build output are independent of other worlds. The original meadow remains at `/`.

[Scarlet Sail Canyon](scarlet-sail-canyon/README.md) is served on port 5227. Its code, build output and resident storage are independent of the original meadow.

[Cobalt Windfields](cobalt-windfields/README.md) is served on port 5217 with `npm run dev:cobalt`. Its blue rock formations, peach sand, native plants, wildlife and local residents live entirely inside its own environment folder.

[Tulipwind Meadows](tulip-windmill-meadows/README.md) is served on port 5241 with `npm run dev:tulip`. Dense tulip ribbons, turning windmills and varied cottage gardens form a separate cultivated planet.

[Golden Rye](golden-rye/README.md) is served on port 5251 with `npm run dev:rye`. Continuous golden grain, cypress groves, muted lavender hills and rounded clouds form a separate harvest planet.

[Cherry Blossom Waterways](cherry-blossom-waterways/README.md) is served on port 5249 with `npm run dev:cherry`. It combines pink and ivory cherry groves, green willows, blue canals, a tiled pavilion and duck flocks.
