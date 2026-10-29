// Tiny-planet perspective warp. Included by EVERY vertex shader (terrain,
// water, grass, flowers, props, outlines, clouds, shadow pass) and mirrored on
// the CPU in warp.ts; change both together.
//
// Around the focus point F (on the surface, local up U), each position is
// pulled down along U by k·|t|², where t is its tangent offset from F and
// k = w·(1/(2R_v) − 1/(2R)). The surface near F then curves like a sphere of
// radius R_v instead of R, so the horizon rolls away like a small world at any
// true size. w blends 0 (Overview, true sphere) → 1 (Wander).

uniform vec3 uWarpFocus;
uniform vec3 uWarpUp;
uniform float uWarpK;

vec3 warpTangent(vec3 p) {
  vec3 rel = p - uWarpFocus;
  return rel - dot(rel, uWarpUp) * uWarpUp;
}

// Planet space → view space.
vec3 warpPosition(vec3 p) {
  vec3 t = warpTangent(p);
  return p - uWarpK * dot(t, t) * uWarpUp;
}

// Normals follow the bent surface: N' = N + 2k (U·N) t (inverse-transpose of
// the warp's Jacobian), so lighting and rims match the curvature you see.
vec3 warpNormal(vec3 p, vec3 n) {
  vec3 t = warpTangent(p);
  return normalize(n + 2.0 * uWarpK * dot(uWarpUp, n) * t);
}
