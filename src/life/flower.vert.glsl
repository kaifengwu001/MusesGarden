// Flowers near the camera: one rest-space point set, four species meshes.
// Each species draw keeps only the instances whose species it is.
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
attribute vec2 aBirth; // ln birth threshold, seed in [0, 1)
attribute float aPart; // 0 stem, 1 petal, 2 centre
attribute float aT;    // along the stem 0..1; 1 on the head
uniform sampler2D uPages;
uniform float uPageSize;
uniform vec4 uFlowers;    // near radius (m), ln density (per m²), species id, size scale
uniform vec4 uFlowerFade; // full-density radius (m), kept fraction at the edge, stem top (m), nod
varying vec3 vColour;

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}

int pickSpecies(float s, float drift, float lush, float nearWater) {
  vec4 w = uSpecies * vec4(0.55 + 1.8 * nearWater + 1.5 * drift * drift,
                           0.55 + 1.3 * (1.0 - drift) + 0.4 * lush,
                           0.6 + 0.9 * lush,
                           0.5 + 0.9 * (1.0 - lush));
  w /= max(dot(w, vec4(1.0)), 1e-4);
  if (s < w.x) return 0;
  if (s < w.x + w.y) return 1;
  if (s < w.x + w.y + w.z) return 2;
  return 3;
}

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  int page = gl_InstanceID / int(uPageSize);
  if (texelFetch(uPages, ivec2(page % 256, page / 256), 0).r < 0.5) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 dir = aDir;
  float seed = aBirth.y;
  vec4 meadow;
  float inside;
  vec4 f = fieldSample(dir, meadow, inside);
  float nearWater = smoothstep(6.0, 1.0, f.y);
  int species = pickSpecies(rnd(seed, 1.0), meadow.y, meadow.x, nearWater);
  if (float(species) != uFlowers.z) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float d = chordAngle(dir, uFieldCentre.xyz) * uRadius;
  float keep = mix(1.0, uFlowerFade.y, smoothstep(uFlowerFade.x, uFlowers.x, d));
  float grow = growthFade(0.5 * (aBirth.x - uFlowers.y - log(keep)));
  float clearing = max(f.z, 0.0);
  float rock = max(-f.z, 0.0);
  float mask = smoothstep(0.25, 0.8, f.y) * (1.0 - smoothstep(0.2, 0.6, clearing)) * (1.0 - smoothstep(0.15, 0.45, rock)) * inside;
  float edge = 1.0 - smoothstep(uFlowers.x * 0.8, uFlowers.x, d);
  float vis = grow * mask * edge;
  if (vis <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  // Bloom: buds ahead of the front, opening behind it with a per-flower delay.
  float open = clamp((f.w - 0.35 * rnd(seed, 2.0)) * 2.4, 0.0, 1.0);
  float scale = uFlowers.w * (0.75 + 0.5 * rnd(seed, 3.0)) * (0.3 + 0.7 * vis);
  float stemScale = scale * mix(0.6, 1.0, open);

  // local frame: up = surface normal, random yaw
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = rnd(seed, 4.0) * 6.2831853;
  vec3 side = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 fwd = cross(side, up);

  vec3 bend = windBend(dir, rnd(seed, 5.0), 1.1 + 0.4 * rnd(seed, 6.0));
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

  // colour by species and part
  float b = toonLight(dot(up, uSunDir)) * mix(0.55, 1.0, aT);
  vec3 col;
  if (aPart < 0.5) {
    col = tone3(pal(ROW_PINK, 4), mix(pal(ROW_PINK, 4), pal(ROW_PINK, 5), 0.5), pal(ROW_PINK, 5), b * 0.85);
  } else if (species == 0) {
    float inner = smoothstep(stemTop + 0.07, stemTop + 0.01, local.y); // the cup's paler heart
    col = tone3(mix(pal(ROW_PINK, 0), pal(ROW_PINK, 2), inner), pal(ROW_PINK, 1), pal(ROW_PINK, 3), b);
  } else if (species == 1) {
    col = aPart > 1.5 ? tone3(pal(ROW_STAR, 3), pal(ROW_STAR, 2), pal(ROW_SCATTER, 1), b) : tone3(pal(ROW_STAR, 0), pal(ROW_STAR, 0), pal(ROW_STAR, 1), b);
  } else if (species == 2) {
    bool red = rnd(seed, 8.0) < 0.08;
    vec3 lit = red ? pal(ROW_SCATTER, 4) : pal(ROW_SCATTER, 0);
    vec3 shade = red ? pal(ROW_SCATTER, 5) : pal(ROW_SCATTER, 1);
    col = tone3(lit, mix(lit, shade, 0.4), shade, b);
    if (aPart > 1.5) col *= 0.85;
  } else {
    col = aPart > 1.5 ? pal(ROW_STAR, 0) : tone3(pal(ROW_SCATTER, 2), mix(pal(ROW_SCATTER, 2), pal(ROW_SCATTER, 3), 0.5), pal(ROW_SCATTER, 3), b);
  }
  // buds: green, tinted toward the bloom colour as they open
  if (aPart > 0.5) col = mix(tone3(pal(ROW_BUD, 0), pal(ROW_BUD, 0), pal(ROW_GRASS, 2), b), col, smoothstep(0.15, 0.85, open));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z;

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
