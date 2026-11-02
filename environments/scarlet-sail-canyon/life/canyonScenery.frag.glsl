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
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width,float footprint){return 1.0-smoothstep(width,width+max(footprint,0.0001),abs(value));}
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
 return vec2(column+0.5+(r.x-0.5)*0.58,level+0.12+r.y*0.76);
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
 // Derivatives are evaluated before material decisions.
 // Thin marks fade with their footprint rather than becoming moving stipple.
 vec2 uvPixel=max(fwidth(vUv),vec2(0.0001));
 vec3 localDx=dFdx(vLocal),localDy=dFdy(vLocal);
 float localPixel=max(length(localDx),length(localDy));
 vec3 localN=abs(normalize(cross(localDx,localDy)));
 float closeDetail=1.0-smoothstep(0.025,0.13,localPixel);
 // The placement batch grows complete opaque forms into the world. No
 // screen-space stipple remains on partially emerged trees or cliff faces.
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet);
 vec3 sun=localSun(dir);
 float cloud=cloudShadowAt(vPlanet,0.0)*0.5;
 float light=toonLight(dot(n,sun))*(1.0-cloud*0.45);
 vec3 base;float mark=0.0;vec3 shade=vec3(0.59,0.67,0.8);
 if(vKind<0.5){
  base=mix(linearColor(vec3(0.59,0.53,0.42)),linearColor(vec3(0.75,0.68,0.54)),0.3+0.5*vVariation);
  float grain=fract(vUv.x*13.0+0.07*sin(vUv.y*1.3)+0.025*sin(vUv.y*4.7))-0.5;
  float striation=inkLine(grain,0.009,uvPixel.x*13.0+uvPixel.y*0.2);
  mark=striation*(0.14+0.10*closeDetail);
  base*=0.97+0.06*gnoise(vLocal*vec3(5.0,0.8,5.0),937u);
  shade=vec3(0.55,0.58,0.62);
 }else if(vKind<1.5){
  base=mix(linearColor(vec3(0.76,0.27,0.25)),linearColor(vec3(0.91,0.39,0.31)),vVariation*0.7);
  float ribs=13.0+floor(vVariation*3.0);
  float sector=fract(vUv.x*ribs+0.5)-0.5;
  float veins=sector+0.022*sin(vUv.y*7.0+vUv.x*9.0);
  mark=inkLine(veins,0.007,uvPixel.x*ribs+uvPixel.y*0.17)*smoothstep(0.03,0.18,vUv.y)*0.30;
  float branches=fract(vUv.y*8.0-abs(sector)*1.4+vVariation)-0.5;
  mark+=inkLine(branches,0.006,uvPixel.y*8.0+uvPixel.x*ribs*1.4)*smoothstep(0.25,0.7,vUv.y)*0.075*closeDetail;
  mark+=inkLine(vUv.y-0.992,0.002,uvPixel.y)*0.23;
  float fold=cos(vUv.x*ribs*6.2831853+0.15*sin(vUv.y*5.0));
  base*=0.96+0.045*fold+0.025*closeDetail*gnoise(vLocal*8.0,617u);
  base=mix(base,linearColor(vec3(0.90,0.44,0.32)),(1.0-smoothstep(0.0,0.22,vUv.y))*0.24);
  light=max(light,0.39+0.18*max(dot(-n,sun),0.0));
  shade=vec3(0.65,0.50,0.56);
 }else if(vKind<2.5){
  float cap=smoothstep(0.28,0.78,dot(n,dir));
  base=mix(linearColor(vec3(0.69,0.75,0.81)),linearColor(vec3(0.94,0.93,0.86)),0.1+cap*0.9);
  float mineral=gnoise(vLocal*vec3(0.7,1.1,0.8)+vVariation*vec3(7.0,3.0,5.0),391u);
  float wash=gnoise(vLocal*vec3(2.4,0.32,2.4)+vVariation*4.0,392u);
  float powder=gnoise(vLocal*18.0+vec3(vVariation*9.0),783u)*closeDetail;
  base*=0.965+0.025*vVariation+0.065*mineral+0.023*powder;
  vec2 plane=localN.y>0.62?vLocal.xz:(localN.z>localN.x?vLocal.xy:vLocal.zy);
  vec2 jointScale=localN.y>0.62?vec2(0.58):vec2(0.64,0.58);
  vec2 joints=plane*jointScale+vVariation*vec2(7.1,4.6);
  float jointAA=max(localPixel*max(jointScale.x,jointScale.y)*0.68,0.0006);
  float fractures=chalkFractures(joints,vVariation,jointAA);
  vec3 blueGrey=linearColor(vec3(0.30,0.38,0.43));
  base=mix(base,blueGrey,fractures*mix(0.49,0.32,cap));
  // Mineral seams stain a narrow area beside a fracture; the entire face
  // stays chalk, with thin dark joints instead of heavy black wireframes.
  float seam=chalkFractures(joints,vVariation,jointAA+0.017)*(1.0-fractures);
  base=mix(base,linearColor(vec3(0.67,0.70,0.67)),seam*0.14);
  // Chalk keeps a faint mineral wash. Moss is separate raised geometry;
  // broad olive paint here previously looked like flat vegetation decals.
  float mineralWash=smoothstep(0.24,0.43,mineral+wash*0.25)*cap;
  base=mix(base,linearColor(vec3(0.70,0.73,0.68)),mineralWash*0.10);
  float hatch=inkLine(fract(dot(plane,vec2(16.0,5.0))+wash*0.6)-0.5,0.025,localPixel*17.0);
  float brokenHatch=smoothstep(0.03,0.30,gnoise(vLocal*vec3(3.8,1.1,3.8),645u));
  base*=1.0-hatch*brokenHatch*smoothstep(0.05,0.38,wash)*(1.0-light)*0.055*closeDetail;
  shade=vec3(0.55,0.62,0.77);
 }else if(vKind<3.5){
  bool coral=vKind>3.2;
  base=coral?mix(linearColor(vec3(0.74,0.29,0.24)),linearColor(vec3(0.88,0.42,0.31)),vVariation):linearColor(vec3(0.97,0.95,0.81));
  mark=inkLine(vUv.x-0.5,coral?0.008:0.006,uvPixel.x)*(coral?0.28:0.20);
  float rib=fract(vUv.y*6.0-abs(vUv.x-0.5)*2.5)-0.5;
  mark+=inkLine(rib,0.012,uvPixel.y*6.0+uvPixel.x*2.5)*(coral?0.06:0.10)*closeDetail;
  base*=0.97+0.055*gnoise(vLocal*8.0,609u)*closeDetail;
  light=max(light,coral?0.34:0.48);
  shade=coral?vec3(0.63,0.53,0.52):vec3(0.66,0.72,0.67);
 }else if(vKind<4.5){
  base=linearColor(vec3(0.77,0.25,0.23));
  float seam=fract(vUv.x/2.4)-0.5;
  mark=inkLine(seam,0.004,uvPixel.x/2.4)*0.10;
  float weave=sin(vUv.x*210.0)*sin(vUv.y*210.0);
  base*=1.0+0.025*weave*(1.0-smoothstep(0.004,0.02,max(uvPixel.x,uvPixel.y)));
 }else if(vKind<5.5){
  base=linearColor(vec3(0.73,0.64,0.48));
  mark=inkLine(fract(vUv.x*8.0)-0.5,0.025,uvPixel.x*8.0)*0.18;
  base*=0.96+0.04*sin(vUv.y*30.0)*closeDetail;
 }else if(vKind<6.5){
  base=linearColor(vec3(0.26,0.29,0.28));
 }else if(vKind<7.5){
  base=linearColor(vec3(0.96,0.79,0.45));light=max(light,0.75);
 }else if(vKind<8.5){
  // Olive leaf islands have individual veins and a light worn margin.
  // Geometry supplies irregular layered shoots rather than a sphere normal.
  float leafTone=clamp(vVariation*0.45+0.35+gnoise(vLocal*4.5,631u)*0.30,0.0,1.0);
  base=mix(linearColor(vec3(0.35,0.43,0.25)),linearColor(vec3(0.61,0.64,0.36)),leafTone);
  float midrib=inkLine(vUv.x-0.5,0.008,uvPixel.x);
  float ribs=fract(vUv.y*5.5-abs(vUv.x-0.5)*2.6)-0.5;
  mark=midrib*0.26+inkLine(ribs,0.012,uvPixel.y*5.5+uvPixel.x*2.6)*0.12*closeDetail;
  float margin=smoothstep(0.35,0.49,abs(vUv.x-0.5));
  base=mix(base,linearColor(vec3(0.66,0.67,0.40)),margin*0.19);
  base*=0.97+0.06*gnoise(vLocal*19.0,634u)*closeDetail;
  light=max(light,0.30);
  shade=vec3(0.56,0.66,0.52);
 }else{
  // Dense short moss fibers cover a low, irregular physical mat. There are
  // no leaf midribs or rock fractures on this separate living surface.
  float tuft=gnoise(vLocal*vec3(10.0,4.0,10.0)+vVariation*3.0,661u);
  float mossGrain=gnoise(vLocal*vec3(75.0,31.0,75.0),662u);
  float fine=1.0-smoothstep(0.006,0.035,localPixel);
  base=mix(linearColor(vec3(0.36,0.43,0.21)),linearColor(vec3(0.60,0.63,0.34)),clamp(0.48+tuft*0.40+vVariation*0.12,0.0,1.0));
  base*=0.98+0.09*mossGrain*fine;
  // Tiny interrupted blades make a fibrous skin, without long parallel
  // striations. Their subpixel limit blends back to the average moss pigment.
  vec2 fiberCell=vUv*76.0;
  vec2 fiberRandom=jointHash(floor(fiberCell)+vVariation*37.0);
  vec2 fiberPoint=fract(fiberCell)-0.5-(fiberRandom-0.5)*0.58;
  vec2 fiberAxis=normalize(vec2((fiberRandom.x-0.5)*1.6,1.0));
  float along=dot(fiberPoint,fiberAxis);
  float across=dot(fiberPoint,vec2(-fiberAxis.y,fiberAxis.x));
  float bladeDistance=max(abs(across)-0.055,abs(along)-(0.12+fiberRandom.y*0.17));
  float fiberPixel=max(uvPixel.x,uvPixel.y)*76.0;
  float fiberDetail=1.0-smoothstep(0.30,0.80,fiberPixel);
  float blade=(1.0-smoothstep(0.0,max(0.018,fiberPixel*0.65),bladeDistance))*fiberDetail;
  base*=1.0+blade*mix(-0.17,0.16,smoothstep(-0.12,0.14,along));
  shade=vec3(0.50,0.61,0.42);
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
