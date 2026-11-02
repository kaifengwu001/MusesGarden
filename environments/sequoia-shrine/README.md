# Sequoia Shrine

A separate playable forest planet, created from the user's three forest/shrine prints. Towering sequoias surround five shrines connected by narrow, meandering woodland trails. The original vermilion shrine is joined by smaller timber, mossy stone and pavilion sanctuaries. Muse lives in a separate cedar cabin with a porch, warm windows and household things. Brown earth paths wind through jade moss, ferns and broad rooted trunks, with uneven tree pockets beside the trail.

[Open the preview](http://localhost:5245/environments/sequoia-shrine/). Drag to orbit, scroll to enter/leave the forest, use WASD/QE to move. Named views: Shrine approach, Ancient grove, Wayside shrines (cycles through four destinations), Muse’s cabin, Whole planet. P toggles parameters; Grow changes planet size. Seed retains deterministic world identity. Muse cooks, rests and takes short walks around the cabin; its routines avoid the solid shrine buildings. Decorative trunks are not a general collision/climbing system. Shrines are exterior landmarks with closed altar fronts.

References and actual screenshots: [reference index](reference/README.md). Design and workflow record: [construction notes](CONSTRUCTION.md). Exact checks, renderer and limits: [validation](VALIDATION.md).

## Windows commands

In `sequoia-shrine-worktree`, using native Node24+ and npm.cmd/npx.cmd:

```powershell
npm.cmd run dev:sequoia
npm.cmd run check:sequoia
npx.cmd vitest run environments/sequoia-shrine --maxWorkers=2
npm.cmd run build:sequoia
```

Preview uses strict port5245; production output is `dist-environments/sequoia-shrine/`. Scoped browser checks use workspace `handoffs/windows/sequoia-browser.config.ts`, explicit ANGLE D3D11 and one worker. Built-in generated invariants/lock projects remain available, but their old meadow-oriented cases are not all appropriate to a dry forest.

Created on branch `environment/sequoia-shrine`, clean source revision `791263247a656a90c8950f4ef866eac564f2ea1f`, via the48-module environment scaffolder. Shared src/, server/ and the other environment folders remain unchanged. User supplied images guide the visual design; no earlier world's palette or species were reused. The default preview has no sample basket/mail content; explicit `?garden=<source>` or `?dev` enables the existing optional engine/garden integration. The optional garden uses its own browser-local state key, muses-garden.sequoia-shrine.garden.v1.

Latest follow-up: the five shrines now span both polar regions and the far side, with at least80.86degrees between destinations. Fourteen meandering trail segments form a branching connected network; the original shrine and Muse's separate cabin retain their positions. A dense mature canopy covers the whole planet, with3,220 trees at the default size and clear hiking trails/courts beneath it. [Current screenshots](reference/README.md#global-shrines-and-dense-canopy--2-november-2026) and [construction notes](CONSTRUCTION.md) record each refinement. This remains a stylized interpretation of the prints.
