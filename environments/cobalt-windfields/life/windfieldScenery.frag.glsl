#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
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
float inkLine(float value,float width){
 float aa=max(fwidth(value)*0.7,0.00015);
 return 1.0-smoothstep(width,width+aa,abs(value));
}
float fractureSegment(vec2 p,vec2 a,vec2 b){
 vec2 edge=b-a;
 return length(p-a-edge*clamp(dot(p-a,edge)/max(dot(edge,edge),0.0001),0.0,1.0));
}
// Finite branching faults leave large quiet stone planes between them.
// Their lengths and offsets vary; there is no closed tiled crack network.
float mineralJoint(vec2 p){
 vec2 size=vec2(2.3,4.1);
 vec2 q=p/size+vec2(vVariation*9.7,vVariation*6.3);
 vec2 cell=floor(q),local=fract(q)*size;
 float r=hash12(cell+17.3),r2=hash12(cell+vec2(9.1,31.6));
 vec2 a=vec2(0.28+0.50*r,0.08+0.34*r2);
 vec2 b=vec2(0.48+0.34*r2,0.75+0.16*r);
 vec2 c=vec2(0.39+0.50*r,1.38+0.25*r2);
 vec2 d=vec2(0.65+0.38*r2,1.93+0.30*r);
 float crack=fractureSegment(local,a,b);
 crack=min(crack,fractureSegment(local,b,c));
 if(r>0.28)crack=min(crack,fractureSegment(local,c,d));
 if(r2>0.35){
  vec2 fork=b+vec2(r>0.5?0.4:-0.35,0.15+0.3*r);
  crack=min(crack,fractureSegment(local,b,fork));
  crack=min(crack,fractureSegment(local,fork,fork+vec2(r>0.5?0.16:-0.18,0.36)));
 }
 return crack;
}
void main(){
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float light=toonLight(dot(n,sun))*(1.0-cloudShadowAt(vPlanet,0.0)*0.2);
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  base=linearColor(vec3(0.54,0.40,0.29));
  mark=inkLine(sin(vUv.x*45.0+sin(vUv.y*1.3)*0.65),0.025)*0.2;
 }else if(vKind<1.5){
  base=linearColor(vec3(0.985,0.965,0.89));
  // A midrib with fine, oblique secondary veins; the membrane remains quiet.
  mark=inkLine(vUv.x,0.005)*0.34;
  mark+=inkLine(1.0-abs(vUv.x),0.0035)*0.56;
  float veins=fract(vUv.y*4.0+abs(vUv.x)*1.6)-0.5;
  mark+=inkLine(veins,0.002)*0.09*smoothstep(0.05,0.25,abs(vUv.x));
  light=max(light,0.92);
 }else if(vKind<2.5){
  base=mix(pal(ROW_ROCK,0),pal(ROW_ROCK,3),vVariation*0.65);
  vec3 face=abs(normalize(vLocalNormal));
  vec2 plane=face.y>max(face.x,face.z)?vLocal.xz:(face.x>face.z?vLocal.zy:vLocal.xy);
  float joint=mineralJoint(plane);
  float footprint=max(length(dFdx(vLocal)),length(dFdy(vLocal)));
  float detail=1.0-smoothstep(0.13,0.42,footprint);
  float width=0.008+0.004*hash12(floor(plane*0.65)+vVariation);
  mark=inkLine(joint,width)*0.64*detail;
  float wash=0.5+0.5*gnoise(vLocal*0.4+vec3(vVariation*5.0),710u);
  base=mix(base,pal(ROW_ROCK,2),wash*0.12);
  base*=1.0+gnoise(vLocal*13.0,712u)*0.018*detail;
 }else if(vKind<3.5){
  base=mix(linearColor(vec3(0.80,0.27,0.23)),linearColor(vec3(0.92,0.40,0.31)),vVariation);
  light=0.78+0.22*max(dot(n,sun),0.0);
  mark=0.0;
 }else if(vKind<4.5){
  base=linearColor(vec3(0.65,0.32,0.27));
  mark=inkLine(fract(vUv.x/1.8)-0.5,0.004)*0.16;
  float footprint=max(fwidth(vUv.x),fwidth(vUv.y));
  base*=1.0+0.012*sin(vUv.x*150.0)*sin(vUv.y*150.0)*(1.0-smoothstep(0.004,0.012,footprint));
 }else if(vKind<5.5){
  base=linearColor(vec3(0.28,0.39,0.53));
  float row=floor(vUv.y/0.45);
  float joints=max(inkLine(fract(vUv.y/0.45)-0.5,0.014),inkLine(fract(vUv.x/0.8+mod(row,2.0)*0.5)-0.5,0.014));
  mark=joints*0.55;
 }else if(vKind<6.5){base=linearColor(vec3(0.19,0.22,0.25));
 }else if(vKind>12.5){
  base=mix(pal(ROW_BRUSH,0),pal(ROW_BRUSH,1),vVariation*0.35);
  float detail=1.0-smoothstep(0.015,0.06,max(length(dFdx(vLocal)),length(dFdy(vLocal))));
  base*=1.0+gnoise(vLocal*24.0,711u)*0.04*detail;
 }else{base=linearColor(vec3(0.94,0.74,0.4));light=max(light,0.8);}
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.015,0.065,abs(dot(warpNormal(vPlanet,n),view))))*0.35;
 vec3 col=tone3(base,base*0.91,base*vec3(0.66,0.72,0.82),light);
 vec3 ink=linearColor(vec3(0.12,0.17,0.23));
 col=mix(col,ink,min(mark+silhouette,0.82));

 float viewDistance=distance(cameraPosition,vWorld);
 // Preserve the ink/value separation in the foreground; pale blue distance
 // enters gradually, as in the environment's painted perspective.
 vec3 aerial=applyAerial(col,viewDistance,dir);
 col=mix(col,aerial,1.0);
 gl_FragColor=vec4(col,1.0);
}
