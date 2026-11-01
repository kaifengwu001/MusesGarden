# The environment pipeline, start to finish

How Muse's world is generated and drawn, in the order the data flows: from
the seed and the sliders to the pixels on screen. Written against commit
`a7f6349` (iteration 15 plus Muse the character). `ARCHITECTURE.md` explains
why each decision was made; this file follows the code path and says where
each step lives.

There is one environment today: an alpine spring meadow with lakes in its
hollows, one stone cottage by a pond, and Muse living on the cottage's
terrace. A different seed gives a different planet of the same kind of
place.

Code excerpts marked *(condensed)* have lines removed for reading; the rest
are copied as they are.

---

## 0. The whole thing on one page

```
 INPUTS                 GENERATE (when inputs change)                 DRAW (every frame)
 ──────                 ─────────────────────────────                 ──────────────────
 seed ───────► generateLayout(seed) ──► Layout
                 grain axis, cottage, its bearing, pond shape
                                          │
 sliders ────► FieldParams ──────────────┤
                                          ▼
 growth g ──► R ───────────────► Fields (CPU)  ══ mirrored by ══  fields.glsl (GPU)
                                   twirls, relief, wetness,
                                   height, patterns, flora
                                          │
                                          ▼
                                 Terrain (CPU)  ══ mirrored by ══  terrain.glsl (GPU)
                                   + homestead, bank lip
                                          │
                                          ▼
                                 TerrainBake: two cube maps ───────┐
                                   terrain: height, lush, wet, variant
                                   flora:   flowers per m² × 4 species
                                                                    │
                                                                    ▼
                                    world.update():  camera → warp → light/look uniforms
                                                     → field maps around the focus
                                                     → birds, butterflies, Muse
                                                     → cloud passes (shadow, mirror)
                                                     → CDLOD ground selection
                                                     → grass and flower tiles
                                    post.render():   scene → HDR target → bloom → grade
                                    after the frame: build queue (tiles) in the time left
```

Three ideas hold all of it together:

1. **Everything is placed in direction space.** A feature's identity and
   position are a unit direction on the sphere plus a seed. Sizes are in
   meters. Only the distance between features depends on the radius R.
   That is why the planet can grow without anything sliding.
2. **The CPU and the GPU compute the same fields.** Every field exists
   twice, in TypeScript (for picking, placement and tests) and in GLSL (for
   drawing). The noise hashes integers so both sides agree: a browser test
   compares them at 64 points and fails if heights differ by 2 cm or more.
3. **No `Math.random`.** Every choice is a hash of stable integers (seed,
   class, face, level, cell). The same URL gives the same frame, byte for
   byte.

---

## 1. Ground rules

### Four spaces

| Space | Coordinates | Holds | Changes as the planet grows? |
|---|---|---|---|
| Rest | unit direction ω | what a feature is and where it sits | never |
| Face | (face, a, b) on the spherified cube | quadtrees, tiles, point sets | never |
| Planet | meters, P = ω · (R + h) | what the GPU draws | R and h |
| View | P′ = warp(P) | what you see (the tiny-planet bend) | every frame |

The cube-to-sphere map is the spherified cube, not `normalize()`
(`src/planet/cubesphere.ts`, mirrored in `cubesphere.glsl`). Its area
element J(a, b) is known in closed form and divided out wherever density
matters.

### Determinism

`src/core/hash.ts` is the only source of randomness:

```ts
export function hash32(x: number): number   // lowbias32
export function mix(h: number, v: number): number   // fold one more integer in
export function unit(h: number): number   // hash → [0, 1)
export function salt(name: string): number   // stable salt for a class name
```

Noise is gradient noise on integer hashes (`noise.ts` / `noise.glsl`), so
float32 on the GPU and float64 on the CPU land on the same lattice values.

### Pairs that must change together

