# Cobalt Windfields — active validation record

Updated 1 November 2026. **Visual acceptance remains open.** The latest correction addresses coincident surfaces, flat rock and sand materials, red habitat spikes, and repetitive edge-on foliage. All **66 CPU tests**, scoped and repository-wide TypeScript/ESLint checks, the production build and **14 targeted browser checks** pass for this revision. The built-page smoke check also passes. The scene remains more angular and simplified than the references, particularly the shelter and distant terrain.

## References and starting evidence

- [Primary concept](reference/primary-concept.png): the main composition and material reference.
- [Expanded world setting](reference/world-setting.png): supplementary geology, ecology and inhabited scale.
- [Creature sheet](reference/creatures.png): Sailback, Kitelet and Sand Stitcher anatomy and habitats.
- [Opening before the rebuild](reference/before-opening.png): actual application evidence of the rejected result, not a design reference.

Work is isolated to `environments/cobalt-windfields/`. The shared meadow `src/`, other environment folders and the separate Scarlet checkout are outside this rebuild. The development URL is `http://localhost:5217/environments/cobalt-windfields/`.

Use the references themselves when continuing. The Scarlet [reference handoff](../../docs/planet-reference-handoff.md) supplies the comparison and evidence workflow; its species, palette and acceptance history do not apply to Cobalt.

## Current material, foliage and surface correction

This pass responds to the user's close-up screenshots and saved camera pose `-0.5712,0.5324,0.3232,0.5347,0.891`. All changes remain inside `environments/cobalt-windfields/`.

| Reported problem | Correction and evidence boundary |
| --- | --- |
| Potential flickering where planes conflict | Sand deposits formerly emitted undersides exactly on rock caps; stacked beds likewise shared their supports' cap planes. Hidden bases now embed 3.5 cm into their supports while the visible sand rim still meets the rock. A positive-area coplanar-overlap test checks all nine geology prototypes, allowing only buried support faces. This tests actual triangle intersections rather than duplicate vertices or edge counts alone. |
| Shelter contacts still contained coincident surfaces | The complete-shelter audit found 22 exposed coplanar triangle-pair overlaps: the door and recessed opening bases, lookout guard-post bases, and handle back. Bases now embed into their supports, and the handle enters the door slightly. The complete-shelter regression finds no positive-area overlap at or above the floor. The previous floor-union area and single-cap checks remain unchanged and pass. |
| Ink edges could be pulled through an intersecting surface | Geological lines now offset 2.5 mm along the outward geometry normal instead of moving 5 mm toward the camera. Normal depth testing remains enabled and line depth writes remain disabled; no blanket polygon offset hides coincident faces. |
| Rock faces looked uniformly blue and flat | `render/mineral.glsl` is shared locally by scenery and shelter materials. It adds continuous diffuse separation between face orientations, several scales of mineral color variation, restrained surface-normal relief, irregular fracture marks and fine grains. Coordinates follow physical scale; fine detail fades with pixel footprint. Cliff-front and rear profiles also have modest actual fracture-depth variation, without raised triangulation centers. These changes improve material cues but do not establish geological or reference fidelity. |
| Peach ground did not read as sand | The ground now combines irregular wind ripples, broad warm washes and grain at different scales, with fine detail filtered by pixel footprint. Sand deposited on rock keeps its own material. The former flat-material result is retained for comparison; fresh material captures are linked below. |
| Red upright spikes did not resemble coral | Those objects were Sand Stitcher habitat props, not coral. Their repeated red stakes have been replaced by low, irregular tan twig litter, retaining the carried-stem behavior. Actual coral remains in sheltered branching colonies. |
| White leaves disappeared edge-on and repeated the same silhouette | Sail blades are now single cupped, twisted membranes with smooth normals and branches facing different directions. The small plants used by Kitelets have three different landing-cup and branching forms, with varied physical scale and matching landing heights. Ambient planting mixes adults and juveniles with independent size, heading and offset; coral size and orientation vary more widely. Spacing guards prevent duplicated root points and nearly coincident repeated rocks. No doubled leaf cards or unrelated meadow plants were introduced. |

### Verification for this revision

