# Ukiyo-e Hamlet validation

Updated 1 November 2026. This is an isolated functional implementation, with an
explicit remaining gap between stylised 3D and the reference’s fine woodblock
detail. No user visual acceptance is claimed.

## Evidence and reproducibility

- Checkout: `ukiyoe-pine-hamlet-standalone-01a19573`, branch `planet/ukiyoe-pine-hamlet`.
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
