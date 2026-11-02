---
name: review-iteration
description: Kai's review cycle for Muse's Garden, as every iteration since the first has run it. Record Kai's notes in PROGRESS.md and commit before any work, build the whole iteration milestone by milestone (look first, cost after), run the checks, measure against the last iteration, document the notes answered with what was measured and traded, publish the iteration's page, report, then stop for review. Use whenever Kai sends review notes or numbered comments on the planet, Muse or the interfaces, says "next", "continue" or "start the next iteration", or reviews a published page — and when wrapping up any iteration.
---

# A review iteration

Kai reviews complete passes, not steps. So each round runs the same way:

1. Kai's notes become an iteration.
2. The whole iteration is built and checked.
3. It is published as its own page.
4. You report and stop, until Kai's next notes.

This order grew over the meadow's iterations, one part at a time at Kai's request: a full pass before review since iteration 1, a page per iteration since 5, the notes committed first since 6, live walks since 10.

## 1. Start: the notes, committed before any work

Kai asked after iteration 5 for every iteration to start from a commit. That makes the starting point clear and keeps each iteration's diff readable.

- **Add a section** near the top of PROGRESS.md, under the Versions table: `## Iteration N: <what it is about>`.
- **Its first line** is "Started from <short sha> (<what that is>). Kai's notes (<date>); this table fills in as they are done."
- **Then the notes table:** `| # | Note | What changed |`. Put Kai's notes in Kai's own words, lightly tidied, one per row, and leave the right column empty. Add numbered rows for things you'll add on your own (an "(added)" note).
- **Commit only that:** `git add PROGRESS.md && git commit -m "Iteration N: start, the review notes recorded before any work"`.
- **Not an iteration:** when Kai reviews a published page between iterations, the fixes go in the current section as "Kai's review of iteration N's page (date), done:" with one bullet per point.
- **Separate tracks:** Muse, the interfaces and a new planet each get their own "(in progress)" section, as PROGRESS.md shows.

Ask only what blocks you. For anything with a sensible default, act and say so in the report.

## 2. Build it: a whole iteration, milestone by milestone

- **Group by system.** Work through the notes in milestones that each touch one system: clouds, water, the cottage, the grass loading.
- **Commit each milestone** as it lands, in the repo's style. Plain words say what changed, as Kai would see it: "Iteration 13: the field map drawn before the clouds; the cloud mirror shaded only where a lake can read it". No attribution lines.
- **Look first.** Settle a visual note against the references and the views (look-dev) before measuring what it costs. Perf numbers for a look that will still change are wasted.
- **Then measure the cost** (measure-perf).
- **Never alter the look for performance.** Resolution doesn't count as the look.
- **Prove lossless changes** pixel for pixel (check-frames).
- **Work around other sessions.** If other sessions are editing the main checkout, build in your own worktree. Commit by path only. Other sessions commit to main between your commits; that's fine, so leave their files alone.
- **For Muse,** use muse-look, muse-walks and muse-moves alongside this skill.

## 3. Check it

Run these before each milestone commit:

- `npm run check`
- `npm test`

Run these before the end:

- `npm run test:gpu`
- `npm run shots`
- `npm run squint`, if the look changed

Read the shots yourself.

Two traps:

- **Port 5199.** Playwright reuses whatever is listening there. Check who serves it (`lsof -iTCP:5199`) before trusting the GPU tests or shots, especially from a worktree.
- **The scrub-budget test** ("scrubbing growth in real time stays within the frame budget") fails at a 30 fps lock (p95 about 33.3 ms) while other sessions load the GPU. Run it at the previous commit before calling it a regression; if that fails too, it's the machine.

If you change a test's limit, give the reason in the test and flag it to Kai in the report. Iteration 13 raised the scrub limit 5.5 → 5.6 ms with its reason written in.

## 4. Measure it

- **A/B against the previous iteration's commit** in the standard views, at High and Medium (measure-perf `ab.mjs`, both as builds from disk).
- **A live walk with Auto** (`walk.mjs`).
- **The cost of each new feature.**
- **Memory and uploads** if they could have changed.

## 5. Document it

- **Fill the notes table:** what changed for each note, in plain words, specific enough to check.
- **`### Measured (iteration N)`:** the tables (views × builds, ms a frame, at what resolution), the walk, memory.
- **`### Trades (iteration N)`:** what was traded, or "nothing in the look". Kai has asked "did you change anything about the rendering quality in this pass?"
- **`### Known issues`:** what is still wrong or unmeasured (no real phone, for example).
- **ARCHITECTURE.md:** update it wherever the design changed (it is the design as built).
- **Checkpoint images:** `docs/checkpoints/iteration-N/`, JPEG, named for what they show.
- **Commit:** "Iteration N: notes answered, measured and documented".
- **Memory:** put any new standing preference from Kai's notes in memory meadow-aesthetic as "After iteration N", or in a feedback memory for a working rule. Don't save the task list.

## 6. Publish it

Use publish-page:

1. Publish by commit: `scripts/publish.sh N <sha> --latest`.
2. Verify the live bundle.
3. Add the Versions table row.
4. Commit "Iteration N published: versions table".
5. Push when Kai has asked to.

## 7. Report, then stop

Kai reads the report on a phone as often as at the desk, so lead with what Kai can open:

1. The page links: the iteration's own page and the latest.
2. Per note, in Kai's terms: what changed, and what the eye will see.
3. The measured table (A/B against the last iteration), and what it means in plain words.
4. Trades, and anything flagged: a raised test limit, a note not done and why, an unmeasured risk.
5. What is still off or still open.

Then stop for Kai's review. Don't start the next round's work on your own; propose it.

## SHAs

Main was rewritten on 2026-10-30 to strip attribution trailers. Any SHA from before then, out of an old transcript or a Vercel deployment's git info, is stale. Map it with `.git/trailer-strip-map.txt` before citing it.
