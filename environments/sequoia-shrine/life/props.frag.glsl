#include <meadow_common>
uniform float uRadius;
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying float vKind;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float stroke(float d,float width,float footprint){return 1.0-smoothstep(width,width+max(footprint,0.001),abs(d));}
void main(){
  vec3 n=normalize(vPlanetNormal),dir=normalize(vPlanet);
  if(!gl_FrontFacing)n=-n;
  vec3 sun=localSun(dir);
  float light=toonLight(dot(n,sun));
  // Derivative footprints are uniform across all material branches.
  vec3 footprint=fwidth(vLocal);
  float fine=1.0-smoothstep(0.015,0.08,max(footprint.x,max(footprint.y,footprint.z)));
  float grain=gnoise(vLocal*vec3(19.0,0.85,19.0),419u);
  float worn=gnoise(vLocal*1.2,427u);
  vec3 base;float mark=0.0;
  if(vKind<0.5){
    base=mix(linearColor(vec3(0.20,0.23,0.19)),linearColor(vec3(0.36,0.31,0.23)),0.45+0.24*worn);
    base*=1.0+0.12*grain*fine;
    vec2 p=abs(vLocalNormal.y)>0.7?vLocal.xz:vLocal.xy;
    float seam=fract(p.x*4.6+0.05*sin(p.y*0.8))-0.5;
    mark=stroke(seam,0.012,max(footprint.x,footprint.z)*4.6)*0.17*fine;
  }else if(vKind<1.5){
    base=mix(linearColor(vec3(0.44,0.16,0.12)),linearColor(vec3(0.70,0.29,0.19)),0.50+0.18*worn);
    base*=1.0+0.10*grain*fine;
    float chip=smoothstep(0.38,0.56,gnoise(vLocal*vec3(8.0,1.2,8.0),431u));
    base=mix(base,linearColor(vec3(0.38,0.29,0.20)),chip*0.23*fine);
    light=max(light,0.28);
  }else if(vKind<2.5){
    base=mix(linearColor(vec3(0.15,0.23,0.22)),linearColor(vec3(0.29,0.36,0.29)),0.45+0.22*worn);
    float moss=smoothstep(-0.05,0.32,gnoise(vLocal*vec3(1.5,2.0,1.0),439u))*smoothstep(3.2,5.1,abs(vLocal.x));
    base=mix(base,linearColor(vec3(0.36,0.43,0.23)),moss*0.6);
    float courses=fract(vLocal.x*3.6+0.07*sin(vLocal.z*1.1))-0.5;
    mark=stroke(courses,0.025,footprint.x*3.6)*0.22*fine;
    base*=0.96+0.08*gnoise(vLocal*11.0,441u)*fine;
  }else if(vKind<3.5){
    base=mix(linearColor(vec3(0.33,0.40,0.38)),linearColor(vec3(0.58,0.62,0.55)),0.48+0.28*worn);
    vec2 p=abs(vLocalNormal.y)>0.7?vLocal.xz:(abs(vLocalNormal.x)>0.7?vLocal.zy:vLocal.xy);
    float row=floor(p.y/0.45);
    vec2 cell=fract(vec2(p.x/0.85+mod(row,2.0)*0.5,p.y/0.45));
    float joint=min(min(cell.x,1.0-cell.x),min(cell.y,1.0-cell.y));
    mark=(1.0-smoothstep(0.015,0.04+length(footprint)*2.0,joint))*0.13;
    float damp=(1.0-smoothstep(0.15,0.9,vLocal.y))*smoothstep(-0.2,0.3,worn);
    base=mix(base,linearColor(vec3(0.28,0.37,0.24)),damp*0.45);
    base*=0.97+0.09*gnoise(vLocal*22.0,449u)*fine;
  }else if(vKind<4.5){
    base=mix(linearColor(vec3(0.25,0.35,0.18)),linearColor(vec3(0.43,0.48,0.26)),0.5+0.3*worn);
    base*=1.0+0.09*gnoise(vLocal*35.0,457u)*fine;
  }else if(vKind<5.5){base=linearColor(vec3(0.88,0.87,0.70));light=max(light,0.5);
  }else if(vKind<6.5){base=linearColor(vec3(0.58,0.49,0.29));base*=1.0+0.08*grain*fine;
  }else if(vKind<7.5){base=linearColor(vec3(0.65,0.49,0.22));light=max(light,0.56);
  }else{base=linearColor(vec3(0.10,0.18,0.16));light*=0.3;}
  float cloud=cloudShadowAt(vPlanet,0.0);
  light*=1.0-cloud*0.35;
  vec3 view=normalize(cameraPosition-vWorld);
  float silhouette=(1.0-smoothstep(0.015,0.12,abs(dot(warpNormal(vPlanet,n),view))))*0.16;
  base*=1.0-mark-silhouette;
  vec3 col=tone3(base*1.02,base*0.85,base*vec3(0.51,0.65,0.65),light);
  gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
