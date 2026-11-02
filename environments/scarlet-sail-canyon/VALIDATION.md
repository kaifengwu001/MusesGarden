# Validation

Validation history for the isolated Scarlet Sail Canyon environment. The [reference handoff](../../docs/planet-reference-handoff.md) records the visual failures, corrections and remaining work.

## Vegetation and rock distribution — 1 November 2026

This follow-up replaces repeated shelf plant layouts and uniform global outcrop spacing. Four rock/plant assemblies, irregular ground colonies and a seeded regional rock distribution are now implemented in the isolated canyon. The final source is on the dirty `planet/scarlet-material-refinement` working branch. Earlier records below apply to their stated revisions.

- **133 CPU tests pass across 14 files**, including seeded cluster/gap checks, all four rock/plant forms, support and normal transforms, exposed-surface separation, resident clearance and the three-million-triangle scenery budget.
- **11 focused browser checks pass:** six resident interactions, native ecology, three frozen-frame determinism checks and the MSAA colour-range check. Scoped TypeScript/ESLint and the standalone production build pass; Vite retains its existing large-chunk warning.
- The final shelf templates use 1,814 / 1,301 / 1,716 / 877 triangles and 3 / 3 / 5 / 1 moss mats respectively. All twelve authored mats survive support fitting. Their rock shapes remain within the original footprint and keep the central support at 3.22 m.
- Seed 412 produces 284 global sites in 64 unequal colonies, with regional density differences and open basins. The source budget remains 384 sites; minimum angular root spacing is a placement guard, not a universal non-intersection guarantee.

Two checks needed to follow the new composition: elevated support can be sub-millimetre while a site emerges, so the grounding test now classifies it above float32 noise while retaining its existing contact tolerance; ecology now counts all four shelf batches instead of treating batch index 3 as the entire world. The old >250 tree count encoded uniformly populated sites. The revised check retains substantial woodland (>150 trees), all three fan habits, all four inhabited shelf forms and all eleven animals.

The final [reference pack](reference/README.md) includes close/globe screenshots and a 21.071-second frozen-time recording with no captured runtime or shader errors. Close-view repeat and returned hashes agree. At the globe, the first framebuffer hash differs but the next repeat equals the returned hash; saved before/returned planet pixels agree (zero changed pixels in x349..959,y61..734). The camera matrices differ by about 1.42e-13. The strict recording command exits 1; do not count this as a completely passing frame-lock run or infer a proven cause for that initial sample. The helper now explicitly restores camera mode so replaying a globe view cannot default to walking zoom, and raw video is stored outside Playwright's disposable test-results folder.

The close and globe comparisons show unequal patch sizes, varied shelf occupancy and grouped outcrops. Many foreground beds remain olive-dominant, and the largest colony still has two dense lobes; those are visual limits, not proof of reference equivalence.

## Previous moss and terrace follow-up — 1 November 2026

Checked on the dirty `planet/scarlet-material-refinement` branch in the isolated integration checkout, served on port 5227. The later user close-up exposed flat painted moss and repeated triangular teeth on a terrain edge. Shader and scenery toggles isolated the painted moss from the terrain defect. The [latest reference package](reference/README.md) preserves the follow-up screenshots, camera recording and capture metadata beside the earlier evidence.

- **120 environment CPU tests passed across 13 files.** These include the new analytical-terrain ledge regression, raised moss contact and silhouette checks, and the earlier surface audits.
- **16 focused browser checks passed:** seven ecology/resident checks and nine terrain invariants, determinism and MSAA checks. `npm run check:scarlet` and `npm run build:scarlet` passed. The recording script also passed its final ESLint check.
- After the final moss pigment-only edit, **all four determinism/MSAA checks passed again**. The final 1600-pixel capture reported no runtime or shader errors.
- A **29.626-second frozen-time recording** covers six camera paths: shelter detail, floor contact, understory, grove, settlement and the exact reported terrace pose. Every camera moved; all six immediate-repeat and exact-return canvas hashes match. No runtime or shader errors were captured. Review at 2 fps, including full-resolution crops of the reported terrace, found no repeated terrace teeth, visible surface toggling, foundation clipping or ghost canopy in the sampled frames. Sampling does not rule out an isolated single-frame artifact between samples.

