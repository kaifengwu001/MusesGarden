import { smoothstep } from '../core/math';
import { CameraRig, EYE_HEIGHT, refHeight } from '../view/camera';

// The terraces' camera (Kai, 2026-11-03: "tilt the camera up more when about 0.35 above the ground", so that the
// distant towers' tops can be seen): the shared rig, its tilt running ahead of the shared one's round the bird's-eye
// height (zoom 0.35, 70 m up), as it would tilt a little further down. There it looks 38° from straight down (from
// 14°), out to the planet's rim and the towers standing over it. Ahead by the zoom's log-height, so by height as the
// shared tilt is; easing in from orbit and gone by the standing views, and never turning back down on the way in.

/** How far ahead (in zoom at R 128), and the zooms (at R 128) it eases in from, is fullest at and is gone by. */
const AHEAD = { by: 0.16, from: 0.1, at: 0.35, to: 0.65 } as const;
const LOG_SPAN = Math.log(EYE_HEIGHT / refHeight(0));

export class TerraceRig extends CameraRig {
  protected override tiltAt(altitude: number, z: number): number {
    // (the height's zoom at R 128, and that zoom a little further in: ahead by at most 0.8 of how far it moves on,
    // so the tilt only rises)
    const r = Math.log(Math.max(altitude, 1e-3) / refHeight(0)) / LOG_SPAN;
    const ahead = AHEAD.by * smoothstep(AHEAD.from, AHEAD.at, r) * (1 - smoothstep(AHEAD.at, AHEAD.to, r));
    return super.tiltAt(refHeight(r + ahead), z);
  }

  /** How much further up than the shared rig's the camera looks at zoom z (rad). */
  lift(z: number): number {
    const { altitude, tilt } = this.framing(z);
    return tilt - super.tiltAt(altitude, z);
  }
}
