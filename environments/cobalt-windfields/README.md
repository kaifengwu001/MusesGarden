# Cobalt Windfields

A standalone playable world: peach sand, varied fractured cobalt outcrops, curved ivory seed sails, large coral fields and sheltered pockets, a rough slate shelter and the two-slab Wind Window. Pip, Juniper and Marlo live near the shelter. Sailbacks walk and open their sails, Kitelets flutter and perch, Sand Stitchers carry dry stems, and light seeds drift through the stone gap.

The outdoor Muse prop shaders are local copies so mainline's indoor-hut
changes preserve Cobalt's porch stove and warm fire window.

The Windows continuation expands planted colonies and remote geology across
the globe, with thirteen rock forms and thin drifting cirrus ribbons wrapping
the planet in orbit. The ribbons fade from close ground views. Current visual
evidence and Windows validation settings are recorded in `VALIDATION.md`.

The environment began from the Muse body and animation engine at commit `fb21a13`, with locally copied dry-world infrastructure, and is integrated on main commit `ad37acf`. Its saved-find and grass shaders retain local compatible copies so newer meadow shader changes do not change their data contracts. All world-specific code is inside this folder. Shared `src/`, the meadow, Scarlet Sail Canyon and Violet Dunes are not edited by this world.

## Open

The current [visual catalogue](catalogue/index.html) includes planet views,
two-angle specimen plates, terrain, wildlife and residents. A 23-page
[PDF edition](catalogue/output/pdf/cobalt-windfields-catalogue.pdf) is included.

From the repository root, start the development server:

```sh
npm run dev:cobalt
```

Open <http://localhost:5217/environments/cobalt-windfields/>. If that server is already running, use the link directly.

Drag to orbit, scroll toward the surface, use WASD to walk and Q/E to change altitude. Double-click ground to glide there; hold ground to bloom. Select a Muse resident to follow, greet, pet or rename them. The Look closer buttons frame a Sailback, Kitelet or Sand Stitcher. Wildlife is displayed at 3× its authored size so the bodies remain readable in the landscape. Names and garden preferences are saved in this browser under Cobalt-specific storage keys. Shelter, Wind Window and Whole planet provide named views. `P` opens the parameter controls; URL hashes preserve seed, growth and camera state.

## Check and build

```sh
npx tsc -p environments/cobalt-windfields/tsconfig.json
npx eslint environments/cobalt-windfields
npx vitest run environments/cobalt-windfields --maxWorkers=2
MEADOW_PORT=5217 npx playwright test --project=cobalt-windfields:residents
MEADOW_PORT=5217 npx playwright test --project=cobalt-windfields:invariants --grep 'CPU and GPU agree'
npx vite build --config environments/cobalt-windfields/vite.config.ts
```

The standalone build is written to `dist-environments/cobalt-windfields/`; serve it through HTTP. It has relative asset paths. The local `lock` project captures deterministic frames. The inherited 400-find specimen memory limit of 1 MB remains unmet by the richer native forms; its test is unchanged. No 400-find GPU performance or 60 fps result is claimed. See the [active validation record](VALIDATION.md) for checked results, final captures, remaining visual differences and known limits.

## Local residents and the optional backend

The three neighbours are local animated residents, not account-backed agents or a claim of live friend presence. Their names, safe walking paths, greetings, petting and camera following work offline. Eleven authored local animals—three Sailbacks, five Kitelets and three Sand Stitchers—use deterministic walk, glide, perch and litter-carrying loops at 3× display scale. A full-world wildlife population is not implemented. The inspection views follow them, but they are ambient animals rather than interactive pets.

Default finds, baskets and postcards remain the application's example gallery. To connect the primary Muse to an existing engine, run the repository server separately and open this world with `?garden=/api/muses/<id>`. The dev server proxies `/api` to `http://localhost:8787`, or `MUSE_API` when set. An explicit backend source may supply its seed and growth; it does not yet allocate Cobalt planets to friends.

Invitation travel is an explicitly labeled local route preview. It restores the original seed on return and does not redeem invitations or load another account's world. See [construction notes](CONSTRUCTION.md) for rendering and navigation boundaries.
