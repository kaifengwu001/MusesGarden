// Woodblock pigments: marks follow the timber grain, tile courses and mineral faces.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
uniform int uKind;
uniform float uSnowAmount;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec4 vPaint;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vUp;

float line(float p,float width) {
  float d=abs(fract(p+0.5)-0.5);
  return 1.0-smoothstep(width,width+max(fwidth(p),0.003),d);
}
// Unequal stone faces, with a fine mortar separation rather than a brick grid.
vec2 mineral(vec2 p) {
  vec2 cell=floor(p), f=fract(p);
  float first=10.0,second=10.0,id=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 c=vec2(float(x),float(y));
    vec2 jitter=vec2(hash12(cell+c+1.3),hash12(cell+c+8.7));
    vec2 q=c+0.20+0.60*jitter-f;
    float d=dot(q,q);
    if(d<first){second=first;first=d;id=jitter.x;}else second=min(second,d);
  }
  float edge=sqrt(second)-sqrt(first);
  return vec2(1.0-smoothstep(0.018,0.042+fwidth(edge),edge),id);
}
void main() {
  if(uKind==6 && uSnowAmount<0.5) discard;
  vec3 n=normalize(vPlanetNormal);
  if(!gl_FrontFacing)n=-n;
  vec3 dir=normalize(vPlanet);
  float shade=0.32+0.68*toonLight(dot(n,localSun(dir)));
  shade*=1.0-0.12*cloudShadowAt(vPlanet,0.0);
  vec3 ink=vec3(0.012,0.020,0.026);
  vec3 col;
  float edge=1.0-smoothstep(0.009,0.020+fwidth(vPaint.x),vPaint.x);
  if(uKind==0){
    col=mix(vec3(0.40,0.35,0.26),vec3(0.69,0.62,0.47),shade);
  }else if(uKind==1){
    float course=line(vUv.y/0.32,0.026);
    float joint=line(vUv.x/0.42+floor(vUv.y/0.32)*0.5,0.019);
    col=mix(vec3(0.025,0.049,0.077),vec3(0.085,0.145,0.20),shade);
    col=mix(col,ink,max(course,joint*0.65)*0.78);
    col+=vec3(0.012,0.020,0.025)*line(vUv.y/0.32-0.13,0.018);
  }else if(uKind==2){
    bool floorBoard=vPaint.w>0.5&&vPaint.w<1.5;
    bool bridgeBoard=vPaint.w>1.5&&vPaint.w<2.5;
    vec2 grain=abs(vLocalNormal.x)>0.6?vec2(vLocal.z,vLocal.y):vec2(vLocal.x,vLocal.y);
    if(vPaint.w>2.5&&vPaint.w<3.5)grain=vec2(vLocal.y,vLocal.x);
    if(vPaint.w>3.5)grain=vec2(vLocal.y,vLocal.z);
    if(floorBoard)grain=vLocal.zx;
    if(bridgeBoard)grain=vLocal.xz;
    // Long sparse fibres: almost straight, tapering into and out of the plank.
    float phase=grain.x*23.0+0.13*sin(grain.y*1.7)+0.06*sin(grain.y*4.1);
    float fibres=line(phase,0.027)*smoothstep(-0.15,0.20,gnoise(vec3(grain.x*3.0,grain.y*0.85,3.0),802u));
    float small=floorBoard||bridgeBoard?0.035:0.0;
    col=mix(vec3(0.055,0.031,0.015),vec3(0.22+small,0.115+small*0.5,0.046),shade);
    float plank=0.0;
    if(floorBoard)plank=line(vLocal.z/0.26,0.020);
    if(bridgeBoard)plank=line(vLocal.x/0.25,0.020);
    col=mix(col,ink,max(plank*0.72,fibres*0.42));
    col+=vec3(0.018,0.012,0.005)*line(phase-0.18,0.018)*(1.0-fibres);
  }else if(uKind==3){
    col=ink;
  }else if(uKind==4){
    col=mix(vec3(0.73,0.42,0.15),vec3(0.98,0.78,0.40),0.60+0.25*shade);
    edge*=0.30;
  }else if(uKind==5){
    vec2 p=abs(vLocalNormal.y)>0.6?vLocal.xz:vec2(abs(vLocalNormal.x)>0.6?vLocal.z:vLocal.x,vLocal.y);
    vec2 stone=mineral(p*vec2(1.7,2.8));
    col=mix(vec3(0.075,0.115,0.16),vec3(0.25,0.31,0.34),shade);
    col*=0.86+0.22*stone.y;
    col=mix(col,ink,stone.x*0.62);
    // Tiny selected mineral flecks, filtered away as soon as they become subpixel.
    float grain=gnoise(vec3(p*19.0,1.7),804u);
    float detail=1.0-smoothstep(0.03,0.10,max(fwidth(p.x),fwidth(p.y)));
    col*=1.0+detail*(0.10*smoothstep(0.36,0.58,grain)-0.12*(1.0-smoothstep(-0.55,-0.35,grain)));
  }else{
    col=mix(vec3(0.62,0.72,0.80),vec3(0.95,0.94,0.88),0.60+0.40*shade);
    edge=0.0;
  }
  col=mix(col,ink,edge*(uKind==0?0.32:0.60));
  gl_FragColor=vec4(applyAerial(col,length(cameraPosition-vWorld),dir),1.0);
}
