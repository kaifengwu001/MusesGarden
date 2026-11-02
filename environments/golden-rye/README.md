# Golden Rye

A separate harvest planet built from the four supplied golden-field paintings. Golden rye with recognizable ears/awns and broad wind waves wraps rolling fields; dark cypress groups, distant farms and blue-violet hills provide scale and contrast.

The latest user review extends rye across all terrain and former lanes, adds substantially more cypress groves, softens the gold/lavender hillside transition, and restores the default meadow's rounded cloud anatomy. See the [current followup evidence](VALIDATION.md#full-coverage-followup--2-november-2026).

Clean engine/scaffolder baseline: `791263247a656a90c8950f4ef866eac564f2ea1f`. Generated 48 environment modules and five inherited tests from shared meadow source. Branch `environment/golden-rye`, checkout `golden-rye-worktree`. Existing worlds and shared src/ remain unchanged.

Preview: http://localhost:5251/environments/golden-rye/

- `npm.cmd run dev:rye`
- `npm.cmd run check:rye`
- `npm.cmd run build:rye`
- `npx.cmd vitest run environments/golden-rye --maxWorkers=2`

Read [references and visual contract](reference/README.md), [construction](CONSTRUCTION.md), and [validation](VALIDATION.md). User visual acceptance is separate from correctness tests.
