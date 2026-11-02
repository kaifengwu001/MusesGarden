# Ti Tian · Rice Terraces

A new spherical environment based on the user's Chinese terraced-farmland references. Curved paddies step around rolling hills, alternating pale flooded plots with olive, deep-green and yellow-green planted fields. Narrow earth banks divide the plots, and small tree groves occupy wooded uplands.

The [reference pack](reference/README.md) preserves both supplied images and their provenance. The flat renderer's source is unavailable, as confirmed by the user; this environment reconstructs the pictured geometry on a sphere. The supplied render establishes the visual direction.

## Open

With Node24 or newer installed, run from the checkout in native PowerShell:

```powershell
npm.cmd run dev:rice
```

Open [Ti Tian](http://localhost:5247/environments/rice-terraces/). Port 5247 is reserved for this checkout. Verify any existing listener before reusing it.

The dedicated Three viewer provides orbit and zoom; **Whole planet**, **Across paddies**, **Muse’s cottage** and **From above** views; seed and radius controls; slower orbit; and a postcard capture. The development harness remains `window.__meadow`. Current controls and exact validated commands are recorded with the running implementation in [VALIDATION.md](VALIDATION.md).

[Open Muse’s cottage](http://localhost:5247/environments/rice-terraces/#seed=412&radius=128&view=cottage): a white-plastered Hui-inspired courtyard home with charcoal tiled roofs, stepped gables, timber lattice windows and a lower side wing. The cottage and a narrow stone-panel border now meet a filled terrace hollow at ground level, with an open gate and no projecting stairs or raised stone platform. The two additional user-supplied village paintings are preserved in the reference pack and visible in the reference panel.

## Construction and verification

Read [CONSTRUCTION.md](CONSTRUCTION.md) for terrain, field, material and placement contracts. Review the actual app at globe, oblique and close distances against the two supplied references. Test results establish their stated invariants; visual acceptance requires reviewing the generated scene.

The standalone build uses:

```powershell
npx.cmd vite build --config environments/rice-terraces/vite.config.ts
```

Output goes to `dist-environments/rice-terraces/`. Type, geometry and browser validation results belong in [VALIDATION.md](VALIDATION.md). The inherited meadow test projects have not been accepted as evidence for this new renderer.

## Scope

This environment was scaffolded from clean meadow integration commit `7912632` on branch `environment/rice-terraces`, then developed in its own folder. Shared `src/`, `server/` and other environments retain their existing behavior. The reference planet is a visual terrain environment; account travel, Muse residents and garden-backend integration are outside this iteration's implemented contract.

The incoming baseline, including hashes, clean status and copied index, is at workspace `handoffs/windows/rice-terraces-2026-11-02T08-26-14-304Z`. See [the environment rules](../README.md) for workspace isolation.

Scoped checkout shortcuts: `npm.cmd run dev:rice`, `npm.cmd run check:rice`, and `npm.cmd run build:rice`. The current local checks and actual scene captures are recorded in VALIDATION.md.
