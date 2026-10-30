// Low cumulus (clouds.ts): each cloud is PUFFS lumpy spheres heaped over a
// flat base, drifting with the wind a few meters above the meadow. One row of
// uCloudData per cloud, nearest the camera first:
//   texel 0      bounding sphere: centre (planet space, m), radius (m)
//   texel 1      base: cloud up (unit), distance of the base from the planet centre (m)
//   texel 2      noise seed, size (m: the heap is about this tall), -, -
//   texels 3..   puffs: centre (planet space, m), radius (m; 0 = unused)
// Everything that shows a cloud reads these same puffs, so a cloud, its
// shadow and its reflection always agree:
//   the cloud itself     cloud.frag.glsl, one billboard per cloud
//   its shadow           a sun-space map of optical depth (cloudShadow.*.glsl)
//   its reflection       cloudsAlong() on the ray mirrored off the water
// A cloud is sculpted, not a fog: the puffs are solid, their outlines lumpy
// like a cauliflower (the same lumps in the cloud, its shadow and its
// mirror), lit lobe by lobe with soft creases where lobes meet and shadowed
// by the puffs between them and the sun. Rays are traced in view space (the
// tiny-planet warp moves each puff with the ground under it).
// Requires: noise, toon (palette), warp.
#define MAX_CLOUDS 512
#define PUFFS 8
#define MAX_REFLECTED 8
uniform highp sampler2D uCloudData;
uniform sampler2D uCloudShadowMap;
uniform vec4 uCloudSunA;  // sun-space axis A (xyz), 1 / half-extent of the shadow map (1/m)
uniform vec4 uCloudSunB;  // sun-space axis B (xyz), -
uniform vec4 uCloudLook;  // shadow strength, optical density (1/m), clouds, clouds that reflect
#include <meadow_cloud_lumps>

// One cloud's frame in view space: bounding sphere, base plane (point, normal).
struct Cloud {
  vec3 centre;
  float radius;
  vec3 basePoint;
  vec3 baseNormal;
  uint seed;
  float size;
};

// A cloud the camera is in (or nearly) dissolves rather than fogging the
// view: 1 well clear of it … 0 inside. Its puffs shrink with it, so it
// erodes from its edges (traceCloud) and only the last of it fades.
float cloudFade(Cloud cl) {
  return smoothstep(4.0, 18.0, distance(cameraPosition, cl.centre) - 0.6 * cl.radius);
}

// A bounding radius that still holds after the warp: puffs farther out from
// the focus drop more than the centre does.
float warpedReach(vec3 centre, float radius) {
  vec3 t = warpTangent(centre);
  return radius * (1.0 + 1.5 * CLOUD_LUMPS) + abs(uWarpK) * (2.0 * length(t) * radius + radius * radius);
}

Cloud loadCloud(int row) {
  Cloud c;
  vec4 b = texelFetch(uCloudData, ivec2(0, row), 0);
  vec4 base = texelFetch(uCloudData, ivec2(1, row), 0);
  c.centre = warpPosition(b.xyz);
  c.radius = warpedReach(b.xyz, b.w);
  vec3 bp = base.xyz * base.w;
  c.basePoint = warpPosition(bp);
  c.baseNormal = warpNormal(bp, base.xyz);
  vec4 info = texelFetch(uCloudData, ivec2(2, row), 0);
  c.seed = uint(info.x);
  c.size = info.y;
  return c;
}

// A cloud's puffs in view space: centre, radius (0 = unused).
void loadPuffs(int row, out vec4 puffs[PUFFS]) {
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
    puffs[k] = vec4(warpPosition(puff.xyz), puff.w);
  }
}

// How much of the heap stands between each puff and the sun: 0 lit … 1 in
// the shade of the puffs above it (traced once per cloud, in the billboard's
// vertex shader; from the upper, sunward part of each puff).
void puffShadows(vec4 puffs[PUFFS], float size, out vec4 shadowA, out vec4 shadowB) {
  float s[PUFFS];
  for (int k = 0; k < PUFFS; k++) {
    s[k] = 0.0;
    if (puffs[k].w <= 0.0) continue;
    vec3 o = puffs[k].xyz + uSunDir * 0.35 * puffs[k].w;
    float block = 0.0;
    for (int j = 0; j < PUFFS; j++) {
      vec4 puff = puffs[j];
      if (j == k || puff.w <= 0.0) continue;
      vec3 oc = puff.xyz - o;
      float tc = dot(oc, uSunDir);
      float d2 = dot(oc, oc) - tc * tc;
      if (tc > 0.0 && d2 < puff.w * puff.w) block += 2.0 * sqrt(puff.w * puff.w - d2);
    }
    s[k] = smoothstep(0.1, 0.6, block / size);
  }
  shadowA = vec4(s[0], s[1], s[2], s[3]);
  shadowB = vec4(s[4], s[5], s[6], s[7]);
}

