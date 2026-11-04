# Constructing the Ukiyo-e Hamlet

## Visual contract

The primary image is [the snowy homestead](reference/01-muse-snowy-homestead.png).
The [rainy view](reference/03-muse-rainy-homestead.png) describes the same place in
another season, not a different generated settlement. The brief is quiet,
natural ukiyo-e-inspired scenery with recognisable Muse inhabitants.

| Element | Preserve in the running app |
| --- | --- |
| Composition | Timber house on the left, an open approach through the centre, indigo water and a low bridge to the right; smaller homes and wooded ridges establish distance. |
| House | One-storey timber structure, dark tiled gable, amber shoji, recessed doorway, a shallow supported veranda and three steps. |
| Pines | Crooked woody trunks, asymmetric dense needle masses and visible branch gaps; snow rests on foliage rather than floating as plates. |
| Other plants | Narrow cedars, bare branching plum with restrained red buds, fine ochre reeds. Keep these structurally distinct. |
| Ground and water | Broad connected snow, fractured slate banks, a narrow traversable path and restrained horizontal water marks. Rain reveals muted ground colours on the same terrain. |
| Materials and drawing | Timber grain follows boards; tile marks follow roof courses; rock reads as mineral; snow is a thin supported accumulation. Restrained ink and flat pigment areas should remain readable at app scale. |
| Inhabitants | The existing Muse body and rig, plus two visibly separate local neighbours. They need supported routes, clear entrances and useful observation views. |

Do not introduce alien plants, novelty terrain, clay-like uniform materials or
ornamental swirls to make this world more whimsical. Neither fine surface noise
nor extra outlines can repair a wrong silhouette or an empty composition.

## Pipeline and source map

The environment keeps the existing seeded cube-sphere pipeline. CPU fields and
their GPU bake define terrain; the local terrain code adds the home plateau,
stream/pond and rear ridges. Local shader chunks are registered under the engine’s
existing `meadow_*` names. Camera warp, growth, detail selection and the Muse body
continue to use the shared engine. World-specific imports resolve to this folder.

The find-form, find-sphere, find-bed, grass and Muse-shadow shaders are preserved
locally from the original compatible baseline. Newer main uses a different
collectible interface and Muse shadow map; borrowing only its shader half would
break the environment’s existing uniforms and vertex attributes. Shared `src/`
remains unchanged.

Land and water are separate draws sharing the same selected-node buffers and
grid. Land keeps its signed underwater bed height; water stays on the base
sphere. Their depth intersection defines the shoreline. This avoids painting
water onto interpolated bank triangles above the real water level. Both passes
use the same warp and CDLOD morph. The local grid doubles the inherited edge
subdivisions to improve the narrow stream; triangle accounting includes both
land and water draws.

| Concern | Local files |
| --- | --- |
| Entry, interaction wiring and render loop | `main.ts`, `world.ts` |
| Defaults, seasons, quality and URL parameters | `params.ts`, `ui/panel.ts` |
| Seeded fields and bake | `planet/fields.ts`, `fields.glsl`, `bake.ts`, `bake.frag.glsl` |
| CPU/GPU ground, home clearing, stream and ridges | `planet/terrain.ts`, `terrain.glsl` |
| Ground and water pigments | `planet/meadow.glsl`, `water.glsl`, `surface.frag.glsl` |
| Palette, sky and shader registration | `render/palette.ts`, `sky.ts`, `sky.frag.glsl`, `glsl.ts` |
| Timber home, stone steps and bridge | `life/props.ts`, `props.vert.glsl`, `props.frag.glsl` |
| Pine, cedar, plum, reeds and slate templates | `life/hamletGeometry.ts` |
| Placement, instancing, contours and scenery shadows | `life/hamletScenery.ts`, `hamletScenery.vert.glsl`, `hamletScenery.frag.glsl` |
| Analytic snow and rain particles | `life/hamletWeather.ts` |
| Muse routines, supported movement and local adaptation | `life/muse.ts`, `museLife.ts`, `museRoam.ts` and associated local modules |
| Local neighbour identity and safe routines | `life/residentLife.ts`, `residents.ts` |
| Weather, views and neighbour controls | `ui/hamletUi.ts`, `ui/hamlet.css` |
| Isolated garden persistence | `garden/state.ts` |
| Functional and visual evidence capture | `dev/ecology.spec.ts`, `dev/residents.spec.ts`, `dev/invariants.spec.ts` |

