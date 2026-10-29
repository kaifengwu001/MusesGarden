// GPU mirror of cubesphere.ts: face frames and the spherified cube.

vec3 faceNormal(int f) {
  if (f == 0) return vec3(1.0, 0.0, 0.0);
  if (f == 1) return vec3(-1.0, 0.0, 0.0);
  if (f == 2) return vec3(0.0, 1.0, 0.0);
  if (f == 3) return vec3(0.0, -1.0, 0.0);
  if (f == 4) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 0.0, -1.0);
}

vec3 faceU(int f) {
  if (f == 0) return vec3(0.0, 0.0, -1.0);
  if (f == 1) return vec3(0.0, 0.0, 1.0);
  if (f == 5) return vec3(-1.0, 0.0, 0.0);
  return vec3(1.0, 0.0, 0.0);
}

vec3 faceV(int f) {
  if (f == 2) return vec3(0.0, 0.0, -1.0);
  if (f == 3) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 1.0, 0.0);
}

vec3 cubeToSphere(vec3 c) {
  vec3 c2 = c * c;
  return normalize(c * sqrt(max(vec3(0.0), 1.0 - 0.5 * c2.yzx - 0.5 * c2.zxy + c2.yzx * c2.zxy / 3.0)));
}

// Face uv ∈ [0,1]² → unit direction.
vec3 uvToSphere(int f, vec2 uv) {
  vec2 ab = uv * 2.0 - 1.0;
  return cubeToSphere(faceNormal(f) + ab.x * faceU(f) + ab.y * faceV(f));
}
