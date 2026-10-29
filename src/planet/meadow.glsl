// The painted meadow: what the ground looks like where there are no blades.
// Every pattern is sampled in direction space at two adjacent octaves picked
// by size in meters (and by pixel footprint), cross-faded continuously. As R
// grows a pattern fades between scales; it never slides. Requires noise,
// toon (palette), terrain (uCottage).

uniform vec4 uBloom;   // front angle (rad), front softness, -, -
uniform vec4 uWindVec; // rotation axis of the wind field (xyz), strength
uniform vec4 uSpecies; // flower weights: pink, star, yellow, blue

// Wind direction at a point: a solid-body rotation field around uWindVec.xyz.
vec3 windDir(vec3 dir) {
  vec3 w = cross(uWindVec.xyz, dir);
  float l = length(w);
  return l > 1e-5 ? w / l : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
}

// 1 behind the bloom front (in flower), 0 ahead of it.
float bloomAt(vec3 dir) {
  float a = chordAngle(dir, uCottage.xyz);
  float wobble = 0.17 * gnoise(dir * 3.0, uTerrainSeed + 60u) + 0.05 * gnoise(dir * 13.0, uTerrainSeed + 61u);
  return smoothstep(uBloom.x + uBloom.y, uBloom.x - uBloom.y, a + wobble);
}

// Octave pair and blend for a pattern of `meters`-sized cells, never finer
// than `minPixels` on screen. Writes the two frequencies; returns the blend.
float patternOctaves(float meters, float pixelMeters, float minPixels, out float f0, out float f1) {
  float size = max(meters, pixelMeters * minPixels);
  float level = log2(uRadius / size);
  float l0 = floor(level);
  f0 = exp2(l0);
  f1 = f0 * 2.0;
  return level - l0;
}

// Elongated brushstroke noise along the wind, in [-1, 1].
float strokes(vec3 dir, float freq, vec3 along, uint seed) {
  vec3 p = dir * freq;
  p -= along * dot(p, along) * 0.72; // stretch ×3.6 along the stroke direction
  return gnoise(p, seed);
}

// Flower dabs: a random point per lattice cell, kept inside the cell's core
// so a dab is never cut by a cell border. Returns coverage; species out.
float dabs(vec3 dir, float freq, float density, uint seed, out float species) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  vec3 jitter = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 centre = cell + 0.3 + 0.4 * jitter;
  float keep = float((h >> 24) & 255u) / 255.0;
  species = fract(keep * 7.31 + jitter.x * 3.7);
  float d = length(p - centre);
  float r = 0.19 + 0.09 * jitter.y;
  return keep < density ? smoothstep(r, r * 0.55, d) : 0.0;
}

vec3 speciesColour(float s, float lit) {
  vec4 w = uSpecies / max(dot(uSpecies, vec4(1.0)), 1e-3);
  vec3 c;
  if (s < w.x) c = mix(pal(ROW_PINK, 3), pal(ROW_PINK, 0), lit);
  else if (s < w.x + w.y) c = mix(pal(ROW_STAR, 1), pal(ROW_STAR, 0), lit);
  else if (s < w.x + w.y + w.z) c = mix(pal(ROW_SCATTER, 1), pal(ROW_SCATTER, 0), lit);
  else if (s < 0.985) c = mix(pal(ROW_SCATTER, 3), pal(ROW_SCATTER, 2), lit);
  else c = mix(pal(ROW_SCATTER, 5), pal(ROW_SCATTER, 4), lit);
  return c;
}

// Large, slowly varying meadow fields (10–40 m): lushness, flower drift and
// bloom. Cheap enough per vertex; the fragment stage adds the fine paint.
vec3 meadowFields(vec3 dir, float pixelMeters) {
  float f0, f1;
  float t = patternOctaves(22.0, pixelMeters, 2.0, f0, f1);
  float lush = mix(gnoise(dir * f0, uTerrainSeed + 70u), gnoise(dir * f1, uTerrainSeed + 71u), t);
  t = patternOctaves(34.0, pixelMeters, 2.0, f0, f1);
  float drift = 0.5 + 0.5 * mix(gnoise(dir * f0, uTerrainSeed + 90u), gnoise(dir * f1, uTerrainSeed + 91u), t);
  return vec3(lush, drift, bloomAt(dir));
}

// The meadow's albedo at a point. fields = meadowFields(); b: toon light band;
// pixelMeters: screen footprint; nearFade: 1 where real grass and flowers take over.
vec3 meadowPaint(vec3 dir, vec3 fields, float b, float water, float pixelMeters, float nearFade) {
  vec3 along = windDir(dir);
  float lush = fields.x;
  float drift = fields.y;
  float bloom = fields.z;
  vec3 lit = mix(mix(pal(ROW_GRASS, 0), pal(ROW_GRASS, 1), 0.38), pal(ROW_GRASS, 7), smoothstep(0.25, 0.75, lush) * 0.5);
  vec3 mid = mix(pal(ROW_GRASS, 1), pal(ROW_BRUSH, 2), 0.25 - 0.25 * lush);
  vec3 shade = mix(pal(ROW_GRASS, 2), pal(ROW_GRASS, 5), smoothstep(0.0, -0.6, lush));
  // ahead of the bloom front: shorter, paler grass
  vec3 pale = pal(ROW_BUD, 2);
  lit = mix(mix(lit, pale, 0.45), lit, bloom);
  mid = mix(mix(mid, pal(ROW_BUD, 0), 0.4), mid, bloom);
  vec3 col = tone3(lit, mid, shade, b);

  // brushstrokes, about 1.2 m long up close, a few pixels far away
  float f0, f1;
  float t = patternOctaves(1.1, pixelMeters, 5.0, f0, f1);
  float s = mix(strokes(dir, f0, along, uTerrainSeed + 80u), strokes(dir, f1, along, uTerrainSeed + 81u), t);
  col *= 1.0 + 0.14 * s;
  col = mix(col, pal(ROW_GRASS, 3) * uSunTint, smoothstep(0.35, 0.8, s) * 0.32 * b);
  col = mix(col, pal(ROW_BRUSH, 4), smoothstep(-0.35, -0.8, s) * 0.22);

  // flower dabs: dense behind the bloom front, in drifts, massing toward water
  float nearWater = smoothstep(9.0, 1.5, water);
  float density = bloom * (0.25 + 0.75 * drift * drift + 0.3 * nearWater) * (1.0 - nearFade * 0.7);
  t = patternOctaves(0.55, pixelMeters, 5.0, f0, f1);
  float sp0, sp1;
  float d0 = dabs(dir, f0, density, uTerrainSeed + 100u, sp0);
  float d1 = dabs(dir, f1, density, uTerrainSeed + 101u, sp1);
  // pink cups mass near water: bias species toward the pink range there
  sp0 = mix(sp0, sp0 * 0.42, nearWater);
  sp1 = mix(sp1, sp1 * 0.42, nearWater);
  col = mix(col, speciesColour(sp0, b), d0 * (1.0 - t));
  col = mix(col, speciesColour(sp1, b), d1 * t);
  return col;
}
