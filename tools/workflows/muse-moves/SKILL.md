---
name: muse-moves
description: Make or change what Muse (the cream plush in Muse's Garden) does. Covers its poses, moves, expressions, props, taps and holds, and its pastimes in the lab and on the planet, through the closed-form rig (museRig.ts), the lab's day and stage (museLife.ts, museStage.ts, museLab.ts), its life on the planet (museRoam.ts) and the meadow's props (museProps.ts). Use whenever Kai asks for a new interaction, activity or reaction for Muse, or says a pose or animation looks wrong (clipping, a bent wrist, falling back, flapping, robotic, too repetitive, too short, not cute). Also use before touching any of those files. It holds Kai's standing notes on Muse and the lab-first workflow he expects.
---

# Muse's moves

Muse is a closed-form character. Every pose is a pure function of time and a seed, with no per-frame state. That's what lets the lab pause, step and seek, lets the meadow freeze time for screenshots and tests, and keeps one Muse on the planet for everyone at a given time. Keep it that way:
- No velocities or flags carried from frame to frame.
- No `Math.random`. Use the seeded `random()` (mulberry32) in museRoam.ts and museLife.ts.
- Variety comes from the seed, drawn when the itinerary is written, never while it plays.

## Where things are

| File | What it holds |
|---|---|
| `src/life/museRig.ts` | The rig. `pose(action)` rests, then adds layers: idle, walk, wave, then each `Move` in `action.moves` (`MoveKind`: bounce, pet, fluff, yawn, idea, love, hopUp, perch, hopDown, plop, sit, rise, lieBack, sleep, wake, fish, water, stir, pocket, and the desk's type, lid, phones, unwind), then arm reaches and correctives. |
| `src/life/museLife.ts` | The lab's ~4-minute day on its stage (lab only). |
| `src/dev/museStage.ts`, `src/dev/museLab.ts` | The lab's stage, with its props and `window.museStage` (seek, frame, tap, hold, letGo). Also the lab page, with its `MOVES` table for looping a move on the spot. |
| `src/life/museRoam.ts` | Its life on the planet: outings written as segments by builders (stand, turn, go, walkPath, hop, pour, shuffle, stroll, can), places, durations, routes, `RoamCues` for the props, and `Answers` for taps and holds. |
| `src/life/museProps.ts` | The meadow's props: stove, can, rod with line, float and fish, ladle, and the motes atlas (Z, ♥, ♪, puff, drop, bubble). They're driven by the cues and by the rig's beat functions. |
| `src/life/museEmotes.ts` | The icon over its head that a move sets on the rig (`rig.emote`): the light bulb of `idea` (unlit, lit, its rays and glow) and the heart of `love`. Drawn from a sheet of its own, so the motes atlas is untouched: on a planet by every world's museProps.ts (`MuseEmotes`, the motes' shaders), in the lab by `SpriteEmotes` (turntable and stage). It draws nothing unless such a move plays. |
| `src/life/muse.ts`, `src/world.ts`, `src/main.ts` | Size (`MUSE_HEIGHT` 1.65 m), drawn/where/home/away, pick, `frameMuse`, and taps and holds (Muse first, only while it is drawn). |
| `src/life/musePress.glsl` | Grass and flowers pressed down where it lies. |
| `src/life/museMesh.ts` `DRESSED`, `src/dev/museLineup.ts` | The muses in clothes: rigged as the sculpts are (fur told from cloth by the paint, joints measured off each, their arms' turns solved to hang and wave as tpose6's), and lined up in the lab, each idling with a habit of its own and answering taps and holds (`Answers`). A move added to the rig plays on them too. `src/life/museDress.ts` dresses Muse's material for one (paint, face, both sides, fit), in the lab, the lineup and on a planet (`Muse.useModel('muse5')`). Rigging a model, or fixing its mesh: muse-rig. |
| `src/dev/invariants/muse*.test.ts` | Tests for the mesh, its life in the lab, and its roaming on the planet. |

Rig building blocks (`museRig.ts`):
- `addTurn`, `addShift` and `addSwell` add to a joint.
- `stretch` squashes (−) or stretches (+) the whole body about its feet, keeping volume.
- `express(k, {eyes, smile, squint, squeeze, blush})` sets the face.
- `emote` holds the icon over its head (a bulb, a heart: how much, its size and turn), set by the move like the face, reset every pose; museEmotes.ts draws it wherever Muse is drawn.
- `fluff` makes the fur stand up in a wave.
- `reachFor(side, x, y, z, joint, amount)` sends a mitten to a point, carried by a joint. The arm is then solved by damped least squares (`solveArm`).
- `posed(joint, …)` gives a point on a joint, for props to follow.
- Timings are exported constants (`FISH`, `COOK`, `GARDEN`, `HOP`, `POCKET`…). Beat functions (`fishBeats`, `gardenBeats`, `cookBeats`, `sleepBeats`, `perchBeats`) keep props in step with the body.
- Scale every layer by its move's weight `k`, so moves ease in and out of each other.

## Kai's standing notes on Muse

Each was a correction. Don't regress them.

- **The face changes by its eyes only.** Use the eye shapes: ∩ happy (`squint` +1), ∪ content (−1), > < squeezed (`squeeze`), blinks and shut eyes (`eyes`), plus blush. Never add mouth shapes: an open laugh and an "o" read badly on the small face plate. Being petted means > < eyes.
- **Petting doesn't squash Muse.** It keeps its full height: a head tilt, > < eyes, blush, hearts, and fur standing up on a longer hold.
- **Arms move because the body moves.** On a bounce the arms are carried by the hops; they don't flap.
- **Tools come from the belly pocket.** A quick, clean dip, and the tool appears in the mitten. Another dip and it's gone. No rummaging jiggle (it looked like scratching its belly) and no tools flying in from the ground.
- **Tools are held arm out**, like its natural, slightly outstretched idle, never bent in toward the middle of the body. The mitten must not clip the handle, and the fur must stay clear of the pot.
- **Small wrists.** Keep the forearm twist within ±0.45. More reads as a bent wrist.
- **Short arms.** Plan reaches within about 0.34 H of the shoulder. Muse can't bring its paws together or reach its cheeks.
- **Sitting** (bench, grass, pier edge): roll the hips back with the legs, and bring the waist and chest back upright over them. Leaning the whole body back reads as about to fall. The legs must not go through the bench.
- **Sleeping:** flattened a little by its weight, legs bent back toward the ground. The grass is pressed only where it lies, never while walking.
- **Organic, not a loop.** Kai rejected watering as "pour, close eyes, sidestep, ×3". Vary counts, lengths, tilts and in-betweens from the seed. Not every catch bites, and the content look happens only sometimes.
- **Long pastimes:** asleep 45–95 s, bench 30–75 s, fishing 3–5 catches, cooking 3–4 tastes, sitting in the grass 15–40 s.
- **Movement:**
  - Walks are smooth curves, with turns that take time by their size. No stopping and turning at corners, no snaps (muse-walks).
  - Muse stays near the hut more often than not.
  - Watering happens anywhere in the meadow, with no flower growing from it.
  - Cooking is only at the hut's hearth, inside, while you visit (the porch stove is gone, Kai 2026-11-01).
  - Into and out of the hut it walks, through the front door, which swings open as it comes (museRoam.ts `comeIn`, `goOut`); it never just appears inside.
  - Fishing is usually off the pier's end, sometimes from a shore.
  - M frames Muse; the camera doesn't follow it.
- **Every pose, in clay, reads as one smooth plush form** from the front, three-quarter, side and back. Get the look right and shown before measuring cost.
- **Make it cute.** When in doubt, choose the reading that is gentler and more plush-like.

## Adding or changing a move

1. **Lab first.** Add the `MoveKind` and its function in museRig.ts, with timing constants and a beat function if props must keep time with it. Add it to museLab.ts's `MOVES` to loop it on the spot. Then put it in the lab's day (museLife.ts), with its props on the stage (museStage.ts).
2. **Look at it** with muse-look:
   - `poses.mjs` at several moments, from four views, in the muse and clay looks.
   - `stage.mjs` and `labtouch.mjs` to see it in context.
   - A video if it moves a lot.
3. **Show Kai** stills or a video, saying how you read any ambiguous note. Wait for his review before putting it on the planet, unless he said to go ahead.
4. **On the planet:**
   - Add an outing or segments in museRoam.ts, drawing durations and variety from the seed.
   - Give props cues (`RoamCues`), and hold them across segments with a `Carry` (see `holdingCan`).
   - Draw the props in museProps.ts.
5. **Test.**
   - Run `npx vitest run src/dev/invariants/museLife.test.ts src/dev/invariants/museRoam.test.ts`, and add an invariant for anything new that must hold.
   - Run muse-walks if routes or durations changed.
   - Film it in the meadow with muse-look (`meadow.mjs`, `video.mjs`, `touch.mjs`) at DPR 1 and 2.
6. **Record it** in PROGRESS.md (the iteration's notes table, or the review round's bullets). Commit by explicit path: other sessions share this folder.
