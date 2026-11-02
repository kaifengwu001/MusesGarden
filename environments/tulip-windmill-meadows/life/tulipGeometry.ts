import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TULIP_COLOURS=['#9aaee5','#f9e9dc','#ed667d','#f59fb7','#f7df86','#ffbf67'];

/** Real open six-petal cups, two curved leaves and a narrow stem. */
export function tulipGeometry(detailed=true):BufferGeometry {
  const positions:number[]=[],kinds:number[]=[];
  const tri=(a:Vector3,b:Vector3,c:Vector3,kind:number):void=>{for(const v of [a,b,c]){positions.push(v.x,v.y,v.z);kinds.push(kind);}};
  const ribbon=(points:Vector3[],widths:number[],kind:number,axis:Vector3):void=>{
    for(let i=0;i<points.length-1;i++){
      const a=points[i].clone().addScaledVector(axis,-widths[i]),b=points[i].clone().addScaledVector(axis,widths[i]);
      const c=points[i+1].clone().addScaledVector(axis,-widths[i+1]),d=points[i+1].clone().addScaledVector(axis,widths[i+1]);
      tri(a,b,d,kind);tri(a,d,c,kind);
    }
  };
  ribbon(detailed?[new Vector3(0,0,0),new Vector3(0.025,0.35,0),new Vector3(0,0.69,0)]:[new Vector3(0,0,0),new Vector3(0,0.69,0)],detailed?[0.012,0.011,0.007]:[0.012,0.007],0,new Vector3(1,0,0));
  for(let leaf=0;leaf<2;leaf++){
    const sign=leaf?1:-1;
    const points=[new Vector3(0,0.13+leaf*0.05,0),new Vector3(sign*0.12,0.3,0.035),new Vector3(sign*0.25,0.49,0.065),new Vector3(sign*0.28,0.6,0.03)];
    ribbon(detailed?points:[points[0],points[2],points[3]],detailed?[0.012,0.055,0.045,0]:[0.012,0.06,0],0,new Vector3(0.1,0,1).normalize());
  }
  for(let petal=0;petal<6;petal++){
    const angle=petal*Math.PI/3;
    const ring=(level:number,side:number):Vector3=>{
      const radius=[0.026,0.125,0.135][level];
      const a=angle+side*(level===0?0.30:0.58);
      const height=[0.66,0.81,0.96][level]-(level===2?Math.abs(side)*0.045:0);
      return new Vector3(Math.cos(a)*radius,height,Math.sin(a)*radius);
    };
    for(let level=0;level<2;level+=detailed?1:2)for(let side=-1;side<1;side+=detailed?1:2){
      const step=detailed?1:2;
      const a=ring(level,side),b=ring(level,side+step),c=ring(level+step,side),d=ring(level+step,side+step);
      tri(a,b,d,1+petal%2);tri(a,d,c,1+petal%2);
    }
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('aKind',new Float32BufferAttribute(kinds,1));g.computeVertexNormals();g.computeBoundingSphere();return g;
}

class MillBuilder {
  parts:BufferGeometry[]=[];
  add(geometry:BufferGeometry,colour:string,position:Vector3,rotation=0,foot=false):void{
    const g=geometry.index?geometry.toNonIndexed():geometry;
    if(g!==geometry)geometry.dispose();
    g.applyMatrix4(new Matrix4().makeRotationZ(rotation).setPosition(position));
    const c=new Color(colour),data:number[]=[];
    for(let i=0;i<g.getAttribute('position').count;i++)data.push(c.r,c.g,c.b);
    g.setAttribute('color',new Float32BufferAttribute(data,3));g.deleteAttribute('uv');this.parts.push(g);
    g.setAttribute('aFoot',new Float32BufferAttribute(Array.from({length:g.getAttribute('position').count},(_,i)=>foot&&g.getAttribute('position').getY(i)<-0.01?1:0),1));
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,c:string,a=0,foot=false):void{this.add(new BoxGeometry(w,h,d),c,new Vector3(x,y,z),a,foot);}
  finish():BufferGeometry{const g=mergeGeometries(this.parts);for(const p of this.parts)p.dispose();g.computeBoundingSphere();return g;}
}

/** Warm plaster mill with an orange-roofed attached house and blue joinery. */
export function windmillGeometry():BufferGeometry{
  const b=new MillBuilder();
  b.add(new CylinderGeometry(1.15,2.15,9.8,12,1), '#e9b4a2',new Vector3(-2.4,4.9,-1.6));
  b.add(new ConeGeometry(1.65,1.8,12),'#596d91',new Vector3(-2.4,10.55,-1.6));
  b.add(new CylinderGeometry(2.5,2.5,0.16,16),'#7b8fb1',new Vector3(-2.4,4.15,-1.6));
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8,x=-2.4+Math.cos(a)*2.4,z=-1.6+Math.sin(a)*2.4;
    b.box(x,4.5,z,0.045,0.7,0.045,'#667b9b');
  }
  b.add(new CylinderGeometry(2.46,2.46,0.045,16,1,true),'#667b9b',new Vector3(-2.4,4.85,-1.6));
  b.add(new CylinderGeometry(2.16,2.3,0.8,12),'#c5b79d',new Vector3(-2.4,-0.4,-1.6),0,true);
  addCottage(b,0,true);
  // Tower door, windows, cornice and weatherboard marks.
  b.box(-2.4,0.9,0.49,0.73,1.8,0.08,'#728b9e');
  for(const y of [3,6.4,8])b.box(-2.4,y,-0.25-(y/10)*0.6,0.44,0.68,0.08,'#6f8aa4');
  return b.finish();
}

