// Chalk ground material and shared flora paint helpers for Scarlet Sail Canyon.
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
  float slope; // physical slope: expose cool rock faces between the shelves
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

// Short angular fractures inside sparse cells; the endpoints remain inside
// each cell so no seam can turn into a continuous contour or closed loop.
float chalkSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

// A loose, angular flake per selected cell. Marks have actual metre sizes and
// disappear below the pixel footprint; no moving high-frequency sand noise.
vec3 mineralChips(vec2 meters, float pixelMeters) {
  const float cellSize=0.72;
  vec2 cell=floor(meters/cellSize);
  uint id=meadowHash(ivec3(ivec2(cell),0),uTerrainSeed+727u);
  vec3 r=vec3(float(id&255u),float((id>>8)&255u),float((id>>16)&255u))/255.0;
  vec2 q=(fract(meters/cellSize)-0.5-(r.xy-0.5)*0.74)*cellSize;
  float turn=r.z*6.2831853;
  q=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*q;
  vec2 radii=vec2(0.015+0.066*r.x*r.x,0.011+0.040*r.y*r.y);
  float bevel=0.68+0.28*r.z;
  float d=max(max(abs(q.x)-radii.x,abs(q.y)-radii.y),(abs(q.x+q.y*0.21)+abs(q.y)-bevel*(radii.x+radii.y))*0.7071);
  float aa=max(pixelMeters*0.7,0.0015);
  float face=1.0-smoothstep(-aa,aa,d);
  float edge=1.0-smoothstep(0.003,0.003+aa,abs(d));
  float cluster=gnoise(vec3(meters*0.37,0.0),uTerrainSeed+728u);
  float selected=float((id>>24)&255u)/255.0;
  float keep=step(mix(0.98,0.49,smoothstep(-0.16,0.25,cluster)),selected)*(1.0-smoothstep(0.025,0.13,pixelMeters));
  return vec3(face,edge,clamp(q.y/max(radii.y,0.001)*0.5+0.5,0.0,1.0))*vec3(keep,keep,1.0);
}

// Warm weathered chalk, loose mineral dust and sparse lichen. The material
// contains no grass-like wind strokes and does not add a second ground plane.
vec3 meadowPaint(Meadow m) {
  vec3 p=m.dir*uRadius;
  float mineral=gnoise(p/7.0,uTerrainSeed+710u);
  float close=1.0-smoothstep(0.035,0.23,m.pixelMeters);
  float grain=close*gnoise(p*22.0,uTerrainSeed+711u);
  float wash=gnoise(p/2.3,uTerrainSeed+713u);
  float h=terrainFields(m.dir).r;
  float face=smoothstep(0.22,0.85,m.slope);
  float dust=(1.0-face)*smoothstep(-0.3,0.27,mineral+wash*0.35);
  vec3 lit=mix(vec3(0.85,0.83,0.75),vec3(0.80,0.75,0.62),dust*0.65);
  vec3 mid=mix(vec3(0.55,0.60,0.61),vec3(0.55,0.54,0.45),dust*0.7);
  vec3 shade=vec3(0.30,0.39,0.46);
  lit=mix(lit,vec3(0.63,0.72,0.81),face*0.8);
  mid=mix(mid,vec3(0.40,0.51,0.64),face*0.8);
  shade=mix(shade,vec3(0.24,0.33,0.46),face*0.6);
  vec3 col=tone3(lit,mid,shade,m.light);
  // Keep paths mineral. Olive carpets belong to the placed ledge vegetation;
  // broad procedural colour islands on the path read as sprayed paint.
  float sediment=gnoise(p*1.8,uTerrainSeed+714u)+0.22*grain;
  col*=1.0+smoothstep(0.22,0.43,sediment)*0.025;
  col*=1.0+mineral*0.055+wash*0.035+grain*0.035;

  vec3 axis=abs(m.dir);
  vec2 uv=axis.x>axis.y&&axis.x>axis.z?p.yz:axis.y>axis.z?p.xz:p.xy;
  vec3 chips=mineralChips(uv,m.pixelMeters);
  vec3 chipColour=tone3(vec3(0.72,0.76,0.75),vec3(0.42,0.50,0.54),vec3(0.26,0.34,0.40),m.light);
  chipColour*=0.88+0.17*chips.z;
  col=mix(col,chipColour,chips.x*(1.0-face)*0.57);
  col=mix(col,tone3(vec3(0.38,0.43,0.44),vec3(0.23,0.30,0.34),vec3(0.16,0.23,0.28),m.light),chips.y*(1.0-face)*0.20);

  // Long, sparse hairlines separate exposed mineral plates. Unequal segments
  // and missing cells keep these from becoming a tiled pavement pattern.
  const float plateSize=3.1;
  vec2 cell=floor(uv/plateSize),q=fract(uv/plateSize);
  uint id=meadowHash(ivec3(ivec2(cell),0),uTerrainSeed+720u);
  vec3 rnd=vec3(float(id&255u),float((id>>8)&255u),float((id>>16)&255u))/255.0;
  vec2 a=vec2(0.09+0.12*rnd.x,0.12+0.65*rnd.y);
  vec2 b=vec2(0.39+0.17*rnd.z,0.38+0.14*rnd.x);
  vec2 c=vec2(0.73+0.12*rnd.y,0.14+0.65*rnd.z);
  float distanceToCrack=min(chalkSegment(q,a,b),chalkSegment(q,b,c))*plateSize;
  float crack=1.0-smoothstep(0.006,0.006+max(m.pixelMeters*0.65,0.002),distanceToCrack);
  float selected=(id>>24)>155u?1.0:0.0;
  float fracture=crack*selected*(1.0-smoothstep(0.055,0.32,m.pixelMeters));
  col=mix(col,vec3(0.27,0.34,0.38)*mix(uShadeTint,uSunTint,m.light),fracture*(0.22-0.07*dust));
  float bedding=1.0-smoothstep(0.018,0.10,abs(fract((h+0.12)/uChalk.z)-0.09));
  col*=1.0-bedding*face*0.12;
  return col;
}
