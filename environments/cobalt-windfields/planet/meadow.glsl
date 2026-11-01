// Chalk ground material and shared flora paint helpers for Cobalt Windfields.
// Every pattern is sampled in direction space at the two octaves that bracket
// its size in meters (and its pixel footprint), cross-faded continuously and
// seeded by octave, so as R grows or the camera moves a pattern fades between
// scales; it never slides or jumps. Requires noise, toon (palette), terrain.

uniform vec4 uBloom;      // front angle (rad), front softness, -, -
uniform vec4 uWindVec;    // rotation axis of the wind field (xyz), strength
uniform vec4 uMeadowLook; // wind sheen, flower dabs, colour variation, -
uniform vec3 uFloraWash[4]; // each species' middle colour in sun (far drifts blend these)
uniform vec4 uClumps;       // octave level, blend, threshold, patchiness (Fields.clumps)
#define MAX_USER_BLOOMS 8
uniform vec4 uUserBloom[MAX_USER_BLOOMS]; // press-and-hold discs: centre direction, angular radius

// Flowers per m² at which every dab cell of the far paint holds a flower.
const float DAB_SATURATION = 12.0;
// How strongly the paint's flowers (dabs and wash) lie over the grass.
const float FLOWER_PAINT = 0.8;
// The dabs: never smaller than a flower (m) or than DAB_PIXELS on screen, so
// from orbit down to the meadow they read as the same brushed marks, only
// finer in meters as you come down, until each is a flower's size where the
// flowers themselves take over (meadowPaint).
const float DAB_METERS = 0.16;
const float DAB_PIXELS = 5.0;

// Wind direction at a point: a solid-body rotation field around uWindVec.xyz.
vec3 windDir(vec3 dir) {
  vec3 w = cross(uWindVec.xyz, dir);
  float l = length(w);
  return l > 1e-5 ? w / l : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
}

// 1 behind the bloom front (in flower), 0 ahead of it. Discs you hold open
// bloom too; they live in rest space, so they cover the same flowers at any size.
float bloomAt(vec3 dir) {
  float a = chordAngle(dir, uCottage.xyz);
  float wobble = 0.17 * gnoise(dir * 3.0, uTerrainSeed + 60u) + 0.05 * gnoise(dir * 13.0, uTerrainSeed + 61u);
  float bloom = smoothstep(uBloom.x + uBloom.y, uBloom.x - uBloom.y, a + wobble);
  for (int i = 0; i < MAX_USER_BLOOMS; i++) {
    vec4 d = uUserBloom[i];
    if (d.w <= 0.0) continue;
    float r = chordAngle(dir, d.xyz) + wobble * 0.15 * d.w;
    bloom = max(bloom, smoothstep(d.w, d.w * 0.7, r));
  }
  return bloom;
}

// Octave pair and blend for a pattern of `meters`-sized cells, never finer
// than `minPixels` on screen. Writes the two frequencies and the coarse
// octave's seed offset (the fine one is +1); returns the blend.
float patternOctaves(float meters, float pixelMeters, float minPixels, out float f0, out float f1, out uint level) {
  float size = max(meters, pixelMeters * minPixels);
  float l = log2(uRadius / size);
  float l0 = floor(l);
  f0 = exp2(l0);
  f1 = f0 * 2.0;
  level = uint(int(l0) + 64);
  return l - l0;
}

// Elongated brushstroke noise along the wind, in [-1, 1].
float strokes(vec3 dir, float freq, vec3 along, uint seed) {
  vec3 p = dir * freq;
  p -= along * dot(p, along) * 0.72; // stretch ×3.6 along the stroke direction
  return gnoise(p, seed);
}

// A dab per occupied lattice cell: a short brushed mark drawn out a little
// along `along` (the brush's way), kept inside the cell's core so it is
// never cut by a cell border. Returns coverage; r: two randoms (species,
// colour).
float dab(vec3 dir, float freq, float fill, vec3 along, uint seed, out vec2 r) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  vec3 jitter = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 centre = cell + 0.33 + 0.34 * jitter;
  float keep = float((h >> 24) & 255u) / 255.0;
  r = vec2(fract(keep * 7.31 + jitter.x * 3.7), fract(jitter.z * 5.3 + keep * 1.7));
  vec3 q = p - centre;
  float d = length(q - along * dot(q, along) * 0.3);
  float rad = 0.17 + 0.07 * jitter.y;
  return keep < fill ? smoothstep(rad, rad * 0.55, d) : 0.0;
}