| CPU | GPU | What |
|---|---|---|
| `planet/fields.ts` | `planet/fields.glsl`, `planet/bake.frag.glsl` | the meadow's fields |
| `Fields.clumps` in `fields.ts` | `clumpsAt` in `planet/meadow.glsl` | flower clumps |
| `planet/terrain.ts` | `planet/terrain.glsl` | homestead, bank lip, ground sample |
| `render/warp.ts` | `render/warp.glsl` | tiny-planet warp |
| `planet/noise.ts`, `cubesphere.ts` | `noise.glsl`, `cubesphere.glsl` | noise and the cube map |
| `ROW` in `render/palette.ts` | `ROW_*` in `render/toon.glsl` | palette rows |
| `life/props.ts` (the cottage's sizes) | `terrain.glsl` (clearing, shadow, channel), `water.glsl` (the cottage in the mirror), `life/muse.ts` (`STANDS` on the terrace) | the homestead |

---

## 2. Inputs

### The parameter schema — `src/params.ts:79`

One typed schema. Each field has a default, a range, a URL key and an
**effect**, which says what a change has to redo:

| Effect | Meaning | Examples |
|---|---|---|
| `live` | a uniform, read every frame | growth, wind, cloud speed, style |
| `terrain` | the fields change: re-bake | rolling hills, wetlands, water level, grain |
| `world` | the layout is regenerated from the seed | seed |
| `life` | instance sets change | grass density, flower weights, cloud coverage |
| `quality` | tier or resolution | tier |

The panel, the control bar, presets and the URL hash all go through one
`ParamStore`. The hash holds only non-default values plus the camera pose,
so any view can be shared.

Which parameters force a re-bake is listed explicitly in
`FIELD_PATHS` (`src/world.ts:40`): the five terrain sliders plus flower
density, patchiness, patch size and the four species weights.

### Growth — `src/planet/growth.ts:43`

```
g ∈ [0, 1]  →  A = lerp(A_min, A_max, ease(g))  →  R = √(A / 4π)
```

The defaults run R = 40 → 400 m; the default g gives R = 128 m.

`GrowthBand` (`src/planet/rest.ts:185`) keeps a second radius, `R_lag`,
which follows R with a 1.5 s lag in log space. A scattered point fades in
by where its birth radius sits between R_lag and R. While growing, new
points fade in over 1.5 s; at rest the band closes and the frame depends
only on (seed, params, time).

---

## 3. Layout from the seed — `generateLayout`, `src/planet/terrain.ts:86`

The seed decides the macro layout once. Nothing here depends on R.

*(condensed)*

```ts
export function generateLayout(seed: number): Layout {
  const rand = sequence(seed);                      // hash32 chain
  const noiseSeed = hash32(mix(seed, 0x7e44a1));    // seed for every field
  const grain = randomDirection(rand);              // hills and islands run along this
  const probe = new Fields(noiseSeed, grain);

  // the cottage: of 24 random directions, the one nearest a wetland's edge
  for (let k = 0; k < 24; k++) {
    const c = randomDirection(rand);
    const score = Math.abs(probe.wetNoise(c) + 0.12);
    if (score < best) { best = score; cottage = c; }
  }

  // its bearing: of 16 headings, the wettest one within 70° of the
  // late-morning sun, with the sun ahead and to the left (as in the painting)
  ...

  // the pond's outline: three harmonics, and one islet
  const pond = { radius0: 17 + 5 * rand(), shape: [a1, a2, a3, p1, p2, p3], islet: [x, y, r] };
  return { seed, noiseSeed, cottage, homeBearing: bearing, grain, pond };
}
```

What the `Layout` holds:

| Field | Used for |
|---|---|
| `noiseSeed` | every field's noise |
| `grain` | the axis the hills, islands and colonies stretch along |
| `cottage` | the cottage's direction; the bloom front and the wind's aim are centred on it too |
| `homeBearing` | which way the cottage faces (toward its pond) |
| `pond` | the homestead pond's outline and islet |

Changing the seed (`World.onParams`, `src/world.ts:330`) regenerates the
layout and rebuilds the `Homestead` (the cottage's meshes).

---

## 4. Fields: the recipe for the place — `src/planet/fields.ts`

This is the part that makes it a meadow. Every field is a pure function of a
direction. `Fields.update(radius, params)` (`:297`) recomputes the
R-dependent constants cheaply; the evaluation functions below use them.

### 4.1 Twirls (`:79`)

Every field is sampled at a *twirled* direction: four rotations about random
centres, each by an angle that falls off as exp(−(θ/ρ)²) from its centre,
applied in turn like a marbler's comb. Lakes, islands and flower drifts curl
and spiral instead of looking like plain noise. Two twirls are broad, two
tight.

### 4.2 Relief (`:118`, `:359`)

Nine noise octaves. Each octave's amplitude is chosen by its wavelength **in
meters** (`radius / (1.6 · 2^k)`), from two spectra:

```ts
// rolling hills: bumps 30–120 m apart
export function rollSpectrum(w: number): number {
  return smoothstep(14, 30, w) * (1 - smoothstep(120, 260, w)) * Math.sqrt(w / 60);
}
// hummocks: bumps 7–12 m apart
export function hummockSpectrum(w: number): number {
  return smoothstep(4.5, 7, w) * (1 - smoothstep(11, 19, w));
}
```

As R grows, the coarse octaves stretch out of the band and settle while
finer ones swell in. The spectrum in meters stays the same, and hills rise
and subside in place without sliding. Noise is compressed along the grain
axis (`stretched()`), so features run long.

### 4.3 Wetness (`:371`, `:182`)

A macro field: two domain-warped noise octaves. Its threshold is read off the
field's own distribution (4096 directions on a Fibonacci sphere, sorted), so
the `wetlands` slider is literally the share of the planet that is wet.

```ts
this.wetThreshold = sorted[Math.floor((1 - p.wetlands) * sorted.length)];
```

### 4.4 Height (`:396`)

```ts
natural(dir) {
  const t = twirl(this.twirls, dir, ...);
  const wet = this.wetnessTwirled(t);
  const h = this.reliefTwirled(t, wet) + this.lift - this.drop * wet - this.level;
  return plateau(h, wet);
}
```

- `lift` raises the uplands clear of the water; `drop` sinks the wetlands
  so the water table sits mid-relief there.
- **The water table is h = 0.** A lake is wherever the ground dips under
  it, so every shore is a contour of the hills.
- `plateau()` flattens wetland ground toward ±0.55 m, so islands are flat
  turf plates with a short bank.
- Hummocks grow 1.4× taller in wetlands (`WET_HUMMOCKS`).

### 4.5 Patterns (`:403`, `:408`, `:144`)

Lushness and colour variant are meter-sized patterns. Each is sampled at the
two direction-space octaves that bracket its size in meters
(`octavePair`), blended, and seeded by octave, so a pattern fades between
scales instead of jumping as R changes.

### 4.6 Flora (`:417`)

Flowers per m² for each of the four species (pink cups, white stars, yellow
buttons, blue clusters), at three scales:

| Scale | Size | Says |
|---|---|---|
| Drifts | ~18 m, long along the grain | where the meadow flowers at all (55% of the ground) |
| Colonies | ~13 m × the species' scale | which species holds a stretch of a drift |
| Clumps | ~2 m | dense knots and the gaps between them |

```ts
out[s] = speciesDensity[s] * speciesNorm[s]
       * (bare + (1 - bare) * drift * colony)
       * damp(s, wet);
```

`speciesNorm` keeps the mean equal to the density slider. `damp()` (`:504`)
says how much each species likes wet ground (the pink cups like it most).
Drifts and colonies are baked; clumps are too fine for the bake, so they are
evaluated where they are needed (`clumps()`, `:481`, and `clumpsAt()` in
`meadow.glsl`).

---

## 5. Terrain: the homestead and the banks — `src/planet/terrain.ts:169`

`Terrain` wraps `Fields` and adds what is laid out **in meters** around the
cottage, so the cottage always stands by its pond at any planet size.

`Terrain.update` (`:191`) sizes the pond (radius ∝ R^0.3) and its reach.
`Terrain.homestead` (`:252`) changes the natural height near the cottage:

1. a dry plateau around it (10–26 m),
2. a flat clearing at 1 m above the water (`HOME_LEVEL`),
3. the pond: a signed distance to its harmonic outline, banks dropping at
   0.9 m per m, the bed sloping at 0.3 to 1.4 m deep,
4. the channel cut under the pier's arch.

`Terrain.sample` (`:281`) then adds the **bank lip**, which lifts the land at
the waterline like a cut turf bank:

*(condensed)*

```ts
const h0 = this.height0(dir);                         // natural + homestead
const slope = |∇h0| from two neighbours one bake texel away;
out.water = h0 / max(slope, 0.04);                    // signed distance to the shore (m)
const hb = h0 + 0.2 * Math.tanh(out.water / 0.3);     // the lip
out.height = Math.max(hb, 0);                         // water is flat at the table
out.depth  = Math.max(-hb, 0);
out.clearing = no plants inside the house, terrace, steps or pier;
```

`terrain.glsl` is the same function on the GPU (`sampleGround`), reading the
natural height from the bake instead of evaluating it.

---

## 6. The bake — `src/planet/bake.ts`, `src/planet/bake.frag.glsl`

Evaluating the fields per vertex and per pixel would be far too slow (nine
octaves × twirls × domain warp). So the fields are rendered once into two
direction-space cube maps, and everything else reads them with one fetch.

| Map | Size (High) | Channels |
|---|---|---|
| terrain | 512² per face | natural height (m), lushness, wetness, colour variant |
| flora | 256² per face | flowers per m²: pink, star, yellow, blue |

The whole shader:

```glsl
void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = normalize(faceDirection(uFace, st));
  vec3 t = twirl(dir);
  if (uPass == 0) {
    float wet = wetnessAt(t);
    float h = reliefAt(t, wet) + uWet.z - uWet.w * wet - uLevel.x;
    h += (WET_PLATEAU * tanh(h / WET_PLATEAU) + WET_PLATEAU_KEEP * h - h) * wet;
    gl_FragColor = vec4(h, lushAt(t), wet, variantAt(t));
  } else {
    gl_FragColor = floraAt(t, textureLod(uBakedTerrain, dir, 0.0).b);
  }
}
```

**When it bakes** (`World.update`, `src/world.ts:376`): only when R, the
layout or a field parameter changes. While something is changing, a quick
set at half resolution is baked every frame; once nothing has changed for 6
frames, the full set is baked (about 10 ms of GPU on an M1 Pro).

```ts
if (R !== this.fieldsR || this.fieldKey !== this.fieldsKey || L !== this.fieldsLayout) {
  this.refreshFields(false);        // quick
  this.fieldsStill = 0;
} else if (!this.fieldsFull && ++this.fieldsStill >= 6) this.refreshFields(true);   // full
```

`refreshFields` (`:346`) runs `terrain.update`, writes the terrain uniforms,
bakes, and points `uTerrainBake` / `uFloraBake` at the new maps.

---

## 7. Boot and the frame loop — `src/main.ts`

**Boot** (`boot()`, `:57`):

1. Read the URL hash into the `ParamStore` (and frozen time, `t=`).
2. Create the WebGL2 renderer (a fallback screen if there is none);
   register the shared GLSL files as three.js shader chunks
   (`registerShaderChunks`, `render/glsl.ts`). Any material can then
   `#include <meadow_terrain>`, `<meadow_paint>`, `<meadow_warp>` and so on.
3. Pick a quality tier (`auto` runs a short GPU benchmark once).
4. `new World(renderer, globals, store, tier)` (`:90`) builds every system;
   `new Post(renderer)` sets up the frame's render targets.
5. Warm up: draw one frame in the meadow from orbit so every shader and
   instance pool is ready before the camera flies down.

**Each frame** (`frame()`, `:299`):

```
clock.tick
resize, if the last frame asked for one (a change of tier)
update()  →  keys, world.update(...), sync the URL hash
render()  →  post.render(world.scene, camera, grain, contrast, brightness)
after the frame (MessageChannel, :294): world.queue.run(budget)
                                         the time left before the next frame
                                         builds grass and flower tiles
```

Tile builds run after the frame is handed to the GPU, in the time it leaves:
up to 2 ms, growing to 8 ms on a desktop (6 on a phone) while the near field
is missing tiles.

---

## 8. `World` — `src/world.ts`

### Construction (`:142`)

Every system is created once and shares one set of uniform objects
(`this.shared`): time, R, R_lag, warp, sun, palette, terrain, clouds, wind.
Each frame writes each value once and every material sees it.

```ts
this.bake      = new TerrainBake(tier.maps.bake);
this.terrain   = new Terrain(generateLayout(seed));
this.sky       = new Sky();
this.field     = new FieldMap(this.shared, tier.maps.field);
this.surface   = new Surface(this.shared, tier.terrainGrid);   // the ground
this.grass     = new Grass(this.shared, POOL_PAGES.grass);
this.flowers   = new Flowers(this.shared, POOL_PAGES.flowers);
this.homestead = new Homestead(this.shared, seed);             // the cottage
this.clouds    = new Clouds(this.shared, ...);
this.petals, this.birds, this.butterflies
this.muse      = new Muse(this.shared);
this.clouds.addShadowCaster(this.birds.shadowMesh);
this.clouds.addShadowCaster(this.muse.shadowMesh);
```

### `update()`, in order (`:376`)

1. **Growth.** g → A → R; advance the fade band.
2. **Fields.** Re-bake if anything changed (section 6).
3. **Camera.** `rig.update` rides the surface, kept above the grass by
   `terrain.sample`.
4. **Warp.** Focus, up and k from the zoom (`warpForZoom`): the true sphere
   from orbit, a nearly flat plain on the way down, a small rolling world
   at eye level.
5. **Globals.** Time, R, R_lag, the band, the warp.
6. **Light** (`updateLight`). The palette for the time of day; the sun the
   focus sees.
7. **Look** (`updateLook`). Toon bands, haze (thicker near the ground), the
   bloom front, the wind (a rotation field, its direction set at the
   cottage), gust and
   ripple rotations, the four species' wash colours, water settings.
8. **Homestead.** Place the cottage on its clearing; compute how its shadow
   sweeps away from the sun.
9. **Near-field radii.** How far grass and flowers reach at this height
   (they vanish above 90 m).
10. **Field maps** (`FieldMap.render`), only if the near field is drawn.
11. **Birds, butterflies, Muse.** Closed-form poses for this time.
12. **Clouds** (`Clouds.update`). Puffs into a data texture; render the
    shadow cube map, its sharper window around the focus, the cover seen
    from below (from orbit only), and the mirror pass for the lakes.
13. **Ground selection.** The camera's frustum; CDLOD node selection
    (`surface.update`), split into nodes the homestead reaches and nodes it
    doesn't.
14. **Building ahead.** If the camera is heading somewhere (a glide, a zoom,
    a named view), compute the frustum there so its tiles get built on the
    way.
15. **Grass and flowers** (`grass.update`, `flowers.update`). Choose tiles,
    queue builds, mark the pages to draw.
16. **Paint hand-off.** Tell the ground where flowers are built, so the
    painted flowers give way only there.
17. **Petals, held bloom discs, sky.**

Offscreen passes (bake, field maps, cloud shadow and mirror) all run inside
`update()`. The main scene is drawn afterwards by `post.render`.

---

## 9. The ground

### 9.1 CDLOD selection — `src/planet/chunks.ts:87`

Six face quadtrees. A node at level L is refined while the camera is closer
than k · its edge (k = 5.5). Every selected node uses the same 17×17 grid
mesh, drawn in **one instanced draw** with per-node data (face, origin,
size, morph range). Culling uses the view frustum, plus a horizon test:
the true sphere from orbit, the warped curvature near the ground.

There are two draws (`src/planet/surface.ts:84`):

- nodes the homestead's plateau, pond or cottage shadow reach: the full
  ground shader;
- everything else: the same shader compiled with `AWAY_FROM_HOME`, which
  skips the homestead's code (about 2 ms saved in the vista).

### 9.2 Vertex shader — `src/planet/surface.vert.glsl`

*(condensed)*

```glsl
vec3 dir = uvToSphere(face, uv);              // cube-sphere
Ground g = sampleGround(dir);                 // bake + homestead + bank lip (terrain.glsl)
float height = meshHeight(dir, g);            // bank lip widened with distance; water flat
vec3 p = dir * (uRadius + height);
// symmetric geomorph: odd vertices blend toward their parent edge's midpoint
// normal from two neighbours half a grid step away
vec3 w = warpPosition(p);                     // tiny-planet warp
vVarious = clearing, slope, bloomAt(dir), flowers-built flag ...
gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
```

### 9.3 Fragment shader — `src/planet/surface.frag.glsl`

Every ground pixel, land or water, goes through these steps:

*(condensed)*

```glsl
vec4 fields = textureLod(uTerrainBake, dir, 0.0);       // per pixel: shores stay crisp
float h = homestead(dir, fields.r);                     // (skipped AWAY_FROM_HOME)
float shore = h / max(vSlope, uBank.w);
float wet = smoothstep(aa, -aa, h);                     // antialiased waterline

float stroke = strokeAt(dir, pixelMeters);              // brushstrokes along the wind
float cloud  = max(cloudShadowAt(...), 0.85 * cottageShadow(dir));
float b = toonLight(dot(n, uSunDir)) * (1.0 - 0.9 * cloud);
float sheen = windSheen(gustWaves(dir), rippleAt(dir));

if (wet < 1.0) {
  Meadow m = { dir, lush, wet, variant, flora = textureLod(uFloraBake, dir, 0.0),
               bloom, shore, light = b, sunlit, sheen, stroke, pixelMeters, nearFade };
  land = meadowPaint(m);                                // 9.4
  land = darken the bank's face where the turf drops steeply to the water;
  land *= cloudTint(cloud);
}
col = mix(land, waterColour(...), wet);                 // 9.5
col += sun rim;
col = applyAerial(col, viewDist, dir);                  // haze
```

### 9.4 The painted meadow — `meadowPaint`, `src/planet/meadow.glsl`

Where there are no blades, the ground is painted:

1. **Grass colour.** Three tones (lit, mid, shade) from the `GRASS` and
   `BRUSH` palette rows, shifted by lushness. Damp ground goes deeper and
   cooler; ahead of the bloom front it goes paler (`BUD` row).
2. **Brushstrokes.** Stretched noise along the wind, brightening and
   cooling the green.
3. **Wind sheen.** Pale crests where a gust lays the grass over; a dark
   trough just upwind where it springs back.
4. **Flower wash.** Far away, the colonies show as a wash of their
   species' colours, weighted by the flora map.
5. **Flower dabs.** One short brushed mark per occupied lattice cell, the
   species chosen by the local flora densities. The marks stay about 5 px on
   screen from orbit down to a single flower's size (0.16 m). In the near
   field they give way to the real flowers, but only once those are built.

Every pattern is sampled at the two octaves that bracket its size, so
nothing slides or pops as R or the camera changes.

### 9.5 The painted water — `waterColour`, `src/planet/water.glsl`

A mirror over a navy body; not simulated. Along the view ray mirrored off the
water, nearest first:

1. **The banks.** Marched over the terrain (with its lip and grass). This is
   the dark band under every shore.
2. **The cottage.** Its terrace, pier, walls, roof and chimney as simple
   solids in cottage-local meters (`homeSegment`, `homeColour`).
3. **The clouds.** Read from the clouds' mirror pass (or, from orbit, the
   cover seen from below), only where the ray clears the land.
4. **The sky.** Painted as the lakes' cobalt.

Looking down shows more of the navy body, looking across more of the mirror.
Wind ruffles streak the mirror; glints swell and fade; clicks ripple.

---

## 10. The near field: grass and flowers

### 10.1 Progressive point sets — `src/planet/rest.ts`

Each scattered class (grass, flowers, petals) has its own point set over the
six faces, each with its own hash salt:

1. Level ℓ splits a face into 4^ℓ cells with **exactly one point per
   cell**. Going one level down, the parent's point stays where it is and
   the other three children get new jittered points.
2. New points are born in a fixed, scrambled Morton order, so any prefix
   covers the face evenly (blue-noise-like). A point's rank is computable in
   O(1) from its cell.
3. Rank gives a birth density σ (points per steradian, J divided out). A
   class with density ρ per m² shows point *i* once ρR² ≥ σᵢ, at its
   **birth radius** Rᵢ = √(σᵢ / ρ) (`birthLnRadius`, `:164`). So the
   visible count is ρ · area, exactly.
4. A point's seed gives its species, tint, size and wind phase. Its
   direction never changes.

### 10.2 Scatter tiles — `src/life/scatter.ts:164`

Around the focus, the area within the near radius is covered by quadtree
tiles (`ScatterLayer.update`, `:239`):

- Each tile's points are enumerated by a time-sliced job on the build queue
  (`enumerateCell`) and copied into pages of a fixed instance pool.
- The pool is a float texture, one page per row (direction, ln birth
  threshold, seed). A short list of the pages in view tells each instance
  where to read. **One draw call** covers all of it.
- Density falls off toward the edge of the near field, by rank, so far
  tiles need fewer points.
- A ring of tiles beyond the edge, and the tiles the camera is heading
  toward, are built ahead of time.

### 10.3 Field maps — `src/life/fieldMap.ts:48`

So blades never re-run terrain, cloud or wind noise per vertex, three small
textures are drawn each frame around the focus (azimuthal projection, 256²
on Medium and 512² on High):

| Map | Channels |
|---|---|
| ground | height (m), distance to the shore (m), clearing, bloom |
| meadow | lushness, wetness, cloud shadow, colour variant |
| wind | bend vector (xyz), sheen |

### 10.4 Grass — `src/life/grass.ts`, `grass.vert.glsl`

Seven-vertex blades, one instance per rest-space point. The vertex shader:

1. reads its pool entry (direction, birth threshold, seed),
2. thins by rank toward the edge, then checks the growth band:

   ```glsl
   float keep = mix(1.0, uGrassFade.y, smoothstep(uGrassFade.x, uGrass.z, d));
   float grow = presence(0.5 * (blade.w - uGrass.w - log(keep)));
   ```

3. reads height, shore, clearing, lushness and cloud shadow from the field
   maps (no blades in water or on the clearing),
4. bends with the wind map, then the warp.

Colour is read at the centroid of the covered samples, so MSAA never shades
a sub-pixel blade from outside it.

### 10.5 Flowers — `src/life/flowers.ts`, `flowerMeshes.ts`

One point set for all flowers, sorted on the CPU into **four pools, one per
species mesh** (`FlowerClassifier`, `:60`):

1. The classifier looks at each tile first: the flora fields on a 4×4 grid
   (from the CPU mirror), and how far the local density rises above the
   mean.
2. Each point is assigned to a species or dropped, by rank against the
   local density × its clump factor (`classify`, `:128`).
3. Each flower gets a size (bigger on lusher ground) and a colour variant
   (set per colony).

R is rounded to 4% steps for this, so a settled world never depends on how
you got there. The meshes are `pinkCup`, `whiteStar`, `yellowButton` and
`blueCluster` (`flowerMeshes.ts:143`).

---

## 11. Life

All of these are closed-form functions of time, tied to the planet, so a
frozen time draws one exact frame.

- **Clouds** (`src/life/clouds.ts`, `clouds.glsl`). Where they are is
  weather: a flow over the sphere (four or five vortices plus east–west
  bands) traced into streamlines; clouds strung along them where a
  cloudiness field is high. Each cloud is eight lumpy puffs. The same puffs
  draw the cloud, cast its shadow (into a cube map and a sharper window
  around the focus) and show in the lakes, so a cloud, its shadow and its
  reflection always agree. Cloud size grows with √R.
- **Wind** (`src/life/wind.glsl`). Broad gust bands and quicker ripples
  rotating about the wind axis. The same field drives the sheen in the
  paint, the bend of blades and flowers, and when petals lift.
- **Birds** (`src/life/birds.ts`). Small flocks of white birds on slowly
  swinging great circles, two wheeling near the cottage. Their silhouettes
  go into the cloud shadow map.
- **Butterflies** (`src/life/butterflies.ts`). Homes from a 5 m lattice
  fixed to the planet; those within 20 m of the focus fly.
- **Petals** (`src/life/petals.ts`). Lift where flowers grow as gust crests
  pass, and at the bloom front.
- **Muse** (`src/life/muse.ts:111`). A cream plush about 1.1 m tall. Its
  body is either a Tripo3D sculpt (`src/assets/muse/*.glb`, rigged in
  `museMesh.ts` / `museRig.ts`) or a procedural distance-field body
  (`museBody.ts`). It is drawn as skin plus up to 20 fur shells in one
  instanced draw. It lives on the cottage's terrace in cottage-local
  meters (`STANDS`, `:38`, on `FLOOR` from `props.ts`) and follows a 44 s
  day: looks out, waddles, turns to you and waves. Its shadow goes into the
  cloud shadow map.
- **The cottage** (`src/life/props.ts:621`). Procedural geometry in local
  meters, painted in the shader (never textured), bent round the planet per
  vertex so its walls stand square to the ground at any R.

---

## 12. Look

- **Palette** (`src/render/palette.ts`). One 16×16 sRGB texture made in
  code. Rows are material families (`GRASS`, `BRUSH`, `WATER`, `PINK`,
  `STAR`, `SCATTER`, `SKY`, `CLOUD`, `ROCK`, `SNOW`, `STONE`, `ROOF`,
  `LIGHT`, `BUD`); columns run light → shadow, then variants. Every colour
  in the world is `pal(ROW_X, col)`. The noon values are sampled from the
  reference painting; dawn and golden-hour keys exist but are hidden.
  Unassigned cells are magenta, so a wrong index shows at once.
- **Toon light** (`src/render/toon.glsl`). `toonLight(N·L)` quantises into
  soft bands; `tone3(lit, mid, shade, b)` mixes three painted tones under
  sun and sky tints; `cloudTint` turns shade a cool green; `sunRim` adds a
  sun-side rim.
- **Sun** (`src/render/sun.ts`). One late-morning sun, fixed to the planet:
  each place sees it at the same elevation and bearing from local north.
- **Haze** (`src/render/fog.glsl`). Distance pales the meadow toward a
  grey-green; the planet's limb dissolves into the sky from orbit.
- **Sky** (`src/render/sky.ts`). A backdrop and dome with a sun glow.
- **Post** (`src/render/post.ts:134`). The scene renders into a linear HDR
  target (MSAA on screens below DPR 1.75), a four-level bloom chain picks up
  highlights, then `post.frag.glsl` applies a soft S-curve tone map, the
  grade (contrast 1.1, brightness 0.95) and about 2% paper grain.

Draw order inside the main pass, set by each mesh's `renderOrder`: sky →
grass → flowers → ground and water, cottage → Muse → birds and butterflies →
clouds → petals. Grass and flowers go before the ground on purpose: the
depth test then skips shading the ground under the blades.

---

## 13. What a new environment would have to supply

Reusable as is: the cube-sphere, point sets, growth band, CDLOD, warp,
camera and picking, scatter layer, build queue, field maps, the bake
mechanism, clouds, sun, toon, haze, post, the parameter store, the test
harness, and Muse.

Written per environment:

| Piece | Today, for the meadow | Where |
|---|---|---|
| Field recipe | twirls, relief spectra, wetness, plateau, patterns, flora | `fields.ts` + `fields.glsl` + `bake.frag.glsl` |
| Layout | grain, cottage by a wetland, bearing, pond | `generateLayout` |
| Home | cottage, terrace, pier, pond; Muse's stands on the terrace | `props.ts`, `terrain.ts/.glsl`, `water.glsl`, `muse.ts` |
| Species | four flowers: meshes, head heights, damp preference | `flowerMeshes.ts`, `flowers.ts`, `damp()` |
| Ground paint | grass tones, strokes, sheen, flower dabs and wash | `meadow.glsl` |
| Water | one table at h = 0, painted mirror | `fields.ts` (height), `water.glsl` |
| Palette | noon colours from the reference | `palette.ts` (`NOON`) |
| Parameters | `terrain`, `grass`, `flowers` groups; presets | `params.ts` |
| Reference framing | the still's water layout (16×9) and the squint test | `view/vista.ts`, `dev/squint.spec.ts` |

Constraints to keep in mind:

- **Four species is a hard limit today.** One RGBA channel each in the
  flora bake and one component each in the `vec4` uniforms.
- **The water table is assumed everywhere** (`h = 0`). A dry environment
  needs it turned off or reinterpreted.
- **The cottage's sizes are copied in four places** (`props.ts`,
  `terrain.glsl`, `water.glsl`, `muse.ts`). A new home has to update all of
  them, or they need to share one definition.
