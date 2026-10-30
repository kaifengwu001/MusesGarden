// A bird's optical depth: its silhouette from above (birds.ts birdGeometry),
// the body, the fanned tail and the two-panel wings as far as they reach
// out at this point of the wingbeat, with an edge as soft as the map's
// texels, dark enough for a clear small shadow on the meadow even where a
// coarser map blurs it.
varying vec2 vOff;
flat varying vec2 vSpread;

const vec2 HALF = vec2(0.5, 0.21);

// 1 inside the silhouette at (x, z) in the bird mesh's units (x ≥ 0: one side; z forward), else 0.
float silhouette(float x, float z) {
  // the body, nose to tail, and the tail's fan
  if ((x / 0.055) * (x / 0.055) + ((z + 0.02) / 0.19) * ((z + 0.02) / 0.19) < 1.0) return 1.0;
  if (z < -0.1 && z > -0.21 && x < 0.085 * (-0.1 - z) / 0.11 + 0.03) return 1.0;
  // the wings: the broad inner panel from the shoulder (0.05) to the elbow (0.25), then the pointed outer one to the tip (0.48)
  float elbowX = 0.05 + 0.2 * vSpread.x;
  if (x >= 0.05 && x <= elbowX) {
    float u = (x - 0.05) / max(elbowX - 0.05, 1e-4);
    return z > mix(-0.115, -0.13, u) && z < mix(0.085, 0.075, u) ? 1.0 : 0.0;
  }
  float xu = 0.25 + (x - elbowX) / max(vSpread.y, 0.05);
  if (x > elbowX && xu <= 0.48) {
    float lead = xu < 0.37 ? mix(0.075, 0.035, (xu - 0.25) / 0.12) : mix(0.035, -0.07, (xu - 0.37) / 0.11);
    float trail = xu < 0.37 ? mix(-0.13, -0.15, (xu - 0.25) / 0.12) : mix(-0.15, -0.07, (xu - 0.37) / 0.11);
    return z > trail && z < lead ? 1.0 : 0.0;
  }
  return 0.0;
}

void main() {
  vec2 p = vec2(abs(vOff.x) * HALF.x, vOff.y * HALF.y);
  // four samples within the texel: the outline as soft as the map can hold
  vec2 e = fwidth(p) * 0.25;
  float cover = 0.25 * (silhouette(abs(p.x + e.x), p.y + e.y) + silhouette(abs(p.x - e.x), p.y + e.y)
    + silhouette(abs(p.x + e.x), p.y - e.y) + silhouette(abs(p.x - e.x), p.y - e.y));
  if (cover <= 0.0) discard;
  // dense: where the coarser maps (the grass's field map, the far shadows) blur the thin wings,
  // the shadow still comes out full and shaped like the span, not faded to a spot
  gl_FragColor = vec4(12.0 * cover, 0.0, 0.0, 1.0);
}
