# Building planets that match their concept art

This handoff records the Scarlet Sail Canyon implementation failures and the corrections made on 31 October and 1 November 2026. Use it with the concept image when starting another planet or continuing this one after a context reset. The first implementation worked as an application but did not satisfy the visual brief. Passing tests did not make it a faithful translation of the image.

The main lesson is to reproduce the image's spatial relationships, silhouettes, material distinctions and inhabitants before adding procedural variety. A red tree on pale terrain is not enough to recreate a canyon of layered rock, planted crevices and a shelter tucked into a cliff.

## Start here after a context reset

1. Read this document, [the environment pipeline](environment-pipeline.md), [environment rules](../environments/README.md), and the canyon's [construction notes](../environments/scarlet-sail-canyon/CONSTRUCTION.md).
2. **Open the images themselves.** The [reference pack](../environments/scarlet-sail-canyon/reference/README.md) contains the primary concept, expanded world and creature sheets, actual app screenshots and live screen recordings. These are copied into the repository so they survive independently of the original gallery. Prose cannot replace looking at them.
3. Read the [current validation record](../environments/scarlet-sail-canyon/VALIDATION.md) and the active issues below. Do not assume that a proposed fix or a passing unit test has been visually accepted.
4. Work only in the intended environment and verify the checkout, branch and server before editing. The original delivery used `/Users/yimingguan/muse_garden_1031/scarlet-canyon-standalone-01a19427`, branch `planet/scarlet-standalone`, port `5227`. After integration, an isolated checkout of `main` can also run it. Use a free port for each checkout. Other planet chats use neighbouring checkouts; do not switch or edit `setting_gen` or the shared `MusesGarden` checkout.
5. Start `npm run dev:scarlet`, open `/environments/scarlet-sail-canyon/`, choose **Shelter**, and compare a fresh screenshot with the primary concept. Also inspect a close view, another side, and **Whole planet**. An old URL `pose` overrides the intended starting composition; `t=12` deliberately freezes animation for comparisons.

The first delivery is preserved at commit `5374842`; it started from meadow commit `fb21a13`. Use `git show` to inspect it without resetting the working checkout. The original pipeline document predates the environment folders; the current environment rules take precedence for isolation.

## The visual contract

The user wants whimsical, cute and beautiful alien worlds with plausible materiality. Rock should read as fractured mineral, sand as granular wind-shaped ground, wood as fibrous structure, leaves as thin living surfaces and cloth as a tensioned sheet. Avoid a uniform clay or confectionery treatment. Avoid eerie anatomy, bodily-looking formations, and coiled or piled terrain that resembles excrement. Bold colour is welcome; material confusion is not.

For Scarlet Sail Canyon, preserve these relationships:

| Reference feature | What the scene must show | What does not satisfy it |
| --- | --- | --- |
| Layered chalk dominates the landscape | Large overlapping terraces at substantially different elevations, tall on the left, lower and open to the right | A smooth pale meadow with scattered boulders |
| A valley continues into the distance | A visible low corridor between the cliffs, with distant layers and sky | A high smooth mound or wall directly behind the home |
| Scarlet fans are the main living silhouettes | Broad, thin, scalloped crowns on graceful curved woody stems, with space beneath them | Flat discs, stiff sticks, or repeated identical umbrellas |
| Three distinct small plant families | Low rounded sage foliage, fine ivory comb fronds and short branching red plants | Recolouring one generic fern or placing sparse identical stamps |
| Plants occupy rock seams | Mixed overlapping groups along ledges and cracks, leaving quieter paths | Uniform scatter across every surface or isolated shrubs at regular intervals |
| The home leans into rock | One sagging crimson awning, a high rear attachment directly against chalk, thin supports, a partial rear screen and modest belongings | A freestanding cottage, symmetrical pavilion or double-roof porch |
| The world is inhabited | Muse neighbours plus the separately designed native animals, visible at useful viewing distances | Assuming extra Muse bodies stand in for the proposed wildlife |
| The drawing is delicate and material-specific | Fine contours, selected creases, blue-grey chalk shadows and restrained texture | Triangle wireframes, heavy lightning-shaped cracks, glossy coating or noise everywhere |

Do not copy these exact colours or species into every planet. For another image, write an equivalent contract identifying its own dominant masses, voids, silhouettes, material behaviours, shelter relationship and ecology.

## What went wrong and what changed

### The first scene preserved too much of the meadow

The first version prioritised a playable isolated world, resident routines and palette changes. It had nine authored local fan trees, a 128-site global distribution with growth gating, scattered fragments and relatively few connected cliffs. Those counts describe the source recipe, not what was visible in the opening frame. The user saw a barren planet with poor rocks and too little vegetation.

The correction changed the landscape itself: 5.6 m chalk bedding intervals, broad terrace tops, steep risers, overlapping cliff meshes and a 384-site global composition. The home moved to a stable 12.2 m middle terrace. Local authored placement establishes the image's composition; deterministic global placement extends that language around the planet. Adding more objects alone would not have fixed the shallow relief.

### A flat home clearing became an enclosing bowl

Blending a low clearing into high surrounding terrain created smooth enclosing ramps. Raising the home and using stepped access benches removed that shape while preserving the resident footprint. A later close comparison exposed a second problem: rear uplift and insufficient rightward lowering created a 21–26 m mound in the intended opening around local `x=17–30, z=-23…-27`.

The opening now has a directional cut of up to three beds and suppresses the conflicting rear uplift. The former mound samples approximately 0.8–5.8 m after the change. The protected home remains unchanged. This was a composition error in the terrain function, not something to hide with plants or camera rotation.

### Trees improved before the understory did

The fans gained smoothly curved stems, wider asymmetric scalloped blades, a smaller living side fan and restrained radial veins. But the smaller plants still failed several visual reviews:

