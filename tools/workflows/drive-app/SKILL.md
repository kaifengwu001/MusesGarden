---
name: drive-app
description: How to run Muse's Garden (The Meadow and any later planet) and drive it headless on this Mac — Node 24, which dev-server port belongs to whom, the window.__meadow harness, URL hash keys, presets and the standard views, frozen time, headless Chromium on Metal, screenshots, contact sheets, and builds of any commit served from disk. Use it whenever you need to see the app or check a change in the real browser — run it, screenshot a view, compare builds, test an interaction — even for a quick look, and before writing any new Playwright probe script (extend the bundled ones instead).
---

# Driving Muse's Garden

The app is a Vite + TypeScript + three.js tiny planet. Everything about a view lives in the URL hash, and a test harness (`window.__meadow`) ships in every build, so any view can be reproduced exactly. The scripts in `scripts/` wrap all of that. The other skills (measure-perf, check-frames, look-dev, publish-page) import `scripts/lib.mjs`.

## Running it

- **Node 24.** The default `node` here is v18, and vite 8 and vitest 5 need a newer one. Prefix commands with `PATH=/Users/kaifengwu/.nvm/versions/node/v24.15.0/bin:$PATH`, or check `ls ~/.nvm/versions/node` if that version has moved. `build-at.sh` finds it by itself.
- **Ports.** Look before you start anything (`lsof -iTCP -sTCP:LISTEN -n -P | grep 51`):
  - 5198: the main checkout's dev server (`npx vite --port 5198 --strictPort`, run in the background).
  - 5196 and 5197: the garden-interfaces and terraces worktrees, per the local preview configuration.
  - 5199: Playwright's webServer. It **reuses whatever already listens there**, so `npm run test:gpu` or `npm run shots` in a worktree silently tests another checkout's code. Check who serves 5199 first, or give the worktree's `playwright.config.ts` another PORT (and don't commit that).
  - 5180: belongs to another project.
- **Other sessions share this folder and this GPU.** Several sessions (Muse, the interfaces, the terraces) work here at once:
  - Their half-made edits can break the shared dev server, so build in your own git worktree when you change code (symlink `node_modules` into it).
  - Commit by path, never `git add -A`.
  - Expect noisy timings while they render.
- **The Browser pane** is often hidden, and a hidden pane gets no animation frames. Use the headless scripts below to see and measure. The pane is only for showing Kai something live.

## The harness: `window.__meadow`

Typed in `src/dev/harnessApi.ts`. The calls you'll use:

| Call | What it does |
|---|---|
| `isReady` / `ready` | shaders warm, first frame presented |
| `setHash(h)` / `getHash()` | apply a full state (it resets what `h` omits) / the canonical hash |
| `freeze(t)` / `freeze(null)` | stop world time at t seconds / let it run |
| `settle()` | finish build queues and fades, render a frame (call it twice after a jump) |
| `renderFrame()` | one synchronous update and render |
| `preset(name)` | `homestead`, `lakes`, `meadow`, `vista` (the reference framing), `muse` |
| `benchmark(n)` | n frames back to back, GPU-synced; returns ms a frame |
| `setScale(s)` | render scale 0.5–1, as Auto would set it |
| `stats()` | frame, JS and build ms, draw calls, triangles, grass in view, tier, renderScale, gpuBytes… |
| `parity()` / `pick(x, y)` | CPU↔GPU terrain and warp agreement / CPU picking |

In dev servers and probe builds (`VITE_PROBE=1`, which `build-at.sh` makes), `window.__world` exposes the World itself: `rig` (the camera), `terrain`, `clouds`, `grass`, `flowers`, `surface`, `renderer`, `scene` and so on. Production pages have only `__meadow`.

**Hash keys.** The camera and time keys:

- `t`: frozen time.
- `pose`: frame quaternion x,y,z,w plus zoom 0–1.
- `cam`: `overview` or `wander`.
- `q`: tier, `auto`, `low`, `medium` or `high`.
- `hud`: the perf HUD. `pc`: the postcard frame.

