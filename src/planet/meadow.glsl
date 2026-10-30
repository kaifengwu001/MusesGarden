// The painted meadow: what the ground looks like where there are no blades.
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

// A dab per occupied lattice cell, kept inside the cell's core so it is never
// cut by a cell border. Returns coverage; r: two randoms (species, colour).
float dab(vec3 dir, float freq, float fill, uint seed, out vec2 r) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  vec3 jitter = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 centre = cell + 0.3 + 0.4 * jitter;
  float keep = float((h >> 24) & 255u) / 255.0;
  r = vec2(fract(keep * 7.31 + jitter.x * 3.7), fract(jitter.z * 5.3 + keep * 1.7));
  float d = length(p - centre);
  float rad = 0.19 + 0.09 * jitter.y;
  return keep < fill ? smoothstep(rad, rad * 0.55, d) : 0.0;
}

// The clumps: a factor per species on the baked drifts and colonies (1 on
// average). Mirrors Fields.clumps in fields.ts; change both together.
const float CLUMP_COVER = 0.4;
const float CLUMP_FLOOR = 0.12;
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
  float sheen;    // wind sheen 0..1
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

// The meadow's colour at a point.
vec3 meadowPaint(Meadow m) {
  vec3 along = windDir(m.dir);
  float lush = m.lush;
  vec3 lit = mix(mix(pal(ROW_GRASS, 0), pal(ROW_GRASS, 1), 0.3), pal(ROW_GRASS, 7), smoothstep(0.25, 0.75, lush) * 0.5);
  vec3 mid = mix(pal(ROW_GRASS, 1), pal(ROW_BRUSH, 2), 0.25 - 0.25 * lush);
  vec3 shade = mix(pal(ROW_GRASS, 2), pal(ROW_GRASS, 5), smoothstep(0.0, -0.6, lush));
  // damp ground in the wetlands and along the water: deeper, cooler green
  float damp = max(m.wet * 0.5, smoothstep(3.0, 0.2, m.shore) * 0.8);
  lit = mix(lit, pal(ROW_BRUSH, 4), damp * 0.3);
  mid = mix(mid, pal(ROW_GRASS, 6), damp * 0.25);
  // ahead of the bloom front: shorter, paler grass
  lit = mix(mix(lit, pal(ROW_BUD, 2), 0.45), lit, m.bloom);
  mid = mix(mix(mid, pal(ROW_BUD, 0), 0.4), mid, m.bloom);
  vec3 col = tone3(lit, mid, shade, m.light);

  // brushstrokes
  float s = m.stroke;
  col *= 1.0 + 0.14 * s;
  col = mix(col, pal(ROW_GRASS, 3) * uSunTint, smoothstep(0.35, 0.8, s) * 0.32 * m.light);
  col = mix(col, pal(ROW_BRUSH, 4), smoothstep(-0.35, -0.8, s) * 0.22);

  // wind on the grass: pale bands where the gusts lay it over, the strokes
  // catching the light inside them, brightest in sun; between the bands the
  // grass stands up and reads deeper
  float sheen = m.sheen * uMeadowLook.x * mix(0.3, 1.0, m.sunlit);
  col *= 1.0 - 0.13 * uMeadowLook.x * (1.0 - m.sheen);
  col = mix(col, pal(ROW_GRASS, 8) * uSunTint, sheen * (0.5 + 0.4 * smoothstep(-0.2, 0.6, s)));

  // flowers: dabs where the clumps are, coloured by species and colony
  if (dot(m.flora, vec4(1.0)) > 0.02) m.flora *= clumpsAt(m.dir);
  float total = dot(m.flora, vec4(1.0));
  float land = smoothstep(0.15, 0.7, m.shore);
  float fill = clamp(total / DAB_SATURATION, 0.0, 1.0) * m.bloom * land * uMeadowLook.y;
  float f0, f1;
  uint lv;
  float t = patternOctaves(0.55, m.pixelMeters, 5.0, f0, f1, lv);
  vec2 r0, r1;
  float d0 = dab(m.dir, f0, fill * (1.0 - 0.75 * m.nearFade), uTerrainSeed + 100u + lv, r0) * (1.0 - t);
  float d1 = dab(m.dir, f1, fill * (1.0 - 0.75 * m.nearFade), uTerrainSeed + 101u + lv, r1) * t;
  float lightness = clamp(m.light * 1.1, 0.0, 1.0);
  // far away the dabs merge: the colonies read as washes of their colour
  float far = fill * smoothstep(0.05, 0.6, m.pixelMeters) * 0.55;
  if (far > 0.002) {
    vec3 wash = (m.flora.x * uFloraWash[0] + m.flora.y * uFloraWash[1] + m.flora.z * uFloraWash[2] + m.flora.w * uFloraWash[3]) / total;
    col = mix(col, wash * mix(0.72, 1.0, lightness), far);
  }
  float variant = colonyVariant(m.variant);
  float spread = 0.3 * uMeadowLook.z;
  if (d0 > 0.0) col = mix(col, floraColour(pickSpecies(m.flora, r0.x), clamp(variant + (r0.y - 0.5) * spread, 0.0, 1.0), lightness), d0);
  if (d1 > 0.0) col = mix(col, floraColour(pickSpecies(m.flora, r1.x), clamp(variant + (r1.y - 0.5) * spread, 0.0, 1.0), lightness), d1);
  return col;
}
