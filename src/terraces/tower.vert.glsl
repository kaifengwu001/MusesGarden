// A karst tower (towers.ts): its model (a unit tall, x and z across, y up)
// stood rigid on its site, turned about the site's up, stretched across by
// |e1|, its height in meters, its base sunk into its mound. Then warped.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute vec4 aBase;  // the site's up (direction), its base's height (m)
attribute vec4 aFrame; // the model's x way (its length the width's stretch), the tower's height (m)

varying vec2 vUv;
varying vec3 vNormal;  // warped
varying vec3 vPlanet;  // planet space
varying vec3 vWarped;
varying float vUp;     // up the tower, 0 … 1

void main() {
  vec3 up = aBase.xyz;
  float s = length(aFrame.xyz);
  vec3 e1 = aFrame.xyz / s;
  vec3 e2 = cross(e1, up);
  float H = aFrame.w;
  vec3 p = up * (uRadius + aBase.w) + (e1 * position.x * s + up * position.y + e2 * position.z * s) * H;
  vec3 n = normalize(e1 * normal.x / s + up * normal.y + e2 * normal.z / s);
  vec3 w = warpPosition(p);
  vUv = uv;
  vNormal = warpNormal(p, n);
  vPlanet = p;
  vWarped = w;
  vUp = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