// The cloud along a ray (view space). Each puff is a solid sphere with a
// lumpy outline; the silhouette is their union, antialiased over a pixel
// (pixelAngle: radians per pixel) or a little softer for big puffs.
// shadows: puffShadows() (zero in the mirror). mirror: in the lakes' mirror
// the outline is softer (the ripples blur it) and the shading plainer (it is
// traced per water pixel): the front lobe's own normal, no creases.
struct CloudHit {
  float cover;  // 0..1
  float t;      // where the ray meets the front surface
  vec3 normal;  // there, blended across the lobes that meet there
  float thick;  // chord through the heap (m)
  int front;    // the front puff
  vec3 frontCentre;
  float shadow; // the front puff's, from puffShadows()
  float crease; // how deep in a crease between lobes the front surface sits, 0..1
};

CloudHit traceCloud(Cloud cl, vec4 puffs[PUFFS], vec4 shadowA, vec4 shadowB, vec3 ro, vec3 rd, bool mirror, float pixelAngle) {
  CloudHit h;
  h.cover = 0.0;
  h.t = 1e9;
  h.normal = cl.baseNormal;
  h.thick = 0.0;
  h.front = -1;
  h.frontCentre = vec3(0.0);
  h.shadow = 0.0;
  h.crease = 0.0;
  // most of a billboard misses the heap: one test against its bound first
  vec3 oc0 = cl.centre - ro;
  float tc0 = dot(oc0, rd);
  if (dot(oc0, oc0) - tc0 * tc0 > cl.radius * cl.radius || tc0 < -cl.radius) return h;
  float entry[PUFFS];
  float reach[PUFFS];
  float erode = 0.5 + 0.5 * cloudFade(cl);
  for (int k = 0; k < PUFFS; k++) {
    entry[k] = 1e9;
    reach[k] = 0.0;
    vec4 puff = puffs[k];
    puff.w *= erode;
    if (puff.w <= 0.0) continue;
    vec3 oc = puff.xyz - ro;
    float tc = dot(oc, rd);
    float d2 = max(dot(oc, oc) - tc * tc, 0.0);
    float rOut = puff.w * (1.0 + 1.5 * CLOUD_LUMPS);
    if (d2 >= rOut * rOut || tc < -puff.w) continue;
    float d = sqrt(d2);
    // the lumps only matter where the ray passes near the outline
    float rl = puff.w;
    if (d > puff.w * (1.0 - CLOUD_LUMPS)) {
      rl = puff.w * (1.0 + CLOUD_LUMPS * puffLumps((ro + rd * tc - puff.xyz) / max(d, 1e-4), lumpSeed(cl.seed, k)));
    }
    float aa = max(pixelAngle * max(tc, 0.0) * 1.1, (mirror ? 0.07 : 0.02) * puff.w);
    float cov = clamp((rl - d) / aa + 0.5, 0.0, 1.0);
    if (cov <= 0.0) continue;
    float half_ = sqrt(max(rl * rl - d2, 0.0));
    float t0 = max(tc - half_, 0.0);
    entry[k] = t0;
    reach[k] = rl;
    h.thick += 2.0 * half_;
    h.cover = max(h.cover, cov);
    if (t0 < h.t) {
      h.t = t0;
      h.front = k;
      h.frontCentre = puff.xyz;
      h.shadow = k < 4 ? shadowA[k] : shadowB[k - 4];
    }
  }
  if (h.front < 0) return h;
  vec3 p = ro + rd * h.t;
  if (mirror) {
    h.normal = normalize(p - h.frontCentre);
    return h;
  }
  // lobes whose surfaces meet near the front blend their normals (soft
  // creases), and the puffs beside the front point darken it (deep creases)
  vec3 normal = vec3(0.0);
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    if (puff.w <= 0.0) continue;
    if (entry[k] < 1e8) normal += normalize(p + rd * (entry[k] - h.t) - puff.xyz) * exp(-(entry[k] - h.t) / (0.12 * reach[k]));
    if (k != h.front) h.crease += smoothstep(1.45, 0.95, length(p - puff.xyz) / puff.w);
  }
  h.normal = normalize(normal);
  h.crease = min(h.crease, 1.0);
  return h;
}

