// Film the making of Muse (museLab.html#making=1, src/dev/museMaking.ts) frame by frame into an mp4: Momo's bare mesh
// as generated, coming into being behind a glowing blue front in its T-pose; then the clay, its weights and its bones,
// each behind a front, and it walks; then its colour and fur behind the last one, its bones gone; the camera once round.
// It ends on the parade's first frame (parade.mjs at its defaults), so the two join on a match cut. Every frame is drawn
// at its own moment (the scene is closed-form in time), averaging `samples` renders over the shutter for motion blur,
// soft shadows and smooth edges.
//   node making.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]
//   node making.mjs out.mp4 1920 1080 30 16                    the shot as it is (9.8 s)
//   node making.mjs out.mp4 960 540 30 1                       a quick look
//   '&beats=gen,clay,weights,bones,walk,colour,end' other timings (s); '&ease=<p>' the camera's curve (default 3);
//   '&cam=<round°>,<up°>,<m>' holds the camera.
//   STILLS=<dir> writes each frame as a png there instead (with the mp4 left out): stills of moments, e.g. from to = 3.4 3.6.
// env: BASE (dev server; else :5198, else :5173), DPR (default 1; 2 renders at twice the size and scales down),
//      CRF (default 16), SHUTTER (share of a frame the shutter is open, default 0.5).
import { filmLab } from './lib.mjs';

await filmLab({ hash: 'making=1', api: 'museMaking', args: process.argv.slice(2), name: 'making.mjs' });
