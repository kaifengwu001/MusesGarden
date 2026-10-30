// A bird's optical depth: enough for a soft spot on the meadow.
varying vec2 vOff;

void main() {
  float q = dot(vOff, vOff);
  if (q >= 1.0) discard;
  gl_FragColor = vec4(4.0 * (1.0 - q * q), 0.0, 0.0, 1.0);
}
