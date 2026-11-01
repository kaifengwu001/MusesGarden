# Construction notes

The [reference handoff](../../docs/planet-reference-handoff.md) records why the first implementation missed the art direction, which intermediate fixes also failed, and how to continue after a context reset. Read it with the preserved images under `reference/`.

## World-specific code

| Files | Responsibility |
| --- | --- |
| `main.ts`, `world.ts`, `params.ts` | Entry point, world orchestration, seed/growth state and canyon defaults. |
| `planet/fields.ts`, `planet/fields.glsl`, `planet/bake.frag.glsl` | Matching CPU/GPU dry relief, large stepped chalk bedding shelves and cube-map baking. |
| `planet/terrain.ts`, `planet/terrain.glsl` | Ground sampling, a stable home terrace, clearing footprints and conservative culling bounds. |
| `planet/meadow.glsl`, `planet/surface.frag.glsl` | Matte blue-white chalk, narrow fractures, mineral scree and restrained shaded hatching. Shared shader-chunk names remain compatible. |
| `life/canyonScenery.ts`, `life/canyonGeometry.ts`, `life/canyonScenery.*.glsl` | Instanced fan trees, chalk cliffs, ivory comb-ferns, low coral thalli and sage leaf cushions, anchored to the planet and animated locally. |
| `life/canyonInk.ts`, `life/canyonInk.*.glsl` | Thin contour/crease lines sharing the same placement and wind as the meshes; no triangle-grid wireframe. |
| `life/canyonGround.ts`, `life/canyonGround.glsl` | Matching CPU/GPU projection of the lowest chalk ring into the underlying terrain, preventing exposed floating cliff feet. |
| `life/props.ts`, `life/props.frag.glsl` | The settlement's shelter and its material. |
| `life/canyonFauna.ts`, `canyonFaunaGeometry.ts`, `canyonFaunaMotion.ts` | Eleven native animals, their exact limb/wing/plate anatomy, grounded paths, perch cycles and observation targets. |
| `life/fieldMap.ts`, `life/fieldMap.frag.glsl` | Environment-local near-ground sampling of the encoded relief bake. |
| `life/residentLife.ts`, `life/residents.ts` | Stable local identities, safe walking loops, idle activity, greeting/petting and persistence. |
| `ui/canyonUi.ts`, `ui/canyon.css` | Resident selection, naming, follow controls and named places. |
| `garden/state.ts`, `ui/garden/*` | Garden interaction state isolated from the meadow, camera flights and honest invitation previews. |

Shared mathematical helpers, model assets, renderer services and the backend contract are imported from `src/`. Changing a world-specific use of those modules requires copying it into this environment first. Do not modify `src/` to tune the canyon.

The saved-find renderer also keeps its four shader dependencies locally: `life/findForm.glsl`, `findForm.vert.glsl`, `findSphere.frag.glsl` and `findSphere.vert.glsl`. They match this environment's packed form attributes. The newer meadow uses a different find-table interface; mixing its shaders with the canyon's old buffers can compile TypeScript yet fail at runtime. Migrate that renderer as a complete interface if adopting the newer system.

## Ground contract

Ground stays above the base sphere. `Terrain.sample()` returns a finite `water = 1000` sentinel, `depth = 0` and `wet = 0`; placement expects positive distance from water, so using zero would incorrectly reject dry sites. The sentinel is exactly representable by the half-float field maps.

The shelter's existing local footprint remains stable at `cottageGround = 12.2 m`, a middle terrace rather than the canyon floor. Legacy pond layout fields support camera/prop compatibility but never excavate water or a channel. Height is a continuous radial field with 5.6 m bedding intervals, broad flat caps and steep risers. A protected settlement rectangle preserves the resident lanes; access benches and a lower eastern canyon connect it to the surrounding terrain. CPU and GPU versions must change together. An explicit physical height cap supplies conservative culling bounds.

At settled radii above 256 m, the height cube doubles from 512 to 1024 pixels per face on high/medium quality (384 to 768 on low). The cube stores integer and fractional parts of the smooth relief separately in R/B; terracing happens after sampling, so interpolation does not round away the cliff edges. All consumers, including the local near-ground field map, decode that representation. Flora and the quick growth-scrub bake retain their original resolution. The extra height storage is 36 MiB on high/medium and 20.25 MiB on low, recorded in the GPU memory ledger. Shrinking below the threshold disposes the larger targets and restores the original allocation.

