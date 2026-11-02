# Construction notes

The [reference handoff](../../docs/planet-reference-handoff.md) records why the first implementation missed the art direction, which intermediate fixes also failed, and how to continue after a context reset. Read it with the preserved images under `reference/`.

## World-specific code

| Files | Responsibility |
| --- | --- |
| `main.ts`, `world.ts`, `params.ts` | Entry point, world orchestration, seed/growth state and canyon defaults. |
| `planet/fields.ts`, `planet/fields.glsl`, `planet/bake.frag.glsl` | Matching CPU/GPU dry relief, large stepped chalk bedding shelves and cube-map baking. |
| `planet/terrain.ts`, `planet/terrain.glsl` | Ground sampling, a stable home terrace, clearing footprints and conservative culling bounds. |
| `planet/meadow.glsl`, `planet/surface.frag.glsl` | Warm mineral paths, cool chalk faces, sparse clustered grit and footprint-filtered fractures. Shared shader-chunk names remain compatible. |
| `life/canyonScenery.ts`, `life/canyonGeometry.ts`, `life/canyonScenery.*.glsl` | Mature, twin-crown and juvenile fan trees; chalk cliffs; ivory comb-ferns; low coral thalli; creeping olive runners and twiggy shrubs. |
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

Small settlement steps interpolate between their actual clamped endpoint heights over the full 2.4 m ramp; clamping a full-height step after interpolation would squeeze a shallow drop into an undersampled strip. Regional falls use a wider 0.18–0.82 bed transition. The local surface retains at least a 33-vertex grid and range factor 8, including the shared CDLOD morph contract. `dev/terrain-ledges.test.ts` samples rendered triangle interiors against the analytical field, separately from CPU/GPU function parity.

Terrain lighting samples four centered height neighbours over a fixed 0.45 m physical footprint in the fragment shader. This avoids stretching interpolated vertex normals into triangular colour bands on steep cliffs. Direct derivatives of the baked height were tried and rejected because they introduced fine normal noise.

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

The canyon uses persistent instanced geology and vegetation around the entire planet, plus an authored settlement composition. Fans and chalk masses remain present in orbit. Growth and settlement clearance scale complete instances and their shelf support offsets together; submitted geometry stays opaque, without screen-door fades or ghost canopies. Scenery templates are indexed only when batched; construction and raycast sources stay non-indexed. The merge preserves all attributes, and topology tests follow the render index rather than assuming position count equals triangle-corner count. The cliff kit includes rooted sage carpets and ivory/coral plants sampled against its actual triangle surfaces; trees retain a central rock support pad. Ground-level plants avoid the Muse walking loops and the native animal pockets.

Broad olive shader paint has been removed from chalk. Moss is a separate material-kind-9 mesh using three irregular patch forms, tapered fringes, short fibres and small filtered surface marks. Four shelf compositions use 3/3/5/1 mats: a broad connected patch, a narrow branching seam, unequal satellite colonies, or nearly bare chalk. Footprint spread changes independently of mat thickness. Sage runners and shrubs remain separate anatomy.

Distribution varies at three scales. Ground pockets use a coordinate-seeded random stream, unequal curved lobes, small outliers and different dominant communities; they do not repeat the same four runners plus four accent plants. Local outcrops have unequal widths, heights, orientation and staggered outer positions; the shelter backing stays authored. Four rock/plant assemblies vary peripheral shoulders and lower ledges while retaining the same central support height and bounded footprint. They use four shelf batches, bringing the scenery total to twelve.

`life/canyonDistribution.ts` generates up to 384 global sites in unequal colonies, correlated by broad regional abundance and interrupted by open basins. At seed 412 it produces 284 sites across 64 colonies. Directions are normalized, deterministic, and at least 0.045 radians apart; that angular root clearance is not a substitute for footprint/contact checks. The caller maps canonical directions into the home frame and applies existing settlement exclusion. Plant occurrence follows regional abundance, and fragments vary in count and size. Keep central support, material separation, native routes and the three-million-triangle scenery budget when adding new compositions.

