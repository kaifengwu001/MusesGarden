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

attribute vec3 aDir;
attribute vec2 aBirth; // ln birth threshold (at the local density), seed in [0, 1)
attribute vec2 aLook;  // size factor, colour variant
attribute float aPart; // 0 stem, 1 petal, 2 centre
attribute float aT;    // along the stem 0..1; 1 on the head
uniform sampler2D uPages;
uniform float uPageSize;
uniform vec4 uFlowers;    // near radius (m), ln mean density (per m²), species id, size scale
uniform vec4 uFlowerFade; // full-density radius (m), kept fraction at the edge, stem top (m), nod
varying vec3 vColour;

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  // the tile's page: 0 out of view, else how far it has grown in (scatter.ts)
  int page = gl_InstanceID / int(uPageSize);
  float grownIn = texelFetch(uPages, ivec2(page % 256, page / 256), 0).r;
  if (grownIn < 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  grownIn = smoothstep(0.0, 1.0, grownIn);
  vec3 dir = aDir;
  float seed = aBirth.y;
  int species = int(uFlowers.z + 0.5);
  float d = chordAngle(dir, uFieldCentre.xyz) * uRadius;
  float keep = mix(1.0, uFlowerFade.y, smoothstep(uFlowerFade.x, uFlowers.x, d));
  float grow = growthFade(0.5 * (aBirth.x - uFlowers.y - log(keep)));
  vec4 meadow;
  vec4 wind;
  float inside;
  vec4 f = fieldSample(dir, meadow, wind, inside);
  float mask = smoothstep(0.1, 0.45, f.y) * (1.0 - smoothstep(0.2, 0.6, f.z)) * inside;
  float edge = 1.0 - smoothstep(uFlowers.x * 0.8, uFlowers.x, d);
  float vis = grow * mask * edge;
  if (vis <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  // Bloom: buds ahead of the front, opening behind it with a per-flower delay.
  float open = clamp((f.w - 0.35 * rnd(seed, 2.0)) * 2.4, 0.0, 1.0);
  float scale = uFlowers.w * aLook.x * (0.85 + 0.3 * rnd(seed, 3.0)) * (0.3 + 0.7 * vis) * grownIn;
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
  vec3 local = position;
  vec3 world;
  if (aPart < 0.5) {
    // stem: bend grows with height along the stem
    float t = aT;
    world = base + side * (local.x * stemScale) + fwd * (local.z * stemScale) + up * (local.y * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0) * t)) + bend * (stemTop * stemScale * t * t);
  } else {
    // head: relative to the stem top, opened by bloom, nodding and fluttering in the wind
    vec3 head = vec3(local.x, local.y - stemTop, local.z) * mix(0.35, 1.0, open);
    vec3 w = vec3(dot(bend, side), 0.0, dot(bend, fwd));
    float wl = length(w);
    vec3 axis = wl > 1e-4 ? normalize(vec3(w.z, 0.0, -w.x)) : vec3(1.0, 0.0, 0.0);
    float flutter = sin(uGust.x * (7.0 + 3.0 * rnd(seed, 7.0)) + seed * 31.0) * 0.08 * (0.3 + uWindVec.w);
    float nod = uFlowerFade.w * mix(0.4, 1.0, open) + 0.6 * wl + flutter;
    head = rotateAxis(head, axis, nod);
    vec3 top = base + up * (stemTop * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0))) + bend * (stemTop * stemScale);
    world = top + side * (head.x * scale) + up * (head.y * scale) + fwd * (head.z * scale);
  }

  // colour by species, colony variant and part; cloud and cottage shadows
  float shadow = max(meadow.z, 0.85 * cottageShadow(dir));
  float b = toonLight(dot(up, uSunDir)) * mix(0.55, 1.0, aT) * (1.0 - 0.9 * shadow);
  float v = aLook.y;
  vec3 col;
  if (aPart < 0.5) {
    col = tone3(pal(ROW_PINK, 4), mix(pal(ROW_PINK, 4), pal(ROW_PINK, 5), 0.5), pal(ROW_PINK, 5), b * 0.85);
  } else if (species == 0) {
    float inner = smoothstep(stemTop + 0.05, stemTop + 0.0, local.y); // the cup's paler heart
    float lipLight = smoothstep(stemTop + 0.065, stemTop + 0.103, local.y);
    vec3 petal = tone3(floraColour(0, v, 1.0), floraColour(0, v, 0.55), floraColour(0, v, 0.0), b * mix(0.75, 1.0, lipLight));
    col = mix(petal, tone3(pal(ROW_PINK, 2), pal(ROW_PINK, 2), floraColour(0, v, 0.4), b), inner * 0.6);
  } else if (species == 1) {
    col = aPart > 1.5 ? tone3(pal(ROW_STAR, 3), pal(ROW_STAR, 2), pal(ROW_SCATTER, 1), b) : tone3(floraColour(1, v, 1.0), floraColour(1, v, 0.6), floraColour(1, v, 0.0), b);
  } else if (species == 2) {
    col = tone3(floraColour(2, v, 1.0), floraColour(2, v, 0.6), floraColour(2, v, 0.0), b);
    if (aPart > 1.5) col *= 0.85;
  } else {
    col = aPart > 1.5 ? pal(ROW_STAR, 0) : tone3(floraColour(3, v, 1.0), floraColour(3, v, 0.5), floraColour(3, v, 0.0), b);
  }
  // buds: green, tinted toward the bloom colour as they open
  if (aPart > 0.5) col = mix(tone3(pal(ROW_BUD, 0), pal(ROW_BUD, 0), pal(ROW_GRASS, 2), b), col, smoothstep(0.15, 0.85, open));
  // under a cloud the petals sink into the shade with the grass, keeping their
  // hue (a cooler tint than the grass's, which would turn the pinks purple)
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
