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
It is close to equal-area but not exactly. Its area element J(a, b) (sphere
area per unit face area, derived analytically and tabulated) is used wherever
density matters.

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

    v = clamp((hi − ln R_i) / (hi − lo), 0, 1),   hi = max(ln R, ln R_lag),  lo = min(ln R, ln R_lag)

- **Steady growth:** the band moves at the growth rate, so every new point
  scales and fades in over exactly 1.5 s.
- **Shrinking:** the same band runs in reverse. The newest points fade out
  first.
- **At rest:** R_lag = R, the band closes, and the frame is a pure function of
  (seed, params, time). Screenshots and tests settle the band first.

Macro unlocks (pond 2 at A₂, a channel branch at A₃, a mountain spur at A₄, …)
use the same band with a longer width, so they bloom in instead of popping.

### Terrain that grows without sliding

Meadow roll is a sum of direction-space noise octaves. Their weights depend on
R so that the spectrum **in meters** stays constant. An octave's amplitude is a
function of its wavelength in meters (λ_k · R): it peaks in the meadow band
(about 15 to 80 m) and rolls off on either side. As R grows, coarse octaves
stretch out of the band and settle, and finer ones swell in. Hills never slide;
they rise and subside in place.

Mountains are one range: ridged noise in direction space inside a range mask.
Height ∝ R (`mountainHeight` is a fraction of R). Snowline depends on height and
slope. Spurs unlock by rank.

### Channels and ponds

- **Channel:** a spline through stable nodes in direction space. Meander detail
  is added by rank. Subdivision level k inserts sideways-displaced midpoints and
  unlocks when the channel's length in meters passes L_k, fading in through the
  lag band. At R = 40 m a channel is a gentle curve; at R = 400 m it wanders.
- **Width** is in meters, from a geodesic distance field: there is water where
  `angle × R < width / 2`.
- **Pond:** the centre is in direction space. The radius is in meters with mild
  growth (∝ R^0.3), so the cottage pond stays cottage-sized. Outline, islets and
  lily pads live in pond-normalized coordinates, so they scale with the pond and
  are never resampled.

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

## Chunks and the GPU data path

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
flowers, props, outlines, clouds and the shadow pass. `warp.ts` mirrors it
exactly on the CPU.

    t  = (P − F) − ((P − F)·U) U                  tangent offset from the focus F
    P′ = P − k |t|² U,   k = w · (1/(2 R_v) − 1/(2 R)),   R_v = max(visualRadius, 0.15 R)
    N′ = normalize(N + 2k (U·N) t)                 normals follow the bent surface

w is the camera-mode blend: 0 in Overview, 1 in Wander. The orbit view shows the
true sphere, and the low view rolls away like a 60 m world even at R = 400 m.

P′ moves only along U, so the inverse is exact: `P = P′ + k |t|² U`. CPU
picking marches the ray in warped space and unwarps each sample, so what you
click is what you see.

**Camera:**

- **Overview** orbits the whole planet at FOV 35°.
- One zoom parameter dollies smoothly down to **Wander**, a third-person glide
  about 1.6 m above the grass at FOV 55°.
- Double-click glides the focus along a great circle.

## Look

- **Palette:** `palette.ts` generates a 16×16 sRGB texture. Rows are material
  families (grass, water, the flower species, sky, cloud, rock, snow, stone,
  roof, wood). Columns run light → shadow, then hue variations. Every colour in
  the world samples it. Time of day lerps between palettes keyed at dawn, noon
  and golden hour, then rewrites the texture.
- **Toon lighting:** `toon.glsl` has three bands with 0.08-wide soft
  transitions, a warm sun, a cool sky ambient from above, and a sun-side rim on
  grass and flower heads.
- **Outlines:** on the cottage and props only (inverted hull, #3E3A36,
  1 to 1.5 px equivalent). Terrain, grass, flowers, water and clouds keep soft
  edges.
- **Aerial perspective:** blends toward the horizon sky colour by view distance
  and by how far around the planet a point sits.
- **Far meadow:** painted brushstroke noise with flower-coloured dabs in the
  terrain shader. Near blades cross-fade into it with a dithered fade, never a
  ring.
- **Water:** painted, not simulated. Flat surface, shallow→deep gradient, pale
  shore band, faint sky reflection, sparkles, lily pads and islets. No
  refraction.
- **Post:** tone curve, gentle highlight bloom, and about 2% static paper grain.

## Frame

The main pass renders into a linear HDR target, with MSAA only where it is
affordable (see Budgets), in this order: sky → terrain and water → props and
outlines → grass → flowers → clouds → particles. Post then draws to the screen.

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
| Constant scale | Vitest: blade height, flower size, channel width and cottage size are equal at R_min and R_max |
| Constant density | Vitest: flowers per m² within ±5% at 9 growth values, both globally and in local patches |
| Attached | Vitest and Playwright: every prop, stone and flower base lies within ε of the warped terrain at 5 growth values |
| No LOD rings or pops | Playwright: a 10 s dolly from Overview to Wander; morph factors stay continuous and per-frame image deltas show no ring-shaped spikes |
| Picking | Playwright: CPU pick vs GPU position readback at 64 random pixels, error < 2 cm |

## Module map

    src/
      main.ts              boot, renderer, frame loop, quality tier wiring
      params.ts            typed schema, store, URL query, presets
      core/                clock, hash sync, quality tiers, GPU memory ledger, math, shared uniforms
      planet/
        growth.ts          g → A → R, inverse
        cubesphere.ts      spherified cube, its inverse and area element J
        chunks.ts          face quadtrees, CDLOD selection and morph, time-sliced build queue
        rest.ts            progressive point sets, birth radii, fades, unlock ranks
        terrain.ts         height and biome fields, sampled from rest space
        water.ts           channel splines, ponds, masks, depth; water.glsl
      life/                grass, flowers, clouds, props
      render/
        palette.ts         16×16 palette texture generated in code
        warp.glsl / .ts    tiny-planet warp (GPU and its exact CPU mirror)
        toon.glsl          banded lighting, rim, sky ambient
        outline.ts         inverted-hull outlines for props
        sky.ts             sky dome and backdrop, sun, aerial perspective
        post.ts            HDR target, tone curve, highlight bloom, paper grain
        glsl.ts            registers shared GLSL chunks (#include <meadow_*>)
      view/                camera rig (Overview ↔ Wander), input, CPU picking
      ui/                  title, hints, control bar, lil-gui panel
      dev/                 perf HUD, GPU timer, test harness, Playwright specs, Vitest invariants
