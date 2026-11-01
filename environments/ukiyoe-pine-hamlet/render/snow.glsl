// Snow printed as warm paper, soft blue depressions and sparse dry pigment.
// Coordinates stay on the resting surface. The caller supplies the pixel
// footprint BEFORE any per-material branch: no derivatives in this helper,
// so it is also safe in shaders which include meadow_paint in the vertex stage.
float snowWash(vec2 p) {
  vec2 cell = floor(p), t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), t.x),
             mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + 1.0), t.x), t.y);
}

vec3 snowPrint(vec3 restMeters, float pixelMeters, float light) {
  vec2 p = vec2(restMeters.x * 0.85 + restMeters.y * 0.33,
                restMeters.z * 0.80 + restMeters.y * 0.61);
  float footprint = max(pixelMeters, 0.0001);
  float wash = snowWash(p * vec2(0.42, 0.85) + 7.3);
  float relief = 1.0 - smoothstep(0.23, 0.59, wash);
  relief *= 1.0 - smoothstep(0.65, 2.5, footprint);
  float aa = min(footprint * 0.6, 0.22);
  // Broken, shallow blue scoops rather than parallel stripes or sparkling noise.
  float scallop = smoothstep(0.35 - aa, 0.39 + aa, wash)
                * (1.0 - smoothstep(0.43 - aa, 0.49 + aa, wash));
  scallop *= 1.0 - smoothstep(0.24, 0.65, footprint);
  vec3 paper = pow(vec3(0.975, 0.962, 0.922), vec3(2.2));
  vec3 blue = pow(vec3(0.65, 0.76, 0.81), vec3(2.2));
  vec3 mid = pow(vec3(0.84, 0.89, 0.89), vec3(2.2));
  vec3 col = tone3(paper, mid, blue, 0.46 + 0.54 * light);
  col = mix(col, blue * mix(uShadeTint, uSunTint, light),
            relief * 0.13 + scallop * 0.14);
  // Visible only at walking distance. Broad areas remain reserved paper white.
  float grain = snowWash(p * 18.0 + 23.1);
  float resolved = 1.0 - smoothstep(0.012, 0.050, footprint);
  float dry = smoothstep(0.59, 0.84, grain) * resolved;
  float white = (1.0 - smoothstep(0.12, 0.29, grain)) * resolved;
  col = mix(col, blue, dry * 0.32);
  return mix(col, paper * uSunTint, white * 0.16);
}
