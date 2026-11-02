# Paper Orchard validation

Latest review: 2 November 2026, native Windows. Delivery branch:
`environment_violet_dune`, based on `main` at `ad37acf`; this local pass starts
from `e5ac0a4`. Active Windows preview port: **5232**. The older external
checkout on 5231 is not this review target.

## Mainline readiness fixes · 2 November 2026

The final source was also checked in an isolated export of GitHub `main` at
`4259aea`, with the current Violet folder applied. This preserves the working
branch while exercising the 31 newer mainline commits and their shared APIs.

- Scatter pools retain all 16,384 pages per species but use compact textures;
  the actual largest dimension is now 512 rather than 16,384. Layout helpers
  enforce a 2,048-pixel dimension limit. Dirty uploads split at physical rows,
  and both page lists upload every row on their first draw.
- Distant-detail selection uses a conservative tangent/height bound for warped
  terrain, separate from the deliberately generous visibility bound. Full
  detail covers the home patch and nearby plants; distant plants retain their
  stable positions and coarse geometry. No habitat population was removed.
- Disabled bloom no longer allocates or warms its targets. Re-enabling it
  recreates correctly sized targets, and disabling it releases the chain.
  Terrain MSAA, cloud FP16 precision and the 2.25× ribbon width are preserved.
- Distant materials share live uniforms directly, avoiding unsupported
  render-target texture cloning.

| Final check | Result |
| --- | --- |
| Branch TypeScript / ESLint | `npm.cmd run check` passes; final scoped lint also passes |
| CPU contracts against current main | 69 tests in 12 files pass |
| Mainline client and browser-test types / standalone production build | Pass |
| Targeted mainline browser regressions | Nine distinct checks pass: determinism, ground/picking agreement, walking/resize, colour and draw budgets, plus globe coverage and resource limits |
| Expanded globe check | Seven views, 16 identical frozen redraws each, exact R128 → R400 → R128 return, no pool saturation, no captured runtime/shader errors |
| Final material construction | Expanded globe test rerun passes after removing redundant uniform cloning |
| Shared-code compatibility | Seven captured views match the working branch pixel-for-pixel on the same renderer |

High-quality resource checks at 1600×1000, DPR1, render scale 1 and four MSAA
samples now meet the existing HUD budgets. Orchard effective triangles fell
from 7.44 million to **3.65 million**, below 4 million. Submitted triangles
are 4.43 million, including unused birth slots and passes excluded from the
existing effective-count metric. The largest captured allocation is
**253.35 MiB at R400**, below 256 MiB; R128 uses 217.35 MiB. These are tracked
allocation estimates and geometry counts, not a cross-device FPS guarantee.
Renderer: Chromium / ANGLE D3D11, NVIDIA GeForce RTX 4070 SUPER. The complete
startup/performance suite and Metal backend were not rerun for this pass.

Current [capture evidence](reference/mainline-globe-evidence.json),
[whole globe](reference/mainline-globe.png),
[Orchard](reference/mainline-orchard.png), and
[large-world Orchard](reference/mainline-large-orchard.png) preserve the final
review. The earlier Windows and Mac records below remain historical. User
visual acceptance is separate from these checks.

## Windows globe refinement · 2 November 2026

Cloud-width follow-up: ribbons are now 2.25 times their original width at the
user's request. Both existing cloud geometry tests pass, and the live in-app
globe was visually reviewed. The [updated app screenshot](reference/windows-wider-clouds-225.jpg)
shows this width; the frozen captures in this earlier section precede the
width adjustment. The mainline-readiness evidence above includes it.

The user requested vegetation and rocks throughout the globe, thin swirling
cloud strips, and more varied assets with broad planted and barren regions.
Orbital views now stream seeded rocks and plants on both hemispheres. Coarse
meshes share the detailed meshes' anchors and birth thresholds; horizon
culling and a capped distant population bound the large-world cost. Broad
habitat fields vary grove density and species mixture. Per-instance scale,
proportions and material colour vary within the existing botanical palette.

Twenty-eight translucent cirrus ribbons drift around the sphere above the
highest terrain. They use 4,032 triangles. A separate depth-aware cloud pass
composites over the four-sample opaque scene before colour grading. This
avoids a one-channel, one-pixel frozen-frame instability found when blending
the thin ribbons directly into the multisampled FP16 target on D3D11.
Forty repeated diagnostic renders then matched exactly; the normal exact
hash assertions remain unchanged.

