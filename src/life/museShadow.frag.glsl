// Muse's shadow (museShadow.vert.glsl): whatever its skin covers is in its
// shadow (front and back of the skin both land here; the larger is kept).
void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
