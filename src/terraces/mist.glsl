// The terraces' mist (mist.ts): three layers of bands at their own heights, each band where its layer's winding
// field (baked, mistBake.frag.glsl) is near zero, present where the layer's presence allows, drifting with the wind.
// Read by the mist itself (mist.frag.glsl) and by the ground for the shadows it casts (`mistShadowAt`).
// Requires: uRadius, sun (localSun).
uniform samplerCube uMistBands0;
uniform samplerCube uMistBands1;
uniform samplerCube uMistBands2;
uniform mat3 uMistDrift[3]; // planet direction → each layer's field, as far as the wind has carried it
uniform vec4 uMistLayer[3]; // height (m over the radius), half-breadth (m), where its presence begins, density
uniform vec4 uMistLook;     // shadow strength, -, -, -
uniform sampler2D uMistGround; // the ground's height (m over the radius): a raster a cube face, the six stacked

// The ground's height (m over the radius) at a direction.
float mistGround(vec3 d) {
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
  return textureLod(uMistGround, vec2(st.x, (face + st.y) / 6.0), 0.0).r;
}

// A layer's band at a direction: how many of its half-breadths from its middle line (0 there, 1 at its edge), and
// its presence there (0 … 1: where the presence fails the band narrows away to nothing, so bands end tapering); its
// half-breadth swells and thins along it.
vec2 mistBand(samplerCube bands, int i, vec3 d) {
  vec3 b = textureLod(bands, uMistDrift[i] * d, 0.0).rgb;
  vec4 L = uMistLayer[i];
  float present = smoothstep(L.z - 0.12, L.z + 0.12, b.y);
  return vec2(abs(b.x) / max(L.y * (0.45 + 0.9 * b.z) * present, 1e-3), present);
}

// A band's body (0 … 1) from mistBand: dense down its middle, feathered toward its edges, frayed by fray (−1 … 1).
float mistBody(vec2 band, float fray) {
  return smoothstep(1.0, 0.62, band.x + 0.2 * fray * smoothstep(0.4, 0.9, band.x));
}

// A layer's shadow at a point of the ground (planet space, m): its body where the sun's ray from there meets it, as
// dense as it is seen from below; none if the point is over the layer.
float mistLayerShade(samplerCube bands, int i, vec3 p, vec3 sun) {
  float r = uRadius + uMistLayer[i].x;
  float c = dot(p, p) - r * r;
  if (c > 0.0) return 0.0;
  float b = dot(p, sun);
  vec3 q = normalize(p + sun * (-b + sqrt(b * b - c)));
  float body = mistBody(mistBand(bands, i, q), 0.0);
  return 1.0 - exp(-uMistLayer[i].w * body);
}

// The mist's shadow at a point of the ground (planet space, m): 0 … 1, all the layers', by the shadow's strength.
float mistShadowAt(vec3 p) {
  vec3 sun = localSun(normalize(p));
  float lit = (1.0 - mistLayerShade(uMistBands0, 0, p, sun)) * (1.0 - mistLayerShade(uMistBands1, 1, p, sun)) * (1.0 - mistLayerShade(uMistBands2, 2, p, sun));
  return (1.0 - lit) * uMistLook.x;
}