The terrain teeth had two causes. First, clamping a nominal full-height riser after interpolation compressed a shallow final step into less than one mesh cell. CPU and GLSL now interpolate the actual clamped shelf endpoints. The rear opening's full-bed risers also needed more physical width. Canyon-only grid33/rangeFactor8 resolves the resulting cliffs while retaining the shared CDLOD selection and morph contract. The regression measures actual morphed triangle interiors at the reported view, with maximum-error bounds of 0.05 m at the shallow ledge and 0.22 m at the rear opening; minimum height ranges prevent flattening the cliffs from passing as a fix.

Second, interpolated vertex normals still stretched steep cliff lighting across triangles after the geometry error was reduced. Centered per-fragment height gradients over a fixed **0.45 m** footprint remove that remaining comb pattern and supply the matching material slope. Direct screen derivatives of the height bake produced noise and were rejected. The centered approach added about 2.2 ms in a same-browser, terrain-only comparison at 1600×1000; this is a local cost estimate, not a frame-rate guarantee.

Shelf moss now uses raised **kind9 geometry** with three patch silhouettes, tapered/frayed edges, smooth normals and a continuous support plane per patch. The support plane follows the shelf's height scaling, and fine pigment marks give the raised mats texture. This replaces the flat paint source identified in the user's close-up. Contact checks cover the authored mats across the tested height scales; they do not certify arbitrary future assets.

The earlier authored-cap overlap audit did not cover analytical terrain triangle interiors and therefore missed the ledge defect. The new regression fills that gap. These results validate the specified geometry, seeds, camera paths and browser/GPU configuration; they do not establish universal absence of artifacts or user acceptance of the art direction. Capture metadata identifies the uncommitted source branch and tracked-diff digest instead of attributing this follow-up to the earlier merge commit.

## Historical material and surface refinement — 1 November 2026

Checked on `planet/scarlet-material-refinement` in the isolated integration checkout, served on port 5227. The earlier records below describe the previously merged delivery.

- **109 environment CPU tests passed** across 12 files, including all three fan forms, rigid moss support, new shrubs, opaque growth, floor coverage and surface overlap checks.
- **16 focused browser tests passed:** six resident interactions, native ecology, three frozen-frame determinism cases, five terrain/warp/memory/picking cases and the MSAA colour-range check. CPU/GPU terrain agreement retains its 2 cm threshold.
- Scoped TypeScript/ESLint and the standalone production build passed. The reusable motion-recording script passed ESLint and an isolated TypeScript check. `git diff --check` passes; shared `src/` has no changes.
- The 14 surface-audit cases examine ten templates, 15,979 placed near-home cap triangles and 865,766 pruned candidate pairs. No competing exposed cap sheets or nearly coincident fragment caps were detected. Across 6,534 shelter-support samples at three radii and three seeds, the minimum terrain clearance is 0.24 m. Rear curtain strips are replaced by a single folded sheet, and canopy wind is zero at the tied hems.
- A **25.843-second frozen-time camera recording** covers shelter detail, the reported floor angle, understory, grove and settlement. Every camera moved; all five immediate repeat and returned-view canvas hashes match exactly. No runtime/shader errors were captured. Full-resolution stills and motion frames sampled at 2 fps show no gross surface toggling or dotted ghost canopy in those views.
- Fresh [material review screenshots and recording](reference/README.md) are preserved beside the concept art. The metadata identifies the dirty working branch, recorded tracked-diff digest and runtime file hashes; it does not attribute these edits to the previous merge commit.

The actual screenshot review caught and corrected two problems after initial tests passed: per-vertex moss grounding stretched leaves across cliff drops, and repeated ground-chip marks looked like a stamped pattern. The final moss kit retains all six seams and 22/24 rigid shoots. Three fan growth habits and separate creeping/upright sage forms are visible. Ground, leaf, bark, cloth and rock now use different restrained material marks.

