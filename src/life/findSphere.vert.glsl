// The finds as glowing spheres (findBeds.ts), one point each. From high up,
// where the patches are a pixel or two, every find shows as a soft light a
// fixed size on screen in its flowers' colour, drawn through the warp so it
// sits where the find grows and goes behind the horizon with it. The one
// under the pointer and the one whose card is up are brighter, one coming
// home pulses, and the picked basket's are larger and take its tint.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>
#include <meadow_find>

attribute vec4 aPlace; // the find's direction (unit), its ground over R (m)
attribute vec4 aLook;  // its species, its colour variant, its index (findState), -
uniform float uPixelAngle;
uniform float uSpheres; // how plainly the spheres show at the camera's height, 0..1
varying vec3 vColour;   // the halo's colour, times its strength

void main() {
  FindState find = findState(aLook.z);
  if (uPlantClock <= find.planted || uSpheres < 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float lit = max(find.lift, find.open);
  float pulse = findPulse(find);
  // the view's height in pixels
  float view = 2.0 / (projectionMatrix[1][1] * uPixelAngle);
  vec3 at = aPlace.xyz * (uRadius + aPlace.w + 0.22 * find.lift + 0.6);
  float px = view * (0.034 + 0.016 * lit) * (1.0 + 0.6 * pulse) * mix(1.0, MARK_SIZE, find.mark);
  float strength = uSpheres * (0.8 + 0.4 * lit + 0.5 * pulse);
  vec3 wp = warpPosition(at);
  // past the horizon the warped ground turns away from the camera: hidden there
  strength *= smoothstep(-0.01, 0.05, dot(warpNormal(at, aPlace.xyz), normalize(cameraPosition - wp)));
  int species = int(aLook.x + 0.5);
  float variant = aLook.y;
  vec3 petals = tone3(floraColour(species, variant, 1.0), floraColour(species, variant, 0.6), floraColour(species, variant, 0.0), 1.0);
  vec3 colour = mix(findGlow(), petals, 0.55);
  vColour = mix(colour, findMarkTint(), 0.7 * find.mark) * strength * (1.0 + 0.25 * find.mark);
  gl_PointSize = min(px, 480.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
