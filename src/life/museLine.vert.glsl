// Muse's fishing line (museProps.ts): points in planet space, warped.
#include <meadow_common>
#include <meadow_warp>
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(warpPosition((modelMatrix * vec4(position, 1.0)).xyz), 1.0);
}
