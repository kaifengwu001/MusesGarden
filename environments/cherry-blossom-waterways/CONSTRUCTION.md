# Cherry Blossom Waterways — construction record

## Brief and visual contract · 2 November 2026

Build a new interactive planet from the user's nine cherry-blossom illustrations. The user confirmed that no existing renderer source is to be reused. This is a separate environment, with its own reference direction. Starting revision: `791263247a656a90c8950f4ef866eac564f2ea1f`; branch `environment/cherry-blossom-waterways`; strict preview port 5249. The clean meadow scaffold supplies the engine and interaction contracts.

The dominant shapes are asymmetric spreading crowns and long weeping curtains of pink and ivory blossoms, with dark crooked branch structures visible between sprays. Fresh green banks frame winding open cyan-blue water. Canopies should overlap into broad masses, with clearings and water providing negative space. A small open tiled pavilion and timber landing give the nearby view a human scale. Petals drift through gaps and collect along quiet banks. No mountains or repeated circular tree balls are part of the brief.

Reference roles: images 1–2 define the waterway, willow and bank composition; 3–4 establish bright pink/ivory petals and clear blue water; 5 defines dark expressive trunks and an avenue; 6 and 8 define weeping sprays and canopy tunnels; 7 and 9 establish airy blossom edges against blue. The implementation combines their compatible features rather than copying the flat viewpoint onto a sphere. Source images are preserved in [reference](reference/README.md).

## Architecture

Waterways and grove regions live in seeded spherical direction space. Tree anatomy and pavilion details use meters; their size stays constant when the planet grows. CPU terrain, GPU bake, placement and picking share the same canal shape. Roots are admitted only on supported dry ground, and the pavilion's existing walking footprint stays clear. Tree variants are batched through shared planet warp/light uniforms. Time-driven petal motion is analytical, so freezing and returning to a time can be checked directly.

The shared `src/`, shader include names and `window.__meadow` remain intact. This world owns its copied modules under `environments/cherry-blossom-waterways/`. The fresh baseline and copied index are recorded by `handoffs/windows/cherry-blossom-baseline.txt` in the parent workspace.

## Work log

- Created the isolated clean checkout, saved the pre-edit inventory and hashes, and scaffolded 48 world modules and five inherited tests.
- Preserved all nine user references and established the visual contract before implementation.
- Terrain, tree anatomy and pavilion are being built in parallel; visual checks will compare a nearby waterway, canopy detail and full globe before delivery.
- First actual review: the terrain/warp parity check passed and frozen time returned exactly, but blossoms looked like pointed stars and the weeping crowns were too sparse. Petal outlines were rounded, overlapping sprays increased, and supported inner branches filled large central holes. Original review images are preserved as `reference/iteration-01-*`.
- Root placement now samples eight points around the complete buttress footprint, rejects steep or wet banks, and embeds the trunk slightly. Independent tests inspect actual transformed root tips and protected pedestrian/support areas at R40, R128 and R400.
- Four species use detailed geometry nearby and cheaper silhouettes far away. Branch and spray positions share one deterministic stream at both detail levels. The Bloom control also changes the cherry canopies; analytical petal motion follows their anchors.
- The pavilion replaces the cottage's walls and high roof with an open coral timber frame and low curved slate tiles. Its floor, landing and steps preserve navigation support. Obsolete cottage reflection and wall shadow were removed.
- Added three rowboats, three cream ducks and short wakes in the home pond. Safety checks cover their complete motion envelope; their visible geometry stays on water through radius and time changes. Falling petals and water motion return exactly to a frozen time.
- Completed the second visual review of the arrival globe, opposite hemisphere, pavilion garden and weeping canopy. Rounded dabs now read as overlapping blossoms; the close view shows the reference's water/pavilion/boat relationship. Reduced cloud coverage opens the globe and reduced water reflection leaves the channel blue. Further texture/stroke fidelity remains an art-review topic.

## Willow, branch joints and water life · 2 November 2026

The user found the willow sad and its branches stiff. The revision gives its main boughs broad rising arches, then unequal curved hanging sprays, fuller foliage and short upward-growing leaves around the shoulders. Thin willow stems retain their curve samples instead of collapsing to two straight spans. Flex increases from each hanging attachment toward its tip, so the roots stay fixed while the outer foliage moves more freely.

Follow-up inspection confirmed disconnected branch joints: child stems had been placed on an ideal curve rather than the actual simplified parent mesh. Branches now attach to sampled points on their rendered parent polyline at both detail levels. This addresses the connection itself rather than hiding gaps with foliage.

Floating blossom marks were also too small beside the tree dabs. Water petals now have explicit lengths of 0.24–0.42 m and nominal widths of 0.12–0.22 m, with tapered outlines, varied headings and pink/ivory colour. Unequal drifts collect near banks, with sparse petals on open water. They fade when too distant to resolve; the separate animated sun glints remain unchanged.

Seeded duck flocks now occupy remote canals as well as the home pond. Flocks vary in population, follow the waterway contours and use checked water footprints. Their motion is evaluated directly from time, preserving repeatability without accumulating swimming state.

Native review now shows fuller arching willow foliage, visible floating petals at the user's saved viewpoint, connected branch joints and duck flocks in canals on different sides of the planet. At seed 412 there are 45 remote ducks in 17 flocks, in addition to the three home-pond ducks. See the [matched willow before](reference/willow-before-willow.png) and [after](reference/refinement-willow.png), [water-petal view](reference/refinement-user-water-joints.png), and [remote flock](reference/refinement-canal-ducks-1.png). The original delivery images remain as historical checkpoints.

## Validation

The local implementation is ready for review at [Cherry Blossom Waterways](http://localhost:5249/environments/cherry-blossom-waterways/). The current refinement passes 43 CPU tests across nine files and seven focused native-GPU browser checks, with scoped type/lint and production build. Actual renderer evidence, source hashes and concrete limitations are in [VALIDATION.md](VALIDATION.md). The artwork remains a stylized 3D interpretation; user visual acceptance is pending.

## Mainline integration · 2 November 2026

The environment is integrated with current mainline while preserving the reviewed scene. Mainline changed the shared garden state, controls, find-planting table and shadow contracts after the original scaffold. Cherry now owns the affected versions of those modules and styles inside its environment folder. The current shared sculpt loader supplies the same model geometry and textures. No shared engine or server files were changed for Cherry.

Integration passes 49 CPU tests across ten files, including the six existing planting-table regression tests, seven native browser checks, scoped type/lint and production build. Four paired views—globe, willow, the user's water view and a remote duck flock—have identical canvas hashes between the original preview and integrated mainline. Baskets opens and Pins toggles correctly. See [mainline review evidence](reference/mainline-review.json) and [validation](VALIDATION.md).
