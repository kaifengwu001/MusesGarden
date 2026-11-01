// A house (houses.ts), bent round the planet: each vertex is placed by its
// meters along the house and toward its front, on the sphere round the
// house's middle, and straight up from there, so the walls stand square to
// the ground under them and the floor lies on its terrace.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

attribute vec3 aOut;  // the eaves' reach (m)
attribute float aPart; // 0 walls, 1 roof, 2 gable ends
attribute vec4 aHouse; // middle (direction), floor (m)
attribute vec4 aAlong; // length's way, length (m)
attribute vec4 aFront; // front's way (downhill), depth (m)
attribute vec4 aSize;  // walls' height (m), seed, -, -
uniform float uRoof;   // the roof's rise over half the depth

varying vec3 vLocal;  // meters: along, up from the floor, toward the front
varying vec3 vNormal; // warped
varying vec3 vPlanet; // planet space
varying vec3 vWarped;
flat varying float vPart;
flat varying vec4 vSize; // length, depth, walls' height, seed

void main() {
  float L = aAlong.w;
  float D = aFront.w;
  float W = aSize.x;
  float rise = uRoof * 0.5 * D;
  vec3 m = vec3(position.x * L, position.y <= 1.0 ? position.y * W : W + (position.y - 1.0) * rise, position.z * D) + aOut;
  vec3 up = normalize(aHouse.xyz + (aAlong.xyz * m.x + aFront.xyz * m.z) / uRadius);
  vec3 p = up * (uRadius + aHouse.w + m.y);
  // the roof's slopes: their true pitch
  vec3 n = normal;
  if (aPart > 0.5 && aPart < 1.5 && abs(n.z) > 0.5) n = normalize(vec3(0.0, 1.0, sign(n.z) * uRoof));
  vec3 nw = normalize(aAlong.xyz * n.x + up * n.y + aFront.xyz * n.z);
  vec3 w = warpPosition(p);
  vLocal = m;
  vNormal = warpNormal(p, nw);
  vPlanet = p;
  vWarped = w;
  vPart = aPart;
  vSize = vec4(L, D, W, aSize.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