Shrinking after growth now compacts obsolete scatter pages. The harness
settles bounded reconciliation passes so retile and page compaction finish
before a frozen capture. The expanded pool reserves both transition layouts;
the final globe captures show no pool saturation.

| Windows check | Result |
| --- | --- |
| TypeScript and ESLint | `npm.cmd run check` passes |
| Scoped CPU contracts | 60 tests in ten files pass, including cloud geometry, coarse meshes, habitat variation, horizon culling and grow/shrink scatter reuse |
| Targeted browser regressions | Eight pass: three exact determinism checks, CPU/GPU ground and picking checks, MSAA colour bounds, draw budget, and the new globe test |
| Walking and resize | One additional browser regression passes, including quality change and viewport resizes with no blank frame or scatter tile drop |
| Globe review | Six raw views: home-facing R128, opposite hemisphere, middle distance, R400, returned R128 and Orchard; three identical frozen hashes per view; exact R128 growth return; zero captured runtime/shader errors |
| Production | Standalone Vite build passes |

Browser evidence uses Chromium / ANGLE D3D11 on NVIDIA GeForce RTX 4070 SUPER,
1600×1000, DPR1, high quality, render scale 1, time 12, and four opaque-scene
MSAA samples. This is a correctness and visual review, not a fresh performance
benchmark. The historical Mac Metal timings below do not describe Windows.
The default Windows test backend remains SwiftShader; select D3D11 explicitly.

The R128 home-facing and opposite views stream 15,106 and 14,108 landmark
instances respectively; R400 streams 27,297. Submitted triangles are about
1.26 million at R128 and 2.04 million at R400. Returning to R128 restores both
the exact image and the original triangle count. The nearby Orchard submits
about 8.73 million triangles with detailed assets. Captured frame intervals
include synchronous settling/readback and must not be treated as FPS data.

Open the updated [review page](reference/review.html),
[whole planet](reference/windows-globe.png),
[far hemisphere](reference/windows-remote.png), and
[raw capture evidence](reference/windows-globe-evidence.json).
These are actual renderer exports, not retouched images. They were inspected
against the existing concept; user visual sign-off is still pending.

## Visual contract

Use the [pink Physalis concept](reference/primary-concept.png) as the current
target. The older [watercolour Violet Dunes](reference/original-violet-dunes.png)
remains a material and palette reference. The accepted botanical direction
supersedes the original diamond seed packets and the intermediate flat fans.

| Relationship | Implementation to inspect |
| --- | --- |
| Violet granular sand, wind-worked crests and open interdune ground | Four asymmetric curved crest profiles over meter-scaled procedural dunes; separate slip-face pigment, broken wind-ripple trains and filtered mineral grain |
| Golden crowns with natural papery fruit | Thin tapering leaves, curved branching stems, rounded five-rib calyces and some openings showing a gold berry; no artificial lamp fittings or glow |
| Dense planted slate islands framing a quieter route | Connected left planting bank, shelter tributary and smaller right rim; three height layers of ivory fronds, periwinkle low foliage and golden Physalis |
| A small inhabited home among plants | Slate courses, visible timber, sagging canvas, work shelf and trays; protected floor and Muse apron |
| Rose sky without a warm filter over every material | Local pink sky palette and distant lilac cirrus; neutral daylight on slate, cloth and sand |
| Recognisable native life | Three four-footed dune skippers, four two-winged seed gliders, physical landing stems and matching animated shadows |

No coiled, piped or piled terrain is used. Sand relief is continuous ground;
slate has physical fractured edges; thin plants retain independent scale.

## Review workflow and evidence

1. Start the isolated checkout on its assigned port (currently 5232 on Windows).
   Finish source edits before tests.
2. Open the primary image itself, then open the app without an old `pose`.
3. Run the local ecology project. It freezes time at 12, renders at scale 1,
   captures Orchard, Dunes, Muse and both animal views, and checks whole-planet
   growth at R40, R128, R400 and R128 again.
4. Compare dominant shapes, empty ground, plant scale, support contacts and
   materials before judging small texture marks. Inspect the globe separately.
