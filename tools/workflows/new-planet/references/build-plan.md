# A planet's build plan

The meadow's brief laid out S0–S11. This is that plan, re-ordered by what the 17 iterations taught: harness and look first, features judged against the references as they land. Every stage ends the same way:

1. `npm run check`, `npm test`, and the GPU tests that apply.
2. Shots of the planet's views (drive-app `look.mjs`), laid out in a sheet next to the references and read by you.
3. The squint score, and per-region colours where colour changed (look-dev).
4. Fix what you see, then commit ("<Planet> S3: terrain and water, …").

Build the whole pass before showing Kai, unless Kai asks to see a stage.

| Stage | Build | Done when |
|---|---|---|
| S0 Harness | The planet in the app (behind the planet choice, its world class); its URL keys; presets and a views file (orbit, bird's-eye 70 m, standing 4.3 m, eye level 1.6 m, its vista, its landmark); its shots; a squint test pointed at its vista still; the invariants run for it | Shots render at frozen time; the squint script runs (the score will be bad) |
| S1 Planet core | Reuse the spherified cube, CDLOD, rest-space point sets and growth. Debug colours by face and level | Growth scrubs smoothly; no swimming; density holds |
| S2 Light and colour | Palette rows measured from the colour reference (regions.mjs); toon light; the sun fixed to the planet; sky; aerial haze; grade | A bare, roughly shaped planet already reads like the reference's light and colour when squinted (score per band) |
| S3 Land and water | The big shapes first, from the references' structure (ridges, valleys, terraces, shorelines), as fields in direction space; the bake; water at its table with banks and the mirror; the vista found by search (rank stands by how well the view's layout matches the still, e.g. water per row and cell) | Overview and vista sit beside the references; squint improving; no CG-noise look from above |
| S4 Ground cover and wind | Blades or crops from rest space; the field map; wind with gusts that travel and a sheen of dark troughs and bright crests | Eye-level shot beside the references; a 10 s dolly with no rings; frame time measured |
| S5 Patches and vegetation | Species, crops or trees in patches at several scales (drifts, colonies, clumps), with bare ground between; a painterly far field that hands over to the real plants directly | From above, patches read like the reference, not salt-and-pepper |
| S6 Buildings and props | Bent to the planet; matched to a reference one to one if Kai asks (measure proportions from the painting; check side by side at its angle) | No floating or buried parts at R 40 and 400 |
| S7 Sky life | Clouds or fog as one system (shadows and reflections from the same puffs); birds on routes | Judged from a few meters up with clouds drifting; shadows don't stutter |
| S8 Warp and camera | The warp in every pass, picking through it; zoom stops in meters | R = 400 still reads as a tiny planet; picking parity |
| S9 Growth polish | Unlocks by area, fades as the planet grows; things spawn straight in as you move | An 8 s grow and bloom sequence with no hitch (filmed) |
| S10 Performance | measure-perf: A/B, a live walk with Auto, budgets; lossless fixes only | Numbers in PROGRESS.md; no frame over 25 ms after the first second |
| S11 Polish | UI, hints, postcard; a final grade pass against the reference | Squint at its best; every view in a contact sheet |

## What "the look harness first" buys

The meadow's squint test arrived in iteration 3. The vista search came with it, and so did the colours measured per region. Before that, two rounds of Kai's notes said the colour, the water and the flowers didn't match. After it, every change had a number and a picture beside the reference before Kai saw it. The meadow's score went from 30.8 to 22.3 in two rounds. A new planet should have all three from S0 to S2.