## Walking surfaces and inhabitants

The main house is 8.2 m wide. All values below are cottage-local metres, with
`+z` facing the front of the house. `FLOOR = 0.72` is measured above
`terrain.cottageGround`, not above the global water table.

- Veranda: x `[-4.4, 4.4]`, z `[2.49, 4.15]`, one walking cap at `FLOOR`.
- Steps: x `[-1, 1]`, three 0.4 m treads and four equal 0.18 m rises (including ground to first tread). The lowest cap is 0.18 m above the plateau; it must never share the terrain plane.
- Bridge: x `[8, 16]`, z `[9, 11]`; supported height is
  `0.10 + 0.55 * sin(pi * u)`, with `u` running from one bank to the other.
- `walkableHeightAt()` is the authoritative constructed-surface contract used by
  movement and camera ground handling. The compatibility `PIER` export aliases
  the shallow veranda; it does not create the meadow’s old masonry pier.
- Roof snow is separate geometry toggled by season. Its skirts meet the tile
  plane, with one connected ridge accumulation melting back from the lower tile
  courses along an irregular edge.

`life/houseGeometry.test.ts` checks single floor ownership, stair contact,
bridge/analytic agreement, dimensions and roof-snow contact. Do not add floor
overlays or move stair heights without updating both geometry and locomotion.
Decorative rocks are not automatically walkable terrain.

Shoji stiles own lattice crossings; horizontal rails terminate at each stile.
Side shoji occupy real wall openings. Bridge rails are joined swept surfaces,
not overlapping angled boxes. Roof snow has one ridge cover and no internal
ridge skirts. Surface-ownership regressions reproduce the old overlap defects.

Sumi and Mugi use separate courtyard lanes centred near `(-6, 9)` and `(4, 8)`.
Routes are deterministic and checked for dry clearance and slope; unsafe loops
shrink or fall back to a supported stationary point. Muse’s main route reserves
these lanes. Their two smaller homes use the same construction without the
bridge or furniture. Changing seed, radius or terrain fields invalidates their
ground samples and the scenery anchors.

## Vegetation and weather

Authored local placements establish the reference composition and preserve the
doorway, centre path, bridge approaches and neighbouring homes. Seeded Fibonacci
sites extend mixed clusters around the globe. The local pine and cedar meshes
carry more needle detail; separate cheaper remote templates provide distant
forest mass. These are near/far placement classes, not camera-switched LOD.

The user's later pine references (06–09 in `reference/`) supersede the pine
interpretation of the original generated vegetation kit. Each pine crown is a
cluster of overlapping round lobes, with a scalloped cloud silhouette and air
between branch tiers. Each lobe owns one fan drawing from its lower attachment;
never scatter small needle symbols across an angular canopy pad. The rejected
version is preserved in `reference/rejected-angular-pines/`.

`pineLobe()` builds closed rounded surfaces with smooth normals and per-lobe
`aLobe` coordinates. Snow follows those same domes with a shallow contacting lip.
Local pines keep seven unequal lobes per branch group; remote pines use simpler
three-lobe groups and fewer tiers to preserve the total geometry budget. Each
twig starts at its parent endpoint rather than duplicating the common approach.
The material uses one coherent fan chart per lobe; mixing perpendicular ray
drawings created an unwanted woven pattern in an intermediate capture.

Cedar also uses rounded lobes, arranged in narrower upright tiers. Both species carry camera-facing fan engraving on their fixed geometry; `aLobeTurn` transforms the continuous lobe chart into the camera plane without a front/back seam. Geometry and shadows never rotate with the camera. Plum has quiet charcoal-brown bark without repeating gold lenticels. Every plum branch/twig and cedar branch base is sampled from its emitted parent centreline, with the child base ring contained inside that parent. Redundant bark and snow outline layers remain removed.

