// The homestead (props.ts): placed in its local frame, warped like everything else.
#include <meadow_common>
#include <meadow_warp>

attribute vec4 aPaint; // edge distance (m), corner distance (m), height above the ground (m), ivy 0..1

varying vec3 vNormal;      // warped world
varying vec3 vWorld;
varying vec2 vUv;          // meters on the face
varying vec3 vLocal;       // the homestead's frame (m)
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;     // planet space, unwarped (for the clouds' shadows)

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 w = warpPosition(world.xyz);
  vNormal = warpNormal(world.xyz, n);
  vWorld = w;
  vUv = uv;
  vLocal = position;
  vLocalNormal = normal;
  vPaint = aPaint;
  vPlanet = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
