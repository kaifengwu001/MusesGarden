import referenceRender from './reference/terrace-render.png';
import referenceComparison from './reference/terrace-comparison.png';
import referenceHuiHillside from './reference/hui-hillside.jpg';
import referenceHuiWater from './reference/hui-water-village.jpg';
import './ui/rice.css';
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, ACESFilmicToneMapping } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRiceLandscape } from './planet/riceLandscape';
import { RICE_RADIUS, sampleRiceField } from './planet/riceFields';
import { createFarmLife } from './life/farmLife';
import { createHuiCottage } from './life/huiCottage';
import { cottageContains } from './planet/cottageSite';

const root=document.querySelector<HTMLDivElement>('#app') ?? document.body.appendChild(document.createElement('div'));
root.id='app';
root.innerHTML=`
  <div class="rice-heading"><span class="eyebrow">A WORLD IN MUSE’S GARDEN</span><h1>Ti Tian <span lang="zh">梯田</span></h1><p>Fields that follow the hills.</p></div>
  <div class="rice-top-actions"><button id="drift" aria-pressed="false">Slow orbit</button><button id="reference">The reference</button></div>
  <div class="rice-guide"><span class="guide-line"></span><p>Water holds the sky.<br>Rice follows the contour.</p></div>
  <div class="rice-toolbar"><div class="view-controls" aria-label="Camera views"><button id="planet" class="selected">Whole planet</button><button id="paddies">Across the paddies</button><button id="cottage">Muse’s cottage</button><button id="above">From above</button></div><span class="divider"></span><label class="growth-label">Radius <input id="radius" aria-label="Planet radius" type="range" min="64" max="220" value="128"><output id="radius-value">128 m</output></label><span class="divider"></span><button id="seed">Another landscape <span>↗</span></button></div>
  <footer class="rice-footer"><span>DRAG TO ORBIT · SCROLL TO EXPLORE</span><span id="world-stats">Growing the terraces…</span><button id="postcard">Save a postcard ↗</button></footer>
  <aside class="reference-panel" hidden><button id="close-reference" aria-label="Close reference">×</button><h2>The terrace study</h2><p>The supplied rendering guides the shape, field colours and wooded ridges of this planet.</p><img src="${referenceRender}" alt="User supplied flat terraced rice field rendering"><img src="${referenceComparison}" alt="User supplied rice terraces study and reference"><h2>A home among the fields</h2><p>White plaster, dark tiled roofs and a quiet courtyard, drawn from your Hui village references.</p><img src="${referenceHuiHillside}" alt="Supplied illustration of white-walled Hui houses above terraces"><img src="${referenceHuiWater}" alt="Supplied painting of dark-roofed white houses beside green fields and water"></aside>
  <div id="loading" class="rice-loading">Shaping the hills…</div>`;
