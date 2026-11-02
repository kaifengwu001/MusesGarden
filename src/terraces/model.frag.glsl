// One of Kai's models as its own texture paints it (a tower's grey-blue rock
// in long streaks and dark green tufts on its ledges, a house's white plaster
// and dark tiles), lit as the terraces are (rice.glsl labLight: the sky's
// hemisphere and the sun, the texture keeping its own shading, so the light a
// little softer on it), then the haze: thick low down, thin up high, so a far
// tower's foot fades into it while its peak keeps its colour.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <terraces_fog>
#include <terraces_rice>

uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWarped;
varying float vUp;

void main() {
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWarped;
  float dist = length(toCam);
  if (dot(n, toCam) < 0.0) n = -n;
  vec3 dir = normalize(vPlanet);
  vec3 up = warpNormal(vPlanet, dir);
  vec3 albedo = texture2D(uMap, vUv).rgb;
  vec3 col = mix(albedo, labLight(albedo, n, up), 0.75);
  float above = length(vPlanet) - uRadius;
  col = mix(col, applyAerial(col, dist, dir), mix(1.0, 0.4, smoothstep(5.0, 55.0, above)));
  col = applyHeightFog(col, dist, above, dir);
  gl_FragColor = vec4(col, 1.0);
}
