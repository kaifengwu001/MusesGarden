# Progress

The plan and the growth model are in [ARCHITECTURE.md](ARCHITECTURE.md). This
file tracks what is done, what is known to be wrong or missing, and what comes
next. Each iteration has its own page, kept for comparison (Versions).

## Versions

| Iteration | Page | Commit |
|---|---|---|
| 17 | https://muses-garden-iteration-17.vercel.app | 0924020 |
| 15 | https://muses-garden-iteration-15.vercel.app | 74926b7 |
| 14 | https://muses-garden-iteration-14.vercel.app | 89b493a |
| 13 | https://muses-garden-iteration-13.vercel.app | d5107a0 |
| 12 | https://muses-garden-iteration-12.vercel.app | 9ad20e4 |
| 11 | https://muses-garden-iteration-11.vercel.app | 15b7dbb |
| 10 | https://muses-garden-iteration-10.vercel.app | aadae30 |
| 9 | https://muses-garden-iteration-9.vercel.app | 8bfde67 |
| 8 | https://muses-garden-iteration-8.vercel.app | a76417f |
| 7 | https://muses-garden-iteration-7.vercel.app | 1ca0327 |
| 6 | https://muses-garden-iteration-6.vercel.app | 3dbb552 |
| 5 | https://garden-of-muse-iteration-5.vercel.app | b1209d0 |
| 4 | https://garden-of-muse-iteration-4.vercel.app | 67a2742 |

The latest is also at https://the-meadow-omega.vercel.app (iteration 17).
Iteration 16 was built in the lab and has no page of its own: it is in 17.
Each iteration is its own Vercel project, so its production address
is public and stays put. `scripts/publish.sh N --latest` publishes the
checkout as iteration N and as the latest; `scripts/publish.sh N <commit>`
publishes an older commit; `scripts/publish.sh latest` publishes the checkout
as the latest alone (a fix between iterations).

## The terraces: a second planet (in progress)

### Kai's notes on the planet's paddies against the lab

Started from aeeb0c7 (gaps and flats). Kai (2026-11-01), sending the aerial, the lab from above and the lab's block side by side; this table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | "Why has there been such a degradation to the paddies since the lab?" | |
| 2 | "Where is the field? It's so mangled with the paddies I can't even tell which one is which. Why are they colliding and criss-crossing?" | |

### Gaps and flats

