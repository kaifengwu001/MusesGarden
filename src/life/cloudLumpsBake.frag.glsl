// Bakes the clouds' lumps (cloudLumps.glsl) into one face of a cube map:
// four billow patterns, one per channel, stored as (lumps + 1) / 2.5.
#include <meadow_noise>
uniform int uFace;
uniform float uSize;

// The GL cube-map convention (as bake.frag.glsl).
vec3 faceDirection(int face, vec2 st) {
  if (face == 0) return vec3(1.0, -st.y, -st.x);
  if (face == 1) return vec3(-1.0, -st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, st.y);
  if (face == 3) return vec3(st.x, -1.0, -st.y);
  if (face == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

// A few big round bulges and a little finer detail.
float billows(vec3 d, uint seed) {
  vec3 q = d * 1.15;
  float a = abs(gnoise(q, seed));
  float b = abs(gnoise(q * 2.4 + 11.0, seed + 1u));
  return ((0.8 * a + 0.2 * b) - 0.21) * 4.2;
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(faceDirection(uFace, st));
  vec4 l = vec4(billows(d, 9001u), billows(d, 9011u), billows(d, 9021u), billows(d, 9031u));
  gl_FragColor = clamp((l + 1.0) / 2.5, 0.0, 1.0);
}
