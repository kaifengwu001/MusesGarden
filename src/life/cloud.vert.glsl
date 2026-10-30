// One billboard per cloud (clouds.ts), drawn farthest first: a quad just in
// front of the camera, fitted to the cloud's puffs on screen. The fragment
// shader reads the cloud again by its row (a handful of cached texels beats
// a dozen flat varyings per pixel) and traces it (clouds.glsl).
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_clouds>

varying vec3 vPoint; // on the billboard, view space
flat varying int vRow;

// The extent along one screen axis (a / -z) of a sphere in camera space,
// centre c = (a, z), clipped to z < nearZ (after Mara and McGuire, 2D
// polyhedral bounds of a clipped, perspective-projected 3D sphere, 2013).
vec2 sphereBounds(vec2 c, float r, float nearZ) {
  float t2 = dot(c, c) - r * r;
  bool inside = t2 <= 0.0;
  vec2 v = inside ? vec2(0.0) : vec2(sqrt(t2), r) / length(c);
  bool clipSphere = c.y + r >= nearZ;
  float k = sqrt(max(r * r - (c.y - nearZ) * (c.y - nearZ), 0.0));
  vec2 b[2];
  for (int i = 0; i < 2; i++) {
    if (!inside) b[i] = mat2(v.x, -v.y, v.y, v.x) * c * v.x;
    else b[i] = vec2(0.0, nearZ);
    if (clipSphere && (inside || b[i].y > nearZ)) b[i] = vec2(c.x + k, nearZ);
    v.y = -v.y;
    k = -k;
  }
  float p0 = b[0].x / -b[0].y;
  float p1 = b[1].x / -b[1].y;
  return vec2(min(p0, p1), max(p0, p1));
}

void main() {
  int row = int(uCloudLook.z) - 1 - gl_InstanceID;
  vPoint = vec3(0.0);
  if (row < 0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
#ifndef MIRROR_PASS
  // a cloud the ground hides from the camera (clouds.ts) casts its shadow and shows in the water, but is not drawn
  if (texelFetch(uCloudData, ivec2(2, row), 0).z < 0.5) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
#endif
  Cloud cl = loadCloud(row);
  // a cloud the camera is in has thinned away (cloudFade): nothing to draw
  if (cloudFade(cl) < 0.02) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vRow = row;
  vec4 puffs[PUFFS];
  loadPuffs(row, puffs);

  // the puffs' extent on screen: each puff's exact projected bounds, clipped
  // to the near plane (sphereBounds), clamped to the view, so a cloud above
  // or beside the frame costs nothing however close it is
  mat3 rot = mat3(viewMatrix);
  float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
  vec2 view = vec2(1.0 / projectionMatrix[0][0], 1.0 / projectionMatrix[1][1]) * 1.02;
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  for (int k = 0; k < PUFFS; k++) {
    vec4 puff = puffs[k];
    if (puff.w <= 0.0) continue;
    float r = puff.w * (1.0 + 1.5 * CLOUD_LUMPS);
    vec3 c = rot * (puff.xyz - cameraPosition);
    if (c.z - r > -near) continue;
    vec2 bx = sphereBounds(vec2(c.x, c.z), r, -near);
    vec2 by = sphereBounds(vec2(c.y, c.z), r, -near);
    lo = min(lo, vec2(bx.x, by.x));
    hi = max(hi, vec2(bx.y, by.y));
  }
  lo = max(lo, -view);
  hi = min(hi, view);
  if (lo.x >= hi.x || lo.y >= hi.y) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float d = 2.0 * near;
  vec3 onPlane = vec3(mix(lo, hi, position.xy * 0.5 + 0.5) * d, -d);
  vPoint = cameraPosition + transpose(rot) * onPlane;
  gl_Position = projectionMatrix * vec4(onPlane, 1.0);
}
