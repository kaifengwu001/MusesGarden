// A segment of a mist layer's strokes (mist.ts, mistStrokes.ts) splatted into one face of its cube map: a quad round
// it on the layer's shell, out to its breadth and a margin past it, projected from the planet's centre onto the face
// (perspective-correct, so the splat keeps its shape). The fragments work out the distance from its edge.
uniform mat3 uCubeFace; // this face's axes as columns: across, up, out (the GL cube-map convention)
uniform float uShell;   // the layer's radius (m)
uniform float uMargin;  // how far past the edge the distance is drawn (m)

attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aH; // the half-breadth at each end (m)

varying vec3 vDir;
flat varying vec3 vA;
flat varying vec3 vB;
flat varying vec2 vH;

void main() {
  vec3 u = aB - aA;
  float len = length(u);
  vec3 eu = len > 1e-9 ? u / len : normalize(cross(aA, abs(aA.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 en = normalize(cross(aA, eu));
  float r = (max(aH.x, aH.y) + uMargin) / uShell;
  vec3 d = aA + eu * (position.x < 0.0 ? -r : len + r) + en * (position.y * r);
  vDir = d;
  vA = aA;
  vB = aB;
  vH = aH;
  vec3 f = d * uCubeFace;
  gl_Position = vec4(f.xy, 0.0, f.z);
}
