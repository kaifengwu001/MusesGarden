// The homestead (props.ts): placed in its local frame and bent round the
// planet like the ground under it, so on a small planet every wall stands
// square to the ground and the roof spreads a little, the way buildings on a
// tiny planet are drawn; then warped like everything else. A point's local x
// and z land where the terrain's cottage-local meters put them
// (cottageLocal: the sine of the angle from the cottage, times R), so the
// house, its terrace and its pier sit exactly on their clearing and their
// pond, and the water's mirror finds them there (water.glsl); y is the
// height above the clearing.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute vec4 aPaint; // per kind: see props.ts Paint

varying vec3 vNormal;      // warped world
varying vec3 vWorld;
varying vec2 vUv;          // meters on the face
varying vec3 vLocal;       // the homestead's frame (m), before bending
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;      // planet space, unwarped (the sun each place sees, the clouds' shadows)
varying vec3 vPlanetNormal;
varying vec3 vUp;          // the local up where this point stands, planet space

vec3 turn(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  // the frame: across, up, toward the pond; its origin on the clearing, the planet's centre at the world's origin
  vec3 X = normalize(modelMatrix[0].xyz);
  vec3 U = normalize(modelMatrix[1].xyz);
  vec3 Z = normalize(modelMatrix[2].xyz);
  float ground = length(modelMatrix[3].xyz);
  // out over the surface toward the point, as far as the terrain's meters say, then up by its height
  vec2 h = position.xz;
  float d = length(h);
  float angle = asin(min(d / uRadius, 1.0));
  vec3 T = d > 1e-5 ? (X * h.x + Z * h.y) / d : X;
  vec3 axis = normalize(cross(U, T));
  vec3 up = U * cos(angle) + T * sin(angle);
  vec3 world = up * (ground + position.y);
  vec3 n = turn(normalize(X * normal.x + U * normal.y + Z * normal.z), axis, angle);
  vec3 w = warpPosition(world);
  vNormal = warpNormal(world, n);
  vWorld = w;
  vUv = uv;
  vLocal = position;
  vLocalNormal = normal;
  vPaint = aPaint;
  vPlanet = world;
  vPlanetNormal = n;
  vUp = up;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
