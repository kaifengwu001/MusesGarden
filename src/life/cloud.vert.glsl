// One billboard per cloud (clouds.ts), drawn farthest first: a quad in front
// of the cloud's bounding sphere, sized to cover it as seen from the camera
// (or the whole view when the camera is inside it). The fragment shader
// traces the puffs (clouds.glsl).
#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_clouds>

varying vec3 vPoint; // on the billboard, view space
flat varying int vRow;

void main() {
  int row = int(uCloudLook.z) - 1 - gl_InstanceID;
  vRow = row;
  vPoint = vec3(0.0);
  if (row < 0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec4 b = texelFetch(uCloudData, ivec2(0, row), 0);
  vec3 c = warpPosition(b.xyz);
  float r = warpedReach(b.xyz, b.w);
  vec3 toCam = cameraPosition - c;
  float dist = length(toCam);
  float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 back;
  float d;
  float half_;
  if (dist > r * 1.02) {
    back = toCam / dist;
    d = max(dist - r, 2.0 * near);
    half_ = d * r / sqrt(dist * dist - r * r) * 1.02;
  } else {
    back = camBack;
    d = 2.0 * near;
    half_ = d * 8.0;
  }
  vec3 right = normalize(cross(camUp, back));
  vec3 up = cross(back, right);
  vPoint = cameraPosition - back * d + (right * position.x + up * position.y) * half_;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPoint, 1.0);
}
