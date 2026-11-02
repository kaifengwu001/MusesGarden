# Ukiyo-e Hamlet validation

Updated 1 November 2026. This is an isolated functional implementation, with an
explicit remaining gap between stylised 3D and the reference’s fine woodblock
detail. No user visual acceptance is claimed.

## Evidence and reproducibility

- Current checkout: `ukiyoe-pr-integration-01a19573`, branch `environment_ukiyo`.
- URL: `http://localhost:5237/environments/ukiyoe-pine-hamlet/`.
- Capture state: `#q=high&hud=0&t=12`; named Home, Bridge, Muse and Whole planet views.
- Review [reference and actual app side by side](reference/comparison.html).
- Historical failed first-pass captures are retained in `reference/first-pass/`.
- Read the actively maintained Scarlet handoff before further implementation;
  `reference/pipeline-lessons.md` is a snapshot, not its live active record.

## Iteration record

| Symptom observed in the app | Cause and correction |
| --- | --- |
| Pines resembled bare branches with floating white plates | Sparse needle geometry. Added overlapping crown volumes, fine needles, supporting snow and distinct cheaper distant templates. A second pass reduced oversized sharp blades and added a rear thicket. |
| Timber was pale and roof snow made two perfect stripes, then an eye-shaped opening | Linear pigment values were too high; roof geometry was overly regular. Darker directional grain and one connected snow accumulation with an irregular lower edge now expose the lower tile courses. |
| Flat empty horizon, then oversized blank peaks | Added real CPU/GPU rear relief, then reduced and moved the peaks after comparing actual screenshots. Terrain bounds and home-specific draw reach include them. |
| Raised blue water and alternating white teeth at banks | The inherited mesh clamped underwater vertices to zero, then painted analytic water onto mixed bank triangles. Land now keeps signed bed heights; separate sphere water meets it through the depth buffer. Both use the same warp and morph. Finer grid helps remaining small facets. |
| Muse and neighbours overlapped; large orbit head pin | Reserved courtyard lanes and tested host separation. Local pin reduced to18px. Observation views use deliberate character framing. |
| Whole planet retained close-view tilt | Shared camera settle does not snap pitch. Local navigation resets both current and target pitch immediately; shared camera code is unchanged. |
| Inherited centre-pick test failed after the lower Home view | The centre correctly became sky. The test now checks Home foreground ground, then centre/sky in Whole planet. |
| Mobile neighbour frame filled with a golden surface despite visible controls | Actual screenshot exposed an observation-camera collision missed by button-only assertions. Follow now selects an open courtyard direction and scales its distance/aim for portrait screens. Head/feet projection, body size, camera distance and courtyard clearance assertions pass. The corrected mobile capture was inspected. |
| Winter retained meadow controls and decorative companions | Removed inactive Bloom controls, replaced presets, suppressed winter butterflies and decorative find-bed companions. Saved collectible specimens remain intact. Remaining garden keys are namespaced. |

## Checks

Final runtime verification after the mobile camera and separate-water corrections:

| Check | Result |
| --- | --- |
| `npm run check:ukiyoe` | PASS — scoped TypeScript and ESLint |
| Environment CPU suite | PASS — 64 tests in 6 files; house/bridge/snow geometry, scenery budgets/grounding, residents/routes, growth and parameters |
| Ecology browser check | PASS — actual Home, Bridge, Muse, Whole planet and Rain captures, two residents, scenery budget, no shader errors |
| Resident browser suite | PASS — 7 cases covering settlement, greet/name persistence, growth/seed grounding, desktop/mobile views, follow interruption, honest travel preview/return and season persistence |
| Frozen-frame determinism | PASS — repeat load, repeated draw, growth roundtrip, unchanged exact hashes |
| CPU/GPU terrain/warp and picking | PASS — inherited 2cm height, 12cm shore and 5mm warp limits retained; Home foreground and orbit picking verified |
| Draw-call budget | PASS — Overview and Wander remain within the inherited 120-draw ceiling |
| `npm run build:ukiyoe` | PASS — output in `dist-environments/ukiyoe-pine-hamlet`; advisory for a chunk above 1 MiB remains |
| Isolation | PASS — `git diff --name-only -- src` empty; `git diff --check` clean; branch `planet/ukiyoe-pine-hamlet` |

