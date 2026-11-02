// A tree, traced (trees.ts): a crown of five lumpy spheres heaped on a
// trunk, lit in soft toon bands, darker low in the crown and toward its
// outline (a painted edge), each tree a little its own green; then the haze.
// Writes the depth of what it hit, so the ground and the other trees sort
// with it.
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
uniform float uRadius;
#include <meadow_toon>
#include <meadow_fog>
#include <terraces_common>
#include <terraces_fog>

uniform mat4 uProjection;

varying vec3 vPoint;
flat varying vec3 vGround;
flat varying vec3 vUp;
flat varying vec4 vShape;

// The nearest hit of a ray with a lumpy sphere (centre c, radius r): its distance, or -1.
float lumpHit(vec3 ro, vec3 rd, vec3 c, float r, float seed) {
  vec3 oc = ro - c;
  float bq = dot(oc, rd);
  vec3 closest = oc - rd * bq;
  vec3 n = normalize(closest + 1e-5);
  float lumps = sin(n.x * 6.0 + seed * 40.0) * sin(n.y * 7.0 + seed * 23.0) * sin(n.z * 6.5 + seed * 17.0);
  float re = r * (1.0 + 0.1 * lumps);
  float disc = bq * bq - dot(oc, oc) + re * re;
  if (disc < 0.0) return -1.0;
  float t = -bq - sqrt(disc);
  return t > 0.0 ? t : -1.0;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPoint - ro);
  float rc = vShape.x;
  float H = vShape.y;
  float seed = vShape.z;
  vec3 U = normalize(vUp);
  vec3 S1 = normalize(cross(U, abs(U.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 S2 = cross(U, S1);
  vec3 crown = vGround + U * (H - rc);
  // the crown's lumps: one high, three round it, one low
  float best = 1e9;
  vec3 bc = crown;
  float br = rc;
  for (int k = 0; k < 5; k++) {
    float a = seed * 6.2831 + float(k) * 2.2;
    vec3 c;
    float r;
    if (k == 0) {
      c = crown + U * (0.28 * rc);
      r = 0.74 * rc;
    } else if (k < 4) {
      c = crown + (S1 * cos(a) + S2 * sin(a)) * (0.5 * rc) - U * (0.12 * rc);
      r = 0.58 * rc;
    } else {
      c = crown - U * (0.42 * rc) + (S1 * cos(a + 1.0) + S2 * sin(a + 1.0)) * (0.2 * rc);
      r = 0.52 * rc;
    }
    float t = lumpHit(ro, rd, c, r, seed + float(k) * 0.13);
    if (t > 0.0 && t < best) {
      best = t;
      bc = c;
      br = r;
    }
  }
  vec3 col;
  vec3 hit;
  if (best < 1e8) {
    hit = ro + rd * best;
    vec3 n = normalize(hit - bc);
    float b = toonLight(dot(n, uSunDir));
    float tint = fract(seed * 9.73);
    vec3 lit = mix(pal(TR_FOREST, 0), pal(TR_FOREST, 8), tint * 0.6);
    vec3 mid = mix(pal(TR_FOREST, 1), pal(TR_FOREST, 7), tint * 0.5);
    col = tone3(lit, mid, pal(TR_FOREST, 2), b);
    // darker low in the crown, and a painted edge toward the outline
    float low = clamp(dot(hit - crown, U) / rc * 0.5 + 0.5, 0.0, 1.0);
    col *= mix(0.62, 1.0, low);
    col = mix(pal(TR_FOREST, 3), col, smoothstep(0.08, 0.42, dot(n, -rd)));
  } else {
    // the trunk: a thin cylinder up the tree's axis to the crown
    vec3 oc = ro - vGround;
    vec3 rp = rd - U * dot(rd, U);
    vec3 op = oc - U * dot(oc, U);
    float rt = 0.13 * rc / 2.0 + 0.06;
    float A = dot(rp, rp);
    float B = dot(rp, op);
    float C = dot(op, op) - rt * rt;
    float disc = B * B - A * C;
    if (disc < 0.0 || A < 1e-8) discard;
    float t = (-B - sqrt(disc)) / A;
    float y = dot(oc + rd * t, U);
    if (t <= 0.0 || y < 0.0 || y > H - rc) discard;
    hit = ro + rd * t;
    col = pal(TR_FOREST, 5) * mix(0.55, 0.9, smoothstep(-0.2, 0.6, dot(normalize(rp * t + op), uSunDir)));
  }
  vec3 planet = unwarpPosition(hit);
  col = applyAerial(col, length(hit - ro), normalize(planet));
  col = applyHeightFog(col, length(hit - ro), length(planet) - uRadius, normalize(planet));
  gl_FragColor = vec4(col, 1.0);
  vec4 clip = uProjection * viewMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
