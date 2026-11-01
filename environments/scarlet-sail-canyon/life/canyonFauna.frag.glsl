#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_clouds>
varying vec3 vPlanet;
varying vec3 vWorld;
varying vec3 vPlanetNormal;
varying vec3 vColour;
varying float vKind;
varying vec2 vUv;
float line(float x,float width){return 1.0-smoothstep(width,width+max(fwidth(x),0.001),abs(x));}
void main(){
 float distanceToEye=distance(cameraPosition,vWorld);
 float presence=1.0-smoothstep(58.0,88.0,distanceToEye);
 float screenDoor=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(0.06711056,0.00583715))));
 if(screenDoor>presence)discard;
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float shade=cloudShadowAt(vPlanet,0.0)*0.38;
 float light=toonLight(dot(n,sun))*(1.0-shade);
 vec3 base=vColour;
 float marks=0.0;
 if(vKind>0.5&&vKind<1.5){
   marks=line(vUv.x-0.5,0.009)*0.2+line(vUv.y-0.93,0.008)*0.16;
   marks+=line(fract(vUv.y*6.0+abs(vUv.x-0.5)*2.0)-0.5,0.01)*0.065*smoothstep(0.12,0.3,vUv.y);
 }else if(vKind>1.5&&vKind<2.5){
   marks=line(fract(vUv.x*12.0+0.5)-0.5,0.008)*smoothstep(0.1,0.35,vUv.y)*0.21;
   base=mix(base,vec3(0.81,0.71,0.65),smoothstep(0.88,0.99,vUv.y)*0.72);
   light=max(light,0.35+0.18*max(dot(-n,sun),0.0));
 }else if(vKind>4.5&&vKind<5.5){
   marks=line(vUv.x-0.5,0.009)*0.15;
   marks+=line(fract(vUv.y*7.0+abs(vUv.x-0.5)*3.0)-0.5,0.012)*0.055;
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float edge=1.0-smoothstep(0.025,0.17,abs(dot(warpNormal(vPlanet,n),view)));
 base*=1.0-marks-edge*0.14;
 vec3 col=tone3(base*1.05,base*0.94,base*vec3(0.57,0.63,0.76),light);
 if(vKind>3.5&&vKind<4.5)col=base*(0.85+0.15*light);
 gl_FragColor=vec4(applyAerial(col,distanceToEye,dir),1.0);
}
