// Low cumulus (clouds.ts): each cloud is PUFFS lumpy spheres heaped over a
// flat base, drifting with the wind a few meters above the meadow. One row of
// uCloudData per cloud, nearest the camera first:
//   texel 0      bounding sphere: centre (planet space, m), radius (m)
//   texel 1      base: cloud up (unit), distance of the base from the planet centre (m)
//   texel 2      noise seed, size (m: the heap is about this tall), in sight (0 or 1), -
//   texels 3..10 puffs: centre (planet space, m), radius (m; 0 = unused)
//   texels 11–12 the puffs' self-shadow toward the sun, 0..1, four a texel
// Everything that shows a cloud reads these same puffs, so a cloud, its
// shadow and its reflection always agree:
//   the cloud itself     cloud.frag.glsl, one billboard per cloud
//   its shadow           a cube map of optical depth where the shadows reach
//                        the ground, down the sun each place sees
//                        (cloudShadow.*.glsl), fixed to the planet
//   its reflection       near the ground, the same billboards drawn again
//                        from the camera mirrored in the water (clouds.ts;
//                        cloudsInMirror); from orbit, a cube map of the cloud
//                        cover seen from below (cloudsFromOrbit)
// A cloud is sculpted, not a fog: the puffs are solid, their outlines lumpy
// like a cauliflower (the same lumps in the cloud, its shadow and its
// mirror), lit lobe by lobe with soft creases where lobes meet and shadowed
// by the puffs between them and the sun. Rays are traced in view space (the
// tiny-planet warp moves each puff with the ground under it).
// Requires: noise, toon (palette), warp, uRadius.
#define MAX_CLOUDS 512
#define PUFFS 8
uniform highp sampler2D uCloudData;
uniform samplerCube uCloudShadowCube; // optical depth where the shadows reach the water table
uniform sampler2D uCloudShadowLocal;  // the same, sharper, over a window of one face about the focus
uniform mat3 uShadowLocalFace;        // that face's axes (columns: across, up, out)
uniform vec4 uShadowWindow;           // the window's centre on the face, 1 / its half-width (face units), on (0 or 1)
uniform samplerCube uCloudLayerCube;  // the cloud cover seen from below (optical depth)
uniform vec4 uCloudLook;  // shadow strength, optical density (1/m), clouds, -
uniform vec4 uCloudOrbit; // weight of the view from orbit in the lakes (0..1), mean height of the clouds (m), -, -
uniform vec3 uCloudEye;   // the camera (not the mirrored one): clouds dissolve around it
uniform sampler2D uCloudMirror; // the clouds seen from the camera mirrored in the water, premultiplied
uniform mat4 uCloudMirrorVP;    // that camera's view-projection
uniform vec4 uCloudMirrorExtent; // the part of it drawn this frame (uv, the render scale's), and the farthest a lookup may reach
#include <meadow_cloud_lumps>
#include <meadow_sun>

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
  return smoothstep(4.0, 18.0, distance(uCloudEye, cl.centre) - 0.6 * cl.radius);
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

// How much of the heap stands between each puff and the sun, 0 lit … 1 in
// the shade of the puffs above it (traced once per cloud, on the CPU).
void loadShadows(int row, out vec4 shadowA, out vec4 shadowB) {
  shadowA = texelFetch(uCloudData, ivec2(3 + PUFFS, row), 0);
  shadowB = texelFetch(uCloudData, ivec2(4 + PUFFS, row), 0);
}

