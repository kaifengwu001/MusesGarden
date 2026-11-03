// What grows where (planet/parcels.glsl bakes it), and its colours. Read by
// the standing crop's canopy (ryeCanopy.*.glsl), the detailed ears
// (rye.vert.glsl) and the ground paint (surface.frag.glsl), so a field is the
// same yellow in all three.
uniform samplerCube uParcelBake; // crop depth (m), field tone, road (m), cut

const float CROP_STUBBLE = 0.13;   // reaped stubble (m)
const float CROP_SHOULDER = 0.55;  // the crop's rounded edge rises over this (m)
const float CROP_BUND_GRASS = 0.17; // grass on the bunds (m)

vec4 parcelAt(vec3 dir) {
  return textureLod(uParcelBake, dir, 0.0);
}

vec3 cropLinear(vec3 c) {
  return pow(c, vec3(2.2));
}

// The field's crop: 0 reaped stubble, 1 young yellow-green, 2 lemon, 3 gold, 4 deep gold.
int cropKind(float tone) {
  // (0, reaped stubble, comes only from the rings round sheaves: parcels.glsl cut)
  if (tone < 0.14) return 1;
  if (tone < 0.38) return 2;
  if (tone < 0.88) return 3;
  return 4;
}

// Standing height of a field's crop before its edge and any reaping (m).
float cropTall(float tone) {
  int k = cropKind(tone);
  float h = k == 0 ? CROP_STUBBLE : k == 1 ? 0.84 : k == 2 ? 1.0 : k == 3 ? 1.06 : 1.12;
  return h * (0.93 + 0.14 * fract(tone * 113.7));
}

// The crop's height at a sample (m): rounded at the field's edge, low where reaped.
float cropHeight(vec4 p) {
  if (p.x <= 0.0) return 0.0;
  float h = mix(cropTall(p.y), CROP_STUBBLE, p.w);
  float edge = clamp(p.x / CROP_SHOULDER, 0.0, 1.0);
  return h * sqrt(edge * (2.0 - edge));
}

// Grass on the bunds and in the yards (m); none on the road.
float grassHeight(vec4 p) {
  if (p.x > 0.0) return 0.0;
  return CROP_BUND_GRASS * smoothstep(0.0, 0.25, p.z);
}

// The colour of the crop's ears in sun, by field (linear).
vec3 cropTop(float tone, float cut) {
  int k = cropKind(tone);
  vec3 c = k == 0 ? vec3(0.89, 0.76, 0.44)
         : k == 1 ? vec3(0.80, 0.79, 0.25)
         : k == 2 ? vec3(0.97, 0.87, 0.27)
         : k == 3 ? vec3(0.96, 0.75, 0.12)
         : vec3(0.90, 0.60, 0.10);
  c *= 0.95 + 0.09 * fract(tone * 57.31);
  c = mix(c, vec3(0.89, 0.76, 0.44), cut);
  return cropLinear(c);
}

// Deep inside the crop, under the ears: a darker, greener yellow (linear),
// not brown, so a field seen from above stays a yellow mass with olive flecks.
vec3 cropDeep(vec3 top) {
  return mix(top * vec3(0.5, 0.46, 0.26), cropLinear(vec3(0.5, 0.47, 0.13)), 0.35);
}

// Whether a sample is reaped stubble (a stubble field, or round a sheaf), 0..1.
float cropReaped(vec4 p) {
  return max(p.w, cropKind(p.y) == 0 ? 1.0 : 0.0);
}

// Unripe crop is green; Ripen (uRyeRipeness and held discs) turns it.
vec3 cropUnripe(float along) {
  return mix(cropLinear(vec3(0.30, 0.38, 0.11)), cropLinear(vec3(0.62, 0.68, 0.25)), along);
}

// Bund grass: deep olive at the root, lighter at the tips (linear).
vec3 bundGrass(float along) {
  return mix(cropLinear(vec3(0.33, 0.36, 0.10)), cropLinear(vec3(0.60, 0.61, 0.20)), along);
}

// The farm road's packed earth (linear).
vec3 roadDust(float shade) {
  // dusty pinkish beige, as in the farm map reference
  return cropLinear(mix(vec3(0.72, 0.62, 0.53), vec3(0.87, 0.77, 0.67), shade));
}

// How much of the sun the crop beside a point hides from it, at height h (m)
// over the ground: a few steps up the sun's ray, against the crop's height
// where each lands. dir and sun are planet-space unit vectors.
float cropShade(vec3 dir, float h, vec3 sun, float radius) {
  float sinE = dot(sun, dir);
  vec3 across = sun - dir * sinE;
  float cosE = length(across);
  if (sinE <= 0.05 || cosE < 1e-3) return 0.0;
  vec3 toward = across / cosE;
  float tanE = sinE / cosE;
  float reach = clamp((1.2 - h) / tanE, 0.0, 3.0);
  float shade = 0.0;
  for (int i = 1; i <= 3; i++) {
    float l = reach * float(i) / 3.0;
    float crop = cropHeight(parcelAt(normalize(dir + toward * (l / radius))));
    shade = max(shade, smoothstep(-0.04, 0.12, crop - h - l * tanE));
  }
  return shade;
}