| Attempt | Why it failed | Current construction |
| --- | --- | --- |
| Broad paired ivory pads | Looked like stacked plates or a pinecone | Three curved ribs with narrow upswept, alternating lanceolate leaflets |
| A continuous deeply scalloped ivory sheet | Still formed horizontal Christmas-tree tiers | Separate fine leaflets whose direction and proportions establish the feather-like silhouette |
| Large red lobed upright blades | Looked like rubber hands | Six fine asymmetric forked stems with much smaller lobed terminal leaves |
| Large flat green polygons | Read as paper mats | Small rounded cupped leaves with outward-facing side foliage |
| Large leaf cards around a dome | Produced cabbage-like sheets and obvious holes; the later low mound still read as small spheres | Separate low branching runners and upright twiggy shrubs, with cupped leaves, veins and irregular outlines |
| Isolated plants on each shelf | Looked procedurally stamped | Six spreading runner seams, plus coral and ivory accents; rigid support retains 22 of 24 shoots across all six seams |

Instance scale matters as much as the source mesh. A 2.6× sage instance enlarged its gaps and leaf-card appearance. Remote ground sage was reduced to 1.5×. Do not fix a scale problem by adding polygons everywhere.

Current template sizes are approximately 1.28 m high for ivory, 0.61 m wide by 0.54 m high for coral, 1.62 m wide by 0.31 m high for creeping sage, and 0.98 m wide by 0.72 m high for upright sage, before instance scale. These are implementation choices for this scene, not universal plant dimensions. Some leaf gaps remain visible in close views.

### Correct source plants were distorted by their parent cliff

The shelf's `aHeightScale` originally scaled everything in the combined mesh. Low cliffs squashed their plants into paper; tall cliffs stretched them. Improving the source plant geometry could not solve this.

Every vertex now has `aPlantBase`: zero for independent geometry, the ray-sampled rock support height for embedded plants. In both scenery and ink shaders:

```glsl
bool plant = (aKind > 2.5 && aKind < 3.5) || aKind > 7.5;
float verticalScale = plant ? 1.0 : aHeightScale;
p.y = (aPlantBase * aHeightScale
     + (position.y - aPlantBase) * verticalScale) * instanceScale;
```

The root moves with the rock; the body retains its proportions. Normals use the same vertical scale. Ink endpoints copy the source support attribute. Any extra pass must share placement, deformation, time and warp or it will visibly detach.

### Following every surface sample stretched the moss

A later material pass replaced sage domes with broad, low runners and individual leaves. Its first grounding approach sampled the cliff cap independently at every vertex. The contact tests passed, but a close app screenshot exposed long green strips down the cliffs: neighbouring vertices had landed on different terrace levels. Perfect sample-by-sample contact had destroyed the shape of the plant.

Preserve each shoot as a rigid component, supported by a stable cap footprint. Reject or reposition a component that crosses a sharp height discontinuity; do not pull its individual leaf vertices down to different floors. Grounding checks must also protect component dimensions and leaf edge lengths. A geometrically grounded mesh is not necessarily a plausible plant. The corrected source preserves all six moss seams and 22 of their 24 shoots. Root contact and bounded leaf edges pass the regression checks; fresh app views show the strips removed.

### Centre anchoring left rock corners floating

A broad shelf sampled only at its centre can extend across a descending terrace. Some base corners were more than 5 m above the ground. Enlarging or sinking the entire object would also move its cap and plants.

`canyonGround.glsl` now extends only the lowest rock ring downward to the actual terrain under each displaced vertex, with 0.18 m overlap. Caps and plants stay in place. CPU checks sample actual base corners at radii 40, 128 and 400 m. This is different from plant grounding: planted roots are raycast against the final rock triangles, not against the sphere beneath them.

A coral root also crossed a sharp ledge boundary: its centre was correct but the nearest stem vertex entered the higher rock by 0.20 m. Moving the root to the adjacent stable ledge fixed the contact without weakening the 0.08 m contact test. Check the footprint, not only the anchor.

### The shelter remained a pavilion after its roof changed

The first shelter reused too much rectangular building structure. It was replaced with one asymmetric cloth sheet, four slim uneven poles, a partial rear cloth screen, a work shelf, seed trays, baskets, tools and lanterns. Dedicated chalk backing places the rear canopy at the cliff face. The central backing's height scale is now 1.55 so rock remains visible above the roof.

The next failure was the foundation: a bright continuous rectangular fascia and nine parallel lookout slats made the home read as a stage. Offset fractured sides, muted chalk, limited weathered fascia and fewer short deck boards improved the material reading. This did **not** finish the shelter. The user then supplied a close screenshot showing jagged brown strips where boards and support faces conflicted. The old boards' top surfaces coincided with `FLOOR`, and the house, terrace and lookout rectangles overlapped. The correction partitions their union into cells with one height and material per point. The main bay uses a weathered timber material directly on that single surface; the exterior uses chalk. Overlay board boxes and coincident caps are removed. Only exposed boundaries and real height changes receive side faces. No polygon offset or arbitrary height nudge is used. See the active record below for verification status.

Walking surfaces are a separate contract. `FLOOR`, `TERRACE`, `PIER`, `STEPS`, `BENCH` and `CHAIR` are used by movement. Preserve their actual supported heights or redesign geometry and locomotion together. A test ray starting beneath an overlapping board can miss the defect; cast from above the full structure and inspect duplicates and coverage, not just the first expected height.

### The native animals were missing from the interpretation

Three local Muse neighbours did not satisfy the creature sheet. The native fauna now have their own geometry, motion, shadows and observation views:

| Species | Anatomy to preserve | Behaviour and display |
| --- | --- | --- |
| Chalkstep | Blue feathered body, cream face, two feet, one scarlet fan tail | Three animals; waddle, pause and tap for seeds |
| Fern Sifter | Three overlapping mint plates, six short legs | Three animals; slow crawling and foraging |
| Dewwing | Ivory spindle body, exactly two scarlet wings | Five animals; fluttering and physical nectar-stem perches |

