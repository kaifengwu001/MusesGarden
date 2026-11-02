---
name: new-planet
description: How to start and build a new planet (another world to visit) in Muse's Garden from Kai's brief so it reaches the meadow's quality fast. Record the brief, study the references, build the look harness (vista framing and squint test) before features, stage the build on the shared fundamentals (rest space, spherified-cube CDLOD, the tiny-planet warp, growth, the terrain bake, palette and toon light), write the invariants, and skip the mistakes the meadow paid for over 17 review rounds. Use when Kai asks for a second or new planet, biome or world (the terraces, a desert, a coast…), when planning or restarting one, and when a new planet looks far off from its references.
---

# Building a new planet

The meadow took 17 rounds of Kai's review to get where it is, and most rounds were about the look rather than features. Kai named what read wrong against the references, and each fix was checked against them. The terraces' first pass was "FAR off", and Kai pointed it at "how recursively the original planet was improved".

So a new planet should start with that loop already running. Kai's first look at it should be something you have already measured against the references and fixed yourself.

The original brief's working rules still hold:

- Plan first: restate the architecture and the growth model in your own words.
- After each stage, run the checks, the tests and the shots. "Look at the screenshots yourself and compare them with the reference before showing me. Fix what you see."
- Keep PROGRESS.md current and commit at each stage.
- When you trade quality for performance, say what you traded. Better still, don't trade the look at all (see measure-perf).

Kai would rather review one complete pass than stop at every stage, so build the whole pass before pausing.

## 0. The brief and the references, before any work

- **Write it into PROGRESS.md.** Add a section for the planet, as "The terraces: a second planet" does. It holds:
  - the commit it starts from;
  - Kai's brief;
  - each reference in one line;
  - a notes table `| # | Note | What changed |` with Kai's points and the right column empty.
- **Keep the references out of git.** Put them under `reference/<planet>/` and add that folder to `.gitignore`.
- **Commit that alone**, as "<Planet>: start, Kai's brief recorded before any work", so the work starts from a commit.
- **Know which reference is which.** If Kai hasn't said, ask which still is the composition to squint against (the vista) and which is the colour reference. For the terraces, Kai named a photo for the vista and "the blue one" for colour.

## 1. Study the references (look-dev skill)

Write the read-out before any code. For each reference, note:

- the big shapes and the composition;
- the value pattern when you squint;
- the colour of each material, measured with `look-dev/scripts/regions.mjs`, not guessed;
- the edges, hard or soft;
- the scale of strokes and texture;
- what moves;
- what is absent.

This read-out becomes the planet's art direction. Kai's notes on the meadow kept pointing at things that were in the reference all along. One example: "the dark edge around the ponds is actually the reflection of the meadow, look carefully".

## 2. Plan on the shared fundamentals

[references/fundamentals.md](references/fundamentals.md) maps what the engine already gives, where it lives, what a planet must supply, and how each piece has failed before. Put the planet's architecture and growth model in your own words into ARCHITECTURE.md:

- what lives in rest space;
- what stretches with R and what keeps its size in meters;
- what the bake holds;
- how the views are framed.

## 3. Harness first, then the light, then the land, then the life

[references/build-plan.md](references/build-plan.md) is the meadow's S0–S11 plan, re-ordered by what we learned. The views, the shots, the squint test and the invariants exist before the features. The light and colour of a bare planet match the reference before the terrain gets detail. Each feature is judged in the views and by the squint test as it lands.

## 4. A full pass, then iterations

When every stage is in:

1. Measure it (measure-perf).
2. Document it.
3. Publish its page (publish-page).
4. Report to Kai and pause.

From then on, each round of Kai's notes is an iteration (review-iteration skill).

## The lessons that cost the meadow whole rounds

These generalize to any planet. [look-dev's kai-taste.md](../look-dev/references/kai-taste.md) has them in full, and memory meadow-aesthetic keeps the history.

- **Everything stays with the planet.** The sun, shadows, birds and reflections live in planet space, so nothing slides when the globe turns.
- **Sizes are meters.** Blades, flowers, buildings and paths keep their size as R grows; only the distances between macro features stretch. Zoom stops are heights in meters.
- **No generic noise.** Kai rejects anything that reads as computer-generated noise. Shape fields into the reference's own structures (streaks, swirls, terraces, drifts). Vary density at several scales, with bare ground between patches; even scatter reads wrong.
- **One system per phenomenon.** The same cloud puffs draw the cloud, its shadow and its reflection, so the three always agree.
- **Water mirrors the sky.** The dark band at a shore is the bank's reflection, not an outline. Banks are irregular and three-dimensional.
- **Level of detail never draws the eye.** Nothing grows in, shrinks out, pops in chunks or leaves a ring. Build what is in view first, nearest first, and spawn things at full size.
- **No frame dropped or shown blank.** Kai sees single-frame flashes and specks (check-frames). Check the look at DPR 1 (MSAA on) as well as 2.
- **Performance never changes the look.** Auto keeps 60 fps by resolution alone and never switches tier live. Kai watches each feature's cost.
- **Check everywhere.** Look at the far side of the globe, at R 40, 128 and 400, from orbit down to eye level, with clouds drifting.
- **Big shaders cost even where their code never runs** (they are occupancy-bound). Compile per region with a define instead: the meadow's ground away from the cottage drops the cottage's code (AWAY_FROM_HOME).
- **Meter-scaled bake fields need the radius.** The terraces' first relief turned every peak into a plateau because its GPU bake had no planet radius; the meadow's bake had never needed one.
