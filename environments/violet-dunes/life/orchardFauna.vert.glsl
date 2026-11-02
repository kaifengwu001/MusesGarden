#include <meadow_common>
#include <meadow_warp>
attribute vec3 aColour;
attribute float aKind;
varying vec3 vPlanet;
varying vec3 vWorld;
varying vec3 vPlanetNormal;
varying vec3 vColour;
varying float vKind;
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vec3 planet = (modelMatrix * vec4(position, 1.0)).xyz;
  vPlanet = planet;
  vWorld = warpPosition(planet);
  vPlanetNormal = normalize(mat3(modelMatrix) * normal);
  vColour = aColour;
  vKind = aKind;
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