The settlement capture submits about 2.68 million triangles in 91 draws, compared with the previous delivery's 3.18 million in 85 draws. This is geometry accounting, not a measured frame-rate comparison. Remaining visual limits include the inherited shelter footprint and less dense fine foliage/linework than the drawing. These checks cover specified geometry, seeds and camera paths; they do not certify every possible camera or GPU, nor establish user acceptance of the art direction.

## Previous correction pass

- 87 environment CPU tests passed across terrain, residents, scenery, native fauna, floor topology, plant grounding, ink and garden plant lifecycle.
- Scoped TypeScript and ESLint passed (`npm run check:scarlet`). The standalone production build passed (`npm run build:scarlet`). Repository-wide `npm run check` also passed earlier in this correction pass; the final additions were checked with the scoped command.
- Five terrain browser checks passed: CPU/GPU height agreement below 2 cm at radii 40, 128 and 400 m; exact dry shore clearance; warp parity; large-bake allocation/release; and ground picking.
- Six resident browser checks passed: grounded/visible neighbours, greeting and saved renaming, seed/radius changes, desktop/mobile navigation, stopping follow, and invitation previews that preserve the invitation and restore the home seed.
- The ecology browser check passed with no captured shader errors. It verifies all three native species, the planted scenery, native garden-bed channel identities, and zero default ambient flower instances before and after Bloom. Dormant and blooming native foliage produce different frames.
- The shelter floor now has one surface per point in the support union. A regression checks union area independently and more than 1,000 triangle-coverage samples. A fresh capture of the user's steep camera shows no overlapping brown strips.
- Fresh actual-app captures are under `shots/scarlet-sail-canyon/`. Selected review checkpoints are preserved under `reference/` beside the original concept and creature sheet.
- Shared `src/` has no changes. The environment, development port, storage keys, Vite cache and production output remain separate.

## Saved review material

The [reference pack](reference/README.md) includes the original concept, expanded world sheet, creature sheet, four actual-app screenshots and two live browser recordings. The settlement tour visits the shelter, Three Sails and globe; the ecology recording shows all three native animal families and Pip. Capture metadata is saved alongside them. Both recording sessions completed without captured runtime or shader errors. Their source is the corrected renderer plus byte-identical local copies of its four find shaders, isolated before integration with the newer meadow renderer.

## Integration with main

Verified on 1 November 2026 in a separate checkout, combining main `128b3e7` with canyon delivery `4cfa0b0`:

- Repository-wide `npm run check` passed, including TypeScript and ESLint.
- All 87 canyon CPU tests passed again.
- All seven resident/ecology browser checks passed against the integrated checkout on port 5231, including native species, Bloom, greetings, persisted names, follow controls, desktop/mobile views and reversible invitation previews.
- Both `npm run build:scarlet` and the original meadow's `npm run build` passed. Vite reports the existing large-chunk warning; it is not a build failure.
- The world scaffolder generated 48 modules and five tests from the updated meadow; that temporary world's production build passed. The two removed upstream modules were dropped from its copy list. Temporary smoke folders were removed afterwards.
- `src/` is byte-for-byte unchanged from the pre-merge main tree. The existing `record:media` command is preserved alongside the new environment commands.
- Both saved MP4s decode without errors: the settlement tour is 20 seconds and native life is 26.96 seconds. The original three art sheets are byte-identical to their gallery sources; handoff/index links resolve.

The earlier 15-check terrain/determinism/resident/ecology run remains the record for the visual correction. The integration pass reran the seven interaction/ecology checks above; it did not rerun the entire inherited legacy suite.

## Rendering consistency and limits

All three frozen-frame determinism checks pass after correcting derivative use in the chalk shader: repeated loads, consecutive frozen redraws, and growth 0.3 → 0.7 → 0.3. The original integrated run failed these checks because `fwidth` was evaluated inside non-uniform fracture branches. Computing the footprint before branching fixed the root cause without changing the tests. Together with terrain, residents and ecology, 15 focused browser checks pass.

The high-quality settlement at 1600×1000 submits about 3.18 million triangles in 85 draws. Before indexing, browser snapshots reported about 48–50 ms GPU time. Indexing only the scenery batches preserved the frozen image hash exactly and improved a separate short GPU-synchronised benchmark from 45.67 to 21.74 ms/frame (30 renders after eight warmups). See `reference/render-benchmark.json`; its asynchronous HUD timer is not the synchronous benchmark metric. This is one local comparison, not a 60 fps guarantee. Distant planted cliffs and ink still need a future level-of-detail pass.

