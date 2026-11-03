# Cherry Blossom Waterways — validation

## First implementation review · 2 November 2026

Native Windows checkout `cherry-blossom-waterways-worktree`, branch `environment/cherry-blossom-waterways`, base `791263247a656a90c8950f4ef866eac564f2ea1f`. Preview 5249. Pre-edit baseline: `handoffs/windows/cherry-blossom-2026-11-02T08-36-33-950Z` in the parent workspace (607 file hashes, clean staged/unstaged/untracked inventory and copied index).

The first scoped CPU run passed 32 tests and failed one geometry-budget check: a tree had 12,016 triangles against the unchanged 12,000 limit. Small twig cross-sections were simplified to fund foliage. Subsequent visual review also rejected pointed blossom stars, sparse hanging beads and central canopy holes. Rounded dabs, denser hanging sprays and supported inner sprays replace them. Test thresholds were not relaxed.

The first native GPU capture recorded no page or console errors at 1440×900, DPR 1, high quality, frozen time 12. Terrain parity over 64 samples: height error 0.00218 m, water-distance error 0.01632 m, warp error 0.000010 m. Time 12 → 18 → 12 returned the same canvas hash. These measurements precede the final canopy refinement. [Initial metadata](reference/iteration-01-review.json) and images are preserved as the first iteration, not final acceptance.

## Initial delivery checks

**Passed:** 38 CPU tests across eight files (36 in the main scoped run, then two newly added water-life tests); scoped TypeScript and ESLint; standalone production build. The build retains the inherited large-chunk warning. Seven focused native browser checks pass: repeat URL, frozen redraw, growth 0.3 → 0.7 → 0.3, CPU/GPU terrain-water-warp parity, picking, MSAA colour bounds, and the native canopy/Bloom/camera/time-return check. Original thresholds remain intact.

Commands, run sequentially with native Node 24 and npm.cmd/npx.cmd:

```powershell
npx.cmd vitest run environments/cherry-blossom-waterways --maxWorkers=2 --testTimeout=60000
npx.cmd vitest run environments/cherry-blossom-waterways/dev/cherry-waterlife.test.ts --maxWorkers=2
npm.cmd run check:cherry
npm.cmd run build:cherry
npx.cmd playwright test --config ../handoffs/windows/cherry-browser.config.ts --grep 'determinism|CPU and GPU agree|under MSAA|native cherry' --workers=1
```

Final actual review: 1440×900, DPR 1, high tier, MSAA 4, render scale 1, seed 412, R≈128, time 12/18. Renderer: NVIDIA GeForce RTX 4070 SUPER through ANGLE Direct3D11. No collected page or console errors. Final terrain parity: height 0.002172 m, water-distance 0.016312 m, warp 0.000010 m across 64 samples. The close view returns exactly to hash `8ca0e778:1440x900` after time 12 → 18 → 12. The first reverse-side review call omitted the camera API's viewport arguments; that capture-harness error was corrected and a valid reverse-side view inspected.

At seed 412 the planet has 1,040 supported trees across four variants. Tree batches submit 927,928 triangles from orbit and 1,581,900 at the pavilion view. Three rowboats and three ducks are visible and have independently tested wet footprints. These are scene counts, not a frame-rate benchmark. Native D3D11 results are not a SwiftShader or Mac Metal comparison; no performance threshold or golden image was changed.

Actual evidence: [arrival globe](reference/app-arrival-globe.png), [reverse side](reference/app-far-side.png), [pavilion water garden](reference/app-repeat-home.png), [weeping canopy](reference/app-weeping-canopy.png), [motion state at time 18](reference/app-petal-drift.png), [returned frame](reference/app-time-return.png), and [metadata with runtime source/image hashes](reference/app-review.json).

Scope verification: only the new environment directory and its three commands in package.json differ from the clean baseline. Shared src/, server/, other environments and package-lock.json remain unchanged. No commit, push, merge or deployment was performed. Capture browsers are closed; preview 5249 remains available for review.

## Willow, connected joints, water petals and remote ducks · 2 November 2026

Fresh pre-edit inventories, copied indexes, dirty files and hashes are preserved at parent-workspace `handoffs/windows/cherry-willow-2026-11-02T09-16-57-352Z` and intermediate `cherry-branches-water-2026-11-02T09-26-26-178Z`. Branch and base HEAD remain unchanged. This follows the user's clarification that the gaps were disconnected branch joints, not sparse canopy.

**Passed:** 43 CPU tests across nine files; scoped TypeScript/ESLint; standalone production build; seven focused native D3D11 browser checks using the commands above. The build retains its existing chunk-size warning. CPU checks cover actual branch-triangle contact for all four variants at both detail levels, fixed willow attachments and weighted tip flex, and complete moving duck/wake footprints across seeds 412/771/2026 and radii 40/128/400. Existing geometry and correctness thresholds remain unchanged.

Actual review used NVIDIA GeForce RTX 4070 SUPER / ANGLE Direct3D11, 1440×900, DPR 1, high quality, MSAA 4, render scale 1, seed 412, radius 127.975 m. Nine views include both user-saved camera poses, the matched willow view, motion and returned frames, remote duck flocks on opposite hemispheres, the home water garden and the globe. No collected runtime or shader errors. Time 12 → 18 → 12 reproduces the same willow canvas hash. Current population: 1,040 trees, 45 remote ducks in 17 flocks, plus the original three home ducks and three rowboats. These are correctness/art checks, not performance benchmarks.

