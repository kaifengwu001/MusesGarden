// The veil's fog (veilFog.ts) on a fullscreen triangle: the view ray through
// each pixel.
varying vec3 vRay;

void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vRay = transpose(mat3(viewMatrix)) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
