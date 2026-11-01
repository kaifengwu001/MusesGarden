# Validation

Checked in the isolated `planet/scarlet-standalone` checkout on 1 November 2026. The [reference handoff](../../docs/planet-reference-handoff.md) records the visual failures, corrections and remaining work.

## Verified in the current correction pass

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
