// Flowers near the camera: each species mesh draws its own pool, sorted on
// the CPU by the colony fields (flowers.ts). Per instance: where, when it is
// born at the local density, a seed, a size and a colour variant.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_rest>
#include <meadow_field>
#include <meadow_wind>
#include <meadow_muse_press>

attribute float aPart; // native foliage; retained for bed highlight compatibility
attribute float aT;    // normalized root-to-tip height
uniform sampler2D uPool;     // per flower, a page a row: direction xyz, ln birth threshold (at the local density)
uniform sampler2D uPoolRest; // per flower: seed in [0, 1), size factor, colour variant
uniform sampler2D uPageList; // the pages drawn (those of tiles in view), four to a texel (scatter.ts)
uniform float uPageSize;
uniform vec4 uFlowers;    // near radius (m), ln mean density (per m²), species id, size scale
uniform vec4 uFlowerFade; // full-density radius (m), kept fraction at the edge, stem top (m), nod
centroid varying vec3 vColour; // centroid, as in grass.frag.glsl

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}



void main() {
  int perPage = int(uPageSize);
  int drawn = gl_InstanceID / perPage;
  int slot = gl_InstanceID - drawn * perPage;
  int page = int(texelFetch(uPageList, ivec2(drawn >> 2, 0), 0)[drawn & 3]);
  vec4 flower = texelFetch(uPool, ivec2(slot, page), 0);
  vec4 rest = texelFetch(uPoolRest, ivec2(slot, page), 0);
  vec3 dir = flower.xyz;
  float seed = rest.x;
  vec2 look = rest.yz; // size factor, colour variant
  int species = int(uFlowers.z + 0.5);
  float d = chordAngle(dir, uFieldCentre.xyz) * uRadius;
  float keep = mix(1.0, uFlowerFade.y, smoothstep(uFlowerFade.x, uFlowers.x, d));
  float grow = presence(0.5 * (flower.w - uFlowers.y - log(keep)));
  // at the near field's edge the flowers thin out (each at a random distance of its own), at full size
  float edge = 1.0 - smoothstep(uFlowers.x * 0.8, uFlowers.x, d);
  float born = grow * step(rnd(seed, 9.0), edge);
  // (flowers thinned out, and a page's empty slots, leave before reading the field maps)
  if (born <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec4 meadow;
  vec4 wind;
  float inside;
  vec4 f = fieldSample(dir, meadow, wind, inside);
  float mask = smoothstep(0.1, 0.45, f.y) * (1.0 - smoothstep(0.2, 0.6, f.z)) * inside;
  float vis = born * mask;
  if (vis <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  // Bloom: buds ahead of the front, opening behind it with a per-flower delay.
  float open = clamp((f.w - 0.35 * rnd(seed, 2.0)) * 2.4, 0.0, 1.0);
  float scale = uFlowers.w * look.x * (0.85 + 0.3 * rnd(seed, 3.0)) * (0.3 + 0.7 * vis);
  float stemScale = scale * mix(0.6, 1.0, open);

  // local frame: up = surface normal, random yaw
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = rnd(seed, 4.0) * 6.2831853;
  vec3 side = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 fwd = cross(side, up);

  vec3 bend = windPlant(dir, wind.xyz, rnd(seed, 5.0), 1.1 + 0.4 * rnd(seed, 6.0));
  float stemTop = uFlowerFade.z;
  vec3 base = dir * (uRadius + f.x - 0.02);
  // pressed down and parted where Muse lies in the grass
  stemScale *= 1.0 - 0.6 * musePress(base, up, stemTop * stemScale, bend);
  // A whole native plant unfurls from its root. No detached flower head or petal disc.
  vec3 local = position;
  float t = aT;
  float spread = mix(0.72, 1.0, open);
  vec3 world = base + side * (local.x * stemScale * spread) + fwd * (local.z * stemScale * spread)
    + up * (local.y * stemScale * (1.0 - 0.12 * min(dot(bend, bend), 1.0) * t))
    + bend * (stemTop * stemScale * t * t * 0.55);

  // Match the cliff plants: coral red, warm ivory and matte sage, without meadow petal colours.
  float shadow = max(meadow.z, 0.85 * cottageShadow(dir));
  vec3 facing = normalize(side * normal.x + up * normal.y + fwd * normal.z);
  float b = max(0.4, toonLight(abs(dot(facing, uSunDir)))) * mix(0.8, 1.0, aT) * (1.0 - 0.55 * shadow);
  float v = look.y;
  vec3 pigment = species == 1 ? vec3(0.98, 0.97, 0.86)
    : (species == 2 ? mix(vec3(0.29, 0.40, 0.26), vec3(0.52, 0.59, 0.37), 0.35 + 0.4 * v)
    : mix(vec3(0.76, 0.27, 0.23), vec3(0.84, 0.34, 0.28), v));
  pigment = pow(pigment, vec3(2.2));
  vec3 col = tone3(pigment * 1.04, pigment * 0.92, pigment * vec3(0.59, 0.67, 0.8), b);
  col *= mix(0.78, 1.0, open);
  // under a cloud the petals sink into the shade with the grass, keeping their
  // hue (a cooler tint than the grass's, which would turn the pinks purple)
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
