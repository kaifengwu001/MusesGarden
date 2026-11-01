# Lantern Reed Gardens

An independent Muse habitat with shallow periwinkle pools, lavender gravel, mint reeds, ivory leaves and warm papery seed lanterns. The Evening Causeway crosses the basin beside a timber and woven-panel home. Lamp Petals flutter among the reeds.

Based on the app at `fb21a13`, using the environment isolation structure from `setting_gen`. All world-specific code lives here. Shared `src/` is imported without modification; Scarlet Sail Canyon and Violet Dunes are separate worlds.

## Run

From this checkout:

```sh
npm run dev:lantern
```

Open <http://localhost:5225/environments/lantern-reed-gardens/>. The root route remains the original meadow.

```sh
npm run check
npx vitest run environments/lantern-reed-gardens
MEADOW_PORT=5225 npx playwright test --project=lantern-reed-gardens:residents
MEADOW_PORT=5225 npx playwright test --project=lantern-reed-gardens:invariants
npm run build:lantern
```

Build output: `dist-environments/lantern-reed-gardens/`. Serve that directory over HTTP; ES modules and workers do not run from a `file:` URL.

## Explore

- **Shelter / Causeway / Orbit** frame the home, landmark and whole planet.
- **Daylight / Dusk** change the light and the lanterns' warmth.
- **Luma, Mallow, Tavi** select and follow a resident. Say hello, click to greet, or hold to pet. Their names can be edited and persist on this device.
- Drag and scroll to navigate; WASD walks and Q/E changes height. Manual navigation releases following.
- Grow, Bloom, wind and Seed controls change the living world. The URL preserves the world parameters and camera, so a view can be reopened.
- Postcard mode clears the controls for a picture. The existing garden tools remain available.
- **High** keeps the scene at full drawing-buffer resolution (up to 2× device pixel ratio on desktop), even when frames are slow. **Auto** can lower resolution to maintain responsiveness. Open `#q=high` for a crisp preview; a lower frame rate is possible in dense views.

The residents are local inhabitants with autonomous routines. They are not a claim that account friends are currently online or visiting. A `?garden=...` source can still supply the existing garden interface, but backend world allocation and cross-planet visits require an environment identifier that the current server contract does not yet contain.

## Implementation map

- `planet/`: mirrored CPU/GPU height and shore calculations, shallow basins, dry home support, and distinct gravel, limestone and water materials. The home clearing supports the existing resident routes.
- `life/canyonScenery.ts` and `canyonGeometry.ts`: four reed-colony variants arranged in uneven bank thickets, with low waterside reeds, garnet ferns, individual lilac gravel, interlocking fractured shelves and blue-lilac mesas. Folded lantern membranes, bent and nicked leaves, chipped stone shoulders, ledge plants and branching canopy crowns give the materials distinct silhouettes. Open water lanes and the residents' clearing separate the denser planting. Seven four-winged Lamp Petals move among the reeds. The inherited module names are local to this environment.
- `life/props.ts` and `cottageGeometry.ts`: an asymmetric timber shelter with exposed trusses, thick overlapping sage leaves, a draped awning, recessed blue botanical woven panels, warm split-reed gable boards, an inset divided window and a plank door. Window light spills onto the frame and sill; weathered lower boards and small potted reeds add household detail. The foundation and lookout use individual full-depth chipped stones. The bench, chair, deck and step heights retain the coordinates used by Muse's routines.
- `life/lanternWildlife.ts`, `lanternWildlifeGeometry.ts` and their shaders: three Poolglass swimmers with lavender mineral plates and mint fins, and three Reed Waders with sage leaf mantles and webbed feet. Their deterministic swimming, walking and resting poses respond to seed and growth. Habitat checks keep swimmers in water and support waders on banks or the actual authored stone shelves. Narrow channels reduce the swimming excursion; water rings follow the live swimmers through growth and seed changes.
- `life/residentLife.ts`, `residents.ts`, `muse.ts`: safe local routes, resting, interaction reactions, independent appearances and shared cached body loading.
- `render/poolReflection.ts` and `planet/water.glsl`: a reflected-camera pass renders actual reeds, lanterns, stone scenery, the shelter, wildlife and Muses into the nearby pools. A clipped plane tangent to the authored basin is computed in the same warped space as the water. The water combines that image with ripples, sky/cloud/bank reflections and warm light paths tied to selected lantern positions.
- `render/sky.frag.glsl`, the palette and local material shaders: blue dusk with broken apricot cloud ribbons, paper lantern facets, leaf veins and rims, fibrous timber, patterned reed panels and fractured mineral faces. Daylight/dusk changes the light and lantern warmth without replacing the geometry.
- `world.ts`: scene integration, seed/radius changes, camera following, nearest-resident picking, wildlife, the pool reflection pass and daylight/dusk uniforms.
- `view/camera.ts` and `core/hashSync.ts`: saved camera pitch, legacy link support, and complete view restoration after parameter changes.
- `garden/source.ts`: an unconnected world starts with empty interests, friends, baskets, finds and postcards. The local residents and wildlife remain present. An explicit `?garden=...` URL uses the existing connected garden source and its supplied content; the meadow's sample flower beds are not loaded by default.
- `ui/canyonUi.ts`: residents and places; all names are written as text.
- `dev/`: parameter, growth, resident and browser checks.

