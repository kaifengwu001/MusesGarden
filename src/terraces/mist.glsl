// The terraces' mist (mist.ts): three layers of strokes at their own heights (mistStrokes.ts), each layer's drawn
// into its cube map as the distance from their edges (mistStroke.*.glsl), drifting with the wind. Read by the mist
// itself (mist.frag.glsl) and by the ground for the shadows it casts (`mistShadowAt`).
// Requires: uRadius, sun (localSun); MIST_OFFSET (mist.ts OFFSET), or 10.
uniform samplerCube uMistBands0;
uniform samplerCube uMistBands1;
uniform samplerCube uMistBands2;
uniform mat3 uMistDrift[3]; // planet direction → each layer's strokes, as far as the wind has carried them
uniform vec4 uMistLayer[3]; // height (m over its form), -, -, density
uniform float uMistFollow[3]; // how far each layer's form follows the hills (0: the land's broadest form; 1: the hills')
uniform vec4 uMistLook;     // shadow strength, -, -, -
uniform sampler2D uMistGround; // the ground's height, the land's broadest form, the hills' form (m over the radius): a raster a cube face, the six stacked

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

// A layer's height over the radius at a direction (m), and the ground's there.
vec2 mistHeight(int i, vec3 d) {
  vec3 g = mistGround(d);
  return vec2(uMistLayer[i].x + mix(g.y, g.z, uMistFollow[i]), g.x);
}

#ifndef MIST_OFFSET
#define MIST_OFFSET 10.0
#endif

// How far inside the edge of a layer's nearest stroke a direction lies (m: < 0 outside it).
float mistEdge(samplerCube bands, int i, vec3 d) {
  return textureLod(bands, uMistDrift[i] * d, 0.0).r - MIST_OFFSET;
}

// A stroke's body (0 … 1) from mistEdge: whole to near its edge, as the painting's ribbons are, the edge itself a
// little soft and frayed by fray (−1 … 1, m).
float mistBody(float edge, float fray) {
  return smoothstep(-0.08, 0.22, edge + 0.2 * fray);
}

// A layer's shadow at a point of the ground (planet space, m): its body where the sun's ray from there meets it, as
// dense as it is seen from below; none if the point is over the layer.
float mistLayerShade(samplerCube bands, int i, vec3 p, vec3 sun) {
  float r = uRadius + mistHeight(i, normalize(p)).x;
  float c = dot(p, p) - r * r;
  if (c > 0.0) return 0.0;
  float b = dot(p, sun);
  vec3 q = normalize(p + sun * (-b + sqrt(b * b - c)));
  float body = mistBody(mistEdge(bands, i, q), 0.0);
  return 1.0 - exp(-uMistLayer[i].w * body);
}

// The mist's shadow at a point of the ground (planet space, m): 0 … 1, all the layers', by the shadow's strength.
float mistShadowAt(vec3 p) {
  vec3 sun = localSun(normalize(p));
  float lit = (1.0 - mistLayerShade(uMistBands0, 0, p, sun)) * (1.0 - mistLayerShade(uMistBands1, 1, p, sun)) * (1.0 - mistLayerShade(uMistBands2, 2, p, sun));
  return (1.0 - lit) * uMistLook.x;
}