The display sizes are intentionally larger than the written miniature sizes so the animals can be recognised in the app. Observe cameras frame from each animal's heading with a small side offset; using the home bearing hid faces. A folded-wing pause needs a real landing surface. Shadow meshes must be registered separately and receive the fully animated world transform.

### Materials and lines were used to compensate for wrong shapes

Surface marks cannot turn a smooth mound into fractured chalk or a rectangular stage into a small lean-to. Once the forms were corrected, material-specific marks helped: directional wood grain, restrained cloth weave, small leaf veins, chalk mottling and connected mineral fractures.

Periodic crack masks produced disconnected dotted strokes. A subsequent connected pattern used too much horizontal displacement and looked like giant lightning bolts. Crack amplitude, width and opacity were reduced. The contour pass uses welded boundaries and selected sharp creases, not every triangle edge. Tiny embedded plant outlines are omitted from mixed shelf meshes; their repeated lines were noisy and costly.

### Procedural fracture antialiasing broke frozen frames

All three deterministic-frame checks failed even though camera matrices, creature poses and time were identical. Hiding garden beds or fauna did not fix it; hiding scenery did. The chalk shader called `fwidth` inside per-pixel fracture branches. Derivatives in non-uniform control flow are undefined, so the same frozen scene could produce different pixels.

The fix computes the joint-coordinate pixel footprint once before branching and passes it to a derivative-free stroke function. Repeat loads, consecutive frozen redraws and the growth roundtrip now pass their unchanged hash checks. Do not change animation or relax image comparisons before isolating the changing draw. This is also why a shader that compiles and looks plausible in one screenshot can still be wrong.

### Screen-door fading created dotted ghost scenery

A whole-planet review exposed translucent-looking trees and cliff sheets even though the materials were opaque. The cause was persistent fractional presence near the home-clearance boundary: a fragment discard selected screen pixels, so a static object remained a full-size stippled ghost and shifted its pixel pattern during camera movement. This was different from z-fighting.

Presence now scales the complete instance and its support offset together; submitted instances are opaque. A tree and its parent shelf share the same site factor, so their attachment remains intact during growth. Fill and ink use the same instance attributes. Tests cover opaque output, support and settlement clearance at radii 40, 56, 90, 128, 160 and 400 m. Do not replace a depth conflict with transparency or screen-space stipple.

### Inherited meadow plants survived the visual rewrite

A sparse yellow star on a wire stem remained visible after the canyon plants were rebuilt. Reducing the meadow flower density to 0.08 had only made the mismatch rarer. The correct audit includes **all** plant-producing paths: ambient scatter, saved-find bed companions, press-and-hold bloom, and the separate collectible specimen system.

Ambient scatter is now zero by default. The four decorative flower channels have been replaced with compact native coral, ivory and sage geometry in both ambient and find-bed paths, while retaining their topic IDs and interaction attributes. Bloom now restores colour to the existing native foliage; it must not introduce another world's species. Test a dormant and blooming frame and assert that the default ambient flower count stays zero. Saved-find specimens are a separate content system; do not silently delete the user's finds while changing their presentation.

### The opening camera hid the intended relationships

The scene was repeatedly judged from a high view that made the home look freestanding and let foreground crowns hide the valley. The current Shelter view is lower, with the home left and the opening right. Its current authored values in `world.ts` are height 12, distance 62, azimuth 0.12 and target `[12,4,-12]`, in the local home frame. These values are starting points, not a substitute for visual inspection.

Near the ground, the camera warp flattens the scene. Adding an extra sphere-curvature correction when aiming this view moved the composition incorrectly. Whole-planet navigation also needed to reset the carried-over pitch. Test transitions between close observation, home and orbit, not just each preset alone.

## A repeatable workflow for another planet

1. **Inspect the pipeline and isolate the world.** Read the current docs and entry points. Create or reuse the intended checkout, scaffold an environment, keep shared `src/` unchanged, and give development/build/cache/storage their own destinations. A new world-specific requirement for a shared file means copying it locally and repointing imports.
2. **Extract a visual contract from the actual image.** Describe the major masses, empty spaces, left/right and near/far relationships, human or Muse scale, plants by structural family, materials, shelter attachment and inhabitants. Record unacceptable visual readings. Separate primary reference from supplementary world/creature sheets.
3. **Build the large forms and reference camera first.** Use a few representative cliffs, ground transitions, one tree and the shelter silhouette. Compare an actual screenshot at the intended angle before multiplying assets. If the landscape reads wrong at thumbnail size, fix terrain, scale and composition before texture.
4. **Finish one example of each important asset.** Inspect it in the scene at close, normal and far distances. Make a fern look like a fern before scattering hundreds. Check the final instanced shader transform as well as the uninstanced mesh.
5. **Design placement as ecology.** Use mixed clusters, seams, sheltered crevices and canopy relationships. Preserve intentional quiet paths. Use an authored local composition plus seeded global rules; uniform random scatter alone will not preserve the image.
6. **Build the shelter and inhabited space together.** Establish actual nonoverlapping surfaces, physical supports, entry clearance, seating and routes. Decide how much inherited floor layout can remain without destroying the intended silhouette. Inspect the side facing the rock and the floor from steep angles.
7. **Implement every promised creature family.** Make a checklist from the creature sheet. Include anatomy, motion, landing/ground contact, shadow integration and a way to find each species. Distinguish native animals, local Muse neighbours and account-backed friends.
8. **Add material detail and lines after the forms work.** Use evidence of the material's structure, not generic noise. Keep line density readable at normal app scale. Match deformation and warp across colour, outline and shadow passes.
9. **Run two kinds of validation.** Automated checks protect geometry, terrain parity, routes, persistence, performance and builds. Visual review compares actual screenshots against the image. Neither substitutes for the other.
10. **Keep an evidence record while iterating.** For each meaningful mismatch, save the symptom, cause, changed files, a before/after view, checks and remaining gap. Mark a hypothesis as a hypothesis. Update this record before another agent takes over; do not reconstruct only a flattering final story.

