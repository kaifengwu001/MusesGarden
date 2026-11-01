// A find's sphere (findSphere.vert.glsl): a soft halo in its colour round a
// near-white core, added to what is behind it.
varying vec3 vColour;
varying float vCore;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r >= 1.0) discard;
  float halo = (1.0 - r * r) * exp(-3.0 * r * r);
  float core = vCore > 0.0 ? 1.0 - smoothstep(0.55 * vCore, vCore, r) : 0.0;
  float strength = max(max(vColour.r, vColour.g), vColour.b);
  gl_FragColor = vec4(vColour * halo + vec3(1.0, 0.97, 0.9) * strength * core, 1.0);
}
