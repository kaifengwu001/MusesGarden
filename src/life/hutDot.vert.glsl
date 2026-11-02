// Muse's favourites on its shelf (hut.ts), as the finds are seen from high
// up (findSphere.vert.glsl): each a soft light a steady size on screen in
// its topic's colour, standing just in front of its place on the shelf,
// bent round the planet and warped with the room. The one under the pointer
// lifts and brightens, the one whose card is up is brighter still; they
// breathe a little, each in its own time.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uPixelAngle;
uniform float uTime;
uniform float uShown;     // 0..1 as the room opens (the showpiece's dot) or the shelf comes near (the favourites')
uniform float uDotSize;   // how big on screen (a share of the view's height)
uniform float uDotGain;   // how bright

attribute vec3 aColour;
attribute vec2 aState;    // under the pointer, card up (0..1)
varying vec3 vColour;

void main() {
  vec3 X = normalize(modelMatrix[0].xyz);
  vec3 U = normalize(modelMatrix[1].xyz);
  vec3 Z = normalize(modelMatrix[2].xyz);
  float ground = length(modelMatrix[3].xyz);
  vec3 local = position + vec3(0.0, 0.03 * aState.x, 0.0);
  vec2 h = local.xz;
  float d = length(h);
  float angle = asin(min(d / uRadius, 1.0));
  vec3 T = d > 1e-5 ? (X * h.x + Z * h.y) / d : X;
  vec3 up = U * cos(angle) + T * sin(angle);
  vec3 world = up * (ground + local.y);
  float lit = max(aState.x, aState.y);
  float breathe = 0.5 + 0.5 * sin(uTime * 1.7 + float(gl_VertexID) * 2.1);
  float view = 2.0 / (projectionMatrix[1][1] * uPixelAngle);
  float shown = smoothstep(0.35, 0.9, uShown);
  gl_PointSize = min(view * uDotSize * (1.0 + 0.45 * lit) * (0.94 + 0.08 * breathe), 120.0) * shown;
  vColour = aColour * uDotGain * (0.75 + 0.6 * lit + 0.12 * breathe) * shown;
  gl_Position = projectionMatrix * viewMatrix * vec4(warpPosition(world), 1.0);
}
