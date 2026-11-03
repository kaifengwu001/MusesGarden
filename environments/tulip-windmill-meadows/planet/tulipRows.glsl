// The cultivated grid, the GPU mirror of life/fieldGrid.ts and the lawn test
// of farmGround() in life/farmLayout.ts. Change them together.
// Requires: uRadius, and uCottage, uCottageB and boxDistance (meadow_terrain).

uniform int uFarmCount;
uniform vec4 uFarmUp[20];     // xyz: farm direction, w: scale
uniform vec4 uFarmAcross[20]; // xyz: across, w: where the walk meets the front track (local units)
uniform vec4 uFarmAlong[20];  // xyz: along the ribbon, w: cos of the lot's angular reach
uniform vec4 uFarmLot[20];    // first and last stripe, field z of the back and front tracks

// In the band, longitude and latitude about the home's bearing (×128). Past
// the cross track nearest ±35° latitude, each polar cap takes azimuthal-
// equidistant coordinates about its pole, so its rows keep their width
// instead of narrowing to a point. A cap's z lies beyond ±500.
const float CAP_NORTH = 78.0;
const float CAP_SOUTH = -78.0 - 0.035 * 52.0;
const float TRACK = 0.035 * 52.0;

float tulipRegion(vec3 dir) {
  float z = asin(clamp(dot(dir, uCottageB.xyz), -1.0, 1.0)) * 128.0;
  return z > CAP_NORTH ? 1.0 : (z < CAP_SOUTH ? -1.0 : 0.0);
}

vec2 tulipFieldIn(vec3 dir, float region) {
  vec3 right = normalize(cross(uCottage.xyz, uCottageB.xyz));
  float u = dot(dir, right), v = dot(dir, uCottage.xyz), w = dot(dir, uCottageB.xyz);
  if (region == 0.0) return vec2(atan(u, v), asin(clamp(w, -1.0, 1.0))) * 128.0;
  float s = length(vec2(u, v));
  float f = s > 1e-6 ? atan(s, region * w) / s * 128.0 : 128.0;
  return vec2(u, v) * f + (region > 0.0 ? vec2(1210.0, 1092.0) : vec2(-1650.0, -1196.0));
}

vec2 tulipField(vec3 dir) { return tulipFieldIn(dir, tulipRegion(dir)); }

float tulipPhase(vec2 xz) { return (xz.x + xz.y * 0.18 + 3.0 * sin(xz.y / 27.0) + 24.0) / 9.0; }

// hash32, mix and unit of src/core/hash.ts, bit for bit.
uint tulipHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  return x ^ (x >> 16u);
}
uint tulipMix(uint h, int v) { return tulipHash(h ^ (uint(v) * 0x9e3779b9u + 0x7f4a7c15u)); }
float tulipH(int a, int b, int c) {
  uint h = tulipMix(tulipMix(tulipMix(0x74756c70u, a), b), c);
  return float(h >> 8u) * (1.0 / 16777216.0);
}

bool tulipHome(int i) { return i >= -4 && i <= 8; }
bool tulipDouble(int j) { return !tulipHome(2 * j) && !tulipHome(2 * j + 1) && tulipH(1, j, 0) < 0.3; }
bool tulipBreaks(int lead, int n) {
  if (n == -1 || n == 2) return true;
  if (tulipHome(lead) && (n == 0 || n == 1)) return true;
  int offset = int(floor(tulipH(2, lead, 0) * 4.0));
  if ((n + offset + 4000) % 4 == 0) return true;
  return tulipH(3, lead, n) < 0.35;
}
int tulipRunStart(int lead, int k) {
  for (int n = k; n > k - 3; n--) if (tulipBreaks(lead, n)) return n;
  return k - 3;
}

struct TulipCell {
  float stripe, across, along, colour;
  bool rowGap, runEnd, fallow;
};

TulipCell tulipCell(vec2 xz) {
  TulipCell c;
  float p = tulipPhase(xz), u = (xz.y + 26.0) / 52.0;
  int i = int(floor(p)), k = int(floor(u)), j = int(floor(float(i) * 0.5));
  bool twin = tulipDouble(j);
  int lead = twin ? 2 * j : i, start = tulipRunStart(lead, k);
  c.stripe = float(i);
  c.across = p - floor(p);
  c.along = u - floor(u);
  c.rowGap = !(twin && i == 2 * j);
  c.runEnd = tulipBreaks(lead, k + 1);
  c.colour = tulipHome(lead) ? float((lead + start + 6000) % 6) : floor(tulipH(4, lead, start) * 6.0);
  c.fallow = !tulipHome(lead) && (tulipH(5, int(floor(float(lead) / 6.0)), start) < 0.16 || tulipH(6, lead, start) < 0.03);
  return c;
}

// x: 1 on a farm's lawn, y: soil (0–1) on its walk, apron and lawn tracks.
vec2 tulipFarmGround(vec3 dir) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < 20; i++) {
    if (i >= uFarmCount) break;
    float facing = dot(dir, uFarmUp[i].xyz);
    if (facing < uFarmAlong[i].w) continue;
    vec2 c = vec2(dot(dir, uFarmAcross[i].xyz), dot(dir, uFarmAlong[i].xyz)) * uRadius / (uFarmUp[i].w * facing);
    float walk = (1.0 - smoothstep(0.33, 0.45, abs(c.x - 0.9))) * step(3.75, c.y) * step(c.y, uFarmAcross[i].w);
    float apron = 1.0 - smoothstep(0.0, 0.12, boxDistance(c - vec2(0.9, 4.2), vec2(2.35, 0.45)) - 0.15);
    g.y = max(g.y, max(walk, apron));
    vec4 lot = uFarmLot[i];
    vec2 xz = tulipFieldIn(dir, lot.z > 500.0 ? 1.0 : (lot.z < -500.0 ? -1.0 : 0.0));
    float p = tulipPhase(xz), s = floor(p);
    if (s < lot.x || s > lot.y) continue;
    if (xz.y >= lot.z && xz.y <= lot.w) {
      // The last stripe's own row gap stays soil, from the field rule.
      if (!(s == lot.y && p - s > 0.925)) g.x = 1.0;
    } else {
      float beyond = max(xz.y - lot.w, lot.z - xz.y);
      g.y = max(g.y, 1.0 - smoothstep(TRACK - 0.3, TRACK, beyond));
    }
  }
  return g;
}
