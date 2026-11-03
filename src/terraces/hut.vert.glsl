// Muse's hut (hut.ts): Tracy's Hui cottage, rigid on its site (its model matrix: the site's frame at its floor, its
// size), in its own colours, warped as everything on the planet is; painted by model.frag.glsl.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

varying vec2 vUv;
varying vec3 vNormal;  // warped
varying vec3 vPlanet;  // planet space
varying vec3 vWarped;
varying float vUp;
varying vec3 vColour;

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 w = warpPosition(p);
  vUv = vec2(0.0);
  vNormal = warpNormal(p, n);
  vPlanet = p;
  vWarped = w;
  vUp = position.y;
  vColour = color;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
