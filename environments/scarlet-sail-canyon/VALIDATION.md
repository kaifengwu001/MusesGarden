# Validation

Checked in the isolated `planet/scarlet-standalone` checkout on 31 October 2026.

- Repository TypeScript checks and ESLint passed (`npm run check`). The standalone production build passed (`npm run build:scarlet`).
- The built site was opened through Vite preview: the scene rendered, Pip could be selected and greeted, and no browser console errors were captured.
- 59 environment CPU tests passed across parameters, growth, terrain, residents and scenery.
- 14 browser checks passed: 5 terrain/renderer checks, 6 resident/navigation checks and 3 deterministic-frame checks.
- Terrain height agreement stays below 2 cm at radii 40, 128 and 400 m; dry shore-distance agreement is exact.
- Growing and shrinking releases the larger terrain allocation; repeated cycles do not accumulate textures.
- Residents stay grounded through seed/radius changes. Greeting, following, stopping, garden navigation, saved names and narrow-screen controls were exercised.
- Invitation previews leave invitations unused and restore the home seed.
- Raised fan roots were checked against the actual chalk-shelf mesh, not just the underlying sphere.
- Shared `src/` has no changes. Browser storage, development port, Vite cache and production output are separate.

The broad inherited suite was also attempted while several planet builds were running. Four unchanged shared tests exceeded their explicit 30-second limits under that load; HTTP tests passed when localhost access was available. This is not a claim that the entire legacy suite or its historical frame-rate budgets are green on this machine.

Local inhabitants are not connected to account-backed friend agents. Remote world allocation and real cross-planet travel remain backend work; the UI identifies route previews as previews.
