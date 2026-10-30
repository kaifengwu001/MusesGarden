# Progress

The plan and the growth model are in [ARCHITECTURE.md](ARCHITECTURE.md). This
file tracks what is done, what is known to be wrong or missing, and what comes
next.

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

## Measured (iteration 3)

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

## Trades (quality for performance)

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

## Known issues

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

## Next

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

1. Drag orbits (Overview) or glides and turns (Wander); wheel or pinch dollies between them. Double-click glides to the point.
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
| `npm test` | Vitest CPU invariants (50 tests) |
| `npm run test:gpu` | Playwright browser invariants (determinism, parity, scrub, budgets) |
| `npm run shots` | 15 screenshots into `/shots` (`MEADOW_GL=swiftshader` for the CPU rasterizer) |
| `npm run squint` | the vista against `reference/howls-lake.webp` (kept out of git), shrunk and blurred: mean ΔE, and `shots/squint.png` |
| `npm run build` / `npm run build:single` | `dist/`, or one self-contained `dist-single/index.html` (729 kB) |
