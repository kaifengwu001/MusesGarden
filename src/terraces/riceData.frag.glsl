// The rice's per-blade pass (rice.ts): for every blade on the pages drawn
// this frame (a texel each: its slot across, the page's place in the list
// down), what the blades' vertices would otherwise each work out again:
//   pass 0 (crop): its plants' height (m; 0 where nothing grows: off a paddy,
//                  on a bund or a riser, in a courtyard, fallow or flooded),
//                  its floor over the hills' own height (m), its colour, its stage
//   pass 1 (wind): the wind's shared bend (xyz, planet space), the sheen
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <terraces_common>
#include <meadow_wind>
#include <terraces_plots>
#include <terraces_paddy>
#include <terraces_ground>
#include <terraces_village>

uniform sampler2D uPool;     // per blade, a page a row: direction xyz, ln birth threshold
uniform sampler2D uPageList; // the pages drawn, four to a texel
uniform int uPass;

const float COURTYARD = 2.4;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int page = int(texelFetch(uPageList, ivec2(px.y >> 2, 0), 0)[px.y & 3]);
  vec4 blade = texelFetch(uPool, ivec2(px.x, page), 0);
  if (blade.w > 1e29) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 dir = blade.xyz;
  if (uPass == 1) {
    vec2 waves = gustWaves(dir);
    float ripple = rippleAt(dir);
    gl_FragColor = vec4(windBase(dir, waves.x, waves.y, ripple), windSheen(waves, ripple));
    return;
  }
  Plot p = plotAt(dir);
  Crop c = cropOf(p);
  float h = c.height;
  // off the floor (its bunds, its riser, the bunds across), in the forest, round a house: none
  float bund = uTerraceWall.y;
  if (p.wild > 0.4 || p.dCross < 0.6 * bund || houseDistance(dir) < COURTYARD) h = 0.0;
  if (p.kind == PLOT_TERRACE && (p.dOut < bund || p.dIn < riserWidth(p.floorH, p.above + uTerraceWall.z) + 0.05)) h = 0.0;
  gl_FragColor = vec4(h, p.floorH - p.natural, c.variant, c.maturity);
}
