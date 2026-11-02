# Cherry Blossom Waterways

A world of its own, scaffolded by `npm run new-environment` from the meadow at
commit 7912632. See [environments/README.md](../README.md) for how worlds are
organised.

- Open: `npm.cmd run dev:cherry`, then http://localhost:5249/environments/cherry-blossom-waterways/
- Check: `npm.cmd run check:cherry`
- CPU tests: `npx.cmd vitest run environments/cherry-blossom-waterways --maxWorkers=2`
- Build: `npm.cmd run build:cherry` (to `dist-environments/cherry-blossom-waterways/`)

The planet combines spreading and weeping cherry trees, willow accents, winding blue waterways and a small open tiled pavilion. Scroll between the globe and the garden; drag to orbit, use Wander for a near view, and use the home button to visit the pavilion. Bloom changes the flowering front; wind, clouds and falling petals follow the world clock.

Design, implementation decisions and ongoing notes are in [CONSTRUCTION.md](CONSTRUCTION.md). See [reference/README.md](reference/README.md) for all nine supplied images, and [VALIDATION.md](VALIDATION.md) for actual-app evidence and limitations.

This is a local standalone environment. Its boats and ducks are ambient scene content. The inherited Muse and saved-find UI remain part of the host application; this work does not add account-backed inhabitants or cross-planet travel services.
