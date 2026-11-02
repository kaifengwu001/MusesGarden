# Construction notes

## World modules

| Files | Responsibility |
| --- | --- |
| `main.ts`, `world.ts`, `params.ts` | Standalone boot, world orchestration, camera views, wind and growth parameters. |
| `planet/fields.ts`, `fields.glsl`, `bake.frag.glsl` | Matching CPU/GPU dry sand relief and cube-map baking. |
| `planet/terrain.ts`, `terrain.glsl` | Ground sampling, home plateau, dry clearance, conservative height bounds. |
| `planet/meadow.glsl`, `surface.frag.glsl` | Matte rose sand, fine grains and restrained wind-ripple lines. |
| `life/windGeometry.ts`, `windGeology.ts`, `windfieldScenery.ts`, `windfieldScenery.*.glsl`, `windRockOutline.*.glsl` | Eight solid geological forms, connected bedrock belts, three plant variants, rock-edge ecology and drifting seeds. |
| `life/wildlifeGeometry.ts`, `windWildlife.ts`, `wildWildlife.*.glsl`, `wildlifeContact.*.glsl` | Reference-size Sailbacks, Kitelets and Sand Stitchers, articulated motion, terrain-supported feet and contact shadows. |
| `view/camera.ts` | A local inspection lens for small wildlife, preserving normal shared navigation. |
| `life/props.ts`, `props.*.glsl` | Rough slate shelter, thick fractured canopy, suspended canvas porch and timber windbreak. |
| `render/sky.ts`, `sky.frag.glsl`, `palette.ts` | Pale yellow sky, broad moving cirrus ribbons and coherent material colors. |
| `life/residents.ts`, `residentLife.ts` | Local Muse identities, deterministic walking, resting, greetings and petting. |
| `ui/windfieldUi.ts`, `windfield.css` | Named views, wildlife encounters, resident selection, naming and follow controls. |
| `garden/state.ts`, `ui/garden/*` | Garden preferences isolated from the meadow and other worlds. |

The local cloud module omits unused water-reflection and cover maps while retaining Muse shadow passes. The painted sky supplies the long cirrus ribbons.

Shared helpers and character assets are imported from `src/` unchanged. A world-specific change to a shared module requires a local copy.

## Ground and placement

The planet is dry at every supported radius, 40–400 m. `Terrain.sample()` returns `water = 1000`, `depth = 0` and `wet = 0`. Water is signed shore clearance in the existing placement API; a zero value would reject valid dry ground. Legacy wetland/water-level controls cannot flood this world.

`sandHeight()` is continuous; dunes are not quantized into steps. Both CPU and GLSL recipes must change together. The existing cube bake retains CPU/GPU agreement for the smooth sand recipe across the supported radii. The analytic height bound uses summed noise amplitudes, rather than a statistical estimate.

The shelter preserves the existing 1.2 m ground level, deck, steps, bench and lookout footprints needed by Muse's routines. Persistent flora and rock anchors retain unit-direction identity as the sphere grows. Additional anchors emerge gradually. Near-home landmark dimensions remain in meters. Resident walking lanes are clear of authored scenery.

Cobalt geology is actual angular geometry, not flat blue ground patches that could be mistaken for pools. Sand grain fades below its pixel footprint. Rock fissures are thin and restrained; leaves are thin curved meshes with asymmetric wind-swept edges. Shared wind direction/strength bends the seed-sail stems. Ambient fauna and seed paths are deterministic functions of time.

## Persistence and backend boundaries

Names use `muses-garden.cobalt-windfields.residents.v1`; garden preferences use `muses-garden.cobalt-windfields.garden.v1`. Blocked storage still permits play for the current visit. The local residents do not alter the account's friends or presence state.

The primary Muse can follow the existing optional backend. Default garden content remains example data. Backend-managed travel between distinct planet types needs a future environment field and router; the local invitation preview does not claim to implement it.

## Navigation and wildlife boundaries

Terrain is a radial height field. The Wind Window is two separate meshes, open above, so it requires no cave or overhang generator. Decorative rocks do not create a general physical collision mesh; movement support comes from the terrain and authored home footprint. Resident paths stay within their safe settlement lanes.

Sailbacks have four padded feet, blue armour and two thin ivory back sails; Kitelets have four coral diamond wings; Sand Stitchers have two curved blue shell panels, four feet and a straight carried stem. Their small authored motion loops establish life and scale. They are not capture targets, pets, account companions or a scientific ecosystem simulation. Sand Stitchers carry one straight stem, then pause to tuck it into a sheltered sand pocket.

CPU checks cover dryness, bounds, growth, home support and resident behavior. Browser checks cover shaders, ground parity, picking, interaction, persistence and narrow-screen views. Captures live under `shots/cobalt-windfields/`.