The broad inherited legacy suite was not rerun for this visual correction. An earlier broad run had four unchanged shared tests exceed their 30-second limits under concurrent load; HTTP tests passed when localhost access was available. No claim is made that the entire legacy suite or its historical frame-rate budgets is green.

Local inhabitants are not connected to account-backed friend agents. Remote world allocation and real cross-planet travel remain backend work. The UI labels route previews as previews. Decorative rock meshes do not provide general-purpose climbing or collision, and saved-find specimens remain a separate content system from native ambient plants.

## Windows vegetation and cloud follow-up — 2 November 2026

User requests: broad vegetation colonies on flatter rock-poor land, more planting in rock cracks, and more clouds surrounding the planet. Windows editor remains the Scarlet continuation chat; baseline `handoffs/windows/baseline-2026-11-02T07-54-13-451Z` preserves the incoming dirty implementation and index.

A separate deterministic groundcover generator now selects rock-poor regions and creates large lobed colonies. Raised moss uses one additional instanced batch; broken moss/coral/ivory seams follow exposed chalk feet. Protected home and resident routes remain excluded. Initial placement accepted only nearly level ground, which left visually gentle slopes too bare; support fitting was subsequently revised as recorded below. Cloud defaults change coverage from 0.20 to 0.48 and altitude from 24 to 32 m.

All 133 environment CPU tests pass for the initial implementation, including unchanged three-million-triangle scenery and grounding/corridor bounds; scoped TypeScript/ESLint passes. Fresh close/globe captures use NVIDIA RTX 4070 SUPER / ANGLE D3D11, high quality, 1280x800, DPR1 and frozen time12. Captured page/console errors: none. These are Windows hardware captures, not SwiftShader or Mac Metal comparisons. Screenshots and metadata: `handoffs/windows/scarlet-vegetation-before/` and `scarlet-vegetation-after/` at workspace level. Final evidence was refreshed after support fitting, as recorded below. The historical strict recorder's first-globe-hash failure remains unresolved; these still captures do not clear it.

### Completed Windows validation and review

The final support rule fits one continuous plane to each mat or accent shoot. Edge/interior residual probes reject steps, humps and steep slopes (gradient above 0.28 or support residual above 5.5 cm). Position and normal shear match in the surface and ink passes through the same instanced `aGroundSlope` attribute. Existing scalar shelf supports and source moss support planes retain their separate contracts. This increases vegetation coverage on gentle terrain without independently pulling leaf vertices onto different floors.

- **135 CPU tests pass:** the existing 133 across 14 files, plus two new groundcover tests for deterministic broad colonies, geology exclusion, gentle planar support and rejection of cliffs/interior humps. Existing physical contact, resident corridor and three-million-triangle scenery limits pass at all six tested radii.
- **Four Windows hardware browser checks pass:** repeat loads, frozen redraw, growth-return determinism and MSAA colour bounds. Explicit ANGLE D3D11 on the RTX 4070 SUPER, one worker; config retained at workspace `handoffs/windows/scarlet-hardware.config.ts`. These are not SwiftShader or Mac Metal results.
- Scoped TypeScript/ESLint and standalone build pass; Vite retains its existing large-chunk warning. Shared src/ and server/ remain untouched by this follow-up.
- Final [globe](reference/open-land-globe.png), [close](reference/open-land-close.png) and [capture metadata](reference/open-land-review.json): 1280x800 DPR1, high quality, frozen time12, seed412/R128. No captured runtime or console errors. Globe uses the user's pose `0.7364,-0.2005,0.4157,0.4947,0`. Browsers closed after capture, preview retained on 5227.

Visual review shows broader green colonies on exposed terraces, broken planting seams beside chalk and more cloud banks around the silhouette. Terrain and resident clearances still interrupt colonies; not every empty terrace is filled. Large colonies are raised moss, with coral/ivory accents near rock feet, not a carpet of enlarged olive leaves. This is ready for user review, not final visual acceptance. The historical strict motion recorder's first-globe-hash mismatch remains unproven and was not rerun or rebaselined.

