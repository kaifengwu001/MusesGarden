# Tulipwind Meadows — visual contract

Primary direction: the two user-supplied illustrations in reference/. The first supplies pink tulip foreground, a tapered mill silhouette, warm attached houses and large white clouds. The second supplies long contrasting flower strips, orange roof tiles, blue trim and individually legible upright tulip cups. These are composition/material guidance, not textures to paste into the scene. No Scarlet geology, fans, olive palette or alien wildlife.

- Low gently rolling cultivated land; open sky and long views.
- Dense real cup-shaped tulips, lance-shaped leaves and slender stems. Broad uneven ribbons of rose, coral, butter yellow, ivory and periwinkle, with narrow farm paths.
- Tapered plaster windmill towers, four slender lattice sails with coloured cloth, orange tiled mill houses, blue window/door trim. Slowly turning sails and swaying flowers.
- Several smaller mills across the spherical planet, an authored hero mill and foreground garden at home. Keep the existing grow/orbit/walk/seed/picking controls and local Muse.
- Pastel blue atmosphere, cream clouds, warm diffuse sunlight, restrained grain. Distinguish petals, timber, plaster and roof tile.

Source: clean engine/scaffolder at 791263247a656a90c8950f4ef866eac564f2ea1f, separate branch environment/tulip-windmill-meadows. Preview port5241. Shared src/, server/ and existing worlds remain unchanged. Build status and gaps in VALIDATION.md. The supplied images are the selected direction; no generated concept replaces them.

## First actual-app review

The first Windows renders compiled without runtime/console errors and showed the intended tall mill, orange house, cup-shaped tulips and blue sky. Review caught an overly yellow foreground and an uninterrupted striped globe. The foreground palette was re-ordered toward pink, fields were divided by cross-paths and selected green resting parcels, and remote mills moved from a home hemisphere to seeded directions around the sphere. Plant roots now exclude mill footprints. Wind and Bloom control the new tulips; wind also changes sail speed. These are source changes, awaiting the next refreshed review.

Ground remains low and dry: the meadow relief is compressed and lifted, and the inherited pond excavation is removed in both CPU and GPU homestead functions. Existing meadow engine/UI is retained, including its example finds/postcards. No new animal species or account-backed neighbours are claimed. A separate local garden storage key prevents this environment changing the meadow's browser choices.

## Actual application evidence

The working environment now has separate real flower geometry and painted distant field bands, roughly fifty thousand persistent flower instances at the reference size, a hero mill with two nearby supporting mills and seeded distant mills around the globe. The seed build reuses geometry/materials and the growth path updates instance anchors rather than rebuilding assets. A narrow winding home path, cross-field tracks and green resting parcels interrupt the colour ribbons. Single-material plant shader changes petal opening/colour with Bloom, sways stems with Wind, and retains opaque petals. Sail rotation is deterministic in time and wind.

The inherited starter's default camera reset must not override the world-specific hero composition; the windmill scene retains its authored zoom and pitch at startup. The separate Home and Flower fields views frame the mill and tulips, not old meadow lakes.

The final [postcard](reference/windows-review/postcard.png), [normal view](reference/windows-review/windmill.png), [globe](reference/windows-review/planet.png) and [motion](reference/windows-review/windmill-motion.webm) are actual rendered evidence. See VALIDATION.md for checks, hardware, failed-then-corrected cases, limits and what remains unvalidated. User visual acceptance is pending.

## Cottage integration revision — 2 November 2026

User review identified the home clearing and the wide lane ending in the fields as disconnected from cultivation. This revision replaces the round bare patch and independent lane with compact rectangular gardens, aligns long gables with the local tulip-row direction, and connects each front door to an existing row-gap track through a short garden walk. Six additional cottages occupy different planet regions: blue simple gables, sage porch houses and rose houses with side bays. Foundations follow the spherical ground at their bottom ring while walls and roofs stay rigid. Window boxes, planted side borders and short boundary fences tie each building to its plot. Actual review and scoped checks are pending below; the earlier evidence remains preserved.

Live user review rejected the initial stepped door-to-gate path and its different colour from the row tracks (reference/user-path-feedback.png). The replacement uses one smooth cubic curve, narrowing into the actual row-gap track. All entrance, apron and field-track masks are combined before applying a single earth material; paths no longer blend separate flower colours or use a brighter home tint. Flower exclusion follows the same curve.

Final review: the home and each cottage design were inspected close up, plus front and opposite globe angles. The round clearing and long lane are absent; the home walk is continuous and uses the same soil colour as field tracks. 28 CPU checks, six scoped browser checks (four repeated after the final path correction), type/lint and build pass. Actual current evidence is indexed in reference/README.md and reference/cottage-review/. Windows renderer and remaining inherited limits are recorded in VALIDATION.md.

## Ground-filling tulip density — 2 November 2026

