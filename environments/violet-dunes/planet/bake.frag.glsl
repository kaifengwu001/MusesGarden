// Bakes the dune fields into one cube-map face. Each texel's direction
// follows the GL cube-map convention, so textureLod(bake, dir) reads back
// what was written for dir.
//   pass 0 (terrain): natural height (m), sand tone, habitat, colour variant
//   pass 1 (flora):   the slate and sail-reed clusters, starflowers per m², -, -
#include <meadow_noise>
#include <meadow_fields>
uniform int uFace;
uniform float uSize;
uniform int uPass;
uniform samplerCube uBakedTerrain; // pass 1 reads the habitat pass 0 wrote

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
  if (uPass == 0) {
    float habitat = habitatAt(dir);
    gl_FragColor = vec4(naturalAt(dir, habitat), toneAt(dir), habitat, variantAt(dir));
  } else {
    gl_FragColor = floraAt(dir, textureLod(uBakedTerrain, dir, 0.0).b);
  }
}
