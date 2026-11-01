// Cobalt saved-find specimens: native rooted forms with stable find IDs.
// Geometry uses the existing packed find ABI; colours and growth are local.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_paint>
#include <meadow_field>
#include <meadow_wind>
#include <meadow_clouds>
#include <meadow_find>

attribute vec4 aLocal; // x, y, z in the find's frame (m × LOCAL_SCALE), part × 4096 + t × 4095 (collectibleForms.ts packShape)
uniform float uPixelAngle;
centroid varying vec3 vColour; // centroid, as in grass.frag.glsl

#define PART_STEM 0
#define PART_LEAF 1
#define PART_PETAL 2
#define PART_CENTRE 3
#define PART_BUD 4
#define PART_STONE 5

// bloom, spire, fern, reed: reeds give to the wind most, ferns least
const float STIFFNESS[4] = float[4](1.3, 1.5, 1.9, 1.0);

float rnd(float s, float k) {
  return fract(sin(s * 78.233 + k * 12.9898) * 43758.5453);
}

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// 0 → 1 over `span` s with a little overshoot past 1 (ease out, back), as the bed's flowers rise
float rise(float age, float span) {
  float t = clamp(age / span, 0.0, 1.0) - 1.0;
  return 1.0 + 2.2 * t * t * t + 1.2 * t * t;
}

void main() {
  Find f = findOf();
  float age = findAge(f);
  // shrinking into its bed as the camera rises past the beds, far from the focus (as the
  // wildflowers do), and before it is too small to draw without sparkling
  vec3 base = f.dir * (uRadius + height0(f.dir) + uBank.x + findLift(f) - 0.005);
  float d = chordAngle(f.dir, uWarpUp) * uRadius;
  float pixels = 0.8 * SPECIMEN_SCALE / max(length(cameraPosition - warpPosition(base)) * uPixelAngle, 1e-6);
  float size = uFindLook.z * (1.0 - smoothstep(120.0, 200.0, d)) * smoothstep(1.5, 4.0, pixels);
  if (age <= 0.0 || size <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float partCode = floor(aLocal.w / 4096.0);
  int part = int(partCode);
  float t = (aLocal.w - partCode * 4096.0) / 4095.0;
  bool stone = part == PART_STONE;
  bool head = part == PART_PETAL || part == PART_CENTRE || part == PART_BUD;
  float grow = stone ? smoothstep(0.0, 0.8, age) : rise(age, 0.95);
  float open = smoothstep(0.45, 1.5, age);

  vec3 local = aLocal.xyz / LOCAL_SCALE;
  // Existing find metadata remains stable; every plant uses a native rooted
  // shape, so old fern records must not roll the new branches into coils.
  if(!stone)local.xz*=mix(0.72,1.0,open);
  local *= grow * size * SPECIMEN_SCALE;

  // the frame: x along t1, z along t2, y up
  vec3 up = f.dir;
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, ref));
  vec3 t2 = cross(up, t1);
  vec3 world = base + t1 * local.x + up * local.y + t2 * local.z;

  // the wind and the cloud shadow here: from the near field's maps, or (beyond them) worked out here
  if (!stone) {
    vec2 waves=gustWaves(f.dir);
    vec3 shared=windBase(f.dir,waves.x,waves.y,rippleAt(f.dir));
    vec3 bend = windPlant(f.dir, shared, f.seed, STIFFNESS[f.family] * (0.9 + 0.25 * rnd(f.seed, 1.0)));
    // the higher along the plant, the further it bends
    float lift = max(local.y, 0.0) * t;
    world += bend * lift - up * (lift * 0.25 * min(dot(bend, bend), 1.0));
  }
  float cloud = cloudShadowAt(base, 0.0);

  // light: plants from above like the bed's flowers (their own facing a little), stones by their facing
  vec3 wp = warpPosition(world);
  vec3 toCam = normalize(cameraPosition - wp);
  vec3 n = normalize(t1 * aNormal.x + up * aNormal.y + t2 * aNormal.z);
  if (dot(n, toCam) < 0.0) n = -n;
  float shadow = max(cloud, 0.85 * cottageShadow(f.dir));
  float ndl = stone ? dot(n, uSunDir) : mix(dot(up, uSunDir), abs(dot(n, uSunDir)), 0.25);
  float b = toonLight(ndl) * mix(stone ? 0.75 : 0.55, 1.0, t) * (1.0 - 0.9 * shadow);
  vec3 col;
  if(part==PART_STEM)col=tone3(pal(ROW_PINK,4),pal(ROW_PINK,4),pal(ROW_PINK,5),b);
  else if(part==PART_LEAF)col=tone3(pal(ROW_STAR,0),pal(ROW_STAR,4),pal(ROW_STAR,1),b);
  else if(stone)col=tone3(pal(ROW_ROCK,2),pal(ROW_ROCK,0),pal(ROW_ROCK,1),b);
  else col=tone3(pal(ROW_PINK,0),pal(ROW_PINK,1),pal(ROW_PINK,3),b);
  // under a cloud, into the shade with the meadow, keeping the hue (flower.vert.glsl)
  col *= mix(vec3(1.0), vec3(0.68, 0.7, 0.8), clamp(shadow, 0.0, 1.0));
  if (!stone) col += pal(ROW_LIGHT, 3) * t * clamp(dot(-toCam, uSunDir) * 0.7 + 0.3, 0.0, 1.0) * 0.12 * uToon.z * (1.0 - shadow);

  // open: a touch brighter; hovered or landing: glowing, most where it turns from you (its outline)
  vec3 lit = findLit(f);
  col = mix(col, col * 1.15 + 0.03, lit.y);
  float rim = 1.0 - abs(dot(n, toCam));
  col = mix(col, findGlow(), clamp(lit.x * (0.2 + 0.8 * rim * rim) + 0.5 * lit.z, 0.0, 1.0) * 0.85);

  vColour = applyAerial(col, length(cameraPosition - wp), f.dir);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