// The clumps: a factor per species on the baked drifts and colonies (1 on
// average). Mirrors Fields.clumps in fields.ts; change both together.
const float CLUMP_COVER = 0.3;
const float CLUMP_FLOOR = 0.06;
const float CLUMP_EDGE = 0.05;
vec4 clumpsAt(vec3 dir) {
  float f0 = exp2(uClumps.x);
  float t = uClumps.y;
  uint s = uTerrainSeed + 400u + uint(int(uClumps.x) + 16);
  float norm = 1.0 / sqrt((1.0 - t) * (1.0 - t) + t * t);
  float a = (gnoise(dir * f0, s) * (1.0 - t) + gnoise(dir * 2.0 * f0, s + 1u) * t) * norm;
  float b = (gnoise(dir * f0, s + 64u) * (1.0 - t) + gnoise(dir * 2.0 * f0, s + 65u) * t) * norm;
  vec4 c = smoothstep(vec4(uClumps.z - CLUMP_EDGE), vec4(uClumps.z + CLUMP_EDGE), vec4(a, b, -a, -b));
  return 1.0 + uClumps.w * (CLUMP_FLOOR + (1.0 - CLUMP_FLOOR) * c / CLUMP_COVER - 1.0);
}

// The clumps as the paint lays them, `close` (0 far … 1 near) softening and
// fraying their edges: far away the drifts keep crisp edges (they read as
// flowerbeds); up close a bed thins out over a meter or so along a ragged
// line instead of stopping at a hard one. (The flowers themselves keep
// clumpsAt's edges: Fields.clumps.)
vec4 paintClumps(vec3 dir, float close) {
  float f0 = exp2(uClumps.x);
  float t = uClumps.y;
  uint s = uTerrainSeed + 400u + uint(int(uClumps.x) + 16);
  float norm = 1.0 / sqrt((1.0 - t) * (1.0 - t) + t * t);
  float a = (gnoise(dir * f0, s) * (1.0 - t) + gnoise(dir * 2.0 * f0, s + 1u) * t) * norm;
  float b = (gnoise(dir * f0, s + 64u) * (1.0 - t) + gnoise(dir * 2.0 * f0, s + 65u) * t) * norm;
  float edge = CLUMP_EDGE + 0.12 * close;
  float fray = close > 0.0 ? 0.07 * close * gnoise(dir * (uRadius / 1.4), uTerrainSeed + 405u) : 0.0;
  vec4 c = smoothstep(vec4(uClumps.z - edge), vec4(uClumps.z + edge), vec4(a, b, -a, -b) + fray);
  return 1.0 + uClumps.w * (CLUMP_FLOOR + (1.0 - CLUMP_FLOOR) * c / CLUMP_COVER - 1.0);
}

// Which species a random pick lands on, weighted by the local densities.
int pickSpecies(vec4 flora, float r) {
  float x = r * dot(flora, vec4(1.0));
  if (x < flora.x) return 0;
  if (x < flora.x + flora.y) return 1;
  if (x < flora.x + flora.y + flora.z) return 2;
  return 3;
}

// A flower's petal colour: species, colour variant v (0..1, set per colony
// with a little per-flower spread) and light (0 shade … 1 sun).
vec3 floraColour(int s, float v, float lit) {
  vec3 c;
  vec3 sh;
  if (s == 0) {
    // pink cups: blush → pink → rose, a few coral colonies
    c = mix(pal(ROW_PINK, 6), pal(ROW_PINK, 0), smoothstep(0.0, 0.4, v));
    c = mix(c, pal(ROW_PINK, 7), smoothstep(0.55, 0.85, v));
    c = mix(c, pal(ROW_PINK, 8), smoothstep(0.9, 1.0, v));
    sh = mix(pal(ROW_PINK, 3), pal(ROW_PINK, 9), smoothstep(0.5, 0.9, v));
  } else if (s == 1) {
    // white stars: white → cream, pale lilac at the far end
    c = mix(pal(ROW_STAR, 0), pal(ROW_STAR, 4), smoothstep(0.3, 0.75, v));
    c = mix(c, pal(ROW_STAR, 5), smoothstep(0.85, 1.0, v));
    sh = pal(ROW_STAR, 1);
  } else if (s == 2) {
    // buttons: lemon → yellow → golden, a few orange and red colonies at the far end
    c = mix(pal(ROW_SCATTER, 10), pal(ROW_SCATTER, 0), smoothstep(0.0, 0.4, v));
    c = mix(c, pal(ROW_SCATTER, 6), smoothstep(0.82, 0.93, v));
    c = mix(c, pal(ROW_SCATTER, 4), smoothstep(0.94, 0.99, v));
    sh = mix(pal(ROW_SCATTER, 1), pal(ROW_SCATTER, 5), smoothstep(0.85, 0.99, v));
  } else {
    // blue clusters: cornflower → violet
    c = mix(pal(ROW_SCATTER, 2), pal(ROW_SCATTER, 8), smoothstep(0.35, 0.9, v));
    sh = mix(pal(ROW_SCATTER, 3), pal(ROW_SCATTER, 9), smoothstep(0.35, 0.9, v));
  }
  return mix(sh, c, lit);
}

