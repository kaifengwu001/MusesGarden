# Violet Dunes · Paper Orchard

A dry violet-sand world under rose daylight, with golden foliage, papery
Physalis fruit, ivory feather plants, slate outcrops and a canvas-and-stone
home. Dune skippers forage near the orchard; seed gliders land on physical
perches. Muse retains its supported home routine.

The environment was scaffolded from meadow commit `55d5b1f`. The refinement
starts from `setting_gen` commit `8e4b9f9`, preserved in refinement commit
`b697519`. The delivery branch is `environment_violet_dune`, based on `main`
at `ad37acf`. See the [environment rules](../README.md).
All implementation changes stay in this folder; shared `src/` is unchanged.

Run these commands from the checkout root:

```sh
npm run dev -- --host 127.0.0.1 --port 5231 --strictPort
npm run check
npx vitest run environments/violet-dunes --maxWorkers=2 --testTimeout=60000
npx playwright test --config environments/violet-dunes/playwright.config.ts --project=violet-dunes:ecology --project=violet-dunes:invariants
npx vite build --config environments/violet-dunes/vite.config.ts
```

Open [the orchard](http://127.0.0.1:5231/environments/violet-dunes/#q=high&hud=0).
The current Windows checkout uses [port 5232](http://127.0.0.1:5232/environments/violet-dunes/#q=high&hud=0),
because an older external checkout owns 5231. In PowerShell, set
`$env:MEADOW_PORT='5232'` for browser checks and use `npm.cmd` / `npx.cmd`.
Add `&t=12` for a frozen comparison. Remove an old `pose` parameter to see the
authored opening composition. The five place buttons show the orchard, dune
survey, whole planet and both native animals. `MEADOW_PORT` overrides the
browser-test port. Production output is `dist-environments/violet-dunes/`.

Before continuing, open the [primary concept](reference/primary-concept.png),
[visual review](reference/review.html) and [validation record](VALIDATION.md).
The concept has user-approved Physalis fruit and pink sky. The implementation
screenshots are review evidence, not a claim of final visual acceptance.

The main construction files are:

| Concern | Local files |
| --- | --- |
| Dunes, home pad, CPU/GPU ground and picking | `planet/terrain.ts`, `terrain.glsl`, `fields.ts`, `fields.glsl`, `bake.ts`, `life/fieldMap*` |
| Material-specific marks and colour | `planet/meadow.glsl`, `surface.frag.glsl`, `render/palette.ts`, `render/post*` |
| Authored outcrops, plants and conservative streamed bounds | `life/landmarks.ts`, `landmarkMeshes.ts`, `landmark*glsl`, `scatter.ts` |
| Stone, timber, canvas and supported home footprint | `life/props.ts`, `props.frag.glsl` |
| Native geometry, ground contacts, animation and shadows | `life/orchardFauna*` |
| Preserved resident rig, sculpt loader and matching colour/shadow shaders | `life/museRig.ts`, `museMesh.ts`, `museSculpt.worker.ts`, `museTripo.ts`, `muse*glsl` |
| High cirrus, optional low cloud banks | `render/sky*`, `life/cloudRibbons*`, `life/clouds*`, `cloudLumps.glsl` |
| Framing, integration and place controls | `world.ts`, `main.ts`, `ui/orchard.css` |

Keep `meadow_*` shader names and `window.__meadow`: the shared engine and
copied checks use those interfaces. The dry-world shore distance remains a
positive sentinel, not zero. Edit CPU and GPU terrain formulas together.

The November 2 Windows globe pass extends seeded rocks and vegetation through
orbital distance. Broad habitat groves and regional species mixtures alternate
with open dunes. Distant meshes use the same anchors and growth thresholds as
their detailed counterparts. Thin, drifting high cirrus strips wrap the sphere
through `life/cloudRibbons*`; the optional low-cloud cover remains separate.
`dev/globe.spec.ts` checks remote hemispheres, zoom and growth return.
The final pass packs scatter textures into portable rectangles and separates
near-detail distance from visibility bounds. Its globe check also enforces the
existing high-quality geometry/memory budgets and checks 16 exact redraws per
view. See the validation record for the isolated check against main `4259aea`.
For native Windows GPU checks, set `$env:MEADOW_GL='d3d11'`; the default remains
SwiftShader. Report renderer and resolution alongside any results.
