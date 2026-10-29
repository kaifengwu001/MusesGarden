// Aerial perspective: far ground softens to blue-green haze like a painted
// backdrop. Two terms: distance beyond the camera's altitude (so the ground
// right below stays clear), and how far around the planet a point sits
// (so the limb dissolves into the sky in Overview).
uniform vec4 uFog;    // density per m, around strength, camera altitude (m), max
uniform vec3 uFogUp;  // planet-space direction of the camera's sub-point

float aerialAmount(float viewDist, vec3 dir) {
  float beyond = max(0.0, viewDist - uFog.z);
  float dist = 1.0 - exp(-beyond * uFog.x);
  float around = smoothstep(0.6, 1.62, acos(clamp(dot(dir, uFogUp), -1.0, 1.0)));
  return clamp(dist + around * uFog.y, 0.0, uFog.w);
}

vec3 aerialColor() {
  return mix(pal(ROW_SKY, 1), pal(ROW_SKY, 2), 0.45);
}

vec3 applyAerial(vec3 col, float viewDist, vec3 dir) {
  return mix(col, aerialColor(), aerialAmount(viewDist, dir));
}
