# Scarlet Sail Canyon

A standalone, playable world for Muse and three local neighbours: Pip, Juniper and Marlo. Deep, stepped chalk shelves and gravel corridors carry dense scarlet fan groves, comb-ferns and a shelter on a middle terrace. Eleven native animals live alongside the Muse neighbours: three Chalksteps, three Fern Sifters and five Dewwings. The planet stays dry as it grows from a 40 m to 400 m radius.

This environment starts from `muse-agent` commit `fb21a13`. All world-specific rendering and behaviour live here; the shared meadow and other environments keep their own entry points. See [construction notes](CONSTRUCTION.md) and the [environment rules](../README.md).

For another planet or a context reset, read [Building planets that match their concept art](../../docs/planet-reference-handoff.md). It records failed attempts, their causes, the corrective workflow and active issues. The [reference pack](reference/README.md) indexes the original concept, expanded world and creature sheets, actual screenshots, screen recordings and important documentation.

## Open

From the repository root:

```sh
npm run dev:scarlet
```

Open <http://localhost:5227/environments/scarlet-sail-canyon/>. The dedicated port keeps this checkout separate from another world's development server.

Drag to orbit, scroll toward the surface, use WASD to walk and Q/E to move vertically. Double-click ground to glide there; hold the ground to bloom. Select a resident to find or follow them, say hello, or change their name. Resident names and garden choices are saved locally in this browser. Shelter, Three Sails and Whole planet provide named views. The three Observe buttons bring you close to the native species; Chalksteps waddle and tap for seeds, Fern Sifters crawl through leaf litter, and Dewwings flap and settle on nectar stems. `P` opens the parameter controls; the URL hash retains seed, growth and camera state.

## Check and build

```sh
npm run check:scarlet
npx vitest run environments/scarlet-sail-canyon
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:residents
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:ecology
MEADOW_PORT=5227 npx playwright test --project=scarlet-sail-canyon:invariants --grep 'CPU and GPU agree'
npm run build:scarlet
```

The canyon check and build use their own TypeScript include set, so work in other environments cannot block this build.

The standalone build goes to `dist-environments/scarlet-sail-canyon/`. Serve that directory through an HTTP server; the build uses relative asset paths. The local `lock` project can capture deterministic frame hashes for visual comparisons. The broader inherited `invariants` project also contains meadow-oriented visual and performance checks; review those expectations when changing the canyon's composition.

## Garden and backend

The world runs without a backend. Its default baskets, finds, postcards and invitation are the existing example gallery. The three canyon residents have local animation, grounded walking, greetings and saved names; they are not account-backed Muse agents.

To connect the primary Muse to an existing engine, run the repository's server separately and open the canyon with `?garden=/api/muses/<id>`. The dev server forwards `/api` to `http://localhost:8787`, or to `MUSE_API` when provided. An explicit garden source may supply its own planet seed and growth. `?dev` enables the existing engine development tools.

Invitation travel currently offers a clearly labelled **canyon route preview**. It changes only the local seed, restores that seed on return, and leaves the invitation unused. It does not connect to the named friend's world or change their account state.

## Isolation

This canyon was developed in the `planet/scarlet-standalone` branch at
`/Users/yimingguan/muse_garden_1031/scarlet-canyon-standalone-01a19427`.
The original `scarlet-sail-canyon-worktree` checkout is also used by parallel planet chats and is not this delivery.
The canyon has a separate Vite cache and port. Nothing under shared `src/` was changed.
After integration into `main`, the same commands work from another isolated checkout. Use a different free port when the original preview is still running.
