// A tree of the forest (trees.ts): where the terraces' build placed it, on
// its ground, sized by its seed; one camera-facing billboard in front of its
// bounding sphere, which covers the sphere's outline on screen. The fragment
// shader traces the tree itself.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute vec4 aTree;  // direction, its ground (m)
attribute float aSeed; // [0, 1)

varying vec3 vPoint;        // on the billboard, view space
flat varying vec3 vGround;  // the trunk's foot, view space
flat varying vec3 vUp;      // the tree's up, view space
flat varying vec4 vShape;   // crown radius (m), height (m), seed, the share of rock

void main() {
  vPoint = vec3(0.0);
  vec3 dir = aTree.xyz;
  float size = mix(0.72, 1.28, fract(aSeed * 3.97));
  float rc = 1.9 * size;
  // low crowns: in a wood the trunks hide under the canopy
  float H = mix(3.4, 5.6, fract(aSeed * 5.3)) * size;
  float ground = aTree.w;
  vec3 foot = dir * (uRadius + ground - 0.3);
  vec3 mid = dir * (uRadius + ground + 0.5 * H);
  vec3 g = warpPosition(foot);
  vec3 m = warpPosition(mid);
  vec3 up = warpNormal(mid, dir);
  float r = sqrt(0.25 * H * H + 2.4 * rc * rc);
  // the billboard: in front of the bounding sphere, facing the camera, as wide as its outline
  vec3 toCam = cameraPosition - m;
  float d = length(toCam);
  vec3 f = toCam / max(d, 1e-4);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 camUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
  float dq = max(d - r, 1.5 * near);
  float half_ = d > r * 1.02 ? 1.04 * r * dq / sqrt(d * d - r * r) : 4.0 * dq;
  vec3 c = cameraPosition - f * dq;
  vPoint = c + (right * position.x + camUp * position.y) * half_;
  vGround = g;
  vUp = up;
  vShape = vec4(rc, H, aSeed, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPoint, 1.0);
}
