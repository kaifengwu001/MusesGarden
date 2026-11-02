# Ti Tian construction record

Created on 2 November 2026 from meadow integration commit `7912632`, in the dedicated `environment/rice-terraces` branch and `rice-terraces-worktree` checkout. The original clean baseline is preserved at workspace `handoffs/windows/rice-terraces-2026-11-02T08-26-14-304Z`.

The user's request is to place the already-rendered Chinese terraced-farmland language onto a planet. The [two supplied references](reference/README.md) are the visual direction. The user confirmed that the flat renderer's source is unavailable, so this work reconstructs its geometric recipe. Development and visual review are ongoing; [VALIDATION.md](VALIDATION.md) records what has actually been checked.

## Geometry and field ownership

The terrain is generated over the sphere from a deterministic continuous field. Rolling hill provinces establish the underlying elevation, then physical terrace levels split the hills into cultivated bands. A paddy's top surface follows its terrace level, while explicit riser geometry supplies the exposed earth between adjacent levels.

The implementation separates the sampled field contract from the render mesh:

| Module | Responsibility |
| --- | --- |
| `planet/riceFields.ts` | Seeded spherical hill field, terrace level, field identity, flooded/planted choice and woodland mask. Exposes `sampleRiceField` and the reference radius. |
| `planet/riceLandscape.ts` | Builds the actual stepped globe from the sampled field: paddy tops, terrace walls and bank/plot structure. Owns terrain materials and geometry disposal. |
| `life/farmLife.ts` | Instanced tree groves on wooded uplands and selected rice detail in planted fields, using the same sampled surface heights. |
| `main.ts` | Dedicated Three viewer, lighting, orbit and close framing, seed/growth controls and `window.__meadow` development harness. |

Keep the field definition continuous across cube-face boundaries. Contour clipping should produce shared endpoints for neighboring triangles, with a single surface owner for each paddy top. A physical step must remain visible at grazing angles. Check for cracks, missing walls, duplicate surfaces and narrow triangles where a contour crosses a grid corner.

Individual plot identity controls flooded or planted appearance. Maintain coherent color within a plot, while neighboring plots differ in growth state. Pale narrow banks provide short transverse divisions as well as the contour rims. A continuous direction-space parcel coordinate supplies curved cuts, staggered at every terrace level. Never reuse a fixed polygon partition across multiple levels: it creates visible planet-sized panels.

## Materials and planting

The important material relationship is pale water against varied green rice and earthy boundaries. Flooded surfaces should remain quiet and broad, with restrained highlights. Planted plots use deep olive, mid-green and yellow-green values. Soil faces and narrow bank caps define the step depth without dominating the cultivated surface.

Woodland masks reserve some uplands as tree islands. Tree roots use the same terrace surface sample as the terrain; flooded plots retain clear water surfaces. Groves use unequal tree sizes, slender trunks and overlapping faceted crowns. Rice detail is limited to planted plots and should retain the field-level composition at orbit distance.

## Viewer and growth contract

The current iteration is a dedicated spherical terrain viewer with orbit, zoom, close/overview framing, seed selection and growth controls. It retains `window.__meadow` for scoped development inspection. The initial geometry is authored at a reference radius; any global scale or regeneration used for growth must keep terrain, trees, rice and camera framing consistent.

This viewer does not yet establish the meadow's full interaction or backend contract. Inherited scaffold tests cover the modules they exercise and should be distinguished from tests written for this environment. Exact supported harness operations and actual results belong in [VALIDATION.md](VALIDATION.md).

## Isolation and review

All world-specific changes stay inside `environments/rice-terraces/`, with scoped checkout scripts/configuration as needed. Shared shader include names and `window.__meadow` retain their established names where those systems are used. Shared `src/`, `server/` and other worlds remain outside this environment's edit scope.

Use one heavy job at a time and the reserved preview port 5247. Review the actual running planet at full-globe, oblique and close views, including another side of the sphere. Compare contour shape, plot size, water/green ratio, tree grouping and material distinction against the reference pack. Record camera, seed, renderer/backend, viewport and resolution with screenshots. Functional checks and a successful build do not establish visual acceptance.

## Local review and implementation details

The terrain uses1.2m levels at reference radius128m. Contour clipping partitions each source triangle into paddy treads; separate raised caps and earth walls own boundaries without coplanar overlays. Default geometry uses a96-cell cube-face grid with continuous direction-space sampling. Plot cuts use a smooth spherical scalar, so there is no longitude seam, polar UV grid or fixed regional panel network. A small bank strip provides transverse field divisions. Pale water and green land are separate materials.

The first scene review showed groves concentrated in a few large provinces. Forest choice now includes groups of three terrace levels as well as region and seed, creating smaller wooded islands. All flooded parcels stay treeless. Tree/life generation is capped and interleaves globe traversal before the cap, avoiding northern-only filling. The whole source scene is uniformly scaled by the radius control, including vegetation; this is a deliberate visual viewer contract rather than physical-size-preserving plant growth.

The close camera uses the local hill normal as up and re-creates orbit controls for that basis, so the fields read as a hillside instead of a tilted globe wall. Overview and top-down views use framing that clears the bottom controls. See VALIDATION.md for checked behavior, hardware and remaining limits.

## Continuity correction — 2 November 2026

The user rejected the first delivery's soccer-ball appearance. Although the height field was continuous, 32 fixed spherical Voronoi cells owned field colours and transverse banks at every elevation. Their coincident boundaries made long straight seams through the terraces. This was a field-layout error, not a requirement of rendering a sphere.

