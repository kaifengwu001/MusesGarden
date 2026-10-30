// Low cumulus (clouds.ts): each cloud is PUFFS soft spheres heaped over a flat
// base, drifting with the wind a few meters above the meadow. One row of
// uCloudData per cloud, nearest the camera first:
//   texel 0      bounding sphere: centre (planet space, m), radius (m)
//   texel 1      base: cloud up (unit), distance of the base from the planet centre (m)
//   texel 2      noise seed, -, -, -
//   texels 3..   puffs: centre (planet space, m), radius (m; 0 = unused)
// Everything that shows a cloud reads these same puffs, so a cloud, its
// shadow and its reflection always agree:
//   the cloud itself     cloud.frag.glsl, one billboard per cloud
//   its shadow           a sun-space map of optical depth (cloudShadow.*.glsl)
//   its reflection       cloudsAlong() on the ray mirrored off the water
// Rays are traced in view space (the tiny-planet warp moves each puff with
// the ground under it). Requires: noise, toon (palette), warp.
#define MAX_CLOUDS 128
#define PUFFS 8
#define MAX_REFLECTED 10
uniform highp sampler2D uCloudData;
uniform sampler2D uCloudShadowMap;
uniform vec4 uCloudSunA;  // sun-space axis A (xyz), 1 / half-extent of the shadow map (1/m)
uniform vec4 uCloudSunB;  // sun-space axis B (xyz), -
uniform vec4 uCloudLook;  // shadow strength, optical density (1/m), clouds, clouds that reflect
uniform float uTime;

// One cloud's frame in view space: bounding sphere, base plane (point, normal).
struct Cloud {
  vec3 centre;
  float radius;
  vec3 basePoint;
  vec3 baseNormal;
  uint seed;
};

// A bounding radius that still holds after the warp: puffs farther out from
// the focus drop more than the centre does.
float warpedReach(vec3 centre, float radius) {
  vec3 t = warpTangent(centre);
  return radius + abs(uWarpK) * (2.0 * length(t) * radius + radius * radius);
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
  c.seed = uint(texelFetch(uCloudData, ivec2(2, row), 0).x);
  return c;
}

// A cloud's puffs in view space: centre, radius (0 = unused).
void loadPuffs(int row, out vec4 puffs[PUFFS]) {
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = texelFetch(uCloudData, ivec2(3 + k, row), 0);
    puffs[k] = vec4(warpPosition(puff.xyz), puff.w);
  }
}

// Optical depth of a cloud along a ray (view space), where the ray first
// enters it, and a normal: each puff's at its entry, weighted by how much of
// the depth it gives (so shading flows across the heap, never steps at a puff's edge).
struct CloudTrace {
  float tau;
  float tFront;
  vec3 normal;
};

CloudTrace traceCloud(Cloud cl, vec4 puffs[PUFFS], vec3 ro, vec3 rd) {
  CloudTrace tr;
  tr.tau = 0.0;
  tr.tFront = 1e9;
  tr.normal = cl.baseNormal;
  vec3 normal = vec3(0.0);
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    if (puff.w <= 0.0) continue;
    vec3 c = puff.xyz;
    vec3 oc = c - ro;
    float tc = dot(oc, rd);
    float r2 = puff.w * puff.w;
    float d2 = dot(oc, oc) - tc * tc;
    if (d2 >= r2) continue;
    float half_ = sqrt(r2 - d2);
    float t0 = max(tc - half_, 0.0);
    float t1 = tc + half_;
    if (t1 <= t0) continue;
    // thinner toward each puff's rim, and fading out under the flat base,
    // so the heap has soft edges and a soft, level underside
    float rim = 1.0 - d2 / r2;
    float lift = dot(ro + rd * tc - cl.basePoint, cl.baseNormal) / puff.w;
    float tau = (t1 - t0) * rim * rim * smoothstep(-0.35, 0.25, lift);
    tr.tau += tau;
    normal += (ro + rd * t0 - c) / puff.w * tau;
    tr.tFront = min(tr.tFront, t0);
  }
  if (tr.tau > 0.0) tr.normal = normalize(normal);
  return tr;
}

