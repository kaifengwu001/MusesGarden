// Bakes the meadow fields into one cube-map face. Each texel's direction
// follows the GL cube-map convention, so textureLod(bake, dir) reads back
// what was written for dir.
//   pass 0: smooth relief integer, lushness, relief fraction, colour variant
//   pass 1 (flora):   flowers per m² for pink, star, yellow, blue
#include <meadow_noise>
#include <meadow_fields>
uniform int uFace;
uniform float uSize;
uniform int uPass;
uniform samplerCube uBakedTerrain; // retained bake interface; this world is always dry

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
  vec3 t = twirl(dir);
  if (uPass == 0) {
    // Interpolate the smooth geology before stepping it. Integer + fraction
    // channels avoid half-float height rounding being magnified at cliff faces.
    float relief = reliefAt(dir, 0.0);
    gl_FragColor = vec4(floor(relief), lushAt(t), fract(relief), variantAt(t));
  } else {
    gl_FragColor = floraAt(t, 0.0);
  }
}