Each embedded plant stores its sampled support height in `aPlantBase`. Moss uses a single continuous fitted plane per patch; `aSupportSlope` stores its two slopes so the vertex shader applies the matching inverse-transpose normal correction. Other plants keep scalar support and zero support slopes. Changing a cliff's height moves that support while preserving the plant's proportions and normals. The contour pass uses the same transform. Sage shoots are rigid components fitted to a stable cap footprint; they turn or are omitted at sharp shelf drops. Never conform each leaf vertex independently across terrace levels. Only the lowest rock ring extends downward to the underlying terrain; caps and planted roots remain at their authored heights. Small fragments use 0.02 m embed per instance scale, while larger shelves retain 0.08 m; the smaller amount prevents thin attached chips from becoming almost coplanar with terrain. Placement samples the float32-encoded, normalized direction also used by the shader. Terrain refreshes invalidate both scenery anchors and fauna routes, including the first bake at an unchanged radius.

Chalksteps have two feet, a blue feathered body and a scarlet fan tail. Fern Sifters have exactly three overlapping mint plates and six short legs. Dewwings have two scarlet wings and an ivory spindle body; two visible nectar stems support their perching cycles. Their paths and poses remain deterministic for a seed and time, follow terrain through growth, cast shadows and stop updating when distant. The Observe cameras use each animal's heading to show its face.

The ecology browser check captures the settlement, all three species and the full globe. Inspect those actual application screenshots after geometry or material changes; test counts alone do not establish a visual match to the world sheet.

## Reference composition

The original Scarlet Sail Canyon image is the primary visual reference. Its defining relationships are tall layered chalk on the left, an open lower canyon to the right, scarlet fan crowns, and a small single-awning shelter directly against a cliff. The home has a dedicated rock backing whose front face reaches the rear canopy attachment; its open entrance and resident routes stay clear. Its support rectangles are partitioned as a union with one top surface per point: timber in the main bay, chalk outside, and no coplanar board overlays. Exposed boundary faces are split into irregular fracture rings with buried talus feet; the flat support union is unchanged. The rear curtain is one folded sheet, rather than overlapping strips. Canopy UV spans put wind displacement nodes at the hems, keeping static lashings attached. Cloth repair patches, stitches and plank seams are material marks, never coincident overlay planes.

Small plants have separate silhouettes, not colour swaps of one mesh: ivory fronds have dense paired lobes along curving ribs, coral plants have short connected branching blades, and sage has separate spreading runner and upright branching shrub habits, with cupped leaves and vein pigment. Their placement clusters beside rock joints and ledges, with quieter walkable paths between them. Ambient flower scatter is zero by default. The four garden decoration channels use compact native coral, ivory, sage and young coral templates; Bloom changes the native foliage colour. Both ambient and bed decoration paths use the local `nativePlant.frag.glsl` for veins and leaf margins. Unique saved-find specimens remain a separate content system.

Visual regression captures include a clean postcard view and close views of all three creature habitats. Unit checks protect placement and anatomy; comparison with the original image protects composition and material readability.

## Windows open-land colonies and cloud cover — 2 November 2026

The requested vegetation expansion adds `life/canyonGroundcover.ts`: deterministic, unequal lobed colonies in regions with fewer rock assemblies. These are ground-level raised moss surfaces, separate from both shelf moss and olive runners. Rock-foot seams add moss with intermittent coral/ivory accents. Existing global rock placement is unchanged. Placement must preserve protected lanes, reject terrace crossings and fit only continuous gentle terrain; do not stretch vegetation across cliffs. A single additional instanced moss batch shares the environment's material/ink contract and retains the existing three-million-triangle scenery budget. Current visual iteration and exact validation status are recorded in VALIDATION.md.

Cloud default coverage is 0.48 with 32 m base altitude, keeping the existing seeded flow, shadows and quality limits while making cloud banks more numerous around the globe. Both settings remain adjustable.

Gentle-ground fitting uses `groundcoverSupport` in the new generator module. It fits a single plane from opposing height samples, checks 15 edge/interior locations against that plane and rejects slopes above 0.28 or residuals above 5.5 cm. The shared instance `aGroundSlope` shears geometry and normals identically in scenery and ink. The whole mat or shoot stays rigid relative to this plane. This differs from the rejected historical method of independently projecting leaf vertices across discontinuous rock levels.

## Rooted plants within moss colonies — 2 November 2026

