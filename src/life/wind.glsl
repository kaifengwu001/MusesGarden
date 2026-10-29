// One coherent wind field for grass, flowers, petals, clouds and water.
// The steady flow is a solid-body rotation about uWindVec.xyz (so it is a
// smooth tangent field on the whole sphere), which makes advection exact:
// gust patterns are sampled at the point rotated back along the flow.
// Requires: noise, meadow (windDir), terrain (chordAngle, uRadius).
#define MAX_GUST_RINGS 4
uniform vec4 uGust;                        // time (s), -, gustiness, strength
uniform vec4 uGustRot;                     // cos, sin of the advection angle; gust frequency; -
uniform vec4 uGustRings[MAX_GUST_RINGS];  // centre direction, start time (s); w < 0 = unused

vec3 rotateAboutWind(vec3 p) {
  vec3 a = uWindVec.xyz;
  float c = uGustRot.x;
  float s = uGustRot.y;
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

// 0..1 gust bands, long across the wind, travelling downwind.
float gustAt(vec3 dir) {
  vec3 q = rotateAboutWind(dir);
  vec3 along = windDir(q);
  vec3 p = q * uGustRot.z;
  p += along * dot(p, along) * 1.6;
  float g = 0.5 + 0.5 * gnoise(p, uTerrainSeed + 150u);
  return smoothstep(0.42, 0.85, g);
}

// Tangent bend vector at dir (≈ tip displacement per unit height).
// phase: per-plant random in [0, 1).
vec3 windBend(vec3 dir, float phase, float stiffness) {
  vec3 w = windDir(dir);
  float strength = uWindVec.w;
  float t = uGust.x;
  float gust = gustAt(dir);
  float steady = strength * (0.18 + 0.42 * strength);
  float gusts = strength * uGust.z * 0.75 * gust;
  float flutter = 0.07 * (0.3 + strength) * sin(t * (2.1 + phase * 1.7) + phase * 40.0);
  vec3 bend = w * (steady + gusts + flutter);
  // a cross-wind wobble so the meadow never moves in lockstep
  vec3 side = cross(dir, w);
  bend += side * 0.05 * (0.3 + strength) * sin(t * 1.3 + phase * 23.0);
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
  return bend / stiffness;
}
