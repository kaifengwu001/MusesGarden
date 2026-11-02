// The terraces' clouds as the paintings draw their mist (life/clouds.ts CloudForm, its bands): thin sheets winding
// along the wind a few meters over the ground, made again each frame where the clouds' lobes are, warped as
// everything on the planet is. The paint is mist.frag.glsl.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute vec4 aBand; // across the band (−1 … 1), along it (m), its line's seed (0 … 1), its breadth there (m)

varying vec3 vWarped;
varying vec3 vUp;
varying vec4 vBand;

void main() {
  vec3 w = warpPosition(position);
  vWarped = w;
  vUp = warpNormal(position, normalize(position));
  vBand = aBand;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
