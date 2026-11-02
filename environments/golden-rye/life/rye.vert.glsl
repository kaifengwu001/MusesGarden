#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
uniform float uRadius;
uniform float uRyeTime;
uniform float uRyeRipeness;
uniform vec4 uUserBloom[8];
uniform vec4 uWindVec;
uniform vec4 uRyeDetail;
uniform vec2 uRyeDetailRange;
attribute vec4 aRyeAnchor;
attribute vec3 aRyeAcross;
attribute vec4 aRyePlant;
attribute vec2 aRyeSlope;
attribute vec2 aRyeRoot;
attribute float aPart;
attribute float aAlong;
centroid varying vec3 vColour;

vec3 linearRye(vec3 c){return pow(c,vec3(2.2));}
void main(){
  vec3 U=normalize(aRyeAnchor.xyz),X=normalize(aRyeAcross),Z=normalize(cross(X,U));
  float h=aAlong;
  float focusDistance=acos(clamp(dot(U,normalize(uRyeDetail.xyz)),-1.0,1.0))*uRadius;
  float detailed=(1.0-smoothstep(uRyeDetailRange.x,uRyeDetailRange.y,focusDistance))*uRyeDetail.w;
  float presence=aRyePlant.w<0.0?1.0-detailed:detailed;
  if(presence<.001){gl_Position=vec4(0.0,0.0,-2.0,1.0);vColour=vec3(0.0);return;}
  vec3 p=position*aRyePlant.x;
  p.xz*=abs(aRyePlant.w);
  // Keep full standing height and fixed stalk feet across the LOD blend.
  // Narrow each silhouette around its own root; shrinking both layers in Y
  // would create a conspicuous circular trough of half-height crop.
  vec2 root=aRyeRoot*aRyePlant.x*abs(aRyePlant.w);
  p.xz=root+(p.xz-root)*presence;
  p.y+=dot(p.xz,aRyeSlope);
  vec3 wind=cross(uWindVec.xyz,U);
  vec2 windLocal=vec2(dot(wind,X),dot(wind,Z));
  float stream=sin(dot(U,vec3(23.0,11.0,-17.0))-uRyeTime*.8);
  float ripple=sin(uRyeTime*1.45+aRyePlant.y+dot(U,vec3(171.0,93.0,149.0)));
  float bend=(.18+.19*stream+.065*ripple)*uWindVec.w*presence;
  p.xz+=windLocal*bend*h*h*aRyePlant.x;
  p.y-=abs(bend)*.10*h*h*aRyePlant.x;
  float d=length(p.xz),angle=asin(min(.9,d/uRadius));
  vec3 tangent=d>1e-6?(X*p.x+Z*p.z)/d:X;
  vec3 up=U*cos(angle)+tangent*sin(angle);
  vec3 planet=up*(uRadius+aRyeAnchor.w+p.y);
  vec3 world=warpPosition(planet);
  vec3 localNormal=vec3(normal.x/abs(aRyePlant.w),normal.y,normal.z/abs(aRyePlant.w));
  localNormal.xz-=localNormal.y*aRyeSlope;
  localNormal=normalize(localNormal);
  vec3 n=normalize(X*localNormal.x+U*localNormal.y+Z*localNormal.z);
  // The two thin kernel faces must keep a genuine shaded side. A large
  // up-facing ambient floor previously made every grain equally luminous.
  float direct=max(0.0,dot(n,uSunDir));
  float light=clamp(.15+.68*direct+.10*max(0.0,dot(U,uSunDir)),.12,.91);
  float tone=aRyePlant.z;
  vec3 gold=mix(linearRye(vec3(.72,.43,.105)),linearRye(vec3(.91,.66,.23)),tone);
  vec3 cream=linearRye(vec3(.96,.87,.58));
  vec3 olive=linearRye(vec3(.31,.31,.105));
  vec3 lit=mix(gold,cream,.10+.18*h);
  vec3 mid=mix(olive,gold,.38+.44*h);
  vec3 shade=mix(olive,linearRye(vec3(.52,.35,.12)),h*.56);
  if(aPart>.5&&aPart<1.5){
    lit=mix(gold,cream,.34);
    mid=mix(linearRye(vec3(.63,.40,.13)),gold,.47);
    shade=linearRye(vec3(.38,.30,.105));
  }
  if(aPart>1.5&&aPart<2.5){
    // Fine awns are straw marks, not a white luminous wireframe over the crop.
    lit=mix(gold,cream,.48);mid=linearRye(vec3(.65,.52,.26));
    shade=linearRye(vec3(.39,.36,.16));light=max(light,.36);
  }
  if(aPart>2.5){lit=mix(gold,cream,.08);mid=mix(olive,gold,.42);}
  // Only selected sunward grains catch a pale stroke. The broad, coherent
  // troughs remain ochre/olive, so the field has directional paint masses.
  float sheen=step(.83,tone)*smoothstep(.45,.95,stream)*.14*h;
  vec3 col=mix(tone3(lit,mid,shade,light),cream,sheen);
  float trough=smoothstep(.1,.9,-stream);
  col*=mix(vec3(.96),vec3(.75,.79,.63),trough*(.28+.24*(1.0-h)));
  col*=.91+.08*sin(aRyePlant.y*3.0+h*8.0);
  float ripeness=uRyeRipeness;
  for(int i=0;i<8;i++){vec4 disc=uUserBloom[i];if(disc.w>0.0)ripeness=max(ripeness,1.0-smoothstep(disc.w*.7,disc.w,2.0*asin(clamp(length(U-disc.xyz)*0.5,0.0,1.0))));}
  col=mix(mix(linearRye(vec3(.28,.34,.10)),linearRye(vec3(.66,.67,.27)),h*.65),col,smoothstep(0.0,1.0,ripeness));
  vColour=applyAerial(col,length(cameraPosition-world),up);
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
}
