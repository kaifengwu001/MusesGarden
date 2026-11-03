// A tree near the camera (treesNear.ts): the far tree's crown (tree.frag.glsl: its five lumps where its seed puts
// them, its size and height by its seed) heaped of leafy clumps from one template, each lump's dark core in it, the
// trunk and a branch up into each side lump; all of it about the tree's up, warped as the far tree is. Beyond the
// near trees' reach it is gone; over its last meters it fades into the far tree (each on the other's pixels).
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
uniform float uTreeNear; // the near trees' reach (m; 0: none)

attribute vec4 aTree;  // direction, its ground (m)
attribute float aSeed; // [0, 1)
attribute vec4 aPuff;  // its kind (0 a clump, 1 a lump's core, 2 the trunk, 3 a branch), its lump, its size (× its lump's), its tint
attribute vec3 aDir;   // a clump's way out on its lump (unit, the template's frame: y up)

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLump;      // its lump's middle (its crown's roundness, for the light and the painted edge)
flat varying vec4 vInfo; // its kind, how far up its crown (0 … 1), its tint, its fade (0 near … 1 far)

const float FADE = 4.0;

void main() {
  float seed = aSeed;
  float size = mix(0.72, 1.28, fract(seed * 3.97));
  float rc = 1.9 * size;
  float H = mix(3.4, 5.6, fract(seed * 5.3)) * size;
  vec3 dir = aTree.xyz;
  float ground = aTree.w;
  vec3 g = warpPosition(dir * (uRadius + ground - 0.3));
  vec3 mid = dir * (uRadius + ground + 0.5 * H);
  vec3 m = warpPosition(mid);
  vec3 U = warpNormal(mid, dir);
  float fade = smoothstep(uTreeNear - FADE, uTreeNear, length(cameraPosition - m));
  if (fade >= 0.999) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 S1 = normalize(cross(U, abs(U.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 S2 = cross(U, S1);
  vec3 crown = g + U * (H - rc);
  // (its lump, as the far tree has it)
  int k = int(aPuff.y + 0.5);
  float a = seed * 6.2831 + float(k) * 2.2;
  vec3 c;
  float r;
  if (k == 0) {
    c = crown + U * (0.28 * rc);
    r = 0.74 * rc;
  } else if (k < 4) {
    c = crown + (S1 * cos(a) + S2 * sin(a)) * (0.5 * rc) - U * (0.12 * rc);
    r = 0.58 * rc;
  } else {
    c = crown - U * (0.42 * rc) + (S1 * cos(a + 1.0) + S2 * sin(a + 1.0)) * (0.2 * rc);
    r = 0.52 * rc;
  }
  // (its clumps turned about its up by its seed, so the trees do not all wear the template the same way; the frame
  // right-handed, T1 × U = T2, so the template's triangles still face out: a mirrored one turned each clump inside
  // out, its near half culled and the inside of its far half drawn, lit from below and dark on top)
  float turn = seed * 19.47;
  vec3 T1 = S1 * cos(turn) + S2 * sin(turn);
  vec3 T2 = cross(T1, U);
  int kind = int(aPuff.x + 0.5);
  // (a lump the camera is in left out, its clumps, core and branch, as the far tree leaves out a lump it is traced
  // from inside: seen from within, its clumps filled the frame with their facets; it goes on the dithered pixels as
  // the camera comes up to its outermost clumps, 1.1 of its radius out)
  if (kind != 2) fade = max(fade, 1.0 - smoothstep(1.1 * r, 1.35 * r, length(cameraPosition - c)));
  if (fade >= 0.999) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 p;
  vec3 n;
  if (kind <= 1) {
    vec3 out_ = T1 * aDir.x + U * aDir.y + T2 * aDir.z;
    vec3 centre = kind == 0 ? c + out_ * (0.62 * r) : c;
    p = centre + (T1 * position.x + U * position.y + T2 * position.z) * (r * aPuff.z);
    n = normalize(T1 * normal.x + U * normal.y + T2 * normal.z);
  } else {
    float rt = 0.13 * rc / 2.0 + 0.06;
    vec3 from = kind == 2 ? g : g + U * (0.55 * (H - rc));
    vec3 to = kind == 2 ? crown : c;
    float rr = kind == 2 ? rt * (1.0 - 0.35 * position.y) : rt * 0.55 * (1.0 - 0.6 * position.y);
    vec3 axis = normalize(to - from);
    vec3 B1 = normalize(cross(axis, abs(dot(axis, S1)) < 0.9 ? S1 : S2));
    vec3 B2 = cross(B1, axis);
    p = mix(from, to, position.y) + (B1 * position.x + B2 * position.z) * rr;
    n = normalize(B1 * position.x + B2 * position.z);
  }
  vNormal = n;
  vWorld = p;
  vLump = kind <= 1 ? c : p - n;
  vInfo = vec4(float(kind), clamp(dot(p - crown, U) / rc * 0.5 + 0.5, 0.0, 1.0), fract(seed * 9.73) + 10.0 * floor(aPuff.w * 100.0), fade);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
