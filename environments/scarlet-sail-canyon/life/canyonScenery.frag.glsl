#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
uniform vec4 uCottage;
uniform vec4 uBloom;
uniform vec4 uUserBloom[8];
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
varying float vPresence;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width){float w=max(fwidth(value),0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
float nativeAngle(vec3 a,vec3 b){return 2.0*asin(min(length(a-b)*0.5,1.0));}
float nativeBloom(vec3 dir){
 float bloom=smoothstep(uBloom.x+uBloom.y,uBloom.x-uBloom.y,nativeAngle(dir,uCottage.xyz));
 for(int i=0;i<8;i++){
  vec4 disc=uUserBloom[i];
  if(disc.w>0.0)bloom=max(bloom,smoothstep(disc.w,disc.w*0.7,nativeAngle(dir,disc.xyz)));
 }
 return bloom;
}
vec2 jointHash(vec2 p){
 vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
 q+=dot(q,q.yzx+33.33);
 return fract((q.xx+q.yz)*q.zy);
}
float chalkSegment(vec2 p,vec2 a,vec2 b){
 vec2 edge=b-a;
 return length(p-a-edge*clamp(dot(p-a,edge)/max(dot(edge,edge),0.00001),0.0,1.0));
}
float chalkStroke(float distance,float width,float aa){
 return 1.0-smoothstep(width,width+aa,distance);
}
vec2 chalkJoint(float column,float level,float variant){
 vec2 r=jointHash(vec2(column+variant*29.0,level+variant*11.0));
 // Neighbouring segments share these exact endpoints: long fractures stay
 // connected while their angular turns have irregular lengths and offsets.
 return vec2(column+0.5+(r.x-0.5)*0.2,level+0.2+r.y*0.6);
}
float chalkFractures(vec2 p,float variant,float aa){
 float ink=0.0;
 vec2 cell=floor(p);
 float neighbour=fract(p.x)<0.5?-1.0:1.0;
 for(int cx=0;cx<2;cx++){
  float column=cell.x+float(cx)*neighbour;
  vec2 family=jointHash(vec2(column+3.7,variant*17.0));
  if(family.x<0.18)continue;
  float width=mix(0.0025,0.0045,family.y);
  for(int cy=-1;cy<=0;cy++){
   float level=cell.y+float(cy);
   vec2 a=chalkJoint(column,level,variant),b=chalkJoint(column,level+1.0,variant);
   vec2 r=jointHash(vec2(column+variant*19.0,level+31.0));
   ink=max(ink,chalkStroke(chalkSegment(p,a,b),width,aa));
   // Short angular forks grow out of a parent crack and taper at a chipped
   // edge. Their height and direction do not repeat as dotted vertical rows.
   vec2 join=mix(a,b,mix(0.19,0.79,r.x));
   if(r.y>0.62){
    float side=r.x>0.5?1.0:-1.0;
    vec2 bend=join+vec2(side*(0.12+0.15*r.x),0.10+0.09*r.y);
    vec2 tip=bend+vec2(side*(0.08+0.16*r.y),0.13+0.15*r.x);
    ink=max(ink,chalkStroke(chalkSegment(p,join,bend),width*0.72,aa)*0.8);
    ink=max(ink,chalkStroke(chalkSegment(p,bend,tip),width*0.45,aa)*0.55);
   }
   // An occasional bedding split links neighbouring fractures. Staggered
   // heights and missing links avoid a masonry grid across the whole cliff.
   if(r.y<0.12){
    vec2 next=mix(chalkJoint(column+1.0,level,variant),chalkJoint(column+1.0,level+1.0,variant),mix(0.2,0.7,r.x));
    vec2 bend=mix(join,next,0.54)+vec2(0.0,(r.x-0.5)*0.18);
    ink=max(ink,chalkStroke(chalkSegment(p,join,bend),width*0.65,aa)*0.65);
    ink=max(ink,chalkStroke(chalkSegment(p,bend,mix(bend,next,0.7)),width*0.4,aa)*0.45);
   }
  }
 }
 return ink;
}
void main(){
 // Screen-door coverage lets distant groves emerge continuously as the planet grows.
 // It keeps an opaque depth buffer, so thin leaves never need transparency sorting.
 float coverage = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
 if (coverage > vPresence) discard;
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet);
 vec3 sun=localSun(dir);
 float cloud=cloudShadowAt(vPlanet,0.0)*0.5;
 float light=toonLight(dot(n,sun))*(1.0-cloud*0.45);
 vec3 base;float mark=0.0;vec3 shade=vec3(0.59,0.67,0.8);
 if(vKind<0.5){
  base=linearColor(vec3(0.68,0.59,0.47));
  float grain=fract(vUv.x*11.0+0.026*sin(vUv.y*1.8))-0.5;
  mark=inkLine(grain,0.006)*0.18;
 }else if(vKind<1.5){
  base=mix(linearColor(vec3(0.79,0.24,0.24)),linearColor(vec3(0.94,0.39,0.32)),vVariation*0.7);
  float sector=fract(vUv.x*17.0+0.5)-0.5;
  float veins=sector+0.012*sin(vUv.y*9.0+vUv.x*4.0);
  mark=inkLine(veins,0.004)*smoothstep(0.04,0.22,vUv.y)*0.21;
  float branches=fract(vUv.y*12.0+abs(sector)*0.7)-0.5;
  mark+=inkLine(branches,0.003)*smoothstep(0.25,0.65,vUv.y)*0.035;
  mark+=inkLine(vUv.y-0.99,0.004)*0.17;
  base*=0.96+0.055*cos(vUv.x*106.8);
  light=max(light,0.43+0.19*max(dot(-n,sun),0.0));
  shade=vec3(0.67,0.51,0.59);
 }else if(vKind<2.5){
  float cap=smoothstep(0.28,0.78,dot(n,dir));
  base=mix(linearColor(vec3(0.65,0.73,0.81)),linearColor(vec3(0.94,0.94,0.87)),0.2+cap*0.8);
  float mineral=gnoise(vLocal*vec3(0.85,1.35,0.95)+vVariation*vec3(7.0,3.0,5.0),391u);
  float powder=gnoise(vLocal*17.0+vec3(vVariation*9.0),783u);
  base*=0.975+0.035*vVariation+0.09*mineral+0.025*powder;
  vec3 localN=abs(normalize(cross(dFdx(vLocal),dFdy(vLocal))));
  vec2 plane=localN.y>0.62?vLocal.xz:(localN.z>localN.x?vLocal.xy:vLocal.zy);
  vec2 joints=plane*(localN.y>0.62?vec2(0.72):vec2(0.72,0.82))+vVariation*vec2(7.1,4.6);
  // Derivatives inside a per-pixel crack/branch decision are undefined.
  // Capture the footprint once before those branches so frozen frames agree.
  float jointAA=max(length(fwidth(joints))*0.65,0.001);
  float fractures=chalkFractures(joints,vVariation,jointAA);
  vec3 blueGrey=linearColor(vec3(0.32,0.41,0.49));
  base=mix(base,blueGrey,fractures*mix(0.25,0.14,cap));
  shade=vec3(0.47,0.53,0.72);
 }else if(vKind<3.5){
  bool coral=vKind>3.2;
  base=coral?linearColor(vec3(0.80,0.30,0.25)):linearColor(vec3(0.98,0.97,0.86));
  mark=inkLine(vUv.x-0.5,coral?0.009:0.008)*(coral?0.18:0.12);
  if(coral)base*=0.96+0.06*gnoise(vLocal*5.0,609u);
  light=max(light,coral?0.36:0.5);
 }else if(vKind<4.5){
  base=linearColor(vec3(0.77,0.25,0.23));
  float seam=fract(vUv.x/2.4)-0.5;
  mark=inkLine(seam,0.004)*0.10;
  float weave=sin(vUv.x*210.0)*sin(vUv.y*210.0);
  base*=1.0+0.025*weave*(1.0-smoothstep(0.004,0.02,max(fwidth(vUv.x),fwidth(vUv.y))));
 }else if(vKind<5.5){
  base=linearColor(vec3(0.73,0.64,0.48));
  mark=inkLine(fract(vUv.x*8.0)-0.5,0.025)*0.18;
  base*=0.96+0.04*sin(vUv.y*30.0);
 }else if(vKind<6.5){
  base=linearColor(vec3(0.26,0.29,0.28));
 }else if(vKind<7.5){
  base=linearColor(vec3(0.96,0.79,0.45));light=max(light,0.75);
 }else{
  float leafTone=clamp(vVariation*0.6+0.2+gnoise(vLocal*10.0,631u)*0.18,0.0,1.0);
  base=mix(linearColor(vec3(0.29,0.40,0.26)),linearColor(vec3(0.52,0.59,0.37)),leafTone);
  mark=inkLine(vUv.x-0.5,0.006)*0.17;
  light=max(light,0.32);
 }
 // Bloom brings the native foliage into colour; it never introduces a
 // different world's flowers. The geometry and rock contact remain stable.
 if((vKind>0.5&&vKind<1.5)||(vKind>2.5&&vKind<3.5)||vKind>7.5){
  float luminance=dot(base,vec3(0.2126,0.7152,0.0722));
  base=mix(vec3(luminance)*vec3(0.78,0.85,0.70),base,0.35+0.65*nativeBloom(dir));
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.025,0.14,abs(dot(warpNormal(vPlanet,n),view))))*0.25;
 base*=1.0-min(mark+silhouette,0.5);
 vec3 col=tone3(base*1.04,base*0.92,base*shade,light);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
