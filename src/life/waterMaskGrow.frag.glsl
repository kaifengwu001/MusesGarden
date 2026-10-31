// The water mask grown along one axis (waterMask.ts): a cell is set when any
// within uCells of it is. Across, then up: grown by a square.
uniform sampler2D tMask;
uniform ivec2 uAxis;
uniform int uCells;
uniform ivec2 uSize; // the cells drawn this frame

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float on = 0.0;
  for (int i = -MAX_GROW; i <= MAX_GROW; i++) {
    if (abs(i) > uCells) continue;
    on = max(on, texelFetch(tMask, clamp(c + uAxis * i, ivec2(0), uSize - 1), 0).r);
  }
  gl_FragColor = vec4(on, 0.0, 0.0, 1.0);
}
