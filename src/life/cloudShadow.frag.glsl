// One puff's optical depth toward the sun: its chord, thinner toward the rim
// (the same weighting the clouds are traced with, clouds.glsl).
varying vec2 vOff;
varying float vRadius;

void main() {
  float q2 = dot(vOff, vOff);
  if (q2 >= 1.0) discard;
  gl_FragColor = vec4(2.0 * vRadius * sqrt(1.0 - q2) * (1.0 - q2), 0.0, 0.0, 1.0);
}
