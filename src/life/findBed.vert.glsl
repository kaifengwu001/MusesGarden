// The finds' flower beds (findBeds.ts): the meadow's own flowers, bunched
// into a small bed per find, a little taller than the meadow's and of one
// species (the find's topic) with a few companions. Shaded as the meadow's
// flowers are (flower.vert.glsl), but each plant reads its wind and its
// cloud shadow itself: the beds can stand outside the near field's maps.
// A bed planted while you watch blossoms from its middle outward: each
// flower's stem rises with a little overshoot, then its head opens.
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
#include <meadow_clouds>

#define MAX_BEDS 64
attribute float aPart; // 0 stem, 1 petal, 2 centre
attribute float aT;    // along the stem 0..1; 1 on the head
attribute vec4 aPlace; // the plant's direction (unit), its ground's height over R (m)
attribute vec4 aLook;  // seed in [0, 1), size factor, colour variant, bed index
attribute float aDelay; // s after its bed is planted before this plant starts to rise (its distance from the bed's middle)
uniform vec4 uBeds[MAX_BEDS]; // per bed: planted at (s on uPlantClock), highlight 0..1, -, -
uniform float uPlantClock;
uniform int uSpecies;
uniform vec4 uBedLook; // stem top (m), nod, -, -
centroid varying vec3 vColour; // centroid, as in grass.frag.glsl

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// 0 → 1 over `span` s with a little overshoot past 1 (ease out, back)
float rise(float age, float span) {
  float t = clamp(age / span, 0.0, 1.0) - 1.0;
  return 1.0 + 2.2 * t * t * t + 1.2 * t * t;
}

void main() {
  vec4 bed = uBeds[int(aLook.w + 0.5)];
  float age = uPlantClock - bed.x - aDelay;
  if (age <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float grow = rise(age, 0.75);
  float open = smoothstep(0.35, 1.25, age);
  vec3 dir = aPlace.xyz;
  float seed = aLook.x;
  float scale = aLook.y * (0.85 + 0.3 * rnd(seed, 3.0)) * grow;
  float stemScale = scale * mix(0.7, 1.0, open);

  // local frame: up = surface normal, random yaw
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  float yaw = rnd(seed, 4.0) * 6.2831853;
  vec3 side = t1 * cos(yaw) + t2 * sin(yaw);
  vec3 fwd = cross(side, up);

  // the wind here: the meadow's own field (wind.glsl), read per plant
  vec2 waves = gustWaves(dir);
  vec3 bend = windPlant(dir, windBase(dir, waves.x, waves.y, rippleAt(dir)), rnd(seed, 5.0), 1.15 + 0.4 * rnd(seed, 6.0));
  float stemTop = uBedLook.x;
  vec3 base = dir * (uRadius + aPlace.w - 0.02);
  vec3 local = position;
  vec3 world;
  if (aPart < 0.5) {
    float t = aT;
    world = base + side * (local.x * stemScale) + fwd * (local.z * stemScale) + up * (local.y * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0) * t)) + bend * (stemTop * stemScale * t * t);
  } else {
    vec3 head = vec3(local.x, local.y - stemTop, local.z) * mix(0.3, 1.0, open);
    vec3 w = vec3(dot(bend, side), 0.0, dot(bend, fwd));
    float wl = length(w);
    vec3 axis = wl > 1e-4 ? normalize(vec3(w.z, 0.0, -w.x)) : vec3(1.0, 0.0, 0.0);
    float flutter = sin(uGust.x * (7.0 + 3.0 * rnd(seed, 7.0)) + seed * 31.0) * 0.08 * (0.3 + uWindVec.w);
    float nod = uBedLook.y * mix(0.4, 1.0, open) + 0.6 * wl + flutter;
    head = rotateAxis(head, axis, nod);
    vec3 top = base + up * (stemTop * stemScale * (1.0 - 0.25 * min(dot(bend, bend), 1.0))) + bend * (stemTop * stemScale);
    world = top + side * (head.x * scale) + up * (head.y * scale) + fwd * (head.z * scale);
  }

  // colour by species, variant and part, as the meadow's flowers; cloud and cottage shadows
  float shadow = max(cloudShadowAt(base, 0.0), 0.85 * cottageShadow(dir));
  float b = toonLight(dot(up, uSunDir)) * mix(0.55, 1.0, aT) * (1.0 - 0.9 * shadow);
  float v = aLook.z;
  vec3 col;
  if (aPart < 0.5) {
    col = tone3(pal(ROW_PINK, 4), mix(pal(ROW_PINK, 4), pal(ROW_PINK, 5), 0.5), pal(ROW_PINK, 5), b * 0.85);
  } else if (uSpecies == 0) {
    float inner = smoothstep(stemTop + 0.05, stemTop + 0.0, local.y);
    float lipLight = smoothstep(stemTop + 0.065, stemTop + 0.103, local.y);
    vec3 petal = tone3(floraColour(0, v, 1.0), floraColour(0, v, 0.55), floraColour(0, v, 0.0), b * mix(0.75, 1.0, lipLight));
    col = mix(petal, tone3(pal(ROW_PINK, 2), pal(ROW_PINK, 2), floraColour(0, v, 0.4), b), inner * 0.6);
  } else if (uSpecies == 1) {
    col = aPart > 1.5 ? tone3(pal(ROW_STAR, 3), pal(ROW_STAR, 2), pal(ROW_SCATTER, 1), b) : tone3(floraColour(1, v, 1.0), floraColour(1, v, 0.6), floraColour(1, v, 0.0), b);
  } else if (uSpecies == 2) {
    col = tone3(floraColour(2, v, 1.0), floraColour(2, v, 0.6), floraColour(2, v, 0.0), b);
    if (aPart > 1.5) col *= 0.85;
  } else {
    col = aPart > 1.5 ? pal(ROW_STAR, 0) : tone3(floraColour(3, v, 1.0), floraColour(3, v, 0.5), floraColour(3, v, 0.0), b);
  }
  // buds green until they open
  if (aPart > 0.5) col = mix(tone3(pal(ROW_BUD, 0), pal(ROW_BUD, 0), pal(ROW_GRASS, 2), b), col, smoothstep(0.15, 0.85, open));
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);
  // the bed you are looking at: its heads a touch brighter
  col = mix(col, col * 1.12 + 0.025, bed.y * step(0.5, aPart));

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
