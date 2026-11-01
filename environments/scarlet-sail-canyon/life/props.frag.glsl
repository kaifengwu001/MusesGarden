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
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width){float w=max(fwidth(value),0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
void main(){
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet);
 vec3 sun=localSun(dir);
 float cloud=cloudShadowAt(vPlanet,0.0)*0.5;
 float light=toonLight(dot(n,sun))*(1.0-cloud*0.45);
 vec3 base;float mark=0.0;
 if(vKind<0.5){
  float wear=gnoise(vLocal*vec3(0.8,0.32,0.8),351u);
  base=mix(linearColor(vec3(0.46,0.39,0.32)),linearColor(vec3(0.65,0.56,0.43)),0.55+wear*0.28);
  float grain=sin(vUv.x*43.0+gnoise(vec3(vUv.x*3.0,vUv.y*0.5,1.0),120u)*2.3);
  mark=inkLine(grain,0.024)*0.18*smoothstep(-0.3,0.2,gnoise(vec3(vUv.x*2.0,vUv.y*2.1,3.0),120u));
  base*=0.97+0.045*sin(vUv.x*24.0+vUv.y*0.23);
 }else if(vKind<1.5){
  base=mix(linearColor(vec3(0.81,0.27,0.27)),linearColor(vec3(0.91,0.38,0.32)),vVariation*0.55);
  float veins=fract(vUv.x*12.0+0.5)-0.5;
  mark=inkLine(veins,0.004)*smoothstep(0.08,0.3,vUv.y)*0.22;
  mark+=inkLine(vUv.y-0.985,0.006)*0.2;
  light=max(light,0.32+0.18*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
  base=mix(linearColor(vec3(0.69,0.75,0.77)),linearColor(vec3(0.86,0.89,0.86)),0.4+0.35*vVariation);
  float dust=(1.0-smoothstep(0.02,0.57,vLocal.y))*0.23;
  base=mix(base,linearColor(vec3(0.61,0.65,0.56)),dust);
  // Interrupted mineral fissures follow the rock volume, not a tiled UV grid.
  vec3 rock=vLocal*vec3(1.0,1.8,1.0);
  float meander=gnoise(rock*1.4,391u);
  float crack=sin(rock.x*2.1+rock.z*1.6+meander*1.7);
  float broken=smoothstep(0.18,0.58,gnoise(rock*2.5+vec3(1.1),783u));
  float side=1.0-smoothstep(0.45,0.9,abs(dot(n,dir)));
  mark=inkLine(crack,0.008)*broken*0.15*side;
  base*=0.985+0.025*gnoise(rock*3.2,482u);
 }else if(vKind<3.5){
  base=linearColor(vec3(0.94,0.91,0.76));
  mark=inkLine(vUv.x-0.5,0.012)*0.2;
  light=max(light,0.35);
 }else if(vKind<4.5){
  base=linearColor(vec3(0.72,0.28,0.25));
  float seam=fract(vUv.x/2.4)-0.5;
  mark=inkLine(seam,0.004)*0.10;
  float weave=sin(vUv.x*210.0)*sin(vUv.y*210.0);
  base*=0.97+0.035*gnoise(vec3(vUv*1.8,1.0),416u)+0.035*weave*(1.0-smoothstep(0.004,0.02,max(fwidth(vUv.x),fwidth(vUv.y))));
 }else if(vKind<5.5){
  base=linearColor(vec3(0.58,0.47,0.38));
  mark=inkLine(fract(vUv.x*19.0)-0.5,0.022)*0.14;
  mark+=inkLine(fract(vUv.y*21.0)-0.5,0.022)*0.08;
  base*=0.96+0.055*gnoise(vLocal*2.1,782u);
 }else if(vKind<6.5){
  base=linearColor(vec3(0.26,0.29,0.28));
 }else if(vKind<7.5){
  base=linearColor(vec3(0.96,0.79,0.45));light=max(light,0.75);
 }else if(vKind<8.5){
  base=mix(linearColor(vec3(0.38,0.47,0.35)),linearColor(vec3(0.56,0.61,0.41)),vVariation);
  mark=inkLine(vUv.x-0.5,0.006)*0.08;
 }else{
  // Main-bay planks are one physical floor surface. Seams and grain are
  // material variation on that surface, never coplanar overlay geometry.
  float row=floor((vLocal.z+2.63)/0.48);
  float variation=fract(sin(row*4.231+2.1)*431.21);
  base=mix(linearColor(vec3(0.39,0.33,0.27)),linearColor(vec3(0.62,0.53,0.42)),0.3+0.5*variation);
  float seam=fract((vLocal.z+2.63)/0.48+0.5)-0.5;
  float end=fract((vLocal.x+mod(row,3.0)*0.93)/2.8+0.5)-0.5;
  mark=inkLine(seam,0.009)*0.32+inkLine(end,0.002)*0.23;
  float grain=sin(vLocal.z*121.0+gnoise(vec3(vLocal.x*0.45,vLocal.z*4.0,2.0),138u)*2.0);
  mark+=inkLine(grain,0.018)*0.12;
  base*=0.97+0.05*gnoise(vec3(vLocal.x*0.8,vLocal.z*3.0,1.0),782u);
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.02,0.1,abs(dot(warpNormal(vPlanet,n),view))))*0.16;
 base*=1.0-min(mark+silhouette,0.5);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.59,0.67,0.8),light);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