// The cloud along a ray (view space). Each puff is a solid sphere with a
// lumpy outline; the silhouette is their union, antialiased over a pixel
// (pixelAngle: radians per pixel) or a little softer for big puffs.
// shadows: loadShadows() (zero in the mirror). mirror: in the lakes' mirror
// the outline is softer (the ripples blur it) and the shading plainer (it is
// traced per water pixel): the front lobe's own normal, no creases.
struct CloudHit {
  float cover;  // 0..1
  float t;      // where the ray meets the front surface
  vec3 normal;  // there, blended across the lobes that meet there
  float thick;  // chord through the heap (m)
  int front;    // the front puff
  vec3 frontCentre;
  float shadow; // the front puff's, from loadShadows()
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
  // Trace flattened cloud banks in a stretched coordinate frame. Centers,
  // rays, entry distances and normals use the same affine transform.
  vec3 cloudUp = cl.baseNormal;
  vec3 origin = cl.basePoint;
  ro += cloudUp * dot(ro - origin, cloudUp) * 3.0;
  rd += cloudUp * dot(rd, cloudUp) * 3.0;
  float rayScale = length(rd);
  rd /= rayScale;
  for (int i = 0; i < PUFFS; i++) puffs[i].xyz += cloudUp * dot(puffs[i].xyz - origin, cloudUp) * 3.0;
  float erode = 0.5 + 0.5 * cloudFade(cl);
  // where the ray is inside two puffs it is inside the heap, whatever their
  // lumps do (crease against crease would leave pinholes)
  int inner = 0;
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    puff.w *= erode;
    if (puff.w <= 0.0) continue;
    vec3 oc = puff.xyz - ro;
    float tc = dot(oc, rd);
    float d2 = max(dot(oc, oc) - tc * tc, 0.0);
    float rOut = puff.w * (1.0 + 1.5 * CLOUD_LUMPS);
    if (d2 >= rOut * rOut || tc < -puff.w) continue;
    float d = sqrt(d2);
    if (d < puff.w) inner++;
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
    h.thick += 2.0 * half_;
    h.cover = max(h.cover, cov);
    if (t0 < h.t) {
      h.t = t0;
      h.front = k;
      h.frontCentre = puff.xyz;
      h.shadow = k < 4 ? shadowA[k] : shadowB[k - 4];
    }
  }
  if (inner >= 2) {
    h.cover = 1.0;
    h.thick = max(h.thick, cl.size);
    // a pinhole: the front is the nearest of the plain spheres
    if (h.front < 0) {
      for (int k = 0; k < PUFFS; k++) {
        vec4 puff = puffs[k];
        puff.w *= erode;
        vec3 oc = puff.xyz - ro;
        float tc = dot(oc, rd);
        float d2 = dot(oc, oc) - tc * tc;
        if (puff.w <= 0.0 || d2 >= puff.w * puff.w) continue;
        float tb = max(tc - sqrt(puff.w * puff.w - d2), 0.0);
        if (tb < h.t) {
          h.t = tb;
          h.front = k;
          h.frontCentre = puff.xyz;
          h.shadow = k < 4 ? shadowA[k] : shadowB[k - 4];
        }
      }
    }
  }
  if (h.front < 0) return h;
  vec3 p = ro + rd * h.t;
  if (mirror) {
    vec3 normal = normalize(p - h.frontCentre);
    h.normal = normalize(normal + cloudUp * dot(normal, cloudUp) * 3.0);
    h.frontCentre -= cloudUp * dot(h.frontCentre - origin, cloudUp) * 0.75;
    h.t /= rayScale;
    h.thick /= rayScale;
    return h;
  }
  // lobes whose surfaces meet near the front blend their normals (soft
  // creases), and the puffs beside the front point darken it (deep creases).
  // The neighbours' entries are found again here (as plain spheres) rather
  // than kept from the first pass: fewer registers, a faster shader
  vec3 normal = normalize(p - h.frontCentre);
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    puff.w *= erode;
    if (puff.w <= 0.0 || k == h.front) continue;
    vec3 oc = puff.xyz - ro;
    float tc = dot(oc, rd);
    float d2 = dot(oc, oc) - tc * tc;
    if (d2 < puff.w * puff.w) {
      float ahead = max(tc - sqrt(puff.w * puff.w - d2) - h.t, 0.0);
      if (ahead < 0.6 * puff.w) normal += normalize(p + rd * ahead - puff.xyz) * exp(-ahead / (0.12 * puff.w));
    }
    h.crease += smoothstep(1.45, 0.95, length(p - puff.xyz) / puff.w);
  }
  h.normal = normalize(normal + cloudUp * dot(normal, cloudUp) * 3.0);
  h.frontCentre -= cloudUp * dot(h.frontCentre - origin, cloudUp) * 0.75;
  h.t /= rayScale;
  h.thick /= rayScale;
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

