// One coherent wind field for grass, flowers, petals, clouds, water and the
// painted meadow. The steady flow is a solid-body rotation about uWindVec.xyz
// (a smooth tangent field on the whole sphere), which makes advection exact:
// a travelling pattern is sampled at the point rotated back along the flow.
// Two travel at once: broad gust bands, and finer ripples that run ahead of
// them. Together they lay the grass over in waves that catch the light: a
// pale crest where a gust presses the grass flat, and just behind it (upwind)
// a dark trough where the grass springs back up and shows its shaded depth,
// so the meadow reads like a swell running across it.
// Requires: noise, meadow (windDir), terrain (chordAngle, uRadius).
#define MAX_GUST_RINGS 4
uniform vec4 uGust;                       // time (s), -, gustiness, strength
uniform vec4 uGustRot;                    // cos, sin of the advection angle: gust bands; cos, sin: ripples
uniform vec4 uGustFreq;                   // gust and ripple frequencies (direction space), -, -
uniform vec4 uGustRings[MAX_GUST_RINGS];  // centre direction, start time (s); w < 0 = unused

vec3 rotateAboutWind(vec3 p, float c, float s) {
  vec3 a = uWindVec.xyz;
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

// The gust waves at dir, long across the wind and travelling downwind:
// x = how far a gust lays the grass over (0..1, the crests), y = how far the
// grass springs back just behind a crest (0..1, the troughs: where the crest
// is a little downwind of here).
vec2 gustWaves(vec3 dir) {
  vec3 q = rotateAboutWind(dir, uGustRot.x, uGustRot.y);
  vec3 along = windDir(q);
  vec3 p = q * uGustFreq.x;
  p += along * dot(p, along) * 2.8; // crests long across the wind
  float g = 0.5 + 0.5 * gnoise(p, uTerrainSeed + 150u);
  float behind = 0.5 + 0.5 * gnoise(p + along * 0.5, uTerrainSeed + 150u);
  float crest = smoothstep(0.58, 0.7, g);
  float trough = smoothstep(0.58, 0.7, behind) * (1.0 - smoothstep(0.45, 0.58, g));
  return vec2(crest, trough);
}

// 0..1 gust bands (the crests alone): how hard the gust pushes here.
float gustAt(vec3 dir) {
  return gustWaves(dir).x;
}

// 0..1 ripples: narrower crests, quicker than the gusts.
float rippleAt(vec3 dir) {
  vec3 q = rotateAboutWind(dir, uGustRot.z, uGustRot.w);
  vec3 along = windDir(q);
  vec3 p = q * uGustFreq.y;
  p += along * dot(p, along) * 3.4;
  return smoothstep(0.4, 0.75, 0.5 + 0.5 * gnoise(p, uTerrainSeed + 151u));
}

// The sheen of the grass at dir right now, -1..1: positive on a crest (laid
// over, catching the light, with its ripples), negative in a trough (springing
// back, in its own shade). Drives the paint and the blades.
float windSheen(vec2 waves, float ripple) {
  float strength = (0.35 + uGust.z) * smoothstep(0.02, 0.35, uWindVec.w);
  float crest = clamp(waves.x * (0.55 + 0.45 * ripple) * strength * 1.6, 0.0, 1.0);
  float trough = clamp(waves.y * (0.8 + 0.2 * (1.0 - ripple)) * strength * 1.5, 0.0, 1.0);
  return crest - trough;
}

// The shared part of the bend at dir: steady flow, travelling gusts and
// ripples, and click rings. Expensive (noise), so the field map evaluates it
// once per texel and plants read it back; windPlant adds the cheap per-plant part.
vec3 windBase(vec3 dir, float gust, float trough, float ripple) {
  vec3 w = windDir(dir);
  float strength = uWindVec.w;
  float t = uGust.x;
  float steady = strength * (0.18 + 0.42 * strength);
  float gusts = strength * uGust.z * 0.75 * gust;
  float ripples = strength * 0.22 * (ripple - 0.4) * (0.4 + gust);
  // behind a crest the grass springs back, leaning a little upwind of its rest
  float spring = -strength * uGust.z * 0.3 * trough;
  vec3 bend = w * (steady + gusts + ripples + spring);
  // click gust rings push outward from where you clicked
  for (int i = 0; i < MAX_GUST_RINGS; i++) {
    vec4 r = uGustRings[i];
    if (r.w < 0.0) continue;
    float age = t - r.w;
    if (age < 0.0 || age > 2.6) continue;
    float d = chordAngle(dir, r.xyz) * uRadius;
    float front = d - 6.5 * age;
    float push = exp(-front * front / 2.2) * (1.0 - age / 2.6) * smoothstep(0.0, 0.15, age);
    vec3 away = dir * dot(dir, r.xyz) - r.xyz;
    float l = length(away);
    if (l > 1e-6) bend += away / l * push * 1.1;
  }
  return bend;
}

// Per-plant flutter and a cross-wind wobble on top of the shared bend, so the
// meadow never moves in lockstep. phase: per-plant random in [0, 1).
vec3 windPlant(vec3 dir, vec3 base, float phase, float stiffness) {
  vec3 w = windDir(dir);
  float strength = uWindVec.w;
  float t = uGust.x;
  float flutter = 0.07 * (0.3 + strength) * sin(t * (2.1 + phase * 1.7) + phase * 40.0);
  vec3 side = cross(dir, w);
  return (base + w * flutter + side * 0.05 * (0.3 + strength) * sin(t * 1.3 + phase * 23.0)) / stiffness;
}
