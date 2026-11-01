// The painted sand: what the ground looks like everywhere (there are no
// blades). Every pattern is sampled in direction space at the two octaves
// that bracket its size in meters (and its pixel footprint), cross-faded
// continuously and seeded by octave, so as R grows or the camera moves a
// pattern fades between scales; it never slides or jumps. Requires noise,
// toon (palette), terrain. (The chunk keeps the meadow's name, meadow_paint:
// the shared shaders include it by that name.)

uniform vec4 uBloom;        // front angle (rad), front softness, -, -
uniform vec4 uWindVec;      // rotation axis of the wind field (xyz), strength
uniform vec4 uMeadowLook;   // -, starflower dabs, colour variation, -
uniform vec3 uFloraWash[4]; // the starflowers' middle colour in sun (channel 1; far drifts blend it)
uniform vec4 uClumps;       // octave level, blend, threshold, patchiness (Fields.clumps)
uniform vec4 uDuneGrain;    // the axis the crests run along (xyz), -
#define MAX_STAR_GROUPS 12
uniform vec4 uStarGroups[MAX_STAR_GROUPS]; // starflower groups round the shelter: shelter-local x, z (m), radius (m), flowers per m²
#define MAX_USER_BLOOMS 8
uniform vec4 uUserBloom[MAX_USER_BLOOMS]; // press-and-hold discs: centre direction, angular radius

// Starflowers per m² at which every dab cell of the far paint holds a flower.
const float DAB_SATURATION = 6.0;
// How strongly the paint's flowers (dabs and wash) lie over the sand.
const float FLOWER_PAINT = 0.85;
// The starflower dabs: never smaller than a flower (m) or than DAB_PIXELS on screen.
const float DAB_METERS = 0.14;
const float DAB_PIXELS = 4.0;
// Ripples: spacing (m) of the coarser of the two trains drawn, and the
// smallest spacing on screen (px) they are drawn at.
const float RIPPLE_METERS = 0.32;
const float RIPPLE_PIXELS = 3.0;
// Pebbles: their size (m), and how many cells hold one on open sand and deep in the habitat.
const float PEBBLE_METERS = 0.12;
const vec2 PEBBLE_FILL = vec2(0.005, 0.22);

// Wind direction at a point: a solid-body rotation field around uWindVec.xyz.
vec3 windDir(vec3 dir) {
  vec3 w = cross(uWindVec.xyz, dir);
  float l = length(w);
  return l > 1e-5 ? w / l : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
}

// 1 behind the bloom front (starflowers open), 0 ahead of it. Discs you hold
// open bloom too; they live in rest space, so they cover the same flowers at any size.
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

// A noise pattern of `meters`-sized features at its two bracketing octaves, in [-1, 1].
float patternNoise(vec3 dir, float meters, float pixelMeters, float minPixels, uint seed) {
  float f0, f1;
  uint lv;
  float t = patternOctaves(meters, pixelMeters, minPixels, f0, f1, lv);
  return mix(gnoise(dir * f0, seed + lv), gnoise(dir * f1, seed + lv + 1u), t);
}

// Elongated brushstroke noise along a direction, in [-1, 1].
float strokes(vec3 dir, float freq, vec3 along, uint seed) {
  vec3 p = dir * freq;
  p -= along * dot(p, along) * 0.72; // stretch ×3.6 along the stroke direction
  return gnoise(p, seed);
}

// A dab per occupied lattice cell: a short brushed mark drawn out a little
// along `along` (the brush's way), kept inside the cell's core so it is
// never cut by a cell border. Returns coverage; r: two randoms.
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

// The clumps: a factor per channel on the baked drifts (1 on average).
// Mirrors Fields.clumps in fields.ts; change both together.
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

// Starflowers per m² the groups round the shelter add here (mirrors starGroupsAt() in flowers.ts).
float starGroupsAt(vec3 dir) {
  if (chordAngle(dir, uCottage.xyz) * uRadius > 24.0) return 0.0;
  vec2 c = cottageLocal(dir);
  float d = 0.0;
  for (int i = 0; i < MAX_STAR_GROUPS; i++) {
    vec4 g = uStarGroups[i];
    if (g.z <= 0.0) continue;
    d += g.w * smoothstep(g.z, 0.6 * g.z, length(c - g.xy));
  }
  return d;
}

