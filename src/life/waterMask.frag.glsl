// Where the screen can show water (waterMask.ts), a cell of MASK_CELL²
// pixels at a time: four of the camera's rays through the cell are followed
// down to the water table (the sphere of radius R, as the warp bends it into
// view) and the ground is looked up where they meet it, the homestead's pond
// with it. The water lies flat on the table, so a pixel of water is always
// where its ray first meets the table; a bank or a hill in front of a lake
// only marks cells that did not need it.
uniform float uRadius;
#include <meadow_warp>
#include <meadow_terrain>

uniform mat4 uRayFrame; // the camera's world matrix × its inverse projection: a pixel's ray
uniform vec3 uEye;      // the camera (view space)
uniform vec2 uView;     // the pixels drawn this frame
uniform float uReach;   // how far a ray is followed (m)

// as wet: ground this little above the table (the water's own edge is a pixel's worth inside it)
const float WET_MARGIN = 0.25;
const int STEPS = 32;

bool wetAlong(vec2 px) {
  vec4 far = uRayFrame * vec4(px / uView * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(far.xyz / far.w - uEye);
  // the first place the ray is under the table: steps growing away from the camera, then halved
  float a = 0.0;
  float b = 0.25;
  float grow = pow(uReach / b, 1.0 / float(STEPS));
  bool under = false;
  for (int i = 0; i < STEPS; i++) {
    if (length(unwarpPosition(uEye + d * b)) < uRadius) {
      under = true;
      break;
    }
    a = b;
    b *= grow;
  }
  if (!under) return false;
  for (int k = 0; k < 8; k++) {
    float m = 0.5 * (a + b);
    if (length(unwarpPosition(uEye + d * m)) < uRadius) b = m;
    else a = m;
  }
  return height0(normalize(unwarpPosition(uEye + d * b))) < WET_MARGIN;
}

void main() {
  vec2 corner = floor(gl_FragCoord.xy) * float(MASK_CELL);
  float q = 0.25 * float(MASK_CELL);
  bool wet = wetAlong(corner + vec2(q, q)) || wetAlong(corner + vec2(3.0 * q, q)) || wetAlong(corner + vec2(q, 3.0 * q)) || wetAlong(corner + vec2(3.0 * q, 3.0 * q));
  gl_FragColor = vec4(wet ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
