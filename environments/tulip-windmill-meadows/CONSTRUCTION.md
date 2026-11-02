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
