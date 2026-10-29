// GPU mirror of Terrain.sample (terrain.ts). Change both together.
// Requires: meadow_noise, and uRadius (globals).

#define MEADOW_OCTAVES 8
#define MAX_PONDS 6
#define MAX_ISLETS 8
const float MEADOW_BASE_FREQ = 1.6;
const float RANGE_INNER = 0.07;
const float RANGE_OUTER = 0.24;
const float COTTAGE_FLAT = 5.5;

uniform uint uTerrainSeed;
uniform float uMeadowAmp[MEADOW_OCTAVES];
uniform float uMacroAmp;
uniform vec4 uMountain; // max height (m), spur unlock
uniform vec3 uRangeA;
uniform vec3 uRangeB;
uniform vec3 uSpurA;
uniform vec3 uSpurB;
uniform vec4 uWater; // channel half width (m), meander 1, meander 2, branch unlock
uniform samplerCube uChannelField; // angular distance (rad) per meander level 0, 1, 2 and the branch
uniform vec4 uPondA[MAX_PONDS]; // centre, radius (m; 0 = off)
uniform vec4 uPondB[MAX_PONDS]; // tangent t1, water level (m)
uniform vec4 uPondC[MAX_PONDS]; // outline amplitudes 1–3, first islet
uniform vec4 uPondD[MAX_PONDS]; // outline phases 1–3, islet count
uniform vec4 uIslets[MAX_ISLETS]; // pond-normalised x, y, radius
uniform vec4 uCottage; // direction, clearing level (m)
uniform vec4 uCottageB; // toward the pond
uniform vec4 uCottageSun; // shadow sweep per meter of height in cottage-local x, z

struct Ground {
  float height;   // above the base sphere, m
  float water;    // signed distance to water, m (negative inside)
  float mountain; // mountain mask 0..1
  float rock;     // mountain height / max height
  float clearing; // cottage clearing 0..1
};

float chordAngle(vec3 a, vec3 b) {
  return 2.0 * asin(clamp(0.5 * length(a - b), 0.0, 1.0));
}

float arcDistance(vec3 p, vec3 a, vec3 b) {
  vec3 n = normalize(cross(a, b));
  float s = dot(p, n);
  vec3 q = p - s * n;
  bool inside = dot(cross(a, q), n) >= 0.0 && dot(cross(q, b), n) >= 0.0;
  return inside ? asin(min(1.0, abs(s))) : min(chordAngle(p, a), chordAngle(p, b));
}

float meadowHeight(vec3 dir) {
  float h = 0.0;
  float f = MEADOW_BASE_FREQ;
  for (int k = 0; k < MEADOW_OCTAVES; k++) {
    float amp = uMeadowAmp[k];
    if (amp >= 1e-4) h += amp * gnoise(dir * f, uTerrainSeed + uint(k));
    f *= 2.0;
  }
  h += uMacroAmp * gnoise(dir * 1.2, uTerrainSeed + 20u);
  float calm = smoothstep(16.0, 7.0, chordAngle(dir, uCottage.xyz) * uRadius);
  for (int i = 0; i < MAX_PONDS; i++) {
    float r = uPondA[i].w;
    if (r > 0.0) calm = max(calm, smoothstep(r * 2.2, r * 1.1, chordAngle(dir, uPondA[i].xyz) * uRadius));
  }
  return h * (1.0 - 0.7 * calm);
}

// Mountain height (m); mask and height fraction out.
float mountainAt(vec3 dir, out float mask, out float rock) {
  float wobble = 0.05 * gnoise(dir * 5.0, uTerrainSeed + 30u);
  float d = arcDistance(dir, uRangeA, uRangeB) + wobble;
  mask = smoothstep(RANGE_OUTER, RANGE_INNER, d);
  float crest = 1.0 - smoothstep(0.0, RANGE_OUTER, d);
  if (uMountain.y > 0.0) {
    float ds = arcDistance(dir, uSpurA, uSpurB) + wobble;
    float ms = smoothstep(RANGE_OUTER * 0.8, RANGE_INNER * 0.6, ds) * uMountain.y;
    if (ms > mask) {
      mask = ms;
      crest = (1.0 - smoothstep(0.0, RANGE_OUTER * 0.8, ds)) * 0.7;
    }
  }
  float h = 0.0;
  if (mask > 0.0) {
    float ridge = 0.0;
    float f = 3.5;
    float w = 1.0;
    for (int o = 0; o < 5; o++) {
      float n = 1.0 - abs(gnoise(dir * f, uTerrainSeed + 40u + uint(o)));
      ridge += n * n * w;
      f *= 2.0;
      w *= 0.55;
    }
    ridge /= 2.07;
    h = uMountain.x * mask * (0.22 + 0.78 * pow(crest, 1.5)) * (0.3 + 0.7 * ridge);
  }
  rock = uMountain.x > 0.0 ? h / uMountain.x : 0.0;
  return h;
}

