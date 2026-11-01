import { BufferGeometry, Float32BufferAttribute, Group, LineSegments, Points, ShaderMaterial, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import type { Terrain } from '../planet/terrain';

const vertex = `
uniform float uTime;
uniform float uRadius;
uniform float uSnowAmount;
uniform vec4 uCottage;
uniform vec4 uCottageB;
uniform float uRain;
#include <meadow_warp>
attribute float aEnd;
varying float vAlpha;
void main() {
  vec3 p = position;
  float speed = mix(0.55, 9.0, uRain);
  p.y = 1.5 + mod(position.y - uTime * speed + 10000.0, 19.0);
  p.x += sin(uTime * 0.35 + position.z) * 0.4 * (1.0-uRain);
  p.x += aEnd * 0.24 * uRain;
  p.y -= aEnd * 0.8 * uRain;
  vec3 across = cross(uCottage.xyz, uCottageB.xyz);
  vec3 dir = normalize(uCottage.xyz + (across*p.x + uCottageB.xyz*p.z)/uRadius);
  vec3 wp = warpPosition(dir * (uRadius + p.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp,1.0);
  gl_PointSize = clamp(25.0 / max(1.0,gl_Position.w), 1.2, 3.5);
  vAlpha = mix(uSnowAmount,1.0-uSnowAmount,uRain);
  if(abs(p.x)<5.2 && abs(p.z)<4.0 && p.y<8.0) vAlpha=0.0;
}`;
const snowFragment = `varying float vAlpha;
void main(){float d=length(gl_PointCoord-0.5);if(d>0.48||vAlpha<0.01)discard;gl_FragColor=vec4(0.96,0.94,0.86,vAlpha*0.7*smoothstep(0.5,0.3,d));}`;
const rainFragment = `varying float vAlpha;
void main(){if(vAlpha<0.01)discard;gl_FragColor=vec4(0.64,0.73,0.77,vAlpha*0.30);}`;

/** Weather is an analytic function of the frozen world clock, never a mutable particle simulation. */
export class HamletWeather {
  readonly group = new Group();
  constructor(shared: Record<string,IUniform>) {
    for (const rain of [false,true]) {
      const positions:number[]=[]; const ends:number[]=[];
      const count = rain ? 850 : 460;
      for(let i=0;i<count;i++) {
        const x=(unit(hash32(i*7+91))-.5)*76;
        const y=unit(hash32(i*11+781))*19;
        const z=(unit(hash32(i*17+411))-.5)*76;
        for(let k=0;k<(rain?2:1);k++){positions.push(x,y,z);ends.push(k);}
      }
      const geometry=new BufferGeometry();
      geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
      geometry.setAttribute('aEnd',new Float32BufferAttribute(ends,1));
      const material=new ShaderMaterial({uniforms:{...shared,uRain:{value:rain?1:0}},vertexShader:vertex,fragmentShader:rain?rainFragment:snowFragment,transparent:true,depthWrite:false});
      const mesh=rain?new LineSegments(geometry,material):new Points(geometry,material);
      mesh.frustumCulled=false; mesh.renderOrder=60;
      this.group.add(mesh);
    }
  }
  update(_time:number,_terrain:Terrain,altitude:number):void {this.group.visible=altitude<65;}
  dispose():void {for(const object of this.group.children){const mesh=object as Points;mesh.geometry.dispose();(mesh.material as ShaderMaterial).dispose();}}
}