Started from 4e936ca (the mathematical planet). Kai (2026-11-01), asked what the next round should take on: "Gaps and flats first". This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | The gaps: none against a red sky from any side (the last round left 66 pixels in 4 of 30 views, slits where bank ends meet along skylines) | Most came from the paint, not the build: the floors' shader raised each paddy's surface by its water (6–16 cm, the old world's crop model), while the lab's dams stand 9–17 cm and a riser's top is at 82 % of its dam, so a deep-flooded paddy's water stood over its own dam, open under it, and two paddies of a band either side of a cut stood at different heights with nothing between. The floors now stay at their band's level, as the lab's do; the water is a look of the paint. The rest: the flats' fields were each one floor at their ground's mean, walls of a meter and more between them and the bunds' crests short of the higher field (note 2); every bund's feet now reach the lowest floor either side; open banks and ridges are carried 8–10 cm past their ends; the woods' earth bank is 0.6 m wide, burying the banks' ends carried into it. The gap test is reproducible now (each view set in full from the default stand: the last round's drifted with the camera's last focus) and runs 80 views, eight stands by heights from 70 m to eye level, tilts up to grazing: 1 pixel of gap in 1 view (a notch where a bank ends against a cross-bank and a flats step), from 401 pixels in 12. A check in the build: every step between two farmed floors has a bank within 12 cm of it (on the planet one point fails, at a corner of the woods; a small planet's invariant: none) |
| 2 | The flats, after Kai's aerial of flat rice fields (long strips along gently curving lines, crossed more widely, each field its own green, thin dark bunds, a pale track winding through), without the trenches the last round left (a field's level floor sunk between the terraces where a flat strip runs along a ridge) | Each field stands at its own band's level, so none is ever more than a step off its ground: no trenches. The strips are the bands themselves, along the lie of the land (6–13 m wide over most of the flats, wider on the flattest), crossed every 32 m, a pale track where a slow noise passes zero; where the ground steps a band on the flats, a riser under a thin dark bund (the aerial's dark lines); each field grown and its own green. The `homestead` view (the village's on the old planet) frames the planet's widest flats. Checkpoints: docs/checkpoints/terraces-5/flats-22m.jpg, flats-40m.jpg, flats-7m.jpg, views-sheet.jpg |

Still open: the flats are few on these hills, and where the ground is flattest their strips (a band each) are wide, so they read more as broad gentle fields than as the aerial's long even strips; the 1-pixel notch; the build's 40 s and 11.8 million triangles (the perf round).

### The paddy lab's terraces brought to the planet

Started from d894754 (the paddy lab's second round). Kai (2026-11-01), on the lab: "Bring it to the planet". This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | Bring the lab's construction to the planet | The lab's construction runs over the whole planet (src/terraces/build/): the same classes, bands, cuts that cascade, shifted banks that curve in at their cuts, pieces parted along the cuts, paddies coloured by stretches, dams, risers, cross-banks, the woods' earth banks and trees, with Kai's settings from the lab's second round. The first port (stopped, note 2) ran it on the old planet's hills; it now runs on the mathematics of notes 3–5. Built once in a worker when the planet is first visited; the old build (labels and meshes) is gone |
| 2 | Kai, stopping the first port (the lab's construction run on a grid over the cube's faces, on the old planet's hills: its slope and the river's edge read off a coarser grid, its crossings interpolated between samples, the old ground's baked mesh and paint left along the river): "it looks like all of our labs work seems to be for nothing and we have gone right back to the old look. the curves and edges are all jagged and messed up" | The jagged edges came from the first port's shortcuts (the slope and the river's edge read off a 1.8 m grid, crossings interpolated between samples) and from the old world's baked ground and paint. Now every outline is found on the field itself (root-found along the arc between two samples, as the lab finds it), every height, slope and normal worked out exactly where it is asked, and nothing of the old world is left: the banks run as smooth curves at every distance (checkpoint math-banks-close.jpg) |
| 3 | "DO NOT measure the planet based on meshes" | Nothing is measured off a mesh or a texture: no bake (the planet's cube maps are gone), no coarse grids, no ground mesh. The slope that sorts the ground is the hills' own gradient (their broader octaves'), worked out exactly; the woods' ground stands at the hills' exact height with normals from their exact gradient; the trees stand on it; the water mirrors the sky without marching a baked ground; the rice reads its floors from the built floors themselves |
| 4 | "REWORK the hill generation with the new logic" | The hills are the lab's (build/field.ts): gradient noise at 260, 80, 28 and 10 m (weights 1, 0.35, 0.1, 0.035; 36 m of relief), read at the point on the sphere in meters, so they wrap round the planet with no seam; their gradient exact from each octave's own. The terrace field, each level's wander and the smoothed slope are the lab's, on the sphere |
| 5 | "ABANDON the old planet world segmentation and adopt a purely mathematic method for calculating this. Then, the hills can be derived from the mathematics then." | The old world is gone: its fields and bakes, cells, plots, the ground mesh sunk under the build and its paint, the river and its valley, the villages and houses, the karst towers, the birds, the valley fog, the vista search, the old terraces lab (4,100 lines). The land is sorted by the mathematics alone (the slope: woods, flats, terraces) and the hills are derived from it: where it is too steep to terrace, the woods' ground is the hills' height itself, with trees. Kai's models (the towers and houses) and the river and fog are not on the new planet yet: they come back as mathematics on these hills |
| 6 | Kai, mid-round, with a reference (an aerial of flat rice fields, sent in chat): "flat field paddies can use this as reference" (long strips along gently curving lines, crossed more widely; each field its own green, yellow-green to deep; thin dark bunds between; a pale dirt track winding through) | First step: the flats are long strips 9 m wide bending gently (±0.8 of a strip over 45 m), crossed every 32 m, a pale track where a slow noise passes zero, each field grown and its own green, thin dark bunds between. Not right yet: on this hillside the flats are few and narrow, and where a strip runs along a ridge a field spans more than a metre of ground, so its level floor lies as a trench between the terraces (see Still open) |

Also this round: the build's numbers on the planet (R 128, a grid 0.45 m apart): 2.4 million samples, 80 levels, 12,980 paddies, 12,777 cuts, 153 fields, 511 trees, 11.6 million triangles; 37–39 s in its worker in Chrome. Frozen frame times (1440 × 900, DPR 1, High): orbit 19 ms, 70 m 14 ms, standing 8 ms. Against a red sky (sky, trees and rice hidden) from 30 views at heights from 70 m down to eye level: 66 pixels of gap in 4 of them (thin slits where bank ends meet, along skylines). Invariants (src/dev/invariants/terraces.test.ts): the field's gradient against centimetre differences, every outline's point on its level's field, a small planet's build. `dbg=land` colours the terraces' parts flat. Checkpoints: docs/checkpoints/terraces-4/math-70m.jpg, math-25m-across.jpg, math-banks-close.jpg, math-woods-edge.jpg, math-views-sheet.jpg.

Still open: the build takes 37–39 s (one worker; it splits by cube face for several, a perf round); 11.6 million triangles, about 430 MB of buffers (the perf round: lighter vertices, 16-bit indices); the 66 pixels of gap; the flats (above); the woods are few on these hills (511 trees: only the steepest slopes pass 0.3); the vista is a fixed view, not yet searched for; the river, towers, houses, birds and fog are not yet back.

### Kai's paddy lab, second round: organic banks, cuts, and the slope deciding

Started from 6b58cd8 (the paddy lab). Kai (2026-11-01), with two references (kept out of git: reference/terraces/paddy-aerial.jpg, an aerial of terraces by colour; reference/terraces/paddy-yuanyang.jpg, Yuanyang's flooded terraces); this table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | The noise on the bank offset is applied to different points on the same bank, so the banks look more organic | Each level now wanders on its own (a stretch of Perlin noise of its own, ±0.4 of a step over 9 m), on top of the slow wander all levels share: a bank offsets in and out along its length independently of the banks above and below, so a band swells, thins and pinches out where two banks meet (there the band above meets the band below, one riser down two levels) |
| 2 | The paddy bank height and the level difference are a bit too high | The step 0.5 → 0.38 m and the dam 0.2 → 0.13 m (± 0.04): a riser climbs about half a metre to the dam's top, where it climbed 0.7 |
| 3 | The slope decides: too steep, trees; too flat, regular rice farmland; terraces between | The slope, smoothed (the broader octaves' gradient, wandering a little at the edges), sorts the ground: above 0.3 the woods (the height map's own ground, trees on it, a bank of earth where they meet the paddies), below 0.06 the flats (plain plots on a warped lattice, each level at a band's level, bunds between), terraces between. A patch of woods under 60 m² or of plots under 400 m² is terraced like the land round it, so no drum of plots stands on a hilltop. All three thresholds are on the panel |
| 4 | Next step: cuts that blend naturally into the banks. Paddies on the same level: instead of one precise line at a precise height cut up, the banks offset in and out organically and curve in at the cuts to complete a paddy; cuts tend to cascade across levels (study the reference) | Cuts are placed along each bank 7–20 m apart, and each cascades: it follows the fall line to the next bank, up and down, band after band (a 75 % chance each band, drifting ±0.5 m along the bank). Each paddy's bank sits in or out of its neighbour's by up to 0.45 of a step, swinging from one to the other over 1.2 m, so at a cut the bank jogs and the outer paddy's corner curves in to the cut that completes it. A cross-bank runs up the band from inside the bank's dam to the next riser, along the fall line; the floors are parted exactly along it, and each paddy is coloured as its own: its state drawn from a slow noise at its middle, so the colour changes by stretches of hillside across many bands as in the aerial, with one paddy in seven its own. The colours are measured from the aerial (flooded near white with a touch of lilac, the greens deep). Checkpoints: docs/checkpoints/terraces-3/lab2-overview-top-reference.jpg, lab2-cuts-close.jpg |

Also this round: the lab's default ground is a hillside (Perlin noise at 260, 80, 28 and 10 m, 36 m of relief) so its bands run long and parallel as in the aerial; the rolling ground it had is a panel setting away. A hash that gave numbers in −½…½ instead of 0…1 had made half the paddies white and pushed every bank inward; fixed. Checked against a red sky from above and from low angles on four settings: not a pixel of gap. The banks' nearest-point search goes ring by ring (the same result; a rebuild 4.1 → 2.9 s).

Still open in the lab: a rebuild takes about 3 s (most of it the shifted banks' nearest-point lookups); the flats' plots and the woods have not been studied against a reference yet; the lab's light is plain three.js, its look not the planet's.

### Kai's paddy lab: the terraces from a clean plate

Started from c14319c. Kai (2026-11-01), stopping the sixth round's build (a band squeezed between two woods had been cleaned into a 1.7 m cliff drawn as a staircase): "Start a clean plate paddie lab page. There, create a flat canvas. Use perlin noise at several scales to create a mathematical height map. Then, terrace the map by intersecting at height intervals (regular +- a noise offset) and finding the outlines, offsetting the outlines by the dam thickness (again, base value + variable noise), then extruding / building the dams that way. Finally, fill in the top surfaces." This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | A clean-plate paddy lab page with a flat canvas | `src/dev/paddyLab.html` (on the terraces' server: http://localhost:5197/src/dev/paddyLab.html): a 90 m square block of land, its code all its own in `src/dev/paddyLab/` (nothing from the planet), every parameter on its panel, rebuilt in about 0.4 s |
| 2 | A mathematical height map: Perlin noise at several scales | Four octaves of 2D Perlin noise (70, 32, 15 and 7 m; weights 1, 0.45, 0.18, 0.06), 20 m of relief, with its exact gradient (`noise.ts`, `field.ts`) |
| 3 | Terrace it: intersect at height intervals (regular ± a noise offset) and find the outlines | Levels every 0.5 m, each moved by up to ±15 % of a step, the cut wandering off the height by a slow noise (±0.35 of a step over 14 m). The outlines traced on a 0.3 m grid, each square split into four triangles round its sampled middle (so no square is ambiguous), every crossing found on the field itself and shared by the triangles either side (`contours.ts`). A ring under 12 m² is levelled into the band round it (no little round paddies) |
| 4 | Offset the outlines by the dam thickness (a base value + variable noise) | Each outline evened out to points 0.12 m apart and laid back on its level, then offset uphill by 0.34 ± 0.1 m (a noise over 7 m), kept within 45 % of its band, inside its bends, below the next level's outline and short of a crest (`build.ts`) |
| 5 | Extrude and build the dams from them | A rounded dam (0.2 ± 0.05 m over its floor) swept between each outline and its offset; a riser leaning back 0.3 from the floor below up to the dam's outer edge; where the block's edge cuts a dam, its section closed |
| 6 | Fill in the top surfaces | Each band's top filled level, halfway between its two levels, from the same crossings as the outlines; the dams' inner faces and the risers' feet reach 5 cm under the water, so nothing between them can open. Against a red sky from above and from low angles, on three seeds and settings (1600 px square): not one pixel of gap |

Still open in the lab: with levels at regular heights, the steepest slopes get bands narrower than a dam, and the dams there crowd into a bundle (the dams are kept within their band, so they never cross); the paddies are coloured a band at a time, and the bands are not yet cut across into paddies.

### Kai's notes on the sixth round: a clean-slate rewrite of the terraces' construction

Started from ead85c4. Kai (2026-11-01), with a screenshot of the flats from above (kept out of git: reference/terraces/kai-notes-broken-geometry.webp): "geometry are still broken. Also some geometry seems to re-construct based on zoom and camera distance, but the re-construction is not perfect, which introduces even more brokenness. The faultlines also still exist. Seems like the code creating the terraces is deeply messy and has a lot of legacy issues. This is not the first time I'm suggesting a clean slate re-write."

| # | Note | What changed |
|---|---|---|
| 1 | The geometry is still broken | |
| 2 | Geometry re-constructs with zoom and camera distance, imperfectly, which breaks it more | |
| 3 | The fault lines still exist | |
| 4 | The terraces' construction needs a clean-slate rewrite | |
| 5 | (added) Kai, mid-round: measure the slope from the height data that drives both the hills and the paddies, not from the mesh (inaccurate and heavy) | |
| 6 | (added) Kai, mid-round: in this world the diameter will not change, so no rebuilds are needed | |

The plan (the causes are in the old design itself, not in its parameters): the terraces were built cell by cell round the camera (every cell's edge a seam: the fault lines), out to 220 m, with the ground's paint drawing a different layout beyond (as the camera moves the built and the painted swap: the re-construction). The new construction builds the whole planet's terraces once from one global grid, never from the camera: (1) the terrain bake read back on every cube face at once, the faces' shared edges made identical; (2) every grid point given a label (a band, a paddy in it, a lens, a plot of the flats, or wild, river, yard), the small rings and slivers merged on the label map; (3) the label map turned into geometry square by square, each crossing point computed once on its grid edge from that edge's two samples, so neighbouring pieces share their vertices exactly (floors, risers, bunds, ridges, paths, skirts: watertight by construction, no breaks); (4) every terrace drawn as geometry at every distance, the old paint of terraces retired; rebuilt only when the planet's size changes.

### Kai's notes on the fifth round

Started from 6c6768e (Kai's eight notes on the fourth pass answered). Kai (2026-11-01). This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | There are still numerous geometry glitches when zoomed in | Looked for up close with the terraces alone ([before and after, zoomed](docs/checkpoints/terraces-3/round6-close-before-after.jpg)): the bunds notched at every cell edge, cut ridges stood up as pale ticks against the risers, the risers' grass streaks read as ticks from a distance; all three fixed. Still there: sharp wedges where a lens's wall joins its band's wall, and small islands of woods' ground among the floors that show as dark mounds when the trees are hidden. |
| 2 | The lines on the paddies' edges and cuts are often broken | Each cell's piece of a wall now runs 30 cm on past its edge under its neighbour's (the two last cross-sections at the edge came out turned against each other: a notch); a cut's ridge stops 25 cm short of the walls it runs into. |
| 3 | Some mountains are still floating | Each tower stands under the lowest ground round its foot on three rings out to 0.62 of its height (twelve points each, its stretch counted), sunk 8 % of its height. |
| 4 | The mountains are slightly too tall: perhaps scale them down vertically | Four fifths as tall, their footprints kept (ModelSet's squash). |
| 5 | Groups of mountains look better than a single mountain | Each site a group: the tallest tower at the site, up to three smaller ones (0.42–0.82 of its height) round it, 0.38–0.8 of its height out; half as many sites. |
| 6 | The fog can be deeper vertically, cover a higher range of heights, and be more volumetric; perhaps some of the meadow planet's clouds too | The banks 14 m deep (6.5 before), thinner per meter, white at their tops to a deeper blue-grey low in them, marched in sixteen steps, clear 45 m round the camera. Not done: the meadow's clouds (their shadows, mirror and uniforms are the meadow's own; a piece of work of its own). |
| 7 | The paddies' steps are too coarse: the dams are too tall, the bands too wide, and the cuts too far apart | The step 0.42 m (0.62 before): lower walls, narrower bands; the cuts' pattern 15 m (34 before), about twice as close; lenses where a band passes 4.6–7.2 m. The bunds stay 19 cm over their floor (the water stands up to 16 cm). |

### Kai's notes on the fourth pass

Started from eea900c (the fourth pass: Kai's models, the river, the gentler hills, the watercolour paddies). Kai (2026-11-01): "This has certainly been an improvement. items identified as still off are also correct." Next steps, with a screenshot of the paddies from above (kept out of git: reference/terraces/kai-notes-small-rings.webp). This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | The paddies' geometry can glitch when zoomed in | Found up close and fixed: the rice blades arched out over the bunds, risers and paths in a hairy fringe (a blade now grows only where its floor reaches a quarter meter out every way); a cut's ridge stood up to the next band's floor where it met a wall, a pale post (it keeps to its own band's floors now). Whether these were the glitches Kai saw is to confirm ([at 40 m](docs/checkpoints/terraces-3/round5-paddies-40m.jpg)). |
| 2 | Some mountains are floating or have gaps at the bottom: move them lower | Each tower stands under the lowest ground round its foot (sampled on two rings out to near half its height), 5 % of its height lower still. |
| 3 | Too many houses, too dispersed: villages should group closer together, and houses certainly shouldn't sit on rivers | Fewer villages (a site per 15000 m², at most 8), 3–6 houses each, huddled (their yards meeting); a house only where its middle and every corner of its yard are off the river and out of the woods. |
| 4 | The cuts in the bands are not simply a curve across: observe the references for how a cut takes part in the shape of the banks | A cut leaves its lower bank along it, sweeps across the band and runs into the upper bank along it a band's width or two on, so a paddy ends in a long point on one side and a rounded shoulder on the other, as the paddies' ends do in the references. |
| 5 | Odd small circle paddies (the screenshot): those should just merge with the larger paddies | A bump or dip whose ring would enclose under 300 m² is levelled into the band round it before the walls are traced, and a small closed lens is dropped. Some larger rings remain where the ring meets the woods or a cell's edge (Known issues). |
| 6 | The fog needs to be thicker and more volumetric | The valley fog's banks stand 6.5 m tall (2.8 before), denser, their tops softer, fewer and more separate (so the paddies show between them from above), marched in twelve steps. |
| 7 | In wander mode distant mountains shouldn't become fully white: their peaks should keep their colour, a gradient; close-by mountains look good | On the towers the haze lies thick low down and thin up high (to 40 % of it above 55 m): a far tower's foot fades into the mist, its peak keeps its colour. |
| 8 | A colour pass: deeper greens | The crop's greens a step deeper throughout (fresh #7FA35B, grown #4C7447, lime #9DBA62). |

### Kai's notes on the third pass

Started from 8529225 (the terraces' third pass: the terraces built on the hills). Kai's notes (2026-11-01), with two new references to start from, kept out of git under reference/terraces/: a painting of the valley (valley-painting.webp: karst towers in mist, a river winding between terraced hills, flooded and green paddies in sweeping curves, white houses with dark roofs, a stone-walled path in front) and a painting of the whole planet from above (planet-painting.webp: karst towers round the rim and a few inside, a river looping across it under a bridge, curved terraces in lime, deep green and silver water, villages along winding paths, trees everywhere, the planet in a sea of cloud and far towers); and ten models to use, repeated with rotation: five karst mountains and five houses (reference/terraces/models/, as sent). This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | It is very far from the quality and beauty expected. Isolate the scene's parts and nail each one's design and algorithm before combining them | Each part was worked on alone first: Kai's models in a lab page (src/dev/terracesLab.html: one model on a turntable, as sent or slimmed, either level of detail; [raw against slimmed](docs/checkpoints/terraces-3/models-raw-against-slimmed.jpg)), and on the planet `only=` in the URL shows one part at a time with the rest hidden: the paddies alone from 70 m down to 4.3 m and the vista ([paddies alone](docs/checkpoints/terraces-3/paddies-alone.jpg)); then together ([views](docs/checkpoints/terraces-3/views.jpg), [orbit](docs/checkpoints/terraces-3/orbit-against-planet-painting.jpg)). The river and the paths were judged on the planet with the rest hidden, not in a lab of their own. |
| 2 | The rice paddies are still broken in many places, a childish simplification of the real thing, with none of its dynamism and complexity | Broken: dashes of gap along the cells' edges, where the sunk ground showed through between two cells' floors (each cell read the edge from the bake's texels, and two neighbours could read it differently): near its edge a cell now reads the cells' own geometry, the same function for both ([before and after](docs/checkpoints/terraces-3/cell-edge-gaps-before-after.jpg)). Simplification: gentler hills, so the bands are wide and sweep across the hillsides with lenses where they widen (Kai's paddy painting); lower walls (0.62 m) leaning back and darker, grass in tufts and streaks; thin pale bunds; paths of packed earth along some of them; the crop in rows (seedlings standing on their rows over silver water, a grown crop faintly striped), about half the paddies flooded or just planted. Still not the painting's: see Known issues. |
| 3 | The tall mountains have no texture or character: dumb, simple shapes, very ugly. Use the mountain models, repeated with rotation; they can also be scaled for more variety | Kai's five mountain models stand on the towers' sites (towers.ts), each turned, 26–78 m tall and stretched 0.85–1.2 across, on a low mound of ground with trees round its foot, lit softly over their own painted texture, hazed with distance; full detail within 140 m, a lighter copy beyond. More of them (a site per 1800 m² of range), none in the river. |
| 4 | The planet's composition stretches and squeezes the landscapes, so the view from above is unnatural | The hills were twirled and drawn out along a grain on purpose; now they come round, as they are. One river winds round the planet with its flat valley floor and plots along it, the towers stand round, trees in clumps (the woods' patterns 48 m, not 110), villages on the flats: from orbit it reads as hills, a river and towers ([orbit against the planet painting](docs/checkpoints/terraces-3/orbit-against-planet-painting.jpg)). At R 128: 38 % terraced, 23 % flats, 37 % wild (towers' feet, woods, crowns, gullies), 9 % river. |
| 5 | The colour is muted and uninspiring | The palette is measured from the two paintings, region by region ([swatches](docs/checkpoints/terraces-3/swatches-valley.jpg)): fields in yellow-greens from lime to a deep green (the old ones were a pale teal), silver water, the river bluer, towers blue-grey, trees dark, mist and sky grey-blue. The contrast is the paintings': dark towers and trees against silver water and lime fields. |
| 6 | Use the two new references as the starting points | The palette from both; the planet's layout from the planet painting; the paddies from Kai's paddy painting (row 10). (Its backdrop, a sea of mist with towers standing out of it round the planet from orbit, was built and taken out again: Kai, "no backdrop please".) Not yet: the vista is still framed like the earlier green painting and squinted against it; it is to be searched again for the valley painting. |
| 7 | The houses: use the house models, repeated with rotation | Kai's five house models stand in the villages (houses.ts): each on the floor under it, its front down the valley, 6–9 m tall, a little larger or smaller; the plots keep off its yard and the painted courtyard lies inside it. The old drawn houses are gone. |
| 8 | Only the paddies (on smoother hills and on flatter ground), the rivers and the roads need generating | Paddies on the hills and plots on the flats: the survey as before, with the fixes above. The river: in the bake (its channel, its valley) and the ground's paint (its water, its banks). The roads: paths along a share of the terraces' walls, on stretches a pattern picks (planet-wide, so a path runs on across cells), narrowing to a bund at their ends. Not yet: paths across the bands, along the river and between villages. |
| 9 | (added) Kai, mid-round: the mountains can be scaled for more variety | As row 3: heights 26–78 m (a few tall, many smaller) and a stretch across. |
| 10 | (added) Kai, mid-round: a painting of a planet covered in terraces, "for a better reference of the rice paddies" | Read as: long wide bands sweeping in big curves, many tapering to points, about half flooded silver, half green (seedlings in fine strokes, grown deeper), each band one colour over long stretches, thin pale bunds with a dark line under, pale paths along some bunds. Done from it: the gentler hills (13 m, from 18) so bands are wide, half flooded or just planted at the season's default, thinner paler bunds, the paths. |
| 11 | (added) Kai, mid-round: "no backdrop please" | The backdrop built for row 6 (a sea of mist round the planet from orbit, towers standing out of it) taken out again; the sky as it was. |
| 12 | (added) Kai, mid-round: "Let's iterate the looks first, do the perf profiling later" | The A/B against the third pass was stopped before it finished; no numbers this round (Measured). |
| 13 | (added) Kai, mid-round: "your current paddies look like shitty early 2000s graphics" (with the paddy painting again) | The paddies painted as the painting washes them: each a wash, paler and darker in soft blooms a few meters across, its pigment pooling darker and cooler along its edges, a fine granulation up close; the flooded ones a pale silver wash, the mirror's darks quieter; each band one colour over long stretches (a paddy's stage mostly its band's); the rows in short strokes; softer, lighter greens; pale bunds, a little irregular in width; the risers a soft grey-green that reads as a shadow line from above ([paddies alone](docs/checkpoints/terraces-3/paddies-alone.jpg)). Still too smooth and even beside the painting: Known issues. |

### Kai's notes on the second pass

Started from d9b8f92 (the terraces' second pass: villages, flocks, the squint test). Kai's notes (2026-11-01), with three more references kept out of git under reference/terraces/: an aerial photo of terraces following the contours, white flooded bands among greens (contours-aerial.webp); a painting of flat fields in a patchwork of square-ish plots and roads (flats-painting.webp); a photo of flat rice fields, rectangular plots in many greens, a road winding through (flats-photo.webp). This table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | The algorithm still doesn't imitate the paddies' distribution and shapes well | The terraces are now laid out by surveying the hills (ARCHITECTURE.md, "Terraces built on the hills"): walls are the hills' contours at levels the same over the whole planet, the bands between them long and running on round the hills, cut into paddies now and then, crops alike over whole stretches of hillside (each paddy's place in the season from its level and its place along its wall). From above it reads like the aerial photo: long bands along the contours, white and green in patches ([plan from above](docs/checkpoints/terraces-2/plan-from-above-140m.jpg): walls dark, cuts red, lenses' walls blue). |
| 2 | The paddies are 2D textures, not 3D geometry: too simplified and cartoonish, and water can't stand in paddies at several levels | Every paddy is built as geometry: its floor level at its own height, its water at its own depth over it (6–16 cm, lower as the crop grows), a riser down from it, battered back, a bund along its edge, ridges along the cuts, earth skirts where the land ends. The hills' own mesh is sunk 2.6 m under it all. Built cell by cell round the camera, out to 220 m, a few milliseconds a step; beyond that the ground's paint draws them. |
| 3 | They should follow the mountains' contours with small variations, so the mountains need more detail (noise overlaid at several scales) | The hills have finer octaves over the broad ones (turns of a few meters on the slopes); the walls are the contours of the hills smoothed over a meter, each level a little jittered, so the walls follow every turn of the hill without its grain. |
| 4 | The variations: occasional paddies wider than the others, which then naturally have a taller wall at their end | Now and then a level is left out: a band two levels wide, its wall 1.7 m instead of 0.85. And where the hill is gentle a band no longer grows into a wide river: past 6.5–10 m a lower terrace (a lens) grows inside it along its lower wall, its wall curving back into the band's wall where the band narrows, as the aerial photo's bands taper ([close up](docs/checkpoints/terraces-2/lens-and-cuts-close.jpg)). So the bands are mostly of a width, now and then a wider one with a taller wall. |
| 5 | The breaks between paddies on the same level are not short straight lines across but an organic, round turn | The cuts are gentle arcs (bowed by 6–26 % of their length, either way), the shortest way across their band to its upper wall; they never cross (one meeting another ends on it); their ridges stand wherever they part two paddies. The lenses' walls turn round into the walls. |
| 6 | Paddies exist only above some slope: where it is flat enough for huge areas, the fields break into smaller, square-ish plots (references 12 and 13) | The valleys' flat floors are built as plots: each cell a block of rows 9–16 m wide along its way, cut into plots 1–2.3 rows long, a little askew, each level with the ground under its middle, low bunds over the higher floor, raised roads where blocks meet ([village](docs/checkpoints/terraces-2/views-orbit-70m-4m-1.6m-village-vista.jpg), bottom left). |
| 7 | Villages then stand on those flatter areas | The villages stand on the flats near the foot of the hills, on their courtyards among the plots. |
| 8 | The houses are too simple, cartoonish and repetitive: the next round | Not done: the next round. |
| 9 | The key to the colour: slight variations of green, rice plants of different heights, water tables at different heights | Each paddy its own: a shade of green (lighter, darker, toward jade, lime or blue-green), its plants' height, its water's depth, its place in the season. Seedlings stand sparse in their water (dots on white, as the photo's flooded bands), a grown crop closes over it; the crop's fresh and deep greens lifted to the painting's field values. |
| 10 | Rice plants can be longer blades of grass for now, to save performance | Near the camera (24 m) rice stands as long narrow blades, arching and drooping, each as tall as its paddy's plants and in its colour, fewer where they are young, swaying in the wind; beyond, the paint. They read the built paddies from a map drawn round the focus. |
| 11 | (added) Kai, mid-round: the terraces as objects attached to the hillsides after analysing the hills, not the hill mesh morphed | Done as above: the survey, the meshes, the ground sunk under them. |
| 12 | (added) Kai, mid-round: "what are those weird fault lines?" | The cells' edges: each cell had its own levels, so the walls jogged where cells met. Now the levels, the cuts and the paddies' names are the same over the whole planet and each cell builds only its part, cut exactly at its edge; an invariant test checks two cells trace the same walls up to their edge. Found on the way and fixed: cells reaching past their survey (holes), small cells never built (a hole at R 40), two cells mirrored through the axes sharing a key (built twice), floors overlapping where a wall's level crosses a square diagonally. |

### Measured (the fourth pass)

Not measured yet: Kai asked to iterate the look first and profile later (mid-round). The terraces' views are timed against the third pass (8529225) once the look is settled.

### Trades (the fourth pass)

Nothing in the look traded for performance. Kai's models are simplified (24–36 thousand triangles a mountain, 12 thousand a house: no visible change from the models as sent at the planet's distances, [raw against slimmed](docs/checkpoints/terraces-3/models-raw-against-slimmed.jpg)); their lighter copies (5–7 thousand, 3 thousand), drawn past 140 m (a tower) and 60 m (a house), fold their textures at a few seams, seen only that far off.

### Known issues (the fourth pass)

- **Still too clean beside the paintings** (Kai's "early 2000s"): the paddies' shapes are smooth geometric curves of even width and their washes even; the painting's bands wobble, their edges are soft, their strokes and reflections are richer. The trees are the earlier round lumps, the rice blades near the camera hard-edged. The painterly finish is the next round's main work.
- **Kai's notes on the fourth pass, still open:** rings round a bump that meet the woods or a cell's edge are not levelled (the ring is not closed in the survey); the wander view at 3 m can fog out to white toward the horizon where banks lie across it (the fog is taller now): to check against note 7 in Kai's own walk.
- **The vista and the squint test** are still framed on, and scored against, the earlier green painting recoloured (vista-target.png): the vista is to be searched again for the valley painting, and the squint test pointed at it.
- **The paddies:** a wall's pieces notch where two cells meet (a step of a few centimeters at the joint); the crop's rows read as a regular stripe more than the paintings' short strokes; colour runs along a band for shorter stretches than in Kai's paddy painting; paths only along walls (none across the bands, along the river or between villages); past 220 m the ground's paint draws the terraces without paths.
- **The river** is painted on the ground (no water surface of its own, no bridge, no stone banks); a plain grass bank.
- **The trees** are still the earlier round ones; the paintings' tall dark cypresses and white blossom are not there yet.
- **Kai's models** cast no shadow on the ground (the planet has no shadow maps); a house's own yard can show its edge on a sloping floor.
- **Kai's paddy painting** (sent mid-round) is not yet among the references on disk: the app had not saved it while this round ran.

### Measured (the third pass)

Against the second pass (d9b8f92, as Kai saw it), both as builds from disk, the terraces' views, High at 2880 × 1800 (DPR 2), ms a frame, best of 8 alternating rounds (Medium the same within 0.5 ms); the machine quiet:

| View | Second pass | Now | Δ |
|---|---|---|---|
| Orbit | 13.3 | 22.9 | +9.6 |
| Bird's-eye 70 m | 32.5 | 30.5 | −1.9 |
| Standing 4.3 m | 32.9 | 18.9 | −14.1 |
| Eye level 1.6 m | 20.8 | 12.2 | −8.6 |
| Village | 27.4 | 28.6 | +1.2 |
| Vista (the same pose) | 31.3 | 28.9 | −2.4 |

Close up the frame is cheaper: the per-pixel terraces of the second pass are gone. Far off it costs more: the built terraces' own shading (their water's mirror most) on 0.7 M triangles (1.3 M once the village and vista are built). Before the lossless fixes below the bird's-eye view was 48.3 ms and the vista 47.4.

Lossless fixes, measured at 70 m and the vista: the ground's paint skipped where it lies sunk under the terraces (−7 ms, −7); the terraces drawn before the ground, so early-z skips the sunk ground (−11, −10); the mirror's walls read once a pixel instead of every step of its march (−5, −7); the walls picked directly (−1.5, −1.3). Proved pixel for pixel in six views (orbit, 70 m, 4.3 m, 1.6 m, village, vista): identical but for 2–7 pixels by at most 4 levels (floating-point order in the mirror), 4 pixels where the ground and a wall tie in depth, and under 100 pixels of sunk ground seen through hairline cracks (fogged a little differently).

The live walk with Auto (walk.mjs, the default stand): walk p50 16.7 ms, p99 24.0, 2 frames over 25 ms (second pass: 16.7, 22.7, 0); strafing p99 27.8, 8 over 25 ms (second pass 0); load 53 frames over 25 ms (second pass 21) while the cells build. The render scale settles at 0.50–0.62 (second pass 0.50–0.72).

The build: a cell's survey 10–75 ms and its mesh 4–25 ms, in steps of at most about 10 ms (from 15–21 before splitting them).

Squint (`npm run squint:terraces`; mean ΔE76 per cell over 27 × 48; the goal 10, the test now fails above 19):

| | Overall | Far | Middle | Near |
|---|---|---|---|---|
| Second pass, as Kai saw it | 16.0 | 19.7 | 16.3 | 12.1 |
| This round, first built | 19.3 | 21.1 | 18.9 | 17.7 |
| Now ([sheet](docs/checkpoints/terraces-2/squint.jpg)) | 18.7 | 21.0 | 18.2 | 16.7 |

The meadow is pixel-identical to where this branch began (7d21e88) in all nine standard views, at DPR 2 and 1; its GPU invariants pass.

Checkpoints: docs/checkpoints/terraces-2/ (every view, R 40 and 400 and the far side, the vista, the plan from above, a lens and its cuts up close, the squint sheet).

### Trades (the third pass)

- Nothing in the look traded for performance (the fixes above are lossless but for the few pixels named).
- The squint test's limit raised from 18 to 19, its reason written in the test: the built paddies with standing rice read darker than the second pass's painted dashes over white water.
- The crop's fresh and deep greens lifted a step toward the painting's field values (a look change, for note 9 and the squint).

### Known issues (the third pass)

- The orbit view costs 9.6 ms more than the second pass: the whole hemisphere's built terraces shaded at a few pixels each. A cheaper far shading or meshes in fewer pieces far off would win it back; either changes the look a little far off, so it is Kai's call.
- Building as you strafe and on arrival still makes a few frames over 25 ms.
- Tiny spots of wild land (the woods' noise crossing over for a meter or two) leave dark flecks in the floors, the ground showing through, most at R 400. To fix: clean the land use's small islands on both sides (bake and survey).
- Where a lens's wall meets its band's wall there is now and then a small kink or a stub of bund.
- Two neighbouring cells can still share a key (1024 keys, by chance: about one pair in view); along their shared edge, within a few meters, both build. A float layout bake with more keys would end it.
- Beyond 220 m the ground's paint draws the terraces with the first passes' layout, not the built one: where the built reach ends the pattern changes.
- The vista's top third (the forest's dark crowns against the painting's pale far terraces) is still the worst in the squint.
- The houses: the next round.

### The first and second passes

Started from a20b606 (iteration 17 after Kai's review). Kai's brief
(2026-10-31): a second planet to visit, built on the same procedural
fundamentals as the meadow. Eight reference images came with it, kept out of
git under reference/terraces/: karst peaks in an ink-wash mist over flooded
terraces (1); blue karst islands round a winding river (2); green terraces
in bands of dots and dashes (3); a village among terraces in loose strokes
(4); posterised terraces, flooded bands white and teal among greens (5); a
woodcut of terraces, a plank path and huts (6); a forest canopy from above
with white birds over it (7); layered green hills with white houses and bare
trees (8). This table fills in as each is done.

| # | Note | What changed |
|---|---|---|
| 1 | A second planet that we can visit, using the same procedural fundamental logic | The Travel button (and `pl=terraces` in the URL) visits it: the camera climbs away into a white mist, the other planet takes its place (built and its shaders compiled on the first visit) and the camera comes down to it. Built on the meadow's foundations: rest-space point sets, growth (R 40–400), the bake (planet/bake.ts now takes another planet's shader), CDLOD (planet/surface.ts takes its shaders), the tiny-planet warp, the palette and toon light, picking. Both worlds implement `PlanetWorld` (src/planetWorld.ts); the terraces' own code is in src/terraces/. The meadow renders pixel for pixel as before (0 pixels differ in the vista, cottage and orbit views; its GPU invariants pass). |
| 2 | Hilly terrain, with fog meandering between the mountains | Rolling hills (octaves weighted by their size in meters, twirled) on flat valley floors, and karst towers from a progressive point set (steep, round-topped, on a wide skirt). Fog banks with a soft, level top lie in the valleys (their top 1.6–5.4 m by how thick the bank is), drifting in two layers along the wind; a clearing round the camera; integrated along the view in every material. |
| 3 | Terraced rice paddies | ARCHITECTURE.md, "A hill turned into terraces": the hills cut into levels a riser (0.8 m) apart, each a flat floor with a bund along its outer edge and a riser up at its inner edge; cross-bunds cut each band across, every 9–22 m along the contour's way within cells about 48 m wide, staggered level to level; so every paddy is walled in. The mesh is terraced near the camera, its risers widening with distance so they never saw-tooth; the paint draws them crisp per pixel, filtered over the pixel. |
| 4 | Not all paddies are filled with water and reflective: some are fully grown, green waving rice, some in between, others fully reflective | Each paddy decides its infill from its own chance and a gentle regional lean (so neighbouring bands differ, as in the painting): over the planet at the default season, 34 % flooded (a mirror of the sky, near white, the riser behind it a darker band), 16 % seedlings (dots on the water), 20 % growing (dashes standing toward you, water glinting between), 27 % fully grown (dense dashes), 4 % fallow. Wind waves run over the crop as pale crests and dark troughs. The Bloom slider is the season on this planet (labelled Season): all flooded at 0. |
| 5 | Subtle colour differences from one paddy to another | Each paddy's own shade (lighter, darker, toward jade or yellow-green), and its own tint of water (teal or milky). |
| 6 | Not all hills are covered by paddies: some hillsides are trees | ARCHITECTURE.md, "Land use": forest above, villages below it, terraces down the slopes, the valley floor at the bottom (the Hani order). Wild: the hills' crowns, the gullies, slopes too steep to terrace, the peaks' flanks, and woods (the Woods share). Trees on a rest-space point set wherever the land use is wild: one billboard each, a crown of five lumpy spheres traced per pixel with a painted edge, writing its depth. Villages (Kai's note after the first pass): sites from a point set, kept on gentle ground below a forest edge; 3–9 white houses with dark gable roofs stand on terrace floors, along the contour, courtyards round them. |
| 7 | White flocks of birds circle between the valleys | Seven flocks wheel over valley floors (the meadow's birds' mesh and wingbeat), their loops leaning and drifting, 7–17 m over the floor. |

Kai's notes on the first pass (2026-10-31): "FAR off". Use the green terraces painting (reference/terraces/vista-green.webp) as the vista to squint against, the blue one (colour-blue.png) for colour, and see how the meadow was improved, round after round. Then: first work out the algorithm that turns a hill (a heightfield) into rice paddies, each with a wall round it and a decision on its infill, and a noise algorithm for where the hillsides have paddies, trees and a small village.

How the look was matched (look-dev, as the meadow's):

- **The vista:** found by search (terraces/vista.ts): stands on terraced slopes, a coarse grid of view rays marched through the warp, each hit sorted into forest, open water or crop and compared row by row with the painting's layout, bands crossed per column counted (the painting crosses about one a row), villages and fogged valley floors counted as misses, the best few refined. It stands about 24 m up, low enough that the warp lays the ground out to a far horizon (higher up the small planet curves away and the sky shows, where the painting has none), with the view widened for the portrait frame (`CameraRig.widenFov`, which eases away as a named view's look-up does). About 0.6 s.
- **The target:** the green painting recoloured into the blue painting's colours (its Lab mean and spread matched to the ink painting's), so one squint measures the composition and values of the one and the colours of the other.
- **The palette:** measured from the blue painting (its fields' teal-green, its peaks' ink blue, its mist and paper whites) and set at the values of the target's materials.

Squint (`npm run squint:terraces`; mean ΔE76 per cell over 27 × 48; the goal 10, the test fails above 18):

| | Overall | Lightness only | Far | Middle | Near |
|---|---|---|---|---|---|
| First pass, as Kai saw it (fog everywhere) | 15.1 | 12.6 | 12.5 | 18.4 | 14.5 |
| Now | 16.0 | 11.6 | 19.7 | 16.3 | 12.1 |

(The first pass scored well only because both were pale: its view was a white wall of fog with a peak in it. Against the green painting itself, unrecoloured, the score went from 45.3 to 36.6.) What is still off: the far third, where the painting has paler terraced hills and the vista a dark forest and a fog bank; the near bands are wider than the painting's.

Checkpoints: docs/checkpoints/terraces-1/ (every view, the land use and infill, the village, the birds, R 40 and 400 and the far side, the vista).

Known, not done yet:

- No rice plants up close yet: the near paddies are paint (dots, dashes, the wind's sheen), not plants.
- No clouds, and so no shadows (the birds' included).
- A tap on a paddy stirs the wind, not the water.
- The paddies' cells are chosen per octave of R: growing past an octave re-tiles them; and as the hills rise with growth the terraces move with them.
- Performance not measured yet (the look first). At R 400 the forest's point set is 452k instances (most dropped in the vertex shader); 16.6 ms a frame headless.
- Not merged into main: branch `terraces`; no page published.

## Iteration 17: Muse lives on the planet (in progress)

Started from 86dadbd: iteration 16's interactions, built in the lab, go into
the meadow. Kai's notes (2026-10-31); this table fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | Muse roams the planet at random and starts its activities where it is, more often close to its hut | src/life/museRoam.ts: a life drawn from the planet's seed, outing after outing (wander and look about, sometimes sitting down in the grass; water the plants; the bench; the stove; fishing; a nap; resting on the porch), written out lazily as time runs on and read back by time, so a frozen time still finds one Muse. Places out in the meadow are random, most within 10–20 m of the hut (5 + 60·u³ m), dry, not steep, reachable. Walks go straight over the meadow (never through water or the homestead), up and down the porch steps, along the porch, out along the pier. Tested for an hour of it at R 40, 128 and 400: never in water or the house, no jumps, every pastime done, the same for the same planet and time. |
| 2 | Some things have fixed places, like the bench (the terrace's) | The terrace's bench (props.ts now exports it): it walks up the steps and along the porch, hops up onto it with its back to the house, swings its legs and hums, hops down. |
| 3 | Watering plants anywhere about the meadow, not over a flower bed; no new flower growing, no sniffing it | The watering move is now pour, then a content look (∪ eyes, a small nod), three times, shuffling along to its right between (or its left, or not at all, wherever the ground is dry); the water falls on the grass before it. The lab's flower bed no longer grows or sparkles either. |
| 4 | Cooking on the hut's front porch, at a little stove kept there (for now; later the house gets an inside and a kitchen) | A little iron stove on the porch (in front of the window, by the front edge), its fire glowing through a window in front while Muse cooks (embers otherwise), a pot of soup on top, steam. Muse stands behind it facing out, the ladle out of its pocket, stirring and tasting. |
| 5 | Fishing: usually off the pier's end, sometimes from a shore it has wandered to | Seven times in ten off the pier's front edge: it sits down on the edge with its legs over the water (new: the edge variants of sitting down, fishing and getting up). Otherwise from the home pond's bank, wherever it can be reached dry, sitting in the grass facing the water. The float's landing, the nibbles, the bite and the fish dropped back each make the meadow's own ripple rings. |
| 6 | As in the lab: asleep in the grass (pressing it down only where it lies), taps and holds on Muse | Grass and flowers are pressed down and parted round its body only while it lies (musePress.glsl, read by grass.vert.glsl and flower.vert.glsl). A press on Muse, while it is drawn, is Muse's (main.ts): a tap answers, a hold pets it; double taps on it are taps; the meadow's click, double-click and hold go on everywhere else. While it answers, its life is held back and it turns to you. |
| 7 | M frames Muse, as now (the camera does not follow it) | M frames Muse wherever it is: from in front of it and a little to its left, or at home from out in front of the terrace. World.frameMuse takes another view for checks. |
| 8 | Muse looks a bit small in the meadow: 1.5 times larger | 1.65 m (was 1.1), its fur 6 cm (was 4): the same plush, scaled. Its pace is in its own heights, so it waddles at 0.54 m/s. |

For the garden's interfaces (that session asked): world.muse.where (direction, height, heading, kept current while not drawn), world.muse.home, world.muse.away (not drawn, no shadow, not tappable; its life keeps time).

Kai's review of iteration 17's page (2026-10-31), done:

- **Sudden turns, and turning round and back within a few frames.** Reproduced by scanning its heading frame by frame: every one was in the last frame or two of a walk, where it aimed at the point it was standing on (a direction from nearly nothing, noise), then snapped back as the next turn began. Walks now follow a path and take their heading from it (smoothed over 0.6 m), so this cannot happen. A test checks 20 minutes at 60 frames a second for any turn faster than a half turn on the spot. Turns on the spot now take time by how far they go (0.35 s plus 0.8 s for a half turn), slight ones are taken in its stride, and turning to you when you tap keeps to one side once started.
- **Robotic, rectilinear paths.** It used to stop at every corner, turn on the spot and walk straight on. Now each walk is one smooth path:
  - It turns into the path as it sets off (on the spot first only if it faced well away), and comes round to its facing as it arrives.
  - Corners out on the meadow are wide sweeping curves (up to 5 m either side, checked against water and the homestead); long walks wander off the straight line once or twice.
  - It goes round the house by its corners, so it now goes behind the house and past the pond, where before every outing fanned out to one quarter.
  - On the porch (the most robotic part) the fixed lane is gone. It walks straight across wherever the way is clear of the bench, the stove, the chair and the wall, by a few places round them where not (behind the stove, between it and the house), with rounded corners.
- **Watering, more organic.** Two to four pours, each its own length and tilt, now and then swept over the plants; a content look only sometimes; between pours, a shuffle aside, a turn, a few steps on, or a look about.
- **Longer at each thing.** Asleep 45–95 s, on the bench 30–75 s, fishing 3–5 catches (45–75 s), cooking 3–4 tastes, sitting in the grass 15–40 s, resting on the porch 10–22 s. Each catch has its own timing and is not always lucky: some bites get away, with a little droop.
- **Petting.** It keeps its full height (no squash, the head not squished): the head tilt, > < eyes, blush, hearts and its fur standing up.

Known: the GPU invariant "scrubbing growth in real time stays within the frame budget" fails on this machine now, frame p95 33.4 ms, exactly 30 fps. It fails the same way at 86dadbd, which passed it earlier the same day, so it is the machine (another session's GPU load), not this work. To run again on a quiet machine.


## The garden's interfaces (in progress, alongside iteration 16)

Started from 73de432, in the same folder as iteration 16's work on Muse
(that session builds in the lab; this one adds files of its own and only
hooks into main.ts). Kai's brief (2026-10-31), with the ideas doc (MG1, the
brainstorm with Tracy) and the backend plan as references. Two corrections
to the backend plan: what grows on the planet is only what Muse chose to
keep or gave you in a basket; and finds are not only Instagram reels, but
posts, news articles and the like too.

The look: the clean, elegant interface the meadow already has; the post
box, the postcards and the invitations very skeuomorphic (拟物), physical
models even; in the meadow's painted style, with Travel Frog as the main
reference. Placeholders for the media and posts, used over and over, and
for Muse's postcards screenshots taken in the world of two Muses, one
waving. This table fills in as each is done.

| # | Note | What changed |
|---|---|---|
| 1 | Finds (reels, posts, news articles) in cards above their flower patches. Planted: a small patch blossoms from its centre, then the card pops up | |
| 2 | Browsing: tap a plant or a bed and a line rises, the card pops up; swipe left or right (or the arrow buttons) to the next find, flying round the world; a like button; an example gallery; the hook a backend fills (placeholders for now) | |
| 3 | Pins in the world: liked finds and Muse; toggle them on and off; only in orbit and in view (no off-screen pins) | |
| 4 | Postcards, after Travel Frog: the card's design; an on-screen post box (preferred to Muse's hut for now): tap it, it pops open, a stack of cards, a gallery; one card flies forward to like or put away; a new card on login raises the box's flag, with a notification | |
| 5 | Invitations to other worlds, in the postcard system with a special notification; a button near the post box to travel | |
| 6 | A button to go to Muse's house, showing when Muse is not home | |
| 7 | Baskets: the history as a timeline; tap one to go to its place on the planet | |
| 8 | A button to find Muse and jump to it | |
| 9 | Muse's page: its interests (with sharing and privacy), its friends, tagged when a friend's human is a friend of yours on Instagram or Facebook | |

## Iteration 16: Muse's interactions (in the lab)

Started from iteration 15 (74926b7). Since then Muse has come to the meadow
(e2de5cf, 02a9840, 2fb02be, a7f6349): Tripo3D's sculpt rigged on a
thirteen-joint skeleton, walking the cottage's terrace and waving on a 44 s
day, with a lab (src/dev/museLab.html) that plays it live. Kai's notes for
its interactions, to be built in the lab first ("make it cute!"); this table
fills in as they are done.

| # | Note | What changed |
|---|---|---|
| 1 | Idle: walk around | A stage of its own in the lab (`museLab.html#model=tpose6&live=1`, src/dev/museStage.ts): a round lawn of about 25,000 blades in a pale sky. Muse lives a ~4-minute day on it in closed form (src/life/museLife.ts): it wanders and looks about, then walks between its pastimes (turn, waddle, turn), waving at you on the way out. Keys 1–7 go to each part; the camera follows it (G). |
| 2 | Idle: sit on the bench (port the meadow's bench to the lab) | The meadow's bench (props.ts) in Muse's heights. Muse turns its back to it, crouches and hops up onto the seat's front edge, swings its legs in turns, now and then hums with its eyes shut (notes float up), and hops down. It sits upright: the hips roll back under it with the legs and the waist and chest bring it upright over them, so its bottom sits flat and the legs hang in front of the seat. |
| 3 | Idle: fall asleep in the grass (belly up, a snore bubble, a Zzz sign; push the grass away) | It yawns and stretches, plops down, lies back onto its back, flattened a little by its weight, legs bent back toward the ground, arms out. It breathes slowly (the belly swells), a snore bubble grows and shrinks at its nose, Zzz rise; now and then it stirs. The grass is pressed down and parted round it (its body's spheres push the blades), and its soft shadow falls on the lawn. Then it wakes, sits up, rubs an eye and gets up. A tap while it sleeps pops the bubble and only half wakes it. |
| 4 | Idle: fishing (a fishing rod) | It sits at the pond's edge, takes a rod out of its belly pocket, casts, watches the float, leans in to two nibbles, yanks the bite: the fish flies out on the line and hangs wriggling; it cheers, drops the fish back in (rings on the water) and waves it off; twice, then the rod goes back in the pocket. |
| 5 | Idle: gardening (garden tools) | A flower bed of three sprouts, a trowel in the soil. It takes a watering can out of its pocket and waters each in turn, stepping along: the sprout grows and opens with sparkles, it hops for joy, leans in for a sniff. The flowers close as it naps. |
| 6 | Idle: cooking (a stretch goal; props) | A campfire (stones, logs, flickering flames, a glow) with a pot of soup on a trivet, steam rising. It takes a ladle out of its pocket and stirs, arm held out over the pot, the ladle from its mitten down to the bowl going round in the soup; now and then it tastes (ladle up to its mouth, blown on, sipped), and its fur shivers up with a "yum". |
| 7 | Click: wave | A tap stops whatever it is doing (its day is held back while it answers), turns it to you if it is standing or walking, and it waves (the first time in a while). |
| 8 | Click: a happy bounce up and down, arms flapping | Further taps: three hops with squash and stretch, eyes shut in happy arcs, blushing. The arms are only carried by the hops: pressed down as it lands and springs off, floating up through the flight. |
| 9 | Long hold: petting; the head tilts, the eyes squint | Hold it: the head tilts into your hand (toward where you press) and squishes a little, eyes squeezed shut (> <), blushing, paws up, hearts. Asleep, it smiles in its sleep. |
| 10 | The fur stands up in a wave while it squints, the neck tucks in (it has no neck, so maybe the whole body gets shorter) (a stretch goal) | Held longer than 1.3 s: the whole body scrunches shorter and rounder (the head sinks, the shoulders rise) while the fur stands up in a wave from its feet to its head (longer, standing straight, each tuft its own); let go, it shakes it out and pops back up to its height. Also on its own as a move (`pose=fluff`). |

Kai's review of the first pass (2026-10-31), done:

- No mouth animations (the laugh and the "o" did not look good): the face changes by its eyes alone; the mouth only smiles.
- (> <) eyes while it is petted.
- The arms in the bounce follow the hops instead of flapping on their own.
- On the bench: no legs through the seat; hips in contact, the body upright instead of leaning back as if to fall.
- Asleep: flattened a little by its weight, the legs bent back.
- The watering can no longer through the mitten; cooking: the bent wrist gone (the forearm's twist limited), the pot further off and the arm and ladle reaching out, so the fur clears the pot.
- Tools come out of a belly pocket (the tool appears in the mitten as it comes out) and go back into it after, instead of flying in from the ground.

Kai's second review (2026-10-31), done:

- Walking about leaves the grass standing; only lying down presses a hollow into it (as in his reference of a white creature asleep in long grass). The grass shader's push is scaled by how far Muse is lying (`MuseRig.lying`).
- The can, the rod and the ladle are held with the arm out to the side and forward, as it hangs when idle, not drawn in across the body. The pot and the flowers moved out to match.
- The pocket is a quick dip in and out (0.75 s, the tool there by 0.38 s) with a glance down: no rummaging back and forth, no second paw.

How it is built:

- **Rig** (museRig.ts): the whole body squashes and stretches about its feet (keeping its volume), a joint can swell on its own (a breath, a squished head), and a mitten can be sent to a point: the arm's turns, its elbow and the forearm's twist are solved each frame from the arm as it hangs (damped steps, preferring small turns, the shoulder's share counted). Moves (bounce, pet, fluff, yawn, the hops, sitting, lying, sleeping, waking, fishing, watering, stirring, the pocket) are closed-form functions of their own time.
- **Face**: the squint shuts the eyes into arcs (∩ happy, ∪ content), the squeeze into > <, the blush deepens with strokes. The fur stands up behind a front running up the body (uMuseFluff).
- **Shoulder correctives**: the wave's corrective is now mirrored onto the right shoulder (either arm or both can go up), and each side's hung and raised correctives are weighed by where its upper arm points along the arc from hanging, through the sculpt's own pose, to the top of a wave, giving way off that arc. Reaching forward, half-applied correctives had torn a spike at the armpit.
- **Lab**: `pose=<move>` plays any move on the turntable, `view=cam:…` frames any still, `day=` and `pause=1` hold a moment of the stage, `hide=1` hides Muse to see the grass and shadows round it.

Known: seen exactly from the side, sitting still shows a soft crease where the legs meet the belly (the fur mostly hides it; a sitting corrective like the shoulders' would fix it). The arms are too short to cup its cheeks, so the petting paws come up before its chest. Not yet in the meadow.

## Iteration 15: specks on the blue flowers on 1× screens

Started from iteration 14 (89b493a). The fix below was made after iteration
14 was published (2499967) and reached the latest page alone; Kai asked
(2026-10-31) for it to be published as an iteration of its own, iteration
14's page kept as it was. Iteration 15 is iteration 14 with this fix and
nothing else: the rest is notes and `scripts/publish.sh latest`. Muse, being
built in the same folder, is not in it.

Kai's screen recording (2026-10-30) showed single black pixels, now and then
a hot red or white one, flickering among the small blue flowers on some
external screens. The MacBook's own screen and the ASUS were fine. The specks
were in the frame itself: the recording shows them wherever it is played.

- **Cause:** MSAA, which is on only below DPR 1.75 (1× screens). A pixel
  partly covered by a triangle is shaded once, at its centre, and for a
  sub-pixel triangle the centre can lie outside it. The flowers' colour is
  set per vertex, so it was extrapolated there. A blue floret is a fan of
  four 2.5 cm triangles from a pale centre to blue petals. A white star's
  points run out from a yellow centre and are seen nearly edge-on. In the
  standing view at 1440×900, 47–65 pixels a frame of the scene target were
  negative (down to −23) or far too bright (up to 49). The grade turns them
  into black or hot specks, and the flutter moves them every frame. All of
  them came from the flowers: in that view mostly the white stars, then the
  blue clusters, which go dark navy.
- **Fix:** grass, flowers, petals and birds read their colour at the
  centroid of the covered samples, which lies inside the triangle
  (grass.frag.glsl). No out-of-range pixel is left: the scene's colours span
  0.03–1.09 at 1×, as at 2×.
- **Look:** at DPR 2, the same pixels in 16 views (High and Medium). At 1×
  only pixels on the plants' edges change. In the cottage view 267k pixels
  move by 1–4 levels, 12.6k by more than 4 and 156 by more than 64 (the
  specks).
- **Cost:** none measured. At 1× on High the change is −0.07 to +0.06 ms a
  frame (median of 8 alternating rounds, 7 views).
- **Test:** the invariant "under MSAA no pixel of the scene leaves the range
  of its colours" (`npm run test:gpu`) reads the scene target at DPR 1.
  Without the fix it fails (−6.2).

### Checked (iteration 15)

Built from a clean checkout of the published commit, so Muse's work in
progress stays out.

- **Tests:** `npm run check`, 68 CPU invariants, 12 browser invariants (the
  speck guard among them) and 15 shots, all passing.
- **The pages:** iteration 15's page and the latest serve that build byte
  for byte (`index-pSBoEYqB.js`); iteration 14's page still serves its own
  (`index-6gNr6kW8.js`). Both load at 1× (4× MSAA, High) without errors.
- **Before and after, on the live pages:** the standing view at 1440×900,
  1×, the render scale held at 1, at 8 frozen times. 198–243 pixels a frame
  differ between iteration 14's page and iteration 15's by more than 64
  levels: the specks, single saturated blue, purple, red or yellow pixels,
  most along the far edge of the meadow, where the flowers are smallest
  ([a crop, ×4](docs/checkpoints/iteration-15/specks-before-after.png)).
  2.6–3.2k pixels differ by 5–64 levels, on the plants' edges. Either page
  against itself: no pixel differs by more than 4 levels.
- **Known issues:** as iteration 14's.

## Iteration 14: the review notes

Started from iteration 13 (058b8a1), the notes committed first (a0ff6c2).
Before it Kai asked why the grass loads in slowly and what could be done;
the study is summed up under the table. Kai asked for all of its fixes,
measured, before the next review. Every number below compares production
builds of iteration 13 and 14 in one browser.

| # | Note | What changed |
|---|---|---|
| 1 | Grass loads in chunk by chunk, slowly and distractingly, when flying in from orbit or jumping to a new place; on a phone the chunks can fail to load at all; it got worse from iteration 4 to 5. Make the loading actually faster, even at a slightly higher cost while it loads | Three causes, all fixed. **The budget:** since iteration 5 the tile builds took what was left of 3.6 ms of the frame's JS, so the slower the device, the less they got, and a phone never got the larger slice desktops have had while catching up since iteration 7; since iteration 12 the frame's update was reckoned as the slowest of the last frames', so one slow frame starved the builds for about a second (on the way down from orbit, the default start, the first use of three shaders and of 41 MB of instances took 60–140 ms); and on a phone, whose browser reads the clock in whole milliseconds, the guard against long steps often let one 1/256 of a tile be built a frame. The builds now run after each frame, in a task of their own while the GPU draws it, in the time the frame leaves; while tiles wait in the near field the slice grows to 8 ms on a desktop and 6 on a phone as long as frames keep time, each frame judged on its own. The near field's first use is paid at start-up. **Moving:** a tile that needed more density as you came closer was rebuilt from scratch; on the phone-like run, gliding threw away 96 of 127 builds and left a third of the near field missing (the chunks that never load). Now a ring a tile wide beyond the near field's edge is built ahead, and so is what the camera will see where it is headed (a glide, a zoom, a named view). **Result:** flying in from orbit now has 90 % of the grass in view after 0.4 s on High (1.9 s before), a jump 0.3 s (1.1 s); on the phone-like run 0.09 s and 0.33 s (6.2 s and 3.6 s). Walking and gliding no longer leave a tile of the near field missing in any frame (on High, 131 of 462 frames had one while walking). |
| 2 | Make the grass cheaper to draw without dropping its count | The grass and flower pools are textures now, a page a row, and the draw covers only the pages of the tiles in view (a short list of them tells each instance where to read); through iteration 13 the draw ran over every page up to the highest, culling the pages out of view one instance at a time (911k instances drawn for 320k blades in view on High). 2.3–4.2 ms a frame less on High near the ground, 0.7–1.9 ms on Medium, nothing lost or gained from orbit; the same frames to the pixel in 24 views on all three tiers. Blades thinned out, and a page's empty slots, leave the shader before it reads the field maps. With the time saved Auto keeps High at a higher resolution on the live walk (0.86 of full, 0.65 before). |
| 3 | Make the chunk-by-chunk load-in less distracting | Most of it is note 1: the meadow is built on the way, so on arrival there is little left to come in, and what is left arrives within a few frames instead of over a second or two ([flying in from orbit](docs/checkpoints/iteration-14/fly-in-from-orbit.jpg), [a jump](docs/checkpoints/iteration-14/jump-first-frames.jpg)). And after a jump the near meadow keeps its painted flowers until each tile's flowers are built: before, the paint gave way at once and the meadow around you was bare for about half a second ([the first frame](docs/checkpoints/iteration-14/first-frame-after-a-jump.jpg)). Plants still spawn at full size; nothing grows in. |

Checkpoint images: [docs/checkpoints/iteration-14](docs/checkpoints/iteration-14/).

### Before the work: the study

Load-in after a jump, a glide and the way down from orbit, timed frame by
frame against iterations 4 (67a2742) and 5 (b1209d0), on the M1 Pro and on a
phone-like run (Chromium emulating an iPhone 15: Auto's phone path, a clock
read in whole milliseconds as WebKit's is, the CPU slowed three times):

- On a desktop, iteration 13 loaded the same grass faster than iteration 4
  (Medium after a jump: 0.7 s against 2.0 s), except the first way down
  from orbit (1.7–1.8 s against 1.2 s, the starved second). High, Auto's
  tier since iteration 13, draws twice iteration 4's grass in 144 tiles.
- On the phone-like run iteration 5 took twice iteration 4's time (90 % of
  the grass in view after a jump: 2.4–3.1 s against 1.2 s) and iteration 13
  up to three times (1.3–3.5 s; 6.2 s down from orbit), while moving worse.
- A whole near field on High is 286 ms of JS (Medium 156, Low 59): a full-
  density grass tile is 7,500 points, 1.3 ms.

### Measured (iteration 14)

The grass in view after each move (when half and 90 % of what will be there
is drawn), and when the build queue empties, production builds, the M1 Pro
at 2880×1800:

| | Iteration 13 | Iteration 14 |
|---|---|---|
| Down from orbit (the default start), High | 1.6 / 1.9 s, empty 3.0 s | 0.15 / 0.4 s, empty 1.4–1.7 s |
| Down from orbit, Medium | 1.5 / 1.6 s, empty 2.1 s | 0.08 / 0.22 s, empty 0.9–1.0 s |
| Down from orbit again, High | 0.5 / 0.76 s | 0.16 / 0.42 s |
| A jump, High | 0.78 / 1.1 s, empty 2.3 s | 0.2 / 0.3 s, empty 1.0 s |
| A jump, Medium | 0.37 / 0.5 s | 0.15 / 0.2 s |
| Phone-like, down from orbit | 4.6 / 6.2 s, empty 9.7 s | 0.09 / 0.09 s, empty 1.0 s |
| Phone-like, down again | 2.2 / 3.2 s | 0.08 / 0.08 s |
| Phone-like, a jump | 1.9 / 3.6 s, empty 7.3 s | 0.18 / 0.33 s, empty 1.25 s |

(The queue empties later than the grass in view is drawn: the tiles out of
view, then the ring beyond the edge, are built after it.)

Moving (frames with a tile of the near field missing in view, the share of
those tiles built on average, builds thrown away):

| | Iteration 13 | Iteration 14 |
|---|---|---|
| Walking 8 s, High | 131 of 462 frames, 99.1 % | 0 of 477, 100 % |
| Walking, Medium | 85 of 481, 99.4 % | 0 of 481, 100 % |
| Walking, phone-like | 424 of 481, 81 % (worst 61 %), 214 of 347 builds thrown away | 0 of 481, 100 %, 1 |
| A glide, High | 31 of 149, 99.5 % | 0 of 151, 100 % |
| A glide, phone-like | 122 of 150, 67 % (worst 44 %), 96 of 127 thrown away | 0 of 150, 100 %, 1 |

Frame time (frames back to back, best and median of eight rounds
alternating the two builds; a warm machine, about 1 ms over a cool one's):

| View | High, 13 → 14 | Medium, 13 → 14 |
|---|---|---|
| Orbit | 11.5 → 11.4 | 11.4 → 11.5 |
| Bird's-eye (70 m) | 27.2 → 27.1 | 26.4 → 26.4 |
| Standing (4.3 m) | 23.2 → 19.4 | 20.6 → 19.6 |
| Meadow (1.6 m) | 19.7 → 17.3 | 16.1 → 15.4 |
| Lakeside (1.6 m) | 15.9 → 12.6 | 11.7 → 10.6 |
| Vista | 18.7 → 15.2 | 16.1 → 14.2 |
| Cottage | 30.5 → 26.3 | 27.9 → 27.0 |

The same Auto walk as iterations 11–13 (median frame time in ms / frames
over 25 ms), two runs each:

| | Load | Walk | Turn while walking | Strafe | Stand | Scale |
|---|---|---|---|---|---|---|
| Iteration 13 | 19.6 / 1–2 | 17.0–17.3 / 0 | 17.6–17.8 / 7–8 | 16.7–16.8 / 0 | 16.7–16.8 / 0 | 0.65 → 0.50 → 0.56 |
| Iteration 14 | 18.2–18.3 / 1–2 | 17.0–17.1 / 0 | 17.3–17.4 / 16–19 | 17.2–17.4 / 0 | 16.7–16.8 / 0 | 0.86 → 0.68 |

At one fixed resolution (scale 1, High) iteration 14 is the smoother in
every phase: walking 21.0 ms median / 8–13 frames over 25 ms (24.3 / 105–118),
turning 21.0–22.5 / 48–52 (24.4 / 61–72), strafing 25.7 / 97–101 (29.2 /
131–135).

- **Growth scrub:** frames hold 60 fps (p95 16.7–16.8 ms) in both builds;
  the frame's own JS p95 2.3 ms (5.3–5.4): the builds run after it, up to
  8.2 ms. The invariant now checks the frames (p95 under 20 ms), the frame's
  JS (under 12.7 ms) and the slice (under 8.6 ms).
- **Way down from orbit, its first 1.2 s:** 64–68 frames in both builds,
  mean 17.6–18.6 ms; none over 34 ms (iteration 13 had one of 88–126 ms, the
  first use of the near field's shaders and instances).
- **GPU memory:** 252.7 MB in the meadow on High (250.8 before: the flower
  pools' second texel, +1.9 MB).
- **First frame:** 370–410 ms on High from orbit (370–390 before).
- **Tests:** 68 CPU invariants (11 new on the build budget and queue),
  browser invariants, 15 shots, all passing.

### Trades (iteration 14)

- **Tile builds take more of the main thread while catching up:** up to
  8 ms after a frame on a desktop (6 on a phone), in a task of their own
  while the GPU draws it, only while frames keep time (it was 3.6 ms inside
  the frame, on desktops only).
- **The way down from orbit draws the grass sooner,** so its heaviest
  heights (about 5–20 m up, 22–30 ms a frame at full resolution) now draw
  grass too: on Medium 3–7 more frames of 25–32 ms in its first 1.2 s.
- **Auto spends the time the grass saves on resolution,** so the first turn
  of a walk is heavier (16–19 frames over 25 ms, 7–8 before) until Auto
  steps the scale down; at a fixed resolution every phase is smoother.
- **Start-up from orbit** draws one frame in the meadow before the first
  frame, so the near field's targets (about 20 MB) are allocated at once
  rather than on the way down.

### Known issues

- **No real phone measured:** the phone-like runs emulate an iPhone's
  budget rules and clock on a slowed M1 Pro. A real phone draws fewer frames
  a second, so its times will be longer.
- **The builds still run on the main thread.** Web Workers could take the
  286 ms of a High near field off it entirely and build it in a few frames;
  not done.
- **Tiles still appear one at a time,** nearest first, now within 0.2–0.4 s
  of arriving. Revealing all the tiles in view at once, or letting the near
  field's ragged edge widen over them, could make it a single change: an
  A/B for review.
- Carried over: the distant grass finer than a pixel sparkles a little as
  you move; the cottage's reflection without its rail, chair, bench or
  window frames.

## Iteration 13: the review notes

Started from iteration 12 (9ad20e4), the notes committed first (cb47909).
Before it Kai asked for a post mortem of the flashes and a profile against
the morning's build (iteration 4); both are summed up under the table.

| # | Note | What changed |
|---|---|---|
| 1 | Make the profile's lossless fixes: the cloud mirror drawn only where there is water, the ground's shader without the cottage's code on terrain away from it, the field map drawn before the clouds' passes, the flower clumps read from a texture, and resolution changes without reallocating | Four of the five, each checked against the build before it to the pixel. The field map is drawn first in the frame: its passes cost almost nothing to shade, but drawn after the clouds' passes the main pass, whose blades read it as they are placed, waited for both (0.9–1.5 ms). The cloud mirror is shaded only where a lake can read it: a mask of 8 px cells where the camera's rays meet the water table on wet ground (found from the bake, not by drawing the terrain again), grown by the farthest the wind's ruffle moves a lake's lookup; identical in nine views at the default wind and a gusty one, 0.1–2.2 ms saved. The terrain away from the homestead (beyond its plateau, its pond and the cottage's shadow) is drawn with a build of the ground's shader without the homestead's code: code that never ran there still slowed every pixel; 1.2–2.9 ms saved away from the cottage, nothing near it. Resolution: note 2. The fifth would have changed the look, so it is not done: the clumps' noise has 1–2 m features, finer than the bake's texels (0.4 m at R 128, 1.2 m at R 400), so a texture softens and shifts the beds' edges, more on bigger planets; the exact speed-ups (sharing the two clump fields' noise work) save under a tenth of it. Also found: the grass and flower page tables were 256² and sent whole every frame for pools of under 1,000 pages; now sized to the pools (uploads 440 → 125 KB a frame). Together, 1.6–4.9 ms a frame less near the ground on both tiers (Measured). |
| 2 | Trading graphics for performance means altering the look of the image, not the resolution: Auto may drop the resolution more aggressively than now if that keeps High as the quality; a little upscaling blur is welcome | Auto now starts a desktop on High and keeps it, the render scale going down to 0.5 (was Medium, to 0.6); only a machine still far too slow at that floor drops a tier. A change of scale no longer resizes anything: the canvas and the screen-sized targets keep their size and the frame is drawn into part of them, which the grade spreads over the canvas (scale 1 draws exactly what it did). Each step of iteration 12's Auto reallocated about 130 MB and cost a frame of 70–90 ms; now a step costs nothing, so a slow stretch steps down after 0.75 s by as much as the frames ask (×0.92 to ×0.75). On a live walk Auto holds High at 0.69–0.88 while walking, with about twice iteration 12's grass in sight. |

### Before the work: the post mortem and the profile

- **The flashes** fixed in iteration 12 (a blank frame, a strip of grass
  missing for a frame) both came from the order of a frame's work as the
  first runnable build wrote it (S1–S5, c475766): the render scale's resize
  after the draw, and tiles committed between the visibility pass and the
  draw. Every build had them; they grew common as resizes (the tier ladder
  of iteration 6, the 60 fps target of 7, the step-up probes of 11) and
  rebuilds in view (walking in 5, High's wider grass in 6, view-first
  builds in 7) did. On one 27 s walk with High chosen, blank frames:
  iteration 4: 8, 5: 8, 6: 4, 7: 4, 9: 4, 10: 4, 11: 10, 12: 0 (10
  resizes); frames missing a strip: 0 (iteration 4 had no walking), 142,
  39, 278, 301, 297, 484, 0.
- **The profile** (2880×1800, the same views, cameras and blade and flower
  counts in each build): iteration 12 on Medium cost 28–47 % more GPU time
  a frame than iteration 4 on its High. The ground and water shader grew
  most (+1.4 to +6 ms; it is large enough that its code costs even where
  it never runs), then the cloud mirror back at full resolution in
  iteration 5 (+2.3 to +2.6 ms in the lake views, 78–100 % of its pixels
  off the water), the field map's wait (1.3–1.6 ms, none of it shading)
  and the planet-fixed cloud shadow maps (+0.3 to +0.9 ms). The clouds
  themselves were unchanged. JS stayed under 0.5 ms a frozen frame. Each
  of Auto's resolution steps was a 70–90 ms frame.

### Measured (iteration 13)

Frame time at 2880×1800 (1440×900 at DPR 2, Apple M1 Pro), the GPU's
throughput with frames back to back, best of eight rounds alternating the
two builds in one browser (a warm machine: these run 1–3 ms over a cool
one's, the differences hold):

| View | Iteration 12, Medium | Iteration 13, Medium | Iteration 12, High | Iteration 13, High |
|---|---|---|---|---|
| Orbit | 9.2 | 9.0 | 9.4 | 9.3 |
| Bird's-eye (70 m) | 24.2 | 22.0 | 25.0 | 22.6 |
| Standing (4.3 m) | 20.5 | 17.2 | 23.0 | 20.0 |
| Meadow (1.6 m) | 18.2 | 13.3 | 20.6 | 16.9 |
| Lakeside (1.6 m) | 11.5 | 9.7 | 15.8 | 13.4 |
| Vista | 15.5 | 13.9 | 18.2 | 16.0 |
| Cottage | 26.6 | 23.5 | 27.5 | 25.9 |

Against iteration 4 (the morning's page, its High, measured cool), Medium is
now faster in the meadow and 0.6–2.2 ms slower standing, at the lakeside and
in the vista; the bird's-eye and cottage views still cost about 5 ms more
(the pond twice the size, the cottage in its reflection, the clumps'
noise). With the render scale free, Auto keeps 60 fps at High by resolution:
at scale 0.5 the standing view takes 7.5 ms on Medium (16.1 at 1).

The same Auto walk as iterations 11 and 12 (median frame time in ms /
frames over 25 ms), just before the free steps and after:

| | Walk | Turn while walking | Strafe | Stand | Tier and scale |
|---|---|---|---|---|---|
| Before (f42393e) | 17.6 / 0 | 18.2 / 15 | 18.3 / 1 (a 77 ms frame at a step) | 16.7 / 0 | Medium, 1.0 → 0.90 |
| Iteration 13 | 17.5 / 0 | 17.8 / 1 | 17.2 / 0 | 16.7 / 0 | High, 0.88 → 0.69 → 0.77 |

With High chosen the steps had cost frames of 92 and 83 ms; now no frame
passes 25 ms outside the first second.

- **GPU memory:** 246 MB on Medium, as before (the water mask 0.2 MB).
- **Uploads:** 120–126 KB a frame in the meadow (440 before).
- **Growth scrub:** JS p95 5.3–5.5 ms (5.3–5.4 in iteration 12): the
  mask's passes and the terrain's second draw add about 0.05 ms of
  submission. The invariant's limit is now 5.6 ms (it was 5.5).

### Trades (iteration 13)

- **Cloud shadows on the blades:** the grass and the flowers read the
  clouds' shadows a frame (16.7 ms) late, as the field map is drawn before
  the clouds' passes.
- **Upscaling:** a lowered render scale is spread over the canvas by the
  grade (bilinear) rather than by the browser, and the paper grain stays at
  the screen's own resolution at any scale (it grew with the scale before).
- (By Kai's choice, not a trade of the look: Auto keeps High at a lower
  resolution instead of Medium at a higher one.)

### Known issues

- **The flower clumps' noise** stays per pixel (1–2.3 ms from above): a
  texture would change the beds' edges.
- **The largest costs left:** the clouds themselves (3.6–4.8 ms at eye
  level, as in iteration 4), the water's bank march (1.7–3.6 ms), the
  meadow paint from above.
- Carried over: the distant grass finer than a pixel sparkles a little as
  you move; the cottage's reflection without its rail, chair, bench or
  window frames.

## Iteration 12: the review notes

Started from iteration 11 (a1f357f), the notes committed first (26bec09).

| # | Note | What changed |
|---|---|---|
| 1 | A whole-screen flash: everything disappears for a split frame (video) | The video's first frame is the empty canvas under the interface. When the quality controller changed the render scale, the canvas was resized after the frame had been drawn, which clears it, so that frame was shown blank. With High chosen (as in the video) the controller trims the scale and now and then tries a step back up, so it happened every so often. A resize now waits for the start of the next frame and is drawn before it is shown. On a live walk on High: 10 resizes, 10 blank frames before, 0 after. |
| 2 | A patch of grass disappears, then pops back | Each frame decided which grass and flower pages to draw (the update), then finished building tiles, then drew. A tile finished in between had moved its blades to pages the update had not marked visible, so a strip of it (a page holds a strip of a tile) was missing for that frame, and sometimes another tile's blades showed in its old pages. While walking that happened in 489 of 1,321 frames (753 tiles). Tiles are now built at the start of the frame, before the update: 0 in 1,351 frames. |

A new browser test walks the meadow on High, changes the tier from inside a
frame as the controller can, and checks that no resize lands after a draw
and no tile's pages move between the update and the draw; it fails on
iteration 11's code and passes now.

### Measured (iteration 12)

The same Auto walk as iteration 11's (Apple M1 Pro, 1440×900 at DPR 2;
median frame time and frames over 25 ms):

| | Walk | Turn while walking | Strafe | Stand |
|---|---|---|---|---|
| Iteration 11 | 17.8 / 1 | 18.4 / 13 | 18.7 / 2 | 17.3 / 0 |
| Iteration 12 | 16.9 / 1 | 17.2 / 2 | 16.6 / 0 | 16.6 / 0 |

Medium throughout; the scale went to 0.73 while walking and back up to
0.81 standing.

### Known issues

- Carried over: the distant grass finer than a pixel sparkles a little as
  you move; the cottage's reflection without its rail, chair, bench or
  window frames.

## Iteration 11: the review notes

Started from iteration 10 (aadae30), the notes committed first (94ec2a0).

| # | Note | What changed |
|---|---|---|
| 1 | The performance degradation is real, not just a change of scene | It was. My timings since iteration 6 froze the camera after everything had loaded, so they never saw the quality controller at work. A live walk with Auto (stand, walk, turn while walking, strafe, stand; every frame recorded) showed iteration 10 starting on High (2.5 times iteration 5's grass), trimming the resolution, then dropping to Medium and to Low. Each drop reset the resolution to full (slower frames first: 105 of 133 frames over 25 ms in the strafe) and rebuilt every blade and flower in sight. Iteration 5 never left its tier. Auto now starts desktops on Medium (iteration 5's High) and keeps the frame rate by the resolution alone, in smaller steps, backing off when a step up doesn't hold; it no longer changes tier as you go. The same walk now matches iteration 5 (below). High is unchanged and still there to choose. |
| 2 | Grass loads in much more slowly, with a new flicker when moving around | Both came from those tier changes: each one threw away and rebuilt the grass and flowers in sight while you moved, and changed the resolution. On a fixed tier the grass fills in as fast as in iteration 8 (2.5 s on High), and walking flickers no more than it did (the distant strip of grass and flowers, finer than a pixel, as in every iteration). Iteration 10's change to how the grass reads the shadow map (crisp edges between the map's texels) is reverted too: it showed no difference, and a map that moves with you could make crisp edges crawl. |

### Measured (iteration 11)

Apple M1 Pro, 1440×900 at DPR 2, Auto, the same walk from the same spot,
median frame time and frames over 25 ms per phase (the GPU was shared):

| | Walk | Turn while walking | Strafe | Stand | Tier and resolution at the end |
|---|---|---|---|---|---|
| Iteration 5 | 17.9 / 1 | 18.6 / 11 | 17.1 / 2 | 16.7 / 0 | High (today's Medium) at 0.61 |
| Iteration 10 | 18.3 / 1 | 20.1 / 19 | 30.1 / 105 | 24.1 / 91 | Low at 0.85, after High, Medium |
| Iteration 11 | 17.8 / 1 | 18.4 / 13 | 18.7 / 2 | 17.3 / 0 | Medium at 0.73, throughout |
| Iteration 11, High chosen | 17.9 / 8 | 18.3 / 11 | 19.2 / 4 | 18.3 / 0 | High at 0.60, throughout |

### Trades (iteration 11)

- **Auto's starting tier:** Medium on desktops (grass to 22 m), not High
  (35 m). On this machine High holds about 55 fps at 0.6 resolution; Medium
  holds 60 at 0.73. Kai chose Medium for Auto (2026-10-30); High stays a
  choice in the panel.

### Known issues

- At 2880×1800 even Medium needs about 0.73 resolution for 60 fps on an M1
  Pro; the heavy views need more trimming.
- Carried over: the distant grass finer than a pixel sparkles a little as you
  move; the cottage's reflection without its rail, chair, bench or window
  frames.

## Iteration 10: the review notes

Started from iteration 9 (8bfde67), the notes committed first (3d62413).

| # | Note | What changed |
|---|---|---|
| 1 | Jagged geometry around the hut's pond; make the pond twice as big | The teeth were the bank's steep face shaded by the ground mesh's slope, which steps from triangle to triangle where the mesh is coarse; the face is now shaded by the slope taken per pixel, so it follows the shore ([before and after from 70 m](docs/checkpoints/iteration-10/pond-rim-teeth-before-after.jpg)). Small notches remain right at the water's edge, where the coarse mesh meets the water. The pond's radius is now 17–22 m at R 128 (8.5–11 before), 7 m left of the cottage's middle so the pier still stands in it; its islet keeps its size in meters. The bigger pond made the pond's shaping run over three times the area (the reflections' march reads the ground a dozen times per water pixel); it now runs only within the pond's own reach, at no measurable cost. |
| 2 | Bird shadows are round dots: a bit more detailed (and, during the iteration: 1.2 ms is steep, they needn't be super detailed) | Each bird now casts its silhouette into the shadow map: body, tail and wings, as far as they reach out at that point of the wingbeat, turned with its heading ([on bare ground](docs/checkpoints/iteration-10/bird-shadows-on-bare-ground.jpg), [old and new from above](docs/checkpoints/iteration-10/bird-shadows-before-after.jpg)). A first version had every grass blade and flower read the shadow map for crisp shapes in the grass, which cost 1.2 ms; that is gone. The grass reads the shapes through its field map as before (now stored so its edges stay crisp between texels). The blades' lean still softens the shapes, so in the grass they read as winged, oriented shadows rather than sharp silhouettes. No measurable cost. |
| 3 | Zoom stops: try 0.83 and 0.35 at R 128; their height should not change with the planet's size | The stops are heights now: 4.3 m (standing, zoom 0.83 at R 128) and 70.2 m (bird's-eye, 0.35), the same on every planet (checked at R 40, 284 and 400). The camera's tilt goes by height too (as it was at R 128), so each stop also looks the same everywhere: 80° from straight down standing, 14° at the bird's-eye. |
| 4 | (found while measuring) The default Wander stand moved | It was picked at startup, before the ground was set up for the world, so it never landed where it was meant to (by the first water at the edge of the nearest wetland): iteration 9 put you on a meadow hill 16 m from any water, and this iteration's pond change would have put you in a lake. The ground is now set up first, and you stand at the lake's edge, looking across it ([the default view](docs/checkpoints/iteration-10/wander-default.jpg)). |

Checkpoint images: [docs/checkpoints/iteration-10](docs/checkpoints/iteration-10/).

### Measured (iteration 10)

Apple M1 Pro, 2880×1800, High, alternating with iteration 9's build three to
five times per view (best of each; the GPU was shared, so the absolute times
drift between runs):

| View | Iteration 9 | Iteration 10 |
|---|---|---|
| Wander, from the same lakeside spot | 15.5 | 15.9 |
| Wander, each build's default spot | 13.3 (the hill) | 15.7 (the lake's edge) |
| Vista | 20.4 | 20.1 |
| Lakes | 28.4 | 28.6 |
| Cottage view | 29.9 | 29.8 |

The code costs the same as iteration 9's. The default Wander view costs
2.4 ms more because it now looks across water, as it was meant to.

### Trades (iteration 10)

None.

### Known issues

- Bird shadows in the grass are softer than on bare ground: the blades lean
  away from the point they take their shadow from. Crisper would mean a
  shadow lookup per blade (the 1.2 ms we turned down).
- Small notches where the coarse ground mesh meets the water, seen from high
  up.
- Carried over: the cottage's reflection without its rail, chair, bench or
  window frames; the heavy views don't hold 60 fps at full resolution on an
  M1 Pro at 2880×1800 (Auto trims them).

## Iteration 9: the review notes

Started from iteration 8 (a76417f), the notes committed first (c95587b).

| # | Note | What changed |
|---|---|---|
| 1 | The cottage's reflection is still wrong: the stand-in model? (and, added during the iteration: it should just not leave a gap; "really no gap? why is the grass reflection showing in front?") | The stand-in boxes were fine; the way the water traced them wasn't. The water found the bank by stepping along the reflected ray through the warped view, and the cottage by a straight line in a flat frame that ignored both the planet's curve and the view's warp, then compared the two distances. Near the pier they disagreed: the ground under the pier could win in front of it (the grass showing in front), and the darkening of the tunnel's water, worked out in the flat frame, spilled onto open water in front of the pier (the dark strip under it on the small planet: [debug colours](docs/checkpoints/iteration-9/before-debug-which-reflection-wins.jpg)). Now the cottage is found along the same steps as the bank, in the same map from meters to the planet as the bent cottage, tested exactly on the segment between two steps so no edge is skipped, and only up to where the bank was met: whichever is nearer shows. The pier meets its reflection with no gap at R 40 and R 215 ([waterline](docs/checkpoints/iteration-9/pier-waterline-R40-R215.jpg), [your two angles](docs/checkpoints/iteration-9/pier-reflection-two-angles.jpg)). |
| 2 | Why does the left side of the building arch up? | The cottage was a flat object on a curved, warped planet: its long left end (the pier) stood level while the ground curved away under it, so its top edge rose against the ground and, on the smallest planet, its foot lifted off. Fixed with note 3. |
| 3 | On a small planet buildings should curve with it, their walls perpendicular to the surface (like Messenger's) | Every vertex of the cottage is now placed by the terrain's own cottage-local meters (the sine map round the cottage) and straight up from there, so each wall stands square to the ground under it and the house sits exactly on its clearing and its pond at every size ([R 40](docs/checkpoints/iteration-9/small-planet-R40.jpg)). |
| 4 | The roof and the foundation a bit more mossy | Moss over much of the roof (thickest in the lower courses), at the walls' foot, and on the foundation from the water up, in patches and along the joints. |
| 5 | (added) Grass reflections: the geometry and colours look off; they should take on more of the lake's colour and be darker | Bank reflections are now the lake's deep blue darkened, a dark navy band under every shore as in the reference still (its bands sample #0A3C63 to #0C243F). |
| 6 | (added) Two more zoom stops: eye level, and a bird's-eye about 10 m up; tilt toward the ground later so the bird's-eye sees further; then the stops at zoom 0.4000 (bird's-eye) and 0.8000 (standing) | The wheel and the keys settle on four stops when you stop within half a wheel notch of one: orbit, the bird's-eye view at zoom 0.4 (about 52 m up at R 128, looking down over the meadow), the standing view at zoom 0.8 (about 5.1 m up, looking out across it), and the meadow at 1.6 m. The stops are zoom values, so each keeps its framing at every planet size. The camera reaches the horizon earlier on the way down: 10 m up it looks 24° below the horizon (43° before) ([first stops, at 10 m and 2.8 m](docs/checkpoints/iteration-9/zoom-stops-10m-2.8m-1.6m.jpg)). The vista finder, which uses the same camera, now picks a wider lake view with islands and a cloud upper right; squint 23.4 (from 23.7). |
| 7 | (added) Grass and flowers still grow in and shrink out when wandering | They shrank toward the edge of the area around you where they're drawn, and faded in by rank as you came near, so walking made them grow ahead and shrink behind. Now they are there or not: they thin out toward that edge one by one at full size, and only the planet's growth fades them in. |

Checkpoint images: [docs/checkpoints/iteration-9](docs/checkpoints/iteration-9/).

### Measured (iteration 9)

Apple M1 Pro, 2880×1800, High, alternating with iteration 8's build three
times per view (best of each; the GPU was shared):

| View | Iteration 8 | Iteration 9 |
|---|---|---|
| Lakes | 22.9 | 24.1 |
| Cottage view | 26.4 | 26.9 |

The first version of the new mirror (one loop testing the cottage at every
step of the bank's march) cost about 2.5 ms on every ground pixel, even far
from the cottage, because the GPU sizes a shader by its heaviest path. The
version shipped runs the cottage's steps after the bank's, only for rays
near it. Part of the lakes view's remaining 1.2 ms is the new tilt: it now
looks higher and shows more far water.

### Trades (iteration 9)

None.

### Known issues

- The cottage's reflection is still its stand-ins: no rail, chair, bench or
  window frames in the water.
- Carried over: the heavy views don't hold 60 fps at full resolution on an
  M1 Pro at 2880×1800 (Auto trims them); the far meadow and clouds third of
  the squint test is now the worst (more sky in the new vista).

## Iteration 8: the review notes

Started from iteration 7 (1ca0327), the notes committed first (9030555).

| # | Note | What changed |
|---|---|---|
| 1 | A corner in the pier's reflection: geometry, or the reflections' draw order? | Geometry. The water traces simple stand-ins for the cottage, and iteration 7 had deepened the terrace's stand-in to 3 m under the ground, so where a reflected ray passed under the bank the water showed the buried terrace (the corner, and its dark foot). The stand-ins now stop at the ground (the pier's at the water), and a cottage hit counts only if the meadow along the same ray doesn't stand in front of it. |
| 2 | The flower paint: a very hard edge and a very even fill inside it, fine far away, unnatural up close | Up close (where a pixel covers less than about a third of a meter) the paint's flowerbeds fade out over a meter or so along a ragged edge, and their fill is uneven: denser and sparser by turns. From far away they are as they were. The flowers themselves keep their beds. |
| 3 | The grow-in of new grass and flowers makes the level-of-detail change more noticeable | Removed: tiles spawn straight in again. Tiles in view are still built first and faster (zooming in on High fills in 2.3 s). |
| 4 | (added during the iteration) The flowers on the side of the planet opposite the hut are green, and the hut's base casts a shadow there | Two things. The green: the bloom spreads out from the hut, and at the default Bloom (0.78) the far 8 % of the planet was still in bud; the default is now full bloom (1), so the whole planet flowers (the slider still spreads it). The shadow: a real bug since iteration 1. The cottage's shadow test projects a place onto the cottage's ground plane, which folds the far side of the planet onto the cottage's own footprint; it now checks the true distance first (and so does the tunnel's dark water, which would have darkened a patch there too). |

Checkpoint images: [docs/checkpoints/iteration-8](docs/checkpoints/iteration-8/).

## Iteration 7: the review notes

Started from iteration 6 (3dbb552), the notes committed first (adecba8).

| # | Note | What changed |
|---|---|---|
| 1 | Grass loads in late when zooming in, completing in chunks: jarring | High builds about 2.5 times the grass of iteration 5's High in the same time slice, so filling in took twice as long (4.6 s against 2.1–2.6 s), a 6 m tile popping in at a time. Now tiles in view are built first, a tile that opens new ground grows up from it over a third of a second instead of popping in, and while a backlog waits a desktop builds with up to 3.6 ms a frame (from 2). Zooming in on High now fills in 2.4 s, and what's in view within about 0.3 s ([frames](docs/checkpoints/iteration-7/zoom-in-grass.jpg)). |
| 2 | Perceived performance is much worse: what changed? | Three things. Auto had been set to tolerate frames up to about 27 ms (your 24 ms budget), which a 60 Hz screen shows as 30–40 fps with uneven pacing; it now aims at a steady 60 again, trimming the resolution before the grass. High draws twice the grass and nearly twice the flowers of iteration 5's High (4–7 ms more). And the bigger cottage had made its ground shadow, worked out for every ground pixel, grass blade and flower within 40 m of the house, about 4 ms more expensive; it's now only worked out where the shadow can fall (about 4 ms back in the cottage view, about 3 in the vista). |
| 3 | The painterly flower pattern is a little too strong: about 20 % softer | The paint's flowers (dabs and wash) lie 20 % lighter over the grass. |
| 4 | The cottage: the ridge floats; the windows should sit deeper; the eaves' shadow should reach further down; the chimney; the foot at high curvature; the tunnel (added during the iteration: the chimney should sit behind the ridge, and the tunnel under the pier should be real) | The capping on the ridge and hips now sits on the roof, with bedding reaching down into the slopes, so no daylight shows under it. The window frames sit 0.22 m into the 0.36 m walls, the reveals in shade. The eaves' shadow is cast nearly as deep as the geometry would cast it (0.45–1.6 m by the sun on each wall). The chimney stands just behind the ridge on the back slope, the ridge's capping running in front of its foot. The pier's arch is a real tunnel: its mouth cut through the face, side walls, a half-round vault and a back wall 1.6 m in, the water cut in under it, dark inside and dark in its mirror. The walls go 0.7 m and the terrace and pier 3 m below the clearing, so even on the smallest planet the curve never opens a gap under them. |

Checkpoint images: [docs/checkpoints/iteration-7](docs/checkpoints/iteration-7/).

### Measured (iteration 7)

Apple M1 Pro, 2880×1800, the GPU shared with another window, so each view
alternated three times between iteration 5's build and this one, best of
each (ms per frame, frames back to back):

| View | Iteration 5 (High) | Iteration 7, Medium | Iteration 7, High |
|---|---|---|---|
| Wander | 6.8 | – | 14.0 |
| Vista | 21.4 | 22.7 | 25.4 |
| Lakes | 21.1 | 24.7 | 24.7 |
| Cottage view (iteration 6's wider framing) | 22.4 | – | 27.5 |

- At 60 fps, Auto keeps High's full resolution in Wander and trims it in
  the heavy views (to about 0.72 there on this machine), as iteration 5's
  Auto trimmed its heavy views.
- Medium still costs 1.7–2.6 ms more than iteration 5's High in the heavy
  views, spread thinly: about 1 ms in the ground and water paint, the rest
  in the clouds' sharper shadow window and smaller things.

### Trades (iteration 7)

- **JS per frame** may reach 5 ms (from 4) while a desktop catches up on a
  backlog of tiles (the growth-scrub invariant now allows 5.5 ms at p95).
- **Render scale:** with Auto aiming at 60 fps instead of 24 ms, the heavy
  views run at a lower resolution on machines that can't hold 60 at full
  resolution. Choose High (not Auto) to keep full resolution at a lower
  frame rate.

### Known issues

- The heavy views (vista, lakes, cottage) don't reach 60 fps at full
  resolution on an M1 Pro at 2880×1800; Auto trims the resolution there.
- Medium is a little slower than iteration 5's High (above).
- Carried over: the lake darker than the still's in the squint test (23.7);
  the cottage's mirror without its steps, bench or rail.

## Iteration 6: the review notes

Started from iteration 5 (b1209d0), the notes committed first (f65e137).

| # | Note | What changed |
|---|---|---|
| 1 | Commit before each iteration starts | The notes were committed before any work (f65e137); from now on every iteration starts that way. |
| 2 | Butterflies and birds beat their wings too fast; butterflies look like flies and should move elegantly | Butterflies fly in bursts of a few slow, full beats (2.8–4 a second by kind, from 9–12), the body bobbing up on each downstroke and climbing through the burst, then glide on wings held in a shallow V, sinking a little; their loops are slower and smoother. The whites flutter on longest, the tortoiseshells and peacocks glide most. Birds beat like egrets, 1.7–2.1 a second (from 2.7–3.1), deeper, and glide about a third of the time. |
| 3 | Birds a little slower and lower | 5–6 m/s (from 6–8); over the ground beneath them 4.6 m on the median (from 6.1), never under 1.7 m. |
| 4 | Sheen 0.5 by default | Done (from 0.85). |
| 5 | The grass's sway is too small for the wind and seems unrelated to the sheen | The blades now bow with the same waves the light shows: a gust's crest lays them well over (about 35° more at the default wind, from about 10°), its trough springs them back a little past upright, and their flutter is quicker and wider in a stronger wind and where a gust is pressing. |
| 6 | The budget is 24 ms: Auto culls grass too eagerly, and High doesn't go very high | Three tiers: low, medium (iteration 5's high) and a higher high: grass to 35 m (from 22) and thicker toward its edge, flowers to 45 m (from 30). Auto aims at 24 ms instead of 16.7, first lowers the render scale (to 0.72, not 0.6), then steps down one tier at a time instead of dropping straight to low, and climbs back when frames are easy. The pools are sized for high on every tier, so choosing High after Auto started lower now fills in completely (before, the grass ran short). MSAA no longer switches on when Auto lowers the render scale. The answer on the budget is under Measured. |
| 7 | Cloud shadows stutter across the ground, most of all in a large world | The cause: each puff's shadow had a hard outline in its map, so a drifting cloud flipped whole texels (half a meter at R 400) from sun to shadow. The outline is now antialiased over a texel and a half, and a second, sharper map (2048²) covers the ground about you, its texels fixed to the planet. Seen 5 m up at R 400, the shadow edge's per-frame motion went from 0.76 to 0.21 in unevenness (sd over mean), and the edge is crisper ([the clip](docs/checkpoints/iteration-6/cloud-shadow-edge-r400.gif)). |
| 8 | The cottage: match the design 1 to 1 | Rebuilt after the painting. The original brief's rule (an original building, not the film's) is lifted for the cottage at your request. The painting's layout: a tall window toward the left of the front and the door right of the middle with the bench between them, a small window high on the right end, the chimney mid-ridge. The floor is raised over the meadow with three steps at the terrace's right end. A stone pier runs out over the pond at its left end, with an arch at the waterline, an iron rail along its back and a wooden chair by the corner. Proportions come from the painting: the ridge is a third of the eaves' length, giving 8.6 × 5.3 m under a 45° roof of fourteen finer courses, with eaves half a meter out. Colours are sampled from it: warm beige walls, olive-grey in shade, a warm grey-brown roof with less moss, an olive-grey eave shadow. The pond now lies in front and to the left, under the pier, and the sun ahead and to the left, as in the painting. The homestead view frames the cottage as the painting does. The mirror in the pond has the pier and the chimney too. |
| 9 | Grade: about 10 % more contrast, 5 % less brightness | Contrast 1.1 about mid grey, brightness 0.95, in display space after the tone curve; both are sliders under Style. |
| 10 | Petals blown off by the wind are hard to find in places | They were held back by a threshold that the default wind never reached, so they only lifted at the bloom front's edge or in a strong wind. Now they lift wherever flowers grow as each gust crest passes, in the colours of those flowers, 720 of them (from 480), more of them near you. |
| 11 | The flower strokes from far out should follow the flower map and turn straight into the flowers | The strokes come from the same density map the flowers are scattered by. They used to stop shrinking at 0.55 m, so from mid heights they became sparse dots and the colour wash switched off. Now they keep about 5 px from orbit down to a single flower's size, drawn out a little along the brush's way, and the wash holds all the way down. Both give way to the flowers only where those are big enough on screen to carry the flowerbeds ([120 m down to 3 m](docs/checkpoints/iteration-6/flowers-from-120m-to-3m.jpg)). |
| 12 | (added during the iteration) Cloud reflections are layered over the reflections of the grass and the ground | The water now shows the clouds' reflection only where the mirrored ray clears the land: a bank or hill it meets stands in front of every cloud. |
| 13 | (added during the iteration) The name: Muse's Garden | The headline, the tab, the postcard and the fallback screen; new iteration pages are muses-garden-iteration-N. |

Checkpoint images: [docs/checkpoints/iteration-6](docs/checkpoints/iteration-6/).

### How it is built (summary)

- **Cloud shadows:** splats antialiased at their outline; a window of one
  cube face about the focus at 2048² (70–320 m across by camera height,
  moved in whole texels, sized in steps), read where it covers a point and
  blended into the cube map at its rim.
- **Tiers:** `TIERS` in core/quality.ts (low, medium, high) with their map
  sizes; `POOL_PAGES` sized for high; the controller aims at
  `FRAME_BUDGET_MS` (24).
- **The cottage:** props.ts (`FLOOR`, `COTTAGE`, `TERRACE`, `PIER`,
  `STEPS`, `CHIMNEY`), mirrored in terrain (the clearing's areas, the
  ground shadow, `POND_SHIFT`) and in water.glsl (the mirror's solids).
  Change them together.
- **Named views** can look up from the zoom's tilt (`CameraRig.lookUp`),
  which eases away on the next move.

### Squint test (the vista against the still, mean ΔE76 per cell)

| | Overall | Far meadow and clouds | Lake and islands | Near meadow |
|---|---|---|---|---|
| Iteration 4 | 22.3 | 16.0 | 23.6 | 27.2 |
| Iteration 5 | 23.5 | 16.6 | 24.4 | 29.5 |
| Iteration 6 | 23.7 | 16.9 | 26.2 | 27.8 |

The near meadow is closer (the darker grade and the calmer sheen); the lake
is further off: darker than the still's (#5f856f against #71969d), from the
grade and the far banks now reflected in front of the clouds. The guard
(fails above 26) passes.

### Measured (iteration 6)

Apple **M1 Pro**, headless Chromium on Metal, frames back to back waiting
for the GPU, at 1440×900 and DPR 2 (2880×1800). The GPU was shared with a
Chrome window during this iteration, so both builds were measured back to
back. On a quiet machine iteration 5's views were about a quarter faster than
the "iteration 5" column below (vista 18.0 ms then against 23.9 here).

| View | Iteration 5 | Iteration 6, medium | Iteration 6, high |
|---|---|---|---|
| Overview | 10.3 | – | 10.2 |
| Wander, R 128 m | 7.7 | 7.8 | 12.3 |
| Wander, R 400 m | 9.3 | – | 14.4 |
| Vista | 23.9 | 23.9 | 26.1 |
| Lakes | 23.2 | 24.1 | 26.0 |
| Cottage view (the new framing takes in the whole pond) | 24.2 | 27.8 | 29.4 |
| Phone overview / Wander / Vista (low) | 2.5 / 2.3 / 5.6 | | 2.7 / 2.1 / 5.7 |

- **The budget:** on a quiet M1 Pro at 2880×1800, High should run at about
  9 ms in Wander and 19–22 ms in the vista, lakes and cottage views, inside
  24 ms. Medium costs what iteration 5's High did. On a slower GPU or a
  bigger canvas, Auto first trims the render scale in the heavy views and
  only then steps to medium.
- **High's extra cost** is the grass and flowers it adds (320k blades in
  sight from 164k in Wander): 4–5 ms in Wander, 2–3 ms in the heavy views.
- **The shadow window** costs about 0.2 ms.
- **Growth scrub, first frame, draw calls:** the invariants pass.

### Trades (iteration 6)

None. Still standing from earlier iterations: cloud self-shadowing one value
per puff; lumps from a baked cube map; bird shadows as soft discs; the
13-step bank march; quick bake while growing; 256² field maps on medium;
MSAA only below DPR 1.75. The eaves' shadow is drawn a little shallower than
the geometry would cast it (a choice of look).

### Known issues (iteration 6)

- **The cottage view is the heaviest** (29.4 ms on High here with the GPU
  shared; about 22 ms quietly).
- **The lake in the squint test** reads darker than the still's.
- **The cottage's mirror** is plain solids: no steps, bench or rail in the
  water.
- **The layout changed again** (the pond moved to the cottage's front left,
  the sun to its left): the cottage view, the lakes view and the default
  stand differ from iteration 5.
- **Carried over:** the warp's flat band on the way down; triangle figure,
  pools after a scrub, tier probe, LOD-ring test.

### Next (iteration 6)

1. Composition of the vista (flowers in front, the cloud upper right).
2. The lake's colour against the still.
3. Then dawn and golden hour, graded the same way.

## Iteration 5: the review notes

| # | Note | What changed |
|---|---|---|
| 1 | Some cloud shadows move the wrong way when the globe spins | They were cast down the one sun the view is lit by, which turned with the view, and only clouds in sight cast any. Now every place on the planet sees its own sun (late morning everywhere: the same height and bearing from local north), and every cloud, in sight or not, casts its shadow down its own place's sun into a cube map of where the shadows reach the ground. The shadows are fixed to the planet: each stays under its cloud however the globe turns. |
| 2 | Some birds stay in place while the globe turns, zoomed out | One flock followed the view, to keep birds in sight. Gone: every bird belongs to the planet. |
| 3 | No cloud reflections zoomed out | From orbit each lake now reads the cloud cover seen from below (a second cube map) where its mirrored ray meets the clouds; it cross-fades with the close-up mirror on the way down. |
| 4 | Wind sheen: darker dark bands, brighter bright bands, with the sway; no wider | Each gust crest trails a dark, cool trough where the grass springs back into its own shade; crests are crisper and brighter, not wider; the blades lean back a little in the troughs, so light and sway move together. Sheen 0.65 → 0.85. |
| 5 | Birds: a little faster, better paths, less like butterflies | Most flocks travel great circles round the planet at 6–8 m/s (2–4 before), the route swinging slowly so it crosses the whole meadow, with a gentle meander; two wheel in steady loops near the cottage. Level flight over the hilltops instead of bobbing over every hummock, loose V's and clusters with only a slight drift, steady beats with short glides, banking by the real turn rate. Nine flocks at R 128. |
| 6 | Butterflies of various colours when close, 2–3 on screen | Six kinds (whites, sulphurs, orange-tips, blues, tortoiseshells, peacocks) over the flowers once you are below about 13 m: about three on screen at a time in Wander (median over 40 places, most 1–5). They wander and flutter, and now and then settle on a flower. |
| 7 | The cottage: closer to the reference, no vines, strokes and proportions, paint the shadows | Measured from the reference and rebuilt: a long, low house (9 × 5 m) under a roof of one 38° pitch all round, the eaves just above the door and the windows, on a terrace 1.2 m over its pond with a stair down to the water. The roof is nine real courses a side (each a lit lip with a line of shadow under it), moss settling olive and yellow in the lower courses, beaded capping on the hips and ridge. The plaster is laid on in broad ochre blooms and pink-lavender patches, the stones showing only where it has fallen away. The shadows are painted from the cottage's own sun: a blue-lavender band under the eaves, cooler shaded walls, the bench's shadow, the house's shadow on its landing and the meadow. The cottage now faces the sun across its pond, as in the reference, and stands in the water's mirror. No ivy. |
| 8 | Navigation in Wander: sideways turning backwards, moving too slow; W A S D, Q E | Sideways drags turn the other way (you hold the scene), drags toward you glide 70 % faster. W A S D walk (about 4.6 m/s in the meadow, faster higher up; Shift runs), Q rises and E descends as the wheel does, the arrows turn and walk. |
| 9 | A page per iteration, the old ones kept | Versions, above. |
| 10 | Don't trade graphics for performance | Nothing new was traded away, and the one earlier cut is undone: the lakes' cloud mirror is back at full resolution (it was a third). |
| 11 | The headline should say Garden of Muse | The headline, the browser tab, the postcard and the fallback screen. |

Checkpoint images: [docs/checkpoints/iteration-5](docs/checkpoints/iteration-5/)
(the cottage across its pond and from four sides among them).

### How it is built (summary)

- **The sun each place sees** (render/sun.ts and sun.glsl), shared by the
  CPU and the GPU: cloud and bird shadows, the cottage, its ground shadow and
  the layout's choice of the cottage's front all use it.
- **Shadows and reflections from orbit:** two cube maps of optical depth in
  direction space (R16F): where the clouds' shadows reach the ground (1536² a
  face on high, 768² on low) and the cover seen from below (768², drawn only
  from orbit). Each puff is projected onto a face from the planet's centre;
  only faces holding ground in sight are drawn.
- **Birds and butterflies:** closed-form in time and tied to the planet;
  butterflies from a lattice fixed in direction space.
- **The cottage:** procedural faces and courses (about 26k triangles), painted
  per pixel; its reflection is traced against three solids in the water's
  shader, only for water pixels whose mirrored ray passes near it.
- **The layout** turns each world's cottage to face its sun, so the
  homestead view, the lakes and the default stand differ from iteration 4.
- **Frame budget:** the build queue takes what the frame's JS has left (to
  3.6 ms) and never starts a step that would not fit; tile builds yield every
  1/256 of a tile (the same points, finer steps).

### Squint test (the vista against the still, mean ΔE76 per cell)

| | Overall | Far meadow and clouds | Lake and islands | Near meadow |
|---|---|---|---|---|
| Iteration 3 | 24.5 | 15.5 | 34.2 | 23.8 |
| Iteration 4 | 22.3 | 16.0 | 23.6 | 27.2 |
| Iteration 5 | 23.5 | 16.6 | 24.4 | 29.5 |

Slightly worse than iteration 4, all in the near-meadow third: the brighter
wind crests (note 4) lighten the grass there (#71907c against the still's
#68874d). The guard (fails above 26) passes.

### Measured (iteration 5)

Apple **M1 Pro**, headless Chromium through ANGLE on Metal, frames back to back
waiting for the GPU; runs vary by about ±1 ms. Iteration 4 in brackets. The
default Wander stand and the cottage view are new places (the layout changed).

| Viewport | ms / frame | Grass in visible pages | Flowers in visible pages |
|---|---|---|---|
| 1440×900 at DPR 2, Overview | 7.8 (8.0) | – | – |
| 1440×900 at DPR 2, Wander, R 128 m | 6.6 (8.7) | 164k | 18k |
| 1440×900 at DPR 2, Wander, R 400 m | 7.2 (6.7) | 131k | 23k |
| 1440×900 at DPR 2, Vista | 18.0 (16.1) | 152k | 36k |
| 1440×900 at DPR 2, lakes view | 19.9 (16.1) | 163k | 13k |
| 1440×900 at DPR 2, cottage view | 18.3 (16.5) | 151k | 22k |
| 390×844 @1.5 (phone, low tier), Overview | 1.9 (2.0) | – | – |
| 390×844 @1.5 (phone, low tier), Wander | 2.3 (2.2) | 41k | 6k |
| 390×844 @1.5 (phone, low tier), Vista | 4.7 (4.2) | 40k | 15k |

- **Where the water views' extra time goes:** the lakes' cloud mirror at full
  resolution again (about 3 ms of it), the cloud cube maps, and the cottage
  traced in the mirror near it.
- **GPU memory:** 175 MB on high at 2560×1440 (151 MB before), 208 MB at
  2880×1800; 51 MB on a phone (low tier). The budget is 256 MB.
- **Growth scrub:** JS p95 under 4 ms (the invariant passes 8 runs out of 8).

### Trades (iteration 5)

None new. Still standing from earlier iterations: cloud self-shadowing one
value per puff; lumps from a baked cube map; bird shadows as soft discs; the
13-step bank march; quick bake while growing; 256² field maps; MSAA only below
DPR 1.75. The eaves' shadow is drawn a little shallower than the geometry
would cast it, as the painters do (a choice of look, not of speed).

### Known issues (iteration 5)

- **Water views cost more** (19.9 ms for the lakes view at 2880×1800 on an M1
  Pro); a slower machine would lower its render scale there (the quality
  controller from iteration 1, unchanged).
- **The cottage's reflection** is three plain solids: no chimney, stair or
  bench in the water, and its edges are hard where the ruffle is calm.
- **Birds** are on screen nearly all the time in Wander and by the cottage,
  less often over open lakes (about one moment in ten).
- **Squint 23.5**, against a goal of 14: the vista's foreground and its cloud
  (iteration 4's notes) still stand.
- **Carried over:** the warp's flat band on the way down; triangle figure,
  pools after a scrub, tier probe, LOD-ring test.

### Next (iteration 5)

1. Composition of the vista (flowers in front, the cloud upper right).
2. The cottage's reflection with its chimney and stair, softer edges.
3. Then dawn and golden hour, graded the same way.

## Iteration 4: the six review notes

| # | Note | What changed |
|---|---|---|
| 1 | Clouds soft and hazy rather than sculpted; closer to the references without a big perf loss | Clouds are solid now. Each puff is a sphere with a lumpy, cauliflower outline (the lumps baked once into a small cube map and shared by the cloud, its shadow and its reflection), antialiased to a pixel. The heap is lit lobe by lobe: soft creases where lobes meet, shading from the puffs between each lobe and the sun, a white top, blue-grey shade, and a little meadow green at the base. A cloud near the camera erodes from its edges instead of fading into fog. |
| 2 | From above, clouds and lakes look like generic noise: longer streaks, larger patches, swirly and natural | **Clouds** follow weather: a flow over the sphere (four or five vortices spiralling in or out, plus banded east–west winds) is traced into streamlines spaced about a cloud's width apart, and clouds are strung along them, long axis with the flow. A cloudiness field, smoothed along each line, decides which stretches hold cloud: broad patches where neighbouring lines are all cloudy, single streaks trailing off, small cloudlets at the fringes, clear sky between. Streaks swell and thin, and their spacing wanders. **Lakes:** every meadow field (wetlands, hills, lushness, flower drifts) is sampled through four twirls, the direction turned about a centre by an angle that fades with distance, so lakes, islands and drifts curve and swirl. |
| 3 | Cloud shadows deeper and a little sharper | Default strength 0.72 → 0.88, a deeper and cooler green under them (reds drop, greens and blues hold), a steeper edge, and a 2048² shadow map on high (R16F, the same memory as the old 1024² RGBA). The shadow has the cloud's lumpy outline. Flowers under a cloud now dim with the grass while keeping their hue. |
| 4 | Pinks slightly darker and redder; more whites and yellows; bunched more | Pink cups regraded toward rose; species weights pink 0.21, white stars 0.35, yellow buttons 0.33, blue 0.11. Clumps now cover 30 % of a drift (was 40 %) at about three times the drift's density, with barer grass between (floor 6 %). |
| 5 | Small flocks of white birds | Flocks of five to eleven white birds fly loose figure-of-eight circuits a few meters up: one over the cottage's pond, a few over the wetlands, and one that keeps you company about a point just ahead of the view. Two-panel wings beat in bursts between glides; birds bank into the turns; each casts a small soft shadow through the clouds' shadow map. |
| 6 | The hut jumps out: a painted warm-white stone wall, stone shapes near the edges only, a slightly crooked roof | The cottage is repainted, not rebuilt as the film's: solid limewashed walls (no separate bricks) where stones show only at the corners (quoins), around the openings, along the plinth and in a few flaked patches, with damp at the foot and ivy climbing one corner; walls lean and belly a little. The roof's ridge sags, one eave droops, the slopes dip, and the slates wander in mossy courses. The landing is flagstones and coursed stone with a painted arch at the waterline. Soft painted light (warm sun, lavender shade), cloud shadows pass over it, and the black outlines are gone. |

Checkpoint images: [docs/checkpoints/iteration-4](docs/checkpoints/iteration-4/).

### How it is built (summary)

- **Clouds:** up to 512 clouds of eight puffs, written each frame into one
  data texture (13 texels a cloud: header, puffs, and each puff's
  self-shadow, traced on the CPU). Billboards are fitted to each puff's exact
  clipped screen bounds (Mara and McGuire), so a cloud above the frame costs
  nothing; clouds the warped ground hides are culled on the CPU by testing
  sightlines against the water table. The fragment shader reads its cloud by
  row and traces it in two light loops (no per-pixel arrays: register
  pressure was the cost).
- **The lakes' mirror:** the cloud billboards are drawn a second time, at a
  third of the resolution, from the camera mirrored in the water's level
  plane under the focus; a point of that plane lands on its own pixel from
  either camera, so the water looks its reflection up at its own pixel,
  shifted by the wind's ruffle. Replaces tracing eight clouds per water
  pixel (the lakes view went from 23 to 16 ms).
- **Twirls:** shared by the CPU fields and the GPU bake, so picking and
  placement stay exact (the CPU/GPU parity test passes unchanged).
- **Birds:** closed-form in time (frozen frames stay deterministic), one
  instanced mesh with wing hinges in the vertex shader, and a disc each in
  the clouds' shadow map.
- **Cottage:** procedural faces built on a 0.2 m grid; every vertex carries
  its distance to the nearest edge and corner, its height and an ivy weight,
  and the shader paints from those.

### Squint test (the vista against the still, mean ΔE76 per cell)

| | Overall | Far meadow and clouds | Lake and islands | Near meadow |
|---|---|---|---|---|
| Iteration 2 (lakes view) | 30.8 | 35.4 | 32.7 | 24.2 |
| Iteration 3 (vista) | 24.5 | 15.5 | 34.2 | 23.8 |
| Iteration 4 (vista) | 22.3 | 16.0 | 23.6 | 27.2 |

The goal is 14; the test fails above 26. The lake band improved most (more
water across the middle, and reflections). The near-meadow third got worse:
this vista's foreground is a strip of grass and white stars, where the
still's is thick with mixed flowers. The vista search now treats clouds as a
bonus rather than a penalty (there are many more of them) and refines 28
stands instead of 16.

### Measured (iteration 4)

Apple **M1 Pro**, headless Chromium through ANGLE on Metal, frames back to back
waiting for the GPU; runs vary by about ±1 ms. Iteration 3 in brackets
(same script and viewports).

| Viewport | ms / frame | Grass in visible pages | Flowers in visible pages |
|---|---|---|---|
| 1440×900 at DPR 2, Overview | 8.0 (4.3) | – | – |
| 1440×900 at DPR 2, Wander, R 128 m | 8.7 (5.2) | 155k | 30k |
| 1440×900 at DPR 2, Wander, R 400 m | 6.7 (10.8) | 143k | 32k |
| 1440×900 at DPR 2, Vista | 16.1 (12.6) | 152k | 36k |
| 1440×900 at DPR 2, lakes view | 16.1 (17.9) | 172k | 15k |
| 1440×900 at DPR 2, cottage view | 16.5 (–) | 163k | 21k |
| 390×844 @1.5 (phone, low tier), Overview | 2.0 (1.6) | – | – |
| 390×844 @1.5 (phone, low tier), Wander | 2.2 (1.8) | 36k | 15k |
| 390×844 @1.5 (phone, low tier), Vista | 4.2 (3.8) | 40k | 15k |

- **What the clouds cost:** about 2–3 ms at this size wherever big clouds
  fill the sky (Overview, the default Wander, which now faces a cumulus up
  close, and the cottage view), and less than iteration 3 where the old
  per-pixel mirror was expensive (the lakes view). The default Wander and
  the Vista are different views from iteration 3's: the terrain changed.
- **GPU memory:** 151 MB on high at 2560×1440 (149 MB before), 184 MB at
  2880×1800; 45 MB on a phone (low tier).
- **Vista search:** about 1 s the first time on a world (0.7 s before: the
  twirls make each field sample dearer, and more stands are refined); 0.5 s
  after.

### Trades (iteration 4)

- **Cloud reflections** come from a third-resolution render from the
  mirrored camera, treating the lakes as one level plane under the focus:
  far lakes, where the planet curves away, reflect a little out of place
  (the ripples hide it), and there are none from orbit.
- **Cloud self-shadowing** is one value per puff (traced on the CPU from the
  puff's sunward side), not per pixel: a lobe is lit or shaded as a whole,
  softened by its own normal.
- **Cloud lumps** are four patterns in a 64² cube map, turned per puff, not
  noise per pixel.
- **Clouds near the camera** erode away within about 20 m; you never stand
  under one.
- **Bird shadows** are soft discs in the 2048² cloud shadow map (about four
  texels at R 128), not their wing shapes.
- **The cottage** is painted per pixel with a few noise lookups; no shadow
  map: its eaves' shadow on the walls is painted, its shadow on the ground
  is the analytic footprint as before.
- Carried over: the 13-step bank march; quick bake while growing; 256² field
  maps; MSAA only below DPR 1.75; grass 180 blades/m² within 22 m.

### Known issues (iteration 4)

- **Composition:** the vista finds water across the middle, but its
  foreground is often plain grass, and its cloud seldom sits where the
  still's does. Squint 22.3 against a goal of 14.
- **Overview costs 8 ms** at 2880×1800 (was 4.3): about ninety clouds in view,
  each traced per pixel.
- **Mirror approximations:** reflections of clouds close above far lakes can
  slide a little against their clouds; mirrored cloud order is the camera's,
  not the mirror's, so two overlapping reflected clouds can composite in the
  wrong order.
- **Birds** are plain from below at a distance (a white shape with raised
  wings); they read best from above, as in the reference.
- **The growth-scrub invariant** (build slice under 2.6 ms) failed in 3 of
  12 runs during this iteration (2.6 to 4.1 ms), and passed 3 of 3 at
  iteration 3's commit: it sits close to its limit and is sensitive to load.
  The last three full runs passed.
- **Carried over:** the warp's flat band on the way down; triangle figure,
  pools after a scrub, tier probe, LOD-ring test.

### Next (iteration 4)

1. Composition: a vista whose foreground is thick with flowers and whose cloud
   sits upper right (or a few vistas to choose from).
2. Cheaper clouds from orbit (a lower-detail path for small, distant clouds).
3. Birds that take off from the meadow when you come close.
4. Then dawn and golden hour, graded the same way.

## Iteration 3: the six review notes

| # | Note | What changed |
|---|---|---|
| 1 | Clouds disconnected from their shadows and reflections; lower; more of them | One cloud system. Low cumulus (bases about 5 m up) in banks of one to four, several times as many. The same puffs draw each cloud, cast its shadow (a sun-space map) and show in the lakes (traced along the mirrored ray), so the three always agree. The high deck and the clouds painted into the sky are gone. |
| 2 | The dark pond edges are reflections of the meadow; water too cartoony; no clean constant-width line; more natural, 3D edges | The water is a mirror over a navy body. The banks' reflection, marched over the terrain with its lip and grass, is the dark band under every shore, and it widens and narrows with the bank. The fixed-width band, the teal shallows and the lily pads (now off by default) are gone. Wetland islands are flat turf plates with a short, darker bank face; grass grows to the water's edge. |
| 3 | Colours should follow the reference | Grass, brush, bud, cloud and water rows re-measured from the still (median colours per region) and regraded in linear light; a grey-green haze that thickens toward the meadow pales the distance like the still's far meadow. |
| 4 | Flowers still evenly spread | Three scales: drifts (60 % of the ground, nearly bare between), species colonies within them, and dense two-meter clumps. Pink and stars share clumps; pink and buttons never do. Near flowers and the far paint read the same fields. |
| 5 | One time of day first | The time slider and the dawn and golden-hour presets are gone (the palette keys stay for later). Late-morning light, graded against the still. |
| 6 | The test: a match to the still when you squint | `npm run squint` renders the new **Vista** view (also a button) and compares it with the still, both shrunk and blurred, per cell in CIE Lab. Mean ΔE went from 30.8 (iteration 2's best view) to 24.5. The vista is found by searching the planet for the still's layout. |

Checkpoint images: [docs/checkpoints/iteration-3](docs/checkpoints/iteration-3/).

### How it is built (summary)

- **Clouds:** eight puffs per cloud in one data texture a frame. Billboards
  fitted to the puffs, traced per pixel (soft rims and base, billows, depth
  written so hills hide them); puffs splatted into a sun-space optical-depth
  map that the ground and the field map read once; the lakes trace the ten
  nearest along the mirrored ray. Count ∝ R and size ∝ √R, so they keep their
  scale; a cloud the camera is in thins away.
- **Water:** the mirrored ray, nearest first: banks (a 13-step march over the
  terrain, starting near the shore distance and skipped where it cannot reach
  land), clouds, then the sky painted as cobalt. Mirror against navy body by
  viewing angle.
- **Vista and the warp:** the warp's curvature now follows the zoom: true
  sphere from orbit, a nearly flat plain on the way down (where the vista
  sits, so the meadow runs to a far horizon), the 60 m roll at eye level. The
  vista search ranks stands inside the bloom by casting view rays to the water
  table and comparing water per row and cell with the still, then refines the
  best for clouds and flowers in view.
- **Flower clumps:** baked drifts and colonies × clumps evaluated per pixel
  and per flower (tiles freeze their clump settings).

### Squint test (the vista against the still, mean ΔE76 per cell)

| | Overall | Far meadow and clouds | Lake and islands | Near meadow |
|---|---|---|---|---|
| Iteration 2 (lakes view) | 30.8 | 35.4 | 32.7 | 24.2 |
| Iteration 3 (vista) | 24.5 | 15.5 | 34.2 | 23.8 |

The goal is 14; the test fails above 26, as a regression guard. Colour per
material is now close (far meadow #94af97 against #9db7a7, near meadow
#708f5b against #68874d). Most of the remaining gap is composition: the
still's lake runs the full width of the frame with islands, and this
planet's wetlands give ponds and channels at that scale; the still's big
cloud sits in frame, while the vista's clouds mostly show as reflections.

### Measured (iteration 3)

Apple **M1 Pro**, headless Chromium through ANGLE on Metal, frames back to back
waiting for the GPU. Iteration 2 in brackets.

| Viewport | ms / frame | Grass in visible pages | Flowers in visible pages |
|---|---|---|---|
| 2560×1440 (1440p, DPR 2), Overview | 4.3 (4.1) | – | – |
| 2560×1440, Wander, R 128 m | 5.2 (10.0) | 165k | 19k |
| 2560×1440, Wander, R 400 m | 10.8 (12.1) | 145k | 39k |
| 2560×1440, Vista | 12.6 (–) | 161k | 28k |
| 2560×1440, lakes view | 17.9 (13.2) | 180k | 47k |
| 390×844 @1.5 (phone, low tier), Overview | 1.6 (1.3) | – | – |
| 390×844 @1.5 (phone, low tier), Wander | 1.8 (6.6) | 41k | 4k |
| 390×844 @1.5 (phone, low tier), Vista | 3.8 (–) | 35k | 14k |

- **GPU memory:** 149 MB on high at 1440p (cloud shadow map 8 MB, larger
  grass and flower pools); 45 MB on a phone (low tier).
- **Where the lakes view goes:** the water is about 7 ms of it (bank march
  about 2 ms, cloud mirror about 2.8 ms); the clouds' billboards 0.7 ms.
- **Vista search:** about 0.7 s the first time on a world (cached after).
- Wander got cheaper mostly because the default stand sees less water.

### Trades (iteration 3)

- **Cloud mirror:** only the ten clouds nearest the camera reflect, without
  their billows (the ripples soften them anyway).
- **Bank reflections:** a 13-step march with three refinements, so very
  distant hills behind a far shore are missed; it starts near the shore
  distance (an estimate from the local slope), so a sliver of a nearer island
  in another direction can be skipped.
- **Cloud shadows:** from a 1024² map over the whole planet (512² on low):
  about 0.4 m per texel at R 128, softer at R 400. Their shapes follow the
  puffs but not the billows.
- **Clumps in the paint:** evaluated only where flowers grow; the billows of
  the clouds are one noise octave.
- Carried over: quick bake while growing; 256² field maps; MSAA only below
  DPR 1.75; grass 180 blades/m² within 22 m; no shadow-map pass for the cottage.

### Known issues (iteration 3)

- **Water-heavy views cost more:** the lakes view is 17.9 ms at 1440p on an
  M1 Pro (13.2 ms before); an M1 Air would need the render scale lowered.
- **Composition:** the vista's lakes are ponds and channels, not the still's
  broad lake with islands; its clouds rarely sit in frame.
- **Clouds** are soft rather than sculpted; from the meadow they read as
  hazy heaps on the horizon.
- **The warp's flat band** makes the descent from orbit flatten the world
  before it rolls up again at eye level; it reads as a landing, but it is a
  visible change of curvature.
- **Triangle figure, pools after a scrub, tier probe, LOD-ring test:** as in
  iteration 2.

### Next (iteration 3)

1. Composition: wider lakes with islands at vista scale (or a vista that
   frames from higher up), and clouds that sit in frame.
2. Sculpt the clouds (sharper billows on the sunlit side).
3. Trim the water's cost (mirror at lower resolution, or fewer clouds traced).
4. Then dawn and golden hour, graded the same way.

## Iteration 2: the six review notes

| # | Note | What changed |
|---|---|---|
| 1 | Remove the mountain and the rivers | Gone, with their parameters, cloud banks and camera preset. They live in git history at 9ddb8f2 if they come back. |
| 2 | Water lackluster; low-framerate glimmers | New painted water: teal shallows to ultramarine depths, a dark band under the banks, sky and clouds mirrored along the reflected ray, wind ruffles that break the mirror, sparse lily pads. Glints now swell and fade on their own slow sine and never shrink below a couple of pixels (the old ones popped to new places twice a second). |
| 3 | Lakes and meadow should interlace naturally | One water table: lakes are wherever the ground dips under it, so every shore is a contour of the hills. Wetlands (a macro field in rest space) lower the meadow so the table sits mid-relief there: islands, spits and inlets, not open water. Hummocks grow in the wetlands; banks get a short turf lip; everything runs long along a grain. |
| 4 | Flowers too even: patches, density, species, sizes, colours | A parametric colony system: per-species colonies covering a share of the ground set by the species' weight, bare and rich ground, damp ground for the pink cups; sizes follow lushness; colour variants per colony (blush to coral pinks, cream and lilac whites, lemon to golden with a few orange and red buttons, cornflower to violet). Near flowers and far paint read the same fields. New panel parameters: patchiness, patch size, size variation, colour variation. |
| 5 | 天光云影共徘徊: light and cloud shadow drifting across | A high broken cloud deck drifts with the wind: painted into the Wander sky, mirrored in the lakes, and casting brushed-edge shadows that sweep the meadow. Shadow cools and deepens the light; sun warms it. Puff clouds still drift in Overview (they shrink away as you descend). |
| 6 | Wind patterns: waves and ripples dancing with the light | Broad gust bands and quicker ripples travel with the flow. Where they lay the grass over, blades and paint take a pale sheen, brightest in sun; the grass between the bands reads deeper. |

Checkpoint images: [docs/checkpoints/iteration-2](docs/checkpoints/iteration-2/).

### How it is built (summary)

- **Terrain bake:** the meadow fields (relief, wetlands, lushness, colour
  variant, flowers per m² per species) are baked into two direction-space
  cube maps and read back with one fetch. A quarter-size set is baked every
  frame while R or a slider is changing; the full set once things hold still.
- **Flowers:** the scatter layer gained classified layers. Each tile is seen
  first on a 4×4 field grid, then each point is sorted into one pool per
  species or dropped by rank against the local density. Each species mesh
  draws only its own flowers.
- **The default view** now stands at the edge of the nearest wetland, a few
  meters from the water, looking across it. The `range` camera preset is now
  `lakes`.

## Measured (iteration 2)

Apple **M1 Pro**, headless Chromium through ANGLE on Metal, frames back to back
waiting for the GPU (real throughput, full clocks). Iteration 1 in brackets.

| Viewport | ms / frame | Draws | Grass in visible pages | Flowers in visible pages | GPU memory |
|---|---|---|---|---|---|
| 2560×1440 (1440p, DPR 2), Overview | 4.1 (2.7) | 21 | – | – | 151 MB (119) |
| 2560×1440, Wander, R 128 m | 10.0 (8.8) | 26 | 165k | 30k | 151 MB |
| 2560×1440, Wander, R 400 m | 12.1 (11.3) | 26 | 145k | 24k | 151 MB |
| 2560×1440, lakes view, R 128 m | 13.2 (–) | 27 | 156k | 20k | 151 MB |
| 390×844 @1.5 (phone, low tier), Overview | 1.3 (0.8) | 14 | – | – | 40 MB (34) |
| 390×844 @1.5 (phone, low tier), Wander | 6.6 (3.7) | 19 | 41k | 11k | 40 MB |

Other figures:

- **Terrain bake:** a full bake is about 7 ms of GPU; the quick set baked
  while growing is about a quarter of that. Neither runs at rest.
- **Field maps** (ground, light, wind around the focus): about 0.6–2 ms of GPU
  per frame at 256²; skipped in Overview.
- **JS per frame:** 0.6–0.9 ms. **First frame:** 270–500 ms.
- **CPU/GPU parity:** terrain height within 1.3 cm, distance to the shore
  within 5 cm, warp within 0.01 mm.
- **Where the frame goes (Wander, R 128):** the ground's pixel shader is about
  4 ms of it (water ~1.7 ms, meadow paint ~1.2 ms, wind ~0.5 ms, cloud light
  and brushstrokes ~0.3 ms each).

Not measured directly: an M1 Air (about half this GPU) would be around
20–26 ms in 1440p Wander, so the live controller would hold 60 fps by lowering
render scale to roughly 0.75. iPhones are not available here.

## Trades (quality for performance)

- **Bake while growing:** a quarter-size bake each frame, the full one once
  still. Shores are a little softer during the Grow animation.
- **Field maps:** 256² on high (was 384²). Grass masks along shores are
  slightly softer.
- **Clouds for vegetation:** blades and flowers take cloud shadow without the
  brushed edge; the ground shadow uses the deck's first octave only (the sky
  and the reflections use both).
- **Ripples:** evaluated only close to the camera (pixel footprint < 0.6 m).
- **Puff clouds:** not reflected while hidden (down in the meadow).
- **Noise:** the corner hashes share their per-axis products (bit-identical,
  a third of the integer multiplies).
- Carried over from iteration 1: MSAA only below DPR 1.75; grass 180
  blades/m² within 22 m, 5-vertex blades; wind and cloud fields per texel of
  the field maps rather than per blade vertex; a 17² terrain grid; no
  shadow-map pass (analytic cottage shadow).

## Known issues

- **Cost is up:** Wander at 1440p costs 10–13 ms on an M1 Pro (8.8 ms in
  iteration 1), more in water-heavy views. Phone Wander roughly doubled. The
  water and the meadow paint are the next places to trim.
- **Triangle figure:** the HUD's count is an upper bound (instances in visible
  pages, before the vertex shaders thin them); in Wander it reads above the
  1.5 M budget.
- **Golden hour and dawn:** still read heavy and dark (unchanged from
  iteration 1).
- **Default Wander framing** is chosen procedurally (the nearest wetland edge)
  and is sometimes better from the `lakes` view a little higher up.
- **Pools after a scrub** fragment until tiles rebuild (no compaction yet).
- **Benchmark:** `auto` still picks the tier from a fill-rate probe.
- **LOD-ring test:** still a Playwright `fixme`; crack-freeness is proven on
  the CPU for every edge.
- **Stones:** only near the cottage.

## Next

1. Trim the water and paint shaders back toward iteration 1's frame time.
2. Grade pass at dawn and golden hour.
3. Bring the mountains back as a distant painted range, if wanted.
4. Real-scene tier benchmark; pool compaction; measure on an M1 Air and an
   iPhone.

## Iteration 1: one full pass, S0 → S11

| Stage | State | Notes |
|---|---|---|
| S0 Scaffold | ✅ | schema + URL sync, HUD, harness, shots, invariants |
| S1 Planet core | ✅ | cube-sphere, rest-space points, CDLOD, growth band; no-swim and density tests pass |
| S2 Look foundation | ✅ | palette texture with time-of-day keys, soft toon, haze, sun, tone curve, bloom, grain |
| S3 Terrain and water | ✅ | (replaced in iteration 2) |
| S4 Grass and wind | ✅ | 5-vertex blades from rest space, shared wind map, gusts that travel, paint cross-fade by rank |
| S5 Flowers and bloom | ✅ | four original species, bloom front, buds, petal lift (colonies added in iteration 2) |
| S6 Cottage and props | ✅ | stone cottage, landing with arch, steps, rail, bench; outlines on props only |
| S7 Clouds | ✅ | drifting clusters with shadows (deck added in iteration 2) |
| S8 Warp and camera | ✅ | warp in every pass, Overview ↔ Wander, picking through the warp |
| S9 Growth polish | ✅ | fades, time-sliced builds, press-and-hold bloom layer |
| S10 Performance | ◐ | measured on an M1 Pro; M1 Air and iPhones not measured directly |
| S11 Polish | ◐ | control bar, hints, postcard; final grade is a first pass |

## Interactions (all wired and testable)

1. Drag orbits (Overview) or glides and turns (Wander); wheel or pinch dollies between them. Double-click glides to the point. Keys: W A S D walk, Q rises and E descends, the arrows turn and walk, Shift runs.
2. Grow: slider plus a play button that runs growth to the far end in about 8 s, or back.
3. Bloom: slider plus a play button for the bloom front.
4. Click on the meadow: a gust ring bursts outward; grass and flowers bend and recover.
5. Click on water: a ripple ring spreads.
6. Press and hold on the meadow: flowers bloom in a growing disc stored in rest space.
7. Vista: the button glides to the view framed like the reference still (time of day is set aside for now; the `tod` URL key still works).
8. Wind strength and direction.
9. Seed: re-roll; the same seed always gives the same world.
10. Reset: defaults and the default camera.

Every state lives in the URL hash, including the camera pose (`pose=`) and frozen time (`t=`).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server on :5173 (add `#hud=1&t=12` etc. to the URL) |
| `npm run check` | tsc (app and node) plus ESLint |
| `npm test` | Vitest CPU invariants (68 tests) |
| `npm run test:gpu` | Playwright browser invariants (determinism, parity, scrub, budgets) |
| `npm run shots` | 15 screenshots into `/shots` (`MEADOW_GL=swiftshader` for the CPU rasterizer) |
| `npm run squint` | the vista against `reference/howls-lake.webp` (kept out of git), shrunk and blurred: mean ΔE, and `shots/squint.png` |
| `npm run build` / `npm run build:single` | `dist/`, or one self-contained `dist-single/index.html` |
