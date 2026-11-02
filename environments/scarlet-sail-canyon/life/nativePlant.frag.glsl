// Native decorative beds retain the same plant anatomy and leaf marks as the
// cliff flora. Centroid interpolation prevents edge-on MSAA colour overshoot.
centroid varying vec3 vColour;
centroid varying vec2 vNativeUv;
varying float vNativeSpecies;

float nativeLine(float distance,float width,float footprint){
  return (1.0-smoothstep(width,width+max(footprint,0.0001),abs(distance)))
    *min(1.0,width/max(footprint,0.0001)*2.0);
}

void main(){
  vec2 pixel=max(fwidth(vNativeUv),vec2(0.0001));
  vec2 uv=clamp(vNativeUv,0.0,1.0);
  float close=1.0-smoothstep(0.05,0.24,max(pixel.x,pixel.y));
  float midrib=nativeLine(uv.x-0.5,0.008,pixel.x);
  float ribs=fract(uv.y*5.5-abs(uv.x-0.5)*2.6)-0.5;
  float branch=nativeLine(ribs,0.012,pixel.y*5.5+pixel.x*2.6)*close;
  float sage=1.0-step(0.1,abs(vNativeSpecies-2.0));
  float margin=smoothstep(0.36,0.49,abs(uv.x-0.5))*sage*close;
  vec3 colour=vColour*(1.0-midrib*0.20-branch*0.10);
  colour=mix(colour,colour*vec3(1.08,1.05,0.97),margin*0.30);
  gl_FragColor=vec4(colour,1.0);
}
