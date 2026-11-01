// A karst tower as Kai's model paints it (its own texture: grey-blue rock in
// long streaks, dark green tufts on its ledges and crown), lit softly by the
// planet's sun (a cool blue shade, the light a little warm: the texture holds
// its own shading), then the haze and the valley fog round its foot.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_warp>
#include <terraces_common>
#include <terraces_plots>
#include <terraces_fog>

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
  float b = toonLight(dot(n, uSunDir));
  vec3 albedo = texture2D(uMap, vUv).rgb;
  vec3 col = albedo * mix(pal(ROW_LIGHT, 4) * 0.95, pal(ROW_LIGHT, 0) * 1.08, b);
  col = applyAerial(col, dist, normalize(vPlanet));
  col = applyValleyFog(col, vPlanet);
  gl_FragColor = vec4(col, 1.0);
}