5. Keep test success and visual acceptance separate. Record remaining gaps.

The review page places the concept beside actual app checkpoints. The
`checkpoint-first-pass.png` image is an intermediate integrated pass preserved
before the later composition/material fixes; it is **not** a pristine capture
of the original implementation. `material-before.png` preserves the preceding
PR checkpoint at the same Orchard camera, before this material/planting pass.
The sand, paper and shelter-joint close views are raw renderer exports.
Raw captures and machine-readable evidence
are generated under `shots/violet-dunes/refinement/` and are ignored by Git.

## Current material and surface pass

- Sand now has independently shaded light shoulders and sheltered ripple
  edges, broken wind-aligned trains, fine grain and sparse individual mineral
  flecks. Detail fades with its pixel footprint. The broad slip-face pigment
  is applied before the granular paint rather than covering it afterward.
- Authored crests use a maximum envelope instead of adding together into one
  swollen mound. The CPU supplies the same four ridge parameters to GLSL;
  terrain, planting and picking use the same surface.
- Physalis uses narrower ovoid husks, five longitudinal ribs, branching veins,
  fine fibres and warm tan paper shading. Leaves have midribs, side veins,
  restrained pigment variation, dry tips and backlit edges.
- The local authored patch now contains 455 plants (70 Physalis, 117 ivory
  frond plants and 268 low plants), compared with 289. Planting forms irregular
  connected banks with young, medium and tall crowns while retaining the
  entrance, approach and animal pockets. Its 222,060 authored triangles are
  below the previous 272,336 and the unchanged 300,000 limit.
- Actual triangle-interior clipping identified 77 visible coplanar overlaps
  in the old timber joints. Rafters now meet with mitred ends; lintel,
  threshold and tray rims butt together. The ridge beam sits below the actual
  sagging roof. No polygon offset masks these joints. Thin plant templates
  omit collapsed pole/tip triangles and duplicate double-sided faces.
- A strict close-camera test exposed intermittent Muse silhouette pixels.
  The local fur shader now evaluates derivatives before branches/discards,
  derives footprints from ordinary interpolation while retaining centroid
  shading coordinates, and uses defined ascending-edge smoothsteps. The final
  suite passes three identical redraws at every close/orbit view and an exact
  return to its starting camera. Three additional fresh focused runs passed.

The static surface checks cover the actual shelter triangles at seeds 1, 412
and 771, including beam-to-canvas clearance and one supported walking floor.
They do not infer geometric overlap merely from matching vertex indices.

## Correctness findings

- Plant slope classification now uses its own quantized `Terrain` snapshot,
  including the authored ridges. Asynchronous jobs never read a mutable live
  terrain. Bounds include actual terrain height, scaled plants, wind and the
  quadratic warp term.
- Home framing solves against the displayed ground curvature. The inherited
  physical-sphere calculation lowered the camera in a flattened vista.
- Thin foliage uses centroid interpolation for bounded leaf coordinates.
  Its central highlight has compact support. The previous odd-power formula
  could extrapolate to negative colour under MSAA; the unchanged colour test
  now measures a scene range of 0.000–1.020 at four samples.
- Fauna contact checks sample actual foot vertices at R40, R128 and R400.
  Shadow meshes copy the animated transforms. Perched gliders have support.
- The first glider's perch sits beside the open route, so its observation
  camera is not blocked by a nearby fruit crown. Portrait framing centres the
  home instead of carrying the desktop composition's large horizontal offset.
- Settled height bakes double resolution above R256, while continuous-growth
  bakes and flora keep their original resolution. This fixes the large-world
  interpolation error without increasing every growth frame's bake cost.
  The extra 36 MiB is tracked and released on shrinking. Final near-field
  heights explicitly round to nearest half before storage.
- Shared `src/`, other worlds and the source `setting_gen` checkout are outside
  this change. The source checkout remains untouched; delivery uses its own
  branch based on current `main`.

## Historical Mac validation · 1 November 2026

