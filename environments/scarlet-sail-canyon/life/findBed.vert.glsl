// Native canyon garden plants: the saved-find timeline opens whole plants from their roots.
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
attribute float aPart; // native foliage; retained for bed highlight compatibility
attribute float aT;    // normalized root-to-tip height
attribute vec4 aPlace; // the plant's direction (unit), its ground's height over R (m)
attribute vec4 aLook;  // seed in [0, 1), size factor, colour variant, bed index
attribute float aDelay; // s after its bed is planted before this plant starts to rise (its distance from the bed's middle)
uniform vec4 uBeds[MAX_BEDS]; // per bed: planted at (s on uPlantClock), highlight 0..1, lift under the pointer 0..1, pulsed at (s; findForms.ts)
uniform float uPlantClock;
uniform int uSpecies;
uniform vec4 uBedLook; // stem top (m), nod, -, -
centroid varying vec3 vColour;
centroid varying vec2 vNativeUv;
varying float vNativeSpecies;

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
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
  float grow = rise(age, 0.95);
  float open = smoothstep(0.45, 1.5, age);
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

  // the wind and the cloud shadow here: from the near field's maps, or (beyond them) the steady flow
  vec4 meadow;
  vec4 wind;
  float inside;
  fieldSample(dir, meadow, wind, inside);
  float strength = uWindVec.w;
  vec3 shared = inside > 0.5 ? wind.xyz : windDir(dir) * strength * (0.18 + 0.42 * strength);
  vec3 bend = windPlant(dir, shared, rnd(seed, 5.0), 1.15 + 0.4 * rnd(seed, 6.0));
  float stemTop = uBedLook.x;
  vec3 base = dir * (uRadius + aPlace.w - 0.02 + 0.22 * bed.z);
  // A whole native plant unfurls from its root. No detached flower head or petal disc.
  vec3 local = position;
  float t = aT;
  float spread = mix(0.72, 1.0, open);
  vec3 world = base + side * (local.x * stemScale * spread) + fwd * (local.z * stemScale * spread)
    + up * (local.y * stemScale * (1.0 - 0.12 * min(dot(bend, bend), 1.0) * t))
    + bend * (stemTop * stemScale * t * t * 0.55);

  // Match the cliff plants: coral red, warm ivory and matte sage, without meadow petal colours.
  float cloud = inside > 0.5 ? meadow.z : cloudShadowAt(base, 0.0);
  float shadow = max(cloud, 0.85 * cottageShadow(dir));
  vec3 facing = normalize(side * normal.x + up * normal.y + fwd * normal.z);
  float b = max(0.4, toonLight(abs(dot(facing, uSunDir)))) * mix(0.8, 1.0, aT) * (1.0 - 0.55 * shadow);
  float v = aLook.z;
  vec3 pigment = uSpecies == 1 ? vec3(0.98, 0.97, 0.86)
    : (uSpecies == 2 ? mix(vec3(0.35, 0.43, 0.25), vec3(0.61, 0.64, 0.36), 0.35 + 0.4 * v)
    : mix(vec3(0.76, 0.27, 0.23), vec3(0.84, 0.34, 0.28), v));
  pigment = pow(pigment, vec3(2.2));
  vec3 col = tone3(pigment * 1.04, pigment * 0.92, pigment * vec3(0.59, 0.67, 0.8), b);
  col *= mix(0.78, 1.0, open);
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);
  // the bed you are looking at: its heads a touch brighter; the one under the pointer, brighter still
  col = mix(col, col * 1.12 + 0.025, bed.y * step(0.5, aPart));
  col = mix(col, col * 1.3 + 0.06, bed.z * step(0.5, aPart));

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  vNativeUv=uv;
  vNativeSpecies=float(uSpecies);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
