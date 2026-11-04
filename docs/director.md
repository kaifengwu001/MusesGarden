# The director's mode

For filming. On any planet that takes visits, put up to four Muses on the planet: the planet's own and three more, in any of the fourteen looks. Give each a sequence of beats, then play, scrub and loop the take while you move the camera yourself.

## Opening it

Add `?director` to a planet's page:

| Planet | Address (dev server) |
|---|---|
| The Meadow | `http://localhost:5173/?director` |
| Any other world | `http://localhost:5173/environments/<name>/?director` |

That covers `lantern-reed-gardens`, `scarlet-sail-canyon`, `cobalt-windfields`, `tulip-windmill-meadows`, `golden-rye`, `cherry-blossom-waterways`, `sequoia-shrine` and `violet-dunes`.

The planet is set as a visit has it, with its friend's seed from `server/fixtures/cast.json`, as the photo studio's is. Its own Muse joins the scene where it stands, facing the camera. The world's other residents keep out of sight, and the page's own interface is put away. Without `?director`, nothing of it loads or draws: the meadow's frames are pixel-identical to main's.

## The panel

**Muses.** Each Muse has a colour, a name and a look (Momo is `tpose6`; the muses in clothes are `muse0`–`muse12`, each named for the friend who wears it).
- ◉ shows or hides it. ⌖ places where it starts: click the planet.
- × takes a guest off the planet. The planet's own Muse (⌂) always stays.
- **+ Add a Muse…** asks for a click where it starts. A shot holds four.
- A swatch blinks while that Muse's body is still being made. A guest takes a few seconds on the environments.

**Beats** of the picked Muse, in order. Each card shows its action, its length and when it plays in the take. Click one to open it:

| Row | What it sets |
|---|---|
| Does | The action, from the library below. |
| Where | Its mark (**Move its mark**, then click the planet), or **Where it is**: wherever the last beat left it. A bench or stove action picks its piece instead. |
| Facing | Its mark's arrow, the camera (as the take starts playing), or another Muse. |
| For | Seconds held, or times done (waves, pours, catches, tastes). |
| Starts | Right after the last beat; not before a time; or when another Muse's beat sets off, begins (arrives at its mark), or ends. |
| Face | A face held over it: smiling, beaming, ∩, ∪, > <, sleepy, blushing. |
| Looking | Its own way, at the camera, straight ahead, or at another Muse. |

↑ ↓ reorder a beat; Duplicate and Delete do what they say.

Adding a beat that goes somewhere asks for a click on the planet. Esc keeps the mark it suggested, a little ahead of the last one.

**Set pieces.** **+ Bench** and **+ Stove** are placed by a click.
- The bench is the meadow hut's own, in its tan wood.
- The stove is the little iron one that stood on the porch, with its pot of soup and its fire.
- A new piece faces the camera. Beats that want one and have none take it.

**Scene.** The scene is kept in this browser per planet as you go, and reloads where you left it.
- **Export** downloads it as JSON; **Import** reads one back (for the same planet).
- **New scene** clears the beats; Undo brings them back.

**Timeline** (along the bottom). Each Muse's take runs in blocks:
- hatched for walking and turning;
- light for sitting down, getting up and getting its things out;
- solid for the action itself;
- dashed for waiting on a cue.

Drag anywhere on it to scrub; click a block to open its beat. ⏮ goes to the start, ▶ plays and pauses, and **loop** plays the take over and over.

## On the planet

Each Muse's start (a hollow disc) and its beats' marks (numbered discs) stand on the ground, each with an arrow for the way it faces. The routes it will walk are dotted between them, and drawn red where the way is blocked: a mark in the water or a wall, or no way round. A tag over each Muse picks it.

The picked mark carries a gumball:
- **The middle** slides it over the ground.
- **The blue arrow** pushes it along the way it faces; **the red arrow** pushes it across.
- **The ring and its knob** turn it.

A press held on a picked mark slides it at once. The gumball steps aside while the take plays.

The camera is yours as ever: drag, scroll, W A S D, Q E, M to frame the planet's own Muse.

## Keys

| Key | Does |
|---|---|
| Space | Play or pause |
| Home | Back to the start |
| H | Hide everything (panel, timeline, marks, gumball) for the shot; H again brings it back |
| , and . | A frame back or on, paused |
| Esc | Stop placing, or close the open beat |
| ⌘Z / ⇧⌘Z | Undo and redo |
| Delete | Delete the open beat |

Pausing holds the whole world with the take: clouds, wind, water. Played or scrubbed, the take is the same every time.

