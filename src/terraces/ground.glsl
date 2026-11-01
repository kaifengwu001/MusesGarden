// The terraced ground (ARCHITECTURE.md, "A hill turned into terraces"): each
// plot's floor; on the hills the bund along its outer edge, on top of the
// wall below, and the riser up its inner edge to the next floor's bund (as
// steep as a dry earth wall: about 0.24 m across per meter of height); the
// bunds across it; and the water standing on its floor at its own level.
// Wild ground keeps the hills' own shape. GPU mirror of TerracePlots.ground
// (plots.ts): change both together.
// Requires: terraces_plots, terraces_paddy.

uniform vec4 uTerraceMesh; // the finest grid (m), the grid's spacing per meter away (1 / it), the rows gathered by (spacing / band) start, all gone

// A bund's rise d meters in from its outer edge (0 … 1): flat on top, rounding down to its foot at its width.
float bundRise(float d) {
  float w = uTerraceWall.y;
  return 1.0 - smoothstep(uTerraceWall.w * w, w, d);
}

// A riser's width (m) for the floor below it and the bund it climbs to.
float riserWidth(float floorH, float top) {
  return max(uTerraceWall.x * (top - floorH), 0.06);
}

// A plot's ground (m) at a point of it: its floor, its bunds and its walls (without the water).
float plotGround(Plot p) {
  float bh = uTerraceWall.z;
  float g = p.floorH;
  if (p.kind == PLOT_TERRACE) {
    // its outer bund, and the riser up its inner edge to the bund of the floor above
    g = max(g, p.floorH + bh * bundRise(p.dOut));
    float top = p.above + bh;
    g = max(g, mix(p.floorH, top, clamp(1.0 - p.dIn / riserWidth(p.floorH, top), 0.0, 1.0)));
  }
  // the bunds across it: a ridge over the line, flat on its crest
  float half_ = 0.5 * uTerraceWall.y;
  g = max(g, mix(p.floorH, p.crossTop, 1.0 - smoothstep(uTerraceWall.w * half_, half_, p.dCross)));
  return g;
}

// Its water's level (m), or far below where it is dry.
float plotWater(Plot p, Crop c) {
  return c.water > 0.0 ? p.floorH + c.water : -1e4;
}

// The surface (m) at a point: the ground, the water over it, the hills' own shape where wild.
float surfaceOf(Plot p, Crop c) {
  float h = max(plotGround(p), plotWater(p, c));
  return mix(h, p.natural, smoothstep(0.35, 0.65, p.wild));
}

float terraceHeight(vec3 dir) {
  Plot p = plotAt(dir);
  return surfaceOf(p, cropOf(p));
}

// The ground, cheaper (the paddies' mirror, the trees' feet): the hills' levels and their walls, without
// the cuts, the flats' plots or the water (a few centimeters it would add).
float terraceHeightCoarse(vec3 dir) {
  vec4 base = textureLod(uTerraceBake, dir, 0.0);
  float wild = smoothstep(0.35, 0.65, base.b);
  if (base.a >= 0.5 || wild > 0.999) return base.r;
  vec4 lay = textureLod(uTerraceLayout, dir, 0.0);
  vec4 life = textureLod(uTerraceLife, dir, 0.0);
  uint cell = cellKey(lay.r);
  float slopeC = max(life.a, 0.004);
  float s = cellRiser(cell, slopeC);
  float phi = unitHash(plotHash(cell, 0, 0, 0, 22u));
  float u = base.r / s + phi;
  float lo2;
  float lo;
  float hi;
  float hi2;
  wallsRound(cell, u, lo2, lo, hi, hi2);
  float floorH = (0.5 * (lo + hi) - phi) * s;
  float top = (0.5 * (hi + hi2) - phi) * s + uTerraceWall.z;
  float perLevel = s / max(base.g, 0.004);
  float g = max(floorH + uTerraceWall.z * bundRise((u - lo) * perLevel), mix(floorH, top, clamp(1.0 - (hi - u) * perLevel / riserWidth(floorH, top), 0.0, 1.0)));
  return mix(g, base.r, wild);
}

// x moved within [a, b] toward its nearer end: a vertex within a quarter of the span of a wall's edge
// lands on it, the rest spread out between (twice over a curve flat at both ends: monotonic, so the grid
// never folds).
float gatherIn(float x, float a, float b) {
  float t = clamp((x - a) / max(b - a, 1e-4), 0.0, 1.0);
  t -= sin(6.2831853 * t) / 6.2831853;
  t -= sin(6.2831853 * t) / 6.2831853;
  return a + t * (b - a);
}

// How far the mesh has eased to the hills' own shape (0 … 1) where its grid is `spacing` (m) apart: where a
// band is under two grid steps across, it could not draw its walls (the fragment shader paints them).
float meshEase(float spacing, Plot p) {
  return smoothstep(0.45, 0.6, spacing / (p.kind == PLOT_TERRACE ? p.band : 12.0));
}

// The grid's spacing (m) at dist (m) from the camera, at most (CDLOD's ranges; terrain.ts MESH).
float meshSpacing(float dist) {
  return max(uTerraceMesh.x, dist * uTerraceMesh.y);
}

// The mesh's vertex at dir, seen from dist (m): moved across its band so the grid's rows gather onto the
// edges of its walls (the bund's crest and foot, the riser's foot and top) and the steps stand sharp, as
// far out as the grid has rows enough to draw them (CDLOD spacing grows with distance); farther, the hills'
// own shape, the paint drawing the terraces on it. A function of position and distance only, never of the
// node, so the mesh stays watertight (the geomorph blends a vertex toward its neighbours' moved positions).
// Returns the moved direction and the surface's height there.
vec4 terraceVertex(vec3 dir, float dist) {
  float spacing = meshSpacing(dist);
  Plot p = plotAt(dir);
  Crop c = cropOf(p);
  float water = plotWater(p, c);
  float g = plotGround(p);
  vec3 moved = dir;
  if (p.kind == PLOT_TERRACE && p.wild < 0.65) {
    float gather = 1.0 - smoothstep(uTerraceMesh.z, uTerraceMesh.w, spacing / p.band);
    if (gather > 0.0) {
      float slope;
      vec3 up = uphillAt(dir, p.natural, slope);
      // the edges across the band from its outer wall: the bund's crest and foot, the riser's foot, the inner
      // wall (where the grid is too coarse for the bund, the wall's top and foot only)
      float bw = uTerraceWall.y;
      float top = p.above + uTerraceWall.z;
      float f1 = uTerraceWall.w * bw;
      float f3 = max(p.band - riserWidth(p.floorH, top), bw + 0.02);
      float x = clamp(p.dOut, 0.0, p.band);
      float x2;
      if (spacing > 0.7 * bw) x2 = x < f3 ? gatherIn(x, 0.0, f3) : gatherIn(x, f3, p.band);
      else x2 = x < f1 ? gatherIn(x, 0.0, f1) : x < bw ? gatherIn(x, f1, bw) : x < f3 ? gatherIn(x, bw, f3) : gatherIn(x, f3, p.band);
      float shift = (x2 - x) * gather;
      moved = normalize(dir + up * (shift / uRadius));
      // the ground there, of the same plot (the move keeps within its band)
      p.dOut += shift;
      p.dIn -= shift;
      g = plotGround(p);
    }
  }
  float h = max(g, water);
  // far off, where a band is only a few grid steps across, the hills' own shape
  h = mix(h, p.natural, max(meshEase(spacing, p), smoothstep(0.35, 0.65, p.wild)));
  return vec4(moved, h);
}
