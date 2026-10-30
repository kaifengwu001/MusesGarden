# Garden of Muse: architecture and growth model

This is my restatement of the brief, plus the engineering decisions that make it
hold together. The code follows this file. When a stage changes a decision, this
file changes in the same commit.

## The idea

A small round world you can take in at a glance. It is an alpine spring meadow
with wildflowers in drifts, blue channels and still ponds, one stone cottage by
a pond, a snow range on one side with heavy low cloud against it, and deep blue
sky paling to haze. It should feel like a painted background that came alive.
Underneath, it is a parametric planet whose **surface area** grows. The land
grows, the things on it stay human-sized, and nothing slides, pops or changes
identity as it grows.

## Four spaces

| Space | Coordinates | Holds | Changes with growth |
|---|---|---|---|
| **Rest** | unit direction ω on the sphere | identity and location of every feature: direction, seed, rank | never |
| **Face** | (face, a, b), 6 × [-1, 1]² on the spherified cube | quadtrees, chunks, point hierarchies, atlases | never |
| **Planet** | meters, P = ω · (R + h) | what the GPU draws before the warp | R and h |
| **View** | P′ = warp(P) | what you see | every frame, as the focus moves |

The rule: **identity and placement come from rest space, sizes come from
meters, and only the meter distance *between* things depends on R.** No system
ever picks "a random position at the current size".

The cube-to-sphere map is the spherified cube,
`x′ = x·√(1 − y²/2 − z²/2 + y²z²/3)` and its permutations, not `normalize()`.
It is close to equal-area but not exactly (cells vary by ×1.33). Its area
element J(a, b) is derived analytically (sphere area per unit face area:
0.5 at a face centre, 0.577 at edge midpoints, 0.433 at corners) and divided
out wherever density matters. The inverse map is closed-form.

## Growth

`g ∈ [0,1] → A = lerp(A_min, A_max, smoothstep(g)) → R = √(A / 4π)`.
The defaults are A = 20,106 → 2,010,619 m², which is R = 40 → 400 m. The
default g = 0.1886 gives R = 128 m and A ≈ 206,000 m².

- **Stretches with R (macro, set in direction space):** where the mountains,
  ponds, channel nodes and cottage are, the macro terrain shape, and mountain
  height (a landscape proportion, so height ∝ R).
- **Never scales (meters):** blade height, flower size, channel width, shore
  band, pond depth, cottage, stones, lily pads and eye height.

### Progressive point sets (constant density per m²)

Every scattered class (grass, each flower species, stones, lily pads, petals)
has its own hierarchical point set over the six faces. Each set uses its own
hash salt, so classes never coincide.

1. Level ℓ divides a face into 4^ℓ cells and holds **exactly one point per
   cell**. Going to ℓ+1, the parent's point stays in whichever child contains
   it, and the other three children each get a new jittered point. Every
   complete level is a stratified set.
2. The 3·4^ℓ new points of a level are born in a fixed order: child slot
   first, then parent cell in scrambled bit-reversed Morton order. Any prefix
   therefore covers the face evenly, which makes the set progressive and
   blue-noise-like. A point's rank can be computed in O(1) from its cell, so a
   single chunk can be built without enumerating the planet.
3. The rank gives a birth density τ (points per unit face area). Dividing by J
   gives one scalar per point, `u = τ / J(a, b)`, in points per steradian. A
   class with density ρ per m² shows point *i* once `ρ·R² ≥ u_i`, that is, at
   its **birth radius** `R_i = √(u_i / ρ)`. So the visible count is
   ρ · A · coverage by construction. Coverage is whatever water, rock and snow
   leave free, applied as a mask.
4. A point's seed (a hash of class, face, level and cell) gives its species,
   tint, size jitter and wind phase. Its direction never changes. Scrub g
   from 0.3 to 0.7 and back, and the same points appear, then disappear in
   reverse order.

### Fades that stay deterministic

A wall-clock fade per point would make each frame depend on how you scrubbed.
Instead the planet keeps one extra scalar, **R_lag**, which follows R with a
1.5 s exponential lag in log space. A point's fade is where its birth radius
sits inside the band between R_lag and R:

    v = clamp((hi − ln R_i) / max(hi − lo, 0.015), 0, 1),   hi = max(ln R, ln R_lag),  lo = min(ln R, ln R_lag)

