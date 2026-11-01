#include <meadow_warp>
uniform float uRadius;
attribute vec4 aAnchor;
attribute vec3 aAcross;
attribute vec4 aPlacement;
attribute float aGround;
attribute float aFootDepth;
varying vec3 vWorld;
varying vec3 vPlanet;

void main() {
  vec3 up = normalize(aAnchor.xyz);
  vec3 across = normalize(aAcross);
  vec3 forward = normalize(cross(across, up));
  vec3 p = position * aPlacement.x;
  p.y -= aGround * aFootDepth;
  float distanceFromAnchor = length(p.xz);
  float angle = asin(min(distanceFromAnchor / uRadius, 0.9));
  vec3 tangent = distanceFromAnchor > 1e-5
    ? (across * p.x + forward * p.z) / distanceFromAnchor
    : across;
  vec3 surfaceUp = up * cos(angle) + tangent * sin(angle);
  vPlanet = surfaceUp * (uRadius + aAnchor.w + p.y);
  vWorld = warpPosition(vPlanet);
  vec4 viewPosition = viewMatrix * vec4(vWorld, 1.0);
  // Pull the ink five millimetres toward the camera. This keeps lines on the
  // stone's own edges without a large distance-dependent depth bias.
  viewPosition.xyz -= normalize(viewPosition.xyz) * 0.005;
  gl_Position = projectionMatrix * viewPosition;
}
