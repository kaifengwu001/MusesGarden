// Cottage and props: placed in a local frame, warped like everything else.
// With OUTLINE, the same mesh is drawn back-faces-only and pushed out along
// its normals by a constant number of screen pixels (inverted hull).
#include <meadow_common>
#include <meadow_warp>
uniform float uPixelAngle;
uniform vec4 uOutline; // width (px), -, -, -

#ifdef USE_INSTANCING
attribute float aTint;
#endif

varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying float vTint;

void main() {
  mat4 m = modelMatrix;
  float tint = 0.5;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  tint = aTint;
#endif
  vec4 world = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vec3 w = warpPosition(world.xyz);
  vec3 wn = warpNormal(world.xyz, n);
#ifdef OUTLINE
  float dist = length(cameraPosition - w);
  w += wn * uOutline.x * dist * uPixelAngle;
#endif
  vNormal = wn;
  vWorld = w;
  vUv = uv;
  vLocal = position;
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