const renderer=new WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=SRGBColorSpace;
renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFSoftShadowMap;
renderer.domElement.className='rice-canvas';
renderer.domElement.setAttribute('aria-label','Interactive spherical Chinese rice terrace landscape');
root.prepend(renderer.domElement);
const scene=new Scene();scene.background=new Color('#dce7ea');
scene.add(new HemisphereLight('#eff4f1','#6d7550',2.1),new AmbientLight('#e8ead8',0.35));
const sun=new DirectionalLight('#fff6dc',2.7);sun.position.set(-160,240,190);sun.castShadow=true;
Object.assign(sun.shadow.camera,{left:-190,right:190,top:190,bottom:-190,near:1,far:700});
sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-0.00025;sun.shadow.normalBias=0.15;scene.add(sun);
const camera=new PerspectiveCamera(35,innerWidth/innerHeight,0.2,2000);
function makeControls():OrbitControls{
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.dampingFactor=0.09;
  orbit.minDistance=18;orbit.maxDistance=1000;orbit.enablePan=true;orbit.autoRotateSpeed=0.3;return orbit;
}
let controls=makeControls();
const planet=new Group();scene.add(planet);
let landscape:ReturnType<typeof createRiceLandscape>|undefined;
let life:ReturnType<typeof createFarmLife>|undefined;
let cottage:ReturnType<typeof createHuiCottage>|undefined;
const initial=new URLSearchParams(location.hash.slice(1));
const state={seed:Number(initial.get('seed')??412),radius:Number(initial.get('radius')??128),view:initial.get('view')??'planet',time:12,frozen:true};
if(!Number.isFinite(state.seed))state.seed=412;
if(!Number.isFinite(state.radius))state.radius=128;
state.radius=Math.max(64,Math.min(220,state.radius));
let ready=false;
const get=<T extends HTMLElement>(selector:string):T=>root.querySelector<T>(selector)!;
function saveState():void{history.replaceState(null,'',`#seed=${state.seed}&radius=${state.radius}&view=${state.view}`);}
function applyRadius():void{
  planet.scale.setScalar(state.radius/RICE_RADIUS);
  get<HTMLInputElement>('#radius').value=String(state.radius);
  get<HTMLOutputElement>('#radius-value').value=`${Math.round(state.radius)} m`;
}
function view(name:string):void{
  state.view=name;controls.autoRotate=false;get('#drift').setAttribute('aria-pressed','false');camera.up.set(0,1,0);
  const scale=state.radius/RICE_RADIUS;
  const fitDistance=665*scale/Math.min(1,camera.aspect);
  if(name==='cottage'&&cottage){
    const {site}=cottage;
    camera.up.copy(site.direction);
    const at=site.direction.clone().multiplyScalar(site.floorRadius+2.4).addScaledVector(site.forward,1.1).multiplyScalar(scale);
    const distanceScale=scale/Math.min(1,camera.aspect);
    controls.target.copy(at);camera.position.copy(at).addScaledVector(site.right,23*distanceScale).addScaledVector(site.direction,18*distanceScale).addScaledVector(site.forward,32*distanceScale);
  }else if(name==='paddies'){
    const preferred=new Vector3(0.32,0.76,0.56).normalize();
    let direction=preferred.clone(),best=-Infinity;
    for(let i=0;i<240;i++){
      const y=1-2*(i+0.5)/240,a=i*2.3999632297;
      const candidate=new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
      if(sampleRiceField(candidate,state.seed).forest&&candidate.dot(preferred)>best){best=candidate.dot(preferred);direction=candidate;}
    }
    camera.up.copy(direction);
    const height=sampleRiceField(direction,state.seed).surfaceHeight;
    const at=direction.clone().multiplyScalar((RICE_RADIUS+height)*scale);
    const tangent=new Vector3(1,0,-0.3).addScaledVector(direction,-direction.dot(new Vector3(1,0,-0.3))).normalize();
    controls.target.copy(at);camera.position.copy(at).addScaledVector(direction,95*scale).addScaledVector(tangent,145*scale);
  }else if(name==='above'){
    controls.target.set(0,0,0);camera.up.set(0,0,-1);camera.position.set(0,fitDistance,0.01);
  }else{
    state.view='planet';controls.target.set(0,0,0);camera.position.set(280,220,405).normalize().multiplyScalar(fitDistance);
  }
  const target=controls.target.clone();controls.dispose();controls=makeControls();controls.target.copy(target);controls.update();
  for(const id of ['planet','paddies','cottage','above'])get('#'+id).classList.toggle('selected',state.view===id);
  root.dataset.view=state.view;saveState();
}
function render():void{camera.updateMatrixWorld();renderer.render(scene,camera);}
function regenerate():void{
  ready=false;get('#loading').hidden=false;
  if(landscape){planet.remove(landscape.group);landscape.dispose();}
  if(life){planet.remove(life.group);life.dispose();}
  if(cottage){planet.remove(cottage.group);cottage.dispose();}
  cottage=createHuiCottage(state.seed);landscape=createRiceLandscape(state.seed,96,cottage.site);
  const homeSite=cottage.site;
  life=createFarmLife(state.seed,(direction,margin)=>cottageContains(homeSite,direction,margin),homeSite);
  planet.add(landscape.group,life.group,cottage.group);applyRadius();view(state.view);
  get('#world-stats').textContent=`SEED ${state.seed} · ${landscape.stats.terraceLevels} LEVELS · ${life.stats.trees} TREES`;
  ready=true;get('#loading').hidden=true;render();
}
for(const name of ['planet','paddies','cottage','above'])get('#'+name).addEventListener('click',()=>view(name));
get<HTMLInputElement>('#radius').addEventListener('input',event=>{
  const oldRadius=state.radius;state.radius=Number((event.target as HTMLInputElement).value);
  camera.position.multiplyScalar(state.radius/oldRadius);controls.target.multiplyScalar(state.radius/oldRadius);applyRadius();saveState();
});
get('#seed').addEventListener('click',()=>{state.seed=(state.seed+137)%100000;regenerate();});
get('#drift').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;get('#drift').setAttribute('aria-pressed',String(controls.autoRotate));});
get('#reference').addEventListener('click',()=>{get('.reference-panel').hidden=false;});
get('#close-reference').addEventListener('click',()=>{get('.reference-panel').hidden=true;});
get('#postcard').addEventListener('click',()=>{render();const link=document.createElement('a');link.download=`ti-tian-seed-${state.seed}.png`;link.href=renderer.domElement.toDataURL('image/png');link.click();});
window.addEventListener('resize',()=>{
  const previousFit=1/Math.min(1,camera.aspect);camera.aspect=innerWidth/innerHeight;
  const nextFit=1/Math.min(1,camera.aspect);
  camera.position.sub(controls.target).multiplyScalar(nextFit/previousFit).add(controls.target);
  camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);controls.update();render();
});
function frameHash():string{
  render();const gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  const bytes=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  let hash=0x811c9dc5;for(const value of bytes){hash^=value;hash=Math.imul(hash,0x01000193);}
  return `${(hash>>>0).toString(16)}:${w}x${h}`;
}
const harness={
  get isReady(){return ready;},version:'rice-terraces-v1',
  settle:async()=>{controls.update();render();await Promise.resolve();},renderFrame:render,frameHash,
  getHash:()=>`seed=${state.seed}&radius=${state.radius}&view=${state.view}`,
  setHash:(hash:string)=>{
    const params=new URLSearchParams(hash.replace(/^#/,''));const seed=Number(params.get('seed')??state.seed);
    const radius=Number(params.get('radius')??state.radius);
    if(Number.isFinite(radius))state.radius=Math.max(64,Math.min(220,radius));
    if(params.has('view'))state.view=params.get('view')!;
    if(Number.isFinite(seed)&&seed!==state.seed){state.seed=seed;regenerate();}else{applyRadius();view(state.view);}
  },
  freeze:(time:number)=>{state.time=time;state.frozen=true;controls.autoRotate=false;},
  set:(key:string,value:number|string|boolean)=>{
    if(key==='world.seed'){state.seed=Number(value);regenerate();}
    else if(key==='world.radius'){state.radius=Math.max(64,Math.min(220,Number(value)));applyRadius();view(state.view);}
    else if(key==='view')view(String(value));
  },
  stats:()=>({radius:state.radius,seed:state.seed,width:renderer.domElement.width,height:renderer.domElement.height,pixelRatio:renderer.getPixelRatio(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,terrain:landscape?.stats,life:life?.stats,cottage:cottage?.stats}),
};
Reflect.set(window,'__meadow',harness);
Reflect.set(window,'__world',{planet,camera,get controls(){return controls;},harness,get landscape(){return landscape;},get life(){return life;},get cottage(){return cottage;}});
requestAnimationFrame(()=>{regenerate();renderer.setAnimationLoop(()=>{controls.update();render();});});
