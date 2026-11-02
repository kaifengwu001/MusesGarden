# Validation — Tulipwind Meadows

## Mainline integration — 2 November 2026

The complete environment and density/cottage revisions are committed from source 7ea2f22. Integration starts from remote main 37c8206 and incorporates the newer shared asset naming in 335104a. The original find-state table, card/postbox/pins, garden styling and Muse/grass shader contracts are retained locally in this environment to preserve the reviewed appearance against changed mainline interfaces. The model loader uses the current shared sculpt names. Shared source, server and lockfile have no Tulipwind changes. Root additions are the environment index and three scoped npm commands.

- 35 focused CPU tests pass across four files, including the six local find-table tests and the existing 29 geometry/planting/parameter/growth checks.
- Seven native D3D11 browser checks pass: frozen redraw, windmill/Bloom/time return, dense-field walking and buffer reuse, growth return, CPU/GPU terrain parity, picking and the unchanged continuous-growth budget.
- Final scoped TypeScript/ESLint and standalone production build pass after integrating the renamed model loader. The existing large-chunk build warning remains.
- Cottage, remote flower-field and globe canvases match the original preview exactly, including after the shared asset rename. Evidence: [comparison](reference/mainline-review/comparison.json) and [final smoke result](reference/mainline-review/final-smoke.json). Windows Chromium / RTX 4070 SUPER / ANGLE D3D11, 1440x960, DPR1, high/MSAA4, frozen time12; pins disabled for canvas comparisons to exclude wall-clock pop animation.
- Interaction smoke passes: six basket rows open/close, Post box and Album open/close, and a find card opens, updates Like state and closes. No runtime/console errors. Direct3D emits a warning about potentially uninitialized `f_wing_int` in the unchanged shared butterfly shader; this is recorded in the result, not counted as an error-free compiler log.

The comparison harness needed the same authored home preset rather than a zero-pitch reconstructed pose, and its closed-mail lookup needed to include hidden elements. These were harness corrections, with no rendering tolerances relaxed. Screenshots of the three scene views, album and find card were inspected. Earlier checkpoint notes below describe their original state; their “no commit/push” wording is historical. Existing startup, platform, interior/collision and Muse-pose limitations remain.

## Ground-filling tulip density — 2 November 2026

The user's remote walking view exposed the old difference between dense home planting and very sparse global flowers. The home-only rectangle is replaced by a224×224 close-detail window of globally addressed planting cells, spaced34cm apart. Cells retain their roots, colour and wind phase as the window moves; camera/growth changes update uniforms rather than rebuilding placement buffers. The same farm/path/pasture exclusions apply in the shader. Detailed foliage is12% broader horizontally. Close detail fades between18m and50m camera altitude; the globe uses the distant representation.

Distant candidates increased44,000→88,000, yielding67,270 admitted instances at seed412/R128. Those use22 triangles per tulip, compared with64 for the near flower. The near window is bounded at50,176 candidates, with unplanted plots, paths, pasture and edge cells suppressed. These are submitted candidate counts, not a claim that every candidate is visible. Captured close views submit approximately4.9 million triangles, versus approximately3.3 million in the earlier view. This is the explicit visual/performance tradeoff.

- 29 focused CPU tests pass across three files, including the22-triangle distant geometry bound, persistent detailed buffers across walking/growth, exact window restoration, existing building/plot and terrain checks.
- Five focused native-D3D11 browser checks pass: error-free frozen rendering, Bloom/wind/time return, remote walking/view return without geometry replacement, growth return, and the unchanged continuous-growth frame budget. No tolerances or budgets relaxed. Existing terrain/picking checks were unaffected and not rerun for this planting-only change.
- Scoped TypeScript, ESLint and standalone build pass; existing large-chunk warning retained.
- Matched before/after images at the exact supplied remote pose, plus home/garden/middle-distance/globe review, are in reference/density-review/. Chromium ANGLE D3D11 / RTX4070SUPER, 1440x960, DPR1, high/MSAA4, time12. No captured runtime/console/shader errors. A successful scoped frame-budget check does not certify mobile/software-GPU performance.
- Fresh complete baseline: workspace handoffs/windows/tulip-density-active.txt. Source/index preservation and final hashes: tulip-density-final-audit.json and tulip-delivery-inventory.json. Cottage layout, paths, terrain, clouds, shared engine and other worlds are preserved. No commit/push/deploy.

The close-up density is a view-dependent detail representation; it is not millions of persistent CPU plant entities. Intentional pasture parcels and farm lawns remain green. Previous building/interior/collision/Muse-pose and platform limitations still apply.

## Cottage integration and path correction — 2 November 2026

User requested an integrated row-aligned home, removal of the wide dead-end lane, sensible surrounding ground and several varied cottages. Six standalone cottages now accompany the existing eleven mills at seed412: two near home and four in different globe regions. Three distinct meshes provide blue simple gables, sage porches and rose side bays. Buildings and rectangular garden plots follow the local spherical field-row tangent. Compact lawns, planted borders, window boxes and fences replace the radial bare clearing. Foundation bottom vertices meet the terrain; walls and roofs remain rigid.

The initial garden path had three rectangular sections and a brighter soil tint. The user rejected its zigzag shape and colour mismatch during live review. It now follows a smooth cubic centreline with rounded ends into a real row-gap track; all path masks receive the same earth material in one final blend. Plant clearance follows the same curve. No independent long home lane remains.

