# Golden Rye reference and visual contract

Four user-supplied paintings are the art direction, kept byte-for-byte from the attachments. They guide a new, navigable spherical world. They are not renders from the application.

- [01 Harvest](01-golden-rye.jpg): golden coverage, cut passages, tied sheaves, distant terracotta farm buildings.
- [02 Wind and distant ridges](02-golden-rye.jpg): flowing cereal masses, olive divisions, blue-violet background landforms.
- [03 Golden waves](03-golden-rye.jpg): interwoven cream/ochre strokes and a restrained small farmhouse.
- [04 Rye anatomy and sky](04-golden-rye.jpg): primary foreground guide: drooping pointed grain heads, long awns, curved stems, deep olive troughs and sweeping cream clouds.

## Contract

The planet must read as a continuous sea of warm rye. The user's first review specifically asks for crop on every part of the terrain, including the hills and former harvest lanes, more tree groups, and a much subtler gold-to-purple transition. Only the actual cottage footprint stays free of stems. Grain heads and fine awns need to be visible close up. Wind moves coherent areas rather than unrelated stems. Shadows are ochre/olive, light tips pale cream. Distant relief blends gradually into dusty lavender and ochre; cypresses remain slender, asymmetric dark-green silhouettes in uneven groves. Small farm structures remain subordinate. The user rejected the thin chained clouds and asked to follow the default scene: use its rounded, connected cumulus anatomy and sky gradient. Preserve the pictures' varied directional brush marks without coating every object in the same noise.

Compare globe, normal harvest view and crop close-up separately. A yellow meadow with generic flowers does not satisfy this contract. Earlier worlds supply workflow lessons only; their palette, species, scenery and art direction are not sources here.

## Actual application evidence — first Windows checkpoint

These are real renders of the new Golden Rye environment, not additional concept art:

- [Across the rye](app-field.png)
- [Among the ears](app-detail.png)
- [Whole planet](app-globe.png)
- [Wind comparison at time 16](app-wind16.png), against detail at time 12
- [Renderer/camera/count metadata](review.json)
- [Source hashes, height parity and allocation](source-and-parity.json)

All captures are 1440×900, DPR 1, high quality, native RTX 4070 SUPER / ANGLE D3D11. Read [validation](../VALIDATION.md) for exact checks and limits. User visual acceptance remains pending. The four paintings above remain the visual source, distinct from these implementation screenshots.

## Current followup: full coverage, softer hills, more trees, default clouds

[Field](full-cover-field.jpg) · [grain detail](full-cover-detail.jpg) · [globe](full-cover-globe.jpg) · [far side](full-cover-far-side.jpg) · [remote walking](full-cover-remote-walk.jpg).

These are actual IAB screenshots at1440×900, DPR1, high/MSAA4/time12. The prior `app-*` images above remain a historical comparison. [Budget screenshot](full-cover-field-budget.jpg), [HUD text](full-cover-budget.txt) and [CPU population](full-cover-population.json) accompany the review. See [current validation](../VALIDATION.md#full-coverage-followup--2-november-2026) for evidence and limits.

## Mainline integration review

[Field](mainline-field.jpg) · [globe](mainline-globe.jpg) · [basket panel](mainline-baskets.jpg). Actual in-app browser captures at its native1665×1191 viewport, high quality, frozen time12. The field and globe were compared against the source checkpoint using the same camera and browser. See [integration validation](../VALIDATION.md#mainline-integration--2-november-2026); no new benchmark or automated browser result is claimed.

## Flat-fields references — 2 November 2026

Three more images from Kai, kept as supplied (SHA-256 below):

- [05 Flat fields](05-flat-fields-print.png): a level plain of bold yellow fields divided by thin green banks, a winding pale road, farmhouses among trees. `ed6000da…`
- [06 Takemasa terraces](06-takemasa-terraces.png) by Ryo Takemasa: **the shape reference**. Long strips of yellow, lemon and yellow-green crop with rounded ends, following one another like contours, olive bunds of uneven width between them, a fuzzy stippled top and darker edges, so each field reads as a raised mass. `4a07cb9d…`
- [07 Farm map](07-farm-map.jpg): the road reference. The road runs between fields with verges and hedges, fields aligned to it on both sides, in a dusty pinkish beige, a farmhouse in a small yard beside it. `82e83a58…`

Contract added: flat ground and no hills; fields as long rounded strips (06); roads that belong to the field layout, never cutting across it as a separate pattern, and not white (07); the crop as a dense mass with a stippled top and darker sides, ears visible near the camera. The palette of the first fields pass was accepted ("palette is good for now"). Actual app captures (after the road and edge-on follow-up): [globe](fields-globe.jpg), [above the cottage](fields-above.jpg), [across the rye](fields-across.jpg), [among the ears](fields-among.jpg), [a far field's edge](fields-horizon-edge.jpg); before: [field](fields-before-across.jpg), [globe](fields-before-globe.jpg).
