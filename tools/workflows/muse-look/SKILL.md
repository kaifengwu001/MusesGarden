---
name: muse-look
description: See Muse (the cream plush in Muse's Garden) without the Browser pane. Takes headless stills of any moment of its day in the meadow, taps and holds on it, follow-cam videos as mp4 plus contact sheets, and the lab's stage and poses from any angle. Use whenever you need to check how Muse looks or moves, verify a rig, animation, interaction or prop change, reproduce something Kai saw, or make review images and videos for Kai. That includes a quick "does it look right?" check, because the Browser pane is usually hidden and draws no animation frames.
---

# Seeing Muse

The desktop Browser pane is usually hidden, so it gets no animation frames and shows a frozen or blank Muse. These scripts drive headless Chromium on the Mac's GPU (ANGLE on Metal) instead, against the dev server, through the hooks the app exposes in dev (`window.__world`, `window.__meadow`, `window.museStage`).

Run them with `node` from anywhere in the repo. Put the output in the session's scratchpad, not the repo. Each script's header comment lists its arguments.

| To see | Script |
|---|---|
| A moment of its day in the meadow, framed by M (as Kai sees it) or by a chosen view | `scripts/meadow.mjs <out> '[["bench",3],["fish",20,1]]'` |
| The names of its day's parts | `scripts/meadow.mjs <out> --list` |
| Tap (wave), second tap (bounce), hold (pet), let go, a tap on the meadow | `scripts/touch.mjs <out> [part] [s] [hold-s]` |
| A follow video of part of its day, as mp4 plus a contact sheet | `scripts/video.mjs <out> "to the bench" 0 26 '{"distance":7.5,"height":3.4,"azimuth":0.35}'` |
| The lab's stage at moments, from any angle | `scripts/stage.mjs <out> '[["bench",3,35,12,2.6]]'` (part, s, round°, up°, distance m) |
| Scripted taps and holds on the lab stage, frame by frame | `scripts/labtouch.mjs <out> nap 5 '[["tap",0],["shot",0.6,"a"]]'` |
| Poses and moves on the spot in the lab, in clay or as a heat map | `scripts/poses.mjs <out> '[["pet",2],["sit",3,"persp:35"]]' tpose6 clay` |
| Many lab stills at once, each its own model, pose, view and look (every muse, before and after) | `scripts/batch.mjs <out> '[["muse1","idle",2,"front","kind"],["tpose6","hang",0,"turn:30","clay"]]'` |
| All the muses in two rows (`museLab.html#lineup=1`): taps, holds, stills or a film | `scripts/lineup.mjs <out> '[["tap","tpose6",1.2],["hold","muse5",2],["shot","pet"],["letgo",1]]' [--video]` |
| Momo at its desk (`museLab.html#desk=1`), the demo film, rendered frame by frame with motion blur | `scripts/desk.mjs out.mp4 1920 1080 30 16` (`'&beats=…'`, `'&hi=0'`, `'&cam=…'` for other timings and views) |
| The muses' parade (`museLab.html#parade=1`): every muse in turn on match cuts, walking then waving, the camera once round (7 s) | `scripts/parade.mjs out.mp4 1920 1080 30 16` (`'&order=…'`, `'&length=…'`, `'&wave=…'`, `'&ease=…'`, `'&look=0'`, `'&cam=…'`; `STILLS=<dir>` for pngs) |
| A labelled contact sheet of any stills | `python3 scripts/sheet.py out.png 4 a.png b.png …` |

## The server

The scripts use `$BASE`, else `:5198` (where the dev server usually runs), else `:5173` (launch.json's "meadow"). If none answers, start this session's own server with `preview_start {name: "meadow"}`. From a worktree, point `BASE` at that worktree's own server, or you'll be filming main's code.

Several sessions share this folder and its dev server, and Vite reloads on every edit. If a page never gets ready, read the script's `ERRORS` line first. A half-made edit, yours or another session's, is the usual cause.

## Muse's day is seekable

On the planet, `museRoam.ts` writes a seeded itinerary of parts. The scripts write it 3 hours ahead (`HOURS`) and `seek` straight to "part, s into it". So any moment can be filmed again exactly, and the nth occurrence of a part picks a different instance (another spot, another catch). The parts at seed 412:

- Walks: `wander`, `walk`, `stroll`, `turn`, `home`, `to the bench`, `to the pier`, `to the shore`, `to water`, `to a nap`; visiting its hut (after a knock: `__garden.hut()`): `to greet you`, `to the hearth`, `to bed`, `out`
- Pastimes: `look about`, `plop`, `sit`, `rise`, `rest`, `hopUp`, `bench`, `hopDown`, `fish`, `can out`, `pour`, `shuffle`, `can away`, `yawn`, `lie back`, `nap`, `wake`; in its hut: `greet`, `cook`, `into bed`, `asleep`, `out of bed`

`to the shore` is rare, about twice in 3 hours. Run `--list` if names change.

The lab's stage (`museLab.html#model=tpose6&live=1`) is a separate ~4-minute day on a round lawn (`museLife.ts`). `stage.mjs --list` prints its parts.

The muses in clothes (museMesh.ts `DRESSED`) load in the lab as `model=muse0` … `muse12`, so `poses.mjs` and `stage.mjs` take them as their model (`node poses.mjs <out> '[["idle",2,"persp:30"]]' muse5`). `look=kind` colours their fur cream, cloth blue and face pink: check it whenever a muse's fur or clothes look wrong. Their hats reach above the lab's one-muse frame: use a `persp:` or `cam:` view. On the meadow the Body parameter takes them too (`mm=muse5`, drawn as in the lab by `src/life/museDress.ts`): `EXTRA="&mm=muse5" node meadow.mjs <out> '[["bench",3]]'`. To rig a new model or fix a model's mesh (holes, sleeves, arms, the face), use muse-rig.

## What to check, and how

- **A pose, rig or prop change:** look from the front, three-quarter (35–45°), side and back. Kai checks all four, and the right arm differs from the left on this sculpt. Use the clay look too (`look` arg `clay`, or `EXTRA="&look=clay"`): fur hides shape problems. The `rough` look is a heat map that finds bumps.
- **Movement** (walks, turns, transitions between parts): make a video, because stills miss motion. Glitches that last a frame or two are easy to miss even on video. The muse-walks skill scans Muse's heading frame by frame and finds them.
- **Pixel ratio:** stills default to DPR 1, where MSAA is on, like Kai's 1× external screens. Check `DPR=2` too, for the laptop look. Some artifacts show at only one of the two.
- **Far off:** `poses.mjs` with `EXTRA="&size=120"` draws the face as if Muse were far away.
- **Taps and holds in the meadow:** `touch.mjs` uses real mouse events through `main.ts`'s pick, so it also tests that the press reaches Muse and not the meadow.

## Showing Kai

Look at every image yourself (Read the png) before you describe it or send it. Then send the files with SendUserFile. Kai often follows from his phone, and `video.mjs` writes an H.264 mp4 (faststart) that plays there. Use a contact sheet when there are several stills. Say in the caption what each one shows and which build it is.

Sometimes Kai's note has two readings, e.g. "doesn't get squashed" (is it a request or a bug report?). Say which reading you built, so he can correct you.
