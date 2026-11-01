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
varying vec2 vUv;
varying float vKind;
varying float vVariation;
varying float vPresence;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width){float w=max(fwidth(value),0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
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
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  base=linearColor(vec3(0.61,0.48,0.35));
  float grain=sin(vUv.x*73.0+gnoise(vec3(vUv.x*5.0,vUv.y*0.7,1.0),120u)*3.0);
  mark=inkLine(grain,0.035)*0.18;
  base*=0.97+0.055*sin(vUv.x*34.0+vUv.y*0.23);
 }else if(vKind<1.5){
  base=mix(linearColor(vec3(0.81,0.27,0.27)),linearColor(vec3(0.91,0.38,0.32)),vVariation*0.55);
  float veins=fract(vUv.x*12.0+0.5)-0.5;
  mark=inkLine(veins,0.004)*smoothstep(0.08,0.3,vUv.y)*0.22;
  mark+=inkLine(vUv.y-0.985,0.006)*0.2;
  light=max(light,0.32+0.18*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
  base=mix(linearColor(vec3(0.78,0.84,0.88)),linearColor(vec3(0.92,0.94,0.93)),0.4+0.35*vVariation);
  // Sparse, interrupted mineral fractures, without repeated face-wide stripes.
  vec3 rock=vLocal+vec3(vVariation*7.1,0.0,vVariation*3.8);
  float meander=gnoise(rock*vec3(1.4,3.1,1.7),391u);
  float crack=sin(rock.x*2.8+rock.z*1.9+meander*1.4);
  float broken=smoothstep(-0.1,0.35,gnoise(rock*2.7+vec3(1.1),783u));
  mark=inkLine(crack,0.009)*broken*0.22;
  float crossCrack=sin(rock.y*3.4+rock.x*0.7+gnoise(rock*3.0,482u)*0.6);
  mark+=inkLine(crossCrack,0.007)*smoothstep(0.2,0.65,meander)*0.12;
 }else if(vKind<3.5){
  base=linearColor(vec3(0.94,0.91,0.76));
  mark=inkLine(vUv.x-0.5,0.012)*0.2;
  light=max(light,0.35);
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
  base=mix(linearColor(vec3(0.38,0.47,0.35)),linearColor(vec3(0.56,0.61,0.41)),vVariation);
  mark=inkLine(vUv.x-0.5,0.006)*0.08;
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.02,0.1,abs(dot(warpNormal(vPlanet,n),view))))*0.16;
 base*=1.0-min(mark+silhouette,0.5);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.59,0.67,0.8),light);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