| Check | Latest result |
| --- | --- |
| Environment CPU suite | **66 tests passed.** Includes new geometry, surface-overlap, leaf visibility/variation and habitat checks. |
| Scoped TypeScript / ESLint | **Passed.** |
| Repository-wide check | **Passed.** |
| Production build | **Passed**, retaining the existing large-chunk warning. |
| Resident, native-find and review-angle browser checks | **All seven checks passed.** |
| Terrain parity, picking and determinism browser checks | **All seven checks passed.** |
| Final frozen-frame and triangle-order probe | **Three frozen views repeat exactly.** Reversed submission retains isolated pixel sensitivity; results below. |
| Built-page smoke | **Passed:** all three wildlife views, greeting, overview and vista, with no collected JavaScript, WebGL or local HTTP errors. |

The final probe used high quality, DPR 1, a fixed render scale of 1 and frozen time 12 s at 1,440 × 900. Three views (user pose, vista and homestead) repeated exactly. Reversing triangle submission in 17 scenery/homestead meshes changed **17 / 24 / 9 pixels** respectively out of 1,296,000; **5 / 2 / 2 pixels** changed by more than 12 channel levels. Every changed pixel was isolated: the largest eight-connected component was one pixel. No page or WebGL errors were recorded. The close shelter and rock captures show no broad overlap bands or competing cap patches. The residual sensitivity is consistent with edge/intersection depth precision, but this is **not** proof that every instance, camera, cross-mesh draw order or animation is flicker-free. See the exact [surface-order review](reference/surface-order-review.json).

Fresh actual-application evidence:

| View | Capture |
| --- | --- |
| Before this material correction | [Previous material appearance](reference/material-review-before.png) |
| User's reported camera angle | [Revised user angle](reference/material-review-user-angle.png) |
| Rock and sand close-up | [Rock](reference/material-review-rock.png), [sand](reference/material-review-sand.png) |
| Reverse-side view | [Revised reverse view](reference/material-review-reverse.png) |
| Shelter contact surfaces | [Shelter floor and steps](reference/shelter-floor.png) |

One medium-quality production smoke frame reported 58 draw calls, 1,443,434 submitted triangles, 206,989,702 GPU bytes and 3.32 ms GPU time. This is a single observation, not a benchmark or a sustained frame-rate claim.

The standard reference captures listed later in this record were also refreshed for the final correction. The earlier verification and production tables remain historical results; the table above governs this revision.

Known limits remain open: angular geological silhouettes, the rectangular shelter, insufficient distant layering, the 400-find memory budget, local-only residents and unimplemented account-backed travel. No visual acceptance or performance-budget claim follows from the passing CPU checks.

## Visual contract

| Relationship in the reference | Required reading in the application |
| --- | --- |
| Cobalt beds emerge through peach sand | Thick fractured ledges, broken blocks and a few tall fins; broad warm deposits interrupt their blue faces. |
| A valley continues through several depth layers | Uneven sloping sand banks around an open corridor, dark detailed foreground stone and pale blue distant strata. |
| Lines describe mineral structure | Selected silhouettes, bedding edges and restrained fractures; no triangulation diagonals or uniformly outlined polygon panels. |
| Ivory sails remain thin and sparse | Curved asymmetric membranes on branched stems, with varied heights and open space around the leaves. |
| Coral forms sheltered fan colonies | Broad shallow branches, rounded ends, connected forks and visible gaps, planted along actual rock edges. |
| Shelter belongs to the rock | A modest canvas porch against a rough rock-backed enclosure, with a supported, coherent floor. A clean floor alone does not establish the correct shelter silhouette. |
| Native animals are part of the landscape | Recognisable Sailbacks, Kitelets and Sand Stitchers in habitat, with readable bodies and physical contact at ordinary viewing distances. |

## Defects, causes and current rebuild

