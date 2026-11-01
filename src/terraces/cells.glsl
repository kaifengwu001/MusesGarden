// The terraces' cells, for the bake (bake.frag.glsl): the planet in cells
// some 45–90 m across, a Voronoi tiling in direction space whose edges wander
// (its lattice warped by a slow noise), chosen per octave of R. A cell is a
// system of terraces of its own: its key picks its walls, its cuts and its
// plots (plots.glsl); its frame (the way along its contours and up its slope
// at its middle) lays them out; its slope there sets its riser. CPU mirror:
// TerraceCells in cells.ts.
// Requires: meadow_noise, terraces_common, uRadius, uTSeed (terraces_fields),
// uBakedTerrain (the terrain pass).

uniform vec4 uCells; // lattice frequency (direction space), warp (in cells), the frame's half step (m), -

struct Cell {
  ivec3 id;
  uint key;     // 0 … 1023
  vec3 centre;  // its middle (unit direction)
  float edge;   // distance to its edge (m)
};

vec3 cellFeature(ivec3 c) {
  uint h = meadowHash(c, uTSeed + 811u);
  return vec3(c) + 0.15 + 0.7 * vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
}

vec3 cellWarp(vec3 p) {
  vec3 q = p * 1.9;
  return vec3(gnoise(q, uTSeed + 821u), gnoise(q + vec3(17.3, -4.1, 8.7), uTSeed + 822u), gnoise(q + vec3(-9.1, 13.5, -2.3), uTSeed + 823u));
}

Cell cellAt(vec3 dir) {
  vec3 p = dir * uCells.x;
  p += cellWarp(p) * uCells.y;
  ivec3 b = ivec3(floor(p));
  float d1 = 1e9;
  ivec3 best = b;
  vec3 f1 = p;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec3 c = b + ivec3(x, y, z);
        vec3 f = cellFeature(c);
        float d = dot(f - p, f - p);
        if (d < d1) {
          d1 = d;
          best = c;
          f1 = f;
        }
      }
    }
  }
  // the distance to its edge: to the nearest bisector between its feature and a neighbour's
  float edge = 1e9;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec3 c = b + ivec3(x, y, z);
        if (c == best) continue;
        vec3 f = cellFeature(c);
        vec3 n = f - f1;
        edge = min(edge, dot(0.5 * (f + f1) - p, n) / length(n));
      }
    }
  }
  Cell cell;
  cell.id = best;
  // (offset as cells.ts offsets it: the hash is the same for two cells mirrored through the origin's axes)
  cell.key = (meadowHash(best + ivec3(1531, 2833, 4093), uTSeed + 812u) >> 8) & 1023u;
  cell.centre = normalize(f1);
  cell.edge = max(edge, 0.0) / uCells.x * uRadius;
  return cell;
}

// A cell's frame at its middle: the way along its contours and up its slope (unit tangents), and its slope,
// from the baked ground a few meters round (a flat cell gets a way of its own).
void cellFrameAt(Cell c, out vec3 along, out vec3 up, out float slope) {
  vec3 a;
  vec3 b;
  gradientFrame(c.centre, a, b);
  float e = uCells.z / uRadius;
  float ha = textureLod(uBakedTerrain, normalize(c.centre + a * e), 0.0).r - textureLod(uBakedTerrain, normalize(c.centre - a * e), 0.0).r;
  float hb = textureLod(uBakedTerrain, normalize(c.centre + b * e), 0.0).r - textureLod(uBakedTerrain, normalize(c.centre - b * e), 0.0).r;
  vec2 g = vec2(ha, hb) / (2.0 * uCells.z);
  slope = length(g);
  if (slope > 1e-3) {
    up = normalize(a * g.x + b * g.y);
  } else {
    float th = 6.2831853 * float(c.key) / 1024.0;
    up = a * cos(th) + b * sin(th);
  }
  along = normalize(cross(c.centre, up));
}

// A cell's slope: the mean over its terraceable ground round its middle, in two rings (its riser follows
// it, so its bands are about as wide wherever the cell lies; its middle alone may sit on a valley floor).
float cellSlope(Cell c) {
  vec3 a;
  vec3 b;
  gradientFrame(c.centre, a, b);
  float size = uRadius / uCells.x;
  float sum = 0.0;
  float n = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = (i < 4 ? 0.18 : 0.4) * size;
    float th = (i < 4 ? float(i) / 4.0 : float(i - 4) / 8.0 + 0.0625) * 6.2831853;
    vec4 t = textureLod(uBakedTerrain, normalize(c.centre + (a * cos(th) + b * sin(th)) * (r / uRadius)), 0.0);
    if (t.a < 0.5 && t.b < 0.5) {
      sum += t.g;
      n += 1.0;
    }
  }
  return n > 0.0 ? sum / n : textureLod(uBakedTerrain, c.centre, 0.0).g;
}

// The layout pass: its cell's key ((n + ½) / 1024), where it lies along the cell's way and up its slope
// from its middle (m), and its distance to the cell's edge (m).
vec4 terraceLayout(vec3 dir) {
  Cell c = cellAt(dir);
  vec3 along;
  vec3 up;
  float slope;
  cellFrameAt(c, along, up, slope);
  vec3 d = (dir - c.centre) * uRadius;
  return vec4((float(c.key) + 0.5) / 1024.0, dot(d, along), dot(d, up), c.edge);
}