// The clouds mirrored at a point of the water (view space): premultiplied
// colour and coverage. The mirror pass sees the water's level plane from the
// mirrored camera, so the reflection at a pixel is that pixel of the pass
// (where the planet curves away from the plane, near enough); the wind's
// ruffle r (against the calm mirrored ray r0) moves the lookup aside, so the
// reflection ripples. screen: the pixel's place on screen, 0..1.
vec4 cloudsInMirror(vec3 wp, vec3 r, vec3 r0, vec2 screen) {
  vec4 a = uCloudMirrorVP * vec4(wp + r * 30.0, 1.0);
  vec4 b = uCloudMirrorVP * vec4(wp + r0 * 30.0, 1.0);
  vec2 shift = a.w > 0.0 && b.w > 0.0 ? (a.xy / a.w - b.xy / b.w) * 0.5 : vec2(0.0);
  vec2 uv = clamp(screen + shift, vec2(0.0), vec2(1.0));
  return textureLod(uCloudMirror, min(uv * uCloudMirrorExtent.xy, uCloudMirrorExtent.zw), 0.0);
}

// The clouds a lake mirrors when seen from far above, where the one mirror
// plane of the mirror pass cannot follow the planet's curve: the cloud cover
// from below, looked up where the mirrored ray r (from the water point wp,
// view space) meets the clouds' mean height. Premultiplied colour and
// coverage, lit as the lakes paint their clouds.
vec4 cloudsFromOrbit(vec3 wp, vec3 r) {
  vec3 p = unwarpPosition(wp);
  float top = uRadius + uCloudOrbit.y;
  float b = dot(p, r);
  float t = -b + sqrt(max(b * b - dot(p, p) + top * top, 0.0));
  float tau = textureLod(uCloudLayerCube, normalize(p + r * t), 0.0).r;
  float a = smoothstep(0.08, 0.6, 1.0 - exp(-tau * uCloudLook.y));
  return vec4(mix(pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 0), 0.65) * a, a);
}

// 0..1 cloud shadow at a point (planet space, m). The maps hold where the
// shadows reach the water table, so a point above it looks up where its own
// sun ray, carried on down, would reach it: in the sharper window about the
// focus where it covers the point, otherwise in the cube map. edge: noise in [-1, 1] that
// roughens the outline (the paint passes its brushstrokes, so shadow edges
// look brushed).
float cloudShadowAt(vec3 p, float edge) {
  float r = length(p);
  vec3 d = p / r;
  vec3 sun = localSun(d);
  float sinE = max(dot(sun, d), 0.2);
  vec3 q = normalize(d + (d * sinE - sun) * ((r - uRadius) / (sinE * uRadius)));
  // near the focus, the sharper window (the two agree but for sharpness, and blend at its rim);
  // well inside it the cube map is not read at all (the grass and the flowers are all in there)
  float inside = 0.0;
  vec2 xy = vec2(0.0);
  if (uShadowWindow.w > 0.0) {
    vec3 f = q * uShadowLocalFace;
    if (f.z > 0.0) {
      xy = (f.xy / f.z - uShadowWindow.xy) * uShadowWindow.z;
      inside = 1.0 - smoothstep(0.82, 0.96, max(abs(xy.x), abs(xy.y)));
    }
  }
  float tau = inside >= 1.0 ? 0.0 : textureLod(uCloudShadowCube, q, 0.0).r;
  if (inside > 0.0) tau = mix(tau, textureLod(uCloudShadowLocal, xy * 0.5 + 0.5, 0.0).r, inside);
  float s = 1.0 - exp(-tau * uCloudLook.y * (1.0 + 0.45 * edge));
  return smoothstep(0.1, 0.5, s) * uCloudLook.x;
}