| Rejected symptom | Cause identified | Current implementation and evidence boundary |
| --- | --- | --- |
| Nearly uniform blue slabs over a large peach floor | Repeated geometric profiles, little landform hierarchy, and too little variation across material and distance. | `windGeology.ts` now provides nine families, with real open bed fissures, selectively clipped polyhedra, a broad inclined right-hand fin and nearer background layers. `windfieldScenery.ts` composes uneven belts. Final captures show the revised forms; their angularity and depth layering still fall short of the concept. |
| Floating rock corners or plants detached from their host | Centre-only placement does not account for slope across a wide footprint. | Rock support sites now determine downward base extension, shared by colour and outline placement. Plant anchors derive from accepted hosts’ authored lee sites, but their roots still use terrain samples rather than final rock-surface raycasts. CPU support tests and browser review-angle checks pass. Final captures include ground and reverse views; visual contact with individual rocks remains a review item, not a general rock-surface grounding guarantee. |
| Wireframe-like rock faces | Automatically selected mesh edges included construction geometry, and internal marks competed with contours. | Authored geological boundaries and bedding creases replace automatic triangle-edge selection. Fracture intensity and distance treatment have been reduced. The final captures retain visibly simplified angular contours; line fidelity remains under visual review. |
| Broad stone faces lacked peach ledge deposits | Sediment had been a weak, narrow shader blend confined to a few cracks. | Warm deposits now have explicit geometry/material ownership on selected beds, with thickness tapering to zero at their supporting edges. Their distribution is visible in final captures; this is not evidence that all reference colour relationships are matched. |
| Flat sand and visibly repeated rills | Fine sinusoidal striping was doing work that needed terrain relief and broad material variation. | Matching CPU/GLSL `localSandRelief` functions add broad banks and low crests outside protected resident routes. Sand paint now follows these banks with broad washes and interrupted directional strokes. GPU parity at default/minimum/maximum radius and growth/seed browser checks pass after these changes, with the original tolerances retained. |
| Changing palette rows did not reliably change the visible rock and sand | Main material shaders used independent hardcoded colours. | Sand and scenery rock now read their material rows from `render/palette.ts`. Palette, shading and aerial treatment were adjusted together and are represented in the final captures. Remaining visual differences must be assessed from displayed pixels; shader constants are not screenshot measurements. |
| Coral appeared as sharp radial twig thickets | Recursive branches spread in arbitrary three-dimensional directions, with tapering tips and separate tube joints. | Three authored shallow fan skeletons are meshed as joined rounded surfaces. The spreading, upright and low fans have closed connected meshes, no degenerate triangles or uncapped ends, and distinct proportions. They contain 3,300 / 3,164 / 3,128 triangles before instancing. Front-projected coverage remains below 43% in the focused geometry test. These structural checks are not visual acceptance. |
| Sail variants were nearly the same plant | Variants mostly changed scale and small rotations. | Paired-kite, tall-fork and broad-wind-flag layouts now have different branching, blade widths and profiles. Template heights are approximately 4.02 / 4.27 / 3.88 m, before instance scale. Curved thin blades remain; no generic fern foliage was added. |
| Shelter support contained overlapping surfaces | Separate floor, terrace and lookout boxes overlapped at the same cap height. | `props.ts` partitions their union so each occupied point has one cap. Support heights remain 0.72 / 0.48 / 0.24 m and exported walking footprints are preserved. Area and above-surface ray tests pass. The floor has a fresh steep-angle capture, but the shelter remains angular and stage-like. Rear attachment and the overall silhouette remain unresolved visual concerns. |
| Native wildlife was difficult to see in the opening | Small display scale, habitat placement and distance fading reduced visible presence. | Eleven authored animals occupy reserved local pockets: three Sailbacks, five Kitelets and three Sand Stitchers. Bodies currently use 3× display scale; visibility follows projected size, and inspection framing/contact placement follows that scale. The opening and all three encounter views now have passing browser checks and fresh captures. This validates the local display paths, not full-world wildlife population. |
| Inherited saved plants could bypass the native visual language | Ambient plant replacement did not cover separate saved-find specimen and bed paths. | Saved specimens and decorative beds now use native coral/sail families while retaining find and topic IDs. The final saved coral fan is wider with rounded tips and a 0.02 m minimum tip radius, rather than thin reeds. Three focused shape tests pass; a browser pixel probe verifies more than 150 changed pixels for each of the specimen and bed layers, and ID-based selection remains working. |

## Earlier rebuild verification