The final combined browser run passed 13 of 14 checks; its mobile case stopped on
a test probe typo (`__garden.project` instead of `__garden.ui.project`). Fixing
only that test path and rerunning the case passed its new framing assertions.
All 14 selected browser checks therefore pass. The full inherited invariant
suite, including strict frame-time and 400-find stress cases, was not run.
No universal 60 fps claim is made. The final ecology capture was refreshed after
the mobile test so comparison images use the same clean capture workflow.

## Remaining limits

### Pine silhouette correction, evening of 1 November 2026

The user rejected the previous angular pine pads and scattered needle pattern.
Their four new references (06–09) now define the pine target: overlapping rounded
cloud/fan lobes with coherent radial lines. The rejected app views are retained
in `reference/rejected-angular-pines/`; passing earlier tests was not visual
acceptance.

Pine crowns were rebuilt as closed rounded lobes with smooth normals. Local
branch groups overlap seven unequal lobes; distant groups retain three lobes
and fewer tiers. One fan drawing belongs to each lobe, with quiet side/top
pigment rather than crossed projection patterns. Twig forks meet their bases;
snow follows the same domes with contacting lips. The whole-tree, side, overhead
and close-canopy captures were inspected in snow and rain.

Scoped TypeScript/lint, all **69 CPU tests**, ecology capture and production build
pass. The instantiated colour geometry remains below 1.5M triangles at radii
40, 128 and 400; no budget assertion was increased. Shared `src/` and other
worlds remain unchanged. The existing large-chunk advisory remains.

Repeated-load, repeated-draw and growth-roundtrip determinism pass, as do the
draw-call budget and desktop/mobile view check. The first repeated-load attempt
timed out during navigation while the local disk filled; after clearing only
generated sweep-frame PNGs, the unchanged test passes in 8 seconds. Per-view
reference images and compact motion metrics were retained. Historical growth
performance limits below were not changed by this art correction.

The expanded flicker suite passes **4/4 tests**, covering reported pose, Home,
Bridge and the close pine in both seasons at DPR 1/2. All **192 frozen comparisons
have zero changed pixels**. The maximum isolated-frame signal is 0.36875%,
below its 1.5% bound. Current evidence is in
[pine-frame-stability.json](reference/pine-frame-stability.json); the earlier
material-pass metrics remain separate. Motion thresholds are finite checks,
not a guarantee for every camera or GPU. This is a stylised 3D interpretation;
no user acceptance of the revised art is implied.

### Surface and material refinement on 1 November 2026

The current server on port 5237 runs the PR integration checkout. All runtime
changes remain in this environment; the root Playwright config adds only its
dedicated flicker project. Shared `src/` and other worlds remain untouched.

- Shoji crossings and side plates now have single exposed face ownership;
  side shoji are inset in actual wall openings. Bridge rails use joined swept
  surfaces. Roof snow has one ridge cover without duplicate seam skirts.
  All four new surface regressions fail against the previous geometry and pass
  after the correction. Land/water have exclusive near/away node ownership and
  meet through the depth buffer with matching grid/morph/warp contracts.
- Snow has warm paper whites, blue shallow relief and sparse close pigment
  grain shared across ground, roof and plants. Projected footprints fade detail
  before it becomes unresolved; ground uses actual derivatives at grazing angles.
- Pines have irregular needle fans and projecting whorls; cedars have paired
  sprays; bark follows branch arcs with broken fissures; plum and reeds have
  separate botanical marks. Foliage projection avoids crown-top stretching.
  Coincident bark and snow ink overlays were removed.
