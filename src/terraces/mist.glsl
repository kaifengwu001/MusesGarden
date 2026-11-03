// The terraces' mist (mist.ts): one layer of strokes (mistStrokes.ts) round a sphere at its height over the radius,
// their clouds each up or down from it, their shapes drawn into a cube map as the distance from their edges and their
// breadth there (mistStroke.*.glsl), drifting with the wind. Read by the mist itself (mist.frag.glsl) and by the
// paddies' water for its reflection (`mistReflected`).
// Requires: uRadius; the terraces' palette (terraces_common).
uniform samplerCube uMistBands; // the distance from the nearest stroke's edge (m, at an offset), its half-breadth there (m)
uniform mat3 uMistDrift;        // planet direction → the strokes, as far as the wind has carried them
uniform vec4 uMistLayer;        // its sphere's height (m over the radius), -, the distances' offset, its density (× its own: the panel's slider)
uniform sampler2D uMistGround;  // the ground's height (m over the radius): a raster a cube face, the six stacked

// The ground's height under a direction (m over the radius).
float mistGround(vec3 d) {
  return textureLod(uMistGround, faceAtlas(d, float(textureSize(uMistGround, 0).x)), 0.0).r;
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
// thin necks and tails see-through, its broad bodies nearly whole; all of it the denser by the layer's density.
float mistOpacity(float half_) {
  return min(mix(0.3, 0.86, smoothstep(0.5, 3.8, half_)) * uMistLayer.w, 0.97);
}

// The mist's colour where a stroke is (edge: how far inside its edge, m; fray as for mistBody): as the painting's
// ribbons, cream, greyer toward the edge, a fine outline darker still.
vec3 mistColour(float edge, float fray) {
  vec3 col = mix(pal(TR_FOG, 4), pal(TR_FOG, 5), smoothstep(1.3, 0.35, edge));
  return mix(col, pal(TR_FOG, 6), smoothstep(0.38, 0.06, edge + 0.2 * fray) * 0.8);
}

// The mist the paddies' water mirrors at a point of it (planet space, m) along its reflected ray r (unit): where the
// ray meets the layer's sphere (none where the point is over it; its clouds' own heights let be), premultiplied
// colour and coverage.
vec4 mistReflected(vec3 p, vec3 r) {
  float rr = uRadius + uMistLayer.x;
  float c = dot(p, p) - rr * rr;
  if (c > 0.0) return vec4(0.0);
  float b = dot(p, r);
  vec2 s = mistStroke(normalize(p + r * (-b + sqrt(b * b - c))));
  float a = mistBody(s.x, 0.0) * mistOpacity(s.y) * smoothstep(0.0, 0.8, uMistLayer.x - mistGround(normalize(p)));
  return vec4(mistColour(s.x, 0.0) * a, a);
}
