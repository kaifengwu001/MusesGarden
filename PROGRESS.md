# Progress

The plan and the growth model are in [ARCHITECTURE.md](ARCHITECTURE.md). This
file tracks what is done, what is known to be wrong or missing, and what comes
next.

## Iteration 1 — one full pass, S0 → S11

| Stage | State | Notes |
|---|---|---|
| S0 Scaffold | ✅ | schema + URL sync, HUD, harness, shots, invariants |
| S1 Planet core | ✅ | cube-sphere, rest-space points, CDLOD, growth band; no-swim and density tests pass |
| S2 Look foundation | ✅ | palette texture with time-of-day keys, soft toon, haze, sun, tone curve, bloom, grain |
| S3 Terrain and water | ✅ | spectral meadow, ridged range, channels with meander levels, ponds and islets, painted water |
| S4 Grass and wind | ✅ | 5-vertex blades from rest space, shared wind map, gusts that travel, paint cross-fade by rank |
| S5 Flowers and bloom | ✅ | four original species in drifts, bloom front, buds, petal lift |
| S6 Cottage and props | ✅ | stone cottage, landing with arch, steps, rail, bench; outlines on props only |
| S7 Clouds | ✅ | drifting clusters with blob shadows, mountain banks |
| S8 Warp and camera | ✅ | warp in every pass (no shadow-map pass; see Trades), Overview ↔ Wander, picking through the warp |
| S9 Growth polish | ✅ | unlocks by area, fades, time-sliced builds, press-and-hold bloom layer |
| S10 Performance | ◐ | measured and optimised; M1 Air and iPhones not measured directly (see below) |
| S11 Polish | ◐ | control bar, hints, postcard; final grade is a first pass |

Checkpoint images: [docs/checkpoints/iteration-1](docs/checkpoints/iteration-1/).

## Interactions (all wired and testable)

1. Drag orbits (Overview) or glides and turns (Wander); wheel or pinch dollies between them. Double-click glides to the point.
2. Grow: slider plus a play button that runs growth to the far end in about 8 s, or back.
3. Bloom: slider plus a play button for the bloom front.
4. Click on the meadow: a gust ring bursts outward; grass and flowers bend and recover.
5. Click on water: a ripple ring spreads.
6. Press and hold on the meadow: flowers bloom in a growing disc stored in rest space.
7. Time of day: dawn → noon → golden hour; sun, sky, haze and palette move together.
8. Wind strength and direction.
9. Seed: re-roll; the same seed always gives the same world.
10. Reset: defaults and the default camera.

Every state lives in the URL hash, including the camera pose (`pose=`) and frozen time (`t=`).

## Measured (iteration 1)

Apple **M1 Pro**, headless Chromium through ANGLE on Metal. `benchmark()`
renders frames back to back and waits for the GPU, so the GPU runs at full
clocks and the figure is real throughput (vsync-limited frame times would hide
it).

| Viewport | ms / frame | Draws | Grass in visible pages | Flowers | GPU memory | Terrain nodes |
|---|---|---|---|---|---|---|
| 2560×1440 (1440p, DPR 2), Overview | 2.7 | 21 | – | – | 119 MB | 15 |
| 2560×1440, Wander, R 128 m | 8.8 | 27 | 149k | 19k | 119 MB | 135 |
| 2560×1440, Wander, R 400 m | 11.3 | 27 | 137k | 18k | 119 MB | 249 |
| 390×844 @1.5 (phone, low tier), Overview | 0.8 | 14 | – | – | 34 MB | 6 |
| 390×844 @1.5 (phone, low tier), Wander | 3.7 | 20 | 39k | 6k | 34 MB | 124 |

Other figures:

- **JS per frame:** 0.3–1.3 ms.
- **Growth scrub:** while scrubbing in real time, JS p95 is under 4 ms and
  every build slice stays under 2.6 ms (the budget is 2 ms; the queue can
  overrun by at most one short step).
- **First frame:** under 600 ms.

Not measured directly:

- **M1 Air:** about half this GPU, so 1440p Wander is estimated at 17–22 ms.
  The live controller then lowers render scale (×0.85 per 2 s of slow frames,
  floor 0.6) until 60 fps holds.
- **iPhone 15 and 12:** not available here. The phone figures above are a
  phone-sized viewport on this machine.

## Trades (quality for performance)

- **MSAA:** only below DPR 1.75. At 1440p with DPR 2, a 4× HalfFloat target
  alone would cost about 200 MB.
- **Grass:** default 180 blades/m² within 22 m, down from 240 within 24 m.
  Blades have 5 vertices, not 7. Density thins by rank toward the edge of the
  near field.
- **Flowers:** one draw per species over a shared pool. The species check
  runs first and the hero cup has 7 segments. Far flowers become painted
  dabs.
- **Wind:** the shared gust field is evaluated once per frame into a map
  instead of per blade vertex. Per-plant flutter stays per vertex.
- **Terrain:** a 17² grid on both tiers, and warped-horizon culling in
  Wander.
- **Shadows:** no shadow-map pass. The cottage casts an analytic soft shadow
  (its footprint swept away from the sun) on the ground, grass and flowers.
  Clouds cast blob shadows. The brief asked for the warp in the shadow pass;
  every pass that exists applies it.

## Known issues

- **Mountains in Wander:** with the default `visualRadius` of 60 m, distant
  mountains sink below the curved horizon (that is the tiny-planet effect, by
  design). Near the range, or with `visualRadius` around 120, they rise above
  the meadow as in the reference.
- **Golden hour and dawn:** read heavy. Shade-band colours at low sun could
  be lighter. A grading pass is pending.
- **Triangle count:** the HUD shows an upper bound of rasterised triangles.
  Instances in visible pages that are masked or thinned are still counted.
- **Pools after a scrub:** instance pools fragment, and the draw range grows
  until tiles rebuild, which costs extra early-out vertex invocations. A
  compaction pass would fix it.
- **Benchmark:** `auto` still picks the tier from a fill-rate probe. It should
  benchmark the real scene (`__meadow.benchmark`).
- **LOD-ring test:** the image-based test is not automated (a Playwright
  `fixme`). Crack-freeness is proven on the CPU for every edge.
- **Stones:** only near the cottage. The meadow-wide `stones` scatter class is
  not added yet.

## Next

1. Grade pass at dawn and golden hour against the reference. Painted
   horizon cloud banks in the Wander sky.
2. Real-scene tier benchmark. Pool compaction. Optional real shadow map near
   the cottage.
3. Measure on an M1 Air and an iPhone; tune tiers from those numbers.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server on :5173 (add `#hud=1&t=12` etc. to the URL) |
| `npm run check` | tsc (app and node) plus ESLint |
| `npm test` | Vitest CPU invariants (52 tests) |
| `npm run test:gpu` | Playwright browser invariants (determinism, parity, scrub, budgets) |
| `npm run shots` | 15 screenshots into `/shots` (`MEADOW_GL=swiftshader` for the CPU rasterizer) |
| `npm run build` / `npm run build:single` | `dist/`, or one self-contained `dist-single/index.html` (708 kB) |
