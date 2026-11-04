# Environments

Each folder here is a world of its own, beside the meadow. The meadow, "Muse's
Garden", lives in `src/` and stays exactly as it is: no world is made by editing
or refactoring it.

## How a world is made

`npm run new-environment -- <name> --title "<Title>"` creates
`environments/<name>/`. It holds:

- **Copies of the meadow's world-specific modules.** These are modules that
  hold the meadow's content (colours, field recipe, flowers, the cottage, Muse's
  day on its terrace, parameters, wording), or that import one of those, even
  only as a type. The list is `COPIED` in `scripts/new-environment.ts`. Files
  keep their paths from `src/`, so imports between copies stay as written.
- **Imports of everything else from `src/`, unchanged.** That covers the engine:
  the cube-sphere, point sets, growth, CDLOD, the warp, scatter, clouds, post,
  the camera, Muse's body and rig, the finds' `FindTable` state, and every shader file not copied. The
  scaffolder rewrites those imports to point into `src/`.
- **Its own page** (`index.html`), a build config (`vite.config.ts`), copies of
  the meadow's tests that cover copied modules, and a `README.md`.

A new world starts as a faithful copy: on the day it is made, its frames match
the meadow's byte for byte. From then on, it changes only inside its folder.

## Rules

- Never edit `src/` for a world. When a world needs a shared file to differ,
  copy that file into its folder at the same relative path and repoint the
  import in the world's copy.
- Shader chunks keep their `meadow_` names (`meadow_terrain`, `meadow_paint`,
  `meadow_water`, `meadow_fields`, `meadow_toon`). The shared shader files in
  `src/` include them by those names. Each world's `render/glsl.ts` registers
  its own copies under the same names, so in that world's page the shared
  shaders compile against the world's chunks.
- The test harness global stays `window.__meadow`, so the copied specs work
  unchanged.

## Taking visits: a world as a destination

A friend's owner on a ticket travels to the host's own planet, Muse and all: the host's world's page with
`?visit=<ticket>&as=<guest>&garden=<base>`. The visit itself is shared (`src/visit/`, typed only by structure, so
it never imports a world). A world takes visits with three small pieces in its own folder. Lantern Reed Gardens
was the first (`lantern-reed-gardens/{visit.ts, world.ts, main.ts}`), and the meadow's are `src/meadowVisit.ts`
and `src/main.ts`; copy them.