## Moss understory and cloud families — 2 November 2026

The next user request adds plants to moss-covered areas and asks for more cloud shape/formation variation. Baseline: workspace handoffs/windows/scarlet-plants-clouds-2026-11-02T08-14-57-096Z, including incoming dirty assets and staged index. The preview remains the exact integration checkout on5227.

Plain raised ground moss is now interspersed with two combined moss/plant assemblies: coral plus olive shrubs, and ivory fronds plus olive shrubs. Plants are rooted in the actual mat mesh; their geometry shares the mat's emergence and continuous ground-plane shear. This avoids separate plants being admitted on a terrace where their moss was rejected. The plant community changes by seeded region and low moss remains visible between taller pockets. Two extra instanced batches preserve the existing three-million-triangle scenery budget (passing all six tested radii in the initial combined run).

Clouds now have five distinct eight-puff families and correlated formations along streamlines, with unequal spacing, bent groupings, varied girth and altitude. Existing texture layout, shadows and 512-cloud cap are retained. Initial combined CPU run:138pass/1fail out of139; the wisp shape was subsequently lengthened to improve its silhouette distinction, keeping the original assertion and culling bound. Final results follow. Historical first-globe-frame recording mismatch remains open.

### Final moss-understory / cloud-family checks

- **139 CPU tests across 16 files pass**, including both new moss-root/community checks, cloud-family anatomy/determinism and the 640-template animated-bound audit. Existing scene geometry, resident clearance and grounding assertions remain intact across all six tested radii.
- **Five hardware browser checks pass**: native ecology, repeat loads, frozen redraw, growth-return and MSAA colour bounds. One worker; explicit ANGLE D3D11 on NVIDIA RTX 4070 SUPER. The temporary runner config is at workspace handoffs/windows/scarlet-plants-clouds-browser.config.ts.
- Scoped TypeScript/ESLint and standalone build pass; Vite retains its existing large-chunk warning. Shared src/, server/ and other environments remain unchanged by this follow-up.
- Actual stills: [user globe](reference/moss-plants-user-globe.png), [comparison globe](reference/moss-plants-comparison-globe.png), [coral/olive moss](reference/moss-plants-coral-moss.png), [ivory/olive moss](reference/moss-plants-ivory-moss.png), [home](reference/moss-plants-home.png). Full [capture metadata](reference/moss-plants-review.json) contains camera state, source hashes, runtime counts, cloud time samples and media hashes. High quality, 1440x900/DPR1, time12; cloud-drift sample uses time18. No captured runtime or console errors.

At seed412/R128 the scene has 578 coral/olive and 664 ivory/olive plant-bearing mats (1,242 combined assemblies, each with two small plant groups), with plain low moss between them. Scenery alone submits 2,275,814 triangles at the user's overview; this geometry count is not a performance benchmark. Ninety-five cloud assemblies are present in that capture, 80 visible. Cloud shapes and arrangement change; coverage/altitude defaults remain 0.48/32m from the previous pass. The close-ups verify source attachment and show understated small plants rather than replacing all moss with tall growth. User visual acceptance is still pending.

**Separate unresolved diagnostic:** the custom time12→18→12 globe capture did not return the same canvas hash. This is a failed time-return comparison, not a green motion/determinism result. Camera/renderer/capture scheduling causes have not been established. Preserve the before/drift/returned images and hashes in the metadata. The five passing browser cases cover their named tests, not this additional time path. The older strict recorder's first-globe-frame mismatch also remains unresolved; no equality assertion, threshold or golden was weakened.

## Trees in moss colonies — 2 November 2026

User request: add some trees too. Fresh scoped baseline `handoffs/windows/scarlet-moss-trees-2026-11-02T08-34-31-556Z` preserves all prior dirty source/assets and staged state. An independently seeded, capped subset of moss sites now carries uneven groves using the three existing fan-tree habits. Their soil roots emerge through the mat, and terrain admission uses the exact parent moss footprint and orientation. The trees stay upright. Existing trees retain their original ordering/habits; no additional scenery draw batches are introduced.