Visual evidence: [willow before](reference/willow-before-willow.png), [willow after](reference/refinement-willow.png), [water petals and branch joints](reference/refinement-user-water-joints.png), [first canal flock](reference/refinement-canal-ducks-0.png), [opposite-side flock](reference/refinement-canal-ducks-1.png), [home water](reference/refinement-home-water.png), [globe](reference/refinement-globe.png), and [current source hashes and capture metadata](reference/refinement-review.json). The willow now has rounded rising boughs with fuller curved leaves; water petals read at near-view scale; the distant flock views confirm the new life is rendered outside the home pond. User art acceptance remains pending.

A separate read-only numerical wind audit found no reopened branch-parent joints in 960 samples. It also found up to 2.07 mm of leaf-base interpolation separation at maximum wind; this is below the reported branch-joint scope and remains a fine-geometry limitation. This diagnostic was run in memory and is not included in the 43-test count.

Only Cherry geometry, wind, water, water-life code, related tests, docs and evidence changed during this refinement. Shared source, server, other environments, package commands, lockfile and staged patch are preserved. Preview 5249 remains running; owned capture/test browsers are closed. No commit, merge, push or deployment.

## Mainline integration · 2 November 2026

Integration started from mainline `335104a` and incorporated the subsequent remote `9891c4a` updates before committing Cherry. The latter updates affect other environments and their records, with no shared runtime, package or lockfile changes. The reviewed Cherry source checkout remains a recoverable preview checkpoint; the fresh full inventory is `handoffs/windows/cherry-commit-push-baseline.txt` in the parent workspace.

Before publication, remote main advanced to `708e21c` with Tulipwind. That update was merged normally; the two registration conflicts retain both worlds' package commands and index entries. Cherry runtime files and all shared runtime files were unchanged by that merge, so the preceding runtime validation still applies.

Mainline removed or changed shared UI/state and find-planting APIs, and changed its shadow conventions. The corresponding original modules and stylesheet now live inside Cherry's own folder, with imports redirected locally. The current shared sculpt loader replaces the old loader name; its model binary payloads are unchanged. `src/`, `server/`, other environments and the dependency lockfile remain untouched by Cherry's addition. The environment index and three package commands register the new world.

Passed on the integrated checkout: **49 CPU tests in ten files, seven focused native D3D11 browser checks, scoped TypeScript/ESLint and production build**. Six retained planting-table tests account for the increase from 43. The existing chunk warning and all thresholds remain unchanged. Paired source/mainline captures at 1440×900, DPR 1, high tier, MSAA 4, frozen time 12 on RTX 4070 SUPER / ANGLE D3D11 match exactly in all four sampled canvas frames. Pins were disabled for frame comparison to remove their wall-clock animation; a separate toggle check passes. The Baskets dialog opens. No collected page or shader errors.

The first comparison harness used an ambiguous dialog locator after its four exact frame comparisons; it was narrowed to the named Baskets dialog and the complete review reran successfully. This was a harness issue, not a scene failure. Current evidence includes [integrated willow](reference/mainline-5277-willow.png), [water view](reference/mainline-5277-user-water-joints.png), [globe](reference/mainline-5277-globe.png), [remote ducks](reference/mainline-5277-canal-ducks-1.png), and [paired hashes, renderer and current source hashes](reference/mainline-review.json).

## Bigger groves, blossom clouds and the meadow's lakes · 3 November 2026

Mac checkout `cherry-fix` from `4fe29c7`, preview on port 5289. **Passed:** 48 CPU tests in ten files, scoped TypeScript/ESLint (`npm run check:cherry`) and the production build (`npm run build:cherry`, with the existing chunk-size warning). The canal tests are replaced by a comparison with the meadow's own fields. Two grove checks changed with the slope rule: the trunk centre may sit up to `ROOT_SPREAD` + 0.07 m below the ground at its centre (was 0.1 m), and an uphill toe up to `ROOT_SPREAD` + 0.07 + 0.13 × scale m into it (was 0.45 m); the floating-toe limit (0.06 m) is unchanged. Geometry budgets are unchanged and met.

Actual app captures at 1280×800, DPR 1, high tier, frozen time 12, seed 412, R 128 on ANGLE Metal (Apple M1 Pro): homestead, a view over the home pond, the globe, Vista and Muse, with no page or console errors. 1,360 trees. No browser suite was run: this checkout has no Playwright project for Cherry, and no frame-rate benchmark was taken.

## Known scope and limits

- This is a reference-inspired 3D interpretation, with visible polygonal geometry at close range; the images remain the art direction and user visual acceptance is pending.
- Water mirrors sky, clouds and banks. It does not render a full reflected copy of cherry trees or the new pavilion. The old cottage reflection was removed to avoid a phantom building.
- Pavilion roof and canopy shadows are approximations; they are attached to planet-space anchors. The open pavilion keeps the inherited support/navigation dimensions.
- Decorative boats and ducks have deterministic ambient motion; they are not interactive residents.
- Full growth-performance and cross-platform renderer benchmarking are separate from the scoped correctness and visual checks.
- The Vista preset does not avoid tree crowns, and birds fly at hilltop height, through the tallest canopies.