| Check | Status for this rebuild |
| --- | --- |
| Environment CPU suite | **59 tests passed** with `--maxWorkers=2` before the final saved-find base normalization. One initial test timed out during a concurrent production build; the unchanged suite passed on rerun. The final form adjustment received the focused checks listed below rather than another full-suite run. |
| Scoped TypeScript and ESLint | **Passed.** |
| Focused plant geometry and shelter support | **8 tests passed**, included in the CPU suite: closed connected coral, bounded geometry, open projected gaps, finite sail geometry, single shelter caps and supported step heights. |
| Final saved native-find forms | **3 focused shape tests passed** after widening the coral fan, rounding its tips and normalizing the specimen base upward by 0.07 m. Scoped TypeScript/ESLint and the production build also passed afterward. The final saved-find browser recapture passed in 6.7 seconds, including both >150-pixel layer checks, grounding and WebGL checks; `reference/native-finds.png` was refreshed. |
| Residents/native plants/review angles | **7 targeted browser checks passed:** opening and three species views; saved native finds and selection; resident rendering; greeting/renaming/persistence; growth and seed changes; whole-planet/mobile layout; ground, reverse and shelter review angles. |
| CPU/GPU terrain agreement | **3 checks passed** at default, minimum and maximum radius. Height error remains below 0.02 m and warp error below 0.005 m. |
| Frozen-frame determinism | **3 checks passed:** repeated load, frozen redraw and growth 0.3 → 0.7 → 0.3. |
| Picking | **1 targeted browser check passed.** |
| Production build and smoke check | **Passed**, with the large-chunk warning for an approximately 1.2 MB JavaScript chunk. The built standalone page passed all three wildlife views, greeting, overview and vista navigation with no JavaScript or WebGL errors. Single-frame measurements are recorded below. |
| Integrated captures | Fresh opening, wildlife, native-find, material, floor, ground, reverse, whole-planet and narrow-screen captures are available. See the evidence links below. |
| 400-find specimen memory budget | **Known unmet limit.** The inherited ≤1,000,000-byte assertion remains intact. An earlier analytic allocation was about 2.79 MB before the final fan expansion; the final allocation has not been measured. No 400-find GPU/performance run was completed. |
| User visual acceptance | **Open.** The previous result was rejected. The revised result is still more angular and simplified than the concept; tests and captures do not constitute acceptance. |

The browser count is **14 distinct targeted checks** across the recorded runs, not a claim that the full inherited browser/performance suite passed.

### Failures and repairs retained in the record

- **CPU timeout:** one CPU check timed out while a production build ran in parallel. The unchanged suite passed with two workers when rerun. No assertion was weakened to obtain the passing result.
- **Terrain diagnostic read an inactive map:** Cobalt disables the legacy ambient meadow field, so the parity probe initially read an unrendered all-zero field map. `measureParity` now explicitly renders the diagnostic map before reading it. The height and warp limits remain 0.02 m and 0.005 m; the three radius cases pass.
- **Native-find pixel probe was undone by frame updates:** hiding meshes through `visible` did not isolate their pixels because the normal update restored visibility. The probe now temporarily sets geometry draw ranges to zero, restores the target layer, reads actual framebuffer differences, and restores all ranges in `finally`. Both native specimen and bed layers exceed 150 changed pixels, and the saved find/topic IDs remain intact.

Detailed final-run logs are retained at `/tmp/cobalt-final-native-determinism.log`, `/tmp/cobalt-repaired-checks.log` and `/tmp/cobalt-final-captures.log`, with the last saved-find recapture in `/private/tmp/cobalt-last-find-check.log`. These temporary logs supplement this record; they are not durable substitutes for the repository evidence.

Do not run browser capture suites while source files are being changed. Freeze a coordinated revision first, then record exact commands, failures, repair attempts and fresh outputs. A screenshot already present under `shots/cobalt-windfields/` may predate the rebuild.

Commands to reproduce the targeted verification, from the checkout root:

```sh
npm run check:cobalt
npx vitest run environments/cobalt-windfields --maxWorkers=2
MEADOW_PORT=5217 npx playwright test --project=cobalt-windfields:residents
MEADOW_PORT=5217 npx playwright test --project=cobalt-windfields:invariants --grep 'CPU and GPU agree|determinism|picking'
npm run build:cobalt
git diff --check
git diff --name-only -- src
```

