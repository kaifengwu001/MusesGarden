// A bird (birds.ts): placed by its instance (position, heading, bank), its
// wings turned at the shoulder and the elbow by the wingbeat, the outer wing
// a beat behind the inner. White, sunlit on the back, cooler underneath.
#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>

attribute float aHinge; // 0 body, ±1 inner wing, ±2 outer wing (sign: side)
attribute vec3 aPos;    // planet space (m)
attribute vec4 aFrame;  // heading (unit tangent), bank (rad)
attribute vec4 aWing;   // wingbeat phase (rad), beat (rad), dihedral (rad), size (× the mesh)
varying vec3 vColour;

const vec2 SHOULDER = vec2(0.05, 0.0);
const vec2 ELBOW = vec2(0.25, 0.0);

vec2 turn(vec2 p, vec2 pivot, float a) {
  vec2 r = p - pivot;
  float c = cos(a);
  float s = sin(a);
  return pivot + vec2(c * r.x - s * r.y, s * r.x + c * r.y);
}

void main() {
  if (aWing.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 p = position;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float side = sign(aHinge);
  float level = abs(aHinge);
  if (level > 0.5) {
    // as the right wing (the left mirrored), turned at the elbow, then the shoulder
    float shoulder = aWing.z + aWing.y * sin(aWing.x);
    float elbow = 0.6 * aWing.y * sin(aWing.x - 0.9);
    vec2 xy = vec2(p.x * side, p.y);
    float a = shoulder;
    if (level > 1.5) {
      xy = turn(xy, ELBOW, elbow);
      a += elbow;
    }
    xy = turn(xy, SHOULDER, shoulder);
    p.xy = vec2(xy.x * side, xy.y);
    n = vec3(-sin(a) * side, cos(a), 0.0);
  }
  // the bird's frame on the planet, banked about its heading
  vec3 up = normalize(aPos);
  vec3 fwd = aFrame.xyz;
  vec3 right = normalize(cross(up, fwd));
  float cb = cos(aFrame.w);
  float sb = sin(aFrame.w);
  vec3 r2 = right * cb + up * sb;
  vec3 u2 = up * cb - right * sb;
  vec3 world = aPos + (r2 * p.x + u2 * p.y + fwd * p.z) * aWing.w;
  vec3 wp = warpPosition(world);
  vec3 toCam = cameraPosition - wp;
  // light the side we see: the back in sun, or the underside in the sky's light
  vec3 nv = warpNormal(world, normalize(r2 * n.x + u2 * n.y + fwd * n.z));
  if (dot(nv, toCam) < 0.0) nv = -nv;
  // (white feathers stay pale even in their own shade: the meadow and the sky light them)
  float b = toonLight(dot(nv, uSunDir));
  vec3 col = tone3(pal(ROW_CLOUD, 3), pal(ROW_CLOUD, 0), pal(ROW_CLOUD, 2) * 0.96, b);
  vColour = applyAerial(col, length(toCam), up);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