1. **`visit.ts`, the adapter.** A function from the world's `World` to a `VisitWorld` (`src/visit/world.ts`):
   - `planet`: the world's PlanetId. `scene`: the World itself (its rig, warp, growth and `pick`, and `frameMuse`
     if it has one: the arrival uses it, since it knows the home's walls).
   - `host`: the world's own Muse; `dressHost(look)` puts it in the host's body.
   - `makeGuest(look)`: a second Muse, made as the residents are: the shared uniforms less `uMusePress` and
     `uMusePressK` (and the Muse shadow map's, where the world has one), no props of its own, in the guest's
     body, handed to `world.addVisitor`.
   - `hideOthers()`: the world's own residents out of sight (`direct({ kind: 'hidden' })`), every frame.
   - `marks`: the world's find beds (and specimens): `set(looks, radius)`, `update(altitude)`, `open(id)`.
   - `layOut` and `bedAt` from the world's `garden/placement.ts`; `ground(dir)`, its terrain's sample;
     `shape()`, its terrain's layout; and, if the world knows more than water, `standable(dir)` (off a house's
     walls, on a deck's free part: the meadow's `MuseRoam.standable`).
   - `frameHome()`: the world's own view of its home, for the visit rail's home button (`cameraPreset('homestead',
     false)`, or Sequoia's `'cabin'`); without it the visit flies to the house from out in front.
2. **`world.ts`.** A `visitors` list and `addVisitor(muse)`: its body, props and shadow added to the scene, and
   each visitor updated and culled in `World.update` as the host is. Add the visitors to `pickMuse`, so a tap on
   the guest says hello, and to any reflection pass that draws the host. With no visitor the list is empty, and
   the world's frames must stay as they were (its `:lock` project, with `LOCK_BASELINE`).
3. **`main.ts`.** `const visit = await prepareVisit(store, '<planet>')` before `new World(…)`, then, under a
   visit, a `VisitUi` in the garden's place: `visit ? new VisitUi(uiRoot, <world>Visit(world), visit) : new GardenUi(…)`,
   with no engine of its own (`connectEngine`) and none of the world's own panels.

A guest out by its host is directed `{ kind: 'out' }`. For a tap on it to say hello, the world's Muse must answer
taps while directed out, as `src/life/muse.ts` does (`MuseRoam.answerOver`). Until a world has its adapter, its
entry in `src/muse/planets.ts` should say `visitable: false`, and the garden keeps its tickets in the post.
`npm run test:visit` (the sample backend) runs a visit on every destination and on the meadow, its rail included.

The same three pieces give a destination the photo studio: `?studio` on its page draws its own friend in its cast
look (`server/fixtures/cast.json`) with Momo beside it, with no server, under a panel of shots, doings, faces and the
time held (`src/visit/studio.ts`; C puts the panel away, T holds the time). In `main.ts`,
`const studio = visit ? null : await prepareStudio(store, '<planet>')` beside `prepareVisit`, and
`studio ? studio.open(<world>Visit(world), clock) : …` in the garden's place. What a Muse can do there is read off
the world's Muse itself: the parts of its day its life writes, `tap`, `hold` and `letGo`, and a `pose` (its rig) to
hold a look on.

The director's mode, for filming (`?director` on its page: [docs/director.md](../docs/director.md)), comes with the studio's
hook and asks two small things more of a world, as each world here has them:

- **Its Muse takes a life handed over whole**, frame by frame, in place of its own: `act(life)` (and `acts`, what it can
  show). In `life/muse.ts`, `lifeAt` returns that life first, its feet at its roam's `groundAt` plus the life's height
  (copy Golden Rye's). Its things' ladle follows a pot the director gives (`cues.cook.pot`, in `life/museProps.ts`).
- **Its adapter offers a stage** for the director's benches and stoves: `stage: { add, remove, shared: world.shared }`
  in `visit.ts`.

Without them the page still opens `?director`, and its Muses walk and turn as a visit directs them.

## Running, testing and building a world

| | Command |
|---|---|
| Open | `npm run dev`, then `http://localhost:5173/environments/<name>/` |
| Type check and lint | `npm run check` (covers `environments/`) |
| CPU tests | `npm test` (covers `environments/**/*.test.ts`) |
| Browser invariants | `npx playwright test --project=<name>:invariants` |
| Frame lock | `npx playwright test --project=<name>:lock` (writes `shots/<name>/lock/`; set `LOCK_BASELINE=<hashes.json>` to compare) |
| Build | `npx vite build --config environments/<name>/vite.config.ts` (to `dist-environments/<name>/`) |

The meadow keeps its own commands (`npm run dev` at `/`, `npm run build`) and its own build output (`dist/`). Each world's `README.md`
records the meadow commit it was copied from.

## Worlds in this checkout

[Lantern Reed Gardens](lantern-reed-gardens/README.md) is available at http://localhost:5225/environments/lantern-reed-gardens/ using `npm run dev:lantern`. Its storage and build output are independent of other worlds. The original meadow remains at `/`.

[Scarlet Sail Canyon](scarlet-sail-canyon/README.md) is served on port 5227. Its code, build output and resident storage are independent of the original meadow.

[Cobalt Windfields](cobalt-windfields/README.md) is served on port 5217 with `npm run dev:cobalt`. Its blue rock formations, peach sand, native plants, wildlife and local residents live entirely inside its own environment folder.

[Tulipwind Meadows](tulip-windmill-meadows/README.md) is served on port 5241 with `npm run dev:tulip`. Dense tulip ribbons, turning windmills and varied cottage gardens form a separate cultivated planet.

[Golden Rye](golden-rye/README.md) is served on port 5251 with `npm run dev:rye`. A flat plain of rounded strip fields of rye, olive bunds, a farm road, cypress groves and rounded clouds form a separate harvest planet.

[Cherry Blossom Waterways](cherry-blossom-waterways/README.md) is served on port 5249 with `npm run dev:cherry`. It combines pink and ivory cherry groves, green willows, blue canals, a tiled pavilion and duck flocks.

[Sequoia Shrine](sequoia-shrine/README.md) is served on port 5245 with `npm run dev:sequoia`. Dense ancient forest covers a planet of widely separated shrines, connected hiking trails and a separate cedar home for Muse.