// A cloud seen along a ray: premultiplied colour and coverage. Lit white
// where the sun reaches a lobe, blue-grey where it turns away or the puffs
// above shade it, deeper in the creases and toward the flat base, which
// takes a little of the meadow's green; a silver rim where the sun shines
// through the edge.
vec4 shadeCloud(Cloud cl, vec4 puffs[PUFFS], vec4 shadowA, vec4 shadowB, vec3 ro, vec3 rd, bool mirror, float pixelAngle, out float tFront) {
  CloudHit h = traceCloud(cl, puffs, shadowA, shadowB, ro, rd, mirror, pixelAngle);
  tFront = h.t;
  if (h.front < 0) return vec4(0.0);
  vec3 p = ro + rd * h.t;
  vec3 n = h.normal;
  float size = cl.size;
  float height = clamp(dot(p - cl.basePoint, cl.baseNormal) / (1.1 * size), 0.0, 1.0);

  // the base thins away where the ray only grazes it (seen from below it stays solid)
  float alpha = h.cover * mix(smoothstep(0.0, 0.35 * size, h.thick), 1.0, smoothstep(0.05, 0.3, height));
  alpha *= smoothstep(0.0, 0.35, cloudFade(cl));
  if (alpha <= 0.0) return vec4(0.0);

  // the lumps where the ray meets the front lobe: they shift the light's edge and line the creases
  float lump = mirror ? 0.0 : puffLumps(normalize(p - h.frontCentre), lumpSeed(cl.seed, h.front));
  float ndl = dot(n, uSunDir);
  // (the lakes paint the clouds they mirror luminous: their undersides are lit as if by the water's glare)
  float sun = mirror ? smoothstep(-0.95, 0.3, ndl) : smoothstep(-0.12, 0.32, ndl + 0.16 * lump) * (1.0 - h.shadow * smoothstep(-0.2, 0.5, ndl));
  float sky = clamp(0.62 + 0.38 * dot(n, cl.baseNormal), 0.0, 1.0) * (1.0 - 0.32 * h.crease) * mix(0.86, 1.0, smoothstep(-1.0, 0.4, lump));
  vec3 shade = mix(pal(ROW_CLOUD, 1), pal(ROW_CLOUD, 4), (1.0 - smoothstep(0.0, 0.45, height)) * 0.55);
  vec3 col = mix(shade * mix(0.86, 1.03, sky), mix(pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 0), smoothstep(0.0, 0.45, ndl)), sun);
  col = mix(col, pal(ROW_CLOUD, 3), sun * smoothstep(0.45, 0.95, ndl) * 0.6);
  // silver rim where the sun shines through the thin edge
  float behind = pow(max(dot(rd, uSunDir), 0.0), 3.0);
  float edge = pow(1.0 - abs(dot(n, rd)), 3.0);
  col += pal(ROW_CLOUD, 3) * edge * behind * 0.5;
  return vec4(col * alpha, alpha);
}

// The reflecting clouds along a ray (view space), composited nearest the
// camera first: premultiplied colour and coverage. For the lakes' mirror.
vec4 cloudsAlong(vec3 ro, vec3 rd, float pixelAngle) {
  vec4 acc = vec4(0.0);
  int count = int(uCloudLook.w);
  for (int i = 0; i < MAX_REFLECTED; i++) {
    if (i >= count || acc.a > 0.98) break;
    vec4 b = texelFetch(uCloudData, ivec2(0, i), 0);
    vec3 oc = warpPosition(b.xyz) - ro;
    float reach = warpedReach(b.xyz, b.w);
    float tc = dot(oc, rd);
    if (tc < -reach || dot(oc, oc) - tc * tc > reach * reach) continue;
    Cloud cl = loadCloud(i);
    if (cloudFade(cl) <= 0.0) continue;
    vec4 puffs[PUFFS];
    loadPuffs(i, puffs);
    float t;
    acc += shadeCloud(cl, puffs, vec4(0.0), vec4(0.0), ro, rd, true, pixelAngle, t) * (1.0 - acc.a);
  }
  return acc;
}

// 0..1 cloud shadow at a point (planet space, m): the optical depth toward
// the sun from the shadow map. edge: noise in [-1, 1] that roughens the
// outline (the paint passes its brushstrokes, so shadow edges look brushed).
float cloudShadowAt(vec3 p, float edge) {
  vec2 uv = vec2(dot(p, uCloudSunA.xyz), dot(p, uCloudSunB.xyz)) * uCloudSunA.w * 0.5 + 0.5;
  float tau = textureLod(uCloudShadowMap, uv, 0.0).r;
  float s = 1.0 - exp(-tau * uCloudLook.y * (1.0 + 0.45 * edge));
  return smoothstep(0.1, 0.5, s) * uCloudLook.x;
}
