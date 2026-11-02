# Scarlet Sail Canyon reference pack

Start with the **concept art**, then compare it with the **actual app captures**. The captures document the implemented planet; they are not additional concept paintings.

Current Windows appearance: [moss plants and cloud families](moss-plants-user-globe.png); [validation](../VALIDATION.md) records exact scope and the unresolved time-return hash comparison.

## Art direction

- [Primary concept](primary-concept.png): the original rendering used for the canyon composition, material relationships and rock-backed shelter.
- [Expanded world setting](world-setting.png): supplementary world and habitat ideas.
- [Creature sheet](creatures.png): Chalkstep, Fern Sifter and Dewwing anatomy and ecology.

## Latest vegetation and rock distribution review

Captured from the uncommitted `planet/scarlet-material-refinement` working tree on 1 November 2026. These supersede the previous moss/terrace views for placement and cliff forms.

- [Before at the close camera](distribution-before.png): repeated shelf and ground planting layouts.
- [Current settlement](distribution-settlement.png): uneven colonies, small outliers and quieter gaps.
- [Current globe](distribution-globe.png): unequal outcrop groups and open basins.
- [Close/globe camera recording](distribution-motion.mp4): 21.071 seconds, with time fixed.
- [Capture metadata](distribution-review.json): source identity, runtime/media hashes, camera comparisons and the frame-lock limitation below.

The close view repeats exactly. The globe's first framebuffer hash differs, while the subsequent repeat and returned hashes agree; the saved before/returned planet pixels also agree. The strict recording command therefore exits 1. Keep this limitation visible; these are visual review evidence, not a claim that every recorded frame is bit-identical. The functional and build results are recorded in [validation](../VALIDATION.md).

## Previous moss and terrace review

Captured on 1 November 2026 from the dirty `planet/scarlet-material-refinement` working tree after the flat-moss and triangular-ledge report. These superseded the material-pass captures below; the distribution pass above is now current.

- [Before at the reported angle](moss-terrace-before.png): flat olive paint and terrain teeth.
- [After at the same angle](moss-terrace-after.png): corrected terrace geometry and lighting, with raised moss mats.
- [Moss profile](moss-profile.png): a close grazing view of physical thickness and short fibers. The forms remain stylized.
- [Six-view camera recording](moss-terrace-motion.mp4): 29.626 seconds at fixed time, including the reported terrace and rear cliff.
- [Review metadata](moss-terrace-review.json): six matching repeat/returned hashes, camera states, no captured errors, working-tree identity and file hashes.

The recorded paths and sampled motion frames show no repeated comb teeth; this is evidence for those views rather than every possible seed or camera. The latest [validation record](../VALIDATION.md) separates functional checks from visual judgment.

## Previous material review

Captured from the working `planet/scarlet-material-refinement` branch on 1 November 2026, after the follow-up review of surfaces, shelter, ground, plants and rock. These are historical evidence from before the moss/terrace follow-up above; they retain the defects identified in that later review.

- [Settlement postcard](material-settlement.png): three fan growth habits, mineral paths and ledge foliage.
- [Shelter detail](material-shelter.png): sagging canopy, supplies, curtain and fractured foundation edge.
- [Floor contact](material-floor.png): the previously reported steep camera angle.
- [Understory](material-understory.png): creeping leaves, upright shrubs, coral, ivory and Fern Sifter.
- [Whole planet](material-planet.png): opaque global scenery without dotted ghost meshes.
- [Frozen camera-motion recording](material-motion.mp4): 25.843 seconds through five views, with world time fixed to isolate camera-dependent artifacts.
- [Review metadata](material-review.json): view/hash checks, source branch/dirty status, runtime file hashes and screenshot hashes.

To repeat the camera review, run `npx tsx scripts/record-scarlet-review.ts` against the running canyon server. Outputs first go to ignored `shots/scarlet-sail-canyon/material-refinement/motion/`; review them before copying selected evidence here. The script moves the camera directly so a slow pointer gesture cannot accidentally trigger Bloom and alter residents during a frozen-frame comparison.

## Previous app screenshots

Retained as the before state for the follow-up material review:

- [Settlement](checkpoint-settlement.png)
- [Shelter floor](checkpoint-floor.png)
- [Understory](checkpoint-understory.png)
- [Whole planet](checkpoint-planet.png)

## Previous live screen recordings

These are real browser captures at 1280×800 and high quality, with live time. They have no narration or sound. Loading frames are trimmed; the app's camera transitions and motion remain in the recording.

- [Settlement tour](settlement-tour.mp4): Shelter → Three Sails → Whole planet.
- [Native life](native-life.mp4): Chalkstep → Fern Sifter → Dewwing → local neighbour Pip.
- [Capture metadata](recordings.json): source revision, viewport, capture date, durations and chapter times.

To regenerate, start the canyon server, install `ffmpeg` on the host if needed, then run from the repository root:

```sh
npx tsx scripts/record-scarlet.ts
```

Set `SCARLET_URL=http://localhost:<port>` to capture another checkout. Raw WebM files go to ignored `test-results/scarlet-recordings/`; selected MP4s and the globe screenshot are saved here. The script fails on runtime or shader errors. Review the videos visually before committing them.

## Documentation to hand off

