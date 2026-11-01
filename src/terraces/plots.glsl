// The terraces' plots (ARCHITECTURE.md, "A hill turned into terraces"):
//
//   cells    the planet in cells some 45–90 m across (cells.glsl; the bakes
//            hold each texel's cell: its key, where the texel lies along the
//            cell's contour way and up its slope, its distance to the edge,
//            and the cell's slope and season). Terraces do not line up from
//            cell to cell: where two meet, their walls jog and end against a
//            bund along the edge
//   levels   on the hills a cell cuts the hillside along its contours into
//            levels a riser apart: its own riser (taller the steeper the
//            cell, so a band is some 5 m wide, wider where the hill eases and
//            narrower where it steepens), its own offset, each wall a little
//            off its place, and here and there a wall left out, so two levels
//            make one paddy twice as wide whose walls stand half again as tall
//            (each floor lies midway between its walls: cut above, fill below)
//   paddies  a band cut along the cell's way every 14–34 m (square-ish where
//            the cell is gentle and its bands wide) by bunds that turn round,
//            from a slight C to a full round end, staggered level to level
//   flats    on a valley's flat floor, rows along the cell's way 9–16 m wide,
//            gently bowed, cut into plots 1–2.3 rows long, a little askew;
//            each plot level with the ground under its middle, to 5 cm
//
// GPU mirror of plots.ts: change both together.
// Requires: meadow_noise, terraces_common, uRadius.

uniform samplerCube uTerraceBake;   // natural height (m), slope, wild, flat
uniform samplerCube uTerraceLife;   // fog layer A, fog layer B, its cell's season, its cell's slope
uniform samplerCube uTerraceLayout; // its cell's key, along the cell's contour way (m), up its slope (m), to its edge (m)
uniform vec4 uTerraceShape;  // a cell's band (m), its riser between (m), each cell's spread of it
uniform vec4 uTerraceLevels; // each wall's jitter (a level's share), the share of walls left out, the cuts along a band between (m)
uniform vec4 uTerraceWall;   // a riser's batter (m per m of height), a bund's width (m), its height (m), its flat top's share
uniform vec4 uPlots;         // the flats' rows between (m) wide; their plots between (× the row) long
uniform vec4 uLayoutInfo;    // how far in a cell is read near its edge (m), bands wider than this (m) cut square-ish, half the layout's texel (m)

#define PLOT_TERRACE 0
#define PLOT_FLAT 1

struct Plot {
  int kind;       // PLOT_TERRACE or PLOT_FLAT
  uint cell;      // its cell's key
  uint id;        // its own
  float natural;  // the bake's: the hills' own height (m), their slope, wild, flat
  float slope;
  float wild;
  float flatness;
  float season;   // its cell's season (0 planted first … 1 last)
  float floorH;   // its floor (m)
  // on the hills: its band, between its walls
  float u;        // across the levels (continuous)
  float lo;       // its walls (in levels)
  float hi;
  float below;    // the floor beyond its outer wall (m), downhill
  float above;    // beyond its inner wall (m), uphill
  float dOut;     // to its outer wall (m)
  float dIn;      // to its inner wall (m)
  float band;     // its band's width (m)
  float level;    // its band's lower wall (a level), or on the flats its row
  // the bunds across it: its band's cuts and its cell's edge, or the flats' plots
  float dCross;   // to the nearest (m)
  float crossTop; // its crest (m)
  float fl;       // across its band or row, 0 … 1
};

float unitHash(uint h) {
  return float(h >> 8) * (1.0 / 16777216.0);
}

uint nextHash(uint h) {
  return h * 747796405u + 2891336453u;
}

uint plotHash(uint cell, int a, int b, int c, uint salt) {
  return meadowHash(ivec3(a, b, c), (uTerrainSeed ^ (cell * 2654435761u)) + salt);
}

// A cell's key from its baked value ((n + ½) / 1024, exact in a half float).
uint cellKey(float baked) {
  return uint(floor(baked * 1024.0));
}

// A cell's riser (m), from its slope: a band some uTerraceShape.x wide, within reason.
float cellRiser(uint cell, float slope) {
  float s = clamp(slope * uTerraceShape.x, uTerraceShape.y, uTerraceShape.z);
  return s * (1.0 + uTerraceShape.w * (2.0 * unitHash(plotHash(cell, 0, 0, 0, 21u)) - 1.0));
}

// Wall k of a cell: its place across the levels (k, a little off), and whether it is left out (the levels
// either side are then one wide paddy; only even walls, so never two in a row).
float wallAt(uint cell, int k, out bool left) {
  uint h = plotHash(cell, k, 0, 0, 31u);
  left = (k & 1) == 0 && unitHash(h) < uTerraceLevels.y;
  return float(k) + uTerraceLevels.x * (2.0 * unitHash(nextHash(h)) - 1.0);
}