The 0.015 minimum keeps the band from collapsing to a hard step: at rest the
newest 3% of points sit partly grown, and nothing ever pops when growth stops.

- **Steady growth:** the band moves at the growth rate, so every new point
  scales and fades in over exactly 1.5 s.
- **Shrinking:** the same band runs in reverse. The newest points fade out
  first.
- **At rest:** R_lag = R, the band closes, and the frame is a pure function of
  (seed, params, time). Screenshots and tests settle the band first.

Macro unlocks (pond 2 at A₂, a channel branch at A₃, a mountain spur at A₄, …)
use the same band with a longer width, so they bloom in instead of popping.

### Terrain that grows without sliding

The relief is a sum of direction-space noise octaves: rolling hills plus
hummocks. Their weights depend on R so that the spectrum **in meters** stays
constant. An octave's amplitude is a function of its wavelength in meters
(λ_k · R): rolling hills peak at about 30–120 m, hummocks at 7–12 m. As R
grows, coarse octaves stretch out of the band and settle, and finer ones swell
in. Hills never slide; they rise and subside in place. The noise is compressed
along a grain axis from the seed, so hills, islands and inlets run long.

(Iteration 2 removed the mountain range and the river channels; they did not
look right. Both live in git history at 9ddb8f2 if they come back.)

### Lakes and the water table

There is one water table, h = 0. A lake is wherever the ground dips under it,
so every shore is a contour of the hills: water lies in the hollows between
them, and the hilltops stand out of it as islands.

- **Twirls:** every meadow field (wetlands, relief, lushness, colour variant,
  flower drifts and colonies) is sampled at a twirled direction: four
  rotations about random centres (two broad, two tight), each by an angle
  that falls off as exp(−(θ/ρ)²) from its centre, applied in turn, like a
  marbler's comb. Lakes, islands, hills and drifts curve and spiral instead
  of lying about as plain noise. It lives in direction space, so nothing
  slides as R grows, and the CPU fields and the GPU bake share it, so picking
  and placement stay exact.
- **Wetlands:** a macro field in direction space (two domain-warped octaves)
  says where the meadow sinks toward the table. Its threshold comes from the
  field's own sampled distribution, so the `wetlands` share is what you get,
  and the margin is wide so the hills interlace with the water across it.
- **Height:** relief + lift − (lift + sink)·wetness − water level. Uplands
  stand clear (a kettle pond in the deepest hollows); deep in a wetland the
  table sits near the middle of the relief, so a wetland is lace: islands,
  spits and inlets rather than open water. Hummocks grow there too, and the
  wetland ground flattens toward a plateau 0.55 m above (and below) the water
  (s·tanh(h/s), keeping 12 % of its slope), so islands are flat turf plates
  with a short bank, as in the reference.
- **Banks:** a lip, tanh(distance to shore / 0.3 m) × 0.2 m, lifts the land at
  the waterline and drops the water off, like a cut turf bank. The distance is
  height over slope (a finite difference one bake texel wide).
- **Wetlands live in rest space,** so they grow with the planet while the hills
  and banks inside them keep their size in meters; the share of water stays
  about the same from R = 40 m to 400 m (tested).
- **Homestead pond:** laid out in meters from the cottage (radius ∝ R^0.3, an
  outline and one islet in pond-normalized coordinates), carved into a dry
  plateau, so the cottage always stands by its pond with its landing over it.

### Bloom front

b ∈ [0,1] moves a geodesic front outward from the cottage. Its angular radius is
`θ_f = b · (π + margin)`, perturbed by direction-space noise. Each flower adds a
seeded delay, so the edge is ragged rather than a ring.

- Behind the front: full flower, lush tall grass.
- Ahead of it: shorter, paler grass and buds.
- At the edge: a thin band lifts petals.

The press-and-hold layer is a list of (direction, angular radius, start time)
discs stored in rest space. It survives growth and always covers the same
flowers.

## Chunks and the GPU data path (as built)

