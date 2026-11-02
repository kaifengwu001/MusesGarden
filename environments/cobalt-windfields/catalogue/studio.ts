/** Catalogue-only studio. Actual authored geometry and material fragments,
 * isolated from the planet with fixed light, no aerial fog or post effects.
 * It does not import or change the playable world. */
import {
  Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, PerspectiveCamera, Scene,
  ShaderMaterial, SRGBColorSpace, Vector3, Vector4, WebGLRenderer,
} from 'three';
import { registerShaderChunks } from '../render/glsl';
import { Palette } from '../render/palette';
import { makeGeologyPrototypes } from '../life/windGeology';
import { coralGeometry, driftingSeedGeometry, seedSailGeometry } from '../life/windGeometry';
import { distantCoralGeometry } from '../life/windfieldCoralLod';
import { shelterGeometry } from '../life/props';
import { wildlifeGeometry, wildlifeHabitatGeometry } from '../life/wildlifeGeometry';
import { buildNativeFindMesh, nativeBedGeometry, NATIVE_FIND_SPECIES } from '../life/nativeFindFlora';
import type { Form } from '../life/collectibleForms';
import sceneryFragment from '../life/windfieldScenery.frag.glsl?raw';
import shelterFragment from '../life/props.frag.glsl?raw';
import wildlifeFragment from '../life/wildWildlife.frag.glsl?raw';

