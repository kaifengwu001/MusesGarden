/** CPU mirror of canyonGround.glsl, for mesh-support audits. Only the bottom
 * rock ring descends to meet terrain; every top and plant anchor is invariant.
 */
export function canyonGroundedHeight(height: number, ground: number, kind: number, localY: number): number {
  return kind > 1.5 && kind < 2.5 && localY <= -0.1 ? Math.min(height, ground - 0.18) : height;
}
