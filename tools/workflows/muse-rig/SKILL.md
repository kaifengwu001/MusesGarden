---
name: muse-rig
description: Rig, dress and fix Muse models in Muse's Garden. That means the original cream plush (tpose6, the meadow's Muse and Momo's body) and the muses in clothes (muse0–12). Covers taking a sculpt (a Tripo GLB) onto the 13-joint skeleton in museMesh.ts (rigSculpt, SCULPTS, DRESSED): measuring it, cutting out its arms, weights and correctives, the coat of fur, swapping in Muse's painted face, telling fur from cloth by the paint, and putting it in the lab and the lineup. It also lists every fix Kai's reviews asked for and what failed. Use whenever Kai sends new Muse models or concepts to prepare, rig, face-swap, fur or animate, or asks for a muse in the lab or the lineup. Also use when he says a model looks wrong: a hole or gap at the face, a sleeve that doesn't follow its arm, an arm detached from its side, an odd shoulder, streaks or a fin on a raised hand, clothes that vanish or grow fur, bumps, kinks, or arms that differ. Use it before changing museMesh.ts at all.
---

# Rigging Muse models

Muse's GLBs carry no rig. Each one is a sculpt made in Tripo, and `rigSculpt` (src/life/museMesh.ts) rigs it every time it loads, in a worker (about 0.7 s for tpose6, 2–5 s for a muse in clothes). It does the following:
- welds the mesh and finds its face;
- cuts the arms out along their creases;
- weighs the skin onto a 13-joint skeleton;
- adds correctives and a combed coat of fur;
- for a muse in clothes, tells its fur from its clothes by the paint.

Everything particular to one sculpt is in its entry in `SCULPTS` or `DRESSED`. The pipeline, step by step, is in references/pipeline.md. Everything that went wrong and how it was fixed is in references/fixes.md.

## First: the original Muse stays as it is