## Pipeline details that can silently break a new world

- **Terrain has several consumers.** CPU placement, GPU vertex displacement, cube-map bake, near-ground field maps, picking, shadows and culling must agree. Localising only the visible shader leaves invisible dependencies using the meadow recipe.
- **A dry planet still needs a shore-distance contract.** `GroundSample.water` is signed clearance, not a boolean or depth. Canyon dryness returns positive `1000`, with zero depth/wetness; zero clearance would incorrectly reject placements.
- **Bake smooth relief before applying steep steps.** Baking already-terraced heights and interpolating them rounded cliff transitions and increased CPU/GPU disagreement. The local bake stores integer/fraction parts of smooth relief in R/B, then every consumer reconstructs and terraces it.
- **Storage can add another rounding error.** At R400, the final half-float map turned a 5.45 mm shader error into 20.16 mm on Metal. Explicit nearest-half rounding using an exact exponent-bit quantum fixed it without extra texture memory. Keep the 2 cm parity limit; do not weaken the test or move its camera to avoid the sample.
- **Refresh derived state even if radius is unchanged.** `refreshFields()` must invalidate scenery and fauna after terrain updates. Initial construction and later full bakes can otherwise retain anchors placed against stale fields.
- **Radius changes affect resource budgets.** The high/medium height bake grows from 512 to 1024 pixels per face above R256, adding 36 MiB; low quality grows 384 to 768, adding 20.25 MiB. Shrinking must release the larger allocation. Verify repeat growth cycles.
- **Budget the instantiated scene.** Template triangle counts are multiplied by active instances, plus outlines and shadows. Current templates are mature/twin/juvenile fans 1,014/1,008/834, fragment 119, planted shelf 3,978, ivory 600, coral 420 and creeping/upright sage 620 each. The scenery CPU test retains a 3-million-triangle ceiling. Reduced templates inside cliffs and sparser remote ground plants make room for better local silhouettes.
- **Decorative cliffs are not navigable terrain.** Current picking and locomotion follow the analytical terrain. A walkable rock top, bridge or cave needs a deliberate collision/navigation design; drawing a mesh does not add one.
- **Shader dependencies are local to each pass.** A helper available in a terrain shader is not automatically available in the scenery fragment shader. An undefined angular-distance helper briefly left only the separate outline pass visible. Compile the complete scene and inspect console errors after shader edits; TypeScript cannot catch GLSL errors.
- **Do not run visual suites during hot reload edits.** Concurrent writes destroyed a browser execution context and produced a misleading resident-test failure. Finish the coordinated edits, then run integrated checks against one stable version.
- **Audit shared dependencies before merging an older world.** Main replaced the saved-find rendering interface while this canyon was being built. Two shared shader files were deleted and two others changed their vertex attributes. The canyon now preserves all four matching shaders locally with its packed-form renderer. A conflict-free merge or a successful TypeScript check cannot detect a mismatched GLSL interface; build and open the integrated scene. Also smoke-test the world scaffolder after upstream files move or disappear.

## Files and checks to use

The canyon [construction notes](../environments/scarlet-sail-canyon/CONSTRUCTION.md) map every module. The main change points are:

| Concern | Files inside `environments/scarlet-sail-canyon/` |
| --- | --- |
| Large relief, protected home, lower valley | `planet/fields.ts`, `fields.glsl`, `terrain.ts`, `terrain.glsl` |
| Bake precision and ground sampling | `planet/bake.ts`, `bake.frag.glsl`, `life/fieldMap.ts`, `fieldMap.frag.glsl` |
| Asset shapes and planted rock kit | `life/canyonGeometry.ts` |
| Local composition and global density | `life/canyonScenery.ts`, `life/canyonDistribution.ts` |
| Materials, plant scaling, ground skirts, contour pass | `life/canyonScenery.*.glsl`, `canyonGround.*`, `canyonInk.*`, `render/glsl.ts` |
| Home mesh, surfaces and material categories | `life/props.ts`, `props.frag.glsl` |
| Native species, routes, poses and shadows | `life/canyonFauna*` |
| Home/observation framing and terrain refresh | `world.ts` |
| Resident and wildlife controls | `ui/canyonUi.ts`, `ui/canyon.css` |

Run from the isolated checkout:

```sh
npm run check:scarlet
npx vitest run environments/scarlet-sail-canyon --maxWorkers=2 --testTimeout=60000
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:ecology
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:residents
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:invariants --grep 'CPU and GPU agree|determinism'
npm run build:scarlet
git diff --check
git diff --name-only -- src
```

The last command should produce no paths. The ecology check writes actual app screenshots to `shots/scarlet-sail-canyon/`: `revised-postcard.png`, `revised-settlement.png`, `revised-planet.png`, `chalkstep.png`, `fern-sifter.png` and `dewwing.png`. These captures are generated outputs, not the concept art. Regenerate them after changes; do not judge an old file whose name happens to match. Inspect the close-up foliage, shelter floor/rock attachment, landscape composition and globe separately.

### Flat moss paint and a missed terrain edge

The next close-up review exposed two problems that the earlier five camera paths had not caught. Broad olive colour islands in the chalk material were presented as moss but had no geometry or thickness. An isolated shader toggle removed exactly those patches while preserving the actual raised sage leaves. The fix is to replace this visual role with a separate raised moss anatomy, not to add more pigment or relabel the existing flat result as finished vegetation.