## The library

Each action is Muse's own, played as its life plays it on the planet (`museRoam.ts`). Each has the variety its life gives it, drawn from the beat's seed: a pour's length, a catch's luck, a content look now and then.

| Action | Length | Notes |
|---|---|---|
| Stand | seconds | Looking about. |
| Wave | times | |
| Bounce for joy | times | |
| Being petted | seconds | > < eyes and hearts; its fur stands up on a long hold and is shaken out as it's let go. |
| Fur stands up | times | |
| Yawn | times | |
| Sit in the grass | seconds | Plops down; gets up before it walks on. |
| Nap | seconds | Plops down and lies back asleep, its snore bubble and Zzz; wakes and gets up before it walks on. The grass is pressed under it. |
| Water the flowers | times | The can out of its pocket; poured now long, now short, now swept. The can stays out from one watering to the next, carried as it walks. |
| Fish | times | Sits on the bank, the rod out of its pocket; not every catch bites. Face its mark to the water. |
| Cook at the stove | times | Behind a stove you place, stirring the pot and tasting now and then, the ladle out of its pocket. |
| Sit on the bench | seconds | Hops up onto a bench you place, legs swinging, humming; hops down before it walks on. |

Between beats it walks by itself, at its own pace. It turns into its way first when it faces well away from it, and comes round to its mark's arrow as it arrives.

## Each planet

Violet Dunes' Muse has a rig of its own: it walks, turns, waves and looks, and shows the plainer faces (smiling, beaming, sleepy). The other actions and the set pieces aren't offered there. Every other planet has all of them.

## What it doesn't do (yet)

- **Routes.** They keep off water and drops too high to step down on every planet. Only the meadow also knows its house's walls, its furniture and its porch, so on the other worlds a route can pass through a house: give the Muse a waypoint mark (a Stand of half a second) to go round.
- **Pace.** Muses walk at their own pace, and don't step aside for each other.
- **Grass.** It is pressed under one Muse lying in it at a time: the planet's own, or else the first guest that lies down.
- **Shadows.** On the meadow, the guests' shadows share the planet's own Muse's shadow map, which widens to take them in. Muses spread far apart get softer shadows.
- **Cost.** Each Muse costs its fur on the GPU. Three more Muses close up cost about 5 ms a frame at 2× on this Mac. The director's own work is about 1 ms a frame with its marks shown and nothing with them hidden.

## How it works

| File | What it holds |
|---|---|
| `src/director/director.ts` | Opens it in the garden's place (`src/visit/visitUi.ts` prepareStudio), binds each Muse to a body, plays the take each frame, and wires the panel, the gumballs, the keys, undo and saving. |
| `src/director/scene.ts` | The scene as data: actors, beats, marks, cues, pieces. Read back strictly. |
| `src/director/library.ts` | The actions, the faces and the looks. |
| `src/director/timeline.ts` | The take: each Muse's beats written out as segments (waiting, getting up, walking, turning, sitting down, the action) and played as a pure function of the take's time. |
| `src/director/route.ts` | The routes: A* on a grid laid over the planet, pulled tight and rounded as Muse's own walks are. |
| `src/director/overlay.ts` | The marks and the gumball: an SVG over the canvas, each point carried through the planet's warp. |
| `src/director/panel.ts`, `director.css` | The panel and the timeline. |
| `src/director/pieces.ts`, `piece.*.glsl` | The bench and the stove, lit as Muse's things are, in each world's own light. |
| `src/director/director.test.ts` | Its routes and takes, checked without a world. |

A world's Muse takes a scripted life whole, frame by frame, through `act(life)` (`VisitBody.act` in `src/visit/world.ts`). That life is shaped like its own (`Roaming`), its height over the ground its own life would stand on there, so its rig, its things and its shadow play it as they play its day. `acts` says what it can show. The world's adapter offers a `stage` (`VisitStage`) for the set pieces, and the meadow's also offers `walkable`. A new world that takes visits gets the director by adding the same two pieces: see `environments/README.md`.

In dev servers and probe builds, `window.__director` drives it from scripts:
- the scene: `scene`, `setScene`;
- the take: `take`, `time`, `play`, `pause`, `seek`;
- picking and placing: `select`, `markAt(ndcX, ndcY)`, `markFrom`, `pick`;
- loading and cost: `loaded`, `costs`.

`tools/workflows/drive-app/scripts/director.mjs` builds a scene from JSON (or a demo), plays it headless on any planet, and takes stills.
