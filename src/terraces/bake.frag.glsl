// Bakes the terraces' fields into one cube-map face (planet/bake.ts drives
// it, as it drives the meadow's). Each texel's direction follows the GL
// cube-map convention, so textureLod(bake, dir) reads back what was written.
//   pass 0 (terrain): natural height (m), slope, wild, level offset
//   pass 1 (life):    fog layer A, fog layer B, season, colour region
#include <meadow_noise>
uniform float uRadius;
#include <terraces_common>
#include <terraces_fields>
uniform int uFace;
uniform float uSize;
uniform int uPass;

vec3 faceDirection(int face, vec2 st) {
  if (face == 0) return vec3(1.0, -st.y, -st.x);
  if (face == 1) return vec3(-1.0, -st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, st.y);
  if (face == 3) return vec3(st.x, -1.0, -st.y);
  if (face == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = normalize(faceDirection(uFace, st));
  gl_FragColor = uPass == 0 ? terraceBase(dir) : terraceLife(dir);
}
