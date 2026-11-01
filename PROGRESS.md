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

## Muse's hut: the interior (in progress)

Started from eeda5d5, on the branch `hut-interior` in a worktree of its own
(other sessions share the main checkout). Kai's brief (2026-11-01), with two
references kept out of git: a mock-up of the hut with its roof off, seen from
above at an angle with the room inside (reference/hut-interior/cutaway.jpg),
and a red and cream rug (reference/hut-interior/rug.webp). With them, a
library of Tripo models for the furniture, moved from the Desktop into the
project (src/assets/interior; the display cabinet's first try is kept in
reference/hut-interior).

| # | Note | What changed |
|---|---|---|
| 1 | An interior for Muse's hut: cozy and lived in | The room inside the cottage's walls (life/hut.ts): a floor and the walls' inner faces fitted to the walls as props.ts builds them, nine pieces of Kai's furniture stood in their places (each model scaled to its height in meters, set square where Tripo made it askew, its picture drawn at 1024²), the rug cut out of Kai's picture. Muse stands in the room while you are there. |
| 2 | A hearth or stove radiating warm light | The stove's fire lights the room (hut.frag.glsl): warm, flickering, falling off over a few meters and wrapped softly round what it lights, with a candle on the table and the lantern on the desk; daylight soft from above as if the roof were on, a warmer bounce from the floor; the corners, the walls' feet and the floor round what stands on it darker. |
| 3 | Dark wooden floors and furniture | Dark staggered planks with their grain, seams and a worn path; ochre limewash over stone inside, the stones showing low down. The furniture is Kai's dark wood. |
| 4 | A large showpiece shelf holding Muse's favourites, opened with the finds' glowing dot, line and card | One big display cabinet along the blind left wall (Kai's later notes). In the room it shows a single glowing dot; tap it and the camera turns to the cabinet (from the front of the room, not straight on) and comes in until it fills half the screen, whatever stands in front of it dissolving (life/occlude.glsl). There a small white dot stands on each favourite (fifteen places, three shelves of five): tap one and its line rises to its card beside the cabinet (the find's card: Muse's favourites, 3 of 15; ← → for the next). The favourites come from the source (`favourites` in the snapshot); without them the garden picks one a topic, newest first. |
| 5 | You go in by clicking the door while Muse is inside or about the hut | The door is picked on screen (its outline projected, seen from in front); with Muse out, or out in the meadow, a line says so (and offers Find Muse). The cottage button's arrival says to tap the door. |
| 6 | The camera rises to an almost orthographic cutaway (the roof off, seen from above at an angle) | view/cutaway.ts: from wherever you are, the camera rises and its view narrows to 15°, the roof lifting off and dissolving, until the room is seen as in the mock-up (from 39° round to the right, 69° down); clouds near the line of sight draw back; the tiny-planet warp eases out so the room stands square. Drag turns round the room, the wheel comes closer; Step outside (or Esc) goes back down the same way to exactly where you were, the roof settling on. |
| 7 | The interior's Tripo models move into the project | src/assets/interior: nine models and the rug. |

Kai's notes on the first pass (2026-11-01), done:

- **The layout after Kai's second mock-up:** the hearth in the middle of the back wall under the chimney, the pots and pans hung high right over the stove, the dish cabinet beside it, the bed in the back corner on the right with its head against the back wall, the low shelf along the right end toward the front, the table on the rug in the middle, the desk under the front window, the armchair by the fire. The back window is closed from inside (the hearth stands in front of it); outside it is still a window.
- **The chimney is not a solid block:** in the cutaway it settles onto the back wall over the hearth, its top a dark flue with soot round its mouth.
- **The cut shows the walls' make:** the front and the right end are cut low and straight, just over the front's door and window, the back and the left end stand whole, each high wall's end standing upright where it meets a low one. The cut shows rubble stone in its mortar with the plaster's skin at each face, dark timber plates along the walls' tops and the lintels over the door and the window; the plaster along the cut is broken, its stones showing.
- **The last step clipped with the grass and flickered:** it lay flush with the meadow (three risers and the ground). Now there are four equal risers, the last step a riser over the meadow, and the grass is kept a little farther from its foot; Muse walks down the four.

Then (2026-11-01, done):

- **A layout editor** (temporary: `?edit` in the address; ui/garden/hutEditor.ts): in the cutaway, Edit layout; tap a piece or pick it from the list and a gizmo square to the hut stands on it to move it (along the walls; its middle slides it over the floor, the up arrow lifts it), turn it about up or scale it (snapping to 5 cm, 15°, 5 % if asked); its light, its shadow on the floor and the favourites' places go with it. Export gives each piece's foot, turn and size as text. **Kai's layout from it** is now the room's: the hearth 1.7 times as big, set into the back wall left of the middle; the low shelf to its right with the pots and pans hung over it; the dish cabinet beyond the hearth; the showpiece cabinet taller (3.24 m); the bed bigger in the back corner on the right; the table low and wide on a bigger rug, turned a little; the desk under the front window.
- **Scrolling out at the showpiece** goes back to the room's view (Kai's note), as Back to the room and Esc do, and puts an open card away.
- **The front walls cut lower,** across the window and the door (1.25 m over the floor; the front and the right end alike): the window's frame and panes and the door's planks are cut with the wall (their CUTAWAY builds), the cut stops either side of the openings, and the right end's window lies wholly over it; the lintels are no longer in the cut.
- **The chimney:** outside it is no longer a solid block (its top is a dark flue with soot round it, the one change to the cottage's look outside besides the steps); in the cutaway it lifts off and dissolves with the roof (it used to slide onto the back wall, which looked strange).
- **Asleep, Muse lies in the middle of the bed,** its head against the pillow, not over the headboard (55 cm toward the bed's foot from the mattress's middle as Tripo made it), and sunk into the mattress rather than floating over it (12 cm lower).
- **The cut through the walls** shows their stones in courses as the cottage does outside where its plaster has fallen away (two courses across the wall's thickness on top, the walls' own courses on the upright ends), pale as the cut catches the light, their joints soft (the first cut's rubble was too dark and unlike the walls); **the door cut through** shows thick (12 cm of planks in section, warm as the door outside), the cottage's own door unchanged outside.
- **The home flag follows the door:** Muse's portrait says at home and the cottage's "out" sign comes down while Muse is about the hut (within 30 m), as the door opens then.
- **The door opens while Muse is about:** home, or pottering in the meadow within 30 m of the hut (it was shut whenever Muse stepped off the homestead, two thirds of its day); while laying the room out, always.
- **Muse in the hut answers you** (a tap and it turns to you, a hold and it is petted, hearts and all), and each visit finds it doing one of three things (Kai's note): **asleep on its bed** (a quarter of visits: lying back along it, its head on the pillow, its snore bubble; a tap and it stirs), **greeting you** on the rug (a wave as you come in, its eyes on you, a wave now and then), or **cooking at the hearth's stove**: at the hearth's right front, turned to the pot, the ladle out of its pocket, stirring and tasting as at the porch's stove, four rounds and a look about, again; steam off the pot, and the porch stove left in its embers (museRoam.ts `inside`, museProps.ts: a cook's pot of its own).

The meadow outside the cutaway draws pixel for pixel as before in every standard view, at 2× and 1× (check-frames samecheck against eeda5d5), but for the steps in the cottage view (Kai's fix) and orbit, which differs against itself too (the Muse pin's pop-up). `npm run check` and `npm test` (758 tests, 8 of them new: hut.test.ts) pass.

Known: the models are the stand-ins (see the pipeline test below), about 580k triangles and 28 MB together; the display cabinet is drawn out 1.4 times across to fill the wall, its things with it (a wide cabinet from Tripo would drop in). Muse is lit by the sun outside, not by the fire. The water's mirror still shows the roof. The cutaway's materials compile on the first knock (a hitch then).

**A test of the 3D pipeline (2026-11-01).** Kai made the display cabinet
twice. The second ("(1)") is properly built: square posts, flat panels,
modelled doors and handles, separate books, a glass case with a mortar in
it, in 14.9k triangles, its 2048² texture much sharper (1.17 MB against
318 KB). The first is melted clay: rounded, wavy posts, its doors painted
onto a lumpy slab, in 53.9k triangles spent evenly, flat panels included.
The other eight models are all of the first kind (the eight come to 566k
triangles), so the advice was to make them again the second way, the
straight-edged furniture first (table, bed, desk, dish cabinet, both
shelves). Until then they stand in: each is fitted to its place by size as
it loads, so a new file drops in under the same name.

## Fern lives on the first planet (2026-11-01)

The engine had given Fern, the hero, a planet of its own: seed 1031, starting at R 52 m and growing as it
explored. Kai's call: Fern lives on the meadow, the first planet, because it is the one that is tuned. Fern's
`worldSeed` is 412, and a Muse on the first planet starts at the meadow's tuned size (R 128 m, growth 0.1886),
as if it had explored that much already; it grows from there as it explores more. The page with
`?garden=/api/muses/hero` now draws the meadow exactly as it is without the engine.

The first planet stays as it is: its seed, size and look are Kai's to change, and the rest of the team builds
other worlds beside it. The rules are in [CLAUDE.md](CLAUDE.md), and `npm test` holds them
(`params.test.ts`, `cast.test.ts`, `garden.test.ts`). A local garden seeded before this change (`.muse/`)
has to be deleted and seeded again.

## Muse's shadow, clean and still (2026-11-01)

Kai's note: Muse's shadow could be very low-res and flickering, most of all on
the terrace and over bare ground, with jagged edges on the ground and on Muse.
Muse was splatted into the clouds' shadow maps: on the ground and the props it
was read at the sharper window's texels (about 7–8 cm near the ground), its
outline a staircase that crawled as Muse moved; the grass and the flowers read
it through the field map (coarser, and a frame late); and Muse read the map a
meter aside to miss its own shadow, which a wide pose didn't always.

Now Muse has a map of its own: 512² over the few meters round it (about 5 mm a
texel standing; its half-width in steps of 0.25 m from 0.9 m, so the texels
keep their size as it moves), centred among its body's spheres carried down the
sun, so it travels with Muse and its texels never crawl. The ground, the props,
the grass, the flowers and the finds' patches read it (the plants where they
stand, as the field map had them), its edge softened over about 2 cm; Muse
never reads it, and reads the clouds' shadows where it stands. The shadow is
as dark as before (0.920 of the lit terrace before, 0.921 now).

Checked: outside Muse's shadow the meadow draws pixel for pixel as before in
the standard views (the cottage view and bird's-eye differ only in Muse's
shadow; orbit differs even against itself, by the Muse pin's pop-up). On the
terrace with a still camera, one-frame flicker went from 47 px a frame (782 at
worst) to 5 (39). `npm run check`, 750 tests, the GPU invariants (14 pass) and
the live suite (11) pass. Cost: within the noise of a busy machine (best of 10
alternating rounds at 2880×1800, at most about 0.3 ms a frame with Muse in
view; turning it off at runtime moved frames both ways).

## Muse's life on the engine, in Kai's garden (muse-agent)

The Muse agent's backend, designed in [docs/muse-agent.md](docs/muse-agent.md),
now feeds Kai's garden interface. Merged into main on 2026-11-01.

### What it does

- **The engine.** Each Muse has an append-only event log, folded into its state. A seeded policy picks each episode:
  - explore the planet, rest, work, or meet a friend
  - work pauses Muse where it is
  - rest is at most 4 h a day
  - at most one basket a day, of at most 7 finds
  - at most five photos a day

  `npm run sim -- --hours 504` runs the nine-Muse cast for three weeks and checks these.
- **Finds are real.** Each one is a reel, post, article or video from the recording `server/fixtures/media.json`. `npm run record:media` makes it from `server/fixtures/media-sources.json`. Instagram comes through Business Discovery, with `META_IG_TOKEN` and `META_IG_USER_ID` in the environment, never in the repo. The topic map only names topics and links them; nothing Muse finds comes from it.
- **Likes nudge Muse's interests.** The nudge weakens as Muse matures, but never below half.
- **Friends come three ways:**
  - Owners share their Muses; those two meet within 48 h.
  - Owners are friends on Instagram or Facebook (a simulated graph in `cast.json`).
  - Strangers meet beyond the planet, which is rare.

  Friendships rarely end. Unpleasant hangouts make a pair distant instead.
- **Invitations.** The guest's owner picks Travel now or Keep for later. An invitation is good for one visit, any time, and only the sender can withdraw it.
- **Sharing.** Every interest is shared until the owner hides it. A find is public unless the owner makes it private.
- **The garden API**, served by `npm run serve`:
  - `GET /api/muses/:id/garden` is a snapshot.
  - `GET /api/muses/:id/garden/events` is a live stream that resumes from `Last-Event-ID`.
  - `POST /api/muses/:id/garden/reactions` takes likes, sharing and invitations.

  Open the page at `/?garden=/api/muses/hero`. Add `&dev` for the dev tools: B hides them, and Advance runs the clock.
- **On the planet.** Each find is a patch of its interest's flowers, where Muse found it. Opening a basket flies its finds there. That basket's patches stay tinted and 1.3× larger until another basket is opened. From high up, each find is a glowing sphere: hover lights it, and a tap flies down to it.
- **The post.** A card swipes away in any direction to show the next. The pile shows at most six cards.

### Checked (2026-11-01)

- **`npm run check`.** Passes.
- **`npm test`.** 656 pass. The divergence test timed out under load and passes alone (5 of 5).
- **The 3-week sim.** All 9 checks pass.
- **The live end-to-end suite.** `npx playwright test -c playwright.live.config.ts` passes 11 of 11 against the real engine: a basket arrives and flies, hover, spheres, likes and sharing read back after a reload, reconnect, a card of each kind, a friend known online, and Travel now once.
- **GPU invariants.** 12 of 14 pass. The two timing budgets fail at load averages of 40 to 170 (33.4 ms against a 20 ms frame budget). The same branch without the patches change fails them identically, so the load is the cause, not the patches.

### Open

- **The recording is small** (118 items, 17 from Instagram):
  - Over three weeks every Muse sees most of it, so the cast converges on the same interests.
  - Strangers make about 10 friendships instead of about 1.
  - Instagram is 13% of what Muse brings home, against a 65% target.
  - Fix: record bigger. The recorder reads every source either way, so a bigger recording costs no extra time.
- **The recording's contents:**
  - Leave ads and sale promotions out.
  - Keep disambiguation topics such as "Jazz (word)" out of filing.
  - Replace the four Instagram accounts that answer "Invalid user id": mokuhangamagic, david_rumsey_maps, ilovetypography, langorigami.
- **Meta's model is waiting on billing.** It answers HTTP 402 `billing_not_configured`. Until then the hero runs on the heuristic mind, and the precomputed 14-day run can't be made.
- **The Instagram token expires about 2026-12-30.** It's a long-lived user token, renewed in the Graph API Explorer.
- **The garden page:**
  - Planet growth and new interests reach an open page only on a reload.
  - The Muse pin and Find Muse should follow the 3D Muse the engine drives.
  - Sharing controls belong in the interface: what Muse shares, friends, and unsharing one.
  - The basket banner covers the top line of an open find card.
- **Rendering:**
  - Kai's poses for rest, laptop work, photos and hanging out.
  - Fog over unexplored areas.
  - Measure on a real phone; 400 finds' patches add about 630k triangles by the CPU count.
- **Writing the hero's own SOUL.md and MEMORY.md.** The descriptions only reach Muse through Meta's model. The heuristic mind reads only the temperament numbers and the interest topics.

## The terraces: a second planet (in progress)

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
| 1 | A second planet that we can visit, using the same procedural fundamental logic | |
| 2 | Hilly terrain, with fog meandering between the mountains | |
| 3 | Terraced rice paddies | |
| 4 | Not all paddies are filled with water and reflective: some are fully grown, green waving rice, some in between, others fully reflective | |
| 5 | Subtle colour differences from one paddy to another | |
| 6 | Not all hills are covered by paddies: some hillsides are trees | |
| 7 | White flocks of birds circle between the valleys | |

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

## The garden's interfaces (alongside iteration 16)

Started from 73de432, on the branch `garden-interfaces` in a worktree of its
own (iteration 16's work on Muse shares the main checkout, and its
half-made changes broke the shared dev server mid-capture). Kai's brief
(2026-10-31), with the ideas doc (MG1, the brainstorm with Tracy) and the
backend plan as references. Two corrections to the backend plan: what grows
on the planet is only what Muse chose to keep or gave you in a basket; and
finds are not only Instagram reels, but posts, news articles and the like
too. (The backend plan itself, a Messages attachment, could not be read:
macOS keeps that folder from the tools.)

The look: the clean, elegant interface the meadow already has; the post
box, the postcards and the invitations very skeuomorphic (拟物), physical
models even; in the meadow's painted style, with Travel Frog as the main
reference. Placeholders for the media and posts, used over and over, and
for Muse's postcards screenshots taken in the world of two Muses, one
waving.

| # | Note | What changed |
|---|---|---|
| 1 | Finds (reels, posts, news articles) in cards above their flower patches. Planted: a small patch blossoms from its centre, then the card pops up | Each find grows as a small bed of the meadow's own flowers (findBeds.ts): its topic's species, bunched, a little taller, with a few companions of the other species, shaded by the meadow's palette, wind and cloud shadows (from the near field's maps, as the flowers'). A basket's beds form its patch; the patches wind outward from the cottage, the oldest day nearest home (placement.ts: on dry ground, clear of the clearing and of each other). A basket you have not seen is planted as you arrive: the camera lands framing its first find, the beds blossom from the middle out one after another (each stem rising with a little overshoot, then its head opening), then a line rises from the first bed and its card pops up on it. The card is drawn from the find's fields, never an embed: a reel or a video with its picture and length, a post with its caption, an article with its site, headline and reading time. |
| 2 | Browsing: tap a plant or a bed and a line rises, the card pops up; swipe left or right (or the arrow buttons) to the next find, flying round the world; a like button; an example gallery; the hook a backend fills (placeholders for now) | Tap a bed: the camera flies to it and its card rises. Swipe the card, press its arrows or ← →: it leaves to that side, the camera flies to the next find (view/flight.ts: skimming the meadow under the clouds; a hop most of the way round the planet climbs over them) and the next card rises. Newest basket first, each in Muse's order. The heart sends the like back to Muse and pins the find. The gallery: ten interests, six baskets of finds over the last ten days (reels, posts, articles, a video), the pictures flat illustrations drawn as SVG (garden/art.ts). **The hook** (garden/source.ts): a `GardenSource` with `load()` (everything as of now), `subscribe()` (a new basket, a postcard, Muse coming home) and `react()` (a like, an interest shared or kept, an invitation used). `?garden=<url>` reads a backend over HTTP (GET /garden, server-sent events from /garden/events, POST /garden/reactions); without it, the placeholders. The shapes are in garden/types.ts. |
| 3 | Pins in the world: liked finds and Muse; toggle them on and off; only in orbit and in view (no off-screen pins) | Pins stuck in the globe (pins.ts): a heart-headed pin for each liked find, a round one with Muse's face for Muse (at the cottage, or where it is when out). Only from orbit (the planet hides those round the back), a steady size on screen, their heads turned to you, popping up with a bounce. Tap one to fly there. The rail's pin button turns them on and off. |
| 4 | Postcards, after Travel Frog: the card's design; an on-screen post box (preferred to Muse's hut for now): tap it, it pops open, a stack of cards, a gallery; one card flies forward to like or put away; a new card on login raises the box's flag, with a notification | The post box, bottom right, is a model in a canvas of its own (ui/garden/postbox.ts): a painted rural mailbox on a wooden post, grass and three flowers at its foot, drawn only while something moves. New post raises its red flag (with a little waggle now and then) and shows the count on a tag. Tap it: the door drops open, the cards rise to its mouth and fly out into a loose stack, the newest on top; the meadow's chrome steps back. Tap a card: it flies forward; tap again (or Space): it turns over to its back (POST CARD, the place and the day, with whom, a stamp of the planet, a postmark, a mitten print). Like it, or put it away: it shrinks into the album, where every card is held at its corners. Opening the box collects the post: the flag comes down. The postcards are five photos taken in the world: Muse (waving) with a friend in an apricot coat (src/assets/postcards, .postcards.mjs). |
| 5 | Invitations to other worlds, in the postcard system with a special notification; a button near the post box to travel | An invitation arrives as a postcard carrying one; the box gets a wax seal besides its count. In the stack it is a sealed envelope; up close its flap lifts, the card is drawn up and out and the envelope drops away: You're invited, the world (an illustration), from whom, good for one visit, Travel now or Keep for later. Above the post box, a paper ticket (a seal on it while an invitation waits) opens Travel: the worlds you are invited to. Boarding stamps the ticket and the visit begins: other worlds are not built yet, so the meadow is re-seeded and re-planted as a stand-in (its own hills, wetter ground, white and blue flowers), your beds, pins and Muse left at home, until Return home. |
| 6 | A button to go to Muse's house, showing when Muse is not home | The cottage button flies to the homestead view. When Muse is out, a little wooden sign saying "out" hangs on the button, Muse's portrait says out exploring, Muse is not on its terrace, and arriving at the cottage says the door is shut. (The status comes from the source; Muse's page has a preview switch until the backend sends it.) |
| 7 | Baskets: the history as a timeline; tap one to go to its place on the planet | The baskets sheet: a timeline, newest first, each day with Muse's name for it, its finds as small pictures with their flowers' colours, how many and which topics; one not yet visited is marked new (and the rail's basket shows a dot). Tap a day: the camera flies to its patch (planting it, the first time) and its first card rises. |
| 8 | A button to find Muse and jump to it | Find Muse flies to Muse where it is on its day, from in front of the terrace. When it is out, to where it is, at a bird's height, with a line saying so. |
| 9 | Muse's page: its interests (with sharing and privacy), its friends, tagged when a friend's human is a friend of yours on Instagram or Facebook | Muse's portrait opens its page: its soul.md line (all it carries into the garden), where it is, and three tabs. Interests, each with its flower's colour, since when, and a switch: shared with other Muses, or private (never leaves the planet). Friends: Muses it has met, by their own names only, their coats, when they met, the interests they share, and "You're friends on Instagram" (or Facebook) where their human is your friend there. Privacy: what Muse brings into the garden, in plain words, and three preferences kept in this browser for now. |

Checkpoint images: [docs/checkpoints/garden-interfaces](docs/checkpoints/garden-interfaces/) (a [contact sheet](docs/checkpoints/garden-interfaces/contact-sheet.jpg) of the whole flow).

### Checked

- In the browser (headless Chromium on Metal, 1440×900 and an iPhone-sized 390×844), every step driven through `window.__garden`: the first visit's toast, planting, browsing (three cards), a like, the pins from orbit, the post box open, the stack, a card up close and turned over, the invitation, the album, the three sheets, the cottage, find Muse, Muse out, a visit and the way home. No console errors.
- `npm run check`; `npm test`: 118 tests, 14 of them new (garden.test.ts: the beds on dry ground, clear of each other and of the cottage, in their patches, the first in the middle, the oldest patch nearest home, the same every time, on the real terrain at three sizes; the gallery; the state; the hook's requests).
- `npm run test:gpu`: 11 pass. Its "scrubbing growth" frame budget failed twice in a row on the branch, then also failed once on a clean checkout of main; alternating the two after that, both passed three times out of three (the machine was busy).
- `npm run shots`: 15 pass. Postcard mode hides the garden's interface.

### Cost

The beds over a planted patch, frames back to back (High, 1440×900): 0.4–1.6 ms a frame at 1×, 0.6–1.3 ms at 2×, with the numbers noisy because another session was using the GPU. It does not scale with the plants: a sixth of them, or one of the four draws alone, costs the same, so it is a cost paid once by the first draw, not per vertex; not yet found. The pins draw only from orbit; the post box draws in its own small canvas only while it moves.

### Known issues

- The beds' fixed cost (above) is not explained yet.
- A visit is a stand-in (the meadow re-seeded), until other worlds exist.
- The post box's model and the cards are first drafts for Kai's eye: colours, proportions, the stamp and the mitten print.
- Muse's whereabouts and the privacy preferences are placeholders until the backend sends them.
- The interface is in English only, and the backend plan is still unread (above).

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
