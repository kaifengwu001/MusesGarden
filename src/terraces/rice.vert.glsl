// Rice near the camera (rice.ts): a long narrow blade per rest-space point
// where a paddy has a crop, arching out from its floor up through the water,
// as tall as its paddy's plants and coloured as its paddy is (the per-blade
// pass, riceData.frag.glsl, worked out each blade's paddy and its wind).
// Thinned toward the edge of the near field, where the paint's crop takes
// over (surface.frag.glsl). Shading per vertex, as the meadow's grass.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_rest>
#include <terraces_common>
#include <meadow_wind>
#include <terraces_paddy>
#include <terraces_rice>

uniform sampler2D uPool;     // per blade, a page a row: direction xyz, ln birth threshold
uniform sampler2D uPoolRest; // per blade: its seed in [0, 1), four to a texel
uniform sampler2D uPageList; // the pages drawn, four to a texel
uniform float uPageSize;
uniform sampler2D uRiceCrop; // per drawn blade: plants' height (m), its floor (m), colour, stage
uniform sampler2D uRiceWind; // per drawn blade: the wind's bend (xyz), sheen
uniform vec4 uRice;          // blade width (m), near radius (m), ln density (per m²), wind sheen
uniform vec4 uRiceFade;      // full-density radius (m), kept fraction at the edge
uniform vec4 uRiceNear;      // the near field's focus (direction), its radius (m)

centroid varying vec3 vColour;

float rnd(float s, float k) {
  return fract(sin(s * 91.3458 + k * 47.123) * 43758.5453);
}

void main() {
  int perPage = int(uPageSize);
  int drawn = gl_InstanceID / perPage;
  int slot = gl_InstanceID - drawn * perPage;
  int page = int(texelFetch(uPageList, ivec2(drawn >> 2, 0), 0)[drawn & 3]);
  vec4 blade = texelFetch(uPool, ivec2(slot, page), 0);
  vec3 dir = blade.xyz;
  float seed = texelFetch(uPoolRest, ivec2(slot >> 2, page), 0)[slot & 3];
  float d = chordAngle(dir, uRiceNear.xyz) * uRadius;
  vec4 crop = texelFetch(uRiceCrop, ivec2(slot, drawn), 0);
  // thinning by rank toward the edge (a blue-noise subset), and at the very edge each at a distance of its own;
  // seedlings stand sparse in their water, in even rows of clumps (the same subset), a grown crop dense
  float keep = mix(1.0, uRiceFade.y, smoothstep(uRiceFade.x, uRice.y, d)) * mix(0.14, 1.0, smoothstep(0.12, 0.7, crop.r));
  float born = presence(0.5 * (blade.w - uRice.z - log(keep))) * step(rnd(seed, 9.0), 1.0 - smoothstep(uRice.y * 0.78, uRice.y, d));
  if (born <= 0.002 || crop.r <= 0.01) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec4 wind = texelFetch(uRiceWind, ivec2(slot, drawn), 0);
  float floorH = crop.g;
  float h = crop.r * (0.72 + 0.46 * rnd(seed, 1.0));
  float w = uRice.x * (0.75 + 0.5 * rnd(seed, 2.0)) * mix(0.8, 1.2, smoothstep(0.1, 0.6, crop.r));

  // the blade's frame: up along the planet's normal, turned partly toward the camera
  vec3 up = dir;
  vec3 base = dir * (uRadius + floorH - 0.02);
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = seed * 6.2831853;
  vec3 out_ = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 side = cross(up, out_);
  vec3 toCam = cameraPosition - base;
  vec3 facing = cross(up, toCam);
  float fl = length(facing);
  if (fl > 1e-4) side = normalize(mix(side, facing / fl, 0.5));

  // a rice leaf arches out from its clump and droops at its tip; the wind bends it as the grass
  float y = position.y;
  float arch = mix(0.18, 0.42, rnd(seed, 3.0));
  vec3 bend = windPlant(dir, wind.xyz, rnd(seed, 4.0), 0.9 + 0.6 * rnd(seed, 5.0));
  vec3 tip = out_ * arch + bend;
  float bl = length(tip);
  vec3 p = base + up * (h * y * (1.0 - 0.3 * min(bl * bl, 1.2) * y)) + side * (w * position.x) + tip * (h * y * y);

  // colour per vertex: its paddy's green, dark at the root, lit toward the tip; the wind's sheen
  vec3 lit = riceLit(crop.a, crop.b);
  vec3 shade = riceShade(lit);
  float b = toonLight(dot(up, uSunDir));
  float light = mix(0.3, 1.0, smoothstep(0.0, 0.85, y)) * b;
  vec3 col = tone3(mix(lit, pal(TR_RICE, 5), 0.12 * y * y), mix(lit, shade, 0.4), shade, light);
  col *= 0.9 + 0.2 * rnd(seed, 8.0);
  // (the wind's sheen as the paint lays it on the crop, a little stronger toward the tips)
  float sheen = wind.w * uRice.w;
  float tall = smoothstep(0.25, 0.9, crop.r);
  col = mix(col, pal(TR_RICE, 7) * uSunTint, max(sheen, 0.0) * (0.2 + 0.5 * tall) * (0.6 + 0.6 * y));
  col *= mix(vec3(1.0), vec3(0.62, 0.72, 0.64), max(-sheen, 0.0) * (0.25 + 0.6 * tall) * (0.6 + 0.6 * y));

  vec3 wp = warpPosition(p);
  col = applyAerial(col, length(cameraPosition - wp), dir);
  vColour = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