The world keys:

- `seed`.
- `g`: growth. R runs 40–400 m; the default is R 128.
- `b`: bloom.
- `cc`: cloud coverage. `wsh`: wind sheen.
- The rest come from `src/params.ts` (`fieldForUrlKey`); grep there for a parameter's short key.

**Standard views** are in `views/meadow.json`: orbit, bird's-eye 70 m, standing 4.3 m, eye level 1.6 m at the meadow and by the lake, vista, cottage.
- The zoom stops are heights in meters (Kai's rule), keyed to R 128: bird's-eye zoom 0.35, standing 0.83.
- Each view pins tilt and field of view, so builds whose camera rigs differ still frame the same picture. The pinning needs `__world`; it is skipped, with a warning, on production pages.
- Another planet gets its own file, passed as `VIEWSFILE=`. To write one, frame each view by hand or by preset, then record `__world.rig.poseString()`.

## Reproducible frames

A frame matches across loads only if you follow this order:

1. `settle()` twice.
2. `freeze(t)`.
3. `setScale(1)`, **after** freezing. Auto changes the render scale while frames are slow, and it is locked only while time is frozen.
4. `renderFrame()` twice. The first frame after a scale change carries a little of the last.
5. `readPixels`, in the same task.

`lib.mjs` `frozenFrame()` does all of this. Load pages one at a time: a page that settles while another loads can drop its scale and fake a difference.

## Scripts

All take a **target**: a URL (`http://localhost:5198`, a published page) or the name of a build made by `build-at.sh`, which is served from disk at `http://<name>.test/`.

```bash
# screenshots: the standard views, a preset, or any list of shots (UI hidden; UI=1 keeps it)
node tools/workflows/drive-app/scripts/look.mjs http://localhost:5198 views shots/look
VIEWS="vista,cottage" DPR=2 node tools/workflows/drive-app/scripts/look.mjs http://localhost:5198 views /tmp/x
node tools/workflows/drive-app/scripts/look.mjs http://localhost:5198 '[{"name":"lakes","preset":"lakes"},{"name":"R400","hash":"g=1&cam=wander"}]' /tmp/x

# a contact sheet to look at (or send) many shots at once
node tools/workflows/drive-app/scripts/sheet.mjs out.jpg --cols 3 --width 480 a.png b.png label=c.png

# a probe build of any commit (or of the working tree) to serve from disk
tools/workflows/drive-app/scripts/build-at.sh i13 d5107a0
tools/workflows/drive-app/scripts/build-at.sh mine
```

- **Where builds go.** Set `BUILDS` to a folder in your scratchpad; the default is `$TMPDIR/muses-garden-builds`.
- **Pixel ratio.** `DPR=1` turns MSAA on, as on Kai's 1× external screens. The M1 Pro's own screen is 2×. Check the look at both.
- **Look at what you capture.** Read the PNGs or the sheet yourself before saying anything about the picture.

## The checks (package.json)

| Command | Covers |
|---|---|
| `npm run check` | tsc for the app and node, plus ESLint |
| `npm test` | Vitest CPU invariants: no swimming, constant density and scale, warp, chunks, quality, Muse |
| `npm run test:gpu` | Playwright browser invariants: determinism, parity, picking, scrub budget, no dropped frames, MSAA range, first frame, draw calls, hash |
| `npm run shots` | 15 fixed shots into `shots/` (desktop and mobile) |
| `npm run squint` | the vista against `reference/howls-lake.webp` (mean ΔE; skipped without the still) |

The GPU scrub-budget test fails at exactly 30 fps (p95 about 33.3 ms) while other sessions load the GPU. Before calling that a regression, run it at the previous commit.

For Muse in the meadow or the lab (stills of its day, taps, videos, walks), use the `muse-look` skill.
