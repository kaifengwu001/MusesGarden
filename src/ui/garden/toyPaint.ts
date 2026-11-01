import { DoubleSide, ShaderMaterial, Vector3, type Side } from 'three';

// The paint on the garden's toys (the post box, the basket): each a real
// model in a small canvas of its own, lit like a toy on a sunny sill.

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Painted toy light: a warm key from the upper left in front, two soft bands, a cool shade with the
// sky in it, a warm rim, a faint brushed grain, and darker inside faces (the box's dark mouth).
const fragmentShader = /* glsl */ `
uniform vec3 uColour;
uniform vec3 uShade;
uniform vec3 uInside;
uniform float uGrain;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(cameraPosition - vWorld);
  float key = dot(n, normalize(vec3(-0.55, 0.8, 0.55)));
  float lit = smoothstep(-0.2, 0.05, key) * 0.55 + smoothstep(0.35, 0.55, key) * 0.45;
  vec3 col = mix(uShade * vec3(0.93, 0.98, 1.08), uColour * vec3(1.03, 1.0, 0.94), lit);
  // sky light from above into the shade, the ground's warmth from below
  col += (n.y > 0.0 ? vec3(0.03, 0.05, 0.08) * n.y : vec3(0.05, 0.035, 0.0) * -n.y) * (1.0 - lit);
  col += vec3(1.0, 0.92, 0.78) * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.22 * lit;
  float g = hash(floor(vWorld * 140.0)) - 0.5;
  col *= 1.0 + uGrain * g;
  if (!gl_FrontFacing) col = uInside * (0.65 + 0.35 * smoothstep(-0.3, 0.3, vLocal.z));
  gl_FragColor = vec4(col, 1.0);
}`;

function linear(hex: number): Vector3 {
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((x) => Math.pow(x / 255, 2.2));
  return new Vector3(r, g, b);
}

/** A toy's paint: its colour in the light and in shade (sRGB hex), its grain, the colour of its inside faces. */
export function paint(colour: number, shade: number, grain = 0.05, inside = 0x2f3946, side: Side = DoubleSide): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uColour: { value: linear(colour) }, uShade: { value: linear(shade) }, uInside: { value: linear(inside) }, uGrain: { value: grain } },
    side,
  });
}
