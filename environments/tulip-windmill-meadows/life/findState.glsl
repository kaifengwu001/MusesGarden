// Each find's state, as its patch (findBed.vert.glsl) and its sphere
// (findSphere.vert.glsl) read it: two texels a find in uFinds, FIND_PER_ROW
// finds to a row (findTable.ts).
// Requires: common, paint (pal).
uniform highp sampler2D uFinds;
uniform float uPlantClock;

struct FindState {
  float planted; // s on uPlantClock (later: not yet)
  float open;    // its card is up, 0..1
  float lift;    // under the pointer, 0..1
  float pulsed;  // s on uPlantClock
  float mark;    // the picked basket's mark, 0..1
};

FindState findState(float index) {
  int i = int(index + 0.5);
  ivec2 at = ivec2((i % FIND_PER_ROW) * 2, i / FIND_PER_ROW);
  vec4 a = texelFetch(uFinds, at, 0);
  vec4 b = texelFetch(uFinds, at + ivec2(1, 0), 0);
  return FindState(a.x, a.y, a.z, a.w, b.x);
}

// Once as it comes home: 0 → 1 → 0 over FIND_PULSE s.
float findPulse(FindState f) {
  float since = uPlantClock - f.pulsed;
  return since > 0.0 && since < FIND_PULSE ? sin(MEADOW_PI * since / FIND_PULSE) : 0.0;
}

// The warm light a lit find glows in.
vec3 findGlow() {
  return mix(pal(ROW_LIGHT, 0), pal(ROW_SCATTER, 10), 0.35);
}

// The picked basket's tint: a cool pale lilac, apart from the warm light of a lit find.
vec3 findMarkTint() {
  return pal(ROW_STAR, 5);
}
