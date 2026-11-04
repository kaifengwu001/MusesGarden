# rigSculpt, step by step

`rigSculpt(position, normal, uv, index, colourAt, sculpt)` in src/life/museMesh.ts turns a sculpt as made into a `MuseMesh` on Muse's 13-joint skeleton. The steps below run in order. A step marked *dressed* runs only for a muse in clothes (`sculpt.dress`); the original Muse (tpose6) never takes those paths, and must rig byte for byte as before (SKILL.md). Each constant named here has a comment in museMesh.ts saying what it is; all lengths are in H, Muse's height.

## 1. Clean up the mesh

- **Weld.** Copies of a position across the texture's seams become one vertex, with its normal the mean of its copies'.
- **Pieces.** Welded positions joined by triangles form pieces (union-find), each with its own box.
  - **Base sculpts.**
    - The body is the piece that reaches from the feet to the top.
    - The face's plate is the widest piece across in front of the face (`FACE_BOX`).
    - The eyes, mouth and anything else set on the plate (inside its box) are left out, and Muse's painted face goes in their place.
    - Anything else, such as a tail, is the body's.
    - A piece of fewer than `STRAY` (30) vertices is a stray and is dropped.
  - **Dressed.**
    - **Find the face by its eyes** (`faceParts`), not by its size, because a hat is wider than any plate.
    - **No strays:** a flower in a crown is only a few vertices.
    - **Scale** the whole sculpt so its eyes are at `EYES` (0.7666, tpose6's own), and measure its shape in `DRESSED_BOX`, which reaches up to 1.26 for hats and forward for aprons.
    - **Plates are shallow domes,** no deeper than 0.25 H, or a head grown round its plate (11) is taken for one.
- **Paint** (*dressed*). `paintLab` gives each triangle its colour in CIELAB, from the texture.
  - `fusedPlate` picks out a plate grown into the hood (4, 8, 11, 0) by its paint. It grows out from round the eyes across the skin while the paint is not the fur's (further than `PLATE_PAINT`, 12, from it), facing forward, within an oval about the eyes.
  - Distances to the fur's colour count lightness at half (`furDistance`), because the paint's baked shade darkens fur in its creases and under hats without changing its hue.
- **Face openings** (*dressed*). A sculpt may leave its face open: slits where a grown-in plate meets the hood, and eye sockets left empty once its eyes are left out.
  - `faceOpenings` walks the open edges of the face's own piece into loops, cutting loops apart where two meet at one vertex (a pinch).
  - It keeps the openings within `FACE_HOLE`: within 0.3 of the middle across and 0.17 of the eyes' height, in front, and no wider than 0.42.
  - `fillOpening` patches each with its least-area triangulation, a dynamic programme over the loop (Barequet–Sharir).
  - Each patch triangle is the face's where it meets the face, the body's elsewhere.
  - A plate that is a piece of its own sits in the hood's opening, which must stay open: patching it blotched 5's, 6's and 12's faces.
- **The plate ironed.** `ironPlate` sets the plate onto a fitted quartic (`PLATE`), so a mouth carved into the sculpt doesn't show under the paint.
- **Fur and cloth** (*dressed*). `furFromPaint` gives each welded vertex 1 for fur, 0 for cloth:
  - its paint (the area-weighted mean of its triangles') against the fur's at the arms' ends (the mittens are always its own fur), smoothed over the skin, then eased between `dress.fur`'s two thresholds;
  - for a garment of the fur's own colour, the `hem` and `sleeve` rules, which make the hood's piece cloth below a height and in from the cuffs;
  - a piece mostly one or the other (by `whole`) made wholly so.
- **Folds filled.** `fillFolds` thin-plates a sculpt's crumpled small folds (a mitten's thumb notch) and the rings round them (`FOLDS`), because their creases shade dark under the coat. A garment's hems and pleats are left sharp, as made.

## 2. The arms

- **The cut.** `cutArm` cuts each arm out of the body with a min-cut (`minCut`) along its crease.
  - The arm's seeds are out past `cut.arm.x`, between `cut.arm.y`; the body's are in from `cut.body.x`, within its heights and depths (`DRESSED_CUT` for a muse in clothes).
  - An edge costs less the more it folds inward, falling away over `FOLD` degrees, so the cut follows the crease.
  - Seeds set wrong are the commonest fault:
    - a sleeve cut as the body doesn't follow its arm;
    - an arm held forward past the body's depth seeds is cut through its middle and folds into a fin as it rises.
- **The mirror** (`mirrorArm`, tpose6). Tripo's two sides are not mirrors, and Kai sees the difference. So:
  - `mirrorArmPath` re-lays the right arm along the mirror of the left's centreline: sections at \|x\| = c, matched by share of arclength, offsets kept in each centreline's frame (`ARM_PATH`).
  - `mirrorSide` projects the body's whole right side onto the mirrored left surface (`MIRROR`); the face's plate, a piece of its own, is untouched.
  - The right arm is then cut as the left.
- **Measuring** (*dressed*). `measureFit` measures the joints off the sculpt (`armSections`): the arm's centreline and its root.
  - The root is where the cut leaves the arm. For an arm of its own piece (`armPieces`), it is where the arm comes out of what it is set in (its `out`).
  - `solveTurns` then finds the hang and wave turns that aim this arm as tpose6's hang and wave aim (`armAims`), by Nelder–Mead.
  - `hangOut` hangs the arms further out than tpose6's; `sleeves` sets where a cap sleeve starts.
  - `loosePieces` finds the pieces no seed of the cut is on, such as a cuff or a strap, which take their weights from the skin under them.

## 3. Refined and weighed

- **Refined.** `Fine` refines with PN triangles: `refine.body` and `refine.face` subdivisions, the body and the face apart (a face vertex never shares a body's).
  - *Dressed:* texture coordinates are kept per corner, so the mesh can be split along the paint's seams later. Each refined vertex gets its cloth share and the piece it is of.
- **Weights** onto the 13 joints (`JOINT` in museBody.ts):
  - **Arms.** An arm's weight rises from its cut over `ramp`, along the skin (`inward`, `harmonic`, `HARMONIC_ROUNDS`), and is averaged over neighbours (`WEIGHT_ROUNDS`).
  - **Shoulders.** A shoulder (`SHOULDER`) takes a share (0.35) of every arm turn. Round the root, the shoulder carries half the body (`body`), fading over `reach`, and gives way to nothing under the arm (`under`). The skin round the root bends over two joints, not one.
  - **Legs.** The legs (`LEG`) own the feet's ovals, up to the hip over a blend. The legs hang from the root, so the feet stay planted while the body sways.
  - **Mirror.** Where the right side was mirrored, `mirrorMap` and `mirrorWeights` give it the left's weights, with L and R swapped.
  - *Dressed:*
    - **Grown-in plate.** The hood round it turns with the head as the plate does, easing back to its own weights over `HOLD_FACE` (`holdFace`). Otherwise their seam opens as the head tilts back in a yawn or a pet.
    - **Loose pieces** weigh as the skin under them (`underSkin`, `carryWeights`), so a sleeve's cuff goes with the arm in it.
    - **Whole pieces.** Small things of cloth or wood (under `RIGID` on their longest side) and hats go whole, as the mean of their weights (`rigidPieces`, `wholeWeights`). So does a loose piece mostly on an arm (`onArms`): read from the skin under it, its body-side edge would stay behind and it would stretch round the hanging arm.
    - **Cap sleeves** (`sleeves`). The sleeve and the arm in it turn by how far out they are, the cloth only within `SLEEVE.reach` of the arm's axis, so the fold's two layers move together.

## 4. Skin and coat

- **Colour.** `settleColours` takes the colour from the paint. *Dressed:* cloth is painted from the texture as made (`MUSE_PAINTED`) and kept out of the coat's colour.
- **Creases' shade.** A field (`VOXEL`, `BOX`) shades the creases from the sculpt's own shape.
- **The coat.** The sculpt is the coat's outside, as the references' silhouettes are, so the body is brought in under it by `COAT` (0.026 H) and the fur shells carry it back out (muse.ts `FUR_LENGTH` and `SHELLS`, drawn by muse.vert.glsl).
  - The way in follows normals smoothed over `COAT_SMOOTH` (24) rounds. Along raw normals, a feature smaller than the coat's depth, such as a thumb, turned inside out into a "box".
  - The coat is none on the face's plate, thin where it meets it (`FACE_EDGE`, `ON_FACE`) and at the soles.
  - *Dressed:* only fur is inset; cloth keeps its place.
    - **Pressed fur.** `pressedFur` presses fur under cloth flat (`PRESSED`): a paw in a sleeve, a belly under a vest.
    - **Exact rim.** Along a grown-in plate's rim, the hood's skin is set to the plate's exactly (`VertexGrid`, `RIM_CELL`), or the inset opens a crack. The plate's field finds its rim only to within a voxel or so.
- **The fur's lie.** `combField` gives the strands a smoothed tangent field running down the body and along the arms (`COMB`). The shells slide along it (`COMB_LEAN` in the shader).

## 5. Correctives

- **Arms' roots.** For T- and A-poses, `rootFixes` adds two correctives over the band about each cut (`ROOT`):
  - **hung** (`hang`, `hangNormal`), in rest space through the inverse blended matrix;
  - **raised** (`raise`, `raiseNormal`, `raiseOpen`), in the chest's frame.

  Each is a **thin plate** (`thinPlate`, bi-Laplacian = 0, `FILL`) over a region contiguous along the skin from the cut. `evenOut` then slides the corrected skin along its surface to even out stretch (`EVEN`). It helps a little; the sculpt mattered far more.
- **Shoulders.** The shoulder correctives are weighed by where the upper arm points along the arc hang → as sculpted → wave, fading off it. Weighed by elevation alone, they tore a spike at the armpit when the arm reached forward.
- **Mirrored corrections.** Where the right side was mirrored, it gets the left's corrections (`carryCorrections`, x flipped).
- *Dressed:* `uncorrect` takes the correctives off what shouldn't carry them, and `splitSeams` splits the mesh along the paint's seams for its texture coordinates.
- **The wave's corrective** (`corrective`: the first sculpt, whose arms grew into its sides). `waveCorrective` moves the skin within `RAISE` of the left arm's cut at the top of a wave; the right side mirrors it. `fillSocket` fills that arm's socket first (`SOCKET`).

## 6. What it returns

`position`, `normal`, `index`, `skinIndex` and `skinWeight` (the four largest of the 13 weights), `colour`, `fur`, `comb`, and for T-poses `hang`/`hangNormal` and `raise`/`raiseNormal`/`raiseOpen`. *Dressed:* also `cloth`, `uv`, `features` (`FaceLayout`: eyes, mouth, blush, plate, for `MUSE_FEATURES`) and `fit`. museDress.ts turns these into the material's defines and uniforms. Muses in clothes are drawn on both sides, because an apron or a collar is a single sheet.

## Fitting a new base sculpt (by hand)

tpose6's fit was found as follows. Do the same for a new sculpt that will be the original Muse.

- **Joints on the sculpt's own arm.** The elbow sits at the bend in its centreline. tpose6's arm slopes 19° down, then from x 0.44 its forearm and mitten run about 17° more level.
  - The hang's `fore` undoes that bend (tpose6: −0.3), or the hung arm shows the sculpted bend as an elbow kink.
  - Find the bend from the sections' top and bottom edges: their loops' centroids are too noisy.
- **Hang and wave turns.** `scripts/solve_turns.py` solves them from the arm's rest axis and the directions the references show:
  - reference 1 for the hang, down a little out and forward;
  - reference 6 for the wave, the upper arm up and out, the forearm upright.

  Then scan the directions against the references' silhouettes. tpose6's idle matched reference 1 at IoU 0.962, and its raised arm overlapped reference 6 at 0.86.
- **Reach.** A wave may stretch the forearm, but only while raised (`wave.reach`, tpose6 0.04), because reference 6's arm is longer. Lengthening the arm for idle cost reference 1's fit.
- **The two arms.** Check them with `scripts/symmetry.sh`. Anything computed per side (min-cut, harmonic ramps, thin plates) comes out uneven on different tessellations, so compute on the left and mirror (`mirrorArm`). Mirroring only near the shoulder, or giving the right arm its own hang turns, each left differences Kai could see.
- **Cost** (tpose6). Rigging takes about 0.6–0.8 s in the worker; close up the body costs +1.6 ms a frame.