Storage keys use `muses-garden.lantern-reed-gardens.*`; this page does not reuse the meadow's preference or Scarlet's resident keys.

Water shares one level. The geometry reflection is a local tangent-plane approximation around the authored basin. It fades toward orbit, outside the basin, and at the closest walking zoom where curvature is exaggerated. Active growth uses the cheaper sky/bank mirror until the detailed terrain bake settles. It does not solve exact reflections across the curved globe or every distant pool; the existing sky/cloud/bank reflection remains the wider-world fallback. The causeway is a decorative landmark outside the residents' navigation lanes; walking across each individual slab is not claimed. Poolglass, Reed Waders and Lamp Petals are ambient wildlife, while greeting, petting, naming and following belong to the Muse residents. No external model service is required for these local models.

The reference guides the palette, silhouettes and material treatment; this remains an interactive procedural adaptation. Keep leaf edges thin and overlapping, lantern cases faceted, timber joints visible, and stone surfaces planar and chipped. Preserve readable gaps through reed colonies and clear resident paths when adjusting density. Avoid smoothing all materials into the same rounded, clay-like finish.

Large planets (radius above 256 m) use a 1024-pixel terrain bake at high quality to keep shoreline sampling accurate; the bake uses about 64 MiB instead of 19 MiB. The quick bake used during interactive growth is unchanged.

## Validation

Visual revision checked on 1 November 2026:

- `npm run check`: all three TypeScript projects and ESLint pass.
- Environment CPU suite: 90 tests pass, including dry resident routes, camera restoration, narrow-channel swimming and exact settled scenery after growth.
- Final browser correctness suite: 22 tests pass across rendering, CPU/GPU parity at radii 40/128/400, deterministic growth, picking, finds, resident interaction, saved names, mobile layout, shared views, Reset and live resolution.
- The live-resolution regression runs at desktop DPR 2: High retains 1920×1280 under sustained slow frames, Auto reduces resolution, and returning to High restores 1920×1280. This test keeps animation live rather than freezing the render clock.
- `npm run build:lantern` passes. The standalone output was served separately and checked for rendering, greetings and navigation, with no browser errors. The main JavaScript chunk is about 1.22 MB / 369 KB gzip, so Vite reports its existing 1024 KB chunk-size warning.
- `git diff --check` passes; shared `src/` and `server/` have no changes.
- Integration with main `7912632`: full repository CPU suite passes **834 tests**, with 3 skipped; TypeScript and ESLint pass. Eight targeted browser checks also pass after the shared find shaders were isolated locally. The meadow, server and Scarlet environment match that main commit exactly.
- The environment scaffolder was checked against the current shared `FindTable` renderer in an isolated temporary world: generation, 25 CPU tests, both TypeScript configurations, lint and standalone build pass.

The final correctness run used:

