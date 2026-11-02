# Ti Tian reference pack

The original two terrace images were supplied by the user for this new Chinese terraced-farmland planet. They define this environment's form, palette and material relationships. Their source renderer is unavailable: the user explicitly confirmed that they do not have its source file or project. Reconstruct the pictured farmland as spherical geometry from these references. Two additional village paintings now guide Muse’s Hui-inspired cottage.

| Image | Role | Visible requirements |
| --- | --- | --- |
| [Terraced farmland render](terrace-render.png) | Primary composition and material reference; original attachment `IMG_9203.png` | Dense curving plots across rolling relief; pale flooded fields interleaved with three green value families; narrow light banks; wooded hilltop islands; slender brown trunks and clustered faceted crowns. |
| [Terrace shapes and render board](terrace-comparison.png) | Contour, plot-boundary and relief reference; original attachment `IMG_4027.png` | Long bands following the hills, unequal widths and rounded turns, short transverse plot divisions, physical step faces and tree groves viewed from above and obliquely. The left panel adds an aerial comparison for the contour structure. |

[provenance.json](provenance.json) records the original filenames, byte sizes and SHA-256 hashes of all four references. The copies are byte-identical to the supplied attachments. They are references, not generated app screenshots or proof that the new planet has matched them.

## Cottage references and current review

- [Hui hillside village](hui-hillside.jpg), original `6c477298c1b2f48f08a1a665778e401b.jpg`: white houses above terraced fields, stepped gable walls, dark tiled roofs and timber openings.
- [Hui water village](hui-water-village.jpg), original `faaf0358668372d376e18c9ee4da1e7c.jpg`: intimate rural scale, layered roofs, white plaster, planted edges and a calm green setting.

Current actual cottage views after the ground-level correction: [front](fit-cottage.png), [rear](fit-cottage-rear.png), [courtyard](fit-cottage-top.png), [approach](fit-approach.png), [planet](fit-planet.png) and [phone](fit-mobile-cottage.png). [Metadata](fit-review.json) includes source hashes and cameras. The hollow is filled to the surrounding terrace grade; the cottage and narrow stone-panel border meet this ground without a tall plinth or projecting stairs. Desktop1440x900, phone390x844,DPR1,RTX4070SUPER/ANGLE D3D11. Building details are an interpretation of the supplied paintings, not a measured heritage reconstruction. The construction record contains supporting architectural source links and the physical placement contract.

The previous [raised platform](hui-cottage.png) and other `hui-*` captures are retained as rejected-placement history.

## Visual contract

- **Terrain:** a globe composed of interlocking cultivated hills. At close range, individual paddies read as level treads with real height changes and earthen risers. At orbit distance, curved terrace bands remain legible around the sphere.
- **Field shapes:** contours bend around local hill forms. Plot width, length and curvature vary; short dividing banks break a long band into unequal fields. The field network covers the landscape rather than appearing as isolated decorative terraces.
- **Water:** flooded plots are broad, quiet pale grey to faint lavender surfaces. Their contrast with green plots is a major part of the pattern. Preserve continuous edges and stable depth ownership where water meets a bank.
- **Rice:** planted fields span dark olive, medium green and brighter yellow-green, with different plots at different growth states. Close detail follows the broad field pattern.
- **Banks:** slim pale earth rims and darker exposed soil faces distinguish neighboring levels. Their width stays modest relative to a field's usable surface.
- **Trees:** compact groves occupy wooded ridge islands and selected uplands. Crowns overlap in unequal clusters, with varied heights and faceted green silhouettes. Trunks remain thin and earthy.
- **Presentation:** a neutral blue-grey sky, soft directional illumination and restrained shading preserve the reference's readable landform and palette.

## Sphere adaptation

The square reference's exposed vertical cutaway sides explain its soil depth. On a complete planet, that material role belongs to terrace risers and earth banks. The globe should carry the cultivated hill structure continuously across its surface, including the far side. Review seams and polar regions as closely as the first camera pose.

The [construction record](../CONSTRUCTION.md) tracks the implementation, and [validation](../VALIDATION.md) separates checks and actual app evidence from reference intent. Preserve the supplied images when adding review screenshots; label each new capture with its source seed, camera and renderer.

## Current continuous-terrace review — 2 November 2026

The user rejected the first delivery's soccer-ball divisions. Fixed regional boundaries have been replaced by short curved cuts staggered per terrace. Current actual captures: [globe](continuity-planet.png), [paddies](continuity-paddies.png), [top](continuity-above.png), [far side](continuity-back.png), and [metadata/source hashes](continuity-review.json). Seed412/R128,1440x900,DPR1,RTX4070SUPER/ANGLE D3D11; no captured errors. See the construction and validation records for the cause, correction and checks. The images below retain the rejected version for comparison.

## Previous actual app review — 2 November 2026 (rejected panel layout)

- [Whole planet](app-planet.png)
- [Across the paddies](app-paddies.png)
- [Top view](app-above.png)
- [Capture metadata](app-review.json)

These are actual generated-world captures, separate from the two supplied references above. Seed412/R128,1440x900,DPR1, native Chromium / RTX4070SUPER / ANGLE D3D11. Read [validation](../VALIDATION.md) for the checked scope and limitations. Visual acceptance remains pending user review.

The final [far side](app-back.png) was also inspected. Capture metadata includes source branch/HEAD, SHA-256 of runtime source files, camera positions/targets and renderer identity.
