// The clouds' own shadows (life/cloudCover.ts), apart from the trees' and
// the rest the clouds' map holds: where the snow turns blue under a cloud.
// Requires: meadow_sun, uRadius.
uniform samplerCube uCloudCoverCube; // the clouds' optical depth where their shadows reach the water table
uniform vec4 uCloudSnow;             // how blue the snow turns under a cloud (0: no clouds), the clouds' optical density (1/m), -, -

// 0..1 under a cloud at a point (planet space, m), looked up as cloudShadowAt
// does: down the sun that place sees, to where the map holds it. edge: noise
// in [-1, 1] that roughens the outline (the paint's brushstrokes).
float cloudCoverAt(vec3 p, float edge) {
  if (uCloudSnow.x <= 0.0) return 0.0;
  float r = length(p);
  vec3 d = p / r;
  vec3 sun = localSun(d);
  float sinE = max(dot(sun, d), 0.2);
  vec3 q = normalize(d + (d * sinE - sun) * ((r - uRadius) / (sinE * uRadius)));
  float s = 1.0 - exp(-textureLod(uCloudCoverCube, q, 0.0).r * uCloudSnow.y * (1.0 + 0.45 * edge));
  return smoothstep(0.1, 0.5, s) * uCloudSnow.x;
}