The reported repeated triangular teeth remained when every decorative scenery mesh was hidden. They belong to the analytical terrain rendering, which the earlier rock-cap overlap audit does not cover. The cause is a partial terrace: the recipe builds a full 5.6 m step and clamps natural height to it. At this edge the actual drop is about 0.8 m, so clipping truncates the intended 2.4 m ramp into roughly 0.5 m. A coarse grid resolves that strip as alternating triangular risers. Interpolating between the actual clamped endpoint heights over the full ramp width preserves the settlement and full-height beds while making the partial step resolvable.

Height-function parity tests did not catch this: CPU and GPU could return matching heights while the rendered triangle surface poorly approximated them between vertices. The follow-up regression samples actual triangle interiors against the analytic height field. At the reported ledge its maximum centroid error fell from 0.639 m to 0.121 m on the original grid, or 0.044 m on the denser grid now used by the canyon. Fresh visual verification also checks rear cliff shading, rather than extrapolating from the first edge. Evidence is gathered at pose `0.1015,-0.1997,0.6176,0.754,0.647`.

The rear canyon had another short transition: one regional fall crossed a full bed in roughly 1.1 m. Widening its bed blend and using the canyon's 33-vertex grid with range factor 8 reduced the sampled rear error from 2.30 m to 0.203 m. This fixed the coarse shape, but long triangular colour bands still remained. They came from interpolating vertex normals across steep terrain. Fixed-footprint, centered 0.45 m slope samples in the fragment shader removed the remaining comb. Direct screen derivatives of the baked field produced noisy vertical normals and were rejected. Separate geometry error from shading error; either can look like the same sawtooth defect.

The raised moss uses separate kind-9 geometry: thick irregular mats with short fibers, not enlarged sage leaves. A scalar plant anchor initially let tall/short parent cliffs cut through these broad mats. Each moss patch now stores one continuous fitted support plane; height scaling changes that plane while preserving the body and fiber thickness above it. This is different from independently ray-projecting every vertex across unrelated cliff levels. Tests cover cap contact at height scales 0.27, 1 and 2.05, and normals follow the same support-plane shear. The first thick mat was still visually wrong: vertical sidewalls, a simple raised strip and flat triangle normals made it look like cut green stone. The subsequent shape pass uses different lobed outlines, tapered rims, smoother body normals and short edge fibers. Do not accept a thickness test as proof that the new surface reads as moss.

### Better individual plants still formed mechanical gardens

The next user review rejected regular vegetation patches and, from the globe view, regular rocks. Improving moss anatomy and materials had left the composition unchanged: ground pockets repeated the same red/ivory/green bouquet, every shelf reused the same planting positions, and 384 Fibonacci sphere sites distributed remote outcrops evenly. Random rotations or a few different leaf silhouettes could not repair these repeated arrangements. This was a placement failure at three scales: within a bed, between neighbouring shelves and across the planet.

The concept uses unequal vegetation masses along sheltered rock feet, cracks and tree roots, separated by open chalk. Ground pockets now have their own stable random stream, variable extent, bent lobes, small satellites and different plant communities. Some beds omit red or ivory entirely; small isolated shoots contrast with large connected colonies. Existing home and resident clearance checks still apply. The four planted-shelf compositions vary occupancy as well as outline: broad connected cover, narrow broken seams, mixed pockets and a nearly bare cap. Shelf forms and instance width/height also vary, instead of placing one equally proportioned rock under every tree. Broad patches still require full support checks on their final parent shape; variation must not undo grounding or introduce intersecting surfaces.

The pure `life/canyonDistribution.ts` generator replaces the global lattice with up to 64 seeded colonies of unequal population. A broad correlated abundance field and two open basins produce dense and sparse regions. Satellite positions use unequal distances in bent, elongated clouds rather than fixed-radius rings. A minimum root separation of 0.045 radians rejects near-coincident assembly roots across colonies, and the site count is capped at 384. At seed 412 it produces 284 sites; tested seeds 1, 412, 771 and 2026 produce 256–293. Runtime placement retains spherical terrain anchoring, varies shelf/fragment proportions, and uses regional richness to vary flora occurrence. The root-spacing rule is not proof that complete rock meshes cannot intersect; geometry and exposed-surface audits remain separate responsibilities.

The placement regression checks deterministic regeneration without shared mutable state, changed output for a different seed, unit directions, finite bounded parameters and the site budget. It independently measures close neighbours and a broad empty spherical cap, and checks unequal colony populations. It does not assert specific random coordinates. Actual-view review is still required: a seeded distribution can pass those checks while looking like a repeated motif. Compare the same close postcard and a whole-globe view before and after, not only the generator's statistics.

## Active record and remaining limits

Updated during the correction pass on 1 November 2026:

### Latest vegetation and rock distribution follow-up

The working distribution pass addresses the repeated ground bouquets, shelf planting layouts and evenly spaced global outcrops described above. At the user's close pose `-0.0859,-0.0242,0.6199,0.7796,0.624`, the before/after postcard comparison shows larger connected colonies, small outliers, unequal shelf occupancy and more planting along rock feet. The globe capture shows grouped outcrops separated by open basins. Retained [before](../environments/scarlet-sail-canyon/reference/distribution-before.png), [settlement](../environments/scarlet-sail-canyon/reference/distribution-settlement.png), [globe](../environments/scarlet-sail-canyon/reference/distribution-globe.png) and [motion](../environments/scarlet-sail-canyon/reference/distribution-motion.mp4) are in the reference package. The strict globe frame-lock limitation is documented in [validation](../environments/scarlet-sail-canyon/VALIDATION.md): the initial hash differs even though the subsequent repeat/returned hashes and saved planet pixels agree.

All 133 environment CPU tests across 14 files, scoped TypeScript/lint and the standalone build pass. Eleven focused browser checks pass: six resident interactions, native ecology, three determinism cases and MSAA colour bounds. The previous 120-test record below belongs to the preceding moss/terrace version. The actual-view review found the previous repetition substantially reduced, but close-view beds are now predominantly olive and the largest foreground colony still reads as two dense lobes. The concept's differentiated red runners and occasional ivory pockets remain useful comparison points. This is an iteration record, not a claim of final visual acceptance.

