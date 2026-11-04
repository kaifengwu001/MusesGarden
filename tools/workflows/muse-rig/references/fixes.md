# What went wrong, and how it was fixed

Every entry was something Kai saw in a review, or that turned up checking for him. Don't regress them. Dates are 2026.

## The original Muse (tpose6), October 30–31

Muse was first a sculpt with its arms grown into its sides (`sculpt`). Then came T-poses (`tpose`, `tpose2`) and an A-pose (`tpose5`), and finally `tpose6`: chunky round arms near a T-pose, 14° below level, 0.19 × 0.18 H, clear of the body with an armpit under each. Kai called it "a big improvement". The model was the biggest lever every time.

| Problem | Why | Fix |
|---|---|---|
| "The poses do not hold up" (Kai rejected "nothing tears" as the bar) | Clay showed lumps at the arms' roots in idle, walk and wave | The bar is one smooth plush form in clay, from four sides, for every pose (SKILL.md) |
| Stretch under a raised arm (about 4× on tpose5) | An A-pose arm swings a long way to wave | tpose6 (about 2× at the 99th percentile); `evenOut` helps a little |
| An elbow kink in the hung arm (Kai, 10-31) | The elbow joint wasn't on the sculpt's own bend, so hanging showed the sculpted bend as a kink | The elbow sits at the bend in the centreline; the hang's `fore` undoes it (−0.3). Find the bend from the sections' edges, not their centroids. |
| "Left arm is perfect, right arm still a bit strange", then "the three quarter view need a bit more fixing" | Tripo's sides aren't mirrors (tpose6's right arm runs steeper and forward, bending 26° to the left's 16°), and anything computed per side comes out uneven | `mirrorArm`: `mirrorArmPath`, `mirrorSide`, and `mirrorMap` for weights and correctives. Compute on the left, mirror to the right. |
| An arm bending inside itself | It turned only partly across its first third | The arm's weight rises from the cut across a short ramp (0.07 H), and the shoulder keeps only the body's share there |
| "Boxes": small bumps (a thumb) turned inside out | The coat was inset along raw normals | Inset along normals smoothed over 24 rounds |
| Dark specks in creases | Crumpled small folds shade dark under the coat | `fillFolds` thin-plates them before refining |
| A spike at the armpit when reaching forward | The shoulder correctives were weighed by elevation alone | Weigh them by where the upper arm points along the hang → as sculpted → wave arc, fading off it |
| A mouth carved into the plate showing under the paint | The sculpt's own features | `ironPlate`: the plate set onto a fitted quartic |
| Eyes as white dots far off (Kai, 10-31) | The glint's soft edge grew outward with distance | Edge kept to ±0.5 px about the rim; glint fades out below a pixel; each eye's darkness capped at 1/soft. Strictly area-true (1/soft²) made far eyes vanish, so it was rejected. Check with the lab's `size=<px>`. |

