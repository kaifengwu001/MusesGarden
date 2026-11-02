// The terraces' mist (mist.ts): one layer of strokes (mistStrokes.ts) at its height over the land's form, drawn into
// a cube map as the distance from their edges and their breadth there (mistStroke.*.glsl), drifting with the wind.
// Read by the mist itself (mist.frag.glsl) and by the paddies' water for its reflection (`mistReflected`).
// Requires: uRadius; the terraces' palette (terraces_common).
uniform samplerCube uMistBands; // the distance from the nearest stroke's edge (m, at an offset), its half-breadth there (m)
uniform mat3 uMistDrift;        // planet direction → the strokes, as far as the wind has carried them
uniform vec4 uMistLayer;        // its height (m over its form), how far its form follows the hills, the distances' offset, -
uniform sampler2D uMistGround;  // the ground's height, the land's broadest form, the hills' form (m over the radius): a raster a cube face, the six stacked

// The ground's height, the land's broadest form and the hills' form under it (m over the radius) at a direction.
vec3 mistGround(vec3 d) {
  vec3 a = abs(d);
  float face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) {
    face = d.x > 0.0 ? 0.0 : 1.0;
    uv = d.yz / a.x;
  } else if (a.y >= a.z) {
    face = d.y > 0.0 ? 2.0 : 3.0;
    uv = d.xz / a.y;
  } else {
    face = d.z > 0.0 ? 4.0 : 5.0;
    uv = d.xy / a.z;
  }
  float n = float(textureSize(uMistGround, 0).x);
  vec2 st = clamp(uv * 0.5 + 0.5, 0.5 / n, 1.0 - 0.5 / n);
  return textureLod(uMistGround, vec2(st.x, (face + st.y) / 6.0), 0.0).rgb;
}

// The layer's height over the radius at a direction (m), and the ground's there.
vec2 mistHeight(vec3 d) {
  vec3 g = mistGround(d);
  return vec2(uMistLayer.x + mix(g.y, g.z, uMistLayer.y), g.x);
}

// The nearest stroke at a direction: how far inside its edge (m: < 0 outside it), and its half-breadth there (m).
vec2 mistStroke(vec3 d) {
  vec2 s = textureLod(uMistBands, uMistDrift * d, 0.0).rg;
  return vec2(s.x - uMistLayer.z, s.y);
}

// A stroke's body (0 … 1): whole to near its edge, as the painting's ribbons are, the edge itself a little soft and
// frayed by fray (−1 … 1, m).
float mistBody(float edge, float fray) {
  return smoothstep(-0.08, 0.22, edge + 0.2 * fray);
}

// How opaque a stroke is by its breadth there (Kai: "add some translucency to them, and vary based on width"): its
// thin necks and tails see-through, its broad bodies nearly whole.
float mistOpacity(float half_) {
  return mix(0.3, 0.86, smoothstep(0.5, 3.8, half_));
}

// The mist's colour where a stroke is (edge: how far inside its edge, m; fray as for mistBody): as the painting's
// ribbons, cream, greyer toward the edge, a fine outline darker still.
vec3 mistColour(float edge, float fray) {
  vec3 col = mix(pal(TR_FOG, 4), pal(TR_FOG, 5), smoothstep(1.3, 0.35, edge));
  return mix(col, pal(TR_FOG, 6), smoothstep(0.38, 0.06, edge + 0.2 * fray) * 0.8);
}

// The mist the paddies' water mirrors at a point of it (planet space, m) along its reflected ray r (unit): where the
// ray meets the layer over that point (none where the point is over the layer), premultiplied colour and coverage.
vec4 mistReflected(vec3 p, vec3 r) {
  vec2 h = mistHeight(normalize(p));
  float rr = uRadius + h.x;
  float c = dot(p, p) - rr * rr;
  if (c > 0.0) return vec4(0.0);
  float b = dot(p, r);
  vec2 s = mistStroke(normalize(p + r * (-b + sqrt(b * b - c))));
  float a = mistBody(s.x, 0.0) * mistOpacity(s.y) * smoothstep(0.0, 0.8, h.x - h.y);
  return vec4(mistColour(s.x, 0.0) * a, a);
}
