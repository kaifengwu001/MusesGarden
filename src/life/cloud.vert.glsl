// One billboard per cloud (clouds.ts), drawn farthest first: a quad in front
// of the cloud, fitted to its puffs as seen from the camera (or covering the
// whole view when the camera is inside it). The cloud's frame and its puffs
// go to the fragment shader as flat varyings, read and warped once here, and
// the fragment shader traces them (clouds.glsl).
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_clouds>

varying vec3 vPoint; // on the billboard, view space
flat varying vec4 vCloudA; // centre (view space), bounding radius
flat varying vec4 vCloudB; // base point (view space), noise seed
flat varying vec3 vCloudC; // base normal (view space)
flat varying vec4 vPuffs[PUFFS];

void main() {
  int row = int(uCloudLook.z) - 1 - gl_InstanceID;
  vPoint = vec3(0.0);
  if (row < 0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  Cloud cl = loadCloud(row);
  vCloudA = vec4(cl.centre, cl.radius);
  vCloudB = vec4(cl.basePoint, float(cl.seed));
  vCloudC = cl.baseNormal;
  loadPuffs(row, vPuffs);

  vec3 toCam = cameraPosition - cl.centre;
  float dist = length(toCam);
  float r = cl.radius;
  float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 back = dist > r * 1.02 ? toCam / dist : camBack;
  vec3 right = normalize(cross(camUp, back));
  vec3 up = cross(back, right);
  vec2 lo = vec2(-1.0);
  vec2 hi = vec2(1.0);
  float d;
  if (dist > r * 1.02) {
    // the puffs' extent on a plane in front of the cloud
    d = max(dist - r, 2.0 * near);
    lo = vec2(1e9);
    hi = vec2(-1e9);
    bool behind = false;
    for (int k = 0; k < PUFFS; k++) {
      vec4 puff = vPuffs[k];
      if (puff.w <= 0.0) continue;
      vec3 rel = puff.xyz - cameraPosition;
      float depth = -dot(rel, back);
      if (depth < puff.w + near) {
        behind = true;
        break;
      }
      vec2 at = vec2(dot(rel, right), dot(rel, up)) * (d / depth);
      float rad = puff.w * d / sqrt(max(depth * depth - puff.w * puff.w, 1e-4)) * 1.08;
      lo = min(lo, at - rad);
      hi = max(hi, at + rad);
    }
    if (behind) {
      float half_ = d * r / sqrt(dist * dist - r * r) * 1.02;
      lo = vec2(-half_);
      hi = vec2(half_);
    }
  } else {
    d = 2.0 * near;
    lo = vec2(-d * 8.0);
    hi = vec2(d * 8.0);
  }
  vec2 xy = mix(lo, hi, position.xy * 0.5 + 0.5);
  vPoint = cameraPosition - back * d + right * xy.x + up * xy.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPoint, 1.0);
}