Tried and dropped:
- a volumetric rebuild;
- projecting onto a fillet union of body and arm fields (it tore into fins);
- delta mush (big smoothing turned the offsets the wrong way: bumps);
- ARAP (compression makes wrinkles, since a plush has no stuffing);
- a thin plate over the region where weights blend (pinned islands left bumps);
- ironing or fur alone;
- giving the right arm its own hang turns, or mirroring only near the shoulder (each left visible differences: a shoulder corner, a dent where two sides' creases mixed).

## The muses in clothes, November 2

Kai's thirteen dressed muses (`DRESSED`, muse0–12), made in Tripo from the concepts he liked. Each one is in tpose6's near T-pose, and is rigged by tpose6's pipeline plus the dressed steps (pipeline.md). All were approved as "acceptable" on November 2.

| Problem | Why | Fix |
|---|---|---|
| A hat taken for the face plate | A hat is wider than a plate | `faceParts` finds the face by its eyes; the sculpt is scaled so its eyes are at tpose6's (0.7666) |
| The fur and the clothes told apart wrongly | The paint has shade baked in: fur under a hat or in a crease is darker, but not another hue | CIELAB distance to the fur's colour at the arms' ends, with lightness at half; thresholds [9, 16]; whole pieces by area (`whole`) |
| A garment the fur's own colour counted as fur (2's linen smock, 6's jacket) | Its colour is the fur's | `hem` (cloth below a height) and `sleeve` (in from the cuffs) on the hood's piece |
| A plate grown into the hood (4, 8) not found as a piece | It is part of the hood's mesh | `fusedPlate`: picked out by its paint (`PLATE_PAINT`) and filled to its oval |
| 6's apron see-through | A single sheet, back faces culled | Muses in clothes are drawn on both sides (museDress.ts) |
| **5's sleeve not following its arm** (Kai) | The sleeve was cut as the body's | Cut with the arm: `DRESSED_CUT(0.33, [0.38, 0.62])` |
| **2's arm detached, a hole in its side** (Kai) | Its arms are pieces of their own set into smock sleeves that run into the body. Each turned at its cut, inside the sleeve. | An arm of its own piece turns where it comes out of what it is set in (`measureFit`'s `out`, `armPieces`) |
| A cuff or strap left behind as the arm hangs | Loose pieces have no cut seed on them | They weigh as the skin under them (`underSkin`, `carryWeights`); mostly on an arm, they go whole with it (`onArms`) |
| Small things (a flute, buttons, a flower) bending | Weighed vertex by vertex | Pieces of cloth or wood under `RIGID` (0.16 H) on their longest side, and hats, go whole |
| Fur poking through clothes | The fur shells grew under cloth | Fur under cloth is pressed flat (`pressedFur`) |
| Cloth painted from the texture needs its own coordinates, which jump at the paint's seams | The welded mesh has one vertex where the texture has two | `splitSeams` splits the mesh along the seams |
| 7's arms in its smock's flare | A wide garment | `hangOut: 0.22` hangs them a little out. Still open: its paw can show through the sleeve. |
| 11's head taken for its plate | Its plate is grown into its head, which is round it back to front | A plate is a shallow dome, no deeper than 0.25 H |
| **10's shoulder looked odd** (Kai) | A cap sleeve (a fold over the arm's top, two layers) cut with the arm split open at the shoulder (a notch, the shirt's inside showing) and swung out as a stiff flap | `dress.sleeves`: the sleeve and the arm turn by how far out they are, the cloth only round the arm's axis; 11 and 12 too |
| **11's hand streaked when raised** (Kai) | Its arms are held forward (to 0.24 H), past the body's depth seeds (0.2): the cut went through each arm, which folded into a fin as it rose | `DRESSED_CUT(0.45, [0, 1], 0.3)` |
| **11's face had a gap** (Kai) | A plate grown into the hood turned with the head while the hood beside it was partly the chest's, so the seam opened as the head tilted back | `holdFace`: the hood round such a plate turns with the head, easing to its own weights over `HOLD_FACE` (4 and 8 too) |
| **Holes under 0's face** (Kai) | Its face is open where it meets the hood (two slits under the cheeks, one along the top), and its eye sockets are empty once its eyes are left out (4's and 11's had some too) | `faceOpenings`/`fillOpening`: each opening of the face's own piece patched with its least-area triangulation, loops cut apart at pinches. Only the face's own piece: patching the hood's opening round a separate plate blotched 5's, 6's and 12's faces. |
| A crack along a grown-in plate's rim | The coat's inset found the plate's rim only to within a voxel | The hood's skin is set to the plate's exactly along its rim (`VertexGrid`) |
| **0's lowered arm odd, could flow better** (Kai) | A puffed sleeve held out as a lump, the arm hanging from under it | Cut with the arm at the shoulder, `DRESSED_CUT(0.28, [0.36, 0.6])`, `ramp: 0.12`: the sleeve hangs down the arm |
| Lineup muses vanished while held | `Answers.attending` is NaN while held | The lineup reads NaN as 1. Still open on the stage and the planet, which only test > 0, so Muse doesn't turn to you while held there. |

Still open:
- 5's sleeve top shows the cream of the apron's strap (painted into its texture, under the strap);
- 7's paw through its sleeve;
- the lab's one-muse frame cuts the tallest hats.

## How each was checked

- **tpose6, byte for byte:** `scripts/t6hash.vitest.ts`, before and after each change (`7417347f…`).
- **Every muse in Node** (`scripts/probe.vitest.ts`), then the dump's open edges (`scripts/holes.py`) for the face patches.
- **Stills:** all thirteen faces before and after every shared change (`batch.mjs`). Only the intended muse moved, but for eye sockets capped under the painted eyes.
- **Kai's views:** front, `persp:35`, side and back; idle, wave, hang and pet; muse, clay and `kind` looks.
- **The lineup:** filmed (`lineup.mjs --video`). Taps and holds work through real mouse events in both rows, at 60 fps at 1600 × 900.