registerShaderChunks();
const palette = new Palette();
const renderer = new WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.setClearColor(new Color('#f5f1e7'));
document.body.prepend(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, .001, 10000);
const vertexShader = `
attribute float aKind;
attribute float aT;
varying vec3 vWorld;
varying vec3 vPlanet;
varying vec3 vPlanetNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec2 vUv;
varying float vKind;
varying float vVariation;
varying float vCoralLod;
varying float vPresence;
varying float vT;
void main(){
  vec4 p=modelMatrix*vec4(position,1.);
  vWorld=p.xyz; vPlanet=p.xyz+vec3(0.,128.,0.);
  vPlanetNormal=normalize(mat3(modelMatrix)*normal);
  vLocal=position;vLocalNormal=normal;vUv=uv;vKind=aKind;
  vVariation=.42;vCoralLod=0.;vPresence=1.;
  vT=aT;
  gl_Position=projectionMatrix*viewMatrix*p;
}`;
function material(source: string): ShaderMaterial {
  // Keep the production mineral, vein, cloth and toon formulas. The studio
  // has one fixed sun and no scene cloud-shadow textures or distance haze.
  const fragmentShader = source.replace('#include <meadow_clouds>', `
    vec3 localSun(vec3 d){return normalize(vec3(.65,.90,.50));}
    float cloudShadowAt(vec3 p,float h){return 0.;}
  `).replace(/}\s*$/, '\n#include <colorspace_fragment>\n}');
  return new ShaderMaterial({
    vertexShader, fragmentShader, side:DoubleSide, toneMapped:false,
    uniforms:{
      uPalette:{value:palette.texture}, uRadius:{value:128},
      uSunDir:{value:new Vector3(.65,.9,.5).normalize()},
      uSunTint:{value:new Color(1,1,1)},uShadeTint:{value:new Color(1,1,1)},
      uToon:{value:new Vector4(3,.08,.6,0)},uFog:{value:new Vector4(0,0,0,0)},
      uFogUp:{value:new Vector3(0,1,0)},uWarpFocus:{value:new Vector3()},
      uWarpUp:{value:new Vector3(0,1,0)},uWarpK:{value:0},uWildOutline:{value:0},
    },
  });
}
// Native find materials shade PART codes directly. Scenery's vein shader is
// inappropriate here: finds deliberately have no UVs and a different ABI.
// These palette branches mirror nativeFindForm.vert.glsl, without interaction
// glow, cloud/house shadows, wind or growth (fully mature studio samples).
const nativeFragment=`
#include <meadow_common>
#include <meadow_toon>
varying vec3 vWorld;
varying vec3 vPlanetNormal;
varying float vKind;
varying float vT;
void main(){
 vec3 n=normalize(vPlanetNormal);if(!gl_FrontFacing)n=-n;
 vec3 sun=normalize(vec3(.65,.90,.50));
 bool stone=vKind>4.5;
 float ndl=stone?dot(n,sun):mix(dot(vec3(0.,1.,0.),sun),abs(dot(n,sun)),.25);
 float b=toonLight(ndl)*mix(stone?.75:.55,1.,vT);
 vec3 col;
 if(vKind<.5)col=tone3(pal(ROW_PINK,4),pal(ROW_PINK,4),pal(ROW_PINK,5),b);
 else if(vKind<1.5)col=tone3(pal(ROW_STAR,0),pal(ROW_STAR,4),pal(ROW_STAR,1),b);
 else if(stone)col=tone3(pal(ROW_ROCK,2),pal(ROW_ROCK,0),pal(ROW_ROCK,1),b);
 else col=tone3(pal(ROW_PINK,0),pal(ROW_PINK,1),pal(ROW_PINK,3),b);
 if(!stone)col+=pal(ROW_LIGHT,3)*vT*clamp(dot(-normalize(cameraPosition-vWorld),sun)*.7+.3,0.,1.)*.12*uToon.z;
 gl_FragColor=vec4(col,1.);
}`;
const materials={scenery:material(sceneryFragment),shelter:material(shelterFragment),wildlife:material(wildlifeFragment),native:material(nativeFragment)};
const outlineMaterial=new LineBasicMaterial({color:'#233f5b',transparent:true,opacity:.7});
type Entry={id:string;name:string;category:string;geometry:BufferGeometry;material:keyof typeof materials;outline?:BufferGeometry;source:string};
const entries:Entry[]=[];
for(const [index,p] of makeGeologyPrototypes().entries())entries.push({id:`rock-${index}`,name:p.name,category:'Geology',geometry:p.geometry,outline:p.outline,material:'scenery',source:'life/windGeology.ts: makeGeologyPrototypes'});
for(let i=0;i<3;i++)entries.push({id:`sail-${i}`,name:['Seed sail / paired','Seed sail / branching','Seed sail / broad'][i],category:'Flora',geometry:seedSailGeometry(i),material:'scenery',source:`life/windGeometry.ts: seedSailGeometry(${i})`});
for(let i=0;i<3;i++)entries.push({id:`coral-${i}`,name:`Coral fan / variant ${i+1}`,category:'Flora',geometry:coralGeometry(i),material:'scenery',source:`life/windGeometry.ts: coralGeometry(${i})`});
entries.push({id:'coral-distant',name:'Coral / distant render mesh',category:'Level of detail',geometry:distantCoralGeometry(),material:'scenery',source:'life/windfieldCoralLod.ts: distantCoralGeometry; distant representation, not a separate species'});
entries.push({id:'drifting-seed',name:'Drifting ivory seed',category:'Flora',geometry:driftingSeedGeometry(),material:'scenery',source:'life/windGeometry.ts: driftingSeedGeometry'});
entries.push({id:'shelter',name:'Slate shelter and canvas porch',category:'Architecture',geometry:shelterGeometry(412),material:'shelter',source:'life/props.ts: shelterGeometry(412)'});
for(const species of ['sailback','kitelet','sand-stitcher'] as const)entries.push({id:species,name:species==='sand-stitcher'?'Sand Stitcher':species==='sailback'?'Sailback':'Kitelet',category:'Wildlife',geometry:wildlifeGeometry(species),material:'wildlife',source:`life/wildlifeGeometry.ts: wildlifeGeometry('${species}')`});
for(let i=0;i<3;i++)entries.push({id:`perch-${i}`,name:`Kitelet perch / variant ${i+1}`,category:'Habitat',geometry:wildlifeHabitatGeometry('kitelet',i),material:'wildlife',source:`life/wildlifeGeometry.ts: wildlifeHabitatGeometry('kitelet',${i})`});
entries.push({id:'litter-pocket',name:'Sand Stitcher litter pocket',category:'Habitat',geometry:wildlifeHabitatGeometry('sand-stitcher'),material:'wildlife',source:"life/wildlifeGeometry.ts: wildlifeHabitatGeometry('sand-stitcher')"});
for(let i=0;i<4;i++){
  const bed=nativeBedGeometry(i), geometry=new BufferGeometry();
  geometry.setAttribute('position',bed.getAttribute('position').clone());
  geometry.setAttribute('normal',bed.getAttribute('normal').clone());
  geometry.setIndex(bed.getIndex()!.clone());
  const part=bed.getAttribute('aPart');
  geometry.setAttribute('aKind',part.clone());
  geometry.setAttribute('aT',bed.getAttribute('aT').clone());
  geometry.setAttribute('uv',new Float32BufferAttribute(new Float32Array(part.count*2),2));
  const speciesScale=[1,1,.84,.78][i];geometry.scale(speciesScale,speciesScale,speciesScale);
  bed.dispose();
  entries.push({id:`find-bed-${i}`,name:`Find bed / ${NATIVE_FIND_SPECIES[i]}`,category:'Saved finds',geometry,material:'native',source:`life/nativeFindFlora.ts: nativeBedGeometry(${i}); findBeds species size ${speciesScale}; native palette branches`});
}
for(const [index,name] of ['coral','sail','stone'].entries()){
  const form:Form={family:index===2?'stone':'bloom',height:index===2?.5:.8,yaw:0,lean:0,kin:index===1?1:0,self:412,open:true,colour:{row:index===2?8:3,lit:0,mid:1,shade:3}};
  const data=buildNativeFindMesh([form]),geometry=new BufferGeometry();
  const count=data.position.length/3,normals=new Float32Array(count*3),kind=new Float32Array(count),t=new Float32Array(count);
  for(let j=0;j<count;j++){
    for(let k=0;k<3;k++)normals[j*3+k]=data.normal[j*4+k]/127;
    kind[j]=Math.floor(data.shape[j*2]/4096);t[j]=(data.shape[j*2]%4096)/4095;
  }
  geometry.setAttribute('position',new Float32BufferAttribute(data.position,3));
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
  geometry.setAttribute('aKind',new Float32BufferAttribute(kind,1));
  geometry.setAttribute('aT',new Float32BufferAttribute(t,1));
  geometry.setAttribute('uv',new Float32BufferAttribute(new Float32Array(count*2),2));
  geometry.setIndex(Array.from(data.index));geometry.scale(1.45,1.45,1.45);
  entries.push({id:`find-${name}`,name:`Saved find / ${name==='sail'?'ivory seed sail':name==='stone'?'cobalt fragment':'coral roots'}`,category:'Saved finds',geometry,material:'native',source:`life/nativeFindFlora.ts: buildNativeFindMesh; example ${form.height}m form, kin ${form.kin}, self412, 1.45 specimen display scale; native palette branches`});
}
const groups=new Map<string,Group>();
const list=entries.map(e=>{
  e.geometry.computeBoundingBox();
  const box=e.geometry.boundingBox!,size=box.getSize(new Vector3());
  const group=new Group();
  group.add(new Mesh(e.geometry,materials[e.material]));
  if(e.outline)group.add(new LineSegments(e.outline,outlineMaterial));
  groups.set(e.id,group);
  return {id:e.id,name:e.name,category:e.category,source:e.source,dimensions:[size.x,size.y,size.z],triangles:(e.geometry.index?.count??e.geometry.getAttribute('position').count)/3};
});
let active:Group|null=null;
let activeId='rock-0',angle=35;
function render(id:string,azimuth=35):void {
  const group=groups.get(id);
  if(!group)throw new Error(`Unknown specimen: ${id}`);
  const pale=/^(sail-|perch-)/.test(id)||id==='drifting-seed'||id==='sailback'||id==='find-sail'||id==='find-bed-1'||id==='find-bed-3';
  renderer.setClearColor(new Color(pale?'#728595':'#f5f1e7'));
  if(active)scene.remove(active);
  active=group;activeId=id;angle=azimuth;scene.add(group);
  const box=new Box3().setFromObject(group),centre=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
  const radius=size.length()*.5;
  const distance=radius/Math.sin(19*Math.PI/180)*1.08;
  const a=azimuth*Math.PI/180,elevation=(id==='litter-pocket'?46:22)*Math.PI/180;
  camera.position.copy(centre).add(new Vector3(Math.sin(a)*Math.cos(elevation),Math.sin(elevation),Math.cos(a)*Math.cos(elevation)).multiplyScalar(distance));
  camera.lookAt(centre);camera.near=Math.max(.0001,distance-radius*1.5);camera.far=distance+radius*3;
  const width=window.innerWidth,height=window.innerHeight;
  renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
}
const select=document.querySelector('select')!;
for(const item of list){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.category} / ${item.name}`;select.append(option);}
select.addEventListener('change',()=>render(select.value,angle));
document.querySelector('#turn')!.addEventListener('click',()=>render(activeId,angle+90));
window.addEventListener('resize',()=>render(activeId,angle));
if(new URLSearchParams(location.search).has('capture'))document.body.classList.add('capture');
declare global {interface Window {__catalogue:{list:typeof list;render:typeof render;renderer:WebGLRenderer;note:string}}}
window.__catalogue={list,render,renderer,note:'Source geometry and production material fragments in fixed studio light; no aerial fog, live articulation, growth deformation or post-processing. Saved finds use native PART palette branches from their production vertex shading. Young beds include species scale; central finds are fixed nominal samples at production specimen scale. Each specimen is fitted independently, not at a common scale.'};
render(new URLSearchParams(location.search).get('id')??'rock-0');
