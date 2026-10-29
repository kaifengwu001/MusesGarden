// Grass blades: all shading happens per vertex; no discard, so tile GPUs keep
// hidden-surface removal for this heavily overlapping draw.
varying vec3 vColour;

void main() {
  gl_FragColor = vec4(vColour, 1.0);
}
