# References

## Mainline compatibility review

- [Cottage and mill](mainline-review/mainline-home.png), [dense flower fields](mainline-review/mainline-fields.png), [globe](mainline-review/mainline-globe.png).
- [Postcard album](mainline-review/mainline-album.png), [find card](mainline-review/mainline-find.png).
- [Source/mainline comparison](mainline-review/comparison.json), [final merged scene and control checks](mainline-review/final-smoke.json).

The three scene canvases are pixel-identical to the original preview at matched camera presets, frozen time12 and disabled pins. Native Windows Chromium / ANGLE D3D11 / RTX 4070 SUPER, 1440x960, DPR1/high/MSAA4. Final control smoke records zero runtime errors and the shared butterfly shader's Direct3D compiler warning. These images preserve the existing design during mainline integration.

## Current density review

The latest planting is shown in `density-review/`; previous cottage images below retain the earlier sparse planting.

- Exact user angle: [before](density-review/before-user-fields.png), [after](density-review/after-user-fields.png).
- Home: [before](density-review/before-home.png), [after](density-review/after-home.png).
- [Garden and path clearance](density-review/after-garden.png), [middle distance](density-review/after-middle-distance.png), [globe](density-review/after-planet.png).
- [Before metadata](density-review/before.json), [current metadata/source hashes](density-review/after.json).

Actual native Windows Chromium / ANGLE D3D11 / RTX4070SUPER, 1440x960, DPR1/high/MSAA4, time12; no captured shader/page/console errors. Complete prior source/evidence is preserved at workspace handoffs/windows/tulip-density-active.txt.

## Current cottage integration review

The newer `cottage-review/` evidence supersedes the original building/ground arrangement shown in `windows-review/` (retained below as history).

- [Home](cottage-review/home.png), [home garden and smooth entrance](cottage-review/home-garden.png).
- [Blue gable cottage](cottage-review/blue-cottage.png), [sage porch cottage](cottage-review/sage-cottage.png), [rose side-bay cottage](cottage-review/rose-cottage.png).
- [User globe angle](cottage-review/user-view.png), [opposite hemisphere](cottage-review/opposite-planet.png), [capture metadata](cottage-review/review.json).
- [User feedback](user-path-feedback.png) records the rejected stepped entrance and mismatched path colours. Current captures show the smooth path and unified earth material instead.

Actual Windows Chromium / ANGLE D3D11 / RTX 4070 SUPER renders at 1440x960, DPR1, high quality, MSAA4, time12; no captured shader/page/console errors. These are scene screenshots, not new concept art.

- user-windmill-pink-tulips.jpg: first user image, original filename cc1c78810d1c0bef290dd5065b5ca87d.jpg. Pink tulip foreground, tapered windmill, attached houses and large white clouds.
- user-windmill-colour-fields.jpg: second user image, original filename babfc4dbccfffce91875ab2d5ccff410.jpg. Colour-banded fields, blue-trimmed orange-roof mill house and lattice sails.

User-supplied visual guidance on 2 November 2026. Artist signatures and original artwork are retained in the references; they are not scene branding or textures. Actual application screenshots will be indexed separately.

## Actual rendered review — 2 November 2026

These are implementation evidence, separate from the two source illustrations:
- [Normal windmill view](windows-review/windmill.png)
- [Postcard](windows-review/postcard.png)
- [Whole planet](windows-review/planet.png)
- [Live canvas recording](windows-review/windmill-motion.webm): 4.999s, 1440x960, no audio; turning sails, wind and a small camera move.
- [Capture metadata](windows-review/review.json): runtime/error state, renderer, viewport and exact view state.

Source: uncommitted environment/tulip-windmill-meadows based on7912632. Native Windows RTX4070SUPER/ANGLE D3D11, high quality, DPR1. Stills are frozen at time12. Motion sampling at 1s and3.7s showed visibly different sail/camera positions; this is scoped review, not proof of every camera or GPU. Source/media SHA256 inventory is at workspace handoffs/windows/tulip-delivery-inventory.json. See ../VALIDATION.md for remaining limits.