`plantedMossGeometry` adds two small understory communities to the existing raised mat body. The root positions are sampled from the actual moss top before plants are emitted. One assembly contains coral and olive shrubs, the other ivory and olive shrubs. A deterministic regional selector assigns approximately 28% of ground mats to these communities; the rest stay low moss. Moss and taller foliage share one anchor, size, emergence and ground support, with two extra draw batches and no shared-engine change. The source assembly triangle limits, mat-root contact and existing radius-dependent scene/contact/path tests protect this contract.

Cloud shape/formation code and final visual review are tracked in VALIDATION.md; clouds retain the eight-puff data layout and 512-cloud cap.

Cloud geometry now lives in life/cloudShapes.ts: broad billows, tapering hooked wisps, separated unequal banks, crescents and compact cloudlets. Each uses exactly eight puffs inside the existing conservative 1.45×size bound including animation. life/clouds.ts keeps the existing data/shader layout while varying slot spacing, coherent side bends, girth, altitude and three-slot family runs. Terrain shadows and visible clouds still consume the same puff data. The previous coverage increase is retained; this follow-up varies anatomy and formation instead of increasing a uniform row of copies.

## Trees within moss colonies — 2 November 2026

`selectMossTreeSites` selects small uneven groves from actual ground-moss sites with an independent seeded stream, varied tree scales/phases, a 320-candidate cap and 0.05-radian root spacing. Most moss stays open. New trees append to the existing three fan-tree batches, preserving prior tree habit assignments and geology. Their trunks root in soil and emerge through the moss. Admission uses the exact parent mat direction, turn, emergence and support footprint at the current radius; trunks remain upright rather than shearing with the support slope. Angular root spacing is not a universal canopy-collision guarantee. Current validation and actual screenshots are tracked in VALIDATION.md.

The subsequent request for more trees expands this selector with a second, independently seeded pass through two wider lobes per colony. The first pass remains an unchanged prefix, preserving the first groves and their habits; new trees append after it. Total selection is capped at 880 candidates, with the same spacing and parent-moss support. Existing scenery triangle and resident-clearance limits remain unchanged; final accepted counts and visual evidence are recorded in VALIDATION.md.

## Pale-yellow clouds — 2 November 2026

The user requested the proposed light-yellow cloud color be made visible. Scarlet's noon `ROW.CLOUD` palette now uses butter-yellow bodies (`#FFF2CC`), lit ivory (`#FFF8E2`), cream shadows/base and nearly white rims (`#FFFDF3`). The same row feeds visible clouds and both reflection paths. Dawn/golden-hour variation remains intact. Shape, coverage, motion, optical-depth shadows, sky and terrain colors are unchanged; this is an environment-local palette edit.

**Superseded by user rejection:** the yellow palette was reverted to the original noon cloud row (`#F5F1DC`, `#B9CED0`, `#E5E8DA`, `#FFF7DE`, `#C0D1CD`). The same follow-up raises default cloud coverage from 0.48 to 0.78, filling more of the existing varied streamline formations. Altitude32, shapes, wind, shadows and the 512-cloud cap remain unchanged. Coverage is a placement control, not a literal percentage of sky covered. Current review and counts are in VALIDATION.md.

## Current-main compatibility — 2 November 2026

The mainline merge retains local copies of `grass.vert.glsl`, `museShadow.frag.glsl`, and `museProps.vert/frag.glsl`. Scarlet's grass, Muse and fauna still share an additive optical-depth cloud shadow map, while its porch stove still supplies `aGlow`/`uGlow`. Newer shared shaders use a separate character-shadow map and omit the outdoor stove glow. The four local files preserve the original contracts byte-for-byte; their imports remain inside Scarlet. Do not replace them with the newer shared versions without migrating the complete corresponding rendering paths. Shared engine files remain untouched by this integration.

Scarlet's existing basket timeline, find-card stem, travel ticket and mailbox markup also retain their matching stylesheet in `ui/garden/garden.css`, copied byte-for-byte from `43c067a:src/ui/garden/garden.css`. `GardenUi` imports this local file because newer shared garden styles expect different markup. Keep markup and styles coordinated when migrating these controls; the shared stylesheet remains available to the main application's newer interface.