// A cloud seen along a ray: premultiplied colour and coverage. Lit white on
// top, blue-grey underneath and toward the flat base, lumpy at the edges
// (billows: 1 for the clouds themselves, 0 in the lakes' mirror, where the
// ripples soften them anyway), with a silver rim where the sun shines through.
vec4 shadeCloud(Cloud cl, vec4 puffs[PUFFS], vec3 ro, vec3 rd, float billows, out float tFront) {
  CloudTrace tr = traceCloud(cl, puffs, ro, rd);
  tFront = tr.tFront;
  if (tr.tau <= 0.0) return vec4(0.0);
  vec3 p = ro + rd * tr.tFront;
  // billows: noise that travels with the cloud and slowly churns
  vec3 q = (p - cl.centre) / cl.radius;
  float n = billows > 0.0 ? gnoise(q * 3.2 + vec3(0.0, uTime * 0.025, 0.0), cl.seed) : 0.0;
  // billows eat into the thin edges; a cloud the camera is in (or nearly)
  // thins away rather than fogging the view
  float alpha = 1.0 - exp(-tr.tau * uCloudLook.y);
  alpha = smoothstep(0.12 + 0.3 * n, 0.85, alpha) * smoothstep(3.0, 16.0, distance(cameraPosition, cl.centre) - 0.6 * cl.radius);
  if (alpha <= 0.0) return vec4(0.0);

  // white where the sun and the sky reach, soft blue-grey low down and away from the sun
  float height = clamp(dot(p - cl.basePoint, cl.baseNormal) / cl.radius, 0.0, 1.0);
  float lit = smoothstep(-0.7, 0.85, dot(tr.normal, uSunDir) * 0.55 + height * 0.75 - 0.1 + 0.22 * n);
  vec3 col = tone3(pal(ROW_CLOUD, 0), pal(ROW_CLOUD, 2), pal(ROW_CLOUD, 1), lit);
  // the base takes the green of the meadow below
  col = mix(col, pal(ROW_CLOUD, 4), (1.0 - smoothstep(0.0, 0.25, height)) * 0.45);
  // silver rim where the sun shines through the thin edge
  float behind = pow(max(dot(rd, uSunDir), 0.0), 3.0);
  col += pal(ROW_CLOUD, 3) * (1.0 - alpha) * behind * 0.7;
  return vec4(col * alpha, alpha);
}

// The reflecting clouds along a ray (view space), composited nearest the
// camera first: premultiplied colour and coverage. For the lakes' mirror.
vec4 cloudsAlong(vec3 ro, vec3 rd) {
  vec4 acc = vec4(0.0);
  int count = int(uCloudLook.w);
  for (int i = 0; i < MAX_REFLECTED; i++) {
    if (i >= count || acc.a > 0.98) break;
    vec4 b = texelFetch(uCloudData, ivec2(0, i), 0);
    vec3 oc = warpPosition(b.xyz) - ro;
    float reach = warpedReach(b.xyz, b.w);
    float tc = dot(oc, rd);
    if (tc < -reach || dot(oc, oc) - tc * tc > reach * reach) continue;
    vec4 puffs[PUFFS];
    loadPuffs(i, puffs);
    float t;
    acc += shadeCloud(loadCloud(i), puffs, ro, rd, 0.0, t) * (1.0 - acc.a);
  }
  return acc;
}

// 0..1 cloud shadow at a point (planet space, m): the optical depth toward
// the sun from the shadow map. edge: noise in [-1, 1] that roughens the
// outline (the paint passes its brushstrokes, so shadow edges look brushed).
float cloudShadowAt(vec3 p, float edge) {
  vec2 uv = vec2(dot(p, uCloudSunA.xyz), dot(p, uCloudSunB.xyz)) * uCloudSunA.w * 0.5 + 0.5;
  float tau = textureLod(uCloudShadowMap, uv, 0.0).r;
  float s = 1.0 - exp(-tau * uCloudLook.y * 0.8 * (1.0 + 0.6 * edge));
  return smoothstep(0.08, 0.7, s) * uCloudLook.x;
}
