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
#ifdef CUTAWAY
// The cutaway into the hut (props.ts setCutaway): the roof and the chimney lift off and dissolve as it opens.
uniform int uKind;
uniform float uCutaway;
varying float vLift;       // how far this point has gone with the roof (0: it stays)
#endif
#ifdef DOOR_HINGE
// The front door (the wood's flag 1) swung in about its hinge (props.ts DOORWAY) as Muse comes to it: how far, rad.
uniform float uDoor;
#endif

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
#ifdef CUTAWAY
  // the roof and the chimney (the walls' plain plaster) rise as they go
  vLift = uKind == 1 || (uKind == 0 && aPaint.w > 0.5) ? uCutaway : 0.0;
  vec3 placed = position + vec3(0.0, 1.6 * vLift * vLift, 0.0);
  #define PLACED placed
#else
  #define PLACED position
#endif
#ifdef DOOR_HINGE
  // (its paint and its cut go with it: vLocal keeps where it stood shut)
  vec3 swung = PLACED;
  vec3 swungNormal = normal;
  if (uDoor > 0.0 && aPaint.w > 0.5 && aPaint.w < 1.5) {
    float c = cos(uDoor);
    float s = sin(uDoor);
    vec2 r = swung.xz - DOOR_HINGE;
    swung.xz = DOOR_HINGE + vec2(c * r.x - s * r.y, s * r.x + c * r.y);
    swungNormal.xz = vec2(c * normal.x - s * normal.z, s * normal.x + c * normal.z);
  }
  #define POS swung
  #define NRM swungNormal
#else
  #define POS PLACED
  #define NRM normal
#endif
  // out over the surface toward the point, as far as the terrain's meters say, then up by its height
  vec2 h = POS.xz;
  float d = length(h);
  float angle = asin(min(d / uRadius, 1.0));
  vec3 T = d > 1e-5 ? (X * h.x + Z * h.y) / d : X;
  vec3 axis = normalize(cross(U, T));
  vec3 up = U * cos(angle) + T * sin(angle);
  vec3 world = up * (ground + POS.y);
  vec3 n = turn(normalize(X * NRM.x + U * NRM.y + Z * NRM.z), axis, angle);
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