| Check | Result |
| --- | --- |
| TypeScript and ESLint | `npm run check` passes |
| Environment CPU contracts | 52 tests in seven files pass, including triangle overlap, plant topology/composition, actual fauna feet, asset bounds, authored slopes and bake allocation/disposal |
| Browser invariants | All 12 pass, including three exact frozen-frame checks, CPU/GPU parity, picking, growth performance, walking/resize continuity, MSAA colours, startup/draw budgets and URL state |
| Expanded ecology | Passes at R40 → R128 → R400 → R128; 64 ground/warp samples at each size, all nine view captures, no shader or runtime errors, exact returned globe hash |
| Material and joint motion | Three close views plus a 17-step orbit/dolly, three exact redraws at each pose, exact starting-camera return, no runtime or shader errors |
| Height agreement | Maximum error 4.80 mm at R40, 4.15 mm at R128 and 12.48 mm at R400, under the unchanged 20 mm limit |
| Growth performance | Final 1600×1000 Metal run: frame p95 16.70 ms, JS p95 4.50 ms, max build slice 8.10 ms, all inside unchanged thresholds |
| Frame continuity | 355 observed frames, two resizes, zero blank frames and zero tile drops |
| MSAA material range | Four samples, scene RGB 0.018–1.025, inside the unchanged 0–3 range |
| View matrix | 19 desktop, medium and mobile captures written; baseline recorded, no older-frame equality claim |
| Production build | Standalone Vite build passes |
| Isolation and formatting | `git diff --check` passes; no changed paths outside this environment |

One inherited browser test remains marked `fixme`: automatic detection of LOD
rings during a dolly. It is not counted as a pass. Performance numbers describe
this local run. The final combined ecology/invariants/frame-lock run has
16 passes, one inherited skip and no failures. Earlier integration and material
runs measured frame p95 33.40 ms; the final run measured 16.70 ms with the same
thresholds. This host variation remains recorded rather than implying a frame
rate guarantee on other hardware or with concurrent rendering clients.

The durable [check summary](reference/validation-evidence.json) preserves the
growth errors, repeated-frame hashes and test annotations. The review exports
use the renderer's own PNG pixels; the
[app-context checkpoint](reference/checkpoint-app.png) also preserves the
surrounding controls. Images have not been retouched.

## Active visual limits

The scene is an interactive stylised 3D interpretation. It still has broader,
simpler shapes and less delicate drawn detail than the concept. The shelter
retains the inherited navigation footprint, so its rectangular structure is
more regular than the illustrated home. The local orchard has more detailed
geometry than the remote planet surface; distant plants and rocks now use
coarse meshes and fade below pixel scale. Native animals follow deterministic
ambient loops rather
than a complete ecosystem. Observation cameras frame once, so an animal may turn afterwards.

High cirrus includes the distant sky wash and thin orbiting ribbons, with no
ground shadow from the ribbons. Optional low
clouds use flattened puffs; their inherited ground-shadow projection remains
spherical and is deliberately restrained. Do not describe those shadows as an
exact ellipsoid projection.

The user approved the Physalis and pink-sky direction. The current actual app
has not yet received user visual sign-off.

## Integration into main

The delivery branch `environment_violet_dune` starts from `main` at `ad37acf`
and adds only this environment. Refinement commit `b697519` remains preserved
separately; unrelated unpublished history from `setting_gen` is not part of
the delivery branch.

The current shared Muse shaders changed their uniform and sculpt-attribute
interfaces. Violet keeps its previously validated colour/shadow shaders, rig,
sculpt mesher, worker and loader locally, while reusing the unchanged shared
model assets. This preserves its scalar arm pose and shadow strength without
changing the meadow's new interface. Shared camera helpers and the memory
ledger remain compatible.

The first planet has no source changes. At DPR1 on Metal, eight stable meadow
reference views are pixel-identical between untouched `main` and this branch.
The 70 m bird's-eye view is excluded from that comparison: its self-check on
untouched `main` also changes 300 pixels (maximum channel difference 126).
This inherited self-check variation is not counted as a successful equality
check and was not changed here.

The original integration passed root checks, 42 CPU tests and its production
build. Its Orchard, survey and Muse frames matched refinement commit `b697519`
exactly. That is historical evidence for the integration, not a claim that the
new material/planting pass matches those older frames. The original browser
run had 13 passes, one frame-time failure at 33.40 ms and one inherited skip.
The current results above supersede that check; its raw summary is retained
in the durable evidence file. Shared source is still unchanged.