Material marks use planet-space metres. Fine chalk grain, fissures and hatching fade with their pixel footprint; there is no ground wind sheen, specular water or clay-like surface coating. The shader paint chunk is included by both vertex and fragment programs, so fragment-only derivative functions must not be introduced there.

## Residents and persistence

Residents share the existing Muse body/animation implementation, but each has its own animation controller. Their routes remain near the settlement and are sampled for dry, moderate slopes. If an edited seed leaves no safe loop, a resident stays grounded instead of crossing a cliff. Names are stored under `muses-garden.scarlet-sail-canyon.residents.v1`; garden choices use a separate `muses-garden.scarlet-sail-canyon.garden.v1` key. Storage failure still permits play for the current visit.

A garden camera action cancels resident following. Returning from an invitation preview restores the original seed. Plain opening uses the URL's seed/growth; the example gallery does not supply a competing world specification.

## Current boundaries

- The neighbours are local inhabitants. Account-backed personalities, conversations, relationships and presence are not attached to these three bodies.
- The primary Muse can use the existing optional backend. Default finds and postcards remain example gallery content, including example source links.
- Invitation previews explore another canyon seed; they do not redeem invitations or load a remote friend's planet.
- Terrain is a radial height field. Large overhangs, caves and vertical cliffs must be separate meshes with a deliberate navigation/collision design.
- Resident movement is a safe settlement route, not general-purpose pathfinding. Decorative scenery is not a full physical collision world.
- Cloud rendering uses a local copy with overlapping mist banks and restrained billow detail; the shared lighting machinery uses canyon palette choices. This is an executable interpretation of the art direction, not a literal reconstruction of a concept painting.

CPU tests cover dryness, growth, terrace attachment, conservative bounds and resident state. Browser checks cover shader compilation, CPU/GPU height agreement, picking and resident interaction. Visual review is still needed after changes to silhouette, colour, composition or camera framing.

## Native ecology and visual checks

The canyon uses persistent instanced geology and vegetation around the entire planet, plus an authored settlement composition. Hundreds of fans and chalk masses remain present in orbit. Scenery templates are indexed only when batched; construction and raycast sources stay non-indexed. The merge preserves all attributes, and topology tests follow the render index rather than assuming position count equals triangle-corner count. The cliff kit includes rooted sage carpets and ivory/coral plants sampled against its actual triangle surfaces; trees use a clear central planting pad. Ground-level plants avoid the Muse walking loops and the native animal pockets.

Each embedded plant stores its sampled support height in `aPlantBase`. Changing a cliff's height moves that support while preserving the plant's proportions and normals. The contour pass uses the same transform. Only the lowest rock ring extends downward to the underlying terrain; caps and planted roots remain at their authored heights. Terrain refreshes invalidate both scenery anchors and fauna routes, including the first bake at an unchanged radius.

Chalksteps have two feet, a blue feathered body and a scarlet fan tail. Fern Sifters have exactly three overlapping mint plates and six short legs. Dewwings have two scarlet wings and an ivory spindle body; two visible nectar stems support their perching cycles. Their paths and poses remain deterministic for a seed and time, follow terrain through growth, cast shadows and stop updating when distant. The Observe cameras use each animal's heading to show its face.

The ecology browser check captures the settlement, all three species and the full globe. Inspect those actual application screenshots after geometry or material changes; test counts alone do not establish a visual match to the world sheet.

## Reference composition

The original Scarlet Sail Canyon image is the primary visual reference. Its defining relationships are tall layered chalk on the left, an open lower canyon to the right, scarlet fan crowns, and a small single-awning shelter directly against a cliff. The home has a dedicated rock backing whose front face reaches the rear canopy attachment; its open entrance and resident routes stay clear. Its support rectangles are partitioned as a union with one top surface per point: timber in the main bay, chalk outside, and no coplanar board overlays.

Small plants have separate silhouettes, not colour swaps of one mesh: ivory fronds have dense paired lobes along curving ribs, coral plants have short connected branching blades, and sage grows in low rounded leafy cushions. Their placement clusters beside rock joints and ledges, with quieter walkable paths between them. Ambient flower scatter is zero by default. The four garden decoration channels use compact native coral, ivory, sage and young coral templates; Bloom changes the native foliage colour. Unique saved-find specimens remain a separate content system.

Visual regression captures include a clean postcard view and close views of all three creature habitats. Unit checks protect placement and anatomy; comparison with the original image protects composition and material readability.
