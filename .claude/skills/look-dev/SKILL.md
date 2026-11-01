---
name: look-dev
description: The loop that made The Meadow match its references, for any visual work in Muse's Garden. Read the reference closely, frame the comparable view (a vista found by search), squint-test it (ΔE per cell), measure colours region by region, compare side by side at the reference's own angle, judge from every view Kai checks, zoom in on the evidence, fix the biggest difference, repeat. Plus Kai's standing taste. Use for any change to how a planet, building, creature or effect looks — when Kai sends reference images or says it looks off, far off, cartoony, flat, noisy, even, washed out or unlike the reference — and before showing Kai any visual change.
---

# Look development against the references

The meadow didn't look right because it was built well once. It looked right because every round compared it with the references, by number and side by side, before Kai saw it.

The rounds that went badly skipped that step:

- Kai found the colour off and the flowers even.
- Kai found a "no gap" claim false on zooming in.
- A shadow problem only showed from a few meters up.

Kai checks closely: zoomed in, from the far side of the globe, on a 1× screen, with the clouds moving. Do that first.

## The loop

1. **Read the reference, at the start and at every checkpoint.** Write what you see, region by region:
   - the big shapes and the composition;
   - the value pattern when squinted;
   - each material's colour;
   - which edges are soft and which are hard;
   - the scale of the strokes;
   - what moves;
   - what isn't there.

   Many of Kai's notes point at something already in the reference: the dark band under a pond's bank is the meadow's reflection; the clouds are sculpted lobes; the flowers bunch. If Kai names separate references for composition and colour ("use the blue one for color reference"), keep them apart.

2. **Frame the comparable view.** The planet needs a camera that sees what the still sees: a `vista` preset and button.
   - Find it by search, not by hand. Rank candidate stands by how well the view's layout matches the still. The meadow casts view rays to the water table and compares water per row and per cell, then refines for clouds and flowers in frame (`src/view/vista.ts`).
   - Render it at the reference's aspect.

3. **Squint.** Shrink both to 48 × 27 cells, blur, and compare each cell in CIE Lab (mean ΔE76), overall and by band. Then read the heat map: it shows where the difference is (composition, or the colour of one material).

   ```bash
   node .claude/skills/look-dev/scripts/squint.mjs reference/<planet>/vista.jpg http://localhost:5198 shots/squint.png
   PRESET=vista HASH="cc=0.8" node .claude/skills/look-dev/scripts/squint.mjs <ref> <target> out.png   # extra hash keys
   node .claude/skills/look-dev/scripts/squint.mjs <ref> render.png out.png        # any screenshot
   ```

   - The meadow's own test is `npm run squint`: goal 14, guard 26, its score in PROGRESS.md each iteration.
   - Give a new planet the same: a squint spec for its still, a goal, and a guard just above today's score, so it can't regress.
   - Put the score per band in PROGRESS.md each pass. The meadow went from 30.8 to 22.3 in the two rounds after it had the test.

4. **Measure colours.** Take median colours region by region from the colour reference, then grade the palette rows in linear light. Use regions that are one material each: a band of far meadow, the lake, a cloud's lit side.

   ```bash
   node .claude/skills/look-dev/scripts/regions.mjs <reference> [<render>] --regions regions.json --out swatches.png
   ```

   It prints, for each region, the median plus shade, mid and light colours (the 10th, 50th and 90th percentile of lightness), which map onto a palette row's columns. Given a render of the same composition, it adds the ΔE beside them.

5. **Compare side by side at the reference's angle.** For a building or prop, render it with a free camera placed where the painting's eye was, and lay the two out with `sheet.mjs`. The meadow's `.refview.mjs` drove `rig.camera` directly.
   - Measure proportions from the painting: the meadow cottage's ridge is a third of the eaves' length, so its plan and pitch followed from that.
   - Sample colours from the painting rather than guessing them.

6. **Judge from every view Kai checks** (drive-app `look.mjs`, `views`), in one contact sheet:
   - orbit, bird's-eye 70 m, standing 4.3 m and eye level 1.6 m;
   - the vista and the landmark (the cottage);
   - the far side of the globe;
   - R 40 and R 400 (`g=0`, `g=1`);
   - DPR 1 as well as 2.

   For motion (cloud shadows, wind sheen, fades), film frozen steps from a few meters up with check-frames `film.mjs`; eye level hides some faults and orbit hides others.

7. **Zoom in on the evidence** before you claim a fix: crop the region at 2–4× (samecheck's `CROPS=`, or a clipped screenshot). Kai asked "really no gap?" when a gap was still visible up close.

8. **Fix the biggest difference first, then go round again.** Composition and big value shapes come before colour, and colour before detail. Nail one light before adding times of day: Kai put time of day aside after iteration 2.

## Showing Kai

- Checkpoint images go in `docs/checkpoints/iteration-N/` (JPEG, about 1600 px wide, named for what they show: `vista.jpg`, `zoom-stops-10m-2.8m-1.6m.jpg`). Reference them from PROGRESS.md.
- Show the squint table, the side-by-sides for anything matched to a reference, and what is still off and why.
- If something is a trade or a guess, say so.

## Kai's taste

[references/kai-taste.md](references/kai-taste.md) has the standing rules, distilled from every review: light and shadow, water, clouds, plants, wind, buildings, change of detail, what to check. Read it before visual work on any planet. Memory meadow-aesthetic keeps the round-by-round history.

Get the look right and shown before measuring its cost: perf numbers for a shape that will still change are wasted (measure-perf comes after). For Muse's look, use `muse-look` and `muse-moves`.
