// Each find as the specimens and the spheres read it (findForms.ts). Both
// draws share one set of buffers: every vertex of a specimen carries its
// find's place and look, packed small so 400 finds fit in a megabyte.
// Requires: common, paint (pal, floraColour).
//   aNormal: the surface's facing × 127, then the find's look − 128: for a
//            bloom or spire its bed's colour (species × 64 + variant × 63),
//            for a fern, reed or stone its kin's swatch (uSwatches)
//   aFind:   direction (octahedral × 32767), ground over R (m × GROUND_SCALE),
//            family × 4096 + index; an index below MAX_BEDS is the find's bed
//            (findBeds.ts), from which it plants and lights up; the rest stand
//            fully grown
attribute vec4 aNormal;
attribute vec4 aFind;
uniform vec4 uBeds[MAX_BEDS]; // per bed: planted at (s on uPlantClock), highlight 0..1, hover lift 0..1, pulsed at (s)
uniform float uPlantClock;
uniform vec4 uFindLook;       // hovered index, open index (-1: none), specimens shown 0..1, spheres shown 0..1
uniform vec4 uSwatches[MAX_SWATCHES]; // palette row, lit, mid, shade

// how high a hovered bed rises (m, as findBed.vert.glsl raises it): its specimen and its glow rise with it
#define BED_LIFT 0.22

#define FAMILY_BLOOM 0
#define FAMILY_SPIRE 1
#define FAMILY_FERN 2
#define FAMILY_REED 3
#define FAMILY_STONE 4

struct Find {
  vec3 dir;
  float ground;
  int family;
  float index;
  float look;
  float seed;
};

vec3 octahedral(vec2 e) {
  vec3 v = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) v.xy = (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
  return normalize(v);
}

Find findOf() {
  Find f;
  f.dir = octahedral(aFind.xy / 32767.0);
  f.ground = aFind.z / GROUND_SCALE;
  float family = floor(aFind.w / 4096.0);
  f.family = int(family);
  f.index = aFind.w - family * 4096.0;
  f.look = aNormal.w + 128.0;
  f.seed = fract(f.index * 0.6180339 + 0.31);
  return f;
}

// Seconds since it was planted with its bed (<= 0: not yet); long grown past the beds.
float findAge(Find f) {
  return f.index < float(MAX_BEDS) ? uPlantClock - uBeds[int(f.index)].x : 1e6;
}

// How far its bed is lifted (m): hovered, it rises a little.
float findLift(Find f) {
  return f.index < float(MAX_BEDS) ? BED_LIFT * uBeds[int(f.index)].z : 0.0;
}

// How lit it is, 0..1 each: hovered, open (or its bed lit under its card), pulsing (once, as it lands).
vec3 findLit(Find f) {
  float hovered = 1.0 - step(0.5, abs(f.index - uFindLook.x));
  float open = 1.0 - step(0.5, abs(f.index - uFindLook.y));
  float pulse = 0.0;
  if (f.index < float(MAX_BEDS)) {
    vec4 bed = uBeds[int(f.index)];
    open = max(open, bed.y);
    float since = uPlantClock - bed.w;
    pulse = since > 0.0 && since < PULSE ? sin(MEADOW_PI * since / PULSE) : 0.0;
  }
  return vec3(hovered, open, pulse);
}

// Its own colour in light b: a bloom's or spire's petals in its bed's, the rest in its kin's swatch.
vec3 findColour(Find f, float b) {
  if (f.family <= FAMILY_SPIRE) {
    int species = int(f.look / 64.0);
    float variant = (f.look - float(species) * 64.0) / 63.0;
    return tone3(floraColour(species, variant, 1.0), floraColour(species, variant, 0.6), floraColour(species, variant, 0.0), b);
  }
  ivec4 s = ivec4(uSwatches[int(f.look + 0.5)] + 0.5);
  return tone3(pal(s.x, s.y), pal(s.x, s.z), pal(s.x, s.w), b);
}

// The warm light a lit find glows in.
vec3 findGlow() {
  return mix(pal(ROW_LIGHT, 0), pal(ROW_SCATTER, 10), 0.35);
}