### Previous moss and terrace follow-up

The later close-up revealed flat chalk pigment masquerading as moss and two separate terrain shape/shading defects; the causes and rejected fixes are recorded above. The current working tree replaces the broad olive paint with raised, tapered moss mats, corrects partial terrace ramps and regional fall width, increases canyon-local mesh detail and evaluates centered terrain normals per pixel. No shared `src/` file changed.

All 120 environment CPU tests and 16 focused browser checks pass, along with scoped TypeScript/lint and the standalone build. Four determinism/MSAA checks also pass after the final moss pigment edit. The final six-view camera recording repeats and returns to identical hashes without captured errors. Visual review includes the reported edge and rear cliff, not only the shelter. See [validation](../environments/scarlet-sail-canyon/VALIDATION.md) for scope and cost.

Current evidence: [before](../environments/scarlet-sail-canyon/reference/moss-terrace-before.png), [after at the same pose](../environments/scarlet-sail-canyon/reference/moss-terrace-after.png), [raised moss profile](../environments/scarlet-sail-canyon/reference/moss-profile.png), and [six-view motion](../environments/scarlet-sail-canyon/reference/moss-terrace-motion.mp4). Moss remains stylized; raised geometry and a passing test do not establish that its density or silhouette fully matches the concept. User acceptance is still pending.

### Previous material and surface review

The next user review rejected the current visual fidelity despite the successful merge. Five issues are active again: possible overlapping-plane flicker; an under-detailed shelter that still differs from the reference; ground material; small spherical-looking shrubs and insufficient tree variation; and rock texture. The current refinement is on `planet/scarlet-material-refinement` in the former main integration checkout. Treat earlier screenshots as the **before** state. Do not infer visual approval from the earlier “not bad” response or from passing tests.

The reference calls for warm mineral paths with loose chips, irregular moss mats spilling over chalk ledges, layered olive shrub silhouettes, distinguishable mature/branched/juvenile scarlet fans, fine fractures in cool chalk faces and a sagging rock-backed lean-to with visible supplies and lashings. The floor-union fix remains a contract; surface stability must also be checked outside that floor, including rock caps, vegetation and ink. That pass recorded 109 passing CPU tests, 16 passing focused browser checks, a passing scoped check/build, and five reproducible camera-motion paths. See the current validation record and fresh material review captures; visual acceptance remains with the user.

Two surface defects were identified independently of the material changes: neighbouring rear curtain strips overlapped by 2 cm, and ten fragment-cap triangles sat only 0.5–1.6 cm above terrain because the general embed amount nearly cancelled their small height. The curtain is now one continuous folded sheet; small fragments use their own shallower grounding depth. The new surface audit checks same-facing coplanar overlap, exposed cap proximity and shelter/terrain separation. It does not treat hidden opposite-facing contacts inside closed objects as exposed flicker.

Close review also rejected a ground shader that scattered a similar chip in nearly every cell and painted broad olive islands over the path. The revision keeps the path mineral, varies chip shape and size, and uses sparse clustered occupancy. Leaf, cloth, wood and stone strokes use different structures, with their pixel footprint calculated before material branches. The first integrated preview caught the reserved GLSL identifier `patch` in the shelter shader; renaming it restored the missing shelter. Always check the running renderer after shader edits.

Previous material-pass evidence: [settlement](../environments/scarlet-sail-canyon/reference/material-settlement.png), [shelter](../environments/scarlet-sail-canyon/reference/material-shelter.png), [floor](../environments/scarlet-sail-canyon/reference/material-floor.png), [understory](../environments/scarlet-sail-canyon/reference/material-understory.png), [planet](../environments/scarlet-sail-canyon/reference/material-planet.png), and the [camera-motion recording](../environments/scarlet-sail-canyon/reference/material-motion.mp4). The surface audit found no competing exposed cap sheets in its tested cases; five paths reproduce exact frozen frames after travel. The shelter retains its inherited walking footprint and the drawing still has denser fine foliage and linework. These are concrete remaining differences, not defects to conceal with a favourable camera.

The first motion-review script used slow mouse drags. Under recording load, a drag could trigger the hold-to-Bloom gesture before crossing its movement threshold, greeting residents and changing their pose. The final script drives `rig.drag` directly, asserts actual camera movement, and resets each full named view including pitch. Distinguish interaction state changes from unstable rendering before changing the renderer or weakening frame assertions.

The table below records the **previous delivery**; it is retained as history, not acceptance of the current refinement.

| Item | Previous evidence |
| --- | --- |
| Relief, valley opening, foot grounding and bake precision | Five GPU terrain checks pass after the final opening and nearest-half changes, including the unchanged 2 cm threshold. Terrain/ground CPU checks pass. |
| Understory geometry | Seven targeted geometry tests, TypeScript and lint pass. Live review shows recognisable feathered ivory and fine branched coral. Sage retains some visible leaf gaps. Fresh integrated screenshots show the revised plants alongside the Fern Sifter; the saved checkpoint is linked below. |
| Shelter surface conflict | **Verified:** union-partitioned floor ownership removes coincident board tops and overlapping slab caps. The new area/coverage regression passes, and a fresh capture of the reported steep camera shows clean timber and chalk without the jagged strips. The broader cottage silhouette is still subject to visual review. |
| Inherited flora | **Verified for ambient and decorative beds:** default ambient flower count stays zero before and after Bloom; native foliage changes colour; bed channels report coral, ivory, sage and young coral. The shader/interaction check passes. Saved-find specimens remain a separate intentional content system. |
| Full integration and production build | 87 environment CPU tests and scoped TypeScript/lint pass. All six resident browser checks, the ecology check, five terrain GPU checks and all three frozen-frame determinism checks pass. The final standalone build passes and the actual-app screenshots are refreshed. The indexing change preserved the frozen frame exactly. Exact results are maintained in `VALIDATION.md`. |
| Visual acceptance | After the surface and foliage corrections, the user said “not bad” and authorised committing and merging this standalone delivery. Preserve the remaining limits below; this is not a claim of pixel-for-pixel fidelity to the concept. |

