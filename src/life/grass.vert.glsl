// Grass blades near the camera, one instance per rest-space point.
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
uniform sampler2D uPages;
uniform float uPageSize;
uniform vec4 uGrass;     // height (m), width (m), near radius (m), ln density (per m²)
uniform vec4 uGrassFade; // full-density radius (m), kept fraction at the edge
uniform vec3 uGrassPal[10]; // palette cells, see GRASS_COLOURS in grass.ts

varying vec3 vColour;

float rnd(float s, float k) {
  return fract(sin(s * 91.3458 + k * 47.123) * 43758.5453);
}

void main() {
  int page = gl_InstanceID / int(uPageSize);
  if (texelFetch(uPages, ivec2(page % 256, page / 256), 0).r < 0.5) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 dir = aDir;
  float d = chordAngle(dir, uFieldCentre.xyz) * uRadius;
  // Thinning by rank toward the edge: a point stays only while it would be
  // born at the thinned density, so the far field is a blue-noise subset.
  float keep = mix(1.0, uGrassFade.y, smoothstep(uGrassFade.x, uGrass.z, d));
  float grow = presence(0.5 * (aBirth.x - uGrass.w - log(keep)));
  vec4 meadow;
  vec4 wind;
  float inside;
  vec4 f = fieldSample(dir, meadow, wind, inside);
  // right to the water's edge: the blades along a shore fringe the bank
  float mask = smoothstep(-0.03, 0.15, f.y) * (1.0 - smoothstep(0.25, 0.65, f.z)) * inside;
  // at the near field's edge the blades thin out (each at a random distance of its own), at full size
  float edge = 1.0 - smoothstep(uGrass.z * 0.78, uGrass.z, d);
  float vis = grow * mask * step(rnd(aBirth.y, 9.0), edge);
  if (vis <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  float seed = aBirth.y;
  float bloom = f.w;
  float lush = meadow.x;
  float h = uGrass.x * (0.55 + 0.9 * rnd(seed, 1.0)) * mix(0.55, 1.15, bloom) * (0.85 + 0.3 * lush) * (0.25 + 0.75 * vis);
  float w = uGrass.y * (0.7 + 0.6 * rnd(seed, 2.0)) * (0.5 + 0.5 * vis);

  // blade frame: up along the surface normal, turned partly toward the camera
  vec3 up = dir;
  vec3 base = dir * (uRadius + f.x - 0.03);
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = seed * 6.2831853;
  vec3 side = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 toCam = cameraPosition - base;
  vec3 facing = cross(up, toCam);
  float fl = length(facing);
  if (fl > 1e-4) side = normalize(mix(side, facing / fl, 0.6));

  // wind: tip moves along the bend, the blade keeps roughly its length
  float y = position.y;
  vec3 bend = windPlant(dir, wind.xyz, rnd(seed, 3.0), 0.8 + 0.5 * rnd(seed, 4.0));
  vec3 lean = (t1 * (rnd(seed, 5.0) - 0.5) + t2 * (rnd(seed, 6.0) - 0.5)) * 0.35;
  vec3 tip = bend + lean;
  float bl = length(tip);
  vec3 p = base + up * (h * y * (1.0 - 0.32 * min(bl * bl, 1.2) * y)) + side * (w * position.x) + tip * (h * y * y);

  // colour per vertex: dark roots, lit tips, paler ahead of the bloom front
  float cloudShade = fieldShade(meadow);
  float shadow = max(cloudShade, 0.85 * cottageShadow(dir));
  float b = toonLight(dot(up, uSunDir)) * (1.0 - 0.9 * shadow);
  vec3 lit = mix(uGrassPal[0], uGrassPal[1], smoothstep(0.55, 1.0, y) * 0.7);
  vec3 mid = mix(uGrassPal[2], uGrassPal[3], rnd(seed, 7.0) * 0.5);
  vec3 shade = mix(uGrassPal[4], uGrassPal[5], y);
  lit = mix(mix(lit, uGrassPal[6], 0.45), lit, bloom);
  mid = mix(mix(mid, uGrassPal[7], 0.4), mid, bloom);
  float light = mix(0.12, 1.0, smoothstep(0.0, 0.9, y)) * b;
  vec3 col = tone3(lit, mid, shade, light);
  col *= (0.92 + 0.16 * rnd(seed, 8.0)) * cloudTint(shadow);
  // wind sheen: blades laid over by a gust show their pale length to the
  // light; behind the crest they spring back up into their own shade
  float crest = max(wind.w, 0.0) * uMeadowLook.x;
  float trough = max(-wind.w, 0.0) * uMeadowLook.x;
  col = mix(col, uGrassPal[9] * uSunTint, crest * (0.4 + 0.6 * (1.0 - cloudShade)) * (0.4 + 0.6 * y));
  col *= mix(vec3(1.0), vec3(0.56, 0.66, 0.58), trough * 0.85 * (0.45 + 0.55 * y));
  // sun-side rim on the tips
  vec3 v = normalize(toCam);
  col += uGrassPal[8] * pow(y, 3.0) * clamp(dot(-v, uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.18 * uToon.z * (1.0 - shadow);

  vec3 wp = warpPosition(p);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
