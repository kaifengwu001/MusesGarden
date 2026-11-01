// The villages for the ground (villages.ts): where a point is in one, how
// far it is from the nearest house's footprint, so the floor round the
// houses is courtyard rather than paddy. Requires: terraces_common, uRadius.
#define MAX_VILLAGES 8 // VILLAGES.max in villages.ts
uniform vec4 uVillages[MAX_VILLAGES];      // middle (direction), reach (m); w < 0: none
uniform vec4 uVillageHouses[MAX_VILLAGES]; // its first house, how many
uniform sampler2D uHouses;                 // per house: direction, floor; along, length; front, depth

// Distance (m) from a direction to the nearest house's footprint (negative inside it; 1e9 in no village).
float houseDistance(vec3 dir) {
  float best = 1e9;
  for (int i = 0; i < MAX_VILLAGES; i++) {
    vec4 v = uVillages[i];
    if (v.w < 0.0 || chordAngle(dir, v.xyz) * uRadius > v.w) continue;
    vec4 hh = uVillageHouses[i];
    for (int k = 0; k < 12; k++) {
      if (float(k) >= hh.y) break;
      int row = int(hh.x) + k;
      vec4 a = texelFetch(uHouses, ivec2(0, row), 0);
      vec4 b = texelFetch(uHouses, ivec2(1, row), 0);
      vec4 c = texelFetch(uHouses, ivec2(2, row), 0);
      vec3 off = (dir - a.xyz) * uRadius;
      vec2 q = abs(vec2(dot(off, b.xyz), dot(off, c.xyz))) - 0.5 * vec2(b.w, c.w);
      best = min(best, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
    }
  }
  return best;
}
