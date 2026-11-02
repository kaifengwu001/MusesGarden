// A segment's distance from its stroke's edge (m, > 0 inside), where the face's direction lies: its breadth there
// (eased between its ends) less how far the direction lies from it on the shell; kept at an offset (the cube map
// holds 0 where no stroke reaches), with that half-breadth beside it; the greatest of every segment's kept (max
// blending), so strokes that cross merge, the broader's breadth kept.
uniform float uShell;
uniform float uMargin;
uniform float uOffset;

varying vec3 vDir;
flat varying vec3 vA;
flat varying vec3 vB;
flat varying vec2 vH;

void main() {
  vec3 d = normalize(vDir);
  vec3 u = vB - vA;
  float t = clamp(dot(d - vA, u) / max(dot(u, u), 1e-14), 0.0, 1.0);
  float half_ = mix(vH.x, vH.y, t);
  float sd = half_ - length(d - (vA + u * t)) * uShell;
  if (sd < -uMargin) discard;
  gl_FragColor = vec4(sd + uOffset, half_, 0.0, 1.0);
}