// The walls round u: lo2 < lo ≤ u < hi < hi2 (those left out skipped).
void wallsRound(uint cell, float u, out float lo2, out float lo, out float hi, out float hi2) {
  int k0 = int(floor(u)) - 4;
  float w[10];
  bool left[10];
  for (int i = 0; i < 10; i++) w[i] = wallAt(cell, k0 + i, left[i]);
  int ilo = 0;
  for (int i = 0; i < 10; i++) {
    if (!left[i] && w[i] <= u) ilo = i;
  }
  int ihi = 9;
  for (int i = 9; i >= 0; i--) {
    if (!left[i] && i > ilo) ihi = i;
  }
  int ilo2 = 0;
  for (int i = 0; i < 10; i++) {
    if (!left[i] && i < ilo) ilo2 = i;
  }
  int ihi2 = 9;
  for (int i = 9; i >= 0; i--) {
    if (!left[i] && i > ihi) ihi2 = i;
  }
  lo2 = w[ilo2];
  lo = w[ilo];
  hi = w[ihi];
  hi2 = w[ihi2];
}

// A band's cuts: the band's outer wall shared out among the sites of its level (a site per lattice cell
// `spacing` apart and per level, each with a reach of its own), each point of the band belonging to the site
// nearest the point of the wall straight downhill of it. So the cuts run across the band down the slope,
// wherever the band turns, and stagger from level to level. Toward the walls that point is moved along
// the wall (bow: by how much, a slow noise along it), so the cuts turn round at their ends, from a slight
// C to a full round end. Returns the site's hash and the distance (m) to the nearer cut.
void cutsRound(uint cell, int level, vec3 wallPoint, float spacing, out uint site, out float dist) {
  vec3 q = wallPoint * (uRadius / spacing);
  ivec3 b = ivec3(floor(q));
  float d1 = 1e9;
  float d2 = 1e9;
  site = 0u;
  uint salt = 61u + uint(level + 4096) * 2654435761u;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec3 c = b + ivec3(x, y, z);
        uint h = plotHash(cell, c.x, c.y, c.z, salt);
        vec3 f = vec3(c) + 0.1 + 0.8 * vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
        float d = (length(f - q) + 0.2 * (unitHash(nextHash(h)) - 0.5)) * spacing;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          site = h;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  dist = 0.5 * (d2 - d1);
}

// The flats: row r's lower edge at v along the cell's way (m), gently bowed; and its middle, unbowed.
float rowEdge(uint cell, int r, float v, float W, float phase) {
  uint h = plotHash(cell, r, 0, 0, 53u);
  uint h2 = nextHash(h);
  float bow = mix(0.3, 2.2, unitHash(h)) * sin(v / mix(9.0, 15.0, unitHash(h2)) + 6.2831853 * unitHash(nextHash(h2)));
  return (float(r) - phase + 0.28 * (2.0 * unitHash(h ^ 0x85ebca6bu) - 1.0)) * W + bow;
}

float rowMiddle(uint cell, int r, float W, float phase) {
  float a = float(r) - phase + 0.28 * (2.0 * unitHash(plotHash(cell, r, 0, 0, 53u) ^ 0x85ebca6bu) - 1.0);
  float b = float(r + 1) - phase + 0.28 * (2.0 * unitHash(plotHash(cell, r + 1, 0, 0, 53u) ^ 0x85ebca6bu) - 1.0);
  return 0.5 * (a + b) * W;
}

// The flats: plot j's lower edge along row r (m), a little askew; and its middle, unaskew.
float plotEdge(uint cell, int r, int j, float y, float yMid, float L, float phase, out float lean, out float mid) {
  uint h = plotHash(cell, r, j, 0, 56u);
  lean = 0.25 * (2.0 * unitHash(nextHash(h)) - 1.0);
  mid = (float(j) - phase + 0.3 * (2.0 * unitHash(h) - 1.0)) * L;
  return mid + lean * (y - yMid);
}

// The plots along row r round v: index, the distance to the nearer edge (m), the plot's middle along the way, its length.
void plotsRound(uint cell, int r, float v, float y, float yMid, float W, out int j, out float dist, out float vMid, out float L) {
  uint h = plotHash(cell, r, 0, 0, 54u);
  L = W * mix(uPlots.z, uPlots.w, unitHash(h));
  float phase = unitHash(nextHash(h));
  int j0 = int(floor(v / L + phase)) - 1;
  float c[4];
  float l[4];
  float m[4];
  for (int i = 0; i < 4; i++) c[i] = plotEdge(cell, r, j0 + i, y, yMid, L, phase, l[i], m[i]);
  int k = 0;
  for (int i = 0; i < 4; i++) {
    if (c[i] <= v) k = i;
  }
  k = min(k, 2);
  j = j0 + k;
  dist = max(min((v - c[k]) / sqrt(1.0 + l[k] * l[k]), (c[k + 1] - v) / sqrt(1.0 + l[k + 1] * l[k + 1])), 0.0);
  vMid = 0.5 * (m[k] + m[k + 1]);
}

