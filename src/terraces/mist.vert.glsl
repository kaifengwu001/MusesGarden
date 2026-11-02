// The terraces' mist (mist.ts): a shell round the planet at its height over the land's form, warped as everything on
// the planet is; its strokes are painted on it (mist.frag.glsl).
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_toon>
#include <terraces_common>
#include <terraces_mist>

varying vec3 vDir;
varying vec3 vWarped;
varying vec3 vUp;
varying float vHeight;

void main() {
  vec3 d = normalize(position);
  float h = mistHeight(d).x;
  vec3 p = d * (uRadius + h);
  vec3 w = warpPosition(p);
  vDir = d;
  vWarped = w;
  vUp = warpNormal(p, d);
  vHeight = h;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
