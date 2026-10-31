// Grass blades: all shading happens per vertex; no discard, so tile GPUs keep
// hidden-surface removal for this heavily overlapping draw. (Flowers, petals
// and birds share it.) The colour is read where the triangle covers the pixel
// (centroid): under MSAA a pixel's centre can lie outside a sub-pixel triangle,
// a floret or a star's point seen edge-on, and a colour extrapolated that far
// runs out of range, to black or white specks that flicker as it sways.
centroid varying vec3 vColour;

void main() {
  gl_FragColor = vec4(vColour, 1.0);
}
