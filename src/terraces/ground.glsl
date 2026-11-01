// The terraced ground, from the bake (terraces/fields.*, bake.frag.glsl).
// The hills are cut into levels a riser apart: each level is a flat paddy
// floor, a bund along its outer edge (on top of the riser below) and a riser
// up to the next level at its inner edge. Where the land is wild (forest,
// peaks, steep slopes, hilltops) the ground keeps its natural shape. GPU
// mirror of TerraceTerrain (terrain.ts): change both together.
// Requires: uRadius, terraces_common.

uniform samplerCube uTerraceBake; // natural height (m), slope, wild, level offset
uniform samplerCube uTerraceLife; // fog layer A, fog layer B, season, colour region
uniform vec4 uTerrace;            // riser height (m), riser width (m), bund width (m), bund height (m)
uniform vec4 uTerraceMesh;        // the mesh keeps its terraces out to (m), and loses them by (m); water depth (m)

struct Terrace {
  float natural; // the hills' own height (m)
  float slope;   // its slope (m/m)
  float wild;    // 0 terraced … 1 wild
  float x;       // across the levels: natural / riser + offset
  float level;   // floor(x)
  float f;       // across the band: 0 its outer edge (on the riser below) … 1 the foot of the riser above
  float floorH;  // the paddy floor (m)
  float rise;    // 0..1 up the riser at the band's inner edge
  float bund;    // 0..1 the outer bund's profile
  float wr;      // the riser's and the bund's widths, as shares of the band
  float wb;
  float height;  // the ground (m)
};

Terrace terraceFrom(vec4 b) {
  Terrace t;
  t.natural = b.r;
  t.slope = max(b.g, 0.01);
  t.wild = b.b;
  t.x = b.r / uTerrace.x + b.a;
  t.level = floor(t.x);
  t.f = t.x - t.level;
  float band = uTerrace.x / t.slope;
  // (on the steepest terraces the riser is a near-vertical wall, at most a third of the band)
  t.wr = clamp(min(uTerrace.y, 0.33 * band) / band, 0.03, 0.6);
  t.wb = clamp(uTerrace.z / band, 0.01, 0.3);
  t.rise = smoothstep(1.0 - t.wr, 1.0, t.f);
  t.bund = smoothstep(0.0, 0.35 * t.wb, t.f) * (1.0 - smoothstep(0.6 * t.wb, t.wb, t.f));
  t.floorH = t.level * uTerrace.x;
  float terraced = t.floorH + uTerrace.x * t.rise + uTerrace.w * t.bund;
  t.height = mix(terraced, t.natural, t.wild);
  return t;
}

Terrace terraceAt(vec3 dir) {
  return terraceFrom(textureLod(uTerraceBake, dir, 0.0));
}

float terraceHeight(vec3 dir) {
  return terraceAt(dir).height;
}

// The ground for the mesh seen from `dist` m: its risers never steeper than
// its grid there can draw (CDLOD spacing grows with distance: about dist/40,
// the finest leaves' 0.25 m up close), so they never saw-tooth along the
// contours; the paint draws them crisp per pixel. Easing to the hills' own
// shape where a band is only a few grid steps wide. A function of distance,
// not of the node, so the mesh stays watertight (as the meadow's banks:
// bankedAt in terrain.glsl).
float terraceMeshHeight(vec3 dir, float dist) {
  vec4 b = textureLod(uTerraceBake, dir, 0.0);
  float spacing = max(0.25, dist / 40.0);
  float slope = max(b.g, 0.01);
  float band = uTerrace.x / slope;
  float x = b.r / uTerrace.x + b.a;
  float level = floor(x);
  float f = x - level;
  float wr = clamp(max(min(uTerrace.y, 0.33 * band), 2.4 * spacing) / band, 0.03, 0.9);
  float terraced = level * uTerrace.x + uTerrace.x * smoothstep(1.0 - wr, 1.0, f);
  // (the bunds only where the grid can carry them)
  float wb = clamp(uTerrace.z / band, 0.01, 0.3);
  terraced += uTerrace.w * smoothstep(0.0, 0.35 * wb, f) * (1.0 - smoothstep(0.6 * wb, wb, f)) * (1.0 - smoothstep(0.12, 0.3, spacing));
  float h = mix(terraced, b.r, b.b);
  return mix(h, b.r, smoothstep(0.25, 0.45, spacing / band));
}
