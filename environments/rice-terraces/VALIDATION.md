# Ti Tian validation

New environment, 2 November 2026. Dedicated checkout `rice-terraces-worktree`, branch `environment/rice-terraces`, clean source baseline `7912632`. Recovery inventory/index/hashes: workspace `handoffs/windows/rice-terraces-2026-11-02T08-26-14-304Z`.

The user supplied two existing flat-render/reference images and confirmed that the renderer source is unavailable. The terrain recipe is reconstructed from those references directly on a sphere. This environment uses a separate orbit/growth viewer; copied meadow modules remain available as engine context, but the viewer does not claim Muse, garden-backend or walking integration.

## Mainline integration — 2 November 2026

Rice source commit `1f71849` is integrated with the newer mainline in an isolated checkout, preserving the concurrent Cherry Blossom Waterways update at `e381efd`. All existing environment commands are preserved alongside the three Rice commands. The package lock and shared engine/server code are unchanged by Rice. Copied scaffold adapters are updated to the current sculpt loader and garden interfaces; the dedicated Ti Tian runtime and its geometry are unchanged.

- Scoped TypeScript/ESLint and the standalone production build pass.
- **43 CPU checks in nine files and four focused browser checks pass** against the integrated tree. Browser coverage includes exact frame/seed/radius return, cottage placement, reload and phone controls.
- Paired source/mainline renders of the cottage, paddies, planet and overhead view have identical canvas hashes. Both used seed412/R128,1440×900,DPR1, NVIDIA RTX4070SUPER / ANGLE Direct3D11. No page or console errors were captured. [Comparison metadata and runtime hashes](reference/mainline-review.json) preserve the result. The current `fit-*` images remain representative.
- Recovery baseline: workspace `handoffs/windows/rice-terraces-2026-11-02T10-03-15-533Z`. Local paired captures and helpers are under `handoffs/windows/rice-mainline-review`. This is rendering correctness evidence, not an FPS benchmark.

## Latest: cottage meets the surrounding ground — 2 November 2026

The user rejected the oversized elevated platform and stairs, then chose a cottage/paving level that meets the surrounding terrace ground. The home now sits in a dry concave pocket; the hollow beneath it is filled by a local terrain deformation, blending into the existing terraces. A40cm stone-panel border follows the house/courtyard outline. No projecting stairs or exposed tall stone plinth remain. The building geometry and source references are unchanged.

- **43 CPU checks pass in nine files** (18 environment-specific,25 inherited). The updated tests verify dry concave placement, near-grade entrance, exact raw-ground contact on treads or vertical risers, finite/deterministic geometry, compact paving without stair projection, unchanged distant ground, plant clearance and actual rendered terrain directly beneath the paving. The paving sits4cm above the filled earth; sampled rendered contacts remain within1.5–7.5cm. This is sampled coverage, not a universal topology proof.
- **Four native-D3D11 browser checks pass**, including seed/radius/frame return, reload, cottage up alignment and phone controls. Scoped TypeScript/ESLint and production build pass. Existing terrain budgets and numeric contact tolerances were retained; the tread-only contact assertion was expanded to validate exact vertical-riser contact after a real solver oscillation was found.
- Reviewed actual [front](reference/fit-cottage.png), [rear](reference/fit-cottage-rear.png), [courtyard](reference/fit-cottage-top.png), [entrance](reference/fit-approach.png), [planet](reference/fit-planet.png) and [phone](reference/fit-mobile-cottage.png). Desktop1440x900,phone390x844,DPR1,RTX4070SUPER/ANGLE D3D11; no captured page/console errors. [Metadata](reference/fit-review.json) records source hashes, cameras and renderer. Earlier `hui-*` images retain the rejected elevated placement.

Paving footprint is145.98m², down from198.8m² before the correction, with the additional stair projection removed. The cottage remains18,920 triangles; paving/edge geometry is1,852 triangles. Scene total1,321,165 triangles/14 draws; graded terrain1,084,793 triangles. Seed412 selected raw hollow relief1.254m, wetFraction0; raw flanks rise2.718m on average and rear1.718m. Raw gate clearance0.267m is the **pre-fill** diagnostic; final ground meets the paving4cm below its surface. These counts are not a performance benchmark or art acceptance.

Recovery: workspace `handoffs/windows/rice-terraces-2026-11-02T09-36-03-275Z`. Capture helper: `handoffs/windows/rice-cottage-review.cjs rice-cottage-fit`. The previous preview listener had stopped; the exact Rice preview was restarted on5247/PID48984 and retained. Owned capture/test browsers are closed. Shared src/, server/, other worlds, package commands and lockfile are unchanged; no commit/push/deploy. Documentation and all pre-edit staged state are preserved.

