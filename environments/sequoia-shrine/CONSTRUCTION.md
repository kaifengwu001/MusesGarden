# Sequoia Shrine visual contract

Source: the three images supplied by the user on 2 November 2026, preserved in reference/. These guide spatial relationships, botanical scale, print-like colour and architecture. They are not screenshots of the application. The world is a new environment scaffolded from clean engine commit7912632; no preceding world's palette/species/layout is a source.

- Tall sequoias dominate: heavy warm fibrous trunks, wide fluted roots, high uneven dark green conifer branches and crowns; a person and shrine are small beneath them.
- A quiet vermilion timber shrine sits within the grove, with swept dark moss-edged roof, stone approach/stairs, torii and lanterns. The route remains legible between the trunks.
- Ground is soft moss, ferns and leaf litter beside a warm earth path, with natural rolling land and low stones. No ornamental flower meadow or lake around the shrine.
- Near foliage is deep jade/forest green; successive trunks recede into cool turquoise and blue-grey haze. Pale sky and dappled warm light provide openings in the canopy.
- Fine vertical bark marks, wood grain, stone edges, needle/fern silhouettes and restrained print grain supply material differences. Avoid identical conical trees, ball canopies and glossy clay.
- Authored shrine composition and global seeded forest share the same species and materials. Growth, ground sampling, picking and engine harness remain compatible. Decorative trees/shrine do not imply general climbing/interior navigation or new account services.

Implementation order: terrain/camera → shrine and giant tree examples → uneven global stands/understory → material detail → actual close/normal/globe screenshots and scoped checks. Validation.md records actual outcomes and remaining visual gaps; tests do not establish user acceptance.

## Integrated implementation and review

Three sequoia habits use fluted trunks, buried root flares, high staggered woody boughs and overlapping scalloped needle sprays. Authored giant trunks frame the shrine; up to520 seeded remote tree roots form unequal stands with gaps. Moss/fern/stone assemblies cluster beside roots. All geometry follows the engine's spherical anchor and camera warp, including growth and seed rebuilds. Source tree templates retain the4,000-triangle bound; completed full scene submits roughly3.51Mtriangles at the shrine and2.91Mfrom orbit on the recorded view. These totals include other scene systems and are not performance guarantees.

The compact shrine has nine material families, a6.95m roof ridge, raised floor0.92m, four real shallow stone treads, stone torii atz12, paired lanterns, timber brackets, rope/shide and an altar recess. Whole geometry is placed at the terrain's full cottageGround3.0m. Compatibility constants remain for the local Muse system; seed rebuilds dispose old shrine resources.

Terrain applies the same dry mapping on CPU, near-ground GPU and fast far-ground GPU. The shrine pad is stable and the path is warm tan beside subdued jade moss. Shader chunk names and window.__meadow remain unchanged. Local copied palette/ground/sky decisions establish this world's own blue-green depth.

First screenshot review caught sparse plate-like boughs, overly yellow/noisy ground, dominating clouds and inherited sample garden content. The revision filled out branch sprays, softened floor variation, reduced clouds, changed Ancient grove to look along the path, and gated sample garden content behind an explicit source/dev query. Default parameter panel is hidden until P. Reference copies and actual screenshots have separate roles in reference/README.md.

Remaining limits: stylized faceted crowns and simplified forest-floor anatomy, less fine print linework than the originals, no shrine interior or general tree collision/pathfinding. A still view does not certify every possible camera/seed/GPU. Native wildlife has not been newly designed for this world; the existing Muse/bird systems are retained.

Final integration detail: the optional garden's state module and its three state-typed sheets are copied locally so their browser key is `muses-garden.sequoia-shrine.garden.v1`; shared garden state is unchanged. The default forest does not instantiate the sample garden. Scoped check/build and final error-free captures were repeated after this isolation change.

## Connected shrines and a separate home — follow-up

User feedback: the existing path ends abruptly in open land; roads should connect different shrines around the planet, and Muse should not live in a shrine. The original path shader faded away between48and58m. This revision replaces that isolated approach with a closed woodland route and shrine spurs, retains the original ceremonial grove, and adds distinct smaller sacred sites. Muse's residence, furniture and daily routine move to a separate timber cabin off a side path. Fresh recovery baseline: workspace handoffs/windows/sequoia-baseline-2026-11-02T09-00-49-582Z. The implementation and actual visual review are complete; current evidence is linked in reference/README.md.