// The ground (m) under a point of the flats, level to 5 cm: dir moved (along, up) meters along the cell's way and up its slope.
float flatFloorAt(vec3 dir, vec3 tAlong, vec3 tUp, float along, float up) {
  vec3 d = normalize(dir + (tAlong * along + tUp * up) / uRadius);
  return floor(textureLod(uTerraceBake, d, 0.0).r / 0.05 + 0.5) * 0.05;
}

// The ground's way uphill at dir (a unit tangent) and its slope, from the bake 2 m round it (a step long
// enough that the baked height's rounding does not turn it).
vec3 uphillAt(vec3 dir, float h, out float slope) {
  vec3 a;
  vec3 b;
  gradientFrame(dir, a, b);
  float e = 2.0;
  float ha = textureLod(uTerraceBake, normalize(dir + a * (e / uRadius)), 0.0).r - textureLod(uTerraceBake, normalize(dir - a * (e / uRadius)), 0.0).r;
  float hb = textureLod(uTerraceBake, normalize(dir + b * (e / uRadius)), 0.0).r - textureLod(uTerraceBake, normalize(dir - b * (e / uRadius)), 0.0).r;
  vec3 g = (a * ha + b * hb) / (2.0 * e);
  slope = length(g);
  return slope > 1e-5 ? g / slope : a;
}

// The cell's way and slope at dir (unit tangents), from the layout's change round it.
void cellFrame(vec3 dir, vec4 lay, out vec3 tAlong, out vec3 tUp) {
  vec3 a;
  vec3 b;
  gradientFrame(dir, a, b);
  float e = 0.75;
  vec4 la = textureLod(uTerraceLayout, normalize(dir + a * (e / uRadius)), 0.0);
  vec4 lb = textureLod(uTerraceLayout, normalize(dir + b * (e / uRadius)), 0.0);
  vec2 gv = vec2(la.g - lay.g, lb.g - lay.g);
  vec2 gy = vec2(la.b - lay.b, lb.b - lay.b);
  tAlong = dot(gv, gv) > 1e-6 ? normalize(a * gv.x + b * gv.y) : a;
  tUp = dot(gy, gy) > 1e-6 ? normalize(a * gy.x + b * gy.y) : b;
}

// The distance (m) to its cell's edge, from the baked one: interpolated between texels it never quite
// falls to 0 on the edge (the bund along it would come and go), so less half a texel.
float edgeDistance(float baked) {
  return max(baked - uLayoutInfo.z, 0.0);
}

