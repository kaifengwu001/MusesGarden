// Muse's optical depth (museShadow.vert.glsl): dense, so its shadow comes out
// full wherever the map is sharp enough to hold it (front and back of the
// skin both land here, additively).
void main() {
  gl_FragColor = vec4(6.0, 0.0, 0.0, 1.0);
}