The user then rejected the first connected loop as equator-like. The trail now makes broad asymmetric bends spanning more than0.65radians of latitude, with smaller walking-scale deviations. Seven curved approaches join real destinations and junctions. The through-trail has a variable roughly2.3m earth core and soft margins; only the short ceremonial approach is broader. Darker packed earth, needle/grit variation and irregular moss edges replace the smooth yellow road. Widths are measured in metres through growth. Terrain/path/clearing calculations have matching CPU and GPU versions.

Five shrines use the original sanctuary plus three distinct smaller models: timber with a single lantern, mossy stone with a low open gate, and vermilion with paired eaves. They sit on dedicated stable pads on alternating sides of the route. Every spur reaches the steps; the through-trail stays out of shrine bodies. The path and building footprints exclude roots and understory. An additional68 candidate tree pockets and their ferns follow uneven offsets beside the trail, gated by growth and physical clearance rather than arranged in an avenue.

The cedar cabin sits38m from the original shrine atR40 and44m atR128/R400, with its own ground support, porch steps, bench, stove and warm windows. Muse's daily anchors, cooking props, busy-home seat and optional garden home buttons all use the residential frame. Fishing is removed on this dry planet. Short outings remain within24m of the cabin and check shrine building footprints. General tree collision and planet-wide trail navigation are still outside this implementation.

Actual review caught a foreground branch obscuring the cabin view and an overly clean path surface. The final camera is closer to the cabin, and the trail has subdued soil texture. Nine current captures show the original shrine, four remote shrines, cabin, trail and both sides of the planet; captured runtime/console errors are empty. Geometry scaling is honoured by the spherical architecture shader, so small shrines remain properly supported.

## Global shrine distribution

The user found the five shrines still clustered around an equatorial band despite the meandering path. The layout now places two remote sites in opposite polar regions and two on different far-side regions, while the original shrine and Muse's cabin keep their locations. Fourteen curved trail edges form a connected branching network instead of a latitude circuit. The five shrines have a minimum angular separation of80.86degrees. Trail-side trees follow the new network. Fresh recovery baseline: handoffs/windows/sequoia-baseline-2026-11-02T09-29-36-374Z. Scoped validation passed44CPU tests and3native browser checks plus type/lint/build. Thirteen actual views cover each globe face and shrine; review exposed large grass-only gaps in the forest, prompting the next user request.

## Continuous forest canopy

The user requested denser trees across the whole planet so zoomed-out views do not expose broad grass-only ground. A jittered equal-area layer of mature trees now fills the gaps between authored stands, including the old45m exclusion around the original grove. Existing trail/court/building footprints remain clear. Fresh recovery baseline: handoffs/windows/sequoia-baseline-2026-11-02T09-45-43-926Z.

AtR40/R128/R400 there are789/3,220/20,992 admitted trees. Mature tree scale stays physical: existing detailed templates retain their original43/29/15m heights; the new coverage layer scales gently as the world grows. Nearby trees retain full fluting, roots and needle sprays. Distant trees use240-triangle rooted, scalloped crowns, with identical placement and no duplicated trees across detail levels. Only unwarped orbital views cull beyond a conservative whole-crown horizon; walking views retain the full placed forest. Resized GPU buffers are explicitly released.

An independent4,096-point probe uses actual projected needle triangles and excludes painted trails/courts. Detailed canopy coverage rose from43.3/24.1/2.6% to92.7/96.8/98.6% at the three radii. This is sampled radial geometry coverage, not a screenshot-pixel percentage. Large empty caps disappeared in the reviewed globe views. Seventeen final native-GPU images cover the exact user angle, five shrine-facing globe regions, each shrine, cabin, trail, and minimum/maximum growth. The paths remain legible beneath tall layered crowns.47CPU and3browser checks plus type/lint/build pass; final renderer and resource counts are recorded in VALIDATION.md.
