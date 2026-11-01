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
   base=mix(linearColor(vec3(0.73,0.79,0.70)),linearColor(vec3(0.95,0.93,0.78)),vVariation*0.45+0.4);
   float vein=fract(vUv.y*11.0+abs(vUv.x-0.5)*1.55)-0.5;
   mark=inkLine(vein,0.014)*0.30+inkLine(vUv.x-0.5,0.01)*0.48;
   mark+=inkLine(abs(vUv.x-0.5)-0.49,0.009)*0.44;
   light=max(light,0.48+0.12*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
   float upper=smoothstep(0.35,0.8,dot(n,dir));
   base=mix(linearColor(vec3(0.63,0.63,0.74)),linearColor(vec3(0.93,0.9,0.77)),upper);
   float jointY=vLocal.z*1.3;
   float jog=mix(sin(floor(jointY)*6.17),sin((floor(jointY)+1.0)*6.17),fract(jointY));
   float crack=fract(vLocal.x*.72+jog*.15+vLocal.z*.12)-.5;
   float broken=smoothstep(-.2,.45,gnoise(vLocal*.8,81u));
   mark=inkLine(crack,0.007)*0.40*broken;
   mark+=inkLine(vLocal.y-.045,.009)*(1.0-upper)*.18;
   base*=0.96+0.06*gnoise(vPlanet*4.5,123u);
 }else if(vKind<3.5){
   base=mix(linearColor(vec3(0.43,0.19,0.29)),linearColor(vec3(0.67,0.32,0.43)),vVariation);
   mark=inkLine(vUv.x-0.5,0.016)*0.35;
   mark+=inkLine(fract(vUv.y*6.0+abs(vUv.x-.5)*1.2)-.5,.015)*.14;
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
   base=mix(linearColor(vec3(.76,.77,.64)),linearColor(vec3(.93,.83,.56)),uLanternDusk*.46);
   // The folded side planes stay legible around a much smaller glowing seed.
   base*=.83+.17*max(dot(n,normalize(vec3(.4,.7,.6))),0.0);
   mark=inkLine(vUv.x,0.022)*0.4+inkLine(vUv.x-1.0,0.022)*0.4;
   vec2 seed=(vUv-vec2(.5,.39))*vec2(9.0,7.5);
   float centre=exp(-dot(seed,seed));
   // The seed shines through the thin case. Its HDR core clears the existing
   // bloom bright-pass threshold (0.88), while the structural ribs remain dark.
   glow=(.1+.9*uLanternDusk)*(.018+centre*2.85);
   light=max(light,0.55);
 }else if(vKind<8.5){
   base=mix(linearColor(vec3(0.25,0.52,0.45)),linearColor(vec3(0.48,0.67,0.56)),vVariation);
   mark=inkLine(fract(vUv.y*.7)-0.5,0.025)*0.3;
 }else if(vKind<9.5){
   base=linearColor(vec3(0.51,0.40,0.29));
   light=max(light,.42);
 }else if(vKind<10.5){
   base=linearColor(vec3(0.97,0.92,0.75));
   mark=inkLine(vUv.x-0.5,0.012)*0.22;
   light=max(light,0.6);
 }else if(vKind<11.5){
   base=linearColor(vec3(0.92,0.67,0.26));glow=uLanternDusk*.65;light=max(light,0.55);
 }else if(vKind<12.5){
   base=mix(linearColor(vec3(.47,.35,.58)),linearColor(vec3(.74,.57,.75)),vVariation);
   mark=inkLine(vUv.y,.015)*.28;
   base*=.94+.08*gnoise(vLocal*12.0,73u);
 }else if(vKind<13.5){
   base=mix(linearColor(vec3(.47,.55,.68)),linearColor(vec3(.65,.65,.76)),vVariation);
   float y=vLocal.y*.49;
   float jog=mix(sin(floor(y)*3.71),sin((floor(y)+1.0)*3.71),fract(y));
   float joint=fract(vLocal.x*.29+vLocal.z*.21+jog*.11)-.5;
   float broken=smoothstep(-.3,.45,gnoise(vLocal*.22,43u));
   mark=inkLine(joint,.0045)*.45*broken;
   mark+=inkLine(gnoise(vLocal*vec3(.2,.055,.2),57u),.003)*.16;
   base*=.96+.08*gnoise(vPlanet*.6,120u);
 }else{
   base=linearColor(vec3(.22,.36,.40));
   base*=.88+.22*smoothstep(-.3,.3,gnoise(vLocal*2.1,77u));
   mark=inkLine(gnoise(vLocal*1.9,78u),.008)*.18;
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(0.02,0.12,abs(dot(n,view))))*0.25;
 base*=1.0-min(mark+silhouette,0.65);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.64,0.67,0.84),light);
 col+=vec3(1.0,.66,.25)*glow;
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
