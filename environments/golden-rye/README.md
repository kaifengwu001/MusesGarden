# Golden Rye

A separate harvest planet built from the four supplied golden-field paintings and, since 2 November, Kai's flat-field references. A flat plain of long, rounded strips of rye in five yellows, olive bunds between them and a beige farm road along and across them; each field stands as a dense, raised mass of crop with detailed ears near the camera; dark cypress groups and distant farms provide scale.

The latest user review extends rye across all terrain and former lanes, adds substantially more cypress groves, softens the gold/lavender hillside transition, and restores the default meadow's rounded cloud anatomy. See the [current followup evidence](VALIDATION.md#full-coverage-followup--2-november-2026).

Clean engine/scaffolder baseline: `791263247a656a90c8950f4ef866eac564f2ea1f`. Generated 48 environment modules and five inherited tests from shared meadow source. Branch `environment/golden-rye`, checkout `golden-rye-worktree`. Existing worlds and shared src/ remain unchanged.

Preview: http://localhost:5251/environments/golden-rye/

- `npm.cmd run dev:rye`
- `npm.cmd run check:rye`
- `npm.cmd run build:rye`
- `npx.cmd vitest run environments/golden-rye --maxWorkers=2`

Read [references and visual contract](reference/README.md), [construction](CONSTRUCTION.md), and [validation](VALIDATION.md). User visual acceptance is separate from correctness tests.

## Mainline integration — 2 November 2026

Source checkpoint `32233b8` contains the full-coverage followup. Integration preserves the reviewed environment on current main using world-local copies of its garden controls, find state, pins and matching shaders. Custom character models use main's `sculpt` loader; the default character remains unchanged. Shared engine, server, dependencies and other worlds are preserved. See [integration validation](VALIDATION.md#mainline-integration--2-november-2026).

## Flat fields and volumetric crop — 2 November 2026

Flat ground, Takemasa-style strip fields with olive bunds, farm roads that belong to the field layout, and the standing crop as a shell canopy with detailed ears near the camera. See [construction](CONSTRUCTION.md#flat-fields-and-volumetric-crop--2-november-2026), [validation](VALIDATION.md#flat-fields-and-volumetric-crop--2-november-2026) and the [references](reference/README.md#flat-fields-references--2-november-2026).