## Previous: Hui cottage — 2 November 2026 (rejected elevated placement)

Added a visual courtyard residence from the user's two Hui-village illustrations: white plaster, dark tile relief, three stepped gable walls, timber openings, lower side wing, open gate, courtyard and entrance steps. Fresh baseline: workspace `handoffs/windows/rice-terraces-2026-11-02T09-12-17-650Z`. Only Rice environment files and its reference/documentation package changed; original terrain/parcel source, shared src/, server/, other worlds, package commands and lockfile were preserved.

- **42 CPU checks pass in nine files:** 17 environment-specific checks plus 25 inherited scaffold-module checks. New cottage checks cover geometry footprint/budget, real gate/door openings, disposal, seeded site selection and dry sampled support, orthonormal placement and reservation, plant clearance, and floor clearance against rays into the actual resolution96 terrain and banks. Tested site seeds1/412/771/2026 are dry and below2m relief. An initial3.5cm eave overhang was fixed in geometry without changing the bounds assertion.
- **Four focused native-D3D11 browser checks pass.** New cottage coverage checks the view, local up alignment, seed771/R220 to seed412/R128 exact frame return and phone controls. The three previous rendering, state and mobile checks remain. Scoped TypeScript/ESLint and standalone build pass; all four supplied reference images are bundled.
- Actual front, rear, courtyard, approach and globe views inspected at1440x900/DPR1, plus390x844 phone framing. Renderer: NVIDIA RTX4070SUPER / ANGLE Direct3D11; no captured page/console errors. The phone review prompted aspect-aware camera-distance scaling and a two-column view-button layout. [Capture metadata](reference/hui-review.json) records all camera positions, source hashes, dimensions and renderer identity.

Default cottage:18,920 building triangles in7 batches,1,300 tiled roof pieces,6 lattice windows and3 stepped gables; supported foundation/stairs add4,546 triangles in one batch. Total scene:1,324,027 submitted triangles /14 draws; terrain remains1,084,961 triangles. Tree/rice caps remain420/2,600. Seed412 site floor radius140.2124m; sampled relief1.579m; wetFraction0. These are geometry counts, not a timing or FPS benchmark.

Current evidence: [front](reference/hui-cottage.png), [rear](reference/hui-cottage-rear.png), [courtyard](reference/hui-cottage-top.png), [approach](reference/hui-approach.png), [planet](reference/hui-planet.png), [phone](reference/hui-mobile-cottage.png). Raw helper and captures: workspace `handoffs/windows/rice-cottage-review.cjs` and `rice-cottage-review/`. The cottage is a visual home; navigation/interior/resident/backend integration remains outside the implemented viewer. Visual acceptance remains with the user.

## Previous: continuous terraces correction — 2 November 2026

The user rejected the first delivery's large polygon divisions. Its 32 fixed spherical ownership cells aligned banks and colour boundaries across every terrace. The current implementation replaces them with curved scalar cuts staggered per level; the height field remains continuous. Baseline before this correction: workspace `handoffs/windows/rice-terraces-2026-11-02T08-56-08-083Z` (1 modified / 76 untracked, hashes and staged index preserved).

- **34 CPU tests pass in six files:** nine environment-specific tests plus 25 inherited scaffold checks. The three new regressions check parcel-coordinate continuity across all 12 cube edges, actual parcel isolines that do not coincide in adjacent levels, and deterministic geographic variation. Existing geometry coverage, physical tread, planting and disposal checks still pass.
- **Three focused browser checks pass**, including seed/radius/frame return and reload equality. Scoped TypeScript/ESLint and production build pass. The existing terrain budget remains unchanged; an overly dense first correction was reduced before final validation.
- Actual [whole planet](reference/continuity-planet.png), [paddies](reference/continuity-paddies.png), [top](reference/continuity-above.png) and [far side](reference/continuity-back.png) inspected: long polygon panel boundaries are gone, short field divisions remain within flowing terrace contours. Seed412/R128,1440x900,DPR1,RTX4070SUPER/ANGLE D3D11; no captured browser errors. [Metadata](reference/continuity-review.json) records source hashes and cameras. Helper: workspace `handoffs/windows/rice-review.cjs rice-continuity-review`.

