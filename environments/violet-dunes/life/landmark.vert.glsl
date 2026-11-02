// Slate and sail-reeds (landmarks.ts). Each instance is laid at its anchor
// on the planet (the home patch: shelter-local meters, bent round the planet
// as the props are; SEEDED: a direction read from the scatter pool, faded in
// by its birth radius) and set on the ground there: a slate on the lowest of its footprint's
// corners, tilted most of the way to the slope and sunk a little (more far
// away, where the coarse ground mesh cuts the crests); a sail-reed upright.
// Sail-reeds sway in closed form. Anything under a couple of pixels shrinks
// away, so nothing sparkles from orbit.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_toon>
#include <meadow_paint>
#include <meadow_rest>

uniform float uTime;
uniform float uPixelAngle;
uniform vec4 uKit;       // 0 slate / 1 sail-reed, footprint half sizes x, z (m), height (m)
attribute vec4 aPart;    // part (0 slate, 1 stem, 2 leaf), height fraction, lance slot, shade / across the leaf
attribute vec2 aLeaf;    // along the leaf 0..1, its length (m)
#ifdef SEEDED
uniform sampler2D uPool;     // flat instance texels: direction xyz, ln birth threshold (at the local density)
uniform sampler2D uPoolRest; // per instance: seed in [0, 1), size factor, lance leaves shown, -
uniform sampler2D uPageList; // the pages drawn (those of tiles in view), four to a texel (scatter.ts)
uniform float uPageSize;
uniform float uLnDensity;    // ln of the layer's mean density (per m²)
#ifdef DISTANT
uniform float uFarDensityRadius;
#endif
const float HOME_CLEAR = 19.0; // landmarks.ts SEEDED.homeClear
#else
attribute vec4 aHome;    // shelter-local x, z (m), turn (rad), size factor
attribute vec2 aSeed;    // 0..1, lance leaves shown (3–5)
#endif

varying vec3 vNormal;    // warped
varying vec3 vPlanet;    // planet space, before the warp
varying vec3 vWarped;
varying vec3 vLocal;     // mesh-local meters (marks follow the object)
// Thin foliage may cover only an MSAA sample, outside the pixel centre.
// Keep bounded botanical coordinates inside the covered triangle.
centroid varying vec4 vPart;
centroid varying vec2 vLeaf;
varying float vSeed;

// The anchor of a shelter-local point: props.vert.glsl's bend round the planet.
vec3 homeDirection(vec2 xz) {
  vec3 U = uCottage.xyz;
  vec3 X = normalize(cross(U, uCottageB.xyz));
  vec3 Z = cross(X, U);
  float d = length(xz);
  if (d < 1e-5) return U;
  float a = asin(min(d / uRadius, 1.0));
  vec3 T = (X * xz.x + Z * xz.y) / d;
  return normalize(U * cos(a) + T * sin(a));
}

void collapse() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
}

#ifdef SEEDED
vec4 scatterTexel(sampler2D data, int index) {
  int width = textureSize(data, 0).x;
  return texelFetch(data, ivec2(index % width, index / width), 0);
}
#endif

