#include <meadow_common>
uniform float uRadius;
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying float vKind;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
void main(){
  vec3 n=normalize(vPlanetNormal),dir=normalize(vPlanet);
  if(!gl_FrontFacing)n=-n;
  float light=toonLight(dot(n,localSun(dir)));
  vec3 footprint=fwidth(vLocal);
  float fine=1.0-smoothstep(0.025,0.12,max(footprint.x,max(footprint.y,footprint.z)));
  float worn=gnoise(vLocal*1.6,867u),grain=gnoise(vLocal*vec3(0.8,21.0,21.0),883u);
  vec3 base;
  if(vKind<0.5){
    base=mix(linearColor(vec3(0.44,0.34,0.23)),linearColor(vec3(0.59,0.46,0.30)),0.5+0.24*worn);
    float seam=abs(fract(vLocal.y*3.5)-0.5);
    base*=1.0-(1.0-smoothstep(0.016,0.03+footprint.y*3.5,seam))*0.22*fine;
    base*=1.0+0.08*grain*fine;
  }else if(vKind<1.5){
    base=linearColor(vec3(0.26,0.28,0.22))*(1.0+0.1*grain*fine);
  }else if(vKind<2.5){
    base=mix(linearColor(vec3(0.18,0.27,0.25)),linearColor(vec3(0.30,0.37,0.28)),0.5+0.23*worn);
    float seam=abs(fract(vLocal.z*3.8)-0.5);
    base*=1.0-(1.0-smoothstep(0.02,0.04+footprint.z*3.8,seam))*0.2*fine;
  }else if(vKind<3.5){
    base=mix(linearColor(vec3(0.35,0.42,0.38)),linearColor(vec3(0.49,0.54,0.45)),0.5+0.3*worn);
  }else if(vKind<4.5){
    base=linearColor(vec3(0.91,0.74,0.43));light=max(light,0.82);
  }else if(vKind<5.5){
    base=linearColor(vec3(0.23,0.26,0.24));
  }else{base=linearColor(vec3(0.30,0.45,0.29));}
  light*=1.0-cloudShadowAt(vPlanet,0.0)*0.3;
  vec3 col=tone3(base,base*0.86,base*vec3(0.55,0.68,0.66),light);
  gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