float channelDistance(vec3 dir) {
  vec4 cf = textureLod(uChannelField, dir, 0.0);
  float d = mix(mix(cf.r, cf.g, uWater.y), cf.b, uWater.z);
  float s = d * uRadius - uWater.x;
  float b = uWater.w;
  return min(s, cf.a * uRadius - uWater.x * 0.8 * b + (1.0 - b) * 0.5);
}

float pondDistance(vec3 dir, int i) {
  float r = uPondA[i].w;
  if (r <= 0.0) return 1e6;
  vec3 c = uPondA[i].xyz;
  float cosA = dot(dir, c);
  // far from the pond (outline reaches at most ~1.4 r): a cheap lower bound
  float away = chordAngle(dir, c) * uRadius - 1.45 * r;
  if (cosA < 0.0 || away > 2.0) return max(away, 2.0);
  vec3 t1 = uPondB[i].xyz;
  vec3 t2 = cross(c, t1);
  vec3 off = dir - c * cosA;
  vec2 q = vec2(dot(off, t1), dot(off, t2)) * uRadius / r;
  float th = atan(q.y, q.x);
  vec4 amp = uPondC[i];
  vec4 ph = uPondD[i];
  float sdf = (length(q) - (1.0 + amp.x * cos(th - ph.x) + amp.y * cos(2.0 * th - ph.y) + amp.z * cos(3.0 * th - ph.z))) * r;
  int first = int(amp.w + 0.5);
  int count = int(ph.w + 0.5);
  for (int k = 0; k < MAX_ISLETS; k++) {
    if (k < first || k >= first + count) continue;
    vec4 islet = uIslets[k];
    sdf = max(sdf, -(length(q - islet.xy) - islet.z) * r);
  }
  return sdf;
}

// Cottage-local meters: x across, z toward the pond (mirrors Terrain.cottageLocal).
vec2 cottageLocal(vec3 dir) {
  vec3 off = dir - uCottage.xyz;
  return vec2(dot(off, cross(uCottage.xyz, uCottageB.xyz)), dot(off, uCottageB.xyz)) * uRadius;
}

float clearingAt(vec3 dir, float dc) {
  float disc = smoothstep(3.6, 2.9, dc);
  if (dc > 9.0) return disc;
  vec2 c = cottageLocal(dir);
  float rect = smoothstep(0.35, 0.0, max(max(-2.6 - c.x, c.x - 1.3), max(-0.2 - c.y, c.y - 5.9)));
  return max(disc, rect);
}

float boxDistance(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Soft shadow of the cottage on the ground: the footprint swept toward the sun.
float cottageShadow(vec3 dir) {
  vec2 c = cottageLocal(dir);
  if (dot(c, c) > 400.0) return 0.0;
  float best = 1e3;
  for (int k = 1; k <= 4; k++) {
    float h = 0.85 * float(k);
    best = min(best, boxDistance(c + uCottageSun.xy * h, vec2(2.75, 2.3)));
  }
  return smoothstep(0.45, -0.25, best);
}

Ground sampleGround(vec3 dir) {
  Ground g;
  float h = meadowHeight(dir) + mountainAt(dir, g.mountain, g.rock);
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  float flat_ = smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
  h += (uCottage.w - h) * flat_;
  g.clearing = clearingAt(dir, dc);
  float sc = channelDistance(dir) + 4.0 * g.mountain + 6.0 * flat_;
  float water = sc;
  h -= 0.24 * smoothstep(0.7, -0.2, sc);
  for (int i = 0; i < MAX_PONDS; i++) {
    float sp = pondDistance(dir, i);
    if (sp > 1e5) continue;
    water = min(water, sp);
    h += (uPondB[i].w - h) * smoothstep(0.6, -0.35, sp);
  }
  g.height = h;
  g.water = water;
  return g;
}

// Water distance only (fragment shaders: crisp shores at any mesh density).
float waterDistance(vec3 dir, float mountain) {
  float dc = chordAngle(dir, uCottage.xyz) * uRadius;
  float water = channelDistance(dir) + 4.0 * mountain + 6.0 * smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
  for (int i = 0; i < MAX_PONDS; i++) water = min(water, pondDistance(dir, i));
  return water;
}