The last command should produce no paths from this rebuild. Inspect actual browser console errors; TypeScript and CPU tests cannot establish GLSL correctness.

## Known limits and remaining work

- Wildlife population is currently **11 authored local animals at 3× display scale**. Full-world wildlife population, distribution and lifecycle simulation remain absent. Local display enlargement is not evidence of world population or ecological completeness.
- Rock and plant distribution extends beyond the authored opening. Whole-planet captures exist, but global continuity and scale-dependent instance cost are not established by the opening or local encounter checks.
- Decorative rock meshes do not supply general walkable collision surfaces. Terrain and the authored shelter support contract control navigation.
- The shelter floor fix preserves the inherited footprint. The final shelter still reads as an angular stage-like structure. Correcting that silhouette may require a deliberate structural/navigation redesign; more trim is not evidence of a corrected form.
- Pip, Juniper and Marlo are local saved residents. They do not establish live friend presence, backend allocation of planets, or account-backed travel.
- Invitation travel remains a local route preview. Backend-managed cross-world travel and invitation redemption are not implemented.
- The final result remains more angular and simplified than the references, with a more open foreground and less layered distant land. Sand/rock relationships and line hierarchy still need visual improvement. Compare matched material regions and actual displayed pixels without subjective numerical similarity scores.
- The 400-find memory limit is unmet and remains a tracked failure. No 400-find GPU performance result or 60 fps claim is supported by this pass.

## External task updates

Two connection-discovery attempts found no accessible external task tracker. **No external tasks were created, updated or closed.** The following are proposed updates to apply when that destination is available:

| Proposed task update | Evidence or acceptance condition |
| --- | --- |
| Cobalt reference rebuild — in progress | Record the geometry, terrain, palette and ecology changes above. Keep visual acceptance open. |
| Coral/sail asset reconstruction — technically checked; visual acceptance open | Link the geometry/native-find tests and the final material/native-find captures. |
| Shelter support overlap — regression and capture available | Attach the union area/ray result and steep floor view. Keep the stage-like silhouette and rear attachment open separately. |
| Terrain and material integration — targeted verification passed; visual acceptance open | Attach the unchanged-threshold parity, determinism, growth and final-frame evidence. |
| Wildlife visibility — local views checked; full-world population unfinished | State the 11-animal local population and 3× display scale, and attach all three encounter views. |
| Saved-find memory budget — unresolved | Preserve the 400-find ≤1 MB test and record the known allocation overrun. Measure the final forms before considering the task complete. |
| Cross-world backend travel — not implemented | Keep the local route preview separate from account-backed travel. |

## Earlier rebuild capture evidence

These are actual application captures from the review runs, distinct from the concept images. The main review captures are copied into `reference/` for durable comparison; the latest native-find recapture is noted in verification status:

| View | Evidence |
| --- | --- |
| Opening / Wind Window | [Clean opening](reference/reference-clean.png) |
| Materials and close view | [Material close-up](reference/material-close.png), [previous user angle](reference/previous-user-angle.png) |
| Ground and reverse view | [Reverse ground view](reference/reverse-ground.png) |
| Shelter | [Settlement](reference/previous-user-angle.png), [steep floor view](reference/shelter-floor.png) |
| Native saved plants | [Saved coral and sail finds](reference/native-finds.png) |
| Native wildlife | [Sailback](reference/sailback.png), [Kitelet](reference/kitelet.png), [Sand Stitcher](reference/sand-stitcher.png) |
| Whole planet and narrow screen | [Whole planet](reference/planet.png), [mobile resident view](reference/mobile-resident.png) |

The captures show the revised construction and support further comparison. They do not close visual acceptance: foreground occupancy, natural geological complexity, the shelter silhouette and distant layering remain visibly different from the references.

## Earlier production measurements

