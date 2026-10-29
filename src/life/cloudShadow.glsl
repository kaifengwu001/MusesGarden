// Soft blob shadows of the drifting clouds on the ground (clouds.ts writes
// the blobs: centre direction under the cloud, angular radius).
#define MAX_CLOUD_SHADOWS 8
uniform vec4 uCloudShadows[MAX_CLOUD_SHADOWS];
uniform float uCloudShadowStrength;

float cloudShadow(vec3 dir) {
  float s = 0.0;
  for (int i = 0; i < MAX_CLOUD_SHADOWS; i++) {
    vec4 c = uCloudShadows[i];
    if (c.w <= 0.0) continue;
    float d = chordAngle(dir, c.xyz) / c.w;
    s = max(s, 1.0 - smoothstep(0.55, 1.0, d));
  }
  return s * uCloudShadowStrength;
}