At seed412/R127.975 the scene now contains **289 fan trees, up from217**:98 mature,97 twin-crown and94 young. The72 additions occupy small groves with varied heights and open moss between them. The15 scenery batches submit2,344,712 triangles, an increase of68,898; the unchanged three-million-triangle scenery limit passes at all six tested radii. Whole-scene counts also include terrain and other systems. These counts are not performance measurements.

- **140 CPU tests in16 files pass.** New selection checks cover deterministic placement, spacing, cap and source preservation. Existing six-radius tests additionally verify each new tree appears exactly when its parent moss is admitted, shares its orientation and remains upright; growth/seed snapshots now include orientation and ground slope.
- **Five focused hardware browser checks pass:** ecology, repeat loads, frozen redraw, growth return and MSAA colour bounds. Scoped TypeScript/ESLint and build pass; the existing large-chunk warning remains.
- Actual app evidence: [before](reference/moss-trees-before.png), [globe](reference/moss-trees-globe.png), [grove detail](reference/moss-trees-grove.png), [home](reference/moss-trees-home.png), [metadata and source/media hashes](reference/moss-trees-review.json). Renderer NVIDIA RTX4070SUPER / ANGLE D3D11,1280x800,DPR1,high/MSAA4,time12. No captured page or console errors. The before/after home capture hashes match; the globe visibly gains groves.

The earlier strict initial-globe mismatch and custom cloud time-return mismatch remain documented above and were not cleared by this tree pass. User visual acceptance remains pending. Work is local and uncommitted; preview5227 remains available.

## Fuller moss groves — 2 November 2026

The user requested more trees after the first grove pass. A second independently seeded selection now extends stands into two wider lobes per moss colony, adding up to 28 candidates per colony with an 880 total cap. The original selection remains an exact prefix, preserving its positions, sizes, wind phases and canopy habits. Parent-moss support, upright soil roots, 0.05-radian root spacing and the existing three tree batches are retained.

At the captured seed 412 / R127.975, moss groves now have **208 trees instead of 72**. Total fan trees increase from **289 to 425**: 144 mature, 140 twin-crown and 141 young. This adds 136 trees and spreads groves through more of the green areas while keeping clearings. Scenery submits 2,473,898 triangles in the same 15 batches, up 129,186 triangles; this is a geometry count, not a performance benchmark.

- **140 CPU tests across 16 files pass**, with the original three-million-triangle, contact and resident-clearance limits intact at all six radii. The R128 moss-tree acceptance floor now requires more than 180 trees.
- **Five focused native-D3D11 browser checks pass:** ecology, repeat loads, frozen redraw, growth return and MSAA colour bounds. Scoped TypeScript/ESLint and build pass; the existing chunk-size warning remains.
- Actual review from the user's latest angle: [before](reference/fuller-groves-before.png), [after](reference/fuller-groves-user-globe.png), [previous-angle comparison](reference/fuller-groves-comparison.png), [home](reference/fuller-groves-home.png), [metadata/source/media hashes](reference/fuller-groves-review.json). RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12; no captured page or console errors. Home hashes match across this before/after capture.

Fresh baseline: workspace `handoffs/windows/scarlet-fuller-groves-2026-11-02T08-46-25-904Z`. Prior work and staged state remain preserved. Earlier initial-globe/time-return hash diagnostics are still open; no assertion or golden was relaxed. Preview5227 retained, no publication, user visual review pending.

## Pale-yellow cloud palette — 2 November 2026

**Rejected by the user and reverted in the next pass below.** Retained as historical evidence, not the current appearance.

The pale-yellow suggestion had not been implemented when the user reported they could not see it. It is now applied to the five noon cloud cells in Scarlet's `render/palette.ts`: lit ivory `#FFF8E2`, cream shadow `#D8CCA6`, butter-yellow body `#FFF2CC`, near-white rim `#FFFDF3` and warm base `#DED1AC`. Dawn/golden-hour palettes retain their time-of-day variation. Visible clouds and both reflection paths read the same palette row; shape, motion, coverage, optical-depth shadows and all other palette rows are unchanged.