/** Long gables run with the tulip rows. Porches and a side bay change the plan,
 * not just the paint. Every house owns a small productive garden. */
function addCottage(b:MillBuilder,variant:number,mill=false):void{
  const wall=mill?'#f6d9b5':['#b6d7df','#b9cba1','#e9b5ba'][variant];
  const roof=variant===2?'#708ca4':'#dc8864',trim=variant===1?'#f3ead2':'#668eab';
  const width=variant===2?4.5:5,depth=variant===1?6.4:7.2,cx=0.9,front=3.6,back=front-depth;
  const house=(x:number,z:number,w:number,d:number,h:number,c:string):void=>{
    b.box(x,h/2,z,w,h,d,c);
    b.box(x,-0.4,z,w,0.8,d,'#bbad97',0,true);
    const rise=w*0.43,angle=Math.atan2(rise,w/2),span=Math.hypot(w/2,rise)+0.22;
    for(const sign of [-1,1]){
      b.box(x+sign*w/4,h+rise/2,z,span,0.12,d+0.44,roof,-sign*angle);
      b.box(x+sign*(w/2+0.13),h-0.01,z,0.1,0.16,d+0.46,trim);
      for(let row=1;row<6;row++){
        const t=row/6;
        b.box(x+sign*w/2*t,h+rise*(1-t)+0.075,z,0.027,0.025,d+0.4,'#ce815f',-sign*angle);
      }
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([
      x-w/2,h,z+d/2,x+w/2,h,z+d/2,x,h+rise,z+d/2,
      x+w/2,h,z-d/2,x-w/2,h,z-d/2,x,h+rise,z-d/2,
    ],3));g.computeVertexNormals();b.add(g,c,new Vector3());
    b.box(x,h+rise+0.05,z,0.12,0.13,d+0.5,trim);
  };
  house(cx,(front+back)/2,width,depth,2.65,wall);
  if(variant===2)house(-2.4,-0.8,2.3,3.6,2.1,wall);
  const window=(x:number,y:number,z:number,side=false):void=>{
    const pane=new BoxGeometry(0.76,1.03,0.06),frame=new BoxGeometry(0.96,1.23,0.09);
    if(side){pane.rotateY(Math.PI/2);frame.rotateY(Math.PI/2);}
    b.add(frame,trim,new Vector3(x,y,z));b.add(pane,'#cde5df',new Vector3(x+(side?0.055:0),y,z+(side?0:0.055)));
    b.box(x+(side?0.1:0),y,z+(side?0:0.1),side?0.04:0.055,1.05,side?0.055:0.04,'#fff0d7');
    b.box(x+(side?0.1:0),y,z+(side?0:0.1),side?0.04:0.78,0.055,side?0.78:0.04,'#fff0d7');
  };
  for(const x of [cx-width*0.31,cx+width*0.31])window(x,1.5,front+0.04);
  window(cx,3.35,front+0.04);
  for(const z of [-1.8,0.8])window(cx+width/2+0.04,1.5,z,true);
  b.box(cx,0.98,front+0.05,0.88,1.96,0.12,trim);
  b.box(cx+0.29,0.98,front+0.13,0.065,0.065,0.045,'#e8bd71');
  b.box(cx,0.07,3.88,1.35,0.14,0.54,'#d8c7a8');
  b.box(cx-1.4,4.35,back+1.5,0.5,1.25,0.55,'#bf8d79');
  if(variant===1){
    b.box(cx,2.4,4.12,3.25,0.12,1.25,roof,-0.04);
    for(const x of [-0.6,2.4])b.box(x,1.15,4.6,0.09,2.3,0.09,trim);
  }else if(variant===2){
    for(const x of [cx-1.4,cx+1.4])for(const side of [-1,1])b.box(x+side*0.57,1.5,3.7,0.25,1.13,0.08,trim);
  }
  // A few fine weatherboard courses, two window boxes and planted side borders.
  for(let y=0.35;y<2.65;y+=0.29){
    b.box(cx+width/2+0.012,y,(front+back)/2,0.026,0.018,depth-0.1,mill?'#dfc5a1':wall);
  }
  for(const x of [cx-width*0.31,cx+width*0.31]){
    b.box(x,0.83,3.81,1.06,0.18,0.36,'#af8e70');
    b.box(x,0.94,3.81,0.96,0.06,0.29,'#6d8f55');
    for(let j=0;j<5;j++)gardenTulip(b,x-0.36+j*0.18,0.96,3.82,0.32,j%2?'#f1aabd':'#efce7b');
  }
  for(const x of [-4.85,4.9]){
    b.box(x,0.09,0.2,0.75,0.18,7.1,'#9fa077');
    b.box(x,0.19,0.2,0.65,0.08,6.95,'#64874d');
    for(let j=0;j<17;j++)gardenTulip(b,x+(j%2?0.14:-0.14),0.24,-3.0+j*0.4,0.63,j%3?'#f1aabd':'#f5d479');
  }
  // Short boundary fences stop before the front walk and its gate.
  for(const x of [-5.55,5.55]){
    for(let z=-5.6;z<4.6;z+=1.25)b.box(x,0.45,z,0.08,0.9,0.08,'#e4dec3');
    for(const y of [0.34,0.68])b.box(x,y,-0.7,0.055,0.065,10.0,'#e4dec3');
  }
}
function gardenTulip(b:MillBuilder,x:number,y:number,z:number,scale:number,colour:string):void{
  const g=tulipGeometry();g.scale(scale,scale,scale);const kind=g.getAttribute('aKind');
  b.add(g,colour,new Vector3(x,y,z));const colors=b.parts[b.parts.length-1].getAttribute('color'),green=new Color('#618b49');
  for(let i=0;i<kind.count;i++)if(kind.getX(i)<0.5)colors.setXYZ(i,green.r,green.g,green.b);
  g.deleteAttribute('aKind');
}
export function cottageGeometry(variant:number):BufferGeometry{
  const b=new MillBuilder();addCottage(b,variant);return b.finish();
}

/** Four radial lattices; hub at origin, rotation axis +z. */
export function windmillSailsGeometry():BufferGeometry{
  const b=new MillBuilder();
  const colours=['#f2adad','#f8df9e','#c6dfc4','#d3def1'];
  for(let arm=0;arm<4;arm++){
    const a=arm*Math.PI/2;
    const part=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):void=>b.box(x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a),z,w,h,d,c,a);
    part(-0.15,3.1,0,0.12,6.1,0.13,'#5d688c');
    part(0.88,3.8,0,0.075,4.6,0.1,'#7e91a8');
    part(0.37,3.7,0.025,0.86,4.3,0.045,colours[arm]);
    for(let rung=0;rung<11;rung++)part(0.37,1.5+rung*0.43,0.08,1.22,0.055,0.065,'#7287a1');
  }
  b.add(new CylinderGeometry(0.27,0.27,0.28,12).rotateX(Math.PI/2),'#e0b66d',new Vector3(0,0,0.2));
  return b.finish();
}
