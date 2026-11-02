// Bakes the veil's field (veil.ts) into one face of a cube map, once per
// planet: each place's turn (how far the unfolding has to go before it
// clears; veil.ts veilTurn is its mirror), the height of the fog's bank there
// (0 low … 1 high) and its wisps (0 … 1, about 0.5 on average), drawn out in
// streaks along the wind.
#include <meadow_noise>
uniform int uFace;
uniform float uSize;
uniform vec3 uHut;
uniform uint uVeilNoise;
uniform vec3 uWindAxis; // the wind's rotation axis (the wind blows round it: wind.glsl)

// veil.ts VEIL
const float VEIL_CORE = 24.0;
const float VEIL_WANDER = 0.42;
const float VEIL_FRAY = 0.16;

// The GL cube-map convention (as bake.frag.glsl).
vec3 faceDirection(int face, vec2 st) {
  if (face == 0) return vec3(1.0, -st.y, -st.x);
  if (face == 1) return vec3(-1.0, -st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, st.y);
  if (face == 3) return vec3(st.x, -1.0, -st.y);
  if (face == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

float veilTurn(vec3 d) {
  float angle = acos(clamp(dot(d, uHut), -1.0, 1.0));
  if (angle * 128.0 < VEIL_CORE) return -10.0;
  uint s = uVeilNoise;
  float broad = 0.62 * gnoise(d * 1.6, s) + 0.38 * gnoise(d * 3.4, s + 1u);
  float fine = 0.6 * gnoise(d * 9.0, s + 2u) + 0.4 * gnoise(d * 21.0, s + 3u);
  float far = 0.25 + 0.75 * smoothstep(0.0, 1.0, angle);
  return angle + far * (VEIL_WANDER * broad + VEIL_FRAY * fine);
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(faceDirection(uFace, st));
  uint s = uVeilNoise;
  // banks a few tens of meters across; wisps a few meters, drawn out along the wind (it blows round its axis, so
  // a noise four times as fine along the axis runs in streaks with it)
  float banks = clamp(0.5 + 0.7 * (0.65 * gnoise(d * 5.0, s + 4u) + 0.35 * gnoise(d * 12.0, s + 5u)), 0.0, 1.0);
  vec3 q = d + uWindAxis * dot(d, uWindAxis) * 3.0;
  float wisps = clamp(0.5 + 0.75 * (0.6 * gnoise(q * 18.0, s + 6u) + 0.4 * gnoise(q * 37.0, s + 7u)), 0.0, 1.0);
  gl_FragColor = vec4(veilTurn(d), banks, wisps, 1.0);
}
