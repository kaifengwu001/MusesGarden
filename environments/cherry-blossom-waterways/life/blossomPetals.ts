import { BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, type IUniform } from 'three';
import { MAX_TREES, type CherrySite } from './cherryDistribution';
import vertexShader from './blossomPetal.vert.glsl?raw';

/** Petals fall from actual cherry canopies; position is a pure function of tree, petal and time. */
export class BlossomPetals {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private anchors = new InstancedBufferAttribute(new Float32Array(MAX_TREES * 5 * 4),4);
  private styles = new InstancedBufferAttribute(new Float32Array(MAX_TREES * 5 * 4),4);
  private source: CherrySite[] | null = null;
  constructor(shared: Record<string,IUniform>) {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position',new BufferAttribute(new Float32Array([0,0,0, -.6,.2,.04, -.3,.85,0, 0,.7,.08, .3,.85,0, .6,.2,.04]),3));
    g.setIndex([0,1,2,0,2,3,0,3,4,0,4,5]);
    g.setAttribute('aAnchor',this.anchors);g.setAttribute('aStyle',this.styles);g.instanceCount=0;
    this.mesh=new Mesh(g,new ShaderMaterial({name:'Falling cherry petals',vertexShader,fragmentShader:'varying vec3 vColour; void main(){gl_FragColor=vec4(vColour,1.0);}',uniforms:shared,side:DoubleSide}));
    this.mesh.frustumCulled=false;
  }
  update(sites: CherrySite[]): void {
    if(sites===this.source)return; this.source=sites;
    let n=0;
    for(const site of sites) {
      if(site.variant===3)continue;
      for(let j=0;j<5;j++,n++) {
        this.anchors.setXYZW(n,site.dir.x,site.dir.y,site.dir.z,site.height);
        this.styles.setXYZW(n,site.scale,site.id*.173+j*.791,site.turn,j/5);
      }
    }
    this.anchors.needsUpdate=true;this.styles.needsUpdate=true;this.mesh.geometry.instanceCount=n;
  }
}