Current terrain: 1,084,961 triangles; total submitted geometry: 1,300,561 triangles in six draws. There are 21 levels, 420 trees and 2,600 rice tufts. The 141 plot identifiers are scalar-bucket/level state IDs, **not a count of connected physical paddies**: separated patches can share a state. These are geometry counts, not a performance benchmark. No visual acceptance is inferred from tests. The earlier `app-*` captures below are retained as rejected-layout history. Shared src/, server/, other worlds, package commands and lockfile were unchanged in this correction.

## Initial implementation checkpoint (historical)

Physical contour-clipped spherical terrace treads and earth risers; narrowly raised field banks; pale flooded plots interleaved with green rice plots and wooded regions. Seeded clustered faceted tree crowns and slender trunks stay on dry forest ground; rice tufts stay in planted plots. Globe/landscape/top views, radius, seed, slow orbit and postcard controls are implemented. The local `window.__meadow` harness exposes deterministic source and frame probes for this viewer.

Native Node24.22.2 dependencies installed with the existing package lock; offline sandbox cache lacked a package, so the exact locked install used approved network execution. No lockfile updates. Scoped CPU/type/build/browser checks and actual screenshot review will be recorded below after completion. No performance or visual acceptance result claimed at this checkpoint.

## Completed local checks and visual review — 2 November 2026

- **31 CPU checks pass in five files** with one worker: six new rice-field/mesh/life checks and 25 inherited scaffold-module checks. The inherited checks exercise their original copied modules, not the new viewer. New tests cover deterministic plot/grove states; dry placement and spacing; finite instance transforms/disposal; quantized radial treads and outward normals; conservative geometry budget; and radial coverage including cube seams. Coverage rays use the test's coarse mesh and are scoped evidence, not a universal topology proof.
- **Three new browser checks pass**, one worker, native Chromium / ANGLE D3D11: visible flooded/planted/wooded geometry and view controls without captured errors; repeated frame/reload and seed/radius-return equality; and mobile layout plus seed changes at390x844.
- `npm.cmd run check:rice` passes scoped TypeScript/ESLint. `npm.cmd run build:rice` passes. The standalone output packages both reference images and uses relative asset paths. Shared src/, server/, other worlds and package-lock.json are unchanged.

The actual [globe](reference/app-planet.png), [hillside](reference/app-paddies.png), [top view](reference/app-above.png) and [capture metadata](reference/app-review.json) were inspected against the supplied images. Capture conditions: seed412, reference radius128m, viewport1440x900, DPR1, native Chromium on NVIDIA GeForce RTX4070SUPER / ANGLE Direct3D11. No captured page/console errors. A review-driven change split the first very large woodland provinces into smaller groups of three terrace levels, which spreads groves around the planet. The close camera now follows the local radial up direction; overview framing leaves the toolbar clear.

The default scene records506 plot identities,21 levels,420 trees and2600 rice tufts. Render geometry:911,903 terrain/bank triangles,1,127,503 total submitted triangles in6 draws. These are geometry counts, not a frame-rate or GPU timing benchmark. Other backends and performance budgets were not certified.

### Reproduce

```powershell
npm.cmd run dev:rice
npm.cmd run check:rice
npx.cmd vitest run environments/rice-terraces --maxWorkers=1
npm.cmd run build:rice
npx.cmd playwright test --config environments/rice-terraces/dev/review.config.ts --workers=1
```

Preview: http://localhost:5247/environments/rice-terraces/. The verified server is VitePID53176 in the exact Rice checkout, port5247; it remains available for user review. Owned capture/check browsers were closed. Raw screenshot metadata/helper: workspace handoffs/windows/rice-review/ and rice-review.cjs.

### Practical limits

This is a new reconstruction of the supplied flat rendering, because its source is unavailable. Plot divisions now use curved, staggered scalar cuts; the historical fixed-cell layout was rejected and replaced. Water is a quiet pale material, with no fluid simulation. Rice detail is sparse at planet scale. Growth uniformly scales the reference scene and camera (64–220m), rather than preserving every plant's physical size. The dedicated viewer supports orbit/pan/zoom, named views, seed/radius, slow orbit and postcard capture. It does not implement the meadow's walking, ground picking, Muse residents or backend garden/travel integration. Its __meadow harness supports readiness, state, frozen frame/hash, settle/render and scene statistics; inherited meadow browser suites are not claimed to pass. Visual acceptance remains with the user.

Final capture also includes [the far side](reference/app-back.png), with the camera position/target and runtime source hashes recorded in metadata. All four final views contain no captured browser errors. The final production build passes after the viewer metadata correction.
