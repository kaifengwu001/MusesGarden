// Sky on a fullscreen triangle. Passes the world-space view ray (for the dome
// seen from the meadow) and the clip-space position (for the backdrop behind
// the planet in Overview).
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;

varying vec3 vRay;
varying vec2 vScreen;

void main() {
  vScreen = position.xy;
  vec4 view = uInvProjection * vec4(position.xy, 1.0, 1.0);
  vRay = mat3(uCameraWorld) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
