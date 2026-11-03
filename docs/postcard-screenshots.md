# Taking the postcard photos for each planet

Muse sends postcards: photos of its day, and photos with its friends when the two visit each other. Today every
photo shows the meadow, even one taken on a friend's planet. This guide is for taking the photos that each friend's
planet needs. Each one is a screenshot of a page called the **studio**. You need no server, no account and no ticket:
just the app running locally.

The code that picks the photos is already done. Once a planet's screenshots are in its folder, every photo taken on
that planet uses them. A planet with no screenshots yet keeps using the meadow's photos.

## 1. Run the app

```sh
git checkout main && git pull
npm install
npm run dev
```

Vite prints the address, normally `http://localhost:5173`. The links below assume that address. If your port is
different, change it in the links.

## 2. Open a planet's studio

Each page shows the planet with its own friend in their usual outfit, and Momo (the white Muse) beside them.

| Planet (folder name)       | Friend | Studio link                                                         |
|----------------------------|--------|---------------------------------------------------------------------|
| `golden-rye`               | Kiki   | http://localhost:5173/environments/golden-rye/?studio               |
| `cherry-blossom-waterways` | Hoji   | http://localhost:5173/environments/cherry-blossom-waterways/?studio |
| `sequoia-shrine`           | Fife   | http://localhost:5173/environments/sequoia-shrine/?studio           |
| `violet-dunes`             | Moss   | http://localhost:5173/environments/violet-dunes/?studio             |
| `tulip-windmill-meadows`   | Van    | http://localhost:5173/environments/tulip-windmill-meadows/?studio   |
| `scarlet-sail-canyon`      | Potato | http://localhost:5173/environments/scarlet-sail-canyon/?studio      |
| `cobalt-windfields`        | Dorie  | http://localhost:5173/environments/cobalt-windfields/?studio        |
| `lantern-reed-gardens`     | Pooh   | http://localhost:5173/environments/lantern-reed-gardens/?studio     |
| `meadow` (optional)        | Momo   | http://localhost:5173/?studio, or http://localhost:5173/?studio&with=muse6 to add a friend |

Let the page load fully before you start. The first load of each world takes a few seconds.

## 3. Use the Studio panel

The panel sits at the top right.

| Key or control | What it does |
|---|---|
| **C** | Hides and shows the panel. Hide it before every screenshot. |
| **T**, or "Hold time" | Freezes everything, so a pose stays still while you frame. |
| Drag, scroll | Moves and zooms the camera freely, as on any world page. |
| **Shot** | Together (both Muses), Selfie (big heads, close, as if one of them holds the camera), Host alone, Scenery (no Muses), Home (the friend's house). "Frame the shot again" puts the camera back. |
| **Selfie reach (m)** | How far the selfie camera is from their heads. 0.8–1.2 looks most like a selfie. |
| **Moment (s)**, "Play it again" | Scrub into whatever they're doing, or replay it. |

Each Muse has its own folder in the panel:

- **Doing:** what it's busy with. Only what that friend actually does in its day is offered, so the list differs by
  planet: bench work, sitting, napping, watering, cooking, fishing, walking, yawning and so on. "Which time in its
  day" picks another instance of the same activity.
- **Answering you:** waving, bouncing for joy, or being petted.
- **Face:** its own, smiling, beaming, happy squint, content squint, eyes squeezed shut, sleepy or blushing.
- **Looking / Turned:** its own way, or at the camera.

On **Violet Dunes** the friend can only stand and wave, with three faces (smiling, beaming, sleepy), and can't be
petted. Use scenery and the dunes there to get variety.

## 4. What to shoot on each planet

Aim for variety: no two photos should look alike. Change the activity, the face, the angle and the distance between
shots. Take **8 photos per planet**:

| File name | Shot | Ideas |
|---|---|---|
| `friend-1.jpg` | Together | Both doing something: one cooking or at the bench while the other watches, smiling |
| `friend-2.jpg` | Together | One waving at the camera, the other beaming or blushing |
| `friend-3.jpg` | Together | A quiet one: sitting or napping side by side, from farther away with the planet around them |
| `selfie-1.jpg` | Selfie | Big heads, both looking at the camera, beaming |
| `selfie-2.jpg` | Selfie | Big heads with different faces (happy squint and eyes squeezed shut) or a different angle |
| `scenery-1.jpg` | Scenery | The planet's best wide view: its landscape, its sky |
| `scenery-2.jpg` | Scenery | A closer, different spot: a plant, the water, the light |
| `home-1.jpg` | Home | The friend's house, ideally with the friend at it |

More are welcome; number them on, e.g. `friend-4.jpg`. Other kinds work too, as long as the file name starts with
one of these: `sky`, `closeup`, `creature`, `find`, `work`, `new-friend`, `invitation` (the picture on a travel
ticket to that planet). A planet that lacks a kind borrows the nearest one it has: a selfie falls back to a friend
photo, and a home photo to scenery.

## 5. Save the screenshots

- **Shape:** landscape, 3:2, like the meadow's photos (`src/assets/postcards/*.jpg`, 960 × 640). On a Mac, press
  ⌘⇧4 and drag a 3:2 area, or crop to 3:2 afterwards.
- **Size and format:** JPEG at about 1440 × 960 (960 × 640 at least). `.png` also works but is much larger.
- **Clean frame:** hide the panel (C) first. Nothing from the browser or the desktop should be in the picture.

Put each file in its planet's folder, named as in step 4:

```
src/assets/postcards/<planet folder name>/<kind>-<number>.jpg
```

For example, `src/assets/postcards/violet-dunes/friend-1.jpg` and `src/assets/postcards/golden-rye/selfie-2.jpg`. The
folder names are the first column of the table in step 2. A file named any other way is ignored.

## 6. Check them

- Run the tests for this part: `npx vitest run src/assets/postcards server/fixtures/planetStills.test.ts`.
- To see them in the app: run `npm run serve` in a second terminal and open
  `http://localhost:5173/?garden=/api/muses/hero&dev`. Each photo is also served at
  `http://localhost:5173/api/postcards/<planet>/<file>`, e.g. `/api/postcards/violet-dunes/friend-1.jpg`, so you can
  open one directly to check it. New files show up within a few seconds without a restart.

## 7. Hand them in

Commit the new folders and open a pull request, or push to `main` if that's agreed. One commit per planet is fine,
e.g. "Postcard photos for Violet Dunes".
