import { lerp, smoothstep } from '../core/math';
import { warpForZoom } from '../render/warp';
import { CameraRig, type GroundFn } from '../view/camera';

// The terraces' camera (Kai, 2026-11-03: "tilt the camera up more when about 0.35 above the ground", so that the
// distant towers' tops can be seen; then, of a tilt that ran ahead of the shared one's: "a weird 'tilt up / tilt
// down / tilt up again' back and forth"): the shared rig, its tilt set by where it puts the horizon in the frame,
// which moves only one way as you zoom in. From orbit the planet fills the frame as before; then the horizon comes
// down into it from the top, to just over the frame's middle by the bird's-eye stop (zoom 0.35, 70 m up), the rim
// and the towers' tops over it in view; it stays there on the way down until the shared rig's own tilt would bring
// it lower, from just before the standing view (4.3 m) on, and from there the tilt is the shared one's. The horizon
// is the planet's smooth sphere's, warped as warp.glsl warps it at that zoom, seen from the camera's height (a tilt
// that ran ahead by height alone let the horizon run back up the frame as the warp flattened the planet, 0.42–0.62).

/**
 * Where the horizon is held (0 the frame's middle, 1 its top edge), from where it comes down (the zooms), and how
 * softly that meets the shared rig's own (in the same units).
 */
const HOLD = { place: 0.12, from: 0.2, at: 0.35, above: 1.6, soft: 0.04 } as const;

export class TerraceRig extends CameraRig {
  /** The warp's visual radius (m, the view's: params view.visualRadius), set by the world. */
  visualRadius = 60;

  constructor(private planet: number) {
    super();
  }

  override update(realDt: number, radius: number, aspect: number, ground: GroundFn): void {
    this.planet = radius;
    super.update(realDt, radius, aspect, ground);
  }

  protected override tiltAt(altitude: number, z: number): number {
    const shared = super.tiltAt(altitude, z);
    // (the shared rig's field of view at zoom z, half of it, rad)
    const half = (lerp(35, 55, smoothstep(0.3, 1, z)) * Math.PI) / 360;
    const horizon = this.horizonAt(altitude, z);
    const held = HOLD.place + (HOLD.above - HOLD.place) * (1 - smoothstep(HOLD.from, HOLD.at, z));
    return horizon - softMin((horizon - shared) / half, held, HOLD.soft) * half;
  }

  /** How far from straight down (rad) the horizon of the planet's smooth sphere lies, warped as at zoom z, seen from `altitude` m over it. */
  horizonAt(altitude: number, z: number): number {
    const R = this.planet;
    const kr = warpForZoom(z, R, this.visualRadius) * R * R;
    const C = R + altitude;
    // (where the sight line grazes the warped sphere, y = R cos θ − k (R sin θ)²: cos θ the one root of
    // kR²c³ + (C − kR²)c − R = 0, the warps' curvatures keeping it rising over [−1, 1])
    let c = R / C;
    for (let i = 0; i < 10; i++) {
      const f = kr * c * c * c + (C - kr) * c - R;
      c = Math.min(Math.max(c - f / (3 * kr * c * c + C - kr), -1), 1);
    }
    const s2 = 1 - c * c;
    return Math.atan2(R * Math.sqrt(s2), C - R * c + kr * s2);
  }

  /** How much further up than the shared rig's the camera looks at zoom z (rad). */
  lift(z: number): number {
    const { altitude, tilt } = this.framing(z);
    return tilt - super.tiltAt(altitude, z);
  }
}

/** The lesser of a and b, rounded off where they are within w of each other. */
function softMin(a: number, b: number, w: number): number {
  const h = Math.max(w - Math.abs(a - b), 0) / w;
  return Math.min(a, b) - (h * h * w) / 4;
}
