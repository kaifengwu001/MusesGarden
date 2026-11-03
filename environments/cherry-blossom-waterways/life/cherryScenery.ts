import { AdditiveBlending, BufferAttribute, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, type Vector3, type IUniform } from 'three';
import { makeCherryGeometry } from './cherryGeometry';
import { cherrySites, MAX_TREES, type CherrySite } from './cherryDistribution';
import type { Terrain } from '../planet/terrain';
import vertexShader from './cherry.vert.glsl?raw';
import fragmentShader from './cherry.frag.glsl?raw';
import shadowVertex from './cherryShadow.vert.glsl?raw';
import shadowFragment from './cherryShadow.frag.glsl?raw';

const CAPACITY = MAX_TREES;
interface Batch { mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; anchor: InstancedBufferAttribute; style: InstancedBufferAttribute; }

/** Meter-sized tree anatomy placed at verified dry roots; camera changes only detail. */
export class CherryScenery {
  readonly group = new Group();
  readonly shadowMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  sites: CherrySite[] = [];
  private key = '';
  private batches: Batch[] = [];
  private shadowAnchors = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private shadowStyles = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  constructor(shared: Record<string, IUniform>) {
    const material = new ShaderMaterial({ name: 'Cherry blossom pigment', vertexShader, fragmentShader, uniforms: shared, side: DoubleSide });
    for (let detail = 0; detail < 2; detail++) for (let variant = 0; variant < 4; variant++) {
      const source = makeCherryGeometry(variant, detail === 0 ? 'full' : 'far');
      const geometry = new InstancedBufferGeometry();
      for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
      const anchor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
      const style = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
      geometry.setAttribute('aAnchor', anchor); geometry.setAttribute('aStyle', style); geometry.instanceCount = 0;
      const mesh = new Mesh(geometry, material);
      mesh.name = `${detail ? 'Distant' : 'Detailed'} ${['spreading cherry','weeping cherry','young cherry','willow'][variant]}`;
      mesh.frustumCulled = false;
      this.group.add(mesh); this.batches.push({mesh,anchor,style});
    }
    const sg = new InstancedBufferGeometry();
    sg.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]),3));
    sg.setIndex([0,1,2,0,2,3]); sg.setAttribute('aAnchor',this.shadowAnchors); sg.setAttribute('aStyle',this.shadowStyles); sg.instanceCount=0;
    this.shadowMesh = new Mesh(sg, new ShaderMaterial({name:'Blossom canopy shadows',vertexShader:shadowVertex,fragmentShader:shadowFragment,uniforms:shared,side:DoubleSide,blending:AdditiveBlending,transparent:true,depthTest:false,depthWrite:false}));
    this.shadowMesh.frustumCulled=false;
  }
  update(terrain: Terrain, focus: Vector3, altitude: number, fieldKey: string): void {
    const key = `${terrain.layout.seed}/${terrain.radius}/${fieldKey}`;
    if (key !== this.key) {
      this.key=key; this.sites=cherrySites(terrain);
      for(let i=0;i<this.sites.length;i++) {
        const s=this.sites[i]; this.shadowAnchors.setXYZW(i,s.dir.x,s.dir.y,s.dir.z,s.height);
        this.shadowStyles.setXYZW(i,s.scale,s.turn,s.id/6400,s.variant);
      }
      this.shadowMesh.geometry.instanceCount=this.sites.length;
      this.shadowAnchors.needsUpdate=true; this.shadowStyles.needsUpdate=true;
    }
    const counts=new Array<number>(8).fill(0);
    for(const s of this.sites) {
      const near=altitude<70 && s.dir.distanceToSquared(focus)*terrain.radius**2<65**2;
      const index=s.variant+(near?0:4), i=counts[index]++, b=this.batches[index];
      b.anchor.setXYZW(i,s.dir.x,s.dir.y,s.dir.z,s.height);
      b.style.setXYZW(i,s.scale,s.turn,s.id/6400,s.variant);
    }
    this.batches.forEach((b,i)=>{b.mesh.geometry.instanceCount=counts[i];b.anchor.needsUpdate=true;b.style.needsUpdate=true;});
  }
}
