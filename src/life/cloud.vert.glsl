// Cloud puffs: lumpy spheres (noise along the normal) so silhouettes read as
// soft, piled cumulus; warped like the rest of the world.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uTime;
attribute float aSeed;

varying vec3 vNormal;
varying vec3 vWorld;
varying float vBase;

void main() {
  vec3 p = position;
  float lump = gnoise(p * 2.2 + aSeed * 7.0 + vec3(0.0, uTime * 0.03, 0.0), 911u) * 0.14 + gnoise(p * 5.0 + aSeed * 3.0, 913u) * 0.05;
  p += normal * lump;
  // flatter undersides
  p.y = p.y < -0.25 ? mix(p.y, -0.25, 0.65) : p.y;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(p, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vec3 w = warpPosition(world.xyz);
  vNormal = warpNormal(world.xyz, n);
  vWorld = w;
  vBase = smoothstep(-0.3, 0.6, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
