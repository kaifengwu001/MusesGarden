// Looking at Muse's shelf in the cutaway (view/cutaway.ts): whatever stands
// between the camera and the shelf (over it on screen and nearer the camera)
// is dissolved through a 4×4 screen door, so the shelf is seen whole. Off
// (strength 0) the rest of the time.
uniform vec4 uOcclude;      // the shelf on screen: x0, y0, x1, y1 (0..1 of the view, y up)
uniform vec2 uOccludeDepth; // how far the shelf stands from the camera (m), how strongly what is in front of it goes
uniform vec2 uResolution;   // the view drawn (px)

// How far a point (warped world) is to be dissolved, 0..1.
float occluded(vec3 world) {
  if (uOccludeDepth.y <= 0.0) return 0.0;
  vec2 q = gl_FragCoord.xy / uResolution;
  vec2 lo = smoothstep(uOcclude.xy - 0.04, uOcclude.xy + 0.01, q);
  vec2 hi = 1.0 - smoothstep(uOcclude.zw - 0.01, uOcclude.zw + 0.04, q);
  float nearer = smoothstep(0.4, 1.2, uOccludeDepth.x - distance(world, cameraPosition));
  return uOccludeDepth.y * lo.x * lo.y * hi.x * hi.y * nearer;
}

// Whether this pixel is let through the screen door at an amount (0 keeps every pixel, 1 none).
bool screenDoor(float amount) {
  ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
  int i = p.x + p.y * 4;
  float b = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0)[i];
  return amount > (b + 0.5) / 16.0;
}
