import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';

/** Finite cirrus ribbons on a spherical shell, with tapered, wandering edges. */
export function cloudRibbonGeometry(seed: number): BufferGeometry {
  let state=hash32(seed^0xc10d531);
  const random=():number=>unit(state=hash32(state+0x9e3779b9));
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const axis=new Vector3(.24,.91,-.34).normalize();
  const east=new Vector3().crossVectors(axis,new Vector3(1,0,0)).normalize();
  const north=new Vector3().crossVectors(east,axis).normalize();
  // Subdivide across the width as well as along the stream. Wide single-quad
  // strips form chords whose interiors sink below the spherical cloud shell.
  const segments=48,crossSegments=2,stride=crossSegments+1;
  for(let ribbon=0;ribbon<18;ribbon++) {
    const latitude=-1.12+(ribbon+.5)/18*2.24;
    const start=random()*Math.PI*2,length=1.4+random()*2.2;
    const width=(.040+random()*.035)*1.8,phase=random()*Math.PI*2;
    const base=positions.length/3;
    for(let i=0;i<=segments;i++) {
      const t=i/segments,longitude=start+t*length;
      const centre=latitude+.10*Math.sin(longitude*1.6+phase)+.035*Math.sin(longitude*3.2-phase);
      const taper=Math.pow(Math.sin(t*Math.PI),.85);
      for(let j=0;j<=crossSegments;j++) {
        const side=j/crossSegments*2-1;
        const lat=centre+side*width*taper*(.8+.2*Math.sin(t*19+phase));
        const dir=axis.clone().multiplyScalar(Math.sin(lat)).addScaledVector(east,Math.cos(lat)*Math.cos(longitude)).addScaledVector(north,Math.cos(lat)*Math.sin(longitude));
        positions.push(dir.x,dir.y,dir.z);uvs.push(t,(side+1)/2);
      }
      if(i<segments) for(let j=0;j<crossSegments;j++) {
        const a=base+i*stride+j;
        indices.push(a,a+1,a+stride,a+1,a+stride+1,a+stride);
      }
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  return geometry;
}

export class WindCloudRibbons {
  readonly mesh: Mesh<BufferGeometry,ShaderMaterial>;
  private seed=Number.NaN;
  private readonly time={value:0};
  private readonly height={value:20};
  private readonly opacity={value:0};

  constructor(shared:Record<string,IUniform>) {
    this.mesh=new Mesh(new BufferGeometry(),new ShaderMaterial({
      name:'Spherical wind-combed cirrus',
      uniforms:{...shared,uRibbonTime:this.time,uRibbonHeight:this.height,uRibbonOpacity:this.opacity},
      vertexShader:`
        #include <meadow_warp>
        uniform float uRadius;
        uniform float uRibbonTime;
        uniform float uRibbonHeight;
        varying vec2 vUv;
        void main(){
          vec3 axis=normalize(vec3(.24,.91,-.34));
          float a=uRibbonTime*.003;
          vec3 p=position*cos(a)+cross(axis,position)*sin(a)+axis*dot(axis,position)*(1.-cos(a));
          vUv=uv;
          gl_Position=projectionMatrix*viewMatrix*vec4(warpPosition(p*(uRadius+uRibbonHeight)),1.);
        }`,
      fragmentShader:`
        uniform float uRibbonOpacity;
        varying vec2 vUv;
        float cloudNoise(vec2 p){
          vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          vec3 h=fract(vec3(i.x,i.y,i.x+i.y)*vec3(.1031,.1030,.0973));
          float a=fract((h.x+h.y)*h.z*113.);
          h=fract(vec3(i.x+1.,i.y,i.x+i.y+1.)*vec3(.1031,.1030,.0973));
          float b=fract((h.x+h.y)*h.z*113.);
          h=fract(vec3(i.x,i.y+1.,i.x+i.y+1.)*vec3(.1031,.1030,.0973));
          float c=fract((h.x+h.y)*h.z*113.);
          h=fract(vec3(i.x+1.,i.y+1.,i.x+i.y+2.)*vec3(.1031,.1030,.0973));
          float d=fract((h.x+h.y)*h.z*113.);
          return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
        }
        void main(){
          vec2 p=vec2(vUv.x*24.,vUv.y*3.);
          float broad=cloudNoise(p);
          float fine=cloudNoise(p*2.7+7.3);
          float centre=.5+.10*sin(vUv.x*27.)+.10*(broad-.5);
          float fullness=.22+.14*broad+.055*sin(vUv.x*61.);
          float edge=1.-smoothstep(fullness-.13,fullness+.12,abs(vUv.y-centre));
          float ends=smoothstep(0.,.13,vUv.x)*(1.-smoothstep(.85,1.,vUv.x));
          float density=edge*ends*(.58+.28*broad+.14*fine);
          float light=smoothstep(.15,.8,broad*.55+vUv.y*.45);
          vec3 colour=mix(vec3(1.,.98,.89),vec3(1.,1.,.985),light);
          gl_FragColor=vec4(pow(colour,vec3(2.2)),density*uRibbonOpacity);
        }`,
      transparent:true,depthTest:true,depthWrite:false,side:DoubleSide,
    }));
    this.mesh.name='Thin cirrus wrapping the planet';
    this.mesh.frustumCulled=false;
    this.mesh.renderOrder=3;
  }

  /** The ribbons on a shell `height` above R (m), seen from a camera `altitude` over the ground. */
  update(seed:number,height:number,time:number,altitude:number):void {
    if(seed!==this.seed) {
      this.mesh.geometry.dispose();this.mesh.geometry=cloudRibbonGeometry(seed);this.seed=seed;
    }
    this.time.value=time;
    this.height.value=height;
    // The painted sky remains the close-view reference. Orbit reveals the
    // physical ribbons gradually, without covering the plants at ground level.
    const t=Math.min(1,Math.max(0,(altitude-18)/65));
    this.opacity.value=.78*t*t*(3-2*t);
    this.mesh.visible=this.opacity.value>.001;
  }

  dispose():void {this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