// Which channel a random pick lands on, weighted by the local densities.
int pickSpecies(vec4 flora, float r) {
  float x = r * dot(flora, vec4(1.0));
  if (x < flora.x) return 0;
  if (x < flora.x + flora.y) return 1;
  if (x < flora.x + flora.y + flora.z) return 2;
  return 3;
}

// A flower's petal colour: channel, colour variant v (0..1) and light (0
// shade … 1 sun). Channel 1 is the starflower; the others keep the meadow's
// colours for the flower meshes still built from them.
vec3 floraColour(int s, float v, float lit) {
  vec3 c;
  vec3 sh;
  if (s == 1) {
    // starflowers: ivory → cream, pale lilac at the far end
    c = mix(pal(ROW_STAR, 0), pal(ROW_STAR, 4), smoothstep(0.3, 0.75, v));
    c = mix(c, pal(ROW_STAR, 5), smoothstep(0.85, 1.0, v));
    sh = pal(ROW_STAR, 1);
  } else if (s == 0) {
    c = mix(pal(ROW_PINK, 6), pal(ROW_PINK, 0), smoothstep(0.0, 0.4, v));
    sh = pal(ROW_PINK, 3);
  } else if (s == 2) {
    c = mix(pal(ROW_SCATTER, 10), pal(ROW_SCATTER, 0), smoothstep(0.0, 0.4, v));
    sh = pal(ROW_SCATTER, 1);
  } else {
    c = mix(pal(ROW_SCATTER, 2), pal(ROW_SCATTER, 8), smoothstep(0.35, 0.9, v));
    sh = pal(ROW_SCATTER, 3);
  }
  return mix(sh, c, lit);
}

// A colony's colour variant after the colour-variation setting (matches colonyVariant() in flowers.ts).
float colonyVariant(float v) {
  return clamp(0.5 + (v - 0.5) * uMeadowLook.z * 1.4, 0.0, 1.0);
}

// What the paint needs to know about a point of sand.
struct Sand {
  vec3 dir;
  vec3 normal;    // warped, for the ripples' light
  float tone;     // sand tone -1..1
  float habitat;  // 0..1
  float variant;  // colour variant 0..1
  vec4 flora;     // starflowers per m² in channel 1
  float bloom;    // 1 behind the bloom front
  float clearing; // the shelter's clearing 0..1 (trodden smooth)
  float light;    // toon light band, shadows applied
  float ndl;      // the sun's N·L before banding
  float sunlit;   // 1 in sun, 0 under cloud
  float stroke;   // brushstroke noise, -1..1 (strokeAt)
  float pixelMeters;
  float nearFade; // 1 where the starflowers themselves take over
};

// Drybrush strokes along the wind, about 1.2 m long up close, a few pixels
// far away (also what roughens the cloud-shadow edges, so they look brushed).
float strokeAt(vec3 dir, float pixelMeters) {
  float f0, f1;
  uint lv;
  float t = patternOctaves(1.1, pixelMeters, 5.0, f0, f1, lv);
  vec3 along = windDir(dir);
  return mix(strokes(dir, f0, along, uTerrainSeed + 80u + lv), strokes(dir, f1, along, uTerrainSeed + 81u + lv), t);
}

