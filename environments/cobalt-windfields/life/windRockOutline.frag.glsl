#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
varying vec3 vWorld;
varying vec3 vPlanet;

void main() {
  vec3 ink = pow(vec3(0.13, 0.18, 0.25), vec3(2.2));
  float viewDistance = distance(cameraPosition, vWorld);
  vec3 aerial = applyAerial(ink, viewDistance, normalize(vPlanet));
  vec3 col = mix(ink, aerial, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
