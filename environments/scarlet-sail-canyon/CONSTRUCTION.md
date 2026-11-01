# Construction notes

## World-specific code

| Files | Responsibility |
| --- | --- |
| `main.ts`, `world.ts`, `params.ts` | Entry point, world orchestration, seed/growth state and canyon defaults. |
| `planet/fields.ts`, `planet/fields.glsl`, `planet/bake.frag.glsl` | Matching CPU/GPU dry relief, smooth chalk bedding shelves and cube-map baking. |
| `planet/terrain.ts`, `planet/terrain.glsl` | Ground sampling, a stable home terrace, clearing footprints and conservative culling bounds. |
| `planet/meadow.glsl`, `planet/surface.frag.glsl` | Matte blue-white chalk, narrow fractures, mineral scree and restrained shaded hatching. Shared shader-chunk names remain compatible. |
| `life/canyonScenery.ts`, `life/canyonGeometry.ts`, `life/canyonScenery.*.glsl` | Instanced fan trees, chalk slabs and comb-ferns, anchored to the planet and animated locally. |
| `life/props.ts`, `life/props.frag.glsl` | The settlement's shelter and its material. |
| `life/residentLife.ts`, `life/residents.ts` | Stable local identities, safe walking loops, idle activity, greeting/petting and persistence. |
| `ui/canyonUi.ts`, `ui/canyon.css` | Resident selection, naming, follow controls and named places. |
| `garden/state.ts`, `ui/garden/*` | Garden interaction state isolated from the meadow, camera flights and honest invitation previews. |

Shared mathematical helpers, model assets, renderer services and the backend contract are imported from `src/`. Changing a world-specific use of those modules requires copying it into this environment first. Do not modify `src/` to tune the canyon.

## Ground contract

Ground stays above the base sphere. `Terrain.sample()` returns a finite `water = 1000` sentinel, `depth = 0` and `wet = 0`; placement expects positive distance from water, so using zero would incorrectly reject dry sites. The sentinel is exactly representable by the half-float field maps.

The cottage's existing local footprint and `cottageGround = 1.2 m` remain stable. Legacy pond layout fields support camera/prop compatibility but never excavate water or a channel. Height is a continuous radial field, with 1.4 m bedding intervals softened into walkable transitions. CPU and GPU versions must change together. The height bound uses the sum of noise amplitudes, rather than a statistical estimate, so distant chunks cannot disappear when relief increases.

At settled radii above 256 m, the height cube doubles from 512 to 1024 pixels per face on high/medium quality (384 to 768 on low). High-quality browser checks measure the R400 CPU/GPU height difference below 2 cm. Flora and the quick growth-scrub bake retain their original resolution. The extra height storage is 36 MiB on high/medium and 20.25 MiB on low, recorded in the GPU memory ledger. Shrinking below the threshold disposes the larger targets and restores the original allocation.

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
- Cloud rendering uses a local copy with long, low cloud banks and restrained edge detail; the shared lighting machinery uses canyon palette choices. This is an executable interpretation of the art direction, not a literal reconstruction of a concept painting.

CPU tests cover dryness, growth, terrace attachment, conservative bounds and resident state. Browser checks cover shader compilation, CPU/GPU height agreement, picking and resident interaction. Visual review is still needed after changes to silhouette, colour, composition or camera framing.