Actual [before](reference/yellow-clouds-before.png), [user view after](reference/yellow-clouds-user-view.png), [whole planet](reference/yellow-clouds-globe.png) and [metadata/source hashes](reference/yellow-clouds-review.json) were reviewed. Cream/yellow shading replaces the prior cool blue-green shading, with highlights remaining nearly white. Both captures use RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4 and frozen time12. Both have 95 cloud assemblies, with 63 drawn in the close view and 79 in the globe view; no captured page or console errors.

Scoped TypeScript/ESLint, standalone build and the focused native-D3D11 MSAA color-bound browser check pass. Existing chunk-size warning remains. The broader CPU/browser suites were not repeated for this palette-only change; their prior results above remain historical. Earlier hash diagnostics remain open. Baseline `handoffs/windows/scarlet-yellow-clouds-2026-11-02T09-05-57-774Z` preserves prior work/index; no shared source changes or publication. Preview5227 retained.

## Original cloud colors restored, denser formations — 2 November 2026

The user rejected the yellow color and requested more cloud density. The exact pre-yellow noon palette is restored (`#F5F1DC`, `#B9CED0`, `#E5E8DA`, `#FFF7DE`, `#C0D1CD`), and default coverage increases from 0.48 to 0.78. Altitude32, the five shape families, drift, shadow strength and the 512-cloud cap remain intact. This changes occupied formations through the existing weather field; coverage is not a literal sky-area percentage.

Matched seed412/R128/time12 captures show **124 cloud assemblies instead of 95**, about 31% more. In the user's overview, drawn clouds increase from 82 to107; in the close view, from71 to90. Actual [before](reference/denser-clouds-before.png), [globe after](reference/denser-clouds-globe.png), [close after](reference/denser-clouds-close.png) and [metadata/source hashes](reference/denser-clouds-review.json) record the restored cool shading and fuller surrounding bands. RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4; no captured page or console errors.

Scoped TypeScript/ESLint and build pass, retaining the existing chunk-size warning. Two focused native-D3D11 browser checks pass: frozen-frame redraw and MSAA color bounds. No broader CPU/browser rerun is claimed for these two parameter/palette edits. Earlier initial-globe/time-return hash diagnostics remain unresolved. Baseline `handoffs/windows/scarlet-denser-clouds-2026-11-02T09-12-23-828Z` preserves prior work/index. Only two source files plus documentation changed; preview5227 retained, no publication.

## Commit and current-main integration — 2 November 2026

The user authorized committing the complete Scarlet refinement and merging into local `main`. Source commit `05b773c` contains the reviewed source, reference evidence and continuation docs. It was merged without textual conflicts with fetched `origin/main` at `4259aea` (38 commits newer than the original base), producing merge commit `54830ea` in an isolated integration worktree.

Mainline changed the shared character-shadow and stove shaders. Local copies retain Scarlet's additive shadow depth and porch glow. The first integration browser run exposed a missing `meadow_muse_shadow` include in the newer shared grass shader; that run failed and was stopped. Preserving the matching original grass vertex shader locally resolved it. All four local shaders match their pre-merge source hashes; shared engine/server/lockfile content is unchanged from upstream main.

- **140 CPU tests across 16 files pass.** Scoped TypeScript/ESLint and the final standalone build pass; existing chunk-size warning remains.
- **Five focused browser checks pass on the corrected merged version:** ecology, repeat-load determinism, frozen redraw, growth return and MSAA color bounds. Native ANGLE D3D11 on RTX4070SUPER, one worker.
- Paired pre/post-mainline captures at 1280×800, DPR1, high/MSAA4, frozen time12 have **identical canvas hashes in both shelter and globe views** (`f5165d52` and `87d34632`). Both report no page/console errors. Actual [shelter](reference/mainline-close.png), [globe](reference/mainline-globe.png) and [metadata/shader hashes](reference/mainline-review.json) were reviewed.

This confirms those two merge-comparison views, not the older unresolved strict first-globe and custom time-return diagnostics. No thresholds or goldens were relaxed. Validation used temporary port5267; normal preview5227 remains the review entry point. The integration is local; no remote push or deployment was requested.