Previous-delivery actual-app checkpoints: [settlement](../environments/scarlet-sail-canyon/reference/checkpoint-settlement.png), [reported floor angle](../environments/scarlet-sail-canyon/reference/checkpoint-floor.png), and [understory](../environments/scarlet-sail-canyon/reference/checkpoint-understory.png). These are implementation evidence, not replacements for the primary concept.

The inherited deck footprint constrains the shelter's silhouette. If it remains visibly too large or stage-like, revise the support/navigation contract rather than adding more trim. Native animals use deterministic ambient loops, not a complete ecosystem. Observe cameras frame once; an animal can turn afterwards. Muse neighbours are local saved inhabitants; live friend-agent presence and cross-planet allocation remain backend work. The art direction is still stylised 3D, with less fine drawn detail than the concept.

## Performance handoff

The following indexing measurements describe the previous delivery. The material refinement reduces the settlement to about 2.68 million submitted triangles in 91 draws; a new comparable synchronous timing benchmark has not been run.

At the previously reviewed R128 settlement, custom scenery accounts for 2,638,621 of 3,181,892 submitted triangles, plus 1,468,836 ink segments that are not part of the triangle total. Of 306 shelves, 276 are remote from the authored settlement. Every active batch is submitted from a close view; a fragment shader fading ink does not eliminate its vertex work. Native garden beds contribute about 165,020 triangles, so reducing those is not the first priority.

The implemented optimization indexes existing scenery geometry at the batching boundary. Source templates remain non-indexed for construction and support raycasts. Unique mesh vertices fell from 7.92 million to 3.15 million while preserving triangles and every normal, UV, material and plant-support attribute. The frozen before/after frame hash is identical. A short local GPU-synchronised benchmark improved from 45.67 to 21.74 ms/frame over 30 renders after eight warmups, at 1600×1000 on high quality. This is one local run, not a 60 fps guarantee. The [measurement record](../environments/scarlet-sail-canyon/reference/render-benchmark.json) preserves both results; its asynchronous HUD GPU timer is not the benchmark metric.

The next larger improvement would be camera-dependent detail for remote planted shelves and near-only ink instance lists. Keep the local reference composition intact. Do not simply enable ordinary mesh frustum culling: source-template bounds do not describe the shader-warped whole-planet instances. Full-detail remote shelf foliage alone accounts for about 0.91 million triangles that could use a cheaper distant representation.

## A concise continuation prompt

> Continue the isolated Scarlet Sail Canyon implementation using this handoff and the attached primary concept. First read the active record and current validation, inspect the actual running scene, and verify checkout/port. Preserve the reference's dominant chalk terraces, open right-hand canyon, three distinct understory families, broad scarlet fans, rock-backed single-awning shelter and three native animal species. Fix remaining mismatches at their geometric or placement cause. Keep shared `src/` and other worlds unchanged. Maintain this record while working. Show actual app screenshots and verified checks; do not treat a successful build as proof of a visual match.

## Windows open-land vegetation follow-up — 2 November 2026

The user requested broad vegetation patches in relatively flat rock-poor regions, more growth in rock cracks and more clouds around the planet. The environment now has separate low-cost raised groundcover colonies and interrupted moss/coral/ivory rock-foot seams, with cloud defaults raised to coverage0.48 and altitude32m. The first still review showed colonies too small from orbit; colony footprint and density were expanded. Level-only placement also left gentle slopes bare, so a single fitted support plane now preserves each mat/shoot while rejecting discontinuities. Surface and ink share the same slope transform; do not revert to per-leaf projection across cliffs.

Current [globe](../environments/scarlet-sail-canyon/reference/open-land-globe.png), [close](../environments/scarlet-sail-canyon/reference/open-land-close.png) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) record the result. Windows checks: 135 CPU tests, four focused hardware browser checks, scoped check and build pass. Hardware: RTX4070SUPER/ANGLE D3D11; stills1280x800/DPR1/high/time12. No shared src/, server/ or other-world changes. Vegetation still leaves exposed terraces and protected routes; user visual acceptance is pending. Historical strict recorder first-globe mismatch remains unresolved; no assertion or golden was relaxed.

## Moss-understory and cloud families — 2 November 2026

The user then asked for plants on the moss-covered areas and more variation in cloud shape/formation. Two combined plant/moss assemblies now add coral/olive and ivory/olive communities to a seeded subset of mats; their roots are sampled against the actual moss top. They share emergence and continuous ground fitting so a plant cannot be admitted independently of its supporting mat. Plain moss separates taller pockets; the rock/home/corridor recipe is preserved. At the reviewed seed412/R128 there are 1,242 planted mats, with two small plant groups per mat.

Five cloud families replace the single repeated bank outline. Unequal spacing and coherent bends, girth/altitude variation and short family runs produce different formations without changing the 8-puff texture contract or 512-cloud cap. A new silhouette test initially failed; the actual wisp was lengthened rather than lowering its distinction threshold. The existing animated culling bound remains.

Current [globe](../environments/scarlet-sail-canyon/reference/moss-plants-user-globe.png), [coral/olive](../environments/scarlet-sail-canyon/reference/moss-plants-coral-moss.png), [ivory/olive](../environments/scarlet-sail-canyon/reference/moss-plants-ivory-moss.png), [metadata](../environments/scarlet-sail-canyon/reference/moss-plants-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) supersede open-land-* for this follow-up.139 CPU tests, 5 hardware browser checks, scoped check/build pass. Renderer RTX4070SUPER/ANGLE D3D11,1440x900,DPR1/high. These are not Mac Metal or SwiftShader baseline comparisons.