The final built standalone page passed all three wildlife observation views, greeting, overview and vista navigation with no JavaScript or WebGL errors. The persistent development server listens on `127.0.0.1:5217`; the localhost application URL returned HTTP 200 over IPv4. Final `git diff --check` passed, and `git diff --name-only -- src` produced no paths. These checks do **not** verify the page currently visible in the user's app: direct inspection encountered a stale connection-refused error page, and the request to open the live page was queued.

One observed frame is recorded in `/private/tmp/cobalt-final-production.json`:

| Condition or measurement | Observed value |
| --- | --- |
| Reported render dimensions | 1,254 × 836; pixel ratio 1 |
| Quality / MSAA / render scale | Medium; 4 samples; 0.8708 render scale |
| Growth / radius | 0.1886 / 127.975 m |
| Animation | Running, not frozen |
| Draw calls / submitted triangles | 54 / 1,642,440 |
| Reported GPU allocation | 206,989,702 bytes |
| GPU / JavaScript / frame time | 7.72 ms / 1.60 ms / 16.7 ms |

This is a single diagnostic observation after the smoke sequence, not a benchmark. The log does not label the exact view at the sampled frame. It does not establish sustained 60 fps, performance across the planet or mobile performance. No 400-find GPU performance result is recorded, and the unchanged 400-find specimen-memory assertion remains unmet.

### Settlement wildlife visibility follow-up

The user's saved pose looks toward the shelter and excludes much of the foreground valley. One existing Sailback, Kitelet and Sand Stitcher now lives beside the settlement; the population remains 11. This is fixed habitat placement, not camera-relative spawning. Twelve focused wildlife/geology tests pass, including all supported radii and route clearance. Both opening/wildlife and saved-pose/reverse-angle browser checks pass after this change; their reference captures above were refreshed.

After this placement change, scoped TypeScript/ESLint and the production build passed again. The rebuilt standalone page passed all three Watch views, Pip's greeting, Whole planet and Wind Window, with no collected JavaScript, WebGL or local HTTP errors. The saved-angle capture visibly includes wildlife beside the shelter. The production smoke frame reported 54 draws, 1,642,440 submitted triangles and 206,989,702 GPU bytes at medium quality and 1,440 × 960; this remains a single observation, not a performance benchmark. The existing visual and 400-find memory limitations above remain open.

## Integration on current main

The `environment_blue_rocks` branch is based on main commit `ad37acf`. Outside this folder, its changes add only Cobalt's three package commands and its environment-index entry. The original working checkout is left intact.

Five shader files from the original `fb21a13` base now live inside Cobalt: the saved-find chunk, both distant-find sphere shaders, the grass vertex shader and the Muse shadow fragment. This preserves Cobalt's existing saved-find buffer layout and shadow behavior while using the newer shared engine. The browser spec explicitly includes Vite's asset declarations so the repository-wide Node type check can follow its typed World import.

Verification on this integration branch:

- `npm run check`: passed, including all three TypeScript projects and repository lint.
- `npm run check:cobalt`: passed.
- `npx vitest run environments/cobalt-windfields --maxWorkers=2`: all 59 tests passed.
- First-planet parameter, cast and garden guards: all 49 tests passed across three files.
- All seven Cobalt resident/native-find/review-angle browser checks passed.
- All seven targeted terrain/parity/picking/determinism browser checks passed.
- `npm run build:cobalt`: passed with the existing large-chunk warning.
- Built-page smoke: all three Watch views, greeting, overview and Wind Window passed without collected JavaScript, WebGL or local HTTP errors.
- Reference screenshots were refreshed from the integration branch's browser run.
- `git diff --cached --check`: passed after trimming a copied trailing blank line.

The meadow's `src/`, `index.html`, Vite configuration and lockfile are byte-unchanged from `ad37acf`. Frozen frame comparison at medium quality, DPR 1 and 1,440 × 900 found eight of nine views pixel-identical. The 70 m bird's-eye view also differs when compared with itself (1,227 pixels, then 300 on repeat), so its 1,120-pixel baseline difference is inconclusive. Diagnostic crops locate this noise around Muse beside the cottage, consistent with character pose timing. No page errors were reported. See [meadow isolation results](reference/meadow-isolation.json); this is not a claim of nine-view identity.

The known visual differences, 400-find memory budget, local-only residents and unimplemented account-backed travel described above remain open.
