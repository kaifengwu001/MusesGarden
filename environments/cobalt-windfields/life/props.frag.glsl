#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <cobalt_mineral>
uniform float uRadius;
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width,float footprint){float w=max(footprint,0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
void main(){
 vec3 localDx=dFdx(vLocal),localDy=dFdy(vLocal);
 float localFoot=max(length(localDx),length(localDy));
 vec2 uvFoot=abs(dFdx(vUv))+abs(dFdy(vUv));
 vec3 faceNormal=normalize(cross(localDx,localDy));
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 float relief=cobaltRelief(vLocal,localFoot);
 vec3 stoneNormal=cobaltBumpNormal(n,dFdx(vPlanet),dFdy(vPlanet),vec2(dFdx(relief),dFdy(relief)));
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float light=toonLight(dot(n,sun))*(1.0-cloudShadowAt(vPlanet,0.0)*0.2);
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  base=linearColor(vec3(0.57,0.43,0.32));
  mark=inkLine(sin(vUv.x*67.0+sin(vUv.y*2.0)*0.8),0.045,uvFoot.x*67.0+uvFoot.y*1.6)*0.16;
 }else if(vKind<1.5||vKind>10.5&&vKind<11.5){
  base=linearColor(vec3(0.97,0.91,0.73));
  mark=inkLine(vUv.x,0.012,uvFoot.x)*0.22;
  mark+=inkLine(fract(vUv.y*5.0+abs(vUv.x)*0.9)-0.5,0.008,uvFoot.y*5.0+uvFoot.x*.9)*0.13;
  light=max(light,0.48);
 }else if(vKind<2.5){
  base=pal(ROW_ROCK,0);
 }else if(vKind<3.5){
  base=linearColor(vec3(0.88,0.34,0.27));
  mark=inkLine(sin(vUv.x*24.0+vUv.y*1.3),0.08,uvFoot.x*24.0+uvFoot.y*1.3)*0.1;
 }else if(vKind<4.5){
  base=linearColor(vec3(0.68,0.33,0.27));
  mark=inkLine(fract(vUv.x/1.45)-0.5,0.004,uvFoot.x/1.45)*0.18;
  float weave=sin(vUv.x*180.0)*sin(vUv.y*180.0);
  base*=1.0+0.018*weave*(1.0-smoothstep(0.004,0.02,max(uvFoot.x,uvFoot.y)));
 }else if(vKind<5.5){
  base=pal(ROW_ROCK,0);
  mark=0.0;
 }else if(vKind<6.5){base=linearColor(vec3(0.20,0.23,0.28));
 }else if(vKind<7.5){base=linearColor(vec3(0.98,0.76,0.4));light=max(light,0.85);
 }else if(vKind<8.5){base=linearColor(vec3(0.92,0.78,0.6));
 }else if(vKind<9.5){base=linearColor(vec3(0.13,0.16,0.22));
 }else if(vKind<10.5){base=linearColor(vec3(0.28,0.47,0.7));
 }else {base=linearColor(vec3(0.92,0.57,0.42));light=max(light,0.45);}
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.015,0.085,abs(dot(warpNormal(vPlanet,n),view))))*0.13;
 vec3 col=tone3(base*1.06,base*0.92,base*vec3(0.61,0.67,0.76),light);
 if(vKind>1.5&&vKind<2.5||vKind>4.5&&vKind<5.5)col=cobaltMineral(vLocal,faceNormal,vVariation,localFoot,dot(stoneNormal,sun),cloudShadowAt(vPlanet,0.0));
 col=mix(col,linearColor(vec3(0.13,0.18,0.25)),min(mark+silhouette,0.78));
 float viewDistance=distance(cameraPosition,vWorld);
 vec3 aerial=applyAerial(col,viewDistance,dir);
 col=mix(col,aerial,1.0);
 gl_FragColor=vec4(col,1.0);
}
