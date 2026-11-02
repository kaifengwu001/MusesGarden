// Muse's hut inside (hut.ts): the room and what is in it, in the homestead's
// frame and bent round the planet as the cottage is (props.vert.glsl: a
// point's local x and z land where the terrain's cottage-local meters put
// them, y is its height over the clearing), then warped like everything else.
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;

#ifdef SHELL
attribute vec4 aPaint; // the room's paint data (hut.ts Shell)
// The front door swung open (rad) about its hinge (props.ts DOORWAY): the door in the cut (the timber's paint flag 3) goes with it.
uniform float uDoor;
uniform int uKind;
#endif
#ifdef PLACED
// a piece moved, turned or scaled in the layout editor (ui/garden/hutEditor.ts) from where hut.ts stood it
uniform mat4 uPlace;
uniform mat3 uPlaceNormal;
#endif

varying vec3 vNormal;      // warped world
varying vec3 vWorld;
varying vec2 vUv;          // a model's or the rug's picture; meters on the room's faces
varying vec3 vLocal;       // the homestead's frame (m), before bending
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;      // planet space, unwarped
varying vec3 vUp;          // the local up where this point stands, planet space

vec3 turn(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  vec3 X = normalize(modelMatrix[0].xyz);
  vec3 U = normalize(modelMatrix[1].xyz);
  vec3 Z = normalize(modelMatrix[2].xyz);
  float ground = length(modelMatrix[3].xyz);
#ifdef PLACED
  vec3 pos = (uPlace * vec4(position, 1.0)).xyz;
  vec3 nrm = normalize(uPlaceNormal * normal);
#else
  vec3 pos = position;
  vec3 nrm = normal;
#endif
  // (its paint goes with it: vLocal keeps where it stood shut)
  vec3 at = pos;
#ifdef SHELL
  if (uDoor > 0.0 && uKind == 5 && aPaint.w > 2.5) {
    float c = cos(uDoor);
    float s = sin(uDoor);
    vec2 r = at.xz - DOOR_HINGE;
    at.xz = DOOR_HINGE + vec2(c * r.x - s * r.y, s * r.x + c * r.y);
    nrm.xz = vec2(c * nrm.x - s * nrm.z, s * nrm.x + c * nrm.z);
  }
#endif
  vec2 h = at.xz;
  float d = length(h);
  float angle = asin(min(d / uRadius, 1.0));
  vec3 T = d > 1e-5 ? (X * h.x + Z * h.y) / d : X;
  vec3 axis = normalize(cross(U, T));
  vec3 up = U * cos(angle) + T * sin(angle);
  vec3 world = up * (ground + at.y);
  vec3 n = turn(normalize(X * nrm.x + U * nrm.y + Z * nrm.z), axis, angle);
  vec3 w = warpPosition(world);
  vNormal = warpNormal(world, n);
  vWorld = w;
  vUv = uv;
  vLocal = pos;
  vLocalNormal = nrm;
#ifdef SHELL
  vPaint = aPaint;
#else
  vPaint = vec4(0.0);
#endif
  vPlanet = world;
  vUp = up;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
