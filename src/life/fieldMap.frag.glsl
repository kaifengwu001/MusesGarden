// Evaluates the ground (pass 0) or the meadow fields (pass 1) for every
// texel of the field maps (see fieldMap.ts).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>
#include <meadow_field>

uniform float uFieldSize;
uniform int uFieldPass;
varying vec2 vUv; // clip space, [-1, 1]²

void main() {
  vec3 dir = fieldDirection(vUv);
  if (uFieldPass == 0) {
    Ground g = sampleGround(dir);
    gl_FragColor = vec4(g.height, g.water, g.clearing > 0.0 ? g.clearing : -max(g.mountain, g.rock), bloomAt(dir));
  } else {
    // pixel footprint irrelevant here: plants sample the meadow at its own scale
    vec3 f = meadowFields(dir, 0.0);
    gl_FragColor = vec4(f, 0.0);
  }
}
