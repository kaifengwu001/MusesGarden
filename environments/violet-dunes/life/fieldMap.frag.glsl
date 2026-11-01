// Evaluates the ground (pass 0), the meadow and light (pass 1) or the wind
// (pass 2) for every texel of the field maps (see fieldMap.ts).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>
#include <meadow_field>
#include <meadow_wind>
#include <meadow_warp>
#include <meadow_clouds>

uniform float uFieldSize;
uniform int uFieldPass;
varying vec2 vUv; // clip space, [-1, 1]²

void main() {
  vec3 dir = fieldDirection(vUv);
  if (uFieldPass == 0) {
    Ground g = sampleGround(dir);
    // Choose an exactly representable nearest-half height before storage.
    // Some GPU attachment paths truncate, adding a full ULP to the bake's
    // interpolation error on taller dunes. Construct the power-of-two
    // quantum from exponent bits so approximate exp2 cannot land below it.
    uint exponent = (floatBitsToUint(max(abs(g.height), 0.00006103515625)) >> 23u) & 255u;
    float quantum = uintBitsToFloat((exponent - 10u) << 23u);
    float height = floor(g.height / quantum + 0.5) * quantum;
    gl_FragColor = vec4(height, g.water, g.clearing, bloomAt(dir));
  } else if (uFieldPass == 1) {
    vec4 f = textureLod(uTerrainBake, dir, 0.0);
    gl_FragColor = vec4(f.g, f.b, cloudShadowAt(dir * (uRadius + max(homestead(dir, f.r), 0.0)), 0.0), f.a);
  } else {
    vec2 waves = gustWaves(dir);
    float ripple = rippleAt(dir);
    gl_FragColor = vec4(windBase(dir, waves.x, waves.y, ripple), windSheen(waves, ripple));
  }
}
