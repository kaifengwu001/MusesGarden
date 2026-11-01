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

The residents are local inhabitants with autonomous routines. They are not a claim that account friends are currently online or visiting. A `?garden=...` source can still supply the existing garden interface, but backend world allocation and cross-planet visits require an environment identifier that the current server contract does not yet contain.

## Implementation map

- `planet/`: mirrored CPU/GPU height and shore calculations, shallow basins, dry home support, terrain and water materials.
- `life/canyonScenery.ts` and its geometry/shaders: the environment's persistent reed gardens, mineral slabs and ambient pollinators. The inherited module name is local to this environment.
- `life/props.ts`: timber, woven panels, overlapping-leaf roof and compatible home furniture.
- `life/residentLife.ts`, `residents.ts`, `muse.ts`: safe local routes, resting, interaction reactions, independent appearances and shared cached body loading.
- `world.ts`: scene integration, seed/radius changes, camera following, nearest-resident picking, and daylight/dusk uniforms.
- `view/camera.ts` and `core/hashSync.ts`: saved camera pitch, legacy link support, and complete view restoration after parameter changes.
- `ui/canyonUi.ts`: residents and places; all names are written as text.
- `dev/`: parameter, growth, resident and browser checks.

Storage keys use `muses-garden.lantern-reed-gardens.*`; this page does not reuse the meadow's preference or Scarlet's resident keys.

Water shares one level. Its reflections use the existing sky/cloud rendering; the new reeds, lanterns and animals do not have exact mirror reflections. The causeway is a decorative landmark outside the residents' navigation lanes; walking across each individual slab is not claimed. No external model service is required for the local residents or scenery.

Large planets (radius above 256 m) use a 1024-pixel terrain bake at high quality to keep shoreline sampling accurate; the bake uses about 64 MiB instead of 19 MiB. The quick bake used during interactive growth is unchanged.

## Validation

Checked on 31 October 2026:

- `npm run check`: all three TypeScript projects and ESLint pass.
- Environment CPU suite: 68 tests pass, including dry resident routes, camera restoration and exact settled scenery after growth.
- Final browser correctness suite: 19 tests pass across rendering, CPU/GPU parity at radii 40/128/400, deterministic growth, picking, finds, resident interaction, saved names, mobile layout, shared views and Reset.
- `npm run build:lantern` passes. The standalone output was served separately and checked for rendering, greetings and navigation, with no browser errors. The main JavaScript chunk is about 1.16 MB / 350 KB gzip, so Vite reports its existing 1024 KB chunk-size warning.
- `git diff --check` passes; shared `src/` and `server/` have no changes.

The final correctness run used:

```sh
MEADOW_PORT=5225 npx playwright test \
  --project=lantern-reed-gardens:invariants \
  --project=lantern-reed-gardens:residents \
  --grep-invert 'scrubbing growth in real time|first frame within|draw calls stay|no LOD rings'
```

Startup and draw-call budgets passed separately. **The strict high-quality growth performance check remains open.** Repeated runs varied; the last two had frame p95 of 49.9 and 33.4 ms against the unchanged 20 ms target. Plant sampling now spreads work across growth frames, and the first stationary frame restores exact placements. This improves CPU cost but does not establish a stable 60 fps guarantee. The inherited dolly/LOD visual test is still marked unautomated.

## Task list handoff

These updates have not been synced to the shared task list:

- **Renderer backlog — Build Lantern Reed Gardens: done.** Standalone environment and build; three local residents; daylight/dusk, navigation, saved names and camera links; 68 CPU and 19 browser correctness tests pass.
- **Renderer backlog — Stabilize high-quality growth performance: todo.** Done when the existing growth check consistently meets frame p95 <20 ms, JavaScript p95 <12.7 ms and build slice <8.6 ms. Keep the current rendering budgets.
