// Field map lookups (fieldMap.ts): the ground around the focus.
//   uFieldMap:    height (m), distance to the shore (m), clearing, bloom
//   uFieldMeadow: lushness, wetness, cloud cover (cloudCoverAt: fieldShade
//                 turns it into a shadow after filtering), colour variant
//   uFieldWind:   shared bend (xyz), wind sheen (-1 trough … 1 crest)
#ifndef HAVE_CLOUD_LOOK
#define HAVE_CLOUD_LOOK
uniform vec4 uCloudLook;  // shadow strength, optical density (1/m), clouds, - (clouds.glsl declares it too)
#endif
uniform sampler2D uFieldMap;
uniform sampler2D uFieldMeadow;
uniform sampler2D uFieldWind;
uniform vec4 uFieldCentre; // focus direction, angular radius Θ
uniform vec3 uFieldT1;

// Map coordinates (in [-1, 1]²) → direction.
vec3 fieldDirection(vec2 xy) {
  vec3 c = uFieldCentre.xyz;
  vec3 t2 = cross(c, uFieldT1);
  float r = length(xy);
  float a = r * uFieldCentre.w;
  vec2 b = r > 1e-6 ? xy / r : vec2(1.0, 0.0);
  return normalize(c * cos(a) + (uFieldT1 * b.x + t2 * b.y) * sin(a));
}

// Direction → map coordinates; .z = distance from the focus as a fraction of Θ.
vec3 fieldCoords(vec3 dir) {
  vec3 c = uFieldCentre.xyz;
  vec3 t2 = cross(c, uFieldT1);
  vec2 tan2 = vec2(dot(dir, uFieldT1), dot(dir, t2));
  float s = length(tan2);
  float a = atan(s, dot(dir, c));
  float r = a / uFieldCentre.w;
  vec2 xy = s > 1e-9 ? tan2 / s * r : vec2(0.0);
  return vec3(xy, r);
}

// The clouds' and birds' shadow from the map's cover (clouds.glsl cloudShade):
// thresholded after the map is filtered, so its edge is crisp between texels.
float fieldShade(vec4 meadow) {
  return smoothstep(0.1, 0.5, meadow.z) * uCloudLook.x;
}

// Ground, meadow fields and shared wind at a direction; inside = 0 beyond the map.
vec4 fieldSample(vec3 dir, out vec4 meadow, out vec4 wind, out float inside) {
  vec3 m = fieldCoords(dir);
  inside = step(m.z, 0.98);
  vec2 uv = m.xy * 0.5 + 0.5;
  meadow = textureLod(uFieldMeadow, uv, 0.0);
  wind = textureLod(uFieldWind, uv, 0.0);
  return textureLod(uFieldMap, uv, 0.0);
}