// A colony's colour variant after the colour-variation setting (matches colonyVariant() in flowers.ts).
float colonyVariant(float v) {
  return clamp(0.5 + (v - 0.5) * uMeadowLook.z * 1.4, 0.0, 1.0);
}

// What the paint needs to know about a point of meadow.
struct Meadow {
  vec3 dir;
  float lush;     // -1..1
  float wet;      // macro wetness 0..1
  float variant;  // colony colour variant 0..1
  vec4 flora;     // flowers per m², per species
  float bloom;    // 1 behind the bloom front
  float shore;    // signed distance to the water (m)
  float light;    // toon light band, shadows applied
  float sunlit;   // 1 in sun, 0 under cloud
  float sheen;    // wind sheen: -1 in a trough … 1 on a crest (windSheen)
  float stroke;   // brushstroke noise, -1..1 (strokeAt)
  float pixelMeters;
  float nearFade; // 1 where real grass and flowers take over
};

// Brushstrokes along the wind, about 1.2 m long up close, a few pixels far
// away (also what roughens the cloud-shadow edges, so they look brushed).
float strokeAt(vec3 dir, float pixelMeters) {
  float f0, f1;
  uint lv;
  float t = patternOctaves(1.1, pixelMeters, 5.0, f0, f1, lv);
  vec3 along = windDir(dir);
  return mix(strokes(dir, f0, along, uTerrainSeed + 80u + lv), strokes(dir, f1, along, uTerrainSeed + 81u + lv), t);
}

// Wind-laid peach sand. The ridges are irregular, matte and fixed to the
// terrain; individual grains disappear once their screen footprint is too small.
vec3 meadowPaint(Meadow m) {
  vec3 p = m.dir * uRadius;
  vec2 c = cottageLocal(m.dir);
  // Broad warm/cool sand washes follow the sloping wind banks, not a tiled texture.
  float wash = 0.5 + 0.5 * gnoise(p / 17.0, uTerrainSeed + 710u);
  float drift = smoothstep(-0.3, 0.45, gnoise(p / 5.0, uTerrainSeed + 715u));
  float bank = localSandRelief(c, chordAngle(m.dir, uCottage.xyz) * uRadius);
  float crest = smoothstep(1.5, 7.5, bank);
  vec3 lit = mix(pal(ROW_BRUSH, 0), pal(ROW_BRUSH, 3), crest * 0.48);
  vec3 mid = mix(pal(ROW_BRUSH, 1), pal(ROW_BRUSH, 0), wash * 0.5);
  vec3 shade = mix(pal(ROW_BRUSH, 2), pal(ROW_BRUSH, 4), wash * 0.15);
  vec3 col = tone3(lit, mid, shade, m.light);
  col = mix(col, pal(ROW_BRUSH, 5), drift * (1.0-crest) * 0.10);
  float close = 1.0 - smoothstep(0.025, 0.15, m.pixelMeters);
  vec3 along = normalize(vec3(0.7, 0.24, -0.45));
  float stretched = strokes(m.dir, uRadius / 0.32, along, uTerrainSeed + 713u);
  float interrupted = smoothstep(-0.05, 0.45, gnoise(p / 2.5, uTerrainSeed + 714u));
  col *= 1.0 - smoothstep(0.22, 0.55, stretched) * interrupted * close * 0.022;
  float grainClose = 1.0 - smoothstep(0.012, 0.045, m.pixelMeters);
  col *= 1.0 + gnoise(p * 26.0, uTerrainSeed + 711u) * grainClose * 0.045;
  return col;
}
