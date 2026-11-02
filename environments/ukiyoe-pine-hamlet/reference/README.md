# Ukiyo-e reference and comparison pack

Open the images themselves before editing geometry, materials or cameras. These
files were copied from `planet-ukiyoe-muse-build-kit` so the implementation has a
self-contained art reference.

| Image | Role |
| --- | --- |
| [01 · Snowy homestead](01-muse-snowy-homestead.png) | Primary composition: timber home left, clear path, Muse, indigo water and bridge right, pine framing and distant layers. |
| [02 · Whole planet](02-snow-planet-overview.png) | Global continuity, settlement scale and connected snowy landscape. |
| [03 · Rainy homestead](03-muse-rainy-homestead.png) | The same setting without snow, with rain and muted natural materials. |
| [04 · Home and bridge kit](04-home-and-bridge-kit.png) | Timber/shoji construction, roof tiles, snow accumulation, bridge rails and stone steps. |
| [05 · Vegetation and terrain kit](05-vegetation-and-terrain-kit.png) | Natural pine and cedar structure, bare plum, fine reeds and slate. |
| [06 · Pine fan drawing](06-pine-fan-drawing.png) | User correction: each rounded foliage lobe is one coherent radial fan. |
| [07 · Scalloped pine fans](07-pine-scalloped-fans.png) | Overlapping curved cloud units and rays attached to the lower twig origin. |
| [08 · Pine cloud silhouette](08-pine-cloud-silhouette.png) | Primary pine shape: rounded clustered lobes, open branch tiers, restrained flat pigment. |
| [09 · Pine woodblock detail](09-pine-woodblock-detail.png) | Primary close pine drawing: fine dark radial needles, muted green, scalloped foliage. |

The subsequent 1 November correction adds [snow roof/bank](10-snow-roof-and-bank.png), [snow on bamboo](11-snow-bamboo.png), [snowy river](12-snow-river.png), and water references for [daylight](13-water-daylight.png), [moonlight](14-water-moonlight.png), and [reflections](15-water-reflections.png). These take precedence over earlier generated snow textures: white tops, rounded draping edges, restrained blue-gray lower boundaries; broad calm water with irregular horizontal reflected shapes. The user’s actual defect screenshots remain in `reported-surface-defects/`.

The requested style is quiet and natural. The earlier alien-world explorations
are not this planet’s visual brief. Muse must stay recognisable in the app; this
pack is construction guidance rather than a set of flat backgrounds to display
in place of the working world.

The user explicitly rejected the angular pine pads with scattered needle motifs
on 1 November. References 06–09 take precedence for pine shape and marks. The
foliage lobe itself is the fan; do not treat its drawing as a repeating texture
stamp. Earlier rejected app captures remain in `rejected-angular-pines/`.

## Actual app evidence

Start with the [side-by-side comparison](comparison.html). Current checkpoints:
[Home](checkpoint-home.png), [Home with controls](checkpoint-home-ui.png),
[Bridge](checkpoint-bridge.png), [Muse](checkpoint-muse.png),
[Whole planet](checkpoint-planet.png), [Rain](checkpoint-rain.png) and
[mobile neighbour](checkpoint-mobile-resident.png). These are actual app
captures from the final verification pass on 1 November 2026.

Latest correction details: [stone steps](checkpoint-detail-steps-snow.png), [snow roof](checkpoint-detail-roof-snow.png), [rain tiles](checkpoint-detail-roof-rain.png), [connected plum](checkpoint-detail-plum-snow.png), [snow cedar](checkpoint-detail-cedar-snow.png), [water](checkpoint-detail-water-rain.png) and [barley garden](checkpoint-detail-garden-rain.png).

Material close-ups: [snow pine](checkpoint-pine-snow.png),
[rain pine](checkpoint-pine-rain.png), [cedar](checkpoint-cedar-rain.png),
[snow, plum and reeds](checkpoint-snow-detail.png). The
[reported camera](checkpoint-reported-pose.png) matches the user's flicker-check
view. [Frame stability evidence](frame-stability.json) records the tested source
hashes, GPU, resolutions, frozen redraws and motion thresholds. Earlier Home and
Rain captures remain in `pre-material-refinement/` for before/after comparison.

The later pine correction also captures [canopy detail](checkpoint-pine-canopy-rain.png),
[side](checkpoint-pine-side-rain.png), [above in rain](checkpoint-pine-above-rain.png),
and [above in snow](checkpoint-pine-above-snow.png). These show crown volume and
snow contact independently of the opening Home composition. Its historical motion evidence is [pine frame stability](pine-frame-stability.json). These earlier checks missed the exactly coplanar lowest stair tread and did not constitute visual acceptance. Current expanded evidence is [surface correction stability](surface-correction-stability.json), including the close house, stairs, plum, cedar and water cameras.

[First-pass Home](first-pass/home.png), [Home with UI](first-pass/home-ui.png),
[Bridge](first-pass/bridge.png), [Muse](first-pass/muse.png),
[Whole planet](first-pass/planet.png) and [Rain](first-pass/rain.png) are captures
of the first integrated implementation, **not the target and not a successful
visual match**. They exposed sparse needle crowns, floating-looking snow plates,
pale timber, a largely empty globe, shallow background depth and a jagged bank.
Keeping these images makes later improvements assessable.

The ecology suite refreshes actual app captures in
`../../../shots/ukiyoe-pine-hamlet/`. Consult
[the validation record](../VALIDATION.md) for the tested source state, refreshed
checkpoints and unresolved issues. A file with a familiar name can be stale;
capture after edits before drawing conclusions.

Compare at least Home, a close house/bridge view, Muse, the opposite/whole-planet
view and Rain. Freeze time with `t=12` for repeatable visual comparisons. Use a
fresh view without a stale URL `pose` when judging the authored opening camera.
Record shape, scale, negative space, material and character-contact defects
separately from test failures.

## Pipeline lessons

[pipeline-lessons.md](pipeline-lessons.md) is a snapshot of the Scarlet Canyon
handoff. The current maintained source is
`scarlet-canyon-standalone-01a19427/docs/planet-reference-handoff.md` in the parent
workspace. Read its active record before refining this world; the snapshot can
lag behind it. In particular, preserve environment isolation, CPU/GPU terrain
agreement, shared transforms across rendering passes, exact walking surfaces,
instantiated resource budgets and honest screenshots of the running app.

Passing checks protects the app. Reference fidelity and user acceptance remain
separate observations and must be recorded explicitly.