Changed during the build: terrain is evaluated on the GPU from rest-space
directions, with an exact CPU mirror, rather than computed per chunk on the
CPU. Growth then never waits on terrain rebuilds, and picking, placement and
tests still read the same fields from the CPU side.

- **Terrain bake:** the meadow fields (`fields.ts` / `fields.glsl`) are baked
  into two direction-space cube maps: terrain (natural height, lushness,
  wetness, colour variant; 512² per face) and flora (flowers per m² for each
  species; 256²). The ground, paint and vegetation read them back with one
  fetch. They are re-baked only when the fields change; while R or a slider
  is moving, a quarter-size set is baked each frame and the full set once
  things hold still (a full bake is ~10 ms of GPU on an M1 Pro).
- **Terrain on the GPU:** `terrain.glsl` reads the bake and applies the
  homestead and the bank lip from a direction. `Terrain.sample` in
  `terrain.ts` mirrors it for CPU use, evaluating the fields exactly (the bake
  is bilinear; parity is within 1 cm of height). The noise hashes integers
  (bit-identical in float32 and float64) instead of the usual mod-289 float
  noise, which rounds differently on the two sides.
- **Shores per pixel:** the water mask is the sign of the height, read per
  pixel from the bake, so shores are crisp at any mesh density. The mesh's
  bank lip widens with distance (CDLOD spacing grows with it), so far shores
  do not saw-tooth; it is a function of distance, not of the node, so the
  mesh stays watertight.
- **CDLOD:** six face quadtrees with one shared 17² grid and one instanced
  draw. The range factor is k = 5.5 and the morph runs over 0.9–1.0 of the
  range. The morph is symmetric: odd vertices blend toward the midpoint of
  their parent-grid neighbours. Classic CDLOD slides them toward one
  neighbour, which tears at cube-face seams where the two faces run the edge
  parameter in opposite directions. Crack-freeness is proven by test on
  every edge.
- **Culling:** the camera's view frustum. Horizon culling uses the true sphere
  in Overview and the warped curvature in Wander: ground of height H is
  hidden beyond √(2·R_eff·h) + √(2·R_eff·H).
- **Field maps:** every frame, three small passes (256² on high) evaluate the
  ground (height, distance to the shore, clearing, bloom), the meadow and its
  light (lushness, wetness, cloud shadow, colour variant) and the shared wind
  (bend vector, sheen). Each is an azimuthal projection around the focus.
  Grass, flowers and petals fetch these instead of re-running noise per
  vertex. They are skipped when no vegetation is in view.
- **Scatter layer:** handles grass, flowers and later stones. Quadtree tiles
  around the focus are enumerated from the rest-space point set by
  time-sliced jobs (64 steps per tile, pooled typed buffers). They go into a
  fixed instance pool split into pages and are drawn in one call. A page
  visibility texture culls whole tiles. Density falls off by rank toward the
  edge, so far tiles are built sparser. Re-tiling as R changes swaps region
  by region, which never leaves a hole and never deadlocks a full pool.
- **Classified layers (flowers):** a classifier sees each tile first (the
  flora fields on a 4×4 grid, from the CPU mirror), says how far the local
  density rises above the mean (the enumeration bound), then sorts each point
  into one pool per species mesh or drops it, thinning by rank against the
  local density. Each species draws only its own instances, so no vertex is
  spent on another species' flowers. R is quantised to 4 % steps for this,
  so a settled world never depends on its history.

### Flower drifts, colonies and clumps

Flowers per m² for each species come from `fields.ts`, in three scales:

- **Drifts** (18 m, long along the grain): where the meadow flowers at all,
  60 % of the ground. Between drifts the meadow is nearly bare.