- **GPU memory was 252.7 of 256 MB on High before Muse** (PROGRESS.md,
  iteration 14). New maps have to replace old ones, not add to them.

## 14. File index

| File | Role |
|---|---|
| `src/main.ts` | boot, renderer, frame loop, build queue after each frame |
| `src/world.ts` | every system; per-frame order; named views; interactions |
| `src/params.ts` | parameter schema, store, URL, presets |
| `src/core/hash.ts` | the only randomness |
| `src/core/quality.ts` | tiers and their map sizes |
| `src/planet/growth.ts` | g → A → R |
| `src/planet/cubesphere.ts/.glsl` | cube-sphere map, area element |
| `src/planet/rest.ts/.glsl` | progressive point sets, birth radii, growth band |
| `src/planet/fields.ts/.glsl` | the meadow's fields |
| `src/planet/terrain.ts/.glsl` | layout, homestead, bank lip, ground sample |
| `src/planet/bake.ts`, `bake.frag.glsl` | fields → two cube maps |
| `src/planet/chunks.ts` | CDLOD quadtrees, morph, culling |
| `src/planet/surface.ts`, `surface.vert/.frag.glsl` | the instanced ground |
| `src/planet/meadow.glsl` | painted meadow, flower dabs, bloom front |
| `src/planet/water.glsl` | painted water and its mirror |
| `src/life/fieldMap.ts` | per-frame maps around the focus |
| `src/life/scatter.ts` | tiles, instance pools, building ahead |
| `src/life/grass.ts`, `flowers.ts`, `flowerMeshes.ts`, `petals.ts` | vegetation |
| `src/life/clouds.ts/.glsl`, `wind.glsl` | weather and wind |
| `src/life/birds.ts`, `butterflies.ts` | animals |
| `src/life/props.ts` | the cottage |
| `src/life/muse*.ts` | Muse |
| `src/render/palette.ts`, `toon.glsl`, `fog.glsl`, `sun.ts`, `sky.ts`, `post.ts` | look |
| `src/render/warp.ts/.glsl` | tiny-planet warp |
| `src/render/glsl.ts` | shared GLSL registered as `#include` chunks |
