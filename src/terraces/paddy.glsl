// Paddies (ARCHITECTURE.md, "A hill turned into terraces"). A level's band
// is divided into paddies by cross-bunds that run across it: the planet is
// tiled into cells about CELL_M wide (Voronoi in direction space, the tiling
// chosen per octave of R), and within a cell each level is cut every 9–22 m
// (its own spacing and phase) along the contour's way at the cell's middle,
// so the cuts run downhill, staggered from level to level; the cell's own
// edge is a cut too. A paddy (cell, level, place along the band) then
// decides its infill: how far through the season it is (the season field
// over the hillsides and a chance of its own), or left fallow.
// GPU mirror of paddyAt in terrain.ts.
// Requires: meadow_noise (meadowHash), terraces_common, terraces_ground.

uniform vec4 uPaddy; // cell frequency (direction space), the season's front, -, -

struct Paddy {
  uint id;
  vec3 centre;    // its cell's middle (unit direction)
  vec3 along;     // the band's way there (unit tangent)
  float wall;     // distance (m) to the nearest cross-bund: a cut across the band or the cell's edge
  float variant;  // 0..1, its colour
  float maturity; // 0 flooded … 1 ripe
  float fallow;   // 1: left fallow this season
  float rows;     // 0..1, its rows' turn
};

const float PADDY_SEASON_SPREAD = 0.42;
const vec2 PADDY_CUTS = vec2(9.0, 22.0); // the cuts' spacing along a band (m)
const float PADDY_FALLOW = 0.05;         // share of paddies left fallow

float unitHash(uint h) {
  return float(h >> 8) * (1.0 / 16777216.0);
}

// The Voronoi cell of a direction: its feature point, its lattice cell, and
// the distance (m) to its nearest edge (half the gap between the nearest two
// feature points: exact on the line between them, a little short elsewhere).
void paddyCell(vec3 dir, out vec3 centre, out ivec3 cell, out float edge) {
  vec3 p = dir * uPaddy.x;
  ivec3 base = ivec3(floor(p));
  float d1 = 1e9;
  float d2 = 1e9;
  centre = dir;
  cell = base;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec3 c = base + ivec3(x, y, z);
        uint h = meadowHash(c, uTerrainSeed + 811u);
        vec3 j = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
        vec3 q = vec3(c) + 0.15 + 0.7 * j - p;
        float d = dot(q, q);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          centre = vec3(c) + 0.15 + 0.7 * j;
          cell = c;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  edge = 0.5 * (sqrt(d2) - sqrt(d1)) / uPaddy.x * uRadius;
  centre = normalize(centre);
}

// The contour's way at a direction: across the hills' slope there (from the baked height).
vec3 contourAt(vec3 d) {
  vec3 a;
  vec3 b;
  gradientFrame(d, a, b);
  float e = 2.0 / uRadius;
  float h0 = textureLod(uTerraceBake, d, 0.0).r;
  float ha = textureLod(uTerraceBake, normalize(d + a * e), 0.0).r - h0;
  float hb = textureLod(uTerraceBake, normalize(d + b * e), 0.0).r - h0;
  vec3 up = a * ha + b * hb;
  return dot(up, up) > 1e-10 ? normalize(cross(d, up)) : a;
}

// How far through the season a paddy is from its delay (0 planted first … 1 last): 0 still flooded … 1 ripe.
float paddyMaturity(float delay) {
  return clamp((uPaddy.y - delay) / PADDY_SEASON_SPREAD, 0.0, 1.0);
}

Paddy paddyAt(vec3 dir, float level) {
  Paddy p;
  ivec3 cell;
  float edge;
  paddyCell(dir, p.centre, cell, edge);
  p.along = contourAt(p.centre);
  // this level's cuts in this cell: their spacing and phase
  uint lh = meadowHash(cell, uTerrainSeed + 813u + uint(int(level) + 4096) * 2654435761u);
  float spacing = mix(PADDY_CUTS.x, PADDY_CUTS.y, unitHash(lh));
  float s = dot(dir - p.centre, p.along) * uRadius / spacing + unitHash(lh * 747796405u + 2891336453u);
  float k = floor(s);
  p.wall = min(edge, (0.5 - abs(s - k - 0.5)) * spacing);
  p.id = meadowHash(cell, uTerrainSeed + 812u + uint(int(level) + 4096) * 2654435761u + uint(int(k) + 1024) * 40503u);
  p.variant = unitHash(p.id);
  p.rows = unitHash(p.id * 747796405u + 2891336453u);
  float chance = unitHash(p.id ^ 0x9e3779b9u);
  // (mostly its own: neighbouring bands are at different stages, white flooded fields among the green, as
  // in the painting; the season field only leans whole hillsides earlier or later)
  float delay = clamp(0.3 * textureLod(uTerraceLife, p.centre, 0.0).b + 0.7 * chance, 0.0, 1.0);
  p.maturity = paddyMaturity(delay);
  p.fallow = step(unitHash(p.id ^ 0x85ebca6bu), PADDY_FALLOW);
  return p;
}
