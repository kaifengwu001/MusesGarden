// Highlight bloom passes. uMode 0: bright pass (soft knee), 1: downsample
// (13-tap), 2: upsample (tent) added onto the larger level.
uniform sampler2D tSource;
uniform vec2 uTexel; // 1 / source size
uniform int uMode;
uniform float uThreshold;

varying vec2 vUv;

vec3 tap(vec2 o) {
  return texture2D(tSource, vUv + o * uTexel).rgb;
}

void main() {
  if (uMode == 0) {
    vec3 c = (tap(vec2(-0.5)) + tap(vec2(0.5, -0.5)) + tap(vec2(-0.5, 0.5)) + tap(vec2(0.5))) * 0.25;
    float l = max(max(c.r, c.g), c.b);
    float knee = 0.25;
    float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float w = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  } else if (uMode == 1) {
    vec3 a = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
    vec3 b = tap(vec2(-2.0, 0.0)) + tap(vec2(2.0, 0.0)) + tap(vec2(0.0, -2.0)) + tap(vec2(0.0, 2.0));
    vec3 c = tap(vec2(-2.0, -2.0)) + tap(vec2(2.0, -2.0)) + tap(vec2(-2.0, 2.0)) + tap(vec2(2.0, 2.0));
    gl_FragColor = vec4(tap(vec2(0.0)) * 0.125 + a * 0.125 + b * 0.0625 + c * 0.03125, 1.0);
  } else {
    vec3 s = tap(vec2(0.0)) * 4.0;
    s += (tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0)) + tap(vec2(0.0, -1.0)) + tap(vec2(0.0, 1.0))) * 2.0;
    s += tap(vec2(-1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0));
    gl_FragColor = vec4(s / 16.0, 1.0);
  }
}
