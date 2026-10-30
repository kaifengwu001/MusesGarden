// The ground: the baked meadow (bake.ts) plus the homestead, laid out in
// meters around the cottage. GPU mirror of Terrain.sample (terrain.ts).
// Change both together. Requires: uRadius (globals).

const float COTTAGE_FLAT = 7.5;
const float PLATEAU_INNER = 10.0;
const float PLATEAU_OUTER = 26.0;
const float POND_SLOPE = 0.3;
const float POND_DEPTH = 1.4;
const float POND_BANK = 0.9;
const vec2 HOUSE_FOOTPRINT = vec2(4.45, 2.75); // half sizes (m), terrain.ts
const vec4 TERRACE_AREA = vec4(-4.5, 4.2, -0.2, 4.8); // x0, x1, z0, z1 (m)
const vec4 STEPS_AREA = vec4(1.9, 3.9, 4.6, 5.85);
const vec4 PIER_AREA = vec4(-8.3, -3.3, 1.75, 5.7);
const vec4 CULVERT = vec4(-7.2, 4.6, 0.5, 1.3); // the channel under the pier's arch: centre x, z, half sizes (m)

uniform uint uTerrainSeed;
uniform samplerCube uTerrainBake; // natural height (m), lushness, wetness, colour variant
uniform samplerCube uFloraBake;   // flowers per m²: pink, star, yellow, blue
uniform vec4 uBank;               // bank height (m), bank width (m), gradient step (m), minimum slope
uniform vec4 uCottage;            // direction, clearing level (m)
uniform vec4 uCottageB;           // toward the pond
uniform vec4 uHomePond;           // radius (m), centre along the bearing (m), reach (m), how far left of the middle (m)
uniform vec4 uHomeShape;          // outline amplitudes 1–3
uniform vec4 uHomePhase;          // outline phases 1–3
uniform vec4 uHomeIslet;          // pond-normalised x, y, radius
uniform vec4 uCottageSun;         // shadow sweep per meter of height in cottage-local x, z

struct Ground {
  float height;   // ground or water surface above the base sphere, m
  float height0;  // before the bank lip, m
  float water;    // signed distance to the shore, m (negative on the water)
  float depth;    // water depth, m (0 on land)
  float clearing; // cottage clearing 0..1
  float slope;    // |∇h|, m per m
  vec4 fields;    // natural height, lushness, wetness, colour variant
};

float chordAngle(vec3 a, vec3 b) {
  return 2.0 * asin(clamp(0.5 * length(a - b), 0.0, 1.0));
}

// Cottage-local meters: x across, z toward the pond (mirrors Terrain.cottageLocal).
vec2 cottageLocal(vec3 dir) {
  vec3 off = dir - uCottage.xyz;
  return vec2(dot(off, cross(uCottage.xyz, uCottageB.xyz)), dot(off, uCottageB.xyz)) * uRadius;
}

float homePond(vec3 dir) {
  float r = uHomePond.x;
  vec2 c = cottageLocal(dir);
  vec2 q = vec2(-(c.y - uHomePond.y), c.x + uHomePond.w) / r; // x toward the cottage
  float th = atan(q.y, q.x);
  float sdf = (length(q) - (1.0 + uHomeShape.x * cos(th - uHomePhase.x) + uHomeShape.y * cos(2.0 * th - uHomePhase.y) + uHomeShape.z * cos(3.0 * th - uHomePhase.z))) * r;
  return max(sdf, -(length(q - uHomeIslet.xy) - uHomeIslet.z) * r);
}

// The homestead's plateau, clearing and pond, applied to the natural height h.
float homestead(vec3 dir, float h) {
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  if (dc > uHomePond.z && dc > PLATEAU_OUTER) return h;
  float dry = smoothstep(PLATEAU_OUTER, PLATEAU_INNER, dc);
  h += (max(h, 0.4) * 0.5 + 0.25 - h) * dry;
  float flat_ = smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
  h += (uCottage.w - h) * flat_;
  float d = homePond(dir);
  h = min(h, max(d * (d > 0.0 ? POND_BANK : POND_SLOPE), -POND_DEPTH));
  // the channel under the pier's arch
  vec2 q = abs(cottageLocal(dir) - CULVERT.xy) - CULVERT.zw;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return min(h, max(box * 4.0 - 0.3, -0.5));
}

