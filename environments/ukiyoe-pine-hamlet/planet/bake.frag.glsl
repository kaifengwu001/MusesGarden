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

// The natural ground at a twirled direction on one planet (its relief, lift and drop, and pattern
// octaves): height (m), lushness, wetness, colour variant.
vec4 naturalGround(vec3 t, float relief[RELIEF_OCTAVES], float hummock[RELIEF_OCTAVES], vec2 liftDrop, vec4 patterns) {
  float wet = wetnessAt(t);
  float h = reliefWith(t, wet, relief, hummock) + liftDrop.x - liftDrop.y * wet - uLevel.x;
  // wetlands flatten toward a plateau just above the water (plateau() in fields.ts)
  h += (WET_PLATEAU * tanh(h / WET_PLATEAU) + WET_PLATEAU_KEEP * h - h) * wet;
  return vec4(h, lushWith(t, patterns.xy), wet, variantWith(t, patterns.zw));
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = normalize(faceDirection(uFace, st));
  if (uPass == 0) {
    // about the home, the ground it was tuned to, fading into this planet's own (Fields.anchorHome)
    float w = homeWeight(dir);
    vec4 ground = w < 1.0 ? naturalGround(twirl(dir), uRelief, uHummock, uWet.zw, uPatternA) : vec4(0.0);
    if (w > 0.0) ground = mix(ground, naturalGround(twirl(homeDirection(dir)), uReliefTuned, uHummockTuned, uTuned.xy, uPatternTuned), w);
    gl_FragColor = ground;
  } else {
    gl_FragColor = floraAt(twirl(dir), textureLod(uBakedTerrain, dir, 0.0).b);
  }
}
