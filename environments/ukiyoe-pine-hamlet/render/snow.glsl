// Reserved white paper: snow has no grain, dots or procedural surface marks.
// The small cool edge belongs to the physical overhang, not random top patches.
// Derivative-free because terrain includes this helper in vertex programs too.
vec3 snowBoundary(float light, float upFacing) {
  vec3 white = pow(vec3(0.988, 0.988, 0.978), vec3(2.2));
  vec3 underside = pow(vec3(0.78, 0.85, 0.88), vec3(2.2));
  float lowerEdge = 1.0 - smoothstep(0.05, 0.65, upFacing);
  vec3 col = mix(white, underside, lowerEdge * (0.72 + 0.18 * (1.0 - light)));
  return col * mix(vec3(1.0), uSunTint, 0.35);
}

vec3 snowPrint(vec3 restMeters, float pixelMeters, float light) {
  return snowBoundary(light, 1.0);
}

// Snow in a cloud's shadow (cover 0..1, cloudCoverAt): washed a clear, cool
// blue, as the prints shade their snow; the shadows of the trees keep theirs.
vec3 snowInCloud(vec3 snow, float cover) {
  return snow * mix(vec3(1.0), pow(vec3(0.74, 0.82, 0.95), vec3(2.2)), cover);
}
