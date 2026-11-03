import { Color, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import type { Terrain } from '../planet/terrain';
import { TULIP_COLOURS, cottageGeometry, tulipGeometry, windmillGeometry, windmillSailsGeometry } from './tulipGeometry';
import { farmGround, farmSites, farmMatrix, type FarmSite } from './farmLayout';
import { fieldCell, fieldCoordinates } from './fieldGrid';
import { DenseTulips } from './denseTulips';
import tulipVertex from './tulipScenery.vert.glsl?raw';
import millVertex from './windmill.vert.glsl?raw';
import fragment from './tulipScenery.frag.glsl?raw';

export interface TulipSite { direction:Vector3; scale:number; colour:number; turn:number; }

export function millSites(terrain:Pick<Terrain,'layout'|'radius'>):{direction:Vector3;scale:number}[]{
  return farmSites(terrain.layout,terrain.radius).filter(s=>s.kind==='mill');
}

/** Seeded cultivated ribbons with soil paths between them and a clear home. */
export function tulipSites(terrain:Pick<Terrain,'layout'|'radius'>):TulipSite[]{
  let state=hash32(terrain.layout.seed^0x74756c69);
  const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
  const home=terrain.layout.cottage;
  const farms=farmSites(terrain.layout,terrain.radius);
  const sites:TulipSite[]=[];
  // Low-detail flowers cover the whole globe. DenseTulips supplies the close
  // lattice everywhere, replacing the former home-only detailed rectangle.
  const count=88000;
  for(let i=0;i<count;i++){
    const y=2*rand()-1,a=rand()*Math.PI*2;
    const d=new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
    const cell=fieldCell(...fieldCoordinates(d,terrain.layout));
    if(cell.fallow&&d.dot(home)<Math.cos(0.55))continue;
    if(farms.some(m=>farmGround(d,m,terrain.radius,terrain.layout)!==null))continue;
    if(cell.runEnd&&cell.along>0.975)continue;
    if(cell.rowGap&&cell.across>0.94)continue;
    sites.push({direction:d,scale:0.85+rand()*0.5,colour:cell.colour,turn:rand()*Math.PI*2});
  }
  return sites;
}

export class TulipScenery {
  readonly group=new Group();
  private readonly time={value:0};
  private readonly bloom={value:1};
  private readonly wind={value:0.45};
  private readonly flowerMaterial:ShaderMaterial;
  private readonly millMaterial:ShaderMaterial;
  private flowers:Mesh<InstancedBufferGeometry,ShaderMaterial>|null=null;
  private farms:{root:Group;rotor:Mesh|null;site:FarmSite;phase:number}[]=[];
  private seed=NaN;
  private radius=NaN;
  private sites:TulipSite[]=[];
  private readonly millGeometry=windmillGeometry();
  private readonly sailGeometry=windmillSailsGeometry();
  private readonly cottages=[0,1,2].map(cottageGeometry);
  private readonly dense:DenseTulips;

  constructor(shared:Record<string,IUniform>){
    this.flowerMaterial=new ShaderMaterial({name:'Tulip petals and leaves',vertexShader:tulipVertex,fragmentShader:fragment,uniforms:{...shared,uTulipTime:this.time,uTulipBloom:this.bloom,uTulipWind:this.wind},side:DoubleSide});
    this.millMaterial=new ShaderMaterial({name:'Windmill plaster, timber and tile',vertexShader:millVertex,fragmentShader:fragment,uniforms:shared,side:DoubleSide});
    this.group.name='Tulip ribbons and turning Dutch windmills';
    this.dense=new DenseTulips(shared,this.time,this.bloom,this.wind);this.group.add(this.dense.mesh);
  }

  update(time:number,terrain:Terrain,bloom:number,wind:number,focus:Vector3,forward:Vector3,altitude:number):void{
    this.time.value=time;this.bloom.value=bloom;this.wind.value=wind;
    const changedSeed=this.seed!==terrain.layout.seed;
    if(changedSeed){
      this.seed=terrain.layout.seed;
      if(this.flowers){this.group.remove(this.flowers);this.flowers.geometry.dispose();}
      const sites=tulipSites({layout:terrain.layout,radius:128}),source=tulipGeometry(false),g=new InstancedBufferGeometry();
      this.sites=sites;
      g.copy(source as InstancedBufferGeometry);source.dispose();
      const anchors=new Float32Array(sites.length*4),tints=new Float32Array(sites.length*4);
      for(const [i,s] of sites.entries()){
        anchors.set([s.direction.x,s.direction.y,s.direction.z,s.scale],i*4);
        const c=new Color(TULIP_COLOURS[s.colour]);tints.set([c.r,c.g,c.b,s.turn],i*4);
      }
      g.setAttribute('aPlant',new InstancedBufferAttribute(anchors,4));g.setAttribute('aTint',new InstancedBufferAttribute(tints,4));g.instanceCount=sites.length;
      this.flowers=new Mesh(g,this.flowerMaterial);this.flowers.frustumCulled=false;this.flowers.name='Six-colour tulip fields';this.group.add(this.flowers);
      for(const m of this.farms)this.group.remove(m.root);this.farms=[];
      for(const [i,site] of terrain.farms.entries()){
        const root=new Group(),body=new Mesh(site.kind==='mill'?this.millGeometry:this.cottages[site.variant],this.millMaterial);
        root.name=site.kind==='mill'?'Row-aligned windmill farm':'Cottage '+['blue gable','sage porch','rose side bay'][site.variant];
        body.frustumCulled=false;root.add(body);
        const rotor=site.kind==='mill'?new Mesh(this.sailGeometry,this.millMaterial):null;
        if(rotor){rotor.frustumCulled=false;rotor.position.set(-2.4,8.8,0.5);root.add(rotor);}
        this.group.add(root);this.farms.push({root,rotor,site,phase:i*0.47});
      }
    }
    if(changedSeed||this.radius!==terrain.radius){
      this.radius=terrain.radius;
      const farms=terrain.farms,dir=new Vector3();
      const data=this.flowers!.geometry.getAttribute('aPlant') as InstancedBufferAttribute;
      for(const [i,s] of this.sites.entries()){
        dir.copy(s.direction);
        let scale=s.scale;
        for(const m of farms)if(farmGround(dir,m,this.radius,terrain.layout)!==null){scale=0;break;}
        data.setXYZW(i,dir.x,dir.y,dir.z,scale);
      }
      data.needsUpdate=true;
      for(const [i,m] of this.farms.entries()){
        m.site=farms[i];const site=m.site;
        m.root.quaternion.setFromRotationMatrix(farmMatrix(site));m.root.scale.setScalar(site.scale);
        // A rigid building floor rests above its highest wall corner. The
        // bottom ring conforms in the shader, avoiding unsupported plinths.
        let floor=terrain.height(site.direction);
        for(const x of [-4.5,4])for(const z of [-3.6,3.6]){
          const d=site.direction.clone().addScaledVector(site.across,x*site.scale/this.radius).addScaledVector(site.along,z*site.scale/this.radius).normalize();
          floor=Math.max(floor,(this.radius+terrain.height(d))*d.dot(site.direction)-this.radius);
        }
        m.root.position.copy(site.direction).multiplyScalar(this.radius+floor+0.025);
      }
    }
    for(const m of this.farms)if(m.rotor)m.rotor.rotation.z=time*(0.055+wind*0.22)+m.phase+0.15;
    this.dense.update(terrain,focus,forward,altitude);
  }

  dispose():void{
    this.dense.dispose();this.flowers?.geometry.dispose();this.millGeometry.dispose();this.sailGeometry.dispose();for(const g of this.cottages)g.dispose();this.flowerMaterial.dispose();this.millMaterial.dispose();this.group.clear();
  }
}