// Ripple trains: lines running along the crests (the meridians of the grain
// axis: the crests run along it), about RIPPLE_METERS apart. Two trains, at
// the two whole-number frequencies around the axis that bracket that spacing
// here, cross-faded, so as R grows they split or merge in place, never slide;
// a gentle meander (the same in meters for both) keeps them from looking
// ruled. Returns the light they add (−1..1, before strength) where they show.
float ripplesAt(vec3 dir, float pixelMeters) {
  vec3 g = uDuneGrain.xyz;
  vec3 e1 = normalize(cross(g, abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(g, e1);
  vec2 q = vec2(dot(dir, e1), dot(dir, e2));
  float ring = length(q) * uRadius; // the radius (m) of the circle around the axis through here
  if (ring < 4.0) return 0.0;
  float meander = 0.3 * patternNoise(dir, 2.6, pixelMeters, 6.0, uTerrainSeed + 130u) + 0.08 * patternNoise(dir, 0.8, pixelMeters, 6.0, uTerrainSeed + 132u);
  float phi = atan(q.y, q.x) + meander / ring;
  float l = log2(6.2831853 * ring / RIPPLE_METERS);
  float l0 = floor(l);
  float t = l - l0;
  float f0 = exp2(l0);
  float spacing0 = 6.2831853 * ring / f0;
  // each train shows only where its lines are a few pixels apart
  float v0 = smoothstep(RIPPLE_PIXELS, 2.0 * RIPPLE_PIXELS, spacing0 / pixelMeters);
  float v1 = smoothstep(RIPPLE_PIXELS, 2.0 * RIPPLE_PIXELS, 0.5 * spacing0 / pixelMeters);
  if (v0 <= 0.0) return 0.0;
  // the light a ripple's two faces take: its slope across the lines toward the sun
  vec3 across = normalize(cross(g, dir));
  float toSun = dot(uSunDir, across);
  float a = sin(phi * f0);
  float b = sin(phi * 2.0 * f0);
  // sharp-crested ripples: the lit face long and gentle, the shaded face short
  float r0 = exp(-abs(a - 0.35) * 12.0) - 0.65 * exp(-abs(a + 0.35) * 12.0);
  float r1 = exp(-abs(b - 0.35) * 12.0) - 0.65 * exp(-abs(b + 0.35) * 12.0);
  return mix(r0 * v0, r1 * v1, t) * (0.3 + 0.7 * toSun);
}

// Two stable octave scales of broken pencil strokes. No fragment derivatives:
// this paint chunk is also compiled by the vertex/ground-field passes.
float pencilSand(vec3 dir, float pixelMeters) {
  float f0, f1; uint level;
  float t = patternOctaves(0.085, pixelMeters, 2.0, f0, f1, level);
  vec3 axis = normalize(cross(uDuneGrain.xyz, vec3(0.31, 0.77, -0.48)));
  float p0 = dot(dir, axis) * f0;
  float p1 = p0 * 2.0;
  float wobble = 0.18 * patternNoise(dir, 0.8, pixelMeters, 5.0, uTerrainSeed + 617u);
  float a = 1.0 - smoothstep(0.05, 0.18, abs(fract(p0 + wobble) - 0.5));
  float b = 1.0 - smoothstep(0.05, 0.18, abs(fract(p1 + wobble) - 0.5));
  float broken = smoothstep(-0.3, 0.25, patternNoise(dir, 0.35, pixelMeters, 4.0, uTerrainSeed + 620u));
  return mix(a, b, t) * broken * (1.0 - smoothstep(0.09, 0.22, pixelMeters));
}

// The sand's colour at a point.
vec3 sandPaint(Sand s) {
  float tone = s.tone;
  vec3 lit = mix(pal(ROW_SAND, 0), pal(ROW_SAND, 9), smoothstep(0.2, 0.85, tone) * 0.5);
  vec3 mid = mix(pal(ROW_SAND, 1), pal(ROW_SAND, 6), smoothstep(-0.2, -0.85, tone) * 0.4);
  vec3 shade = mix(pal(ROW_SAND, 2), pal(ROW_SAND, 5), smoothstep(0.0, -0.75, tone) * 0.5);
  // the habitat's ground: firmer, a little greyer and cooler
  lit = mix(lit, pal(ROW_BRUSH, 2), s.habitat * 0.14);
  mid = mix(mid, pal(ROW_BRUSH, 2), s.habitat * 0.18);
  vec3 col = tone3(lit, mid, shade, s.light);

  // drybrush: a few strokes catching the sun, a few cool violet ones in the shade; quiet overall
  float st = s.stroke;
  col *= 1.0 + 0.07 * st;
  col = mix(col, pal(ROW_SAND, 3) * uSunTint, smoothstep(0.4, 0.9, st) * 0.3 * s.light);
  col = mix(col, pal(ROW_BRUSH, 1), smoothstep(-0.4, -0.9, st) * 0.3 * (1.0 - s.light * 0.4));

  // ripple trains, near only: in patches, not on the trodden pad, fewer on steep faces and among the slate
  float near = 1.0 - smoothstep(0.045, 0.095, s.pixelMeters);
  if (near > 0.0) {
    float train = smoothstep(-0.1, 0.25, patternNoise(s.dir, 7.0, s.pixelMeters, 6.0, uTerrainSeed + 134u));
    float upright = smoothstep(0.25, 0.75, dot(s.normal, normalize(s.dir)));
    float show = near * train * upright * (1.0 - s.clearing) * (1.0 - 0.6 * s.habitat);
    if (show > 0.0) {
      float r = ripplesAt(s.dir, s.pixelMeters) * show;
      col = mix(col, r > 0.0 ? pal(ROW_SAND, 7) * uSunTint : pal(ROW_SAND, 8) * uShadeTint, abs(r) * 0.43 * s.sunlit);
    }
  }

  float pencil = pencilSand(s.dir, s.pixelMeters);
  col = mix(col, pal(ROW_SAND, 8), pencil * (0.3 + 0.15 * (1.0 - s.light)) * (1.0 - 0.6 * s.clearing));

  // a very fine grain, only right underfoot
  float grainShow = 1.0 - smoothstep(0.004, 0.012, s.pixelMeters);
  if (grainShow > 0.0) col *= 1.0 + 0.05 * grainShow * gnoise(s.dir * (uRadius / 0.03), uTerrainSeed + 140u);

  // pebbles of slate: a scatter on open sand, many in the habitat; tiny marks far off
  float f0, f1;
  uint lv;
  float t = patternOctaves(PEBBLE_METERS, s.pixelMeters, 3.0, f0, f1, lv);
  float fill = mix(PEBBLE_FILL.x, PEBBLE_FILL.y, s.habitat) * (1.0 - s.clearing);
  vec3 along = windDir(s.dir);
  vec2 r0, r1;
  float p0 = dab(s.dir, f0, fill, along, uTerrainSeed + 150u + lv, r0) * (1.0 - t);
  float p1 = dab(s.dir, f1, fill, along, uTerrainSeed + 151u + lv, r1) * t;
  float pebble = max(p0, p1);
  if (pebble > 0.0) {
    float face = p0 > p1 ? r0.x : r1.x;
    vec3 stone = mix(pal(ROW_ROCK, 0), pal(ROW_ROCK, 2), face * 0.6);
    col = mix(col, tone3(stone, pal(ROW_ROCK, 0), pal(ROW_ROCK, 1), s.light), pebble * 0.85);
  }

  // the clusters from afar (flora channel 0, where the seeded stones and sail-reeds stand: landmarks.ts):
  // a quiet wash of ochre leaf over slate, coming in as the clumps themselves shrink to a pixel or two
  float far = smoothstep(0.25, 1.4, s.pixelMeters);
  if (far > 0.0 && s.flora.x > 0.0) {
    float clump = smoothstep(-0.05, 0.3, patternNoise(s.dir, 3.0, s.pixelMeters, 3.0, uTerrainSeed + 160u));
    vec3 wash = mix(pal(ROW_ROCK, 0), pal(ROW_BRUSH, 6), 0.35 + 0.5 * clump);
    col = mix(col, tone3(wash, wash * 0.85, wash * 0.62, s.light), s.flora.x * far * 0.5 * mix(0.55, 1.0, clump));
  }

  // starflowers: dabs where the drifts are (the same density map the flowers are scattered by);
  // where the flowers themselves stand (the near field) the paint gives way to them
  float total = s.flora.y * clumpsAt(s.dir).y + starGroupsAt(s.dir);
  float flowerFill = clamp(total / DAB_SATURATION, 0.0, 1.0) * s.bloom * uMeadowLook.y * (1.0 - s.clearing);
  if (flowerFill > 0.0) {
    float tf = patternOctaves(DAB_METERS, s.pixelMeters, DAB_PIXELS, f0, f1, lv);
    float paintFill = flowerFill * (1.0 - 0.9 * s.nearFade);
    float d0 = dab(s.dir, f0, paintFill, along, uTerrainSeed + 100u + lv, r0) * (1.0 - tf);
    float d1 = dab(s.dir, f1, paintFill, along, uTerrainSeed + 101u + lv, r1) * tf;
    float lightness = clamp(s.light * 1.1, 0.0, 1.0);
    float variant = colonyVariant(s.variant);
    float spread = 0.3 * uMeadowLook.z;
    float washFar = flowerFill * (0.2 + 0.2 * smoothstep(0.05, 0.6, s.pixelMeters)) * (1.0 - s.nearFade) * FLOWER_PAINT;
    col = mix(col, uFloraWash[1] * mix(0.72, 1.0, lightness), washFar);
    if (d0 > 0.0) col = mix(col, floraColour(1, clamp(variant + (r0.y - 0.5) * spread, 0.0, 1.0), lightness), d0 * FLOWER_PAINT);
    if (d1 > 0.0) col = mix(col, floraColour(1, clamp(variant + (r1.y - 0.5) * spread, 0.0, 1.0), lightness), d1 * FLOWER_PAINT);
  }
  return col;
}