// Ground height before the bank lip (m above the water table).
float height0(vec3 dir) {
  return homestead(dir, textureLod(uTerrainBake, dir, 0.0).r);
}

// Land lifts a little at the shore, the water drops off: h plus a lip.
float banked(float h, float shore) {
  return h + uBank.x * tanh(shore / uBank.y);
}

// The same lip for the mesh, seen from `dist` m: never steeper than the grid
// there can draw (CDLOD spacing grows with distance), so far shores do not
// saw-tooth. A function of distance, not of the node, so it stays watertight.
float bankedAt(float h, float shore, float dist) {
  return h + uBank.x * tanh(shore / max(uBank.y * 1.6, 0.035 * dist));
}

float areaClear(vec2 c, vec4 a) {
  return smoothstep(0.35, 0.0, max(max(a.x - c.x, c.x - a.y), max(a.z - c.y, c.y - a.w)));
}

float clearingAt(vec3 dir, float dc) {
  if (dc > 9.0) return 0.0;
  vec2 c = cottageLocal(dir);
  vec2 d = abs(c) - HOUSE_FOOTPRINT;
  float house = smoothstep(0.3, 0.0, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
  return max(max(house, areaClear(c, TERRACE_AREA)), max(areaClear(c, STEPS_AREA), areaClear(c, PIER_AREA)));
}

void gradientFrame(vec3 dir, out vec3 a, out vec3 b) {
  a = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  b = cross(dir, a);
}

Ground sampleGround(vec3 dir) {
  Ground g;
  g.fields = textureLod(uTerrainBake, dir, 0.0);
  float h0 = homestead(dir, g.fields.r);
  vec3 a, b;
  gradientFrame(dir, a, b);
  float e = uBank.z / uRadius;
  float h1 = height0(normalize(dir + a * e));
  float h2 = height0(normalize(dir + b * e));
  g.slope = length(vec2(h1 - h0, h2 - h0)) / uBank.z;
  g.height0 = h0;
  g.water = h0 / max(g.slope, uBank.w);
  float hb = banked(h0, g.water);
  g.height = max(hb, 0.0);
  g.depth = max(-hb, 0.0);
  g.clearing = clearingAt(dir, chordAngle(dir, uCottage.xyz) * uRadius);
  return g;
}

float boxDistance(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Soft shadow of the cottage on the ground: its walls, then its hipped roof
// narrowing from the eaves to the ridge (props.ts COTTAGE, ROOF), swept away
// from the sun.
float cottageShadow(vec3 dir) {
  // (cottageLocal folds the far side of the planet onto the cottage: measure the true distance first)
  if (chordAngle(dir, uCottage.xyz) * uRadius > 60.0) return 0.0;
  vec2 c = cottageLocal(dir);
  // nowhere farther from the eaves than the shadow of the ridge can reach (most of the ground: no steps)
  if (boxDistance(c, vec2(4.75, 3.08)) > 6.2 * length(uCottageSun.xy) + 0.5) return 0.0;
  float best = 1e3;
  for (int k = 0; k <= 13; k++) {
    float h = 0.48 * float(k);
    // walls to the eaves (3.12 m), then the roof from its eaves (4.75 × 3.08 m) to the ridge (6.2 m, 1.67 × 0)
    float roof = clamp((h - 3.12) / 3.08, 0.0, 1.0);
    vec2 half_ = h < 3.12 ? vec2(4.3, 2.63) : mix(vec2(4.75, 3.08), vec2(1.67, 0.05), roof);
    best = min(best, boxDistance(c + uCottageSun.xy * h, half_));
  }
  return smoothstep(0.4, -0.3, best);
}
