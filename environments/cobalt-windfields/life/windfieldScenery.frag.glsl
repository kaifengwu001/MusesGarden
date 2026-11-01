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
varying vec3 vLocalNormal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width,float footprint){
 float aa=max(footprint*0.7,0.00015);
 return 1.0-smoothstep(width,width+aa,abs(value));
}
void main(){
 vec3 localDx=dFdx(vLocal),localDy=dFdy(vLocal);
 float localFoot=max(length(localDx),length(localDy));
 vec2 uvFoot=abs(dFdx(vUv))+abs(dFdy(vUv));
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 float relief=cobaltRelief(vLocal,localFoot);
 vec3 stoneNormal=cobaltBumpNormal(n,dFdx(vPlanet),dFdy(vPlanet),vec2(dFdx(relief),dFdy(relief)));
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float light=toonLight(dot(n,sun))*(1.0-cloudShadowAt(vPlanet,0.0)*0.2);
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  base=linearColor(vec3(0.54,0.40,0.29));
  mark=inkLine(sin(vUv.x*45.0+sin(vUv.y*1.3)*0.65),0.025,uvFoot.x*45.0+uvFoot.y)*0.2;
 }else if(vKind<1.5){
  base=linearColor(vec3(0.985,0.965,0.89));
  // A midrib with fine, oblique secondary veins; the membrane remains quiet.
  mark=inkLine(vUv.x,0.005,uvFoot.x)*0.34;
  mark+=inkLine(1.0-abs(vUv.x),0.0035,uvFoot.x)*0.56;
  float veins=fract(vUv.y*4.0+abs(vUv.x)*1.6)-0.5;
  mark+=inkLine(veins,0.002,uvFoot.y*4.0+uvFoot.x*1.6)*0.09*smoothstep(0.05,0.25,abs(vUv.x));
  light=0.68+0.32*abs(dot(n,sun));
 }else if(vKind<2.5){
  base=pal(ROW_ROCK,0);
 }else if(vKind<3.5){
  base=mix(linearColor(vec3(0.80,0.27,0.23)),linearColor(vec3(0.92,0.40,0.31)),vVariation);
  light=0.42+0.58*max(dot(n,sun),0.0);
  mark=0.0;
 }else if(vKind<4.5){
  base=linearColor(vec3(0.65,0.32,0.27));
  mark=inkLine(fract(vUv.x/1.8)-0.5,0.004,uvFoot.x/1.8)*0.16;
  float footprint=max(uvFoot.x,uvFoot.y);
  base*=1.0+0.012*sin(vUv.x*150.0)*sin(vUv.y*150.0)*(1.0-smoothstep(0.004,0.012,footprint));
 }else if(vKind<5.5){
  base=linearColor(vec3(0.28,0.39,0.53));
  float row=floor(vUv.y/0.45);
  float joints=max(inkLine(fract(vUv.y/0.45)-0.5,0.014,uvFoot.y/0.45),inkLine(fract(vUv.x/0.8+mod(row,2.0)*0.5)-0.5,0.014,uvFoot.x/0.8));
  mark=joints*0.55;
 }else if(vKind<6.5){base=linearColor(vec3(0.19,0.22,0.25));
 }else if(vKind>12.5){
  base=mix(pal(ROW_BRUSH,0),pal(ROW_BRUSH,1),vVariation*0.35);
  float detail=1.0-smoothstep(0.015,0.06,localFoot);
  base*=1.0+gnoise(vLocal*24.0,711u)*0.04*detail;
 }else{base=linearColor(vec3(0.94,0.74,0.4));light=max(light,0.8);}
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.015,0.065,abs(dot(warpNormal(vPlanet,n),view))))*0.35;
 vec3 col=tone3(base,base*0.91,base*vec3(0.66,0.72,0.82),light);
 if(vKind>1.5&&vKind<2.5)col=cobaltMineral(vLocal,vLocalNormal,vVariation,localFoot,dot(stoneNormal,sun),cloudShadowAt(vPlanet,0.0));
 vec3 ink=linearColor(vec3(0.12,0.17,0.23));
 col=mix(col,ink,min(mark+silhouette,0.82));

 float viewDistance=distance(cameraPosition,vWorld);
 // Preserve the ink/value separation in the foreground; pale blue distance
 // enters gradually, as in the environment's painted perspective.
 vec3 aerial=applyAerial(col,viewDistance,dir);
 col=mix(col,aerial,1.0);
 gl_FragColor=vec4(col,1.0);
}