The additional time12→18→12 globe capture failed its canvas-hash return comparison. No cause is proven; retain the failed diagnostic separately from the passing named browser checks and the older unresolved strict initial-globe mismatch. No assertion/golden was relaxed. Art acceptance remains with the user.

## Trees among the moss — 2 November 2026

The next user request adds modest uneven fan-tree groves to the moss-covered plains. The selector reuses actual moss sites and tests the same parent footprint, orientation and emergence against current terrain. Trees root in soil, remain upright and vary in scale/phase; they append to the existing three canopy batches so prior tree habits and geology stay stable. At seed412/R128,72 additions bring the fan-tree total to289. Scenery stays at15 batches and2,344,712 submitted triangles; the existing three-million limit and resident/contact checks pass at all six radii.

Current [globe](../environments/scarlet-sail-canyon/reference/moss-trees-globe.png), [grove detail](../environments/scarlet-sail-canyon/reference/moss-trees-grove.png), [metadata](../environments/scarlet-sail-canyon/reference/moss-trees-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) record140 passing CPU tests, five focused native-D3D11 browser tests and passing scoped check/build. Captures: RTX4070SUPER,1280x800,DPR1,high/MSAA4,time12, no captured errors. Earlier hash diagnostics remain open. Fresh baseline: workspace handoffs/windows/scarlet-moss-trees-2026-11-02T08-34-31-556Z. Preview5227 retained; no commit/push/deploy.

## Fuller groves follow-up — 2 November 2026

At the user's request for more, a second seeded pass expands stands into wider parts of the moss colonies. The original tree selection remains an unchanged prefix. Same ground support, spacing, upright roots and three canopy batches; the total candidate cap is now 880. At seed 412 / R128, this adds another 136 trees: **208 moss trees versus 72 before, and 425 total fan trees versus 289**. Scenery totals 2,473,898 triangles; the unchanged three-million limit passes at all six radii.

Current [user view](../environments/scarlet-sail-canyon/reference/fuller-groves-user-globe.png), [comparison](../environments/scarlet-sail-canyon/reference/fuller-groves-comparison.png), [metadata](../environments/scarlet-sail-canyon/reference/fuller-groves-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) supersede the first grove distribution. 140 CPU tests, five focused hardware browser checks, scoped check/build pass. Hardware evidence: RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12, no captured errors. Fresh baseline: workspace handoffs/windows/scarlet-fuller-groves-2026-11-02T08-46-25-904Z. Earlier hash diagnostics remain open; preview5227 retained and no publication performed.

## Light-yellow cloud color applied — 2 November 2026

**Subsequently rejected by the user and reverted; see the next record.**

The proposed butter-yellow cloud color is now implemented after the user reported it was not visible. Only Scarlet's five noon cloud palette cells change: yellow body `#FFF2CC`, ivory light, cream shadow/base and nearly white rim. The shared cloud shaders already read the environment palette consistently for visible clouds and reflections, so no shader fork was necessary. Dawn/golden variation, shapes, coverage, movement, shadows, trees and terrain remain unchanged.

Current [user view](../environments/scarlet-sail-canyon/reference/yellow-clouds-user-view.png), [globe](../environments/scarlet-sail-canyon/reference/yellow-clouds-globe.png), [metadata](../environments/scarlet-sail-canyon/reference/yellow-clouds-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) record the visible warmer shading. Scoped check/build and one MSAA color-bound browser check pass; no new broad-suite result claimed. RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12, no captured errors. Baseline: workspace handoffs/windows/scarlet-yellow-clouds-2026-11-02T09-05-57-774Z. Older hash diagnostics remain open; preview5227 retained, no publication.

## Cloud color reverted and density increased — 2 November 2026

User feedback: yellow looks bad; restore the clouds and increase density. The exact original noon cloud palette is restored, and default coverage is now0.78 (previously0.48). Existing altitude32, five shapes, drift, optical-depth shadows and cap512 are retained. Matched seed412/R128/time12 cloud count rises from95 to124, about31%; visible overview count rises82→107. Trees and terrain remain unchanged.

Current [globe](../environments/scarlet-sail-canyon/reference/denser-clouds-globe.png), [close view](../environments/scarlet-sail-canyon/reference/denser-clouds-close.png), [metadata](../environments/scarlet-sail-canyon/reference/denser-clouds-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md) supersede the rejected yellow experiment. Scoped check/build and two focused native-D3D11 browser checks (frozen redraw, MSAA color bounds) pass. Actual captures use RTX4070SUPER,1280×800,DPR1,high/MSAA4,time12 with no collected errors. Baseline: workspace handoffs/windows/scarlet-denser-clouds-2026-11-02T09-12-23-828Z. Older hash diagnostics remain open, preview5227 retained, no publication.

## Local mainline integration — 2 November 2026

User-authorized source commit05b773c was merged with fetched main4259aea as54830ea in an isolated worktree. Four Scarlet-local shaders preserve the pre-merge grass/character optical-depth shadow and porch-stove glow contracts. An initial browser run caught the new shared grass shader's missing shadow include; the matching local shader fixed the runtime failure. Shared engine/server/lockfile files remain as upstream main.

Final validation: 140 CPU tests, five focused native-D3D11 browser checks, scoped check and build pass. Matched shelter/globe captures have identical pre/post-merge hashes and no collected errors at1280×800,DPR1,high/MSAA4,time12 on RTX4070SUPER. See [images and metadata](../environments/scarlet-sail-canyon/reference/mainline-review.json) and [validation](../environments/scarlet-sail-canyon/VALIDATION.md). Older initial-globe/time-return diagnostics remain open. Normal preview5227 is retained; this merge is local, with no remote push or deployment requested.
