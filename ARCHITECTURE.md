# The Meadow: architecture and growth model

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
- **Homestead pond:** laid out in meters from the cottage (radius 17–22 m at
  R 128, ∝ R^0.3; an outline and one islet in pond-normalized coordinates;
  in front of the cottage and 7 m to its left, under the pier), carved into
  a dry plateau, so the cottage always stands by its pond with its pier
  over it. The pond shapes the ground only within its widest outline plus
  the height its banks can reach (cheap tests first: the reflections' march
  reads the ground a dozen times a pixel). Where the turf drops to the
  water, the bank's face is shaded by the slope taken per pixel, so it
  follows the shore rather than the ground mesh's triangles.
  The cottage's clearing stands 1 m above the water (1.2 m with the bank lip),
  a terrace, and the pond's banks drop to the water steeply (0.9 m per m) as
  a cut turf bank; the pond's bed slopes gently (0.3) to its depth. The
  cottage faces the late-morning sun its place sees (the wettest way within
  70° of it), so from across the pond its front is in the light.

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

### The unfolding (branch `unfold`, an experiment)

How the planet opens up to a new player as Muse explores it: one value
u ∈ [0, 1], the control bar's **Unfold** in place of the radius slider
(`planet/unfold.ts`). It writes the growth; the panel's Growth and the
URL's `g` still work on their own.

- **u = 0:** the meadow at its tuned size (R 128 m), under a **veil** of
  ground fog everywhere but a ragged clearing about 45 m round the hut (its
  pond and pier in it): grass, no flowers (the bloom front at b = 0).
- **0 → ½:** the fog's edge recedes raggedly and the bloom front moves out
  from the hut behind it, both at an even pace in distance from the hut (so
  the side you face from orbit unveils steadily). The drifting clouds start
  thicker (coverage 0.75: not overcast) and ease back to the setting's
  (`unfoldCoverage`, the same to the bit from ½ on).
- **u = ½ (the default):** the meadow as tuned, unveiled and all in flower.
  It draws pixel-identical to main.
- **½ → 1:** the planet grows from R 128 m to R 400 m (g linear in u). The
  camera holds where it is (`CameraRig.holdThrough`): in orbit it keeps its
  distance from the centre, so the planet grows in the window (and fills it
  by about R 200 m); over the meadow it keeps its height, as the zoom stops do.
  Only growth the unfolding writes is held, not a URL, a preset or the engine.

**The veil** (`life/veil.ts`, `life/veilFog.ts`): ground fog, a sea of it
from orbit and a bank of it from the clearing, unlike the drifting clouds
from any distance (Kai: "fog from every distance"), beneath them. Where it
lies is a field over the sphere, each place's turn: how far the unfolding has
to go before it clears. The turn is the place's angle from the hut, pushed
about by a broad noise (bays and fingers) and a finer one (islands that
linger, holes that open early). The field is baked once per planet into a
cube map (`veilField.frag.glsl`, 256² a face, with the fog's bank heights and
its wisps, drawn out along the wind). Its CPU mirror (`veilTurn`) finds the
turn below which a given share of the planet lies, so the edge moves out at
an even pace; the fog softens over 1.5 m at it.

The fog is a fullscreen pass (`veilFog.frag.glsl`) after the ground and what
stands on it, before the clouds. Each view ray is marched in view space,
each sample unwarped onto the planet, from where it enters the layer until
it meets the ground (cut at it exactly, so the fog's foot has no steps),
leaves the layer, or the fog hides what lies behind. Its steps stride over
the clearing by the turn's distance to the edge. The fog is dense at the
ground (1.2 /m) and thins over the upper half of its top. The top lies in
banks 2–5.5 m over the ground, ±1.2 m of wisps, coming down to the ground
at its edge. It is lit pale on top and grey-blue in its depths, its banks'
slopes shaded to the sun, the drifting clouds' shadows softened on it where
the light comes in at its top. It writes the depth of its front, so what
stands in front of it hides it. The lakes don't mirror it: it covers the
lakes it lies on. The clouds' code is main's. Nothing of the fog is drawn
once all is clear.

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
- **CDLOD:** six face quadtrees with one shared 17² grid, instanced in two
  draws: the nodes reaching into the homestead's ground (its plateau, its
  pond and the cottage's shadow: discs from `Terrain.homeAreas`, flagged by
  the selection) with the full ground shader, and the rest with a build
  without the homestead's code (`AWAY_FROM_HOME`: the clearing, the
  cottage's shadow, the shade under the pier; their vertices read the baked
  ground alone). It draws the same pixels, but the ground's shader is large
  enough that code which never runs still slows every pixel (about 2 ms in
  the vista, 237 m from the cottage, through iteration 12). The water's bank
  march and the cottage in its reflection keep the homestead everywhere: a
  reflected ray can reach it from far off. The range factor is k = 5.5 and
  the morph runs over 0.9–1.0 of the range. The morph is symmetric: odd vertices blend toward the midpoint of
  their parent-grid neighbours. Classic CDLOD slides them toward one
  neighbour, which tears at cube-face seams where the two faces run the edge
  parameter in opposite directions. Crack-freeness is proven by test on
  every edge.
