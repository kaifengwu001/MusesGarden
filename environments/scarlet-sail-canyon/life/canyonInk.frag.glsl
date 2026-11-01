uniform vec3 uInkColor;
uniform float uInkOpacity;
varying vec2 vFacing;
varying float vRule;
varying float vDistance;
varying float vKind;
varying float vPresence;

void main() {
  if(vRule<0.5&&vFacing.x*vFacing.y>0.0) discard;
  // Fine understory edges disappear first; large chalk and fan silhouettes
  // remain legible farther away but never stipple the whole orbital view.
  bool fine=(vKind>2.5&&vKind<3.5)||vKind>7.5;
  float fade=1.0-smoothstep(fine?45.0:95.0,fine?90.0:210.0,vDistance);
  float alpha=uInkOpacity*fade*vPresence;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(uInkColor,alpha);
}
