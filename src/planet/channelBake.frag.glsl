// Bakes the channel distance field into one cube-map face. Each texel's
// direction follows the GL cube-map convention, so textureCube(field, dir)
// reads back exactly what was written for dir.
uniform int uFace;
uniform float uSize;
uniform sampler2D uSegments; // texel 2k: a.xyz, level; texel 2k+1: b.xyz
uniform int uSegmentCount;

float chordAngle(vec3 a, vec3 b) {
  return 2.0 * asin(clamp(0.5 * length(a - b), 0.0, 1.0));
}

float arcDistance(vec3 p, vec3 a, vec3 b) {
  vec3 n = normalize(cross(a, b));
  float s = dot(p, n);
  vec3 q = p - s * n;
  bool inside = dot(cross(a, q), n) >= 0.0 && dot(cross(q, b), n) >= 0.0;
  return inside ? asin(min(1.0, abs(s))) : min(chordAngle(p, a), chordAngle(p, b));
}

vec3 faceDirection(int face, vec2 st) {
  if (face == 0) return vec3(1.0, -st.y, -st.x);
  if (face == 1) return vec3(-1.0, -st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, st.y);
  if (face == 3) return vec3(st.x, -1.0, -st.y);
  if (face == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 p = normalize(faceDirection(uFace, st));
  vec4 d = vec4(0.25);
  for (int k = 0; k < 512; k++) {
    if (k >= uSegmentCount) break;
    vec4 a = texelFetch(uSegments, ivec2(2 * k, 0), 0);
    vec4 b = texelFetch(uSegments, ivec2(2 * k + 1, 0), 0);
    float dist = arcDistance(p, a.xyz, b.xyz);
    int level = int(a.w + 0.5);
    if (level == 0) d.x = min(d.x, dist);
    else if (level == 1) d.y = min(d.y, dist);
    else if (level == 2) d.z = min(d.z, dist);
    else d.w = min(d.w, dist);
  }
  gl_FragColor = d;
}