User asks for higher density that really fills the ground. The prior home-only detailed patch left remote walking views very sparse. This pass replaces that distinction with a globally addressed 34 cm planting lattice around every walking view, with six-petal geometry and slightly broader flowers/leaves. The lattice uses persistent cell IDs and only updates uniforms as the camera moves or the planet grows. Distant tulip candidates are doubled to88,000, using a22-triangle silhouette instead of64 triangles; the detailed nearby batch stays fixed at50,176 candidate cells. Cottage gardens, smooth entrance walks, field tracks and intentional pasture parcels remain excluded. Matched before/after rendering, GPU cost and determinism review are in progress; no new performance result claimed yet.

Density review complete: matched native-GPU renders at the user's remote view show continuous white, periwinkle, orange and yellow beds replacing widely scattered stalks. The home, cottage garden, middle distance and globe were also inspected.29CPU/5focused browser checks and scoped type/lint/build pass; original growth thresholds preserved. Current images and limitations are indexed in reference/README.md and VALIDATION.md. The denser near layer adds about1.6million submitted triangles in the reviewed close view, while distant LOD keeps globe submissions lower than the earlier full-detail batch.

## Mainline integration — 2 November 2026

The environment is committed and integrated with current mainline for publication. Mainline's changed garden and rendering interfaces required retaining the original find table, card/postbox/pins, stylesheet and affected shaders inside this world. Current shared sculpt loader naming is adopted. No shared engine edits are required. The three matched scene canvases remain exact; baskets, postcard album and find-card interactions work. Scoped validation passes with 35 CPU tests, seven browser checks, type/lint and production build. Final evidence, the recorded Direct3D warning and remaining limits are in VALIDATION.md and reference/mainline-review/.

## Polar caps and lower clouds — 2 November 2026

User review: the fields near the poles looked pinched, and the clouds could sit lower. The field pattern was laid out in longitude and latitude about the home's bearing, so its roughly ninety meridian ribbons narrowed into a dartboard at each pole (8.6 m wide at the home, 0.13 m at the poles). The band now ends at the cross track nearest ±35° latitude. Beyond it each polar cap uses azimuthal-equidistant coordinates about its pole, with the same ribbon, track, colour and resting-parcel rules, so its rows run straight and keep their width. Each cap is offset so neither repeats the home's pattern. One function defines this on both sides: `fieldCoordinates()` in life/fieldGrid.ts and `tulipField()` in planet/tulipRows.glsl. The painted ground, the close planting lattice, the distant tulips and the farm row frames all read it. The close lattice itself still addresses its cells by latitude and longitude (`latitudeLongitude()`). Farm frames now follow the zero gradient of the field phase, so buildings in a cap align with its rows. The home band, hero mill and nearby cottages are unchanged.

Default cloud altitude falls from 28 m to 5 m, the default meadow's height, after the user found 20 m still too high. Cloud bases now vary from about 4 to 6 m, so clouds sit low on the horizon behind the mills and can drift through a mill's sails (sail tips reach 15 m). The slider keeps its 1–40 m range.

[Before](reference/polar-review/before-north.png) and [after](reference/polar-review/after-north.png) at the north pole, [the south pole](reference/polar-review/after-south.png), [a bird's-eye view of the north cap](reference/polar-review/after-north-bird.png) and [the home with lower clouds](reference/polar-review/after-home-clouds.png). User acceptance pending.

## Lawns in the grid, longer and varied beds — 2 November 2026

Kai asked for the grass around each house to fit the field grid better, and for more variety, with some longer stripes. Every ribbon had been 9 units wide and broke at the same 52-unit cross tracks everywhere, a regular checker, and each farm's lawn was a box in its own frame that cut ribbons mid-width.

The grid is now one rule, `fieldCell()` in life/fieldGrid.ts, mirrored bit for bit by `tulipCell()` in planet/tulipRows.glsl (the same 32-bit integer hash, in `uint` arithmetic). Each bed runs one to four blocks before a soil break, chosen per bed, so breaks are staggered; no run outlasts four blocks, and the ±35° cap rings stay continuous tracks. About 30% of neighbouring stripe pairs are sown as one double-width bed. Each run takes its own colour, and resting fields are whole runs: clusters of six beds whose runs start together, and occasional single runs, kept 0.55 rad from the home as before. The thirteen beds around the home (stripes −4 to 8) keep their original single-block layout and colours, so the hero view's pink and red foreground is unchanged.

Each farm's lawn is a cell of the grid: every whole bed its fenced yard touches, from a short soil track just behind the yard to one just in front, in the coordinates of the farm's own region so it holds together across a cap's edge. The beds run on as tulips past both tracks. The front walk runs straight from the door, along the ribbon, to the front track. `farmGround()` in life/farmLayout.ts and `tulipFarmGround()` in the GLSL define the lawn, walk, apron and end tracks for the painted ground and both tulip layers. A farm whose lawn would cross the meridian opposite the home, where longitude restarts, moves along its circle of latitude to keep clear (at seed 412 one mill moves 9° at R40). Fences and borders are unchanged, so on wide beds some lawn lies outside the fence.

[Globe](reference/grid-review/globe.png), [a cottage in its lawn](reference/grid-review/cottage-lawn.png), [long runs](reference/grid-review/long-runs.png), [staggered ends from the ground](reference/grid-review/staggered-ends.png) and [the home](reference/grid-review/home.png). Kai's acceptance pending.