`riceParcelCoordinate` now samples a smooth direction-space field. Each level clips that field at integer intervals with a different `riceParcelPhase`; short curved dividers end at contour rims instead of aligning across many levels. The same rule governs material selection and planting. The mesher carries the scalar through every clipping intersection, so adjacent triangles agree on endpoints. Height contours, physical risers, palette, viewer and plant geometry remain unchanged. Plant positions regenerate because their supporting plot states changed.

The first correction had too many short cuts and exceeded the existing 1.2-million terrain-triangle check. Reducing parcel-coordinate variation lengthened the plots and brought the terrain to 1,084,961 triangles without changing the threshold. Current [globe](reference/continuity-planet.png), [close view](reference/continuity-paddies.png), [top](reference/continuity-above.png) and [far side](reference/continuity-back.png) replace the rejected panel layout. Details and source hashes are in [validation](VALIDATION.md).

## Muse’s Hui courtyard cottage — 2 November 2026

The user proposed a home with black roofs, white walls and traditional Hui architecture, supplying two village paintings. The design is a modest two-storey hall with a perpendicular lower wing around a small stone courtyard. Three stepped white gable walls, dark caps, charcoal tile channels and rows, recessed timber doors, lattice windows and a low wall with an open gate establish the silhouette. A stone bench and two planted jars supply domestic scale. The supplied paintings guide this interpretation; it is not a measured reconstruction of a historic building. White walls, dark tiles and stepped horse-head gables are documented characteristics of Hui architecture in the [China World Cultural Heritage monitoring reference](https://www.wochmoc.org.cn/contents/54/493.html); [UNESCO’s Xidi and Hongcun record](https://whc.unesco.org/en/list/1002/) supplies regional context.

| Module | Cottage responsibility |
| --- | --- |
| `life/huiCottageGeometry.ts` | Local building geometry, actual door/window holes, roof relief and stepped gables; seven merged material batches. |
| `planet/cottageSite.ts` | Seeded dry-site search, downhill orientation, dense footprint/approach survey, local ground solver and vegetation reservation. |
| `life/huiCottage.ts` | Courtyard paving, ground-reaching retaining skirt, entrance steps and placement in the spherical tangent frame. |

The site search ranks 640 candidate directions with two orientations, then densely samples the best 20. It prefers dry low-relief ground near the visible hemisphere. At seed412 the sampled footprint and approach are dry, with 1.579m relief. The floor clears the highest sampled support by0.34m, including allowance for the narrow field banks. Foundation feet solve ground at each actual rigid x/z column; they are not merely placed at the centre height. The courtyard cap is partitioned into stone and mortar faces, with no coincident whole-floor overlay. Horizontal masonry courses replaced an initial striped-looking skirt during actual review.

Trees reserve3m clearance from the home/yard/entrance footprint, and rice tufts0.5m. Existing planted life outside the reservation still follows the same dry-field recipe. Terrain height, parcel flow, colours and mesh generation are unchanged. For unusual seeds, the site finder chooses the lowest-cost candidate rather than modifying the terrain; dry low-relief placement is verified for the sampled seeds, not guaranteed for every possible seed.

The cottage camera uses local radial up, follows radius scaling and preserves framing when the viewport aspect changes. Its reference images are bundled into the production build. This remains a visual residence in the dedicated viewer: it does not add interior navigation, a Muse resident or backend behavior. Current [front](reference/hui-cottage.png), [courtyard](reference/hui-cottage-top.png), [rear](reference/hui-cottage-rear.png), [approach](reference/hui-approach.png) and [planet](reference/hui-planet.png) are actual app captures. See [validation](VALIDATION.md) for tests and source hashes.

## Cottage at the surrounding ground level — 2 November 2026

The user rejected the broad elevated stone plinth and staircase, then clarified the preferred solution: fill the hollow so the house and nearby stone panels meet the surrounding terrace grade. The original `hui-*` captures above record the rejected placement. The cottage architecture itself is unchanged.

Site selection now looks for dry concave pockets with higher flanks and rear ground, plus a near-grade entrance. At seed412, the selected hollow's flanks average2.718m above its centre and the rear rises1.718m. The floor is set from the surrounding footprint rim. `cottageGround.ts` raises the terrain beneath the home to a plane4cm below the paving surface, with a narrow level earth edge and a3.8m smooth transition back into existing terraces. This changes the terrain mesh itself; no overlapping mound is added. Narrow terrace walls collapse where the filled grade becomes level. The same ground function supports nearby vegetation, so roots follow the fill. Terrain outside the local footprint and transition is unchanged.

`cottagePaving.ts` follows the stepped house/courtyard outline and adds a40cm stone border. The paving is partitioned into two non-overlapping rectangles rather than a large square podium. All nine projecting stair treads are removed. The remaining stone edge is only a shallow slab on the raised earth, rather than exposed retaining walls. Ground checks raycast the actual rendered mesh beneath the paving, including its outer corners, and verify close contact. Distant terrain remains unaffected by the grading function.

A raw-ground test exposed a pre-existing fixed-point iteration that could oscillate between two terrace heights. A column can meet a vertical riser instead of a horizontal tread. The raw solver now finds a verified tread or the topmost solid/air riser crossing; the regression independently checks exact contact and air/solid sides. No geometry budget or numeric tolerance was lowered.

Current [front](reference/fit-cottage.png), [rear](reference/fit-cottage-rear.png), [courtyard](reference/fit-cottage-top.png) and [entrance](reference/fit-approach.png) show the corrected integration. The full before-edit source/assets/index record is at workspace `handoffs/windows/rice-terraces-2026-11-02T09-36-03-275Z`.
