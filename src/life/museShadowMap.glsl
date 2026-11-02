// Muse's shadow (muse.ts): a small map of its own about where its shadow
// reaches the water table, down the sun at Muse. Its texels are a few
// millimetres across and it travels with Muse, so the shadow's edge stays
// clean and still as Muse moves (the clouds' map, with texels of 7 cm and
// more, gave it a stepped edge that shifted). The ground, the props, the
// grass, the flowers and the finds' patches read it; Muse never does.
uniform sampler2D uMuseShadow;
uniform mat3 uMuseShadowFrame;  // the map's frame: across (toward the sun's bearing), up the map, out (its centre)
uniform vec4 uMuseShadowSun;    // the sun at Muse (xyz), and how far from its feet its shadow can fall, squared (m²)
uniform vec4 uMuseShadowWindow; // R / the map's half-width (m), strength (0: no shadow), the soft edge's reach (map units)
uniform vec3 uMuseShadowFeet;   // where Muse stands (planet space, m)

// 0..1 shadow Muse casts at a point (planet space, m): the point carried down
// the sun to the water table and read in the map, its edge a little soft.
float museShadowAt(vec3 p) {
  vec3 off = p - uMuseShadowFeet;
  if (uMuseShadowWindow.y <= 0.0 || dot(off, off) > uMuseShadowSun.w) return 0.0;
  vec3 L = uMuseShadowSun.xyz;
  float cl = dot(p, L);
  vec3 g = p - L * (cl - sqrt(max(cl * cl - dot(p, p) + uRadius * uRadius, 0.0)));
  vec3 f = g * uMuseShadowFrame;
  if (f.z <= 0.0) return 0.0;
  vec2 m = f.xy / f.z * uMuseShadowWindow.x;
  if (max(abs(m.x), abs(m.y)) >= 1.0) return 0.0;
  vec2 uv = m * 0.5 + 0.5;
  float s = uMuseShadowWindow.z;
  float a = textureLod(uMuseShadow, uv + vec2(s, s), 0.0).r + textureLod(uMuseShadow, uv + vec2(-s, s), 0.0).r
    + textureLod(uMuseShadow, uv + vec2(s, -s), 0.0).r + textureLod(uMuseShadow, uv + vec2(-s, -s), 0.0).r;
  return smoothstep(0.0, 1.0, 0.25 * a) * uMuseShadowWindow.y;
}