`render/snow.glsl` now reserves uniformly white tops. There are no snow dots, grain, wash noise or drawn blue flecks. `snowBoundary()` adds a restrained blue-gray underside from the actual local normal. Rounded snow drapes and the roof’s rolled lip supply the shape; evergreen connector strips must have their own downward-facing normals. Compute derivatives before material branches and seasonal discards; snow helpers themselves contain no derivatives.

Roof tiles are shallow curved geometry with a rounded ridge, not a grid drawn onto a flat plane. Individual fieldstones form the foundation; stair treads have chamfered physical edges and their own support profile. The roof and step snow have unequal, supported edge drifts.

Tree placement mixes unequal groves, saplings, mature trees and open glades. Three authored cottage beds contain dedicated six-stalk barley clumps with broad drooping leaves and paired grain heads. Separate low green grass fringes beds and paths; wild reeds remain at banks. Bed soil is painted into the terrain, never a separate coplanar mesh. Placement reserves the full entrance, bridge and resident loops and samples dry support at radii 40/128/400.

Water uses broad blue pigment with sparse connected horizontal light shapes. A short reflected ray samples the actual terrain for bank silhouettes; this is a stylised bank reflection, not a full reflection of every tree, house or inhabitant. All shapes and click ripples are painted into the single water material. Large quiet blue areas remain between marks.

Placement samples both the anchor and its footprint. Roots and the lowest rock
ring conform to the terrain in the shader. Colour, selected contours and shadow
passes share the same instance attributes and warp. Local tree and bank geometry
casts into the existing sphere shadow map; remote trees omit that extra pass.
Count instantiated triangles, outlines and shadow work when assessing cost,
rather than quoting only one source template’s triangles.

The `weather.season` parameter selects `snow` or `rain`. A shared snow uniform
changes ground, roof, foliage and sky together. Snow/rain positions are analytic
functions of time and seed, so fixed-time comparisons do not depend on a particle
simulation’s previous frames. Winter suppresses the inherited butterflies.
Saved garden content is separate from ambient scenery and must not be deleted
to make a screenshot cleaner.

## Size, woods and clouds

Kai, 2 Nov: a 30 % smaller planet so the orbit holds more of the hamlet,
but only if the layout about Muse's hut stays as it is; more trees away
from the hut; cumulus clouds whose shadows lie blue on the snow.

- **Size.** The default is R 90 m (`RADIUS_DEFAULT`, params.ts), 30 % smaller
  across than the R 128 the homestead was laid out and tuned on (`R_REF`).
  Growth still runs 40–400 m from there.
