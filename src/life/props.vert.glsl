// The homestead (props.ts): placed in its local frame, warped like everything else.
#include <meadow_common>
#include <meadow_warp>

attribute vec4 aPaint; // edge distance (m), corner distance (m; on the roof, which part), height above the ground (m), stones 0..1
attribute float aKind; // the material (props.frag.glsl)

varying vec3 vNormal;      // warped world
varying vec3 vWorld;
varying vec2 vUv;          // meters on the face
varying vec3 vLocal;       // the homestead's frame (m)
varying vec3 vLocalNormal;
varying vec4 vPaint;
flat varying int vKind;
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
  vKind = int(aKind + 0.5);
  vPlanet = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
