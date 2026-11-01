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
float inkLine(float value,float width){float w=max(fwidth(value),0.0008);return 1.0-smoothstep(width,width+w*1.25,abs(value));}
float cellNoise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 dir=normalize(vPlanet),sun=localSun(dir);
 float light=toonLight(dot(n,sun))*(1.0-cloudShadowAt(vPlanet,0.0)*0.17);
 float variation=vVariation;
 vec3 base=vec3(0.5);float mark=0.0,glow=0.0;
 if(vKind<0.5|| (vKind>11.5&&vKind<12.5)){
   // Fibrous, split timber: the grain follows each beam or individual door plank.
   bool door=vKind>11.5;
   base=linearColor(mix(vec3(0.43,0.28,0.22),vec3(0.66,0.46,0.32),variation*0.68+0.16));
   if(door)base=linearColor(mix(vec3(0.46,0.32,0.24),vec3(0.68,0.49,0.34),variation));
   float grain=vUv.x*23.0+sin(vUv.y*2.5+variation*8.0)*0.15+sin(vUv.y*8.0)*0.025;
   mark=inkLine(fract(grain)-0.5,0.025)*0.2;
   mark+=inkLine(fract(vUv.x*8.0+0.08*sin(vUv.y*4.0))-0.5,0.018)*0.12;
   base*=0.95+0.07*sin(grain*6.283);
   light=max(light,0.24);
 }else if(vKind<1.5||vKind>13.5){
   // Thick, dull sage leaves retain their own edges, crease and irregular lateral veins.
   bool awning=vKind>13.5;
   base=linearColor(mix(vec3(0.48,0.63,0.59),vec3(0.70,0.76,0.64),variation));
   if(awning)base=linearColor(mix(vec3(0.63,0.71,0.60),vec3(0.78,0.80,0.65),variation));
   float lateral=fract(vUv.y*7.0+abs(vUv.x-0.5)*2.1+0.08*sin(vUv.y*16.0))-0.5;
   mark=inkLine(lateral,0.009)*0.34+inkLine(vUv.x-0.5,0.008)*0.3;
   mark+=inkLine(abs(vUv.x-0.5)-0.484,0.006)*0.35;
   base*=0.96+0.045*sin(vUv.y*21.0+vUv.x*7.0);
   light=max(light,0.27);
 }else if(vKind<2.5){
   // Flat fractured limestone faces, with sparse chips and powdery flecks.
   base=linearColor(mix(vec3(0.79,0.72,0.63),vec3(0.96,0.90,0.76),variation));
   float crack=fract(vUv.x*0.68+0.13*sin(vUv.y*3.1+variation*3.0)+0.045*sin(vUv.y*17.0))-0.5;
   mark=inkLine(crack,0.006)*0.31;
   mark+=inkLine(fract(vUv.y*0.75+0.12*sin(vUv.x*4.0))-0.5,0.004)*0.17;
   float speck=gnoise(vLocal*38.0,113u);
   base*=0.965+speck*0.035;
   light=max(light,0.36);
 }else if(vKind<3.5){
   base=linearColor(mix(vec3(0.31,0.43,0.41),vec3(0.45,0.55,0.46),variation));
   mark=inkLine(vUv.x-0.5,0.014)*0.2;
 }else if(vKind<4.5){
   // Sparse broken fern brushwork, varied by panel and branch. No repeating closed loop wallpaper.
   base=linearColor(mix(vec3(0.30,0.47,0.53),vec3(0.48,0.65,0.66),variation));
   for(int i=0;i<3;i++){
     float seed=cellNoise(vec2(float(i)*2.7,variation*23.0));
     float stem=0.19+float(i)*0.58+0.13*sin(vUv.y*(1.6+seed)+seed*9.0);
     float end=1.8+seed*1.3;
     float drawn=smoothstep(0.04,0.18,vUv.y)*(1.0-smoothstep(end-0.12,end,vUv.y));
     float frequency=1.5+seed*0.65;
     float row=floor(vUv.y*frequency+seed);
     float branch=cellNoise(vec2(row,float(i)+variation*9.0));
     float side=branch>0.5?1.0:-1.0;
     vec2 p=vec2((vUv.x-stem)*side,(fract(vUv.y*frequency+seed)-0.5)/frequency);
     float reach=0.21+branch*0.17;
     float along=clamp(p.x/reach,0.0,1.0);
     float shape=sin(along*3.14159)*0.065;
     float leaf=inkLine(abs(p.y-p.x*(0.32+seed*0.25))-shape,0.008)*smoothstep(0.0,0.025,p.x)*(1.0-smoothstep(reach-0.02,reach,p.x));
     float broken=0.5+0.5*smoothstep(-0.6,0.5,sin(vUv.y*8.0+seed*21.0));
     mark+=(inkLine(vUv.x-stem,0.008)*0.22+leaf*0.3)*drawn*broken;
   }
   mark+=inkLine(fract(vUv.y*31.0+vUv.x*0.15)-0.5,0.015)*0.07;
   base*=0.95+0.07*gnoise(vec3(vUv*5.0,variation),31u);
 }else if(vKind<5.5){
   base=linearColor(vec3(0.18,0.20,0.22));
 }else if(vKind<6.5){
   base=linearColor(vec3(0.57,0.56,0.39));
   mark=inkLine(fract(vUv.y*18.0)-0.5,0.03)*0.2;
 }else if(vKind<7.5){
   base=linearColor(mix(vec3(0.94,0.73,0.42),vec3(1.0,0.85,0.56),variation));
   float wavering=vUv.x*4.8+0.11*sin(vUv.y*13.0+variation*7.0);
   mark=inkLine(fract(wavering)-0.5,0.018)*0.18;
   glow=0.45+uLanternDusk*0.38;
   light=max(light,0.8);
 }else if(vKind<8.5){
   base=linearColor(mix(vec3(0.58,0.48,0.45),vec3(0.75,0.65,0.52),variation));
   mark=inkLine(fract(vUv.y*12.0)-0.5,0.012)*0.11;
 }else if(vKind<9.5){
   base=linearColor(vec3(0.31,0.52,0.55));
   mark=inkLine(fract(vUv.x*7.0)-0.5,0.018)*0.3;
 }else if(vKind<10.5){
   base=linearColor(vec3(0.82,0.78,0.6));
 }else if(vKind<11.5){
   gl_FragColor=vec4(applyAerial(linearColor(vec3(0.24,0.29,0.30)),distance(cameraPosition,vWorld),dir),1.0);
   return;
 }else{
   base=linearColor(vec3(0.74,0.70,0.63));
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float contour=(1.0-smoothstep(0.03,0.14,abs(dot(n,view))))*0.22;
 base*=1.0-min(mark+contour,0.63);
 vec3 col=tone3(base*1.03,base*0.96,base*vec3(0.60,0.68,0.84),light);
 col=mix(col,linearColor(vec3(1.0,0.76,0.43))*(0.9+variation*0.08),glow);
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
