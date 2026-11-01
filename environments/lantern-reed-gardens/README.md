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
- `life/canyonScenery.ts` and `canyonGeometry.ts`: four reed-colony variants arranged in uneven bank thickets, with low waterside reeds, garnet ferns, individual lilac gravel, interlocking fractured shelves and blue-lilac mesas. Open water lanes and the residents' clearing separate the denser planting. Seven four-winged Lamp Petals move among the reeds. The inherited module names are local to this environment.
- `life/props.ts` and `cottageGeometry.ts`: an asymmetric timber shelter with exposed trusses, thick overlapping sage leaves, a draped awning, blue botanical woven panels, warm split-reed gable boards, an inset divided window and a plank door. The foundation and lookout use individual full-depth chipped stones. The bench, chair, deck and step heights retain the coordinates used by Muse's routines.
- `life/lanternWildlife.ts`, `lanternWildlifeGeometry.ts` and their shaders: three Poolglass swimmers with lavender mineral plates and mint fins, and three Reed Waders with sage leaf mantles and webbed feet. Their deterministic swimming, walking and resting poses respond to seed and growth. Habitat checks keep swimmers in water and support waders on banks or the actual authored stone shelves.
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
- Environment CPU suite: 72 tests pass, including dry resident routes, camera restoration and exact settled scenery after growth.
- Final browser correctness suite: 19 tests pass across rendering, CPU/GPU parity at radii 40/128/400, deterministic growth, picking, finds, resident interaction, saved names, mobile layout, shared views and Reset.
- A separate live-resolution regression passes at desktop DPR 2: High retains 1920×1280 under sustained slow frames, Auto reduces to scale 0.75, and returning to High restores 1920×1280. This test keeps animation live rather than freezing the render clock.
- `npm run build:lantern` passes. The standalone output was served separately and checked for rendering, greetings and navigation, with no browser errors. The main JavaScript chunk is about 1.20 MB / 363 KB gzip, so Vite reports its existing 1024 KB chunk-size warning.
- `git diff --check` passes; shared `src/` and `server/` have no changes.

The final correctness run used:

```sh
MEADOW_PORT=5225 npx playwright test \
  --project=lantern-reed-gardens:invariants \
  --project=lantern-reed-gardens:residents \
  --grep-invert 'scrubbing growth in real time|first frame within|draw calls stay|no LOD rings'
```

Startup and draw-call budgets pass. **The strict high-quality growth frame budget remains open.** Before High was locked to full resolution, the final run measured frame p95 **50.0 ms** against the unchanged 20 ms target; JavaScript p95 **10.7 ms** meets its 12.7 ms target. Full-resolution High can be slower. During growth, nonhero plants distribute grounding work over eight frames and the basin uses the cheaper sky/bank reflection. The first stationary frame restores exact placements, and the detailed terrain bake restores the geometry mirror. This does not establish a stable 60 fps guarantee. The inherited dolly/LOD visual test is still marked unautomated.

The visual revision also verifies six habitat-supported animals, the live local reflection, selected lantern lights, and removal of native meadow birds/butterflies. Exact frame comparison after a growth round trip passes: explicit settling now resets the local shadow-grid hysteresis while live navigation keeps that hysteresis to prevent shimmer.

## Task list handoff

These updates have not been synced to the shared task list:

- **Renderer backlog — Build Lantern Reed Gardens: done.** Standalone environment and build; three local residents; daylight/dusk, navigation, saved names and camera links; 72 CPU and 19 browser correctness tests pass.
- **Renderer backlog — Match Lantern Reed Gardens reference: implemented, awaiting visual review.** Dense varied reeds, grounded mineral shelves, mesas and canopies, rebuilt leaf-roof shelter, lantern emission and reflections, and three native wildlife types. All changes stay inside this environment.
- **Renderer backlog — Stabilize high-quality growth performance: todo.** Done when the existing growth check consistently meets frame p95 <20 ms, JavaScript p95 <12.7 ms and build slice <8.6 ms. Keep the current rendering budgets.
