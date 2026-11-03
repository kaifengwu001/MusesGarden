# Validation

Local preview ready for user visual review. Final correctness and render evidence are recorded below; artistic acceptance remains pending.

Latest evidence is in [Mainline integration](#mainline-integration--2-november-2026), following the [full coverage followup](#full-coverage-followup--2-november-2026). Earlier sections preserve the first delivery and its checks; the seven automated browser checks below are historical, not a claim that they were rerun for this followup.

Baseline: workspace handoffs/windows/golden-rye-2026-11-02T08-30-35-697Z. Clean7912632/refs/heads/environment/golden-rye, copied index, SHA-256 inventory of607 source/assets, and staged/unstaged inventories before scaffold. Native Windows10.0.26200 and Node24.22.2. Strict preview port5251 verified unoccupied before work.

## Initial checks and visual review

First type/lint check caught two unused legacy pond constants and one type-only test import; corrected. Initial CPU run32pass/1fail because inherited metadata expected "Late spring"; the world-specific assertion now expects "Golden harvest", keeping radius/area/seed checks unchanged. First live field/detail/globe captures: zero collected page/shader/console errors on RTX4070SUPER/ANGLE D3D11,1440x900,DPR1,high quality,frozen time12. Source crop count33,143,1,922,294 triangles. These are render statistics, not a performance benchmark or acceptance.

Visual review found excessive uniform yellow brightness; crop/ground palette and cypress/cloud shape changes remain in progress. Final correctness/build/browser results and refreshed images pending.

## Height precision and memory correction

The first focused browser run passed6checks and failed the unchanged2cm terrain parity bound (8.091cm error). Increasing only local bake resolution1024 reduced it to3.565cm; Float32 terrain data reduced it to3.127cm. Worst sampled CPU22.1093998759m/GPU22.078125m, so the residual was not simply a32m half-float range boundary. Water error0 and warp error0.000014m were already within their original limits. High-curvature height reconstruction is being corrected, without reducing relief or weakening assertions.

The local bake now keeps full-precision terrain height separate from a small64² half-float flora map (ambient flowers are disabled). Dedicated rye replaces the meadow's near grass, so unused grass/flower scatter pools are reduced to8pages and default grass density0. Cloud shadow window is capped at1024 locally. The GPU allocation ledger follows actual full/half channel sizes. These save unused allocations while preserving global engine budgets; final memory will be recorded from the renderer.

Ripen now changes the crop from green-gold to harvest colour. Held ripening discs affect crop colour too. The first live check after this addition found a missing chordAngle helper in the crop shader; replaced with the equivalent local chord-angle expression. Fresh render after correction had zero collected errors. Cold first-frame setup was about8.2s in that hardware capture; no inherited2s startup or universal FPS claim is made.

## Final local checkpoint — 2 November 2026

**Ready for user visual review:** http://localhost:5251/environments/golden-rye/ . Branch `environment/golden-rye`, based on clean `7912632`; implementation is uncommitted. Shared `src/`, `server/`, lockfile and other environments remain unchanged.

- **33 CPU tests pass across five files:** crop anatomy/awns, seeded lanes, exact stored-root grounding and growth return, dry terrain/bounds/home attachment, harvest geometry/grounding, parameter and growth contracts. Inherited wetland and season-label checks were updated to the new world's explicit dry/harvest requirements; original accuracy and resource thresholds remain.
- **Seven focused hardware browser checks pass together:** reload equality, frozen redraw equality, growth return, CPU/GPU terrain/water/warp agreement, picking, named views/actual rye/dryness/memory, and ripening colour plus named-view return. Original limits remain 2 cm height, 12 cm water distance, 5 mm warp, and 256 MiB tracked GPU allocations.
- Scoped TypeScript/ESLint and production build pass. Vite retains the pre-existing large-chunk warning.
- Final evidence: [field](reference/app-field.png), [grain detail](reference/app-detail.png), [globe](reference/app-globe.png), [detail at time 16](reference/app-wind16.png), [capture metadata](reference/review.json), [source and parity](reference/source-and-parity.json). Native NVIDIA RTX 4070 SUPER / ANGLE D3D11, 1440×900, DPR 1, high quality, render scale 1. No collected runtime, shader or console errors. Crop: 33,143 stalks, 1,922,294 crop triangles; full field view: 2,246,218 submitted triangles in 31 draws. These are counts, not an FPS benchmark.
- Saved detail-view parity probe: maximum height error 0.017901 m, water error 0, warp error 0.00001092 m across 64 samples. Tracked allocation: 236,619,050 bytes (about 225.7 MiB).

The final height fix uses a Float32 1024 cube with local Catmull-Rom reconstruction shared by mesh sampling, near-ground sampling and material heights. Bilinear filtering could not reproduce the high-curvature hills within 2 cm. The quick bake retains the original 256 size; flora uses 64, unused grass/flower pools use eight pages, dry-world cloud cover reflection uses 128 and the cloud shadow window uses 1024. This corrected a temporary 283.9 MB allocation overrun; the final unchanged 256 MiB check passes.

First captures exposed uniform neon-yellow colour, generic cone-like cypresses and oversized cumulus. Final source deepens ochre/olive crop faces, limits cream highlights, shapes irregular cypress crowns, and uses flatter curved physical cloud banks over painted sky curls. A transient crop shader compile error from an unavailable chord-angle helper was fixed and the actual scene recaptured. All final captures and tests use the corrected source.

Remaining limits: this is a procedural 3D interpretation, with more geometric grain edges and simpler brushwork than the paintings. Cold first-frame setup was 11.8 seconds in the final capture; the inherited 2-second startup and broad performance suite are not claimed as passing. Wind was inspected at two frozen times; this is not an exhaustive shimmer audit or a frame-time benchmark. Decorative buildings/trees have no new collision/navigation system. Muse and account/backend/example-content boundaries remain those of the base application. Final artistic acceptance remains with the user.

## Full coverage followup — 2 November 2026

Fresh baseline: `handoffs/windows/golden-rye-2026-11-02T09-23-55-796Z`, preserving every incoming dirty file and staged index. Same branch/base and strict preview5251/PID54104. Changes remain within the Golden Rye environment; the previously added package commands are unchanged.

- **35 CPU tests pass across five files.** Expanded crop tests check all six sphere faces, independently sampled empty-cap bounds, physical detail density at R40/128/400, pole/remote focuses, exact stored center roots, growth and focus return, stale near-cache recovery, geometry/memory budgets and release. Five affected crop tests were rerun after the final silhouette correction and pass. Tree checks preserve grounding/home clearance and require broad octant coverage with more than250 trees.
- **Scoped TypeScript/ESLint and production build pass** after the final code edits. Existing Vite chunk-size advisory remains. No test tolerance, 2.5M crop triangle cap, 4M scene triangle budget or 256MiB memory budget was raised.
- **Actual IAB visual review:** compared the default scene's clouds with Golden Rye, then inspected the field, detailed grain, globe, rotated far side and remote walking view. Final console error log was empty. Screenshots use1440×900, DPR1, high quality, MSAA4 and frozen time12. The live HUD showed231.1MiB tracked GPU memory and2.89M submitted field triangles/32draws, under its256MiB/4M/120draw budgets. The browser's renderer identity was not separately queried in this IAB pass; prior native-D3D11/RTX4070SUPER captures remain historical. HUD frame timings are not a performance benchmark.
- Default R128/seed412 CPU population: **98,272 distant three-ear tufts**, **9,640 detailed stalks at the home focus**, **388 cypresses**. Counts vary with focus/building exclusion. Actual population JSON is linked below; full-crop hard bound remains2,465,472 triangles.

Current images: [field](reference/full-cover-field.jpg), [detail](reference/full-cover-detail.jpg), [globe](reference/full-cover-globe.jpg), [far side](reference/full-cover-far-side.jpg), [remote walking](reference/full-cover-remote-walk.jpg), [field budget](reference/full-cover-field-budget.jpg). Supporting records: [HUD state](reference/full-cover-budget.txt), [CPU population](reference/full-cover-population.json). Earlier `app-*` images are retained as the first-delivery comparison.

Visual iteration caught a circular detail-transition trough and oversized distant triangular leaves. The final material preserves full stalk height through an8–17m width transition, keeps each source root fixed, and narrows distant head/leaf shapes. Crop is now present on former lanes, ridge tops and flanks as requested. Only the actual cottage footprint is unplanted. Distant off-center feet use approximate support planes, and continuous growth cost/shimmer are not certified by this pass. No automated browser suite or new CPU/GPU height-parity probe was run for this followup; the terrain height implementation itself is unchanged. User artistic acceptance remains pending.

## Mainline integration — 2 November 2026

Source `32233b8` was combined with main `708e21c` in an isolated checkout. Local compatibility modules preserve the original garden controls, find/pin contracts, character shading and stove glow; the custom model selector follows main's `sculpt` rename. Shared engine/server/lockfile and other environments remain unchanged by Golden Rye.

- `npm.cmd run check:rye`: TypeScript and ESLint pass.
- `npx.cmd vitest run environments/golden-rye --maxWorkers=1`: all 35 tests across five files pass.
- `npm.cmd run build:rye`: production build passes, with the existing chunk-size advisory.
- Actual source/integration field and globe views were compared in the same in-app browser at its native 1665×1191 viewport, high quality and frozen time12. Terrain, rye, trees, clouds and cottage appearance were preserved. The basket panel opened and closed correctly. No console errors were collected. This is visual review, not a pixel-equality assertion, hardware benchmark or rerun of the historical automated browser suite. Wall-clock character activity can differ between page loads.

Evidence: [integrated field](reference/mainline-field.jpg), [integrated globe](reference/mainline-globe.jpg), [basket panel](reference/mainline-baskets.jpg). Existing followup screenshots were renamed from `.png` to `.jpg` to match their actual JPEG encoding; original paintings and first-delivery PNGs are unchanged.

## Flat fields and volumetric crop — 2 November 2026

Branch `rye-fix` from `2b77e0a`, uncommitted. Mac (Apple GPU, ANGLE Metal), headless Chromium, 1440×900, high quality, frozen time 12. Shared `src/`, `server/` and package files unchanged.

- `npm run check:rye` (TypeScript, ESLint) and `npm run build:rye` pass; the existing chunk-size advisory remains.
- `npx vitest run environments/golden-rye`: 36 tests in five files pass. New or rewritten: the canopy sphere covers every direction, faces outward and lifts its shells above the most its chords sag at R 40/128/400 under the warp; shells are ordered top first and follow the tier; the default plain is flat at the cottage's level for seeds 1/412/771 at R 40/128/400; the detailed ears still ground at exact float32 roots and return after growth.
- `MEADOW_PORT=5261 npx playwright test --project=golden-rye:invariants`: 10 pass (determinism ×3, CPU/GPU terrain, water and warp parity, picking, walking strips, MSAA colour range, first frame, draw calls, setHash), 1 fixme. 4 fail identically on the unchanged original commit served from a separate checkout: the growth-scrub frame budget (load average about 60 on this machine), two find-sphere tests and the URL hash round trip. `dev/rye.spec.ts` matches no Playwright project and was updated but not run.
- Budgets at 1440×900 DPR 1: 240 MiB tracked GPU memory (was 231; the fields bake adds 15.7 MB, the far tufts' buffers are gone); 1.3–2.3 M submitted triangles by view (was 2.1–2.9 M); 27–32 draws. At DPR 2 the canopy cost about 25% more GPU time than the original before far-shell thinning and the drop from 20 to 16 shells; later comparisons were dominated by load from other work on the machine (the same view varied 2×), so no frame-time claim is made.
- Visual review against references 05–07: [globe](reference/fields-globe.jpg), [above the cottage](reference/fields-above.jpg), [across the rye](reference/fields-across.jpg), [among the ears](reference/fields-among.jpg), and the earlier [field](reference/fields-before-across.jpg) and [globe](reference/fields-before-globe.jpg) for comparison.

Known limits: shells seen almost edge-on still show faint horizontal rows on field sides within about 25 m; the reaped rings round sheaves are plain discs; the side road crosses some meandering strips at a slant. Kai's visual acceptance is pending.

### Road and edge-on follow-up

Kai's review: the road ended abruptly at the cottage's yard, and fields seen from a distance showed "planes made of multiple rectangles". Both fixed at their cause (see [construction](CONSTRUCTION.md#flat-fields-and-volumetric-crop--2-november-2026)): roads now pass the cottage with a drive from the porch, and the canopy samples stalks along the eye's ray and draws the undersides that the horizon needs. Isolated by hiding the detailed ears: a far field that showed as separate lines now reads as one mass ([horizon edge](reference/fields-horizon-edge.jpg), DPR 2). Close views keep faint stripes on field sides within roughly 20 m.

`check:rye`, 36 CPU tests and `build:rye` pass after the change; evidence images refreshed. GPU cost of the double-sided shells, A/B in one page at load average 40–80: about +10% on ground views before the steep-underside discard; at that load the numbers are indicative only.

### Tiny pieces and lower clouds

Kai's next review: remove awkward tiny patches below an area threshold, and lower the clouds to the default environment's height. Implemented as two bake passes ([construction](CONSTRUCTION.md#flat-fields-and-volumetric-crop--2-november-2026)) and the plain lowered to the meadow's 1 m with the meadow's 5 m cloud altitude. The crescent the drive cut off by the cottage is grass now; a whole-planet diff with the filter off and on shows only small or sliver pieces removed ([diff](reference/fields-tiny-pieces-removed.jpg)). A drive slab that also existed round the far pole was found and removed.

`check:rye`, 36 CPU tests and `build:rye` pass; `golden-rye:invariants` 10 pass and the same 4 fail as on the original commit. Tracked GPU memory 243.3 MiB at DPR 1 (budget 256). Evidence images refreshed.
