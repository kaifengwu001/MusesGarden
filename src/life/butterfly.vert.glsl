// A butterfly (butterflies.ts): placed by its instance (position, heading,
// wing angle), its wings turned up about the body (the hindwings a little
// behind the forewings), the body pitched up a touch in flight. Lit softly
// by the sun, the wings letting some light through; the outline and the
// pattern are painted in butterfly.frag.glsl.
#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>

attribute float aPart;   // 0 body, ±1 forewing, ±2 hindwing (sign: side)
attribute vec3 aPos;     // planet space (m)
attribute vec4 aHeading; // heading (unit tangent), wing angle (rad, up from flat)
attribute vec4 aLook;    // kind, size (× the mesh; 0 = gone), pitch (rad), a random
varying vec2 vUv;
varying float vPart;
flat varying float vKind;
varying float vLight;
varying float vDist;
varying vec3 vDir;

void main() {
  if (aLook.y <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 p = position;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float side = sign(aPart);
  if (abs(aPart) > 0.5) {
    float a = aHeading.w * (abs(aPart) > 1.5 ? 0.88 : 1.0);
    float x = abs(p.x);
    p.xy = vec2(side * x * cos(a), x * sin(a));
    n = vec3(-side * sin(a), cos(a), 0.0);
  }
  // the body's frame on the planet, pitched up about its right
  vec3 up = normalize(aPos);
  vec3 fwd = aHeading.xyz;
  vec3 right = normalize(cross(fwd, up));
  float c = cos(aLook.z);
  float s = sin(aLook.z);
  vec3 f2 = fwd * c + up * s;
  vec3 u2 = up * c - fwd * s;
  vec3 world = aPos + (right * p.x + u2 * p.y + f2 * p.z) * aLook.y;
  vec3 nw = normalize(right * n.x + u2 * n.y + f2 * n.z);
  // either face catches the light, and the sun shines through from behind
  float ndl = dot(nw, uSunDir);
  vLight = 0.62 + 0.38 * abs(ndl);
  vUv = uv;
  vPart = aPart;
  vKind = aLook.x;
  vec3 wp = warpPosition(world);
  vDist = length(cameraPosition - wp);
  vDir = up;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
