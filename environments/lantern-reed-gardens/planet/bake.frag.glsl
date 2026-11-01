// Bakes the meadow fields into one cube-map face. Each texel's direction
// follows the GL cube-map convention, so textureLod(bake, dir) reads back
// what was written for dir.
//   pass 0 (terrain): natural height (m), lushness, wetness, colour variant
//   pass 1 (flora):   flowers per m² for pink, star, yellow, blue
#include <meadow_noise>
#include <meadow_fields>
uniform int uFace;
uniform float uSize;
uniform int uPass;
uniform samplerCube uBakedTerrain; // pass 1 reads the wetness pass 0 wrote

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
    float wet = wetnessAt(t);
    float h = reliefAt(t, wet) + uWet.z - uWet.w * wet - uLevel.x;
    // wetlands flatten toward a plateau just above the water (plateau() in fields.ts)
    h += (WET_PLATEAU * tanh(h / WET_PLATEAU) + WET_PLATEAU_KEEP * h - h) * wet;
    gl_FragColor = vec4(max(-1.1, h), lushAt(t), wet, variantAt(t));
  } else {
    gl_FragColor = floraAt(t, textureLod(uBakedTerrain, dir, 0.0).b);
  }
}
