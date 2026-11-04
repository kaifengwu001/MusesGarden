// Film the muses' parade (museLab.html#parade=1, src/dev/museParade.ts) frame by frame into an mp4: the muses one
// after another on match cuts, walking then waving, the camera once round. Every frame is drawn at its own moment (the
// scene is closed-form in time), averaging `samples` renders over the shutter for motion blur, soft shadows and smooth
// edges, piped straight into ffmpeg (H.264, yuv420p, faststart: plays on a phone).
//   node parade.mjs <out.mp4> [w h] [fps] [samples] [from to] [extra-hash]
//   node parade.mjs out.mp4 1920 1080 30 16                    the shot as it is (7 s)
//   node parade.mjs out.mp4 960 540 30 1                       a quick look
//   node parade.mjs out.mp4 1920 1080 30 16 '' '' '&order=tpose6,muse3,muse7&length=3'
//                                                               other muses, or another length (each muse on for length / their number)
//   '&wave=<s>' moves the wave's start, '&ease=<p>' the camera's curve, '&look=0' leaves out its turning to you,
//   '&cam=<round°>,<up°>,<m>' holds the camera.
//   STILLS=<dir> writes each frame as a png there instead (with the mp4 left out): stills of moments, e.g. from to = 3.4 3.6.
// env: BASE (dev server; else :5198, else :5173), DPR (default 1; 2 renders at twice the size and scales down),
//      CRF (default 16), SHUTTER (share of a frame the shutter is open, default 0.5).
import { filmLab } from './lib.mjs';

await filmLab({ hash: 'parade=1', api: 'museParade', args: process.argv.slice(2), name: 'parade.mjs' });
