// Cobalt saved-find companions: rooted coral and ivory seed sails.
// Planting, highlighting and hover lift retain the saved-find interaction.
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
uniform vec4 uBeds[MAX_BEDS]; // per bed: planted at (s on uPlantClock), highlight 0..1, lift under the pointer 0..1, pulsed at (s; findForms.ts)
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

  float strength = uWindVec.w;
  vec3 shared = windDir(dir) * strength * (0.18 + 0.42 * strength);
  vec3 bend = windPlant(dir, shared, rnd(seed, 5.0), 1.15 + 0.4 * rnd(seed, 6.0));
  float stemTop = uBedLook.x;
  vec3 base = dir * (uRadius + height0(dir) + uBank.x - 0.005 + 0.22 * bed.z);
  vec3 local = position;
  vec3 world;
  // Native coral and sails bend as whole rooted plants; no flower-head pivot.
  float t=clamp(aT,0.0,1.0);
  local.xz*=mix(0.72,1.0,open);
  world=base+side*(local.x*stemScale)+fwd*(local.z*stemScale)+up*(local.y*stemScale);
  world+=bend*(max(local.y,0.0)*stemScale*t*t*0.42);

  // colour by species, variant and part, as the meadow's flowers; cloud and cottage shadows
  float cloud = cloudShadowAt(base, 0.0);
  float shadow = max(cloud, 0.85 * cottageShadow(dir));
  float b = toonLight(dot(up, uSunDir)) * mix(0.55, 1.0, aT) * (1.0 - 0.9 * shadow);
  float v = aLook.z;
  vec3 col;
  if(aPart<0.5)col=tone3(pal(ROW_PINK,4),pal(ROW_PINK,4),pal(ROW_PINK,5),b);
  else if(aPart<1.5)col=tone3(pal(ROW_STAR,0),pal(ROW_STAR,4),pal(ROW_STAR,1),b);
  else col=tone3(pal(ROW_PINK,0),pal(ROW_PINK,1),pal(ROW_PINK,3),b);
  col*=0.95+0.06*v;
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  vec3 toCam = cameraPosition - world;
  col += pal(ROW_LIGHT, 3) * aT * clamp(dot(-normalize(toCam), uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);
  // the bed you are looking at: its heads a touch brighter; the one under the pointer, brighter still
  col = mix(col, col * 1.12 + 0.025, bed.y * step(0.5, aPart));
  col = mix(col, col * 1.3 + 0.06, bed.z * step(0.5, aPart));

  vec3 wp = warpPosition(world);
  vColour = applyAerial(col, length(cameraPosition - wp), dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