// dir: where the plot is read; base, lay, life: the bakes there (lay and life from inside its cell);
// inside: a point well inside its cell (for the flats' frame).
Plot plotFrom(vec3 dir, vec3 inside, vec4 base, vec4 lay, vec4 life) {
  Plot p;
  p.natural = base.r;
  p.slope = max(base.g, 0.004);
  p.wild = base.b;
  p.flatness = base.a;
  p.season = life.b;
  p.cell = cellKey(lay.r);
  float bh = uTerraceWall.z;
  p.dCross = 1e3;
  p.fl = 0.5;
  p.u = 0.0;
  p.lo = 0.0;
  p.hi = 1.0;
  p.dOut = 1e3;
  p.dIn = 1e3;
  p.band = 1e3;
  if (base.a < 0.5) {
    // on the hills: a band between two walls along the cell's contours
    p.kind = PLOT_TERRACE;
    float slopeC = max(life.a, 0.004);
    float s = cellRiser(p.cell, slopeC);
    float phi = unitHash(plotHash(p.cell, 0, 0, 0, 22u));
    p.u = base.r / s + phi;
    float lo2;
    float hi2;
    wallsRound(p.cell, p.u, lo2, p.lo, p.hi, hi2);
    p.floorH = (0.5 * (p.lo + p.hi) - phi) * s;
    p.below = (0.5 * (lo2 + p.lo) - phi) * s;
    p.above = (0.5 * (p.hi + hi2) - phi) * s;
    float perLevel = s / p.slope;
    p.dOut = (p.u - p.lo) * perLevel;
    p.dIn = (p.hi - p.u) * perLevel;
    p.band = (p.hi - p.lo) * perLevel;
    int level = int(floor(p.lo + 0.5));
    p.level = float(level);
    p.fl = clamp((p.u - p.lo) / (p.hi - p.lo), 0.0, 1.0);
    // the point of its outer wall straight downhill, moved along the wall toward the band's edges
    float slope;
    vec3 up = uphillAt(dir, base.r, slope);
    vec3 along = cross(dir, up);
    float c = 2.0 * p.fl - 1.0;
    float r = sqrt(max(1.0 - c * c, 0.0));
    float bow = 0.62 * gnoise(dir * (uRadius / 23.0), uTerrainSeed + uint(level + 4096) * 747796405u);
    vec3 wallPoint = normalize(dir + (along * (bow * (1.0 - r) * p.band) - up * p.dOut) / uRadius);
    // a gentle cell's wide bands are cut square-ish
    float spacing = mix(uTerraceLevels.z, uTerraceLevels.w, unitHash(plotHash(p.cell, 0, 0, 0, 43u)));
    float bandC = s / slopeC;
    if (bandC > uLayoutInfo.y) spacing = clamp(spacing, 0.9 * bandC, 2.0 * bandC);
    uint site;
    float dCut;
    cutsRound(p.cell, level, wallPoint, spacing, site, dCut);
    // (the cut leans as it turns: the distance across it is shorter than along the wall)
    float lean = bow * clamp(c / max(r, 0.2), -5.0, 5.0);
    p.id = nextHash(site);
    p.dCross = min(dCut / sqrt(1.0 + lean * lean), edgeDistance(lay.a));
    p.crossTop = p.floorH + bh;
  } else {
    // a valley's flat floor: rows along the cell's way, cut into plots
    p.kind = PLOT_FLAT;
    float W = mix(uPlots.x, uPlots.y, unitHash(plotHash(p.cell, 0, 0, 0, 51u)));
    float phase = unitHash(plotHash(p.cell, 0, 0, 0, 52u));
    float v = lay.g;
    float y = lay.b;
    int r0 = int(floor(y / W + phase)) - 1;
    float e[4];
    for (int i = 0; i < 4; i++) e[i] = rowEdge(p.cell, r0 + i, v, W, phase);
    int k = 0;
    for (int i = 0; i < 4; i++) {
      if (e[i] <= y) k = i;
    }
    k = min(k, 2);
    int r = r0 + k;
    float yMid = rowMiddle(p.cell, r, W, phase);
    int j;
    float dPlot;
    float vMid;
    float L;
    plotsRound(p.cell, r, v, y, yMid, W, j, dPlot, vMid, L);
    float dRow = min(y - e[k], e[k + 1] - y);
    p.level = float(r);
    p.id = plotHash(p.cell, r, j, 0, 58u);
    p.fl = clamp((y - e[k]) / max(e[k + 1] - e[k], 1e-3), 0.0, 1.0);
    vec3 tAlong;
    vec3 tUp;
    cellFrame(inside, lay, tAlong, tUp);
    p.floorH = flatFloorAt(inside, tAlong, tUp, vMid - v, yMid - y);
    // the plot across the nearer edge: the bund between them stands over the higher of the two
    float other;
    if (dRow < dPlot) {
      int rn = y - e[k] < e[k + 1] - y ? r - 1 : r + 1;
      float yn = rowMiddle(p.cell, rn, W, phase);
      int jn;
      float dn;
      float vn;
      float Ln;
      plotsRound(p.cell, rn, v, y, yn, W, jn, dn, vn, Ln);
      other = flatFloorAt(inside, tAlong, tUp, vn - v, yn - y);
    } else {
      other = flatFloorAt(inside, tAlong, tUp, vMid - v + (v < vMid ? -L : L), yMid - y);
    }
    p.dCross = min(min(dRow, dPlot), edgeDistance(lay.a));
    p.crossTop = max(p.floorH, other) + bh;
    p.below = p.floorH;
    p.above = p.floorH;
  }
  return p;
}

Plot plotAt(vec3 dir) {
  vec4 base = textureLod(uTerraceBake, dir, 0.0);
  vec4 lay = textureLod(uTerraceLayout, dir, 0.0);
  vec3 inside = dir;
  if (lay.a < uLayoutInfo.x) {
    // near its cell's edge the bakes blend two cells: read the cell from a little way in
    vec3 a;
    vec3 b;
    gradientFrame(dir, a, b);
    float eps = 0.4 / uRadius;
    float ea = textureLod(uTerraceLayout, normalize(dir + a * eps), 0.0).a - lay.a;
    float eb = textureLod(uTerraceLayout, normalize(dir + b * eps), 0.0).a - lay.a;
    vec3 g = a * ea + b * eb;
    vec3 inward = dot(g, g) > 1e-12 ? normalize(g) : a;
    inside = normalize(dir + inward * ((uLayoutInfo.x - lay.a + 0.8) / uRadius));
    lay = vec4(textureLod(uTerraceLayout, inside, 0.0).rgb, lay.a);
  }
  return plotFrom(dir, inside, base, lay, textureLod(uTerraceLife, inside, 0.0));
}
