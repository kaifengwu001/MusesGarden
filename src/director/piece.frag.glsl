// The director's set pieces (pieces.ts): lit as Muse's things are
// (museProps.frag.glsl: the sun its place sees, soft toon bands, the cool
// shade with the meadow's green bounced up into it, the clouds' shadows),
// hazed with distance; a stove's fire glowing on its own (uGlow, flickering).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform vec3 uGlow;

varying vec3 vColour;
varying float vGlow;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 up = normalize(vPlanet);
  vec3 sun = localSun(up);
  float cloud = 0.85 * cloudShadowAt(vPlanet, 0.0);
  float ndl = dot(n, sun);
  vec3 shade = vec3(0.66, 0.68, 0.8) + vec3(0.05, 0.11, 0.0) * clamp(-dot(n, up), 0.0, 1.0);
  float light = mix(smoothstep(-0.35, 0.8, ndl), toonLight(ndl), 0.35) * (1.0 - cloud);
  vec3 col = mix(vColour * shade * mix(vec3(1.0), uShadeTint, 0.5), vColour * vec3(1.03, 1.0, 0.95) * uSunTint, light);
  col = mix(col, vColour * uGlow, vGlow);
  col = applyAerial(col, length(cameraPosition - vWorld), up);
  gl_FragColor = vec4(col, 1.0);
}