```sh
MEADOW_PORT=5225 npx playwright test \
  --project=lantern-reed-gardens:invariants \
  --project=lantern-reed-gardens:residents \
  --grep-invert 'scrubbing growth in real time|first frame within|draw calls stay|no LOD rings'
```

The performance targets now pass in **three consecutive runs**, with full-resolution High unchanged: frame p95 **16.8 ms** (target <20 ms), JavaScript p95 **7.0–7.3 ms** (target <12.7 ms), and maximum build slice **0.1 ms** (target <8.6 ms). Startup below 2 s and both draw-call budgets pass in all three runs. The earlier 50.1 ms growth result was before the refinements below; thresholds were not relaxed. Timing depends on the machine and other GPU work, so these results are measurements rather than a frame-rate guarantee for every device. The inherited dolly/LOD test remains unautomated.

The refinement removes coplanar foundation/terrace/lookout surfaces and collapsed leaf-tip faces; roof leaves follow separated shingle courses. Regression tests check all nine scenery templates and cottage geometry at three seeds, including projected coplanar masonry intersections and unchanged resident support heights. Leaves use curved veins, a pale midrib, fibres and worn margins; rocks have filtered mineral grain, pinholes and angular seams. Fine detail fades below pixel size to avoid shimmer.

Performance work preserves visible geometry and density. Each main/reflection camera conservatively rejects offscreen colonies using bounds that include leaf animation and the nonlinear planet warp. Full placement data stays separate from compact draw buffers. The nine-view comparison across radii 40/128/400 is pixel-identical with culling enabled or disabled. Exact vertex welding preserves normals, material boundaries and UV seams. Opaque scenery fills depth before the expensive ground/water shader; A/B captures differ by at most seven contact-edge pixels out of 1.6 million. Redundant per-vertex trigonometry and per-pixel light transforms are removed. Zero meadow flora and clear weather reuse empty maps while retaining resident shadows; connected gardens retain their find maps. The CPU/GPU parity probe builds its diagnostic field map on demand when that map is unused by the native habitat.

Active growth still distributes nonhero grounding over eight frames and uses the sky/bank reflection; the settled scene restores exact placements and the full geometry reflection. Auto remains adaptive and High remains at full drawing-buffer resolution.

The visual revision also verifies six habitat-supported animals, the live local reflection, selected lantern lights, and removal of native meadow birds/butterflies. Exact frame comparison after a growth round trip passes: explicit settling now resets the local shadow-grid hysteresis while live navigation keeps that hysteresis to prevent shimmer.

The scenery test regenerates `shots/lantern-reed-gardens/reference-vista.png`, `scenery-home.png` and `scenery-day.png`. The final dusk postcard was inspected against the world reference: dense reeds, mineral shelves, the leaf-roof home, visible wildlife and reflected lantern light are present. Cliffs and canopies remain simplified procedural forms compared with the illustration. Use **Causeway → Dusk → Postcard** for the broad basin view; a close shelter view intentionally fades the planar reflection.

The [reference pack](reference/README.md) keeps the world concept and the final rendered checkpoint beside the implementation. The local find shaders preserve the `fb21a13` renderer used by this world, independently of main's newer `FindTable` implementation. Local grass and Muse-shadow shaders also preserve this world's multi-resident shadow maps when main changes its single-resident renderer.

## Task list handoff

These updates have not been synced to the shared task list:

- **Renderer backlog — Build Lantern Reed Gardens: done.** Standalone environment and build; three local residents; daylight/dusk, navigation, saved names and camera links; 90 CPU and 22 browser correctness tests pass.
- **Renderer backlog — Match Lantern Reed Gardens reference: implemented, awaiting visual review.** Dense varied reeds, grounded mineral shelves, mesas and canopies, rebuilt leaf-roof shelter, lantern emission and reflections, and three native wildlife types. All changes stay inside this environment.
- **Renderer backlog — Stabilize high-quality growth and startup performance: done.** Three repeated runs pass frame p95 <20 ms, JavaScript p95 <12.7 ms, build slice <8.6 ms and first frame <2000 ms, without changing the budgets or full-resolution High.
