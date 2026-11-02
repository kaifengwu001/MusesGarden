// A mist layer's band field (mist.ts), baked into one face of its cube map: per direction, how far (m, signed) from
// the middle line of the layer's bands, its presence (a slower field: bands only where it is high enough), and how
// broad its band is there (0 … 1: swelling and thinning along it).
// The middle lines are the zero line of a field over the layer's shell whose own input is bent by a quicker field
// (a domain warp): so they wind at the meander's scale, as a network at the network's scale, and fork and join where
// the field's zero line does. The distance is the field over its gradient's length (worked out a little either way
// on the shell), held where the gradient flattens, at a fork, so the band pools there.
#include <meadow_noise>
uniform int uFace;
uniform float uSize;
uniform vec4 uScales; // the network's scale, the meander's scale, how far the meander swings (m), the presence's scale (m)
uniform float uShell; // the layer's radius (m)
uniform uint uSeed;

// The GL cube-map convention (as bake.frag.glsl).
vec3 faceDirection(int face, vec2 st) {
  if (face == 0) return vec3(1.0, -st.y, -st.x);
  if (face == 1) return vec3(-1.0, -st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, st.y);
  if (face == 3) return vec3(st.x, -1.0, -st.y);
  if (face == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

float field(vec3 p) {
  vec3 q = p / uScales.y;
  vec3 w = vec3(gnoise(q, uSeed), gnoise(q + vec3(31.7, 0.0, 0.0), uSeed + 1u), gnoise(q + vec3(0.0, 57.1, 0.0), uSeed + 2u));
  return gnoise((p + w * uScales.z * 1.6) / uScales.x, uSeed + 3u);
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(faceDirection(uFace, st));
  vec3 p = d * uShell;
  vec3 a = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(d, a);
  const float e = 0.2;
  float f = field(p);
  float gx = (field(p + a * e) - field(p - a * e)) / (2.0 * e);
  float gy = (field(p + b * e) - field(p - b * e)) / (2.0 * e);
  float dist = clamp(f / max(length(vec2(gx, gy)), 0.4 / uScales.x), -40.0, 40.0);
  float present = gnoise(p / uScales.w + 7.3, uSeed + 4u);
  float broad = clamp(0.5 + 0.9 * gnoise(p / (1.8 * uScales.y) + 3.1, uSeed + 5u), 0.0, 1.0);
  gl_FragColor = vec4(dist, present, broad, 1.0);
}
