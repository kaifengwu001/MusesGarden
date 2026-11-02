varying vec2 vOff;
void main(){
  float a=atan(vOff.y,vOff.x);
  float edge=0.78+0.1*sin(a*5.0)+0.06*sin(a*9.0);
  float shade=(1.0-smoothstep(edge-0.13,edge+0.1,length(vOff)))*0.27;
  gl_FragColor=vec4(shade,0.0,0.0,1.0);
}
