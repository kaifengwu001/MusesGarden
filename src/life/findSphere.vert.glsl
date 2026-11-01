// The finds as glowing spheres (findForms.ts), one point each, read from the
// specimens' own buffers. From high up, where the specimens have shrunk
// away, every find shows as a soft light a fixed size on screen, drawn
// through the warp so it sits where the find grows and goes behind the
// horizon with it. Close by, only a lit find (hovered, open, landing) shows:
// as a light just behind its specimen, so the plant stands in a glow.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>
#include <meadow_find>

uniform float uPixelAngle;
varying vec3 vColour; // the halo's colour, times its strength
varying float vCore;  // the bright core's radius, of the point's (0: none)

void main() {
  Find f = findOf();
  vec3 lit = findLit(f);
  float spheres = uFindLook.w;
  float behind = (1.0 - spheres) * uFindLook.z * max(lit.x, max(0.5 * lit.y, lit.z));
  if (findAge(f) <= 0.0 || max(spheres, behind) < 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // the view's height in pixels
  float view = 2.0 / (projectionMatrix[1][1] * uPixelAngle);
  vec3 at;
  float px;
  float strength;
  if (spheres >= behind) {
    at = f.dir * (uRadius + f.ground + findLift(f) + 0.6);
    px = view * (0.034 + 0.016 * max(lit.x, lit.y)) * (1.0 + 0.6 * lit.z);
    strength = spheres * (0.8 + 0.4 * max(lit.x, lit.y) + 0.5 * lit.z);
    vCore = 0.3;
  } else {
    // across about twice the specimen's height, set back so the plant hides its middle
    vec3 mid = f.dir * (uRadius + f.ground + findLift(f) + 0.4 * SPECIMEN_SCALE);
    vec3 away = normalize(mid - cameraPosition);
    at = mid + away * 0.8;
    px = 1.8 * SPECIMEN_SCALE / max(length(cameraPosition - warpPosition(at)) * uPixelAngle, 1e-6);
    strength = behind;
    vCore = 0.0;
  }
  vec3 wp = warpPosition(at);
  // past the horizon the warped ground turns away from the camera: hidden there
  strength *= smoothstep(-0.01, 0.05, dot(warpNormal(at, f.dir), normalize(cameraPosition - wp)));
  vColour = mix(findGlow(), findColour(f, 1.0), 0.55) * strength;
  gl_PointSize = min(px, 480.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
