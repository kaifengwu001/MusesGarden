---
name: check-frames
description: Proving that frames are right in Muse's Garden. Check that a change is pixel-identical (every performance fix must be), that two builds or two published pages draw the same frame, and hunt down single-frame flashes, blank frames, missing strips of grass, flicker, popping and MSAA specks on 1× screens — at their source, in filmed frames, or in Kai's screen recordings. Use when Kai reports a flash, flicker, blink, pop, missing patch, specks or something "only on my external screen", when you claim a change doesn't alter the image, or when comparing builds or live pages.
---

# Checking frames

Kai notices single frames: a blank canvas for one frame, a strip of grass missing and coming back, specks on the blue flowers only on a 1× screen. Kai sends screen recordings of them. Kai's rule for performance work is that the image must not change.

Both demand evidence pixel for pixel, not "looks the same". Every script takes targets as in drive-app: URLs, or builds made with `build-at.sh`.

## Is it the same picture? (`samecheck.mjs`)

```bash
S=.claude/skills/check-frames/scripts
node $S/samecheck.mjs after after high               # self-check first: must be identical
node $S/samecheck.mjs before after high medium        # per view and tier: identical, or how many pixels and how far
DPR=1 node $S/samecheck.mjs before after high         # 1×: MSAA on
CROPS=/tmp/crops node $S/samecheck.mjs before after high   # zoomed crops round each difference, A and B
```

- **What it does.** It loads one page at a time. At each view it freezes time, then pins the scale to 1 (after freezing), renders twice and reads the drawing buffer back. It reports `identical`, or the differing pixel count, the max Δ, and Δ over 4, 16 and 64 with their bounding box.
- **Self-check first.** A target compared with itself must give `identical`. If it doesn't, the comparison measures noise.
- **Live pages work too,** since the harness ships in production. Pinned tilt and fov need `__world`, so on live pages the views fall back to their poses; both pages fall back the same way.
- **Judging a difference.** One pixel off by one step out of 255 is rounding: say so. Thousands of edge pixels, or any Δ over 16, is a change of look. Find it with `CROPS` and look before deciding.
- **A soft "difference" across the whole frame** usually means the render scale wasn't pinned. That faked about 96k pixels a frame between iterations 14 and 15. The real difference was about 200 specks plus 3k edge pixels.

## Flashes and dropped frames

1. **Count them at the source while walking.** That is where a screenshot can't lie.
   - `flashcheck.mjs <target>` hooks the meadow's World. It counts **blank frames** (the canvas resized after the scene was drawn in the same frame) and **patch drops** (a tile's pages changed between the visibility pass and the draw) during a scripted walk.
   - The GPU invariant "walking never drops a strip of grass from a frame, and a resize never blanks one" runs the same check in `npm run test:gpu`.
   - For a new system or planet, hook the event where it happens in the same way.
2. **Film the motion** and count one-frame changes.

   ```bash
   node $S/film.mjs <target> /tmp/film '{"view":"standing 4.3 m","t0":20,"n":90}'
   node $S/flashes.mjs /tmp/film          # a pixel unlike both neighbours, which agree: per frame, by band
   node .claude/skills/drive-app/scripts/sheet.mjs /tmp/film.jpg --cols 6 --width 240 /tmp/film/f0*.png
   ffmpeg -framerate 30 -i /tmp/film/f%03d.png -pix_fmt yuv420p /tmp/film.mp4
   ```

   Film from a few meters up with clouds drifting when judging shadows; eye level hides their stutter.
3. **Use Kai's recordings.** Pull frames with `ffmpeg -i rec.mov -vf fps=60,scale=960:-1 /tmp/rec/f%04d.png`, then run `flashes.mjs /tmp/rec` to find the frames, and look at them and their neighbours. Note what kind each flash is: the whole screen gone, or one patch.

## The causes so far (look here first)

- **Frame order.** A canvas resize clears it, so a resize after the draw shows a blank frame. Resizes happen only before the update. Tiles must be built before the update that decides what is drawn: built between the two, a tile's blades moved to pages not marked visible, and a strip was missing for a frame. This order came in with S1–S5 and showed up once resizes and rebuilds became frequent (fixed in iteration 12).
- **MSAA specks on 1× screens.** With MSAA (pixel ratio below 1.75), a pixel only partly covered by a tiny triangle is shaded at its centre. Its per-vertex colours are extrapolated out of range, and blue flowers flickered black. The fix was centroid interpolation of the colours (iteration 15). The invariant "under MSAA no pixel of the scene leaves the range of its colours" guards it. Judge the look at `DPR=1` as well as 2.
- **A bug that "back-propagated" to old pages** is a clue that the cause is shared, not the newest change. Compare old builds locally (measure-perf post mortems).

For Muse (its walks, turns, poses and videos), use muse-look and muse-walks.
