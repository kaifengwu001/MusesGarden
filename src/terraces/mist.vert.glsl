// A layer of the terraces' mist (mist.ts): a shell round the planet at its height over the land's broad form, warped
// as everything on the planet is; its bands are painted on it (mist.frag.glsl).
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_sun>
#include <terraces_mist>

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vUp;

void main() {
  vec3 d = normalize(position);
  vec3 p = d * (uRadius + mistHeight(MIST_LAYER, d).x);
  vec3 w = warpPosition(p);
  vDir = d;
  vWarped = w;
  vUp = warpNormal(p, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