1. [Experience handoff](../../../docs/planet-reference-handoff.md): failures, root causes, fixes, reference comparison workflow and remaining limits.
2. [Environment pipeline](../../../docs/environment-pipeline.md): generation and rendering from start to finish; its original new-world section predates the environment folders.
3. [Environment rules](../../README.md): isolation, scaffolding, tests and builds.
4. [Open and run this planet](../README.md): controls, commands and local/backend boundaries.
5. [Construction notes](../CONSTRUCTION.md): file map, terrain, support, ecology and navigation contracts.
6. [Validation](../VALIDATION.md): verified results and the limits of those checks.
7. [Rendering measurements](render-benchmark.json): before/after scenery indexing data, not a frame-rate guarantee.

The saved concepts are design targets, not proof that every detail has been implemented. In particular, local neighbours are not account-backed friends, and decorative cliffs are not a complete climbing/collision system.

## Windows open-land vegetation and cloud review — 2 November 2026

Current follow-up requested by the user after migration: large patches of vegetation on rock-poor land, extra rock-foot/crack planting, and more clouds surrounding the planet. See [globe](open-land-globe.png), [close](open-land-close.png), [Windows capture metadata](open-land-review.json) and [validation](../VALIDATION.md). These supersede distribution-* for the current Windows appearance. Captures use RTX 4070 SUPER / ANGLE D3D11; they are not directly comparable framebuffer baselines for historical Metal/SwiftShader. Primary-concept.png remains the art direction; final user acceptance is pending.

## Moss plants and varied cloud families — 2 November 2026

These supersede open-land-* for the current Windows appearance; older captures remain the before state.

- [User globe](moss-plants-user-globe.png) and [prior-angle comparison](moss-plants-comparison-globe.png).
- [Coral/olive mat](moss-plants-coral-moss.png), [ivory/olive mat](moss-plants-ivory-moss.png), [settlement](moss-plants-home.png).
- [Cloud drift at time18](moss-plants-cloud-drift.png), [return to time12](moss-plants-cloud-return.png), [metadata](moss-plants-review.json).

RTX4070SUPER / ANGLE D3D11, high,1440x900,DPR1. These are actual-app evidence, not concept art. The custom time12→18→12 hash comparison FAILED even though five focused browser checks passed; its cause is unproven and it must not be described as frame-locked motion. See VALIDATION.md. Visual acceptance remains pending.

## Moss groves — 2 November 2026

Current tree addition: [before globe](moss-trees-before.png), [after globe](moss-trees-globe.png), [grove detail](moss-trees-grove.png), [home](moss-trees-home.png) and [capture/source metadata](moss-trees-review.json). These supersede moss-plants-* for current tree distribution; earlier cloud diagnostic evidence remains retained. At the reviewed seed/size,72 additional fan trees form uneven groves in moss-covered open land. Hardware captures use RTX4070SUPER/ANGLE D3D11,1280x800,DPR1,high/MSAA4,time12. See [validation](../VALIDATION.md) for140 CPU/five browser checks and existing unresolved diagnostics.

## Fuller groves — 2 November 2026

The user requested a larger tree population. Current evidence superseding moss-trees-* for distribution: [before](fuller-groves-before.png), [user view after](fuller-groves-user-globe.png), [comparison angle](fuller-groves-comparison.png), [home](fuller-groves-home.png), [metadata](fuller-groves-review.json). At seed 412 / R128, moss trees increase from 72 to 208; total fan trees rise from 289 to 425. Existing groves remain in place. Captures use RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12, with no collected errors. The [validation record](../VALIDATION.md) contains passing checks and retained limitations.

## Pale-yellow clouds — 2 November 2026

**User-rejected color experiment; reverted.** These images are historical, not the current cloud palette.

Historical cloud-color evidence: [before](yellow-clouds-before.png), [user view after](yellow-clouds-user-view.png), [whole planet](yellow-clouds-globe.png), [metadata](yellow-clouds-review.json). Five noon cloud palette cells gave butter-yellow bodies, cream shading and near-white highlights during this rejected experiment; tree/terrain distribution was unchanged. Actual captures used RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12, without collected errors. See [validation](../VALIDATION.md) for the scoped check/build and color-bound browser result.

## Restored colors and denser clouds — 2 November 2026

Current appearance: [before](denser-clouds-before.png), [globe after](denser-clouds-globe.png), [close after](denser-clouds-close.png), [metadata](denser-clouds-review.json). Original noon cloud colors restored; coverage default raised from0.48 to0.78. At the matched seed/size/time, cloud assemblies increase from95 to124. These supersede yellow-clouds-*; the yellow version was explicitly rejected. Renderer RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12. See [validation](../VALIDATION.md) for scoped check/build, two focused browser checks and existing diagnostic limits.

## Current-main merge verification — 2 November 2026

[Shelter](mainline-close.png), [globe](mainline-globe.png) and [merge-comparison metadata](mainline-review.json) verify integration with upstream main4259aea. Both frozen canvas hashes match the pre-merge source exactly; all four retained local shader files match their original source hashes. RTX4070SUPER / ANGLE D3D11, 1280×800, DPR1, high/MSAA4, time12, no captured errors. [Validation](../VALIDATION.md) records 140 CPU and five focused browser passes, scoped check/build and the initial shader-include failure that was corrected.
