// Cloud light on the ground (天光云影): soft-edged shadows sweeping over the
// meadow and the water with the wind, and the clouds mirrored in the lakes.
// Two kinds of cloud: the drifting puffs (clouds.ts writes one record per
// cloud), and a high broken deck: a noise field on a shell above the meadow,
// advected with the wind, drawn in the sky from the meadow (sky.frag.glsl),
// shading the ground below and mirrored in the water.
// Requires: noise, terrain (uRadius, uTerrainSeed), meadow (uWindVec).
#define MAX_CLOUDS 12
uniform vec4 uCloudShadows[MAX_CLOUDS]; // shadow centre on the ground (direction), angular radius (0 = unused)
uniform vec4 uCloudAxes[MAX_CLOUDS];    // long axis (tangent, unit), length ÷ width
uniform vec4 uCloudTops[MAX_CLOUDS];    // cloud centre direction, height of its base (m)
uniform vec4 uCloudLook;                // shadow strength, outline softness, puffs shown (0..1), -
uniform vec4 uCloudDeck;                // deck frequency (direction space), threshold, softness, height (m)
uniform vec4 uCloudDrift;               // cos, sin of the deck's drift angle about the wind axis

// The deck's noise at a direction (drifting with the wind).
float deckNoise(vec3 dir) {
  vec3 a = uWindVec.xyz;
  vec3 q = dir * uCloudDrift.x + cross(a, dir) * uCloudDrift.y + a * dot(a, dir) * (1.0 - uCloudDrift.x);
  q *= uCloudDeck.x;
  return gnoise(q, uTerrainSeed + 170u) + 0.5 * gnoise(q * 2.13, uTerrainSeed + 171u);
}

// How much of the deck a ray from p (planet space, m) along r passes through:
// soft cumulus edges, thicker toward their middles. 0 if it never reaches it.
float deckSeen(vec3 p, vec3 r) {
  float shell = uRadius + uCloudDeck.w;
  float b = dot(p, r);
  float disc = b * b - dot(p, p) + shell * shell;
  if (disc < 0.0) return 0.0;
  vec3 hit = normalize(p + r * (-b + sqrt(disc)));
  return smoothstep(uCloudDeck.y - 0.03, uCloudDeck.y + 0.2, deckNoise(hit));
}

// Elliptical distance from dir to a cloud outline centred at c (1 on the edge).
float cloudEllipse(vec3 dir, vec3 c, vec4 axes, float radius) {
  vec3 off = dir - c * dot(dir, c);
  float a = dot(off, axes.xyz);
  float b = length(off - axes.xyz * a);
  return length(vec2(a / axes.w, b)) / radius;
}

// Is dir within reach of a cloud's outline? (cos θ ≥ 1 − θ²/2, θ a bound on the outline)
bool nearCloud(vec3 dir, vec4 c, vec4 axes) {
  float reach = c.w * max(axes.w, 1.0) * 1.3;
  return dot(dir, c.xyz) > 1.0 - 0.5 * reach * reach;
}

// Distance (in outline units) to the nearest cloud shadow.
float cloudOutline(vec3 dir) {
  float d = 9.0;
  for (int i = 0; i < MAX_CLOUDS; i++) {
    vec4 c = uCloudShadows[i];
    if (c.w <= 0.0 || !nearCloud(dir, c, uCloudAxes[i])) continue;
    d = min(d, cloudEllipse(dir, c.xyz, uCloudAxes[i], c.w));
  }
  return d;
}

// The deck's shadow at dir: its first octave, the outline roughened by `edge`.
float deckShadow(vec3 dir, float edge) {
  vec3 a = uWindVec.xyz;
  vec3 q = (dir * uCloudDrift.x + cross(a, dir) * uCloudDrift.y + a * dot(a, dir) * (1.0 - uCloudDrift.x)) * uCloudDeck.x;
  float n = gnoise(q, uTerrainSeed + 170u) * 1.12 + edge * 0.07;
  return smoothstep(uCloudDeck.y - uCloudDeck.z, uCloudDeck.y + uCloudDeck.z, n);
}

// 0..1 cloud shadow at dir. edge: noise in [-1, 1] that roughens the outlines
// (the paint passes its brushstrokes, so shadow edges look brushed).
float cloudShadowAt(vec3 dir, float edge) {
  float s = smoothstep(1.0, 1.0 - uCloudLook.y, cloudOutline(dir) + edge * 0.16);
  return max(s, deckShadow(dir, edge)) * uCloudLook.x;
}

// Version for the vegetation (the field map): no brushed edge.
float cloudShadow(vec3 dir) {
  return cloudShadowAt(dir, 0.0);
}

// How much cloud a ray from p (planet space, m) along r meets: the puffs, each
// on the shell at its base height, and the deck. For reflections in the water.
float cloudSeen(vec3 p, vec3 r) {
  float cover = deckSeen(p, r);
  if (uCloudLook.z < 0.01) return cover; // the puffs are not shown (down in the meadow)
  for (int i = 0; i < MAX_CLOUDS; i++) {
    vec4 c = uCloudShadows[i];
    if (c.w <= 0.0) continue;
    vec4 top = uCloudTops[i];
    float shell = uRadius + top.w;
    // ray–sphere |p + r t| = shell, the far root (p is inside the shell)
    float b = dot(p, r);
    float disc = b * b - dot(p, p) + shell * shell;
    if (disc < 0.0) continue;
    vec3 hit = normalize(p + r * (-b + sqrt(disc)));
    if (dot(hit, top.xyz) < 0.0) continue;
    float d = cloudEllipse(hit, top.xyz, uCloudAxes[i], c.w);
    cover = max(cover, smoothstep(1.0, 0.55, d) * uCloudLook.z);
  }
  return cover;
}
