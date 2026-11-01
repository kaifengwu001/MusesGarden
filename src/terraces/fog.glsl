// Valley fog (云雾): banks of mist lying in the valleys, a sea of it with a
// soft, level top that rises where the bank is thick and sinks to nothing
// between banks, so the hills and the peaks stand out of it and its edges
// meander round their feet. Two drifting layers of different sizes and
// speeds, carried along the wind, shape the banks. Integrated along the
// view in planet space: the stretch of a segment under the fog's highest
// top (a sphere), eight samples of its density. Around the camera the fog
// clears (you walk in a clearing of it, never in a white-out).
// Requires: uRadius, terraces_common (uWindVec), terraces_plots (uTerraceLife),
// toon (pal), warp.

uniform vec4 uValleyFog; // density in a bank (1/m), the banks' top (m), the top's softness (m), the clearing round the camera (m)
uniform vec4 uFogDrift;  // cos, sin of layer A's drift about the wind axis; cos, sin of layer B's
uniform vec4 uFogCover;  // cover threshold, softness, the fog's light (0 shade … 1 sun), -

vec3 fogTurn(vec3 p, float c, float s) {
  vec3 a = uWindVec.xyz;
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

// How thick the fog is above a direction, 0..1 (its banks' shapes).
float fogCover(vec3 d) {
  float a = textureLod(uTerraceLife, fogTurn(d, uFogDrift.x, uFogDrift.y), 0.0).r;
  float b = textureLod(uTerraceLife, fogTurn(d, uFogDrift.z, uFogDrift.w), 0.0).g;
  return smoothstep(uFogCover.x - uFogCover.y, uFogCover.x + uFogCover.y, 0.62 * a + 0.38 * b);
}

// Fog density (1/m) at a point, planet space; cam: the camera, planet space.
float fogDensityAt(vec3 q, vec3 cam) {
  float l = length(q);
  float h = l - uRadius;
  float cover = fogCover(q / l);
  // a thick bank stands taller; a thin one lies low
  float top = uValleyFog.y * (0.35 + 0.85 * cover);
  float body = 1.0 - smoothstep(top - uValleyFog.z, top + uValleyFog.z, h);
  float clearing = smoothstep(0.35 * uValleyFog.w, uValleyFog.w, distance(q, cam));
  return uValleyFog.x * cover * body * clearing;
}

// How much fog lies between c and p (planet space), 0..1.
float valleyFog(vec3 c, vec3 p) {
  if (uValleyFog.x <= 0.0) return 0.0;
  float top = uRadius + 1.2 * uValleyFog.y + uValleyFog.z;
  vec3 d = p - c;
  float A = dot(d, d);
  if (A < 1e-6) return 0.0;
  float B = 2.0 * dot(c, d);
  float C = dot(c, c) - top * top;
  float disc = B * B - 4.0 * A * C;
  if (disc <= 0.0) return 0.0;
  float s = sqrt(disc);
  float t0 = max((-B - s) / (2.0 * A), 0.0);
  float t1 = min((-B + s) / (2.0 * A), 1.0);
  if (t1 <= t0) return 0.0;
  float tau = 0.0;
  for (int i = 0; i < 8; i++) tau += fogDensityAt(c + d * mix(t0, t1, (float(i) + 0.5) / 8.0), c);
  tau *= sqrt(A) * (t1 - t0) / 8.0;
  return 1.0 - exp(-tau);
}

// The fog's colour seen at a height (m): white in the sun at its top, a soft blue-grey deeper in it.
vec3 fogColour(float h) {
  float up = smoothstep(0.0, uValleyFog.y, h);
  vec3 lit = mix(pal(TR_FOG, 1), pal(TR_FOG, 0), uFogCover.z);
  return mix(mix(pal(TR_FOG, 2), lit, 0.6), lit, up);
}

// The valley fog over a colour seen from the camera (view space) at a point (planet space).
vec3 applyValleyFog(vec3 col, vec3 p) {
  vec3 c = unwarpPosition(cameraPosition);
  float amount = valleyFog(c, p);
  return mix(col, fogColour(min(length(c), length(p)) - uRadius), amount);
}
