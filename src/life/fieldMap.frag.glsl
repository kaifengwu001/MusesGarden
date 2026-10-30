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
    gl_FragColor = vec4(g.height, g.water, g.clearing, bloomAt(dir));
  } else if (uFieldPass == 1) {
    vec4 f = textureLod(uTerrainBake, dir, 0.0);
    gl_FragColor = vec4(f.g, f.b, cloudShadowAt(dir * (uRadius + max(homestead(dir, f.r), 0.0)), 0.0), f.a);
  } else {
    float gust = gustAt(dir);
    float ripple = rippleAt(dir);
    gl_FragColor = vec4(windBase(dir, gust, ripple), windSheen(gust, ripple));
  }
}
