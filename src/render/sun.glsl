// The sun as each place on the planet sees it (sun.ts): the day's elevation
// and bearing from local north everywhere, climbing to the zenith at the
// poles. Fixed to the planet, so shadows stay put as the globe turns.
uniform vec4 uSunAngles; // sin, cos of the sun's elevation; cos, sin of its bearing from north

vec3 localSun(vec3 d) {
  vec3 north = vec3(-d.x * d.y, 1.0 - d.y * d.y, -d.z * d.y);
  float n = length(north);
  north = n > 1e-5 ? north / n : vec3(1.0, 0.0, 0.0);
  vec3 east = cross(north, d);
  vec3 s = d * uSunAngles.x + (north * uSunAngles.z + east * uSunAngles.w) * uSunAngles.y;
  return normalize(mix(d, s, smoothstep(0.0998, 0.435, n)));
}