- **Culling:** the camera's view frustum. Horizon culling uses the true sphere
  in Overview and the warped curvature in Wander: ground of height H is
  hidden beyond √(2·R_eff·h) + √(2·R_eff·H).
- **Field maps:** every frame, three small passes (256² on medium, 512² on
  high) evaluate the ground (height, distance to the shore, clearing, bloom),
  the meadow and its light (lushness, wetness, cloud shadow, colour variant)
  and the shared wind (bend vector, sheen). Each is an azimuthal projection
  around the focus. Grass, flowers and petals fetch these instead of
  re-running noise per vertex. They are skipped when no vegetation is in
  view. They are drawn first in the frame, the meadow pass reading the last
  frame's cloud shadows: their shading costs almost nothing, but drawn after
  the clouds' passes the main pass, whose blades read the maps in their
  vertex shader, waited for both (about 1.3 ms a frame through iteration 12).
- **Scatter layer:** handles grass, flowers and later stones. Quadtree tiles
  around the focus are enumerated from the rest-space point set by
  time-sliced jobs (256 steps per tile, pooled typed buffers). They go into a
  fixed instance pool split into pages and are drawn in one call. The pool
  is two RGBA float textures, a page a row (direction and ln birth threshold;
  the seed, four to a texel, or the seed and a flower's size and colour), and
  the draw covers only the pages of tiles in view: a short list of them, in
  pool order, tells each instance which page and slot to read. Through
  iteration 13 the pool was a vertex buffer drawn up to its highest page, the
  pages out of view culled one instance at a time by a page table (911k
  instances drawn for 320k blades in view on High); the same frames to the
  pixel now cost 2.3–4.2 ms less on High near the ground, 0.7–1.9 ms on
  Medium. Blades thinned out and a page's empty slots leave the vertex
  shader before it reads the field maps. Density falls off by rank toward the
  edge, so far tiles are built sparser. Re-tiling as R changes swaps region
  by region, which never leaves a hole and never deadlocks a full pool.
- **Building ahead:** besides the near field itself, the layer wants a ring of
  tiles a tile wide beyond its edge (built after every tile inside it, drawn
  only once inside it: their blades would not show there anyway), so walking
  never finds a tile missing at the edge. Where the camera is headed (the end
  of a glide, the zoom asked for, a named view: CameraRig.aim), the tiles its
  frustum will see there are wanted too, ten meters behind the camera's own
  in the build order: they are built on the way, so the way down from orbit
  (the default start) has the meadow ready as it arrives. Only what it will
  see, so the pool never holds two whole near fields. A tile that needs more
  density as you approach keeps its pages until it is rebuilt.
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
- **As the unfolding grows the planet** (branch `unfold`), the camera holds:
  its distance from the centre in orbit, its height over the meadow from the
  bird's-eye stop down, easing between them (`CameraRig.holdThrough`).
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
- **The sun each place sees** (`sun.ts`, `sun.glsl`): one light, late morning,
  everywhere: the same elevation and bearing from local north (world +Y
  projected), climbing to the zenith near the poles so the field stays smooth.
  It is fixed to the planet, so shadows stay put however the globe is turned.
  The view is lit by the sun at the focus; cloud and bird shadows, the
  cottage and its ground shadow each use their own place's sun. Muse's
  shadow has a map of its own (`muse.ts`, `museShadowMap.glsl`): its skin
  carried down the sun at Muse to the water table, in about 5 mm texels over
  the few meters round it, carried along with it, its edge a little soft;
  the ground, the props, the grass, the flowers and the finds' patches read
  it (the plants where they stand), Muse never does.
- **No outlines:** everything keeps soft, painted edges, the cottage too.
- **The cottage** is bent round the planet: each vertex is placed by the
  terrain's cottage-local meters (the sine map round the cottage) and
  straight up from there (props.vert.glsl), so every wall stands square to
  the ground under it and the house sits exactly on its clearing and pond
  at every size. It is built after the meadow cottage of the reference
  painting, its design matched one to one at Kai's request after iteration 5
  (the first brief asked for an original building; that rule was lifted
  for the cottage). Measured from the painting (the ridge a third of the
  eaves' length, so the plan and the 45° pitch follow): a house 8.6 × 5.3 m,
  its floor 0.72 m over the meadow, the eaves 2.4 m over the floor and half
  a meter out, under a hipped roof of fourteen courses of tiles a side (each
  course's foot standing 3.5 cm proud: a lit lip and a painted line of
  shadow under it), beaded capping along the hips and the ridge, bent a
  little out of true. On the front a tall window toward the left end and the
  door right of the middle, a bench between them; a small window high on the
  right end toward the back; a chimney just behind the ridge on the back
  slope. A terrace along the front at the floor's height with three steps
  down to the meadow at its right end, and at its left end a stone pier out
  over the pond with an arched tunnel at the waterline (real geometry: its
  mouth, walls, half-round vault and a back wall 1.6 m in; the terrain cuts
  a channel of water in under it, and the water there lies dark, in its
  mirror too), an iron rail along its back and a wooden chair by the
  house's corner. Windows sit 0.22 m into the walls; the capping on the
  ridge and hips is bedded down into the slopes; the walls and the terrace
  are footed deep enough for the most curved planet. The pond lies in front and to the left,
  under the pier, and the layout keeps the cottage's sun ahead and to the
  left (the front lit, the right end in shade), as in the painting. Painted
  in the shader, never textured, in colours sampled from the painting: warm
  beige plaster in broad ochre blooms, faint stones showing through it and
  stones where it has fallen away near the corners and the foot (each face
  vertex carries its distance to the nearest edge and corner), damp at the
  foot; a warm grey-brown roof with a little olive moss low down; a plank
  door with iron straps; dark frames and small panes. The shadows are painted
  from the cottage's own sun: an olive-grey band down the top of each wall
  as deep as the sun is steep on it, olive-grey shaded walls with the
  meadow's green bounced in, every roof slope turned from the sun darkened
  even under a high sun, the bench's shadow on the wall, the house's shadow
  (walls and hipped roof) deep and cool on its terrace and the meadow, the
  clouds' passing over. The cottage, its terrace, its pier and its chimney
  stand in the water's mirror (water.glsl, cottageInMirror). The homestead
  view frames it as the painting does (from above the meadow in front and to
  the right, 26 m out): a named view may look up from the zoom's own tilt
  (`CameraRig.lookUp`), which eases away as soon as you drag, zoom or walk.
- **Muse's hut inside** (hut.ts, view/cutaway.ts): tap the door while Muse
  is in or about the hut and the camera rises off the meadow, its view
  narrowing to 15° (almost orthographic), held off the room by the rig
  (`CameraRig.held`) while the focus moves to the room, so the near field,
  the light and the fog are the room's; the tiny-planet warp eases out so
  the room stands square, and clouds near the line of sight draw back. The
  roof and the chimney lift off and dissolve, and the walls are cut
  straight: the front and the right end low, across the front's window and
  door, the back and the left end whole. The cottage draws with its own
  materials whenever the cutaway is shut (its door's planks turned on their
  hinge only while it stands open), so the meadow outside is untouched.
  Muse, about the hut when you knock, puts by what it was doing and walks in
  through the front door, which swings open as it comes and shut behind it
  (museRoam.ts comeIn), to greet you, cook at the hearth or go to bed; when
  you step out it walks out onto its porch (goOut), the room seen whole
  through the open door. Inside, Kai's furniture models is fitted into
  the room in meters and lit by the stove's fire, a candle and a lantern,
  with soft daylight from above as if the roof were on. Muse's showpiece, a
  display cabinet along the left wall, holds its favourites: its glowing dot
  turns the camera to it, what stands in front dissolving, and a white dot on
  each favourite opens its card as a find's does.
- **Aerial perspective:** distance pales the meadow toward a grey-green haze,
  thicker as the camera comes down into the meadow (the far meadow reads like
  a painted distance); the planet's limb from orbit dissolves into the sky's
  haze. Clouds take half as much, toward the sky's.
- **Far meadow:** painted brushstroke noise with flower-coloured dabs in the
  terrain shader. The dabs come from the same density map the flowers are
  scattered by (the flora bake and its clumps), coloured by species and
  colony, each drawn out a little along the brush's way. They keep about
  5 px from orbit down to a flower's size (0.16 m), so the flowerbeds read as
  the same brushed marks at every height, only finer in meters as you come
  down; the colonies' wash of colour under them holds all the way down too.
  Both give way to the flowers themselves in the near field, but only where
  those are big enough on screen to carry the flowerbeds, and once they are
  built there: the flower layer keeps a texel per tile (`builtMap`, sent only
  when it changes), which the ground reads per vertex, so after a jump the
  near meadow keeps its painted flowers until each tile's flowers arrive
  (through iteration 13 it was bare until then). They lie at 80 %
  over the grass (`FLOWER_PAINT`). Up close the paint's beds fade out over a
  meter or so along a ragged edge and fill unevenly (`paintClumps`); far
  away they keep the drifts' crisp edges. Near blades
  cross-fade into the paint with a dithered fade, never a ring.
- **Water:** painted, not simulated: a mirror over a navy body. Along the view
  ray mirrored off the level surface, nearest first: the banks (marched over
  the terrain plus its bank lip and grass; this is the dark band under every
  shore, as tall as the bank and the meadow behind it, so it widens and
  narrows along the shore), the cottage (its terrace, pier, steps, walls,
  chimney and hipped roof as plain solids in its local meters, painted in a
  few broad strokes; for rays that come near it, stepped along the same
  ray after the banks' march and only up to where the meadow was met, each
  step's segment tested exactly against the solids, so whichever is nearer
  shows and no edge is skipped; the banks themselves in the lake's deep
  blue, darkened, as the reference's navy bands),
  the clouds, only where the ray clears the land (a bank or hill the ray
  meets stands in front of every cloud; read from the clouds' mirror pass at the pixel itself, nudged by the wind's
  ruffle; from far above, from the cloud cover seen from below, where the
  mirrored ray meets the clouds' mean height, cross-fading between 0.35 R and
  0.8 R of altitude), and the sky painted as the lakes' cobalt. Looking down into the water shows more of
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
  its shadow (every cloud, in sight or not: puffs splatted with the same
  lumpy outline, each down the sun its place sees, into a cube map of where
  the shadows reach the water table, 1536² a face, and again into a sharper
  window of one face about the focus (2048², 70–320 m across by the
  camera's height, moved in whole texels and sized in steps so its texels
  stay fixed to the planet; drawn while narrower than 0.6 R); each splat's
  outline is antialiased over a texel and a half of its map, so a drifting
  shadow slides smoothly through the texels instead of stepping; the ground
  looks itself up corrected for its height, in the window where it covers
  the point; only the faces holding ground in sight are drawn) and show in the lakes (the billboards drawn again from the mirrored
  camera; from orbit, a second cube map of the cover seen from below), so a
  cloud, its shadow and its reflection always agree. **Where** they are is weather: a flow over the sphere (four
  or five vortices spiralling in or out, and banded east–west winds) traced
  into streamlines about a cloud's width apart (Jobard and Lefer, the spacing
  wandering); clouds are strung along them, long axis with the flow, and a
  cloudiness field smoothed along each line picks the stretches that hold
  cloud: broad patches, long streaks, cloudlets at the fringes, clear sky
  between. Coverage sets the share. As R grows the lines stay put, cloud size
  grows with √R and the clouds along a line slide closer, so streaks stay
  whole. A cloud near the camera erodes from its edges. Shadows are a deep,
  cool green with brushed edges.
- **Birds:** small flocks of white birds, all tied to the planet. Most
  travel great circles round it at 5–6 m/s, the circle swinging slowly so
  the routes cross the whole meadow, with a gentle meander; two wheel in
  steady loops near the cottage (behind it, and over the nearest wetland).
  Level flight a few meters over the hilltops (half the terrain's height
  bound, then 2.4–3.8 m), rising over the cottage; loose V's and clusters
  with a slight drift; slow, deep beats like an egret's (1.7–2.1 a second)
  and long glides on raised wings, about a third of the time;
  banking by the path's real turn rate. Every pose is closed-form in time.
  Each casts its silhouette (body, tail and the two-panel wings as far as
  they reach out at that point of the wingbeat, turned with its heading)
  into the clouds' shadow map. The ground reads the map directly; the grass
  and the flowers read it through the field map, which keeps the cover and
  thresholds it after filtering, so the shapes stay crisp between its texels
  (the blades' lean still softens them).
- **Butterflies** (`butterflies.ts`): six kinds, wings painted per kind, about
  the flowers once you are down in the meadow. Homes come from a lattice of
  5 m cells fixed to the planet in direction space (one lattice per octave of
  R; each home keeps its butterfly by rank as the density per m² changes),
  kept more often among flowers and never on the water; those within 20 m of
  the focus fly. Flight is closed-form: a slow wandering loop from the flower
  tops to eye level, in bursts of a few slow, full wingbeats (2.8–4 a
  second by kind; the body bobbing up on each downstroke and climbing
  through the burst) and glides on wings held in a shallow V, sinking a
  little; now and then a settle on a flower, wings fanning.
- **Wind:** broad gust bands and quicker ripples travel with the flow (both
  advected exactly by rotating about the wind axis). Where a gust lays the
  grass over, blades and paint take on a pale sheen (the crest), brightest in
  sun; just upwind of it the grass springs back up into its own shade (the
  trough, dark and cool), so the meadow reads like a swell running across it.
  The sheen is signed (-1 trough … 1 crest); the same field bends the blades
  and flowers: a crest lays them well over (about 35° more at the defaults),
  a trough springs them back a little past upright, and their flutter grows
  with the wind and with the gust pressing on them. Sheen 0.5 by default.
  **Petals** lift off wherever flowers grow as a crest passes over them (and
  on the bloom front's edge), coloured as the flowers there.
- **Post:** tone curve, gentle highlight bloom, the grade in display space
  (contrast 1.1 about mid grey, brightness 0.95: style params), and about 2%
  static paper grain.

## Frame

The main pass renders into a linear HDR target, with MSAA only where it is
affordable (see Budgets), in this order: sky → terrain and water → props →
grass → flowers → birds → butterflies → clouds → particles. Before it, each
frame, the clouds render their shadow cube map (with the birds' discs, on the
faces holding ground in sight) and its sharper window about the focus, their cover-from-below cube map (from orbit
only) and their mirror (the billboards from the camera mirrored in the
water, at full resolution). The mirror is shaded only where a lake can read
it (waterMask.ts): a map of 8 px cells set where the camera's rays meet the
water table on wet ground (found from the bake, not by drawing the terrain
again), grown by the farthest the wind's ruffle can move a lake's lookup
(cloudsInMirror); the mirror discards everything else first. Through
iteration 12 it shaded the whole screen, and 78–100 % of that never reached
a lake. Post then draws to the screen.

A frame runs in this order: a resize the last frame asked for (a change of
tier), then the update, then the render; the build queue runs after it, in a
task of its own once the frame is handed to the GPU. A canvas
resize clears the canvas, so it is never done after the draw (the drawn
frame would be shown blank). The render scale is not a resize: the canvas
and the screen-sized targets (the scene, the bloom chain, the clouds'
mirror, the water mask) keep their size, the frame is drawn into the
lower-left part of them the scale asks for (`Post.setView`, the targets'
viewports), and the grade spreads it over the canvas, the paper grain at
the canvas's own resolution. The grade, the bloom and the lakes' mirror
keep their lookups inside the drawn part (their extents). A change of scale
reallocates nothing (through iteration 12 each one reallocated about
130 MB, a frame of 70–90 ms), and scale 1 draws exactly what it did. Tiles are built
before the next update, which decides from every tile's pages which are drawn
(built between the two, a tile's blades moved to pages not marked visible,
and a strip of it was missing for a frame). Both are tested on a live walk
(invariants.spec.ts, "frames"). The build queue (core/buildBudget.ts) runs
in the time the frame leaves before the next one is due (by the usual
interval, the median of the frames without a backlog and never shorter than
60 fps allows, or the last one's while the GPU holds frames up), less 4 ms
for the browser: up to 2 ms, at least 0.5. With more than four tiles waiting
in the near field (a jump, a fly-in, a glide; tiles built ahead do not
count), on a phone too, a slice that grows by 0.5 ms each frame that keeps
time, to 8 ms on a desktop and 6 on a phone, and halves at a frame that is
late while the main thread was busy for most of it (a frame the GPU held
up, the main thread idle, is not the builds' doing). Each frame is judged
on its own: through iteration 13 the queue took what was left of 3.6 ms of
the frame's JS after the update, reckoned as the slowest of the last
frames' (forgotten 5 % a frame), so one slow frame (on the way down from
orbit, a shader's first use: 60–140 ms) starved it for about a second, and
a phone, never given the catch-up slice, built half as fast as iteration 4.
The queue never starts a step unless twice the mean step of recent runs
would still fit (a mean, not the slowest step: WebKit's clock reads whole
milliseconds, and a guard on the slowest let a phone run 1/256 of a tile a
frame). At start-up, from orbit, one frame is drawn in the meadow and every
program's uniforms are looked up, so the near field's passes, programs and
instance pools are ready before the way down. Tiles in
view are built before those out of it, nearest first, and spawn straight in
(a grow-in, tried in iteration 7, made the change of detail more visible).
Blades and flowers never change size as you move: they are there or not
(rest.glsl presence()), thinning out toward the near field's edge one by
one at full size; only the planet's growth fades them in.

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
| Frame time | 16.7 ms (60 fps), Auto trimming the render scale first | 16.7 ms |
| Draw calls | ≤ 120 | ≤ 120 |
| Triangles | ≤ 4 M on high, 1.8 M on medium | ≤ 500 k |
| Visible grass instances | ≤ 600 k on high, 250 k on medium | ≤ 60 k |
| GPU memory | < 256 MB | < 256 MB |
| JS per frame | ≤ 4 ms; tile builds after the frame, in the time it leaves (to 8 ms while catching up) | ≤ 4 ms; builds to 6 ms while catching up |
| First frame | < 2 s | |

- **Tiers:** low (phones), medium (iteration 5's high) and high: grass to
  35 m and thicker toward its edge, flowers to 45 m, a 512² field map. The
  grass and flower pools are sized for high on every tier, so a tier chosen
  later fills in completely; the map sizes are chosen when the world is
  built.
- **Zoom stops:** the wheel and the keys settle on orbit, a bird's-eye view
  70.2 m up, a standing view 4.3 m up (Kai's zooms 0.35 and 0.83 at R 128,
  kept in meters on every planet) and the meadow (1.6 m) when you stop
  zooming within half a wheel notch of one (CameraRig STOPS_M, SNAP). The
  camera's tilt goes by height too: from straight down at 225 m to the
  horizon at 2.9 m, log-spaced (zoom 0.15–0.9 at R 128), so a view at a
  given height looks the same on every planet and the bird's-eye view sees
  across the meadow. The default stand (by the first water at the edge of
  the nearest wetland) is searched on the set-up ground (before iteration 10
  it ran at startup before the ground was set up).
- **Tier selection:** `auto` starts desktops on high (phones, and desktops
  that fail the startup probe, on low) and keeps it: resolution is not the
  look (Kai, after iteration 12), and a little upscaling blur is welcome. A
  live controller aims at a steady 60 fps (16.7 ms; 24 ms, tried in
  iteration 6, read as 30–40 fps with uneven frames on a 60 Hz screen) by
  the render scale alone, down to 0.5. A step costs nothing (see Frame), so
  frames slow for 0.75 s step it down at once by as much as their time asks
  (×0.92 to ×0.75); steady frames step it back up (×1/0.9) after 6 s, and
  each time a step up proves too much the next waits twice as long (to
  2 min), so it does not hunt. It does not change the tier as you go: a
  tier change rebuilds every blade and flower in sight, which reads as the
  meadow reloading and flickering (iterations 6–10 did). Only a machine
  still far too slow at the smallest scale (frames over 25 ms for 5 s)
  steps an Auto tier down, keeping its scale, and never back up. Covered by
  quality.test.ts.
- **MSAA:** a 4× HalfFloat MSAA target costs about 56 B per pixel, about
  200 MB at 1440p with DPR 2, which would break the memory budget on its own.
  So MSAA is used only on displays of DPR < 1.75 (whatever the render scale).
  At DPR 2 the pixel density does the anti-aliasing. Under MSAA a pixel
  partly covered by a triangle is shaded once, at its centre, which can lie
  outside a sub-pixel triangle (a blue floret, a star's point seen edge-on).
  A per-vertex colour read there is extrapolated far out of range (−23 to
  +49 in the HDR target), and the grade turns it into black or hot specks
  that flicker as the flowers sway. So grass, flowers, petals and birds read
  their colour at the centroid of the covered samples (grass.frag.glsl).
  Without MSAA that is the pixel centre, so DPR 2 draws the same pixels.
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
      world.ts             the scene and every system; per-frame order; interactions; a visiting Muse beside Muse
                           (addVisitor: its own uniforms but for Muse's press and shadow map, its shadow cast in Muse's)
      meadowVisit.ts       the meadow as a visit's destination (its adapter for src/visit, and the VisitUi main.ts uses
                           under ?visit, the hut shut) and as a planet friends' Muses visit (its companions' world)
      params.ts            typed schema, store, URL query, presets
      core/                clock, hash sync, quality tiers, build queue and its budget, hashing, GPU memory ledger, shared uniforms
      planet/
        growth.ts          g → A → R, inverse
        unfold.ts          the unfolding (branch unfold): the veil and the bloom out from the hut, then the growth
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
        scatter.ts         tiles, paged pool textures (one per channel), the list of pages drawn, building ahead, classifier hook, re-tiling, the map of built tiles
        grass.ts/.glsl     5-vertex blades in the wind, sheen
        flowers.ts/.glsl   drift, colony and clump classifier, four species pools (meshes in flowerMeshes.ts), bloom, flutter
        petals.ts/.glsl    petals lifting at the bloom front and in gusts
        wind.glsl          one wind field: flow, travelling gusts and ripples, sheen, click rings
        clouds.ts/.glsl    low cumulus: flow and streamlines, puffs in a data texture, billboards, shadow and cover cube maps, mirror pass
        veil.ts            the veil over the planet yet to unfold (branch unfold): the field of turns out from the hut, and the pace
        veilFog.ts/.glsl   the veil drawn as ground fog: the field's bake (veilField), a fullscreen march through the layer
        cloudLumps.glsl    the puffs' cauliflower lumps (baked cube map) shared by cloud, shadow and mirror
        birds.ts/.glsl     flocks of white birds on routes round the planet, wing hinges, shadow discs
        butterflies.ts/.glsl six kinds of butterflies from a lattice fixed to the planet, painted wings
        props.ts/.glsl     cottage (tile courses, capping, painted plaster and shadows), landing, stair, rail, bench;
                           its CUTAWAY builds (the roof lifting off, the walls cut, the chimney onto the back wall)
        hut.ts/.glsl       Muse's hut inside, drawn only in the cutaway: the room fitted to the cottage's walls, the
                           cut through them (rubble, timber), Kai's furniture (src/assets/interior), the fire's light,
                           the showpiece and its favourites' dots (hutDot); occlude.glsl dissolves what hides the shelf
        findBeds.ts/.glsl  the finds' patches of flowers (the meadow's species bunched per find, always grown) and their
                           glowing spheres from high up; a hero plant per patch, the one a basket's flower lands
                           into (heroStance: where and how large it stands); findTable.ts each find's state (card,
                           hover, pulse, picked basket, its hero's focus, landing and away) in a float texture,
                           any number of finds
        pins.ts            bubbles anchored on the globe from orbit: liked finds (hearts) and Muse (its photo),
                           Muse's moving with it as it roams
      muse/                the Muse agent's side in the page: the contract and route table shared with the server, the
                           samples, planets.ts (the planets a Muse lives on: each one's name and page), and ui/ (the
                           engine's hold on the 3D Muse, the dev tools)
      visit/               a trip seen on the host's planet, for any world that opts in (environments/README.md):
                           params.ts (the visit's URL, the way home, the time left), api.ts (the view, the return),
                           visitUi.ts (prepareVisit before the World; VisitUi in the garden's place: the two Muses,
                           the host's finds as beds and their cards, the banner, the ended screen), world.ts (a
                           destination, typed only by structure), follow.ts (the guest a step from its host, on ground
                           it can stand on), snap.ts (beds the layout left on water, moved to dry ground), transit.ts
                           (the ticket's stamp), companions.ts (a friend's Muse visiting, drawn beside Muse)
      garden/              what the garden shows: types, the source a backend fills (source.ts: load, subscribe,
                           react; `?garden=<url>`), the placeholder gallery and its pictures, the state (likes and
                           stars, post read, today's post and the tickets, baskets visited), where the finds grow
                           (placement.ts)
      render/
        palette.ts         16×16 palette generated in code, time-of-day keys, sun path
        toon.glsl          soft bands, three-tone materials, rim
        fog.glsl           aerial perspective
        sun.ts/.glsl       the sun each place sees (fixed to the planet)
        warp.glsl / .ts    tiny-planet warp (GPU and its exact CPU mirror), its curvature by zoom
        sky.ts/.glsl       backdrop and dome, sun glow
        post.ts/.glsl      HDR target, bloom chain, tone curve, paper grain
        look.ts, glsl.ts   shared look uniforms; shader chunk registry
      view/                camera rig (Overview ↔ Wander, a view held off the focus), the cutaway into Muse's hut (cutaway.ts),
                           the vista search, input gestures, keys (W A S D, Q E, arrows), CPU picking,
                           flights between places (flight.ts)
      ui/                  title and metadata line, hints, control bar, lil-gui panel, postcard
        garden/            the garden's interface: find cards over their beds, the rail (Muse, find Muse, cottage,
                           baskets), the post box (the hand-drawn mailbox in SVG, postboxIllustration.ts), the post
                           (mail.ts: today's deck of polaroids, the heart and star, the Favorite and Album pages,
                           the tickets; scrapbook.ts dresses each card on those pages from its id: the frame's tint,
                           washi tape or a clip, sometimes a crayon scribble or a sticker; postcardBack.ts draws
                           what Muse put on a card's back, one of eleven kinds, in crayon and its hand; the photo
                           is a still of what it shows, src/assets/postcards/stills.ts, rendered from the meadow by
                           npm run postcard-stills),
                           Muse's page, boarding a ticket (travel.ts: where it goes, why it didn't, the way back to a
                           trip), and the basket: its phases as one pure step
                           (basketMachine.ts; gardenUi.ts carries out its effects), the rail icon's hand-drawn
                           basket, flat, as two layers of the one picture split along its near rim
                           (basketDrawing.ts), with the finds' own flower meshes drawn between them, in a
                           full-screen canvas of its own drawn only while it is out (basketStage.ts; flowerPaint.ts
                           paints each flower as its patch paints its hero, through the frame's grade, so it
                           matches where it lands), and what you touch over it (basketOverlay.ts: the scrim, a
                           button over each flower, the preview, the day timeline; basketFan.ts and timeline.ts
                           lay them out). A press on the planet goes to a pin first, then to the hut's door or a
                           find's patch, the nearer along the pointer's ray; in the hut, to the showpiece and its
                           favourites (their cards are the finds' cards); hutEditor.ts lays the room out (?edit)
      dev/                 perf HUD, GPU timer, harness (window.__meadow), parity, Playwright and Vitest
