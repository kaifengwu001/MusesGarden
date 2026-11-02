---
name: muse-walks
description: Check how Muse roams the planet in Muse's Garden without a browser. Samples its seeded life (museRoam.ts) in Node for minutes to hours, plots every walk from above (the meadow round the hut, the porch and pier up close), compares against an older commit side by side, and scans frame by frame for snap turns, jumps, ponds and walls, plus how its time splits between pastimes. Use whenever museRoam.ts changes (routes, paths, outings, durations, places), and whenever Kai says Muse's movement looks robotic, rectilinear, glitchy or turns sharply, that it walks through things, stays in one area or does something too briefly or too often. Also use it to show Kai before/after pictures of its paths.
---

# Muse's walks, from above

Muse's life on the planet is closed form: `museRoam.ts` writes a seeded itinerary of parts and reads it back by time. So Node can sample its position, heading and gait for hours in a second or two, with no browser, GPU or dev server. That makes this the quickest way to judge where it goes and how it moves. Use muse-look's videos for how it looks while doing it.

```bash
W=tools/workflows/muse-walks/scripts      # from the repo root
$W/probe.sh <scratch>/now 80 0.1                 # 80 minutes every 0.1 s: pictures of where it goes
$W/probe.sh <scratch>/fine 20 0.016667           # 20 minutes every frame at 60 Hz: turns and jumps
$W/probe.sh <scratch>/before 80 0.1 0924020      # the same at a commit (a temporary worktree)
python3 $W/scan.py <scratch>/fine                # snaps, jumps, ponds, walls, time per pastime
LABELS="Before,Now" python3 $W/plot.py <scratch>/paths.png <scratch>/before <scratch>/now
```

`probe.sh` writes a throwaway vitest file into `src/dev/invariants/` for the run, then deletes it. The file must sit in the suite's folders to run, so don't be surprised to see it in `git status` mid-run. `SEED` and `R` pick another planet. The default is the seed and radius the roam tests use.

## Reading the plot

- **Red** is walking; **blue** is everything else that moves Muse (hops onto the bench, turns on the spot, shuffles).
- **Robotic paths** show as straight spokes fanning from one point, right angles and fixed lanes. Iteration 17's porch lane and spokes from the foot of the steps looked like that. Smooth paths curve through corners and spread out.
- **A V** where two walks meet is fine: Muse arrived, did something and set off another way.
- **Many paths pinched through one point** is a waypoint. That's fine at the house's corners. Out in the open, look again.
- **Where it goes:** if every outing heads into one quarter, routing is likely blocked somewhere. Iteration 17 never went behind the house or past the pond.

## Reading the scan

- **Turns:** a half turn on the spot peaks near 4.1 rad/s (`TURN` in museRoam.ts). A spike well above about 5 rad/s is a snap. Iteration 17's turn-round-and-back glitch came from the heading aiming at the spot Muse already stood on, at the end of a walk. Only the 1/60 s probe resolves glitches that last a frame or two.
- **Moves:** its walk is about 0.54 m/s and hops reach about 1.8 m/s. Well above 2 m/s is a jump. Those have come from a route falling back to a straight line through something.
- **In a pond / inside the walls** must be 0. Sitting on the pier's edge to fish is allowed for.
- **Time by part:** answers "too brief" and "too often" with numbers. Long walks show as `walk`, and the short named part before a walk is its first turn. As of 2026-10-31, Muse spends about 60% of its time walking.
- Each moment comes with "part + s into it". Film that exact moment with muse-look (`video.mjs <out> <part> <s-2> 6`).

## After a change to museRoam.ts

1. Run `npx vitest run src/dev/invariants/museRoam.test.ts`. It checks R 40, 128 and 400: Muse stays out of water and the house, makes no jumps, turns smoothly (no turn faster than its quickest half turn, over 20 minutes at 60 Hz), does every pastime, and is deterministic. When the scan finds a new kind of glitch, add a check there too.
2. Probe and plot before/after against the last commit, and scan the fine run.
3. Film one or two of the changed moments with muse-look before reporting. Kai judges by eye, and a clean plot is not a smooth-looking walk.
