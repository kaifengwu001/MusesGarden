// Woodblock pigments: marks follow the timber grain, tile courses and mineral faces.
#include <meadow_common>
#include <meadow_noise>
uniform float uRadius;
#include <meadow_terrain>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_snow>
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
void main() {
  float pixelMeters=max(length(dFdx(vLocal)),length(dFdy(vLocal)));
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
    float course=line(abs(vLocal.z)/3.14*10.0,0.018);
    float joint=line((vLocal.x+4.84)/(9.68/24.0),0.012);
    col=mix(vec3(0.025,0.042,0.060),vec3(0.082,0.125,0.165),shade);
    col=mix(col,ink,max(course*0.58,joint*0.35));
    // The curved tile shape supplies the broad light; only fine seams are inked.
    edge=0.0;
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
    float variation=0.94+0.08*fract(vPaint.w*1.37);
    col=mix(vec3(0.085,0.115,0.135),vec3(0.30,0.34,0.35),shade)*variation;
    // Sparse fine mineral grains; masonry joints are actual geometric edges.
    float grain=gnoise(vec3(p*24.0,1.7),804u);
    float detail=1.0-smoothstep(0.025,0.075,pixelMeters);
    col*=1.0+detail*(0.10*smoothstep(0.40,0.60,grain)-0.13*(1.0-smoothstep(-0.60,-0.40,grain)));
    edge=0.0;
  }else{
    col=snowBoundary(shade,normalize(vLocalNormal).y);
    edge=0.0;
  }
  col=mix(col,ink,edge*(uKind==0?0.32:0.60));
  gl_FragColor=vec4(applyAerial(col,length(cameraPosition-vWorld),dir),1.0);
}
