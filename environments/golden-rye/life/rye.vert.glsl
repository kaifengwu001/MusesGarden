#include <meadow_common>
#include <meadow_warp>
#include <meadow_toon>
#include <meadow_fog>
#include <rye_crop>
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
  // Ears stand only in standing crop, as tall as their field's (crop.glsl):
  // none on the bunds, the road, the yards or reaped stubble.
  vec4 parcel=parcelAt(U);
  float cropH=cropHeight(parcel);
  if(presence<.001||cropH<.4){gl_Position=vec4(0.0,0.0,-2.0,1.0);vColour=vec3(0.0);return;}
  // the ear's crest just over the canopy's tallest stalks (stalk tip at 1.37 m in the template)
  vec3 p=position*aRyePlant.x*(cropH*1.06/1.37);
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
  // Light the ears as part of the crop's mass: their normals lean toward the
  // field's up, and the deep stems sit in the crop's own shadow.
  n=normalize(mix(dot(n,cameraPosition-world)<0.0?-n:n,U,0.45));
  float direct=max(0.0,dot(n,uSunDir));
  float light=clamp(.12+.78*direct,.1,.95)*mix(.55,1.0,smoothstep(.15,.85,h));
  float tone=aRyePlant.z;
  vec3 top=cropTop(parcel.y,parcel.w);
  vec3 deep=cropDeep(top);
  vec3 cream=linearRye(vec3(1.0,.94,.70));
  vec3 lit=mix(top,cream,.06+.12*h);
  vec3 mid=mix(deep,top,.35+.5*h);
  vec3 shade=mix(deep,top*.6,h*.5);
  if(aPart>.5&&aPart<1.5){
    // kernels: the ear itself, its field's yellow, a few paler
    lit=mix(top,cream,.22+.3*step(.7,tone));
    mid=mix(deep,top,.72);
    shade=mix(deep,top,.3);
  }
  if(aPart>1.5&&aPart<2.5){
    lit=mix(top,cream,.45);mid=mix(deep,top,.6);
    shade=mix(deep,top,.25);light=max(light,.36);
  }
  if(aPart>2.5){lit=mix(top,cream,.04);mid=mix(deep,top,.45);}
  vec3 col=tone3(lit,mid,shade,light);
  col*=.92+.08*sin(aRyePlant.y*3.0+h*8.0);
  float ripeness=uRyeRipeness;
  for(int i=0;i<8;i++){vec4 disc=uUserBloom[i];if(disc.w>0.0)ripeness=max(ripeness,1.0-smoothstep(disc.w*.7,disc.w,2.0*asin(clamp(length(U-disc.xyz)*0.5,0.0,1.0))));}
  col=mix(cropUnripe(h*.65),col,smoothstep(0.0,1.0,ripeness));
  vColour=applyAerial(col,length(cameraPosition-world),up);
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
}
