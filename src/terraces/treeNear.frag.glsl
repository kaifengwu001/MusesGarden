// A tree near the camera (treeNear.vert.glsl), lit as the far tree is (tree.frag.glsl): its clumps in the same soft
// bands, darker low in its crown and in its cores, the same painted edge where they turn from the camera; each clump a
// little its own green; the trunk and branches its bark; then the haze. Over its last meters, only on the pixels the
// far tree leaves (the same dither, the other way).
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <terraces_common>
#include <terraces_fog>

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLump;
flat varying vec4 vInfo;

void main() {
  float fade = vInfo.w;
  if (fade > 0.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) <= fade) discard;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  int kind = int(vInfo.x + 0.5);
  float tint = fract(vInfo.z);
  float own = floor(vInfo.z / 10.0) / 100.0;
  vec3 col;
  if (kind <= 1) {
    // (each clump lit as it is round, a little toward its lump's roundness so the crown reads whole; a clump turned in
    // under the others a little darker; a thin painted edge round each, as clumps of leaves are drawn)
    vec3 ln = normalize(vWorld - vLump);
    float b = toonLight(dot(normalize(n + 0.5 * ln), uSunDir));
    vec3 lit = mix(pal(TR_FOREST, 0), pal(TR_FOREST, 8), tint * 0.6);
    vec3 mid = mix(pal(TR_FOREST, 1), pal(TR_FOREST, 7), tint * 0.5);
    col = tone3(lit, mid, pal(TR_FOREST, 2), b) * own;
    col *= mix(0.62, 1.0, vInfo.y) * mix(0.82, 1.0, smoothstep(-0.4, 0.5, dot(ln, v)));
    if (kind == 1) col *= 0.72;
    col = mix(pal(TR_FOREST, 3), col, smoothstep(0.03, 0.2, dot(n, v)));
  } else {
    col = pal(TR_FOREST, 5) * mix(0.55, 0.9, smoothstep(-0.2, 0.6, dot(n, uSunDir)));
  }
  vec3 planet = unwarpPosition(vWorld);
  float dist = length(cameraPosition - vWorld);
  col = applyAerial(col, dist, normalize(planet));
  col = applyHeightFog(col, dist, length(planet) - uRadius, normalize(planet));
  gl_FragColor = vec4(col, 1.0);
}
