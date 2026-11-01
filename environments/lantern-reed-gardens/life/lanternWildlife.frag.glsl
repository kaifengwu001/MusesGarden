#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vNormal;
varying vec2 vUv;
varying float vKind;
varying float vPhase;
vec3 pigment(vec3 c){return pow(c,vec3(2.2));}
float ink(float d,float width){return 1.0-smoothstep(width,width+max(fwidth(d),0.001),abs(d));}
void main(){
 vec3 N=normalize(vNormal);if(!gl_FrontFacing)N=-N;
 vec3 dir=normalize(vPlanet),sun=localSun(dir),base;
 float light=toonLight(dot(N,sun))*(1.0-cloudShadowAt(vPlanet,0.0)*0.2),mark=0.0;
 if(vKind<0.5){base=pigment(vec3(0.89,0.85,0.91));}
 else if(vKind<1.5){
   base=mix(pigment(vec3(0.66,0.63,0.78)),pigment(vec3(0.82,0.77,0.88)),fract(vKind*3.7+vPhase)*0.65);
   float edge=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));
   float seam=1.0-smoothstep(0.018,0.018+max(fwidth(edge),0.002),edge);
   base=mix(base,pigment(vec3(0.94,0.9,0.85)),seam*0.7);
 }
 else if(vKind<2.5){
   base=mix(pigment(vec3(0.61,0.78,0.69)),pigment(vec3(0.87,0.91,0.77)),abs(vUv.x-0.5)*1.3);
   mark=ink(vUv.x-0.5,0.008)*0.3+ink(fract(vUv.y*6.0+abs(vUv.x-0.5)*1.4)-0.5,0.016)*0.15;
   // Thin leaf membranes transmit the common sun softly through their reverse.
   light=max(light,0.48+0.25*max(dot(-N,sun),0.0));
 }
 else if(vKind<3.5){base=pigment(vec3(0.12,0.14,0.17));light=max(light,0.6);}
 else if(vKind<4.5){base=pigment(vec3(1.0,0.97,0.85));light=1.0;}
 else if(vKind<5.5){base=pigment(vec3(0.44,0.57,0.55));}
 else if(vKind<6.5){
   base=mix(pigment(vec3(0.56,0.69,0.63)),pigment(vec3(0.81,0.84,0.68)),fract(vKind*3.1+vPhase)*0.65);
   mark=ink(vUv.x-0.5,0.006)*0.2+ink(fract(vUv.y*5.0+abs(vUv.x-0.5)*1.8)-0.5,0.012)*0.1;
   mark+=(1.0-smoothstep(0.014,0.014+max(fwidth(vUv.x),0.002),min(vUv.x,1.0-vUv.x)))*0.16;
 }
 else if(vKind<7.5||vKind>8.5&&vKind<9.5){base=pigment(vec3(0.93,0.89,0.72));mark=vKind>8.5?ink(vUv.x-0.5,0.008)*0.12:0.0;}
 else if(vKind<8.5){base=pigment(vec3(0.52,0.51,0.62));mark=ink(vUv.x-0.5,0.018)*0.2;}
 else{base=pigment(vec3(0.25,0.25,0.28));}
 vec3 view=normalize(cameraPosition-vWorld);
 float contour=1.0-smoothstep(0.035,0.11,abs(dot(N,view)));
 base*=1.0-min(mark+contour*0.2,0.5);
 vec3 col=tone3(base*1.03,base*0.95,base*vec3(0.68,0.72,0.83),light);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
