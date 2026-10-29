# Progress

The plan and the growth model are in [ARCHITECTURE.md](ARCHITECTURE.md). This
file tracks what is done, what is known to be wrong or missing, and what comes
next. It is updated and committed at every stage.

## Stages

| Stage | State | Checkpoint |
|---|---|---|
| **S0** Scaffold | ✅ done, awaiting review | sky gradient and HUD ([shots](docs/checkpoints/s0/)) |
| S1 Planet core | next | growth scrubs smoothly; no-swim and density tests pass |
| S2 Look foundation | | an untextured meadow sphere in the reference's light and colour |
| S3 Terrain and water | | Overview and Wander next to the reference's wide panel |
| S4 Grass and wind | | Wander shot; frame time under budget |
| S5 Flowers and bloom | | close-up next to the reference's flower panel |
| S6 Cottage and props | | cottage by the pond, outlines on props only |
| S7 Clouds | | mountain banks, drifting clouds, blob shadows |
| S8 Warp and camera | | R = 400 m still reads as a tiny planet |
| S9 Growth polish | | 8 s Grow + Bloom recording with no hitches |
| S10 Performance | | HUD numbers for desktop and a phone-sized viewport |
| S11 Polish | | UI, hints, Postcard mode, final grade |

## S0: done

- **Stack:** exact pins for Vite 8.3.5, TypeScript 6.0.3 (strict), three
  0.184.0, lil-gui 0.21.0, ESLint 10 with type-aware typescript-eslint,
  Vitest 5 and Playwright 1.64. TypeScript stays on 6.0 because
  typescript-eslint does not support the native 7.x compiler yet.
- **`params.ts`:** one typed schema of 40 fields in 12 groups, covering every
  parameter in the brief plus channel width. Each field has its default,
  range, step, URL key and change effect. Around the schema:
  - a store with batched change events, clamping, and an area-pair
    constraint;
  - presets: Spring meadow, Seedling, Wide world, Golden hour, Dawn, Gusty;
  - URL-hash sync that writes only non-default values. A hash fully describes
    the state: missing keys return to their defaults. `t=12` freezes world
    time.
- **`main.ts`:** WebGL2 renderer, frame loop, resize, tier selection (an
  `auto` benchmark plus a live step-down controller), shaders warmed against
  the real render target before the first frame, and context-loss handling.
- **`render/`:**
  - a linear HDR scene target, with MSAA only below DPR 1.75 (see Trades);
  - the post grade: tone-curve placeholder plus 2% static paper grain;
  - a sky that blends between the Overview backdrop and the Wander dome;
  - `warp.glsl` with its exact CPU mirror, `warp.ts`;
  - shared GLSL chunks, available as `#include <meadow_*>`.
- **`ui/`:** the title with a live metadata line ("Spring · R 128 m ·
  206,000 m² · seed 0412"), key hints, and the lil-gui panel generated from the
  schema and restyled. `P` toggles the panel. On phones it moves to the bottom
  right.
- **`dev/`:**
  - **Perf HUD:** frame time and fps, JS ms, GPU ms from timer queries, and
    draws, triangles, grass instances and GPU memory against their budgets.
    Also shows canvas, MSAA, tier, planet, chunk queue and first-frame time.
    `H` toggles it.
  - **`window.__meadow` harness:** setHash, freeze, settle, renderFrame,
    frameHash and stats.
  - **`npm run shots`:** 4 seeds and presets × desktop and phone viewports,
    at frozen time.
  - **`npm run test:gpu`:** determinism (two loads give the same frame hash),
    URL round-trip and first-frame time.
  - **Vitest invariants:** params, the growth model and the warp math. The
    later invariants are scaffolded as todos, tagged with their stage.

### Measured at the S0 checkpoint

Measured on an Apple **M1 Pro** (not the M1 Air in the brief) in headless
Chromium through ANGLE on Metal, with world time frozen.

| Viewport | Frame | JS | GPU | Draws | GPU memory | First frame |
|---|---|---|---|---|---|---|
| 1600×1000 @1, MSAA 4× | 60 fps | 0.33 ms | 3.05 ms | 2 | 97.7 MB | 427 ms |
| 2560×1440 @2 (1440p), no MSAA | 60 fps | 0.31 ms | 1.60 ms | 2 | 70.3 MB | 279 ms |
| 390×844 @1.5 (phone, low tier) | 60 fps | 0.46 ms | 0.43 ms | 2 | 14.1 MB | 544 ms |

### Trades (quality for performance)

- **MSAA only when DPR < 1.75.** A 4× HalfFloat MSAA target costs about
  56 B per pixel, which is about 200 MB at 1440p with DPR 2. That would break
  the 256 MB budget on its own. At DPR 2 the pixel density does the
  anti-aliasing instead.

### Known issues

- **Benchmark:** the startup tier benchmark is a fill-rate probe. S10 replaces
  it with a benchmark of the real scene.
- **Camera:** `cam=wander` is accepted, but the camera rig arrives in S1
  (orbit) and S8 (Wander). S0 renders the same sky for both modes.
- **Sky colours:** these are the brief's by-eye hexes until `palette.ts` (S2).
- **GPU timer:** shows n/a in Safari, which has no timer queries.
- **DPR-1 desktops:** the empty pipeline costs 3 ms of GPU there, mostly the
  MSAA HalfFloat resolve plus the grade. Revisit in S10 (2× MSAA, or an RGBA8
  target).

## Next: S1, planet core

- `cubesphere.ts`: the spherified cube, its inverse, and the area element J,
  tabulated.
- `rest.ts`: progressive point sets (one point per cell, ranked births),
  birth radii, and the R_lag fade band.
- `chunks.ts`: six face quadtrees, CDLOD selection and morph, one instanced
  draw, and a build queue time-sliced to 2 ms per frame.
- Camera: orbit and dolly in Overview. Growth slider scrubbing. Debug colours
  by face and LOD.
- Tests: no swimming, density within ±5%, and scrub determinism.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server on :5173 (add `#hud=1&t=12` etc. to the URL) |
| `npm run check` | tsc (app and node) plus ESLint |
| `npm test` | Vitest CPU invariants |
| `npm run test:gpu` | Playwright browser invariants |
| `npm run shots` | screenshots into `/shots` (`MEADOW_GL=swiftshader` for the CPU rasterizer) |
| `npm run build` / `npm run build:single` | `dist/`, or one self-contained `dist-single/index.html` |
