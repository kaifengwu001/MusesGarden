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
uniform vec4 uHomeShape;          // outline amplitudes 1–3, how far from its centre the pond shapes the ground (m)
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
// Most of the planet is far from it, and much of what is near is neither on
// the plateau nor near the pond: cheap tests first (the reflections' march
// calls this a dozen times a pixel).
float homestead(vec3 dir, float h) {
  vec3 off = dir - uCottage.xyz;
  // (a chord is never longer than its arc: beyond the reach is beyond it on the planet too)
  if (dot(off, off) * uRadius * uRadius > uHomePond.z * uHomePond.z) return h;
  // cottage-local meters (cottageLocal), never more than the distance on the planet
  vec2 c = vec2(dot(off, cross(uCottage.xyz, uCottageB.xyz)), dot(off, uCottageB.xyz)) * uRadius;
  vec2 pc = vec2(c.x + uHomePond.w, c.y - uHomePond.y);
  bool pond = dot(pc, pc) < uHomeShape.w * uHomeShape.w;
  bool plateau = dot(c, c) < PLATEAU_OUTER * PLATEAU_OUTER;
  if (!pond && !plateau) return h;
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  float dry = smoothstep(PLATEAU_OUTER, PLATEAU_INNER, dc);
  h += (max(h, 0.4) * 0.5 + 0.25 - h) * dry;
  float flat_ = smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
  h += (uCottage.w - h) * flat_;
  // the pond, only where it can shape the ground (near its middle: past its widest outline its
  // banks rise above any ground there is)
  if (pond) {
    float d = homePond(dir);
    h = min(h, max(d * (d > 0.0 ? POND_BANK : POND_SLOPE), -POND_DEPTH));
  }
  // the channel under the pier's arch (it reaches about 11 m from the cottage's middle)
  if (dc > 12.0) return h;
  vec2 q = abs(c - CULVERT.xy) - CULVERT.zw;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return min(h, max(box * 4.0 - 0.3, -0.5));
}

// The homestead applied to a natural height h, or not at all where it reaches
// none of the ground (BAKED_GROUND: the vertices of terrain far from it, surface.ts).
float homeGround(vec3 dir, float h) {
#ifdef BAKED_GROUND
  return h;
#else
  return homestead(dir, h);
#endif
}

// Ground height before the bank lip (m above the water table).
float height0(vec3 dir) {
  return homeGround(dir, textureLod(uTerrainBake, dir, 0.0).r);
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
  float h0 = homeGround(dir, g.fields.r);
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
#ifdef BAKED_GROUND
  g.clearing = 0.0;
#else
  g.clearing = clearingAt(dir, chordAngle(dir, uCottage.xyz) * uRadius);
#endif
  return g;
}

float boxDistance(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Soft shadow of the open pavilion's roof only, swept away from the sun.
// No solid wall volume is implied below its eaves. The legacy function name
// is retained for the ground-paint contract; dimensions follow props.ts ROOF.
float cottageShadow(vec3 dir) {
  // cottageLocal folds the far side onto the home: reject by true distance.
  if (chordAngle(dir, uCottage.xyz) * uRadius > 60.0) return 0.0;
  vec2 c = cottageLocal(dir);
  // Gentle 0.46-radian pitch: eave 3.347 m, ridge 4.873 m before slight sag.
  if (boxDistance(c, vec2(4.75, 3.08)) > 4.96 * length(uCottageSun.xy) + 0.5) return 0.0;
  float best = 1e3;
  for (int k = 0; k <= 12; k++) {
    float t = float(k) / 12.0;
    // Match the shallow concave face and lifted lower edge. Corner upturns
    // add at most 0.48 m locally; the soft edge absorbs that small detail.
    float h = 3.347 + 1.526 * t - 0.22 * sin(3.14159265 * t)
      + 0.09 * pow(1.0 - t, 4.0) - 0.07 * t * t;
    vec2 half_ = mix(vec2(4.75, 3.08), vec2(1.67, 0.05), t);
    best = min(best, boxDistance(c + uCottageSun.xy * h, half_));
  }
  return 1.0 - smoothstep(-0.3, 0.4, best);
}
