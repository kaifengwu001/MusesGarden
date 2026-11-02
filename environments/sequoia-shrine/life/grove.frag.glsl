#include <meadow_common>
#include <meadow_toon>
#include <meadow_sun>
#include <meadow_fog>
#include <meadow_warp>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying float vKind;
varying float vTint;
vec3 linearGrove(vec3 c){return pow(c,vec3(2.2));}
void main(){
  vec3 dir=normalize(vPlanet),n=normalize(vPlanetNormal);
  float light=toonLight(dot(n,localSun(dir)));
  float footprint=max(length(dFdx(vLocal)),length(dFdy(vLocal)));
  float detail=1.0-smoothstep(0.12,0.75,footprint);
  vec3 lit,mid,shade;
  float ink=0.0;
  if(vKind<0.5){
    float angle=atan(vLocal.z,vLocal.x);
    float groove=sin(angle*51.0+sin(vLocal.y*0.27)*0.42);
    float fiber=sin(angle*137.0+vLocal.y*0.7)*sin(angle*89.0-vLocal.y*0.2);
    float bark=clamp(0.45+groove*0.21+fiber*0.11*detail+vTint*0.12,0.0,1.0);
    lit=linearGrove(mix(vec3(0.43,0.34,0.26),vec3(0.58,0.47,0.32),bark));
    mid=linearGrove(vec3(0.28,0.31,0.27));shade=linearGrove(vec3(0.15,0.24,0.24));
    ink=smoothstep(0.5,0.92,-groove)*0.13*detail;
    float moss=(1.0-smoothstep(0.5,5.3,vLocal.y))*(0.5+0.5*sin(angle*5.0+vLocal.y*0.9));
    lit=mix(lit,linearGrove(vec3(0.39,0.47,0.24)),moss*0.7);
    mid=mix(mid,linearGrove(vec3(0.23,0.35,0.24)),moss*0.6);
  }else if(vKind<1.5){
    float branchMark=hash13(floor(vLocal*vec3(3.6,6.0,3.6)));
    lit=linearGrove(mix(vec3(0.30,0.49,0.34),vec3(0.43,0.58,0.36),vTint));
    mid=linearGrove(vec3(0.16,0.35,0.30));shade=linearGrove(vec3(0.08,0.23,0.24));
    ink=smoothstep(0.68,0.93,branchMark)*0.12*detail;
    light=max(0.12,light*0.84);
  }else if(vKind<2.5){
    lit=linearGrove(vec3(0.38,0.48,0.32));mid=linearGrove(vec3(0.29,0.41,0.31));shade=linearGrove(vec3(0.19,0.32,0.27));
    ink=(0.5+0.5*sin(vLocal.x*52.0+sin(vLocal.z*23.0)))*0.05*detail;
  }else if(vKind<3.5){
    lit=linearGrove(vec3(0.48,0.61,0.37));mid=linearGrove(vec3(0.27,0.46,0.34));shade=linearGrove(vec3(0.13,0.32,0.28));
  }else{
    lit=linearGrove(vec3(0.50,0.55,0.49));mid=linearGrove(vec3(0.33,0.43,0.40));shade=linearGrove(vec3(0.20,0.34,0.34));
  }
  vec3 col=tone3(lit,mid,shade,light)*(1.0-ink);
  vec3 view=normalize(cameraPosition-vWorld);
  float silhouette=1.0-smoothstep(0.035,0.18,abs(dot(warpNormal(vPlanet,n),view)));
  col*=1.0-silhouette*(vKind<0.5?0.18:0.11);
  col=applyAerial(col,distance(cameraPosition,vWorld),dir);
  gl_FragColor=vec4(col,1.0);
}
