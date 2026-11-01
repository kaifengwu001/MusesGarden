// The ground: baked chalk shelves (bake.ts) plus the homestead, laid out in
// meters around the cottage. GPU mirror of Terrain.sample (terrain.ts).
// Change both together. Requires: uRadius (globals).

const float COTTAGE_FLAT = 7.5;
const float PLATEAU_INNER = 10.0;
const float PLATEAU_OUTER = 48.0;
const float POND_SLOPE = 0.3;
const float POND_DEPTH = 1.4;
const float POND_BANK = 0.9;
const vec2 HOUSE_FOOTPRINT = vec2(4.45, 2.75); // half sizes (m), terrain.ts
const vec4 TERRACE_AREA = vec4(-4.5, 4.2, -0.2, 4.8); // x0, x1, z0, z1 (m)
const vec4 STEPS_AREA = vec4(1.9, 3.9, 4.6, 5.85);
const vec4 PIER_AREA = vec4(-8.3, -3.3, 1.75, 5.7);
const vec4 CULVERT = vec4(-7.2, 4.6, 0.5, 1.3); // the channel under the pier's arch: centre x, z, half sizes (m)

uniform uint uTerrainSeed;
uniform vec4 uChalk; // relief lift, height cap, bedding height, residual shelf gradient
uniform vec4 uCanyon; // regional canyon fade inner/outer radii
uniform samplerCube uTerrainBake; // smooth relief integer R / fraction B, lushness G, colour variant A
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
  float water;    // dry-world distance sentinel, 1000 m
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

// Reconstruct smooth relief first, then cut the chalk beds. Baking the
// already-stepped height would smear cliffs and disagree with CPU placement.
vec4 terrainFields(vec3 dir) {
  vec4 f = textureLod(uTerrainBake, dir, 0.0);
  float raw = f.r + f.b + uChalk.x;
  float bands = raw / uChalk.z;
  float ledge = (floor(bands) + smoothstep(0.32, 0.68, fract(bands))) * uChalk.z;
  f.r = min(uChalk.y, max(0.35, mix(ledge, raw, uChalk.w)));
  f.b = 0.0;
  return f;
}

// Shelter and resident lanes remain level. Outside them a sequence of broad
// rock ledges rises to the natural terrain, instead of a continuous bowl wall.
float homestead(vec3 dir, float h) {
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  if (dc >= uHomePond.z) return h;
  vec2 c = cottageLocal(dir);
  float l = length(c);
  vec2 ray = l > 1e-6 ? c / l : vec2(1.0, 0.0);
  float boundary = min(14.0 / max(abs(ray.x), 1e-6), (ray.y >= 0.0 ? 24.0 : 5.0) / max(abs(ray.y), 1e-6));
  float edge = dc - asin(min(boundary / uRadius, 0.999)) * uRadius;
  if (edge <= 0.0) return uCottage.w;
  vec2 local = ray * dc;
  float fade = 1.0 - smoothstep(uCanyon.x, uCanyon.y, dc);
  float opening = smoothstep(8.0, 22.0, local.x) * smoothstep(8.0, 26.0, -local.y);
  float uphill = max(smoothstep(14.0, 45.0, -local.x), smoothstep(7.0, 40.0, -local.y) * (1.0 - opening));
  float rise = uChalk.z * smoothstep(0.2, 0.7, uphill * fade);
  float down = max(2.0 * smoothstep(18.0, 54.0, local.x), 3.0 * opening) * fade;
  float fall = uChalk.z * (floor(down) + smoothstep(0.32, 0.68, fract(down)));
  h = max(0.35, h + rise - fall);
  float band = edge / 8.0;
  float steps = uChalk.z * (floor(band) + smoothstep(0.25, 0.55, fract(band)));
  return clamp(h, uCottage.w - steps, uCottage.w + steps);
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
  return homeGround(dir, terrainFields(dir).r);
}

// Retain the homestead's 0.2 m ground offset, with no shoreline distortion.
float banked(float h, float shore) {
  return h + uBank.x;
}

float bankedAt(float h, float shore, float dist) {
  return h + uBank.x;
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
  g.fields = terrainFields(dir);
  float h0 = homeGround(dir, g.fields.r);
  vec3 a, b;
  gradientFrame(dir, a, b);
  float e = uBank.z / uRadius;
  float h1 = height0(normalize(dir + a * e));
  float h2 = height0(normalize(dir + b * e));
  g.slope = length(vec2(h1 - h0, h2 - h0)) / uBank.z;
  g.height0 = h0;
  g.water = 1000.0;
  g.height = h0 + uBank.x;
  g.depth = 0.0;
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

// Soft shadow of the cottage on the ground: its walls, then its hipped roof
// narrowing from the eaves to the ridge (props.ts COTTAGE, ROOF), swept away
// from the sun.
float cottageShadow(vec3 dir) {
  if (chordAngle(dir, uCottage.xyz) * uRadius > 60.0) return 0.0;
  vec2 c = cottageLocal(dir);
  // The woven awning falls from 4.6 m at the back to 3.6 m at the front.
  // Intersect the sun ray with that plane, then test the canopy footprint.
  float height = (4.16 - 0.147 * c.y) / max(0.2, 1.0 + 0.147 * uCottageSun.y);
  vec2 roof = c + uCottageSun.xy * height - vec2(0.0, 0.4);
  float best = height > 0.0 ? boxDistance(roof, vec2(4.85, 3.4)) : 1e3;
  for (int k = 0; k < 6; k++) {
    float h = float(k) * 0.6;
    best = min(best, boxDistance(c + uCottageSun.xy * h - vec2(0.0, -2.3), vec2(4.1, 0.1)));
  }
  return smoothstep(0.3, -0.18, best) * 0.85;
}
