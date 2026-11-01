#include <meadow_common>
#include <meadow_noise>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
uniform float uLanternDusk;
#include <meadow_clouds>
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width){float w=max(fwidth(value),0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
void main(){
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float cloud=cloudShadowAt(vPlanet,0.0)*0.5;
 float light=toonLight(dot(n,sun))*(1.0-cloud*0.4);
 vec3 base;float mark=0.0,glow=0.0;
 if(vKind<0.5){
   base=linearColor(vec3(0.47,0.36,0.31));
   float grain=sin(vUv.x*73.0+gnoise(vec3(vUv.x*5.0,vUv.y*0.7,1.0),120u)*3.0);
   mark=inkLine(grain,0.035)*0.18;
   base*=0.97+0.055*sin(vUv.x*34.0+vUv.y*0.23);
 }else if(vKind<1.5){
   base=mix(linearColor(vec3(0.80,0.85,0.73)),linearColor(vec3(0.96,0.94,0.77)),vVariation*0.5+0.25);
   float vein=fract(vUv.y*13.0+abs(vUv.x-0.5)*1.7)-0.5;
   mark=inkLine(vein,0.012)*0.19+inkLine(vUv.x-0.5,0.009)*0.34;
   mark+=inkLine(abs(vUv.x-0.5)-0.49,0.005)*0.22;
   light=max(light,0.32+0.17*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
   base=mix(linearColor(vec3(0.73,0.72,0.79)),linearColor(vec3(0.94,0.92,0.81)),0.45+0.3*vVariation);
   float crack=fract(vUv.x*1.6+0.08*sin(vUv.y*9.0)+0.03*sin(vUv.y*23.0))-0.5;
   mark=inkLine(crack,0.007)*0.32;
   mark+=inkLine(fract(vUv.y*2.5+0.06*sin(vUv.x*5.0))-0.5,0.004)*0.13;
 }else if(vKind<3.5){
   base=mix(linearColor(vec3(0.53,0.36,0.47)),linearColor(vec3(0.75,0.53,0.63)),vVariation);
   mark=inkLine(vUv.x-0.5,0.012)*0.2;
 }else if(vKind<4.5){
   base=linearColor(vec3(0.64,0.77,0.70));
   float vein=fract(vUv.y*9.0+abs(vUv.x-0.5)*2.2)-0.5;
   mark=inkLine(vein,0.012)*0.24+inkLine(vUv.x-0.5,0.01)*0.32;
 }else if(vKind<5.5){
   base=linearColor(vec3(0.64,0.59,0.46));
   mark=inkLine(fract(vUv.x*9.0)-0.5,0.03)*0.25;
   mark+=inkLine(fract(vUv.y*12.0)-0.5,0.025)*0.15;
 }else if(vKind<6.5){
   base=linearColor(vec3(0.25,0.29,0.3));
 }else if(vKind<7.5){
   base=mix(linearColor(vec3(0.96,0.91,0.7)),linearColor(vec3(1.0,0.78,0.39)),uLanternDusk*0.65);
   mark=inkLine(vUv.x,0.015)*0.15+inkLine(vUv.x-1.0,0.015)*0.15;
   float centre=pow(max(0.0,1.0-abs(vUv.y-0.47)*1.8),1.4);
   glow=uLanternDusk*(0.2+centre*0.65);
   light=max(light,0.62);
 }else if(vKind<9.5){
   base=linearColor(vec3(0.45,0.68,0.61));
   mark=inkLine(fract(vUv.y*1.5)-0.5,0.035)*0.19;
 }else if(vKind<10.5){
   base=linearColor(vec3(0.97,0.92,0.75));
   mark=inkLine(vUv.x-0.5,0.012)*0.22;
   light=max(light,0.6);
 }else{
   base=linearColor(vec3(0.76,0.53,0.25));glow=uLanternDusk*0.3;light=max(light,0.55);
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.02,0.1,abs(dot(n,view))))*0.18;
 base*=1.0-min(mark+silhouette,0.5);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.64,0.67,0.84),light);
 // Warm seed light stays below clipping, so the paper's folds remain visible.
 col=mix(col,linearColor(vec3(0.98,0.83,0.57))*(0.83+0.11*light),clamp(glow*0.78,0.0,0.78));
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