- **The ground about the home keeps its tuned shape** (`TUNED`, fields.ts). Out
  to 64 m from the cottage (along the ground) the natural fields are those of
  the R 128 planet at the same cottage-local meters, where the houses, trees,
  beds, paths and the residents' lanes are laid out; by 84 m they have faded
  into the planet's own, in rest space as before. The bake (bake.frag.glsl,
  `homeWeight`, `homeDirection` in fields.glsl) and the CPU fields do the same.
  The pond has its tuned size on the default planet (terrain.ts), and the bank
  lip's gradient step is never finer than the tuned planet's bake texel. At R 90
  the ground within 50 m of the cottage is the R 128 ground to 3 mm (2 cm
  under the plateau's edges), measured at 2 m spacing; scale.test.ts holds it.
  The Home view frames 1–2 % tighter (a smaller sphere curves more under the
  same warp, and the rig's field of view follows zoom, not height). A pose in
  the hash is a direction on the planet, so on another size it is another
  place: flicker.spec.ts's reported camera is moved to the same place (cottage
  local −7.9, 15.3 m), heading and height on R 90.
- **The woods** (`WOODS`, hamletScenery.ts) replace the 96 global sites: 322
  stands on a jittered Fibonacci lattice, as dense as a seeded woodland field
  is there (close stands of pine or cedar, thinner ones at its edges, a lone
  tree in the open), none nearer the cottage than 40 m and all of them beyond
  56 m, so the hamlet's own trees stay as they were. Offsets within a stand
  are in meters, so a stand keeps its size as R grows. About 965 trees on the
  default planet; their sizes spread 1.75 times as widely as they are drawn
  (σ 0.49 about 1.0, 0.3–2.1). Kai halved a first count of 3,225, asked for
  that spread, then took off another 40 %. Each is placed from one ground sample, its shore distance and
  slope standing for the footprint (the hamlet's own anchors keep the four
  footprint probes), so placing everything again as the planet grows costs less
  than it did before the woods (27.6 ms a step in Node, against 30).
- **Their snow.** Every lobe of a woods tree is under snow, in three rows that
  keep above its dome: on the coarser domes one row spanned the cap in a flat
  fan that sagged under the dome, so the foliage showed through its middle,
  and half the cedars' lobes had none. Kai: "top surfaces of leaves should all
  be covered with white", and "do not change hamlet woods": the hamlet's own
  templates (full and remote) are byte for byte as they were.
- **Their cost.** The woods use leaner templates still (`createWoodsAssets`:
  about 1,290 triangles a pine and 1,480 a cedar with their snow), and only the
  trees in sight are drawn: in front
  of the horizon from orbit, inside the view as the warp draws them
  (`HamletScenery.cull`, packed and uploaded only when the set changes). Every
  scenery template is drawn indexed, its shared corners merged (mergeVertices
  at 1e-7, pixel for pixel the same), so each vertex is shaded once rather than
  once per triangle. The Home view draws fewer scenery triangles than before
  the woods (0.69 M against 1.0 M); hamletGeometry.test.ts gives the woods a
  budget of their own (1.75 M placed; 1.33 M on the default planet) beside
  the hamlet's (1.5 M).
- **Clouds.** life/clouds.ts is the meadow's cumulus with one change: its cover
  starts from none (`SHARE`), as the meadow's floor of a tenth of the slots is
  a ring of heaps over this small planet. The defaults are Kai's, set in the
  panel: coverage 0.5, bases about 9.5 m up, speed 0.24, shadow 0.84 (every
  shadow in the clouds' map, the trees' and Muse's among them), blue on the
  snow 0.95. Their shadows reach the snow through a
  map of their own (life/cloudCover.ts, render/cloudCover.glsl: the same puffs
  splatted down the sun into a cube a third the size of the clouds' map), so
  the snow under a cloud turns a clear blue (`snowInCloud`, snow.glsl) on the
  ground, the roofs and the trees' and stones' snow, while the shadows of the
  trees, the bank stones, Muse and its neighbours stay as they were. The panel's
  Clouds folder has "Blue on the snow" (`csn`) beside coverage and altitude.
  At coverage 0 no cloud is placed (the meadow's places a fringe of invisible
  ones about an infinite threshold, whose fade is NaN).
- **The parameter panel** shows again, folded at the top right as the meadow's
  is (P opens and folds it), for testing.

## Validation and iteration

Use the commands in [README.md](README.md). The ecology suite captures the actual
app at frozen time, including Home, Bridge, Muse, Whole planet and Rain views.
It also saves close pine, cedar and snow/plum material views. The flicker suite
checks the user-reported camera, Home, Bridge, pine and close steps/plum/cedar/roof/water in both seasons at DPR 1 and 2,
with repeated frozen draws and a small camera sweep. Its pixel metrics complement
the geometry audit; finite sampled views cannot prove absence of every possible
depth conflict. Current evidence and unchanged thresholds live in `reference/surface-correction-stability.json`. Historical records are retained separately. Close-view yaw increments scale with viewing distance because rig yaw translates its focus around the planet; the original panorama increments are unchanged. A wider initial plum sweep exceeded the adjacent-change guard and remains documented in `reference/close-plum-wide-sweep.json`.
Inspect the rendered images directly alongside the concept; the test cannot
judge composition or material fidelity. Resident browser checks cover the UI,
saved names, navigation, following, growth and season behaviour. Invariant tests
cover the inherited terrain/render contracts. Keep the current run results in
[VALIDATION.md](VALIDATION.md).

Finish runtime edits before starting browser capture. Concurrent hot reload can
destroy browser contexts and invalidate evidence. Preserve each meaningful
before/after checkpoint and describe the mismatch, its cause and remaining gap.
The first-pass images are intentionally retained as failed visual evidence.

The present implementation remains stylised 3D. Fine drawn detail, natural
material richness and exact reference composition still require visual review;
no user acceptance should be inferred from test results. Neighbour routines are
local ambient life, not a live multi-user ecosystem.
