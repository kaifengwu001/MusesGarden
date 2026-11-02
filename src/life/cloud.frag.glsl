// A cloud: its puffs traced along the view ray (clouds.glsl), a little paler
// and bluer far off. Writes the depth of its front, so hills in front of it
// hide it. With MIRROR_PASS, the same cloud seen from the camera mirrored in
// the water, shaded as the lakes paint their reflections. A heap of the veil
// (veil.ts) turns to fog up close (veilFog).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>

uniform mat4 uProjection; // projectionMatrix is not declared in fragment shaders
uniform float uPixelAngle;
#ifdef MIRROR_PASS
uniform sampler2D uWaterMask; // the cells of the screen a lake can read the mirror in (waterMask.ts)
#endif

varying vec3 vPoint;
flat varying int vRow;

// Up close the veil is fog rather than sculpted cloud: its edges soften away,
// it thins where the view goes only a little way into it (the fog in the
// ground does not count, so it frays where it meets the ground), and it is
// lit paler and flatter, as light through fog is (grey-blue low down, white
// above). Everything here runs smoothly across the lobes, so no lobe's edge
// shows through. Far off (from orbit) it keeps the clouds' own outline and
// light. The lakes mirror it the same. c: the heap as the clouds paint it
// (premultiplied), t: where the view meets it.
const vec2 VEIL_FOG = vec2(70.0, 220.0); // all fog nearer than this (m) … all cloud farther than this
const float VEIL_FOG_DEPTH = 7.0;        // fog this deep (m) hides two thirds of what lies behind it
vec4 veilFog(vec4 c, vec4 puffs[PUFFS], vec3 ro, vec3 rd, float t) {
  float fog = 1.0 - smoothstep(VEIL_FOG.x, VEIL_FOG.y, t);
  if (c.a <= 0.0 || fog <= 0.0) return c;
  // the ground (or the water) where the view meets the fog
  float ground = uRadius + max(height0(normalize(unwarpPosition(ro + rd * t))), 0.0);
  float depth = 0.0; // how far the view goes through fog above the ground, each lobe thinning to its edge
  float rise = 0.0;  // that, weighted by how high over the ground it goes
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    if (puff.w <= 0.0) continue;
    vec3 oc = puff.xyz - ro;
    float tc = dot(oc, rd);
    float d2 = max(dot(oc, oc) - tc * tc, 0.0);
    if (d2 >= puff.w * puff.w) continue;
    float half_ = sqrt(puff.w * puff.w - d2);
    float t0 = max(tc - half_, 0.0);
    float t1 = max(tc + half_, 0.0);
    float h0 = length(unwarpPosition(ro + rd * t0)) - ground;
    float h1 = length(unwarpPosition(ro + rd * t1)) - ground;
    // only the part over the ground counts (the ground hides the rest), seen from above or, in the lakes, below
    float over = h0 >= 0.0 ? (h1 >= 0.0 ? 1.0 : h0 / (h0 - h1)) : (h1 > 0.0 ? h1 / (h1 - h0) : 0.0);
    // (thinning to nothing before the lumpy outline can cut it: it never comes in further than the lumps)
    float seen = (t1 - t0) * over * smoothstep(1.0 - CLOUD_LUMPS, 0.45, sqrt(d2) / puff.w);
    depth += seen;
    rise += seen * 0.5 * (max(h0, 0.0) + max(h1, 0.0));
  }
  float a = 1.0 - exp(-depth / VEIL_FOG_DEPTH);
  vec3 col = c.rgb / c.a;
  vec3 mist = mix(mix(pal(ROW_CLOUD, 1), pal(ROW_CLOUD, 0), 0.35), pal(ROW_CLOUD, 0), smoothstep(0.0, 8.0, depth > 0.0 ? rise / depth : 0.0));
  float alpha = mix(c.a, min(c.a, a), fog);
  return vec4(mix(col, mix(col, mist, 0.75), fog) * alpha, alpha);
}

void main() {
#ifdef MIRROR_PASS
  if (texelFetch(uWaterMask, ivec2(gl_FragCoord.xy) / MASK_CELL, 0).r < 0.5) discard;
#endif
  vec3 rd = normalize(vPoint - cameraPosition);
  Cloud cl = loadCloud(vRow);
  vec4 puffs[PUFFS];
  loadPuffs(vRow, puffs);
  vec4 shadowA;
  vec4 shadowB;
  loadShadows(vRow, shadowA, shadowB);
  float t;
#ifdef MIRROR_PASS
  bool mirror = true;
#else
  bool mirror = false;
#endif
  vec4 c = shadeCloud(cl, puffs, shadowA, shadowB, cameraPosition, rd, mirror, uPixelAngle, t);
  if (cl.veil) c = veilFog(c, puffs, cameraPosition, rd, t);
  if (c.a < 0.004) discard;
  vec3 p = cameraPosition + rd * t;
  // clouds pale toward the sky's haze, not the meadow's, and only a third as fast: they keep their form
  vec3 col = mix(c.rgb / c.a, aerialColor(), 0.32 * min(1.0 - exp(-max(0.0, t - uFog.z) * uFog.x), uFog.w));
  gl_FragColor = vec4(col * c.a, c.a);
  vec4 clip = uProjection * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