- **Colonies** (13 m × the species' scale): which species hold a stretch of a
  drift, each covering a share set by its weight. Damp ground suits the pink cups.
- **Clumps** (about 2 m): dense knots and the gaps between them. Two noises:
  pink clumps where the first is high, stars where the second is, buttons and
  blues where they are low, so pink and stars mix but pink and buttons never
  share a clump.

With patchiness p (default 0.95), a species' density is
ρ·w·N·(1 − p + p·drift·colony)·clumps, with N chosen so the mean stays ρ·w.
Drifts and colonies are baked; clumps are too fine for the bake, so the paint
evaluates them per pixel and the classifier per flower (with the clump
settings frozen per tile, so a tile built over several frames is built from
one state). Each flower also gets a size (lusher ground grows bigger flowers,
plus its own spread) and a colour variant, set per colony (blush → rose →
coral pinks, cream and lilac whites, lemon → golden → a few orange and red
buttons, cornflower → violet blues). The far paint reads the same fields:
dabs by species, and far away a wash of the clumps' colours.

The original plan, kept for reference:

- **Quadtrees:** six face quadtrees with CDLOD. Each node uses one shared grid
  mesh (33² on high, 17² on low). All selected nodes are drawn in **one
  instanced draw**, with per-node instance data (face, origin, size, morph
  range, atlas slot). Morphing in the vertex shader removes LOD seams and pops.
- **Node data:** computed on the CPU into an atlas texture and stored in
  **R-independent form**: noise octave values, angular distances to each
  channel centerline at each meander level, pond-local offsets, and biome
  fields. The shaders turn these into meters, with R as a uniform. Growth
  itself therefore never rebuilds terrain; only LOD refinement creates new
  nodes.
- **Vegetation tiles:** leaf nodes near the camera. Their instance buffers come
  from the point sets, with headroom above the current R, so growth only
  toggles visibility in the shader.
- **Build queue:** new nodes and tiles go through a priority queue time-sliced
  to ≤ 2 ms per frame. A parent stays drawn until its children are ready.
- **CPU evaluation:** the CPU can evaluate every field at any direction.
  Picking, prop placement and the tests use those functions, not GPU
  readbacks.

## Tiny-planet warp

`warp.glsl` is included by every vertex shader: terrain and water, grass,
flowers, props, birds, clouds and the shadow pass. `warp.ts` mirrors it
exactly on the CPU.

    t  = (P − F) − ((P − F)·U) U                  tangent offset from the focus F
    P′ = P − k |t|² U,   k = (1/R_eff − 1/R) / 2
    N′ = normalize(N + 2k (U·N) t)                 normals follow the bent surface

The ground near the focus curves like a sphere of R_eff, which follows the
camera's zoom z (warpForZoom in warp.ts): the true sphere from orbit; on the
way down (z ≈ 0.6–0.8) a nearly flat plain, R_eff = 12.5 R, so the meadow
reaches a far horizon like the reference painting (this is where the vista
sits); at eye level it rolls away like a small world, R_eff = R_v =
max(visualRadius, 0.15 R), 60 m by default even at R = 400 m. The blend is
in curvature (1/R_eff).

P′ moves only along U, so the inverse is exact: `P = P′ + k |t|² U`. CPU
picking marches the ray in warped space and unwarps each sample, so what you
click is what you see.

**Camera:**

- **Overview** orbits the whole planet at FOV 35°.
- One zoom parameter dollies smoothly down to **Wander**, a third-person glide
  about 1.6 m above the grass at FOV 55°.
- Double-click glides the focus along a great circle.
- **Vista** (`view/vista.ts`, the Vista button): a stand and heading framed
  like the reference still: meadow to the top of the frame, a band of lake
  across the middle, meadow in front, a cloud over the far meadow. The planet
  is searched for it: stands about 8 m apart inside the bloom, 12 headings,
  each scored by casting a grid of view rays to the water table through the
  warp and comparing the water's share per row (and per cell) with the still's
  layout (16 × 9, measured once), then the best few refined in place, heading
  and zoom, with the clouds and the flowers in view counted. The terrain
  stage is cached per world; a search takes about 1 s the first time.

## Look

- **Palette:** `palette.ts` generates a 16×16 sRGB texture. Rows are material
  families (grass, water, the flower species, sky, cloud, rock, snow, stone,
  roof, wood). Columns run light → shadow, then hue variations. Every colour in
  the world samples it. The grass, brush, bud, cloud and water rows are graded
  against the reference still (measured per region and squint-tested, see
  Invariants). One light for now: late morning. The time of day is hidden; its
  dawn and golden-hour keys stay in the palette for later.
- **Toon lighting:** `toon.glsl` has three bands with 0.08-wide soft
  transitions, a warm sun, a cool sky ambient from above, and a sun-side rim on
  grass and flower heads.
- **No outlines:** everything keeps soft, painted edges, the cottage too.
- **The cottage** is painted in the shader, never textured, in brush strokes
  (noise stretched along a stroke direction and stepped into a few tones):
  butter-cream plaster mottled ochre, pink and grey, rain streaks under the
  eaves, damp at the foot, a darker stroke down each corner, the stones only
  hinted near the corners and openings (each face vertex carries its
  distance to the nearest edge and corner), a cool shadow band under the
  eaves; a hipped roof bent out of true (sagging ridge, a drooping eave,
  dipping slopes) of tiles in courses, each lit along its foot and dark under
  the next, mossy in patches, with ridge and hip tiles; small-paned windows
  that mirror the meadow; a plastered landing with a brick arch at the
  waterline. Soft light (warm sun, cool lavender shade), and the clouds'
  shadows pass over it. One mesh, one draw call. The building is an
  original design.
- **Hills from orbit:** besides the toon bands, the ground takes a soft light
  and shade by how its slope faces the sun, gentle at eye level and strong
  from orbit, so hills a couple of meters high still read on the globe.
- **Aerial perspective:** distance pales the meadow toward a grey-green haze,
  thicker as the camera comes down into the meadow (the far meadow reads like
  a painted distance); the planet's limb from orbit dissolves into the sky's
  haze. Clouds take half as much, toward the sky's.
- **Far meadow:** painted brushstroke noise with flower-coloured dabs in the
  terrain shader. Near blades cross-fade into it with a dithered fade, never a
  ring.
- **Water:** painted, not simulated: a mirror over a navy body. Along the view
  ray mirrored off the level surface, nearest first: the banks (marched over
  the terrain plus its bank lip and grass; this is the dark band under every
  shore, as tall as the bank and the meadow behind it, so it widens and
  narrows along the shore), the clouds (read from the clouds' mirror pass at
  the pixel itself, nudged by the wind's ruffle), and the sky painted as the
  lakes' cobalt. Looking down into the water shows more of
  the navy body, looking across it more of the mirror (Fresnel-like). Wind
  ruffles streak the mirror; glints swell and fade on their own slow sine and
  never shrink below a couple of pixels; lily pads are off by default. The
  march starts near the shore distance and is skipped where the mirrored ray
  would climb above the highest meadow before reaching land. No refraction.
- **Clouds and their light (天光云影):** low cumulus, bases about 5 m above
  the meadow, drifting with the wind. Each cloud is eight puffs heaped over a
  flat base, written once a frame into a data texture (clouds.ts,
  clouds.glsl). The puffs are solid spheres with lumpy, cauliflower outlines
  (billows baked once into a 64² cube map, four patterns turned per puff),
  antialiased to a pixel; the heap is lit lobe by lobe, with soft creases
  where lobes meet, each puff's shadow from the others toward the sun, a
  white top, blue-grey shade and a little meadow green at the base. The same
  puffs draw the cloud (a billboard each, fitted to the puffs' clipped screen
  bounds, traced per pixel, its front's depth written so hills hide it), cast
  its shadow (puffs splatted with the same lumpy outline into a 2048² sun-
  space map of optical depth; the map has no depth, so only clouds on the
  sunlit half go in and only the sunlit half reads it, and clouds hidden from
  the camera still cast theirs) and show in the lakes (down in the meadow,
  the billboards drawn again from the camera mirrored in the water; from
  orbit, the cloud cover where each lake's mirrored ray meets the clouds, from
  a small cube map of the puffs seen from the planet's centre; the two
  cross-fade on the way down), so a cloud, its shadow and its reflection
  always agree. **Where** they are is weather: a flow over the sphere (four
  or five vortices spiralling in or out, and banded east–west winds) traced
  into streamlines about a cloud's width apart (Jobard and Lefer, the spacing
  wandering); clouds are strung along them, long axis with the flow, and a
  cloudiness field smoothed along each line picks the stretches that hold
  cloud: broad patches, long streaks, cloudlets at the fringes, clear sky
  between. Coverage sets the share. As R grows the lines stay put, cloud size
  grows with √R and the clouds along a line slide closer, so streaks stay
  whole. A cloud near the camera erodes from its edges. Shadows are a deep,
  cool green with brushed edges.
- **Birds:** small flocks of white birds. Most travel along great circles
  round the planet at 7.5–10 m/s, the circles slowly swinging so the routes
  meander over the whole meadow (one passes over the cottage); one circles
  the cottage's pond. Loose V and cluster formations, level flight a few
  meters over the water table (clear of the hills), banking from the path's
  turn rate, steady two-panel wingbeats with the odd glide, lifting over the
  cottage. Every pose is closed-form in time and tied to the planet. Each
  casts a small soft shadow through the clouds' shadow map.
- **Butterflies:** six kinds over the flowers when you are down in the
  meadow: instances over a block of 3 m cells about the focus, each cell's
  candidate kept with a chance that follows the flowers and the bloom; the
  flight (a wandering flutter, and rests on flowers with the wings fanning)
  is closed-form in the vertex shader.
- **Wind:** broad gust bands and quicker ripples travel with the flow (both
  advected exactly by rotating about the wind axis). Where they lay the grass
  over, blades and paint take on a pale sheen, brightest in sun; between the
  bands the grass reads deeper. The same field bends the blades and flowers.
- **Post:** tone curve, gentle highlight bloom, and about 2% static paper grain.

## Frame

The main pass renders into a linear HDR target, with MSAA only where it is
affordable (see Budgets), in this order: sky → terrain and water → props →
grass → flowers → birds → clouds → particles. Before it, each frame, the
clouds render their sun-space shadow map (with the birds' discs) and their
mirror (the billboards from the camera mirrored in the water, at a third of
the resolution). Post then draws to the screen.

One shared set of uniform objects (time, wind, warp, R, R_lag, sun, palette) is
referenced by every material, so each frame writes each value once.

## Determinism

- All randomness is integer hashing of (seed, class, face, level, cell, index).
  World code never calls Math.random.
- Time can be frozen from the URL (`t=12`) or from the test harness.
- The harness settles before capture: it drains the build queue and closes the
  fade band. Two loads of the same URL must produce byte-identical frames.

## State

`params.ts` holds one typed schema. Each field has a default, range, step, URL
key, and the kind of work a change triggers: `live`, `terrain`, `world`, `life`,
`quality` or `ui`. The panel, the control bar, presets and the URL hash all go
through one store. The hash holds only non-default values plus the camera pose,
so any view can be shared.

## Budgets and tiers

| | Desktop (M1 Air, 1440p, DPR ≤ 2) | Mobile (iPhone 15, DPR ≤ 1.5) |
|---|---|---|
| Frame rate | 60 fps | 60 fps (30 fps floor on iPhone 12) |
| Draw calls | ≤ 120 | ≤ 120 |
| Triangles | ≤ 1.5 M | ≤ 500 k |
| Visible grass instances | ≤ 250 k | ≤ 60 k |
| GPU memory | < 256 MB | < 256 MB |
| JS per frame | ≤ 4 ms | ≤ 4 ms |
| First frame | < 2 s | |

- **JS per frame:** the build queue (tile builds in the background) gets
  what is left of the 4 ms after the frame's own work, between 1 and 2 ms,
  and never starts a job step it expects to overrun (it keeps a slowly
  forgotten maximum of its step times).
- **Tier selection:** `auto` picks a tier from a short startup benchmark. A
  live controller lowers render scale, then the tier, if frame time stays high.
- **MSAA:** a 4× HalfFloat MSAA target costs about 56 B per pixel, about
  200 MB at 1440p with DPR 2, which would break the memory budget on its own.
  So MSAA is used only when the drawing buffer is small (DPR < 1.75). At DPR 2
  the pixel density does the anti-aliasing.
- **Trade-offs:** every trade of quality for speed is listed in `PROGRESS.md`.

## Invariants and how they are tested

| Invariant | Test |
|---|---|
| Determinism | Playwright: two loads of one URL at frozen time give an identical frame hash |
| No swimming | Vitest: sample features at g = 0.3 → 0.7 → 0.3; directions and seeds unchanged |
| Constant scale | Vitest: the homestead pond meets the landing in meters at five sizes; the share of water stays within a band from R 40 to 400; wetlands sit in rest space; the cottage geometry is size-independent |
| Constant density | Vitest: flowers per m² within ±5% at 9 growth values, both globally and in local patches |
| Attached | Vitest and Playwright: every prop, stone and flower base lies within ε of the warped terrain at 5 growth values |
| No LOD rings or pops | Playwright: a 10 s dolly from Overview to Wander; morph factors stay continuous and per-frame image deltas show no ring-shaped spikes |
| Picking | Playwright: CPU pick vs GPU position readback at 64 random pixels, error < 2 cm |
| Looks like the reference when you squint | Playwright (`npm run squint`): the vista and the reference still, each shrunk to 48 × 27 and blurred, compared per cell in CIE Lab (mean ΔE76; the still stays out of git, so the test skips without it) |

## Module map

    src/
      main.ts              boot, renderer, frame loop, quality tier wiring, input and UI wiring
      world.ts             the scene and every system; per-frame order; interactions
      params.ts            typed schema, store, URL query, presets
      core/                clock, hash sync, quality tiers, build queue, hashing, GPU memory ledger, shared uniforms
      planet/
        growth.ts          g → A → R, inverse
        cubesphere.ts/.glsl spherified cube, closed-form inverse, analytic area element
        rest.ts/.glsl      progressive point sets, birth radii, growth fade band
        chunks.ts          face quadtrees, CDLOD selection, symmetric morph (CPU mirror), culling
        surface.ts/.glsl   the instanced CDLOD ground: terrain, paint, cloud light, water
        noise.ts/.glsl     integer-hash gradient noise, identical on both sides
        fields.ts/.glsl    meadow fields: relief, wetlands, plateaus, patterns, flower drifts, colonies, clumps
        bake.ts            the fields baked into cube maps (quick while changing, full when still)
        terrain.ts/.glsl   layout from the seed, water table and banks, homestead
        water.glsl         painted water: the mirror (banks, clouds, sky) over a navy body, ruffles, glints
        meadow.glsl        painted far meadow, flower dabs and colours, bloom front, wind direction
        geo.ts             spherical arcs and travel
      life/
        fieldMap.ts/.glsl  ground, meadow and wind maps around the focus
        scatter.ts         tiles, paged pools (one per channel), classifier hook, page culling, re-tiling
        grass.ts/.glsl     5-vertex blades in the wind, sheen
        flowers.ts/.glsl   drift, colony and clump classifier, four species pools (meshes in flowerMeshes.ts), bloom, flutter
        petals.ts/.glsl    petals lifting at the bloom front and in gusts
        wind.glsl          one wind field: flow, travelling gusts and ripples, sheen, click rings
        clouds.ts/.glsl    low cumulus: flow and streamlines, puffs in a data texture, billboards, shadow map, mirror pass
        cloudLumps.glsl    the puffs' cauliflower lumps (baked cube map) shared by cloud, shadow and mirror
        birds.ts/.glsl     flocks of white birds on routes round the planet, wing hinges, shadow discs
        butterflies.ts/.glsl butterflies over the flowers near the focus, flight in the vertex shader
        props.ts/.glsl     cottage, landing, rail, bench: painted faces (edge and corner distances per vertex), one mesh
      render/
        palette.ts         16×16 palette generated in code, time-of-day keys, sun path
        toon.glsl          soft bands, three-tone materials, rim
        fog.glsl           aerial perspective
        warp.glsl / .ts    tiny-planet warp (GPU and its exact CPU mirror), its curvature by zoom
        sky.ts/.glsl       backdrop and dome, sun glow
        post.ts/.glsl      HDR target, bloom chain, tone curve, paper grain
        look.ts, glsl.ts   shared look uniforms; shader chunk registry
      view/                camera rig (Overview ↔ Wander), the vista search, input gestures, keys (W A S D, Q / E), CPU picking
      ui/                  title and metadata line, hints, control bar, lil-gui panel, postcard
      dev/                 perf HUD, GPU timer, harness (window.__meadow), parity, Playwright and Vitest
