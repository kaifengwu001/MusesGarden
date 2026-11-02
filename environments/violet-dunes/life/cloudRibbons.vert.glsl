#include <meadow_warp>
uniform float uCirrusRadius;
uniform mat3 uCirrusRotation;
attribute vec3 aRibbon;
varying vec3 vRibbon;
flat varying float vCloudPhase;
varying float vCloudDistance;
void main() {
  vec3 cloudDir = normalize(uCirrusRotation * position);
  vec3 warped = warpPosition(cloudDir * uCirrusRadius);
  vCloudDistance = length(warped - cameraPosition);
  vRibbon = aRibbon;
  vCloudPhase = aRibbon.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(warped, 1.0);
}
