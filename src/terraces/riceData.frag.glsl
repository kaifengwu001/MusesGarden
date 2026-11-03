// The rice's per-blade pass (rice.ts): for every blade on the pages drawn
// this frame (a texel each: its slot across, the page's place in the list
// down), what the blades' vertices would otherwise each work out again:
//   pass 0 (crop): from the paddy map of the built terraces (paddyMap.ts),
//                  its plants' height (m; 0 where nothing grows: off a floor,
//                  on a bund, a riser or a ridge, fallow or flooded), its
//                  floor (m), its colour, its stage
//   pass 1 (wind): the wind's shared bend (xyz, planet space), the sheen
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <terraces_common>
#include <meadow_wind>

uniform sampler2D uPool;     // per blade, a page a row: direction xyz, ln birth threshold
uniform sampler2D uPageList; // the pages drawn, four to a texel
uniform int uPass;
uniform sampler2D uPaddyMap; // plants' height, its floor, colour, stage
uniform vec4 uMapCentre;     // the map's focus direction, angular radius Θ
uniform vec3 uMapT1;
uniform vec4 uHutSite;      // Muse's hut (hut.ts): its site's up, its floor's radius (m; 0: none)
uniform vec4 uHutX;         // its x way (along its hall)
uniform vec4 uHutZ;         // its z way (out to its gate)
uniform sampler2D uHutSink;  // under its footing and its knoll: the highest the terraces stand there (far over the land past them)
uniform vec4 uHutSinkFrame;  // that raster's square: its middle in its frame (x, z, m), half its side (m)

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
  vec3 c = uMapCentre.xyz;
  vec3 t2 = cross(c, uMapT1);
  vec2 tan2 = vec2(dot(dir, uMapT1), dot(dir, t2));
  float s = length(tan2);
  float r = atan(s, dot(dir, c)) / uMapCentre.w;
  if (r > 0.98) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 xy = s > 1e-9 ? tan2 / s * r : vec2(0.0);
  vec4 here = textureLod(uPaddyMap, xy * 0.5 + 0.5, 0.0);
  // a blade only where its floor reaches a quarter meter out every way: it stands back from the bunds, the
  // risers and the ridges, so none arches out over them (they made a hairy fringe along the bunds up close)
  float o = 0.25 / (uRadius * uMapCentre.w);
  float clear = min(min(textureLod(uPaddyMap, (xy + vec2(o, 0.0)) * 0.5 + 0.5, 0.0).r, textureLod(uPaddyMap, (xy - vec2(o, 0.0)) * 0.5 + 0.5, 0.0).r),
                    min(textureLod(uPaddyMap, (xy + vec2(0.0, o)) * 0.5 + 0.5, 0.0).r, textureLod(uPaddyMap, (xy - vec2(0.0, o)) * 0.5 + 0.5, 0.0).r));
  if (clear <= 0.01) here.r = 0.0;
  // (none on Muse's hut's footing or its knoll: the paddies the map has there are sunk under them, hut.ts)
  float f = dot(dir, uHutSite.xyz);
  if (uHutSite.w > 0.0 && f > 0.9) {
    vec2 q = vec2(dot(dir, uHutX.xyz), dot(dir, uHutZ.xyz)) * (uHutSite.w / f);
    vec2 uv = (q - uHutSinkFrame.xy) / (2.0 * uHutSinkFrame.z) + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && textureLod(uHutSink, uv, 0.0).r < 1e3) here.r = 0.0;
  }
  gl_FragColor = here;
}
