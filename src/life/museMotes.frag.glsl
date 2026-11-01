// Little things that float about Muse (museMotes.vert.glsl): a picture from
// the sheet (MOTES of them in a row), as opaque as asked.
uniform sampler2D uMotes;
uniform float uMoteCount;

varying vec2 vUv;
varying float vPicture;
varying float vAlpha;

void main() {
  vec4 t = texture2D(uMotes, vec2((vUv.x + floor(vPicture + 0.5)) / uMoteCount, vUv.y));
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb, a);
  #include <colorspace_fragment>
}
