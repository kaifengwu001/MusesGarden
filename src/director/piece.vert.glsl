// The director's set pieces (pieces.ts): meshes placed in planet space (their
// model matrix), each part painted its own colour and glowing or not, warped
// like everything else (as museProps.vert.glsl).
#include <meadow_common>
#include <meadow_warp>

attribute vec3 aColour; // linear
attribute float aGlow;

varying vec3 vColour;
varying float vGlow;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWorld;

void main() {
  vec4 p = modelMatrix * vec4(position, 1.0);
  vPlanet = p.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColour = aColour;
  vGlow = aGlow;
  vec3 wp = warpPosition(p.xyz);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
