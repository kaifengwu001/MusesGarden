// Muse's things in the meadow (museProps.ts): meshes placed in planet space
// (their model matrix), each part painted its own colour, warped like
// everything else.
#include <meadow_common>
#include <meadow_warp>

attribute vec3 aColour; // linear

varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWorld;

void main() {
  vec4 p = modelMatrix * vec4(position, 1.0);
  vPlanet = p.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColour = aColour;
  vec3 wp = warpPosition(p.xyz);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