tpose6 is the meadow's Muse and Momo's body (the first planet's rules: docs/development-guidelines.md). Every change to museMesh.ts must leave tpose6 rigging **byte for byte** as before:
- **Hash it.** Run `scripts/t6hash.vitest.ts` before you change anything and again after; the two hashes must match. It is `7417347f…` from 0a177a8 to at least 2026-11-03.
- **Keep fixes off the shared path.** Put a fix for the muses in clothes behind `sculpt.dress` or one of their own options.
- **Check the other muses.** When shared code changes for one muse in clothes, render every other muse before and after (muse-look's `batch.mjs`) and check that only the intended ones moved.

## Where things are

| File | What it holds |
|---|---|
| `src/life/museMesh.ts` | `rigSculpt`; `SCULPTS` (sculpt, tpose, tpose2, tpose5, tpose6) and `DRESSED` (muse0–12), with the `Sculpt` and `Dress` options; the constants, each with a comment saying what it is (in H, Muse's height). |
| `src/life/museSculptLoader.ts` | `loadSculpt(kind)`: a GLB's arrays and paint. `SCULPT_URLS`, `DRESSED_URLS`: a new model needs its URL here. |
| `src/life/museSculpt.worker.ts` | Runs `rigSculpt` off the main thread and hands back the arrays. |
| `src/life/museDress.ts` | Dresses Muse's material for a muse in clothes: its paint, face, both sides, fit. Used in the lab, the lineup and on a planet (`Muse.useModel('muse5')`, the Body parameter `mm=`). |
| `src/life/muse.vert.glsl`, `muse.frag.glsl` | Skinning, the hang and raise correctives, the fur shells and their comb, `MUSE_PAINTED` (cloth painted from the texture) and `MUSE_FEATURES` (the painted face, where it was measured). |
| `src/life/museBody.ts` | The skeleton (`JOINT`: root, pelvis, spine, chest, head; upperArm, foreArm, leg and shoulder, L and R) and `MuseFit`: rest joints, bind, hang, wave, the shoulder's share, the hand. |
| `src/dev/museLab.ts`, `src/dev/museLineup.ts` | The lab (`museLab.html#model=…`) and the two rows of muses (`#lineup=1`). |
| `src/dev/invariants/museMesh.test.ts` | The mesh's tests. |
| `src/assets/muse/` | tpose6 and the older sculpts (`sculpt-*.glb`), and the muses in clothes (`muses/museN.glb`). These are runtime assets: committed and pushed. |
| `reference/muse/` (local, gitignored) | Kai's references 1–4 and `6-wave-device.png` (the wave), and the drafts. |
| `~/Downloads/muses/` | Kai's source for the muses in clothes: `models/N.glb`, plus the concepts he liked (`likeed/`) and passed on (`passed/`). He calls them by number ("no5"). |

Work in H, Muse's height, with its feet at 0. +x is Muse's left, +z its front. Every sculpt is scaled so its eyes sit at tpose6's height, 0.7666 H (`EYES`), so a hat reaches above 1.

## Adding a muse in clothes

1. **Look at it** before rigging anything (each script's header has its arguments):
   - `python3 -I scripts/glbinfo.py file.glb <scratch>/museN` lists its pieces (connected parts, with their boxes) and writes `museN-mesh.npz` and its texture for the other scripts.
   - `scripts/splat.py <scratch>/museN out.png 0,45,90,180 pieces` draws each piece in its own colour, without a browser. Note what each thing is:
     - arms of their own, set into sleeves;
     - the face plate, a piece of its own or grown into the hood;
     - paws out of sleeves;
     - cuffs and straps lying loose on top;
     - a hat.
   - `measure.py <prefix>` gives its eyes, plate, arms, legs and fur colour, and the scale that sets its eyes at Muse's height.
   - `arms.py <prefix> <scale>` (that scale) suggests a fit and a cut.
   - `furmap.py <prefix> out.png` shows how fur-like each part is.
   - `regions.py <prefix> 'name:x0,x1,y0,y1,z0,z1;…'` gives a box's median colour.
   - `holes.py <prefix>-mesh.npz` lists its open edges.
2. **Bring it in.** Run `scripts/glbclean.py` on a copy to strip the tool's tag (its generator, `tripo_` names), as upstream's cleanup did. Then copy it to `src/assets/muse/muses/museN.glb`.
3. **Register it:**
   - **museMesh.ts:** a `DRESSED` entry, with a doc comment saying what it wears and what is particular to it. Start from `DRESSED_CUT(0.45)`, `ramp: 0.07`, `refine: { body: 2, face: 2 }`, `corrective: false`, `dress: { fur: [9, 16] }` and tpose6's fit; its own fit is measured off it when it's rigged.
   - **museSculptLoader.ts:** its URL in `DRESSED_URLS`.
   - **museLineup.ts:** a habit in `HABITS`. The lineup holds 14 (two rows of seven), so a fifteenth needs a new layout.
   - **Docs:** the lab's model list (museLab.ts's header) and muse-look's SKILL.md.
4. **Rig it in Node**, in seconds, with no browser: `scripts/probe.vitest.ts` (its header has the commands). It prints how long rigging took, the mesh's size, its share of cloth, its face as measured (eyes, mouth, blush, plate) and its fit (joints, hang and wave turns). If no face is found, its eyes weren't: look at its pieces again.
5. **Look at it in the lab** with muse-look's `batch.mjs`:
   - **Poses:** idle, wave (t 1.2), hang and pet.
   - **Views:** front, `persp:35`, left and back. Hats reach above the lab's one-muse frame, so use `persp:` views.
   - **Looks:** `muse`, `clay` and `kind` (fur cream, cloth blue, face pink).

   Then film the lineup: `lineup.mjs --video`.
6. **Fix** what's wrong with the knobs below. If no knob covers it, add a rule behind a `Dress` option and say why in its comment. The symptoms Kai has seen are in the next table.
7. **Check:**
   - the tpose6 hash;
   - `npx vitest run src/dev/invariants/museMesh.test.ts` and the other `muse*.test.ts`;
   - `npm run check`;
   - every other muse before and after, if you touched shared code.
8. **Show Kai** each new muse from four sides (idle, wave and hang), in the muse and clay looks, then the lineup. Say what is still open.
9. **Record it** in PROGRESS.md's muses-in-clothes section, and commit by explicit path.

## The knobs

| Option | What it does | Set it when |
|---|---|---|
| `cut: DRESSED_CUT(x, y, z)` | Seeds the arms' min-cut. The arm's own seeds are out past `x`, between heights `y`. The body's are in from 0.2, between 0.3 and 0.68 up, and within ±`z` front to back. | **`x`:** where only the arm or its sleeve is that far out (0.28–0.45). **`y`:** narrower where a sleeve or armhole is all that reaches out at some heights (5, 0). **`z`:** arms held forward past the body's seeds (11: 0.3). |
| `ramp` | How far into the arm its weight rises from the cut (H, along the skin). | 0.07 normally; 0.12 for a puffed sleeve cut at the shoulder (0). |
| `dress.fur: [a, b]` | Fur where a vertex's colour is within ΔE `a` of the fur's at the arms' ends, cloth past `b` (CIELAB, lightness at half weight because the paint has shade baked in). | [9, 16] for every muse so far. |
| `dress.hem`, `dress.sleeve` | For a garment the fur's own colour: the hood's piece is cloth below `hem` (height, H) and in from `sleeve` (\|x\|, H). | 2's linen smock (hem 0.59); 6's jacket (0.6, 0.335). |
| `dress.whole` | A piece that is this much fur or cloth by area goes wholly one or the other. | Speckled cloth, shaded paws (6: 0.6). |
| `dress.hangOut` | Hangs the arms this much further out (rad) than tpose6's. | A wide garment's flare (7: 0.22). |
| `dress.sleeves` | Cap sleeves: from this far out (\|x\|, H) to where the arm comes out from under it, the sleeve and the arm in it turn by how far out they are. | A fold of the shirt over the arm's top (10 and 12: 0.25; 11: 0.26). |
| `refine` | PN-triangle subdivisions, body and face. | `{ body: 2, face: 2 }` |
| `fit` | Joints and the hang and wave turns. A muse in clothes has its own measured off it, solved to hang and wave as tpose6's. A new base sculpt's are fitted by hand (`scripts/solve_turns.py`, references/pipeline.md). | |
| `mirrorArm`, `corrective` | Base sculpts only. `mirrorArm` re-lays the right arm along the left's mirror (tpose6). `corrective` adds the wave's corrective for arms grown into the sides (the first sculpt). | |

## What Kai saw, and the fixes

| Kai saw | Why | Fix |
|---|---|---|
| A sleeve not following its arm (no5) | The sleeve was cut as the body's | Cut with the arm: the cut's `x` inside the sleeve's root, `y` round it |
| A hole in the side, the arm detached (no2) | Arms of their own pieces sit in sleeves that run into the body, and each turned at its cut, inside the sleeve | An arm of its own piece turns where it comes out of what it's set in (`measureFit`'s `out`, `armPieces`) |
| An apron see-through (no6) | A single sheet with its back faces culled | Muses in clothes are drawn on both sides (museDress.ts) |
| The head taken for the face plate (no11) | Its plate is grown into its head, which is round it back to front | A plate is a shallow dome, no deeper than 0.25 H |
| An odd shoulder, a notch (no10, no12) | A cap sleeve cut with the arm split its fold at the shoulder and swung out as a flap | `dress.sleeves` |
| Streaks, a fin on a raised hand (no11) | Its arms are held forward (to 0.24 H), past the body's seeds (0.2), so the cut went through the arm | Its cut reaches 0.3 in front |
| A gap at the face as the head tilts (no11; 4 and 8 too) | A plate grown into the hood turned with the head while the hood beside it was partly the chest's | The hood round such a plate turns with the head, easing to its own weights over 0.05 H (`holdFace`) |
| Holes under the face (no0; 4 and 11 too) | The sculpt's own openings (slits where the plate meets the hood) and eye sockets left empty once the eyes are left out | Each opening of the face's own piece is patched before rigging (least-area, loops split at pinches). Along a grown-in plate's rim, the hood's skin is the plate's exactly. |
| A lowered arm that hung oddly (no0) | A puffed sleeve held out as a lump, the arm hanging from under it | Cut with the arm at the shoulder, `ramp` 0.12 |

Still open:
- 7's paw shows through its smock's sleeve as it hangs.
- 5's sleeve top carries the apron strap's cream, painted into its texture.
- The lab's one-muse frame cuts off the tallest hats.

The original Muse's fixes (elbow kink, uneven arms, "boxes", dark specks, the armpit spike, stretch) are in references/fixes.md.

## Kai's bar

- **One plush form.** Every pose, in clay, reads as one smooth plush form from the front, three-quarter, side and back: idle, walk, wave, hang and the moves. Only the creases the references show are allowed. "Nothing tears" is not the standard.
- **Matching arms.** The two arms look alike: he notices when the right one differs.
- **Eyes only.** The face changes by its eyes (muse-moves).
- **Look first.** Get the look right and shown, then measure the cost (measure-perf), at DPR 1 and 2.
- **The sculpt matters most.** tpose6's chunky, round arms, held near a T-pose (14° down) and clear of the body with an armpit under each, were "a big improvement" no rig fix could match. When a model fights the rig, tell Kai what a better one would need.

## Checks and tools

| To | Use |
|---|---|
| Prove tpose6 is unchanged | `scripts/t6hash.vitest.ts`, before and after |
| Rig muses in Node: time, cloth, face, fit; dump the rigged mesh | `scripts/probe.vitest.ts`, with `scripts/paint.py` for the paint |
| Find holes and slits | `scripts/holes.py`, on glbinfo's npz (as made) or on the probe's dump (as rigged; a garment's hem and a hat's rim are open too) |
| Compare the two arms | `scripts/symmetry.sh <out> [model]` |
| Take many lab stills at once (every muse, before and after) | muse-look `scripts/batch.mjs` |
| See one muse's poses, the lineup, a film | muse-look `poses.mjs`, `lineup.mjs` |
| Find bumps | the lab's `rough` look (a heat map of normal deviation) |
| Find the turns that aim a new sculpt's arms | `scripts/solve_turns.py` |

The lab's hash keys:

| Key | Values |
|---|---|
| `model` | `sculpt`, `tpose`, `tpose2`, `tpose5`, `tpose6`, `muse0`…`muse12` |
| `look` | muse, clay, facet, rough, stretch, weights, raw, rawclay, kind |
| `pose` | idle, walk, wave, day, hang, and the lab's `MOVES` |
| `view` | front, left, right, back, `turn:<deg>`, `persp:<deg>`, `cam:` |
| Others | `t`, `size` (the face as if far off), `wire=1`, `raise=0`, `comb=0`, `skin=dqs`, `hang=z,x`, `wave=z,fore[,x,y]`, `reach=`, `live=1`, `lineup=1` |

Live keys: 1–4 and 0 set the pose, space pauses, ← and → step, F C T R S W K switch the look, X shows the wire and B the bones.

## What failed (don't retry)

- **On the original Muse:**
  - a volumetric rebuild;
  - projecting onto a fillet union of the body's and arms' fields (fins);
  - delta mush (bumps);
  - ARAP (wrinkles: a plush has no stuffing to resist);
  - a thin plate over the region where weights blend (bumps at pinned islands);
  - ironing or fur alone.
- **Computing each side on its own:** uneven tessellations make the two arms differ. Compute on the left and mirror.
- **Weighing the shoulder correctives by the arm's elevation alone:** it tore a spike at the armpit when the arm reached forward.
- **Finding the face by size:** a hat is wider. Find it by its eyes.
- **Patching every opening round the face:** a plate of its own sits in the hood's opening, and patching it blotched 5's, 6's and 12's faces.
- **Cutting a cap sleeve with the arm:** its fold split at the shoulder.
