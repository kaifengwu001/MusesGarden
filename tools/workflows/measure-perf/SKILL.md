---
name: measure-perf
description: How to measure Muse's Garden's performance honestly on this Mac (headless Chromium, ANGLE on Metal). A/B two builds in one browser with alternating rounds, live walks with Auto recording every frame, the cost of each part by hiding, skipping or stubbing it, post mortems against older commits, and how to read the numbers (hidden-surface removal, occupancy, pass stalls, heat). Use whenever Kai mentions performance, frame rate, smoothness, jank, hitches, slow or chunky loading, "perceived performance is worse", a budget, Auto or the quality tiers, or asks what something costs — and before claiming that any change is faster, free or lossless.
---

# Measuring performance

## What Kai wants (from the reviews)

- **Smoothness over the number.** With Auto allowed 24 ms a frame the app felt "significantly worse". Auto aims at 60 fps.
- **The resolution moves, the look doesn't.** Auto trims the render scale (floor 0.5, steps free since iteration 13) and holds the tier. A tier switch rebuilds all the grass, which reads as the world reloading.
- **Never alter the look for performance.** Resolution doesn't count as the look; Kai likes a little upscaling blur. Every optimisation is lossless, and you prove it (check-frames samecheck).
- **Every feature has a cost Kai will ask about.** 1.2 ms for bird shadows was "steep". Measure each addition against the build before it, and keep what is cheap.
- **Measure it the way Kai uses it.** Frozen benchmarks missed Auto switching tiers for five iterations. A live walk with Auto would have caught it.
- **Look first.** Measure a visual change only once its look is settled and shown.

## Methods

Make builds to compare with drive-app's `build-at.sh`. Use probe builds: production code with `window.__world` exposed.

```bash
B=tools/workflows/drive-app/scripts; P=tools/workflows/measure-perf/scripts
$B/build-at.sh before HEAD~1 && $B/build-at.sh after      # the last commit against the working tree
node $P/ab.mjs before after high                        # per view: best / median of 8 alternating rounds
node $P/ab.mjs before after medium
node $P/walk.mjs after "after, Auto"                    # live: load, walk, turn+walk, strafe, still
node $P/variants.mjs after variants.json high           # what each part costs
```

1. **Frozen throughput.** `__meadow.benchmark(n)` renders n frames back to back and syncs the GPU with a readPixels. That is the only timing that holds up here. Per-pass timer queries are inflated and useless on ANGLE Metal.
2. **A/B in one browser** (`ab.mjs`). Both builds sit in the same browser and alternate round by round, so heat and load hit both the same. Report best and median. Repeat runs agree within about 0.4 ms; anything smaller is noise. Use views from `drive-app/views/meadow.json`, or `VIEWSFILE` for another planet.
3. **The live walk** (`walk.mjs`). Real time, Auto, keys held. Per phase it reports:
   - frame p50, p90, p99 and max;
   - frames over 25 ms (hitches);
   - JS and build ms;
   - the build queue and grass in view;
   - each `tier@scale`, including any change.

   Run it on both builds, close together in time.
4. **Variants** (`variants.mjs`). Each variant hides something (`__v.hide`), draws one thing only (`__v.only`) or skips a pass (`__v.skip`), timed against the build as it is, interleaved, best of the rounds. A stubbed shader piece needs a patched material copy instead (`onBeforeCompile`, or a define). Check every variant's picture changed before trusting its Δ.
5. **JS.** `stats().jsMs` per frame; a Chrome CPU profile through CDP for detail (root `.cpuprof.mjs`). In a frozen frame, JS has been under 0.5 ms; the GPU is where the time goes.

## Reading the numbers (this GPU misleads)

- **Hidden-surface removal.** Apple's GPU shades only the front-most opaque fragment, so hiding something lets what was behind it draw, and the saving understates its cost. With only the ground drawn, the vista costs the same as the whole frame: the ground shader then runs where grass used to cover it. Time "only X" variants too.
- **Occupancy.** A huge shader is register-bound, so code that never runs still costs. In the vista, 237 m from the cottage, the cottage's code cost 2.1 ms in the ground shader. The fix is a define per region (AWAY_FROM_HOME).
- **Stalls.** A cheap pass can cost a lot by making the frame wait. The field map cost 1.3–1.6 ms because it was drawn after the clouds and the grass's vertex stage read it. Moving it first saved 0.9–1.5 ms.
- **Heat and other sessions.** Timings drift with GPU heat, and other sessions render on the same GPU. Alternate builds, take the best of rounds, re-run when numbers jump, and say when the machine was busy.
- **Reallocation.** A resize, or a resolution change that reallocates targets, costs a 70–90 ms frame; Auto's steps did that until iteration 13. Look for single huge frames in the walk's max.

## Post mortems ("when did this start?")

Build the suspect commits (`build-at.sh i11 15b7dbb`), then run the same walk, flashcheck or A/B on each. Bisect by building midpoints.

Read the clues:

- A bug that "back-propagates" to older published pages points at the environment, or at an order-of-operations race that is now hit more often. Iteration 12's flashes came from a frame order introduced in S1–S5 that only became frequent as resizes and rebuilds grew.
- Old builds run locally separate the code from the machine.

## Reporting

Give a table of views × builds in ms a frame. Say:

- the resolution and DPR;
- the tier;
- best or median;
- the Δ;
- whether the machine was quiet.

Separate GPU from JS. Name each lossless fix and its saving, and anything you did not do because it would change the look. That was the case for the flower-clump bake in iteration 13: its noise is finer than the bake's texels.

Baselines live in memory meadow-perf-profile and meadow-grass-loading, and in PROGRESS.md's Measured sections. Start from them, and re-measure with the same views. For Muse's cost, also see muse-look.
