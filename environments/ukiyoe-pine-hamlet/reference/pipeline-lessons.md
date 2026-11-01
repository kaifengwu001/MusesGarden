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
| Large leaf cards around a dome | Produced cabbage-like sheets and obvious holes | A smaller irregular low sage mound, 64 leaves with 14-point outlines and a leafy lower edge |
| Isolated plants on each shelf | Looked procedurally stamped | Six overlapping seams of reduced sage tufts, plus coral and ivory accents |

Instance scale matters as much as the source mesh. A 2.6× sage instance enlarged its gaps and leaf-card appearance. Remote ground sage was reduced to 1.5×. Do not fix a scale problem by adding polygons everywhere.

Current template sizes are approximately 1.28 m high for ivory, 0.61 m wide by 0.54 m high for coral, and 1.04 m wide by 0.47 m high for sage, before instance scale. These are implementation choices for this scene, not universal plant dimensions. Some leaf gaps remain visible in close views.

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
- **Budget the instantiated scene.** Template triangle counts are multiplied by active instances, plus outlines and shadows. Current templates are fan 1,202, fragment 119, planted shelf 3,790, ivory 600, coral 420 and sage 920 triangles. The scenery CPU test retains a 3-million-triangle ceiling. Reduced templates inside cliffs and sparser remote ground plants make room for better local silhouettes.
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
| Local composition and global density | `life/canyonScenery.ts` |
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

## Active record and remaining limits

Updated during the correction pass on 1 November 2026:

| Item | Current evidence and next action |
| --- | --- |
| Relief, valley opening, foot grounding and bake precision | Five GPU terrain checks pass after the final opening and nearest-half changes, including the unchanged 2 cm threshold. Terrain/ground CPU checks pass. |
| Understory geometry | Seven targeted geometry tests, TypeScript and lint pass. Live review shows recognisable feathered ivory and fine branched coral. Sage retains some visible leaf gaps. Fresh integrated screenshots show the revised plants alongside the Fern Sifter; the saved checkpoint is linked below. |
| Shelter surface conflict | **Verified:** union-partitioned floor ownership removes coincident board tops and overlapping slab caps. The new area/coverage regression passes, and a fresh capture of the reported steep camera shows clean timber and chalk without the jagged strips. The broader cottage silhouette is still subject to visual review. |
| Inherited flora | **Verified for ambient and decorative beds:** default ambient flower count stays zero before and after Bloom; native foliage changes colour; bed channels report coral, ivory, sage and young coral. The shader/interaction check passes. Saved-find specimens remain a separate intentional content system. |
| Full integration and production build | 87 environment CPU tests and scoped TypeScript/lint pass. All six resident browser checks, the ecology check, five terrain GPU checks and all three frozen-frame determinism checks pass. The final standalone build passes and the actual-app screenshots are refreshed. The indexing change preserved the frozen frame exactly. Exact results are maintained in `VALIDATION.md`. |
| Visual acceptance | After the surface and foliage corrections, the user said “not bad” and authorised committing and merging this standalone delivery. Preserve the remaining limits below; this is not a claim of pixel-for-pixel fidelity to the concept. |

Current actual-app checkpoints: [settlement](../environments/scarlet-sail-canyon/reference/checkpoint-settlement.png), [reported floor angle](../environments/scarlet-sail-canyon/reference/checkpoint-floor.png), and [understory](../environments/scarlet-sail-canyon/reference/checkpoint-understory.png). These are implementation evidence, not replacements for the primary concept.

The inherited deck footprint constrains the shelter's silhouette. If it remains visibly too large or stage-like, revise the support/navigation contract rather than adding more trim. Native animals use deterministic ambient loops, not a complete ecosystem. Observe cameras frame once; an animal can turn afterwards. Muse neighbours are local saved inhabitants; live friend-agent presence and cross-planet allocation remain backend work. The art direction is still stylised 3D, with less fine drawn detail than the concept.

## Performance handoff

At the reviewed R128 settlement, custom scenery accounts for 2,638,621 of 3,181,892 submitted triangles, plus 1,468,836 ink segments that are not part of the triangle total. Of 306 shelves, 276 are remote from the authored settlement. Every active batch is submitted from a close view; a fragment shader fading ink does not eliminate its vertex work. Native garden beds contribute about 165,020 triangles, so reducing those is not the first priority.

The implemented optimization indexes existing scenery geometry at the batching boundary. Source templates remain non-indexed for construction and support raycasts. Unique mesh vertices fell from 7.92 million to 3.15 million while preserving triangles and every normal, UV, material and plant-support attribute. The frozen before/after frame hash is identical. A short local GPU-synchronised benchmark improved from 45.67 to 21.74 ms/frame over 30 renders after eight warmups, at 1600×1000 on high quality. This is one local run, not a 60 fps guarantee. The [measurement record](../environments/scarlet-sail-canyon/reference/render-benchmark.json) preserves both results; its asynchronous HUD GPU timer is not the benchmark metric.

The next larger improvement would be camera-dependent detail for remote planted shelves and near-only ink instance lists. Keep the local reference composition intact. Do not simply enable ordinary mesh frustum culling: source-template bounds do not describe the shader-warped whole-planet instances. Full-detail remote shelf foliage alone accounts for about 0.91 million triangles that could use a cheaper distant representation.

## A concise continuation prompt

> Continue the isolated Scarlet Sail Canyon implementation using this handoff and the attached primary concept. First read the active record and current validation, inspect the actual running scene, and verify checkout/port. Preserve the reference's dominant chalk terraces, open right-hand canyon, three distinct understory families, broad scarlet fans, rock-backed single-awning shelter and three native animal species. Fix remaining mismatches at their geometric or placement cause. Keep shared `src/` and other worlds unchanged. Maintain this record while working. Show actual app screenshots and verified checks; do not treat a successful build as proof of a visual match.
