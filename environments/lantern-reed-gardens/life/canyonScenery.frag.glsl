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
varying vec3 vModelNormal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float inkLine(float value,float width){float w=max(fwidth(value),0.001);return 1.0-smoothstep(width,width+w*1.2,abs(value));}
float stoneHash(float p){return fract(sin(p*127.1+34.7)*43758.5453);}
// Angular, interrupted mineral joints, with smaller cross fractures. No swirling grain.
float stoneJoint(vec2 p){
 float row=floor(p.y),y=fract(p.y);
 float jog=mix(stoneHash(row),stoneHash(row+1.0),y)-.5;
 float seam=fract(p.x+jog*.52)-.5;
 float primary=inkLine(seam,.009)*smoothstep(.12,.3,stoneHash(floor(p.x)*7.1+row));
 float branch=inkLine(y-.52-(fract(p.x)-.5)*.55,.013)*(1.0-smoothstep(.16,.46,abs(seam)));
 return max(primary,branch*.6);
}
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
   base=mix(linearColor(vec3(.65,.73,.65)),linearColor(vec3(.91,.90,.77)),vVariation*.36+.46);
   float ribs=vUv.y*13.0+abs(vUv.x-.5)*2.7;
   float vein=fract(ribs)-.5;
   float taper=smoothstep(.0,.13,vUv.y)*(1.0-smoothstep(.82,1.0,vUv.y));
   mark=inkLine(vein,.009)*.32*taper+inkLine(vUv.x-.5,.008)*.57;
   mark+=inkLine(abs(vUv.x-.5)-.486,.005)*.56;
   // A fine parallel fibre follows each blade; broad paint variation stays restrained.
   base*=.92+.08*cos((vUv.x-.5)*7.0)+.035*sin(vUv.x*190.0+vUv.y*4.0);
   light=max(light,.34+.18*max(dot(-n,sun),0.0));
 }else if(vKind<2.5){
   float upper=smoothstep(.35,.8,dot(n,dir));
   base=mix(linearColor(vec3(.55,.56,.65)),linearColor(vec3(.88,.87,.78)),upper);
   vec2 plane=abs(vModelNormal.y)>.7?vLocal.xz:vec2(vLocal.x+vLocal.z*.63,vLocal.y*2.6);
   mark=stoneJoint(plane*1.45)*.54;
   float sediment=fract(vLocal.y*10.0+vLocal.x*.19+vLocal.z*.24)-.5;
   mark+=inkLine(sediment,.008)*(1.0-upper)*.14;
   float grit=gnoise(vLocal*38.0,123u);
   base*=.95+.07*gnoise(vLocal*4.5,121u)+.05*grit;
   // Weathered sides and the lower wet rim are cooler and darker than dry tops.
   base*=mix(.73,1.0,smoothstep(-.26,.19,vLocal.y));
   light*=mix(.8,1.0,upper);
 }else if(vKind<3.5||vKind>14.5){
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
   base=mix(linearColor(vec3(.77,.78,.65)),linearColor(vec3(.91,.82,.60)),uLanternDusk*.38);
   // Rib shadow, folded paper and warm transmission each have their own scale.
   float fold=abs(vUv.x-.5)*2.0;
   base*=.75+.25*(1.0-fold);
   float fibre=sin(vUv.y*173.0+sin(vUv.x*37.0)*.8);
   base*=.97+.03*fibre;
   mark=inkLine(vUv.x,.018)*.58+inkLine(vUv.x-1.0,.018)*.58;
   mark+=inkLine(vUv.x-.5,.005)*.12;
   vec2 seed=(vUv-vec2(.5,.39))*vec2(10.0,8.5);
   float centre=exp(-dot(seed,seed));
   float transmitted=exp(-dot(seed*.40,seed*.40))*(1.0-fold*.7);
   glow=(.09+.91*uLanternDusk)*(.012+transmitted*.20+centre*2.6);
   light=max(light,.43);
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
   base=mix(linearColor(vec3(.42,.50,.64)),linearColor(vec3(.61,.62,.71)),vVariation*.75);
   vec2 plane=abs(vModelNormal.x)>abs(vModelNormal.z)?vLocal.zy:vLocal.xy;
   mark=stoneJoint(plane*vec2(.62,.35))*.59;
   float seams=fract(vLocal.y*.38+vLocal.x*.06+vLocal.z*.05)-.5;
   mark+=inkLine(seams,.004)*.11;
   base*=.92+.12*gnoise(vLocal*vec3(.8,.19,.8),120u);
   // Ink-like erosion strokes break the broad faces without turning rock into blobs.
   float scratch=inkLine(fract(plane.x*7.0+floor(plane.y*2.0)*.27)-.5,.008);
   mark+=scratch*step(.74,stoneHash(floor(plane.y*2.0)+floor(plane.x*7.0)*3.7))*.18;
 }else{
   base=linearColor(vec3(.19,.31,.35));
   base*=.88+.22*smoothstep(-.3,.3,gnoise(vLocal*2.1,77u));
   mark=inkLine(gnoise(vLocal*1.9,78u),.008)*.18;
 }
 vec3 view=normalize(cameraPosition-vWorld);
 float silhouette=(1.0-smoothstep(.015,.16,abs(dot(warpNormal(vPlanet,n),view))))*.42;
 base*=1.0-min(mark+silhouette,0.65);
 vec3 col=tone3(base*1.04,base*0.92,base*vec3(0.53,0.59,0.77),light);
 col+=vec3(1.0,.66,.25)*glow;
 gl_FragColor=vec4(applyAerial(col,distance(cameraPosition,vWorld),dir),1.0);
}