- Scoped TypeScript/lint, all **69 CPU tests** and the production build pass.
  Scenery remains below 1.5M submitted colour triangles at radii 40/128/400.
  Existing large-chunk build advisory remains.
- The **4 flicker tests pass**: reported pose, Home and Bridge in snow/rain,
  at DPR 1/2. **144 frozen comparisons have zero changed pixels**, including
  repeats during 108 small-angle sweep frames. The largest isolated-frame
  signal is 0.3875% (threshold 1.5%); this includes normal moving edges, not a
  measured z-fighting count. Exact setup, source hashes and limits are in
  [frame-stability.json](reference/frame-stability.json).
- Ecology/material capture, all 7 resident checks, repeat-load/repeated-draw
  determinism, draw-call budget and CPU/GPU terrain/picking checks pass. One combined run failed
  the growth roundtrip image hash; it did not reproduce in 10 A/C diagnostic
  runs or 5 repetitions of the unchanged test. Keep this as an intermittent
  unexplained result, not a claimed fix or a relaxed assertion.
- The extra inherited live-growth stress check misses its 20ms p95 target.
  An untouched checkout at `36d10ac` also measures 50ms p95 and fails that same
  target. Sequential comparison measured JS p95 37.9ms before and 37.1ms after;
  the latest growth roundtrip and draw-call tests pass. The preserved
  [growth comparison](reference/growth-comparison.json) contains these results
  and the intermittent hash record. This is an existing limit, not evidence of
  universal 60fps performance.

Current actual captures include close pine/cedar/snow and the reported pose in
the [comparison gallery](reference/comparison.html); Home/Rain before this pass
are preserved in `reference/pre-material-refinement/`. Finite camera samples
and exact redraws cannot prove absence of every possible overlapping surface.

### PR integration on 1 November 2026

The PR source branch is `environment_ukiyo`, integrated in
`ukiyoe-pr-integration-01a19573` on main commit `ad37acf`, targeting `main`.
The original standalone checkout remains separate and can keep serving port 5237;
the integration browser checks used port 5239.

Eight matching baseline shaders were copied locally to preserve the find/bed,
grass and Muse-shadow rendering interfaces after main’s changes. The root Vite
cache configuration is unchanged. Outside this environment, the PR only adds
npm scripts and ignore rules; shared source and other worlds have no changes.

On the integrated branch, scoped TypeScript/lint, all 64 CPU tests, all 14 targeted
browser tests in one run, and the environment production build pass. Fresh
captures are in the integration checkout’s `shots/ukiyoe-pine-hamlet/`.

The original meadow was also built before and after integration. Every runtime
file (HTML, JavaScript, CSS, images and models) is byte-identical. Only a
non-runtime JavaScript source map differs. `check-frames` self-comparison of the
unchanged baseline reports 8 of 9 views identical at both DPR 1 and DPR 2. The
bird’s-eye 70 m view has a small existing variation (185 pixels at DPR 1, 638 at DPR 2),
so an unconditional nine-view pixel-identity claim would be invalid. This is
recorded rather than changing the protected first planet or relaxing a test.
Raw comparison output and the runtime-file hash audit are preserved in
`reference/pr-integration-checks.txt`.

### Product and visual limits

- The plant silhouettes, rock variation, paper texture and line work remain
  simpler than the drawn reference. Global forests use seeded groups rather than
  a fully authored island composition.
- Small shoreline facets remain at close angles, although water is now level.
- Neighbours are local saved identities with ambient routines, not connected
  friend accounts. Travel invitations preview this environment with another
  seed; they do not claim to load a different planet implementation.
- Decorative rocks are not navigable surfaces. House, steps and bridge have
  explicit support geometry; open-ground movement uses analytical terrain.
- Camera-based scenery LOD and a complete ecosystem are outside this build.
- Production bundle includes the existing Muse model variants and reports a
  chunk above 1 MiB; no claim of a universal 60 fps budget is made.