- 28 focused CPU tests across three files pass, including row alignment, gate-to-track connectivity and plot exclusion at R40/R128/R400, six cottages in three designs, finite geometry, seed determinism and existing parameter/growth checks.
- Six focused native-GPU browser checks pass: rendering/frozen redraw, animation/Bloom/time return, growth return, CPU/GPU terrain/warp parity, picking and continuous-growth performance. The four rendering/animation/growth checks were rerun after the final path correction. Existing tolerances and performance thresholds were preserved.
- Scoped TypeScript, ESLint and standalone build pass. Existing large-chunk warning remains. One early render exposed a missing `uRadius` declaration in the foundation shader; it was fixed before the passing captures. The diagnostic is preserved in workspace handoffs/windows/tulip-cottages-first-shader-diagnostic.json.
- Actual close and globe review covers the home plot, all three cottage designs and the opposite hemisphere. Evidence: reference/cottage-review/. Native Chromium ANGLE D3D11 / RTX4070SUPER, 1440x960, DPR1, high/MSAA4, time12. No captured page/console/shader errors. No new universal performance claim.
- Baseline includes original source/assets, complete hashes, index and staged/unstaged/untracked inventory: workspace handoffs/windows/tulip-cottages-active.txt. Changes stay inside this environment; shared engine, other worlds and lockfile are unchanged. No commit/push/deploy.

Earlier evidence below is historical. Existing limits on building interiors, collision, inherited Muse poses, cold startup and untested platforms still apply; visual approval remains with the user.

Initial implementation in progress on Windows, 2 November 2026. Source 7912632, separate new checkout/branch. Baseline in workspace handoffs/windows/tulip-active-baseline.txt. Both supplied image references copied byte-for-byte into reference/. No final art approval or performance claim yet. Runtime comparisons and checks will be appended as they complete.

## Runtime corrections during validation

Two first-run inherited browser checks failed and were preserved as diagnostics. The default reference view looks toward a mill against the sky, so the old centre-ray test (which assumed the meadow's overhead default) legitimately hit sky. Its new-world copy now explicitly requests overview for the same centre-hit/sky-miss assertions. No geometric tolerance changed.

Continuous growth also regenerated roughly sixty thousand flowers, geometry and colours on every radius tick. The new version builds seed identity, source geometry, colours and instance buffers once per seed, and only updates anchor data plus building transforms during growth. Physical building clearances and the home route are rechecked as radius changes. This addresses the allocation cause; the performance test is rerun with its original limits.

## Final Windows checkpoint — 2 November 2026

- **25 focused CPU tests pass** across three files: new tulip/mill geometry, deterministic field placement, mill clearances and sphere coverage, dry bounded terrain at R40/R128/R400, plus the scaffold's generic parameter and growth tests.
- **Six focused browser checks pass** using one worker: shader/error-free load and frozen redraw, animation/Bloom/time-return, growth-return determinism, CPU/GPU terrain/water/warp parity, overhead picking, and the unchanged continuous-growth frame budget. The first growth performance attempt failed at 73 logged frames; after buffer reuse the same assertions passed. Camera-specific picking was corrected as documented above, without changing tolerances.
- Scoped TypeScript/ESLint and standalone production build pass. Vite retains the existing >1024kB chunk warning. No shared src/, server/, lockfile or existing-world changes.
- Hardware backend: Chromium ANGLE D3D11 / NVIDIA GeForce RTX4070SUPER, high quality, 1440x960, DPR1, renderScale1. These are Windows native-GPU results, not SwiftShader or Mac Metal results. They do not establish a general FPS guarantee.
- Current actual-app evidence: reference/windows-review/windmill.png, postcard.png, planet.png, review.json and windmill-motion.webm. The 4.999-second 1440x960 canvas recording starts after load, has no sound, and shows live sails, flowers and a camera move. It decodes; frames at 1 and 3.7 seconds were inspected. No captured runtime/console errors.

Review fixes included pinker foreground bands, field parcels/resting land, global mill placement, buried building plinths, and a wider hero framing that contains the sails. The scaffold's startup code initially overwrote the composed camera with maximum walking zoom; this world now preserves its authored default pose. Home and Flower fields controls use dedicated mill/tulip framing.

### Remaining limits

This is a working first visual version, ready for user review. It does not reproduce the drawings pixel-for-pixel: petals and houses remain simplified geometry, clouds use the shared volumetric-look puffs, and fine painted marks/roof tiles are less detailed. Ground-level tulips and painted far-field bands are separate levels of representation. Cold high-quality startup in captured runs took roughly 4.7–11.6 seconds; the historical meadow 2-second startup target is not certified. Mobile/software-GPU performance, the full inherited suite and legacy lake-specific tests were not claimed. The original scale test and unrelated find-memory tests were not adapted or rerun as tulip-world evidence.

The retained Muse uses inherited cottage interaction coordinates behind the new mill house. General building interiors, full custom collision and a complete adaptation of every seated/door pose remain future work. Example garden content and route previews remain example/local features, not live account-backed inhabitants or real remote travel. Existing world-specific browser storage is isolated.

Source: tulip-windmill-meadows-worktree, branch environment/tulip-windmill-meadows, uncommitted new folder based on7912632. Baseline/index recovery and source/media hashes live under workspace handoffs/windows/tulip-*. Preview5241 retained; owned capture browsers closed. No commit, push, merge or deployment performed.
