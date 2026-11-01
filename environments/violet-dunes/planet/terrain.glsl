// The ground: the baked dunes (bake.ts) plus the homestead, laid out in
// meters around the shelter. GPU mirror of Terrain.sample (terrain.ts).
// Change both together. Requires: uRadius (globals).
//
// A dry world: no water table, shore or bank lip. Ground.water is a constant
// far from any shore and depth is 0, so the shared shaders that read them
// (field map, petals, grass) see dry land everywhere; uBank keeps a positive
// width and slope (they divide by them) and a lip of zero height.

const float ORCHARD_REACH = 112.0;
const float HOME_FLAT = 4.8;
const float HOME_BLEND = 7.2;
const float HOME_CALM = 12.0;
const float HOME_CALM_KEEP = 0.78;
const float CLEARING_REACH = 17.0;
const float DRY_SHORE = 100.0;
const vec2 PLINTH_HALF = vec2(2.5, 2.4);           // half sizes (m), terrain.ts
const vec4 APPROACH_AREA = vec4(-1.5, 1.5, 2.4, 15.0); // x0, x1, z0, z1 (m)
const vec4 MUSE_APRON = vec4(-2.6, 2.6, 2.4, 3.8);
// the shelter's shadow volume (terrain.ts SHELTER_SHADOW)
const float SHADOW_PLINTH = 0.25;
const vec2 SHADOW_WALL = vec2(2.2, 1.8);
const float SHADOW_EAVE = 2.2;
const vec2 SHADOW_ROOF = vec2(2.5, 2.3);
const float SHADOW_RIDGE = 3.45;

uniform uint uTerrainSeed;
uniform samplerCube uTerrainBake; // natural height (m), sand tone, habitat, colour variant
uniform samplerCube uFloraBake;   // starflowers per m² in channel 1
uniform vec4 uBank;               // bank height (0 m), bank width (m), gradient step (m), minimum slope
uniform vec4 uCottage;            // the shelter's direction, its pad's level (m)
uniform vec4 uCottageB;           // toward the shelter's front
uniform vec4 uCottageSun;         // shadow sweep per meter of height in shelter-local x, z

struct Ground {
  float height;   // ground above the base sphere, m
  float height0;  // the same (no bank lip in a dry world)
  float water;    // distance to the shore, m: DRY_SHORE
  float depth;    // water depth, m: 0
  float clearing; // the shelter's clearing 0..1
  float slope;    // |∇h|, m per m
  vec4 fields;    // natural height, sand tone, habitat, colour variant
};

float chordAngle(vec3 a, vec3 b) {
  return 2.0 * asin(clamp(0.5 * length(a - b), 0.0, 1.0));
}

// Shelter-local meters: x across, z toward its front (mirrors Terrain.cottageLocal).
vec2 cottageLocal(vec3 dir) {
  vec3 off = dir - uCottage.xyz;
  return vec2(dot(off, cross(uCottage.xyz, uCottageB.xyz)), dot(off, uCottageB.xyz)) * uRadius;
}

// The homestead's calmed dunes and flat pad, applied to the natural height h.
float homestead(vec3 dir, float h) {
  vec3 off = dir - uCottage.xyz;
  // (a chord is never longer than its arc: beyond the reach is beyond it on the planet too)
  if (dot(off, off) * uRadius * uRadius > ORCHARD_REACH * ORCHARD_REACH) return h;
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  if (dc < ORCHARD_REACH) {
    vec2 c = cottageLocal(dir);
    vec4 ridge[3];
    ridge[0] = vec4(28.0, -28.0, 10.0, 16.0);
    ridge[1] = vec4(-25.0, -62.0, 11.0, 15.0);
    ridge[2] = vec4(25.0, -95.0, 15.0, 16.0);
    float lengths[3]; lengths[0] = 30.0; lengths[1] = 30.0; lengths[2] = 40.0;
    float dunes = 0.0;
    for (int i = 0; i < 3; i++) {
      float x = c.x - ridge[i].x;
      float dx = x / lengths[i];
      float dz = c.y - ridge[i].y - 0.22 * x - 0.006 * x * x;
      float q = dz / (dz < 0.0 ? ridge[i].w * 2.2 : ridge[i].w);
      float profile = max(0.0, 1.0 - sqrt(q * q + 0.0009));
      dunes += ridge[i].z * profile * exp(-dx * dx);
    }
    h += dunes * smoothstep(14.0, 24.0, dc) * (1.0 - smoothstep(90.0, ORCHARD_REACH, dc));
  }
  if (dc > HOME_CALM) return h;
  float level = uCottage.w;
  h = level + (h - level) * (HOME_CALM_KEEP + (1.0 - HOME_CALM_KEEP) * smoothstep(HOME_BLEND, HOME_CALM, dc));
  return h + (level - h) * smoothstep(HOME_BLEND, HOME_FLAT, dc);
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

// Ground height (m above the base sphere).
float height0(vec3 dir) {
  return homeGround(dir, textureLod(uTerrainBake, dir, 0.0).r);
}

// The old bank lip, for the shared shaders that still apply it: zero height (uBank.x).
float banked(float h, float shore) {
  return h + uBank.x * tanh(shore / uBank.y);
}

float bankedAt(float h, float shore, float dist) {
  return h + uBank.x * tanh(shore / max(uBank.y * 1.6, 0.035 * dist));
}

float areaClear(vec2 c, vec4 a) {
  return smoothstep(0.35, 0.0, max(max(a.x - c.x, c.x - a.y), max(a.z - c.y, c.y - a.w)));
}

float clearingAt(vec3 dir, float dc) {
  if (dc > CLEARING_REACH) return 0.0;
  vec2 c = cottageLocal(dir);
  vec2 d = abs(c) - PLINTH_HALF;
  float plinth = smoothstep(0.3, 0.0, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
  return max(plinth, max(areaClear(c, APPROACH_AREA), areaClear(c, MUSE_APRON)));
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
  g.water = DRY_SHORE;
  g.height = h0;
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

// Soft shadow of the shelter on the ground: its walls on the plinth, then its
// gable roof narrowing across from the eaves to the ridge (which runs front to
// back), swept away from the sun. The name is the meadow's, kept for the
// shaders that call it.
float cottageShadow(vec3 dir) {
  // (cottageLocal folds the far side of the planet onto the shelter: measure the true distance first)
  if (chordAngle(dir, uCottage.xyz) * uRadius > 60.0) return 0.0;
  vec2 c = cottageLocal(dir);
  // nowhere farther from the eaves than the shadow of the ridge can reach (most of the ground: no steps)
  if (boxDistance(c, SHADOW_ROOF) > SHADOW_RIDGE * length(uCottageSun.xy) + 0.5) return 0.0;
  float best = 1e3;
  for (int k = 1; k <= 13; k++) {
    float h = SHADOW_PLINTH + (SHADOW_RIDGE - SHADOW_PLINTH) * float(k) / 13.0;
    float roof = clamp((h - SHADOW_EAVE) / (SHADOW_RIDGE - SHADOW_EAVE), 0.0, 1.0);
    vec2 half_ = h < SHADOW_EAVE ? SHADOW_WALL : vec2(mix(SHADOW_ROOF.x, 0.05, roof), SHADOW_ROOF.y);
    best = min(best, boxDistance(c + uCottageSun.xy * h, half_));
  }
  return smoothstep(0.4, -0.3, best);
}