void main() {
  bool reed = uKit.x > 0.5;
#ifdef SEEDED
  int perPage = int(uPageSize);
  int drawn = gl_InstanceID / perPage;
  int slot = gl_InstanceID - drawn * perPage;
  int page = int(scatterTexel(uPageList, drawn >> 2)[drawn & 3]);
  int instance = page * perPage + slot;
  vec4 pool = scatterTexel(uPool, instance);
  vec4 rest = scatterTexel(uPoolRest, instance);
#ifdef DISTANT
  // The page prefix may include a few later births in its last partial page.
  if (pool.w > uLnDensity + 2.0 * log(uFarDensityRadius)) {
    collapse();
    return;
  }
#endif
  vec3 anchor = pool.xyz;
  float seed = rest.x;
  float grow = presence(0.5 * (pool.w - uLnDensity));
  // (a page's empty slots, stones not yet born, and any the home patch holds itself, leave first)
  vec2 home = cottageLocal(anchor);
  bool atHome = chordAngle(anchor, uCottage.xyz) * uRadius < 2.0 * HOME_CLEAR && max(abs(home.x), abs(home.y)) < HOME_CLEAR;
  if (grow <= 0.002 || atHome || (reed && aPart.z > rest.z + 0.5)) {
    collapse();
    return;
  }
  float scale = rest.y * (0.3 + 0.7 * grow);
  float yaw = seed * 6.2831853;
  // a frame from the anchor alone, turned by the seed
  vec3 up = anchor;
  vec3 x0 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 z0 = cross(x0, up);
#else
  vec3 anchor = homeDirection(aHome.xy);
  float scale = aHome.w;
  float seed = aSeed.x;
  float yaw = aHome.z;

  // a lance leaf past the clump's count is not drawn
  if (reed && aPart.z > aSeed.y + 0.5) {
    collapse();
    return;
  }

  // the anchor's frame: the shelter's axes carried over to it, turned by the instance's yaw
  vec3 up = anchor;
  vec3 X = normalize(cross(uCottage.xyz, uCottageB.xyz));
  vec3 x0 = normalize(X - up * dot(X, up));
  vec3 z0 = cross(x0, up);
#endif
  float c = cos(yaw);
  float s = sin(yaw);
  vec3 side = x0 * c - z0 * s;
  vec3 fwd = x0 * s + z0 * c;
  vec3 shape = vec3(1.0);
#ifdef SEEDED
  // Stable individual proportions: broad squat slabs and slender/tall plant crowns.
  shape = vec3(0.78 + 0.48 * fract(seed * 19.31),
               0.78 + 0.48 * fract(seed * 31.73),
               0.78 + 0.48 * fract(seed * 47.17));
#endif
#ifdef DISTANT
  // Broader coarse canopy cover represents the sub-pixel neighbours on large
  // planets; crown height remains physical, never inflated into giant trees.
  shape.xz *= sqrt(clamp(uRadius / uFarDensityRadius, 1.0, 3.2));
#endif

  // shrink away under a couple of pixels (judged at the anchor, before any ground fetch but one)
  float h0 = height0(anchor);
  vec3 foot = anchor * (uRadius + h0);
  float dist = distance(cameraPosition, warpPosition(foot));
  float px = uKit.w * scale * shape.y / max(dist * uPixelAngle, 1e-6);
#ifdef DISTANT
  // Coarse silhouettes retain sub-pixel cover in orbital groves; detailed
  // foliage still resolves out before its fine edges become unstable.
  float shown = smoothstep(0.25, 0.9, px);
#else
  float shown = smoothstep(1.2, 2.6, px);
#endif
  if (shown <= 0.0) {
    collapse();
    return;
  }

  float base = h0;
  if (!reed) {
    // the footprint's corners on the ground: the lowest carries it, the slope tilts it
    vec2 half_ = uKit.yz * scale * shape.xz;
    float hxp = height0(normalize(anchor + (side * half_.x) / uRadius));
    float hxm = height0(normalize(anchor - (side * half_.x) / uRadius));
    float hzp = height0(normalize(anchor + (fwd * half_.y) / uRadius));
    float hzm = height0(normalize(anchor - (fwd * half_.y) / uRadius));
    vec2 grad = vec2(hxp - hxm, hzp - hzm) / (2.0 * half_);
    // tilted most of the way to the slope: what it rests on is the mean plane, and its low side digs in
    float tilt = 0.75;
    vec3 n = normalize(up - (side * grad.x + fwd * grad.y) * tilt);
    side = normalize(side - n * dot(side, n));
    fwd = cross(side, n);
    up = n;
    float lowest = min(min(hxp, hxm), min(hzp, hzm));
    base = mix(h0, lowest, 0.5) - 0.06 * uKit.w * scale * shape.y - min(0.0015 * dist, 0.25);
  } else {
    base = h0 - 0.04;
  }

  vec3 local = position * shape * scale * mix(0.35, 1.0, shown);
  vec3 world = anchor * (uRadius + base) + side * local.x + up * local.y + fwd * local.z;
  vec3 localNormal = normalize(normal / shape);
  vec3 normalW = side * localNormal.x + up * localNormal.y + fwd * localNormal.z;

  if (reed) {
    // the clump sways with the wind, the tops most, each clump on its own beat; leaves flutter a little more
    vec3 wind = windDir(anchor);
    float t = aPart.y;
    float beat = sin(uTime * 1.3 + seed * 41.0) * 0.6 + sin(uTime * 2.3 + seed * 17.0) * 0.4;
    float amp = (0.05 + 0.18 * uWindVec.w) * uKit.w * scale;
    world += wind * (amp * (0.6 + 0.4 * beat) * t * t);
    if (aPart.x > 1.5) world += cross(up, wind) * (0.02 * uKit.w * scale * sin(uTime * 4.1 + seed * 29.0 + aLeaf.x * 2.0) * aLeaf.x * t);
  }

  vec3 wp = warpPosition(world);
  vNormal = warpNormal(world, normalize(normalW));
  vPlanet = world;
  vWarped = wp;
  vLocal = position;
  vPart = aPart;
  vLeaf = aLeaf;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
