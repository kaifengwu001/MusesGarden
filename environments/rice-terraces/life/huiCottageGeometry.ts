import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, FrontSide, Group, Matrix4, Mesh, MeshStandardMaterial,
  Quaternion, Vector3,
} from 'three';

type Surface='plaster'|'tile'|'timber'|'stone'|'shadow'|'clay'|'leaf';
interface Batch {positions:number[];normals:number[];colours:number[];}
interface Opening {left:number;right:number;bottom:number;top:number;}
export interface HuiCottageGeometry {
  group:Group;
  stats:{triangles:number;drawCalls:number;roofTiles:number;windows:number;gableWalls:number};
  dispose():void;
}
const PALETTE:Record<Surface,string>={plaster:'#eeede2',tile:'#263b3d',timber:'#574336',stone:'#929488',shadow:'#242b24',clay:'#8c6750',leaf:'#627b3e'};
const UP=new Vector3(0,1,0);

/** A small Hui-inspired residence, built in local metres with +Z at the gate.
 * Foundation and courtyard paving belong to the terrain-aware placement module.
 * All small elements are merged into seven material batches, never one draw per tile. */
export function createHuiCottageGeometry():HuiCottageGeometry{
  const batch=():Batch=>({positions:[],normals:[],colours:[]});
  const batches:Record<Surface,Batch>={plaster:batch(),tile:batch(),timber:batch(),stone:batch(),shadow:batch(),clay:batch(),leaf:batch()};
  const boxTemplate=new BoxGeometry(1,1,1).toNonIndexed();
  const circleTemplate=new CylinderGeometry(1,1,1,10).toNonIndexed();
  const transform=new Matrix4(),rotation=new Quaternion(),scale=new Vector3(),point=new Vector3(),normal=new Vector3();
  const colour=new Color();let roofTiles=0,windows=0;
  function addGeometry(surface:Surface,geometry:BufferGeometry,matrix:Matrix4,tint=1):void{
    const batch=batches[surface],positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
    const normalRotation=new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(matrix));
    colour.set(PALETTE[surface]).multiplyScalar(tint);
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(matrix);normal.fromBufferAttribute(normals,i).applyQuaternion(normalRotation).normalize();
      batch.positions.push(point.x,point.y,point.z);batch.normals.push(normal.x,normal.y,normal.z);batch.colours.push(colour.r,colour.g,colour.b);
    }
  }
  function box(surface:Surface,x:number,y:number,z:number,w:number,h:number,d:number,tint=1,turn=0):void{
    rotation.setFromAxisAngle(UP,turn);transform.compose(new Vector3(x,y,z),rotation,scale.set(w,h,d));
    addGeometry(surface,boxTemplate,transform,tint);
  }
  function beam(surface:Surface,a:Vector3,b:Vector3,width:number,depth=width,tint=1):void{
    const delta=b.clone().sub(a);rotation.setFromUnitVectors(UP,delta.clone().normalize());
    transform.compose(a.clone().add(b).multiplyScalar(.5),rotation,scale.set(width,delta.length(),depth));
    addGeometry(surface,boxTemplate,transform,tint);
  }
  function cylinder(surface:Surface,x:number,y:number,z:number,r:number,h:number,tint=1):void{
    transform.makeScale(r,h,r).setPosition(x,y,z);addGeometry(surface,circleTemplate,transform,tint);
  }
  function quad(surface:Surface,a:Vector3,b:Vector3,c:Vector3,d:Vector3,tint=1):void{
    const batch=batches[surface];colour.set(PALETTE[surface]).multiplyScalar(tint);
    for(const vertices of [[a,b,c],[a,c,d]]){
      const n=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
      for(const p of vertices){batch.positions.push(p.x,p.y,p.z);batch.normals.push(n.x,n.y,n.z);batch.colours.push(colour.r,colour.g,colour.b);}
    }
  }
  function facade(width:number,height:number,openings:Opening[],cx:number,cz:number,turn=0):void{
    const xs=[-width/2,width/2,...openings.flatMap(o=>[o.left,o.right])].sort((a,b)=>a-b);
    const ys=[0,height,...openings.flatMap(o=>[o.bottom,o.top])].sort((a,b)=>a-b);
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
      const x=(xs[i]+xs[i+1])/2,y=(ys[j]+ys[j+1])/2;
      if(xs[i+1]-xs[i]<1e-8||ys[j+1]-ys[j]<1e-8||openings.some(o=>x>o.left&&x<o.right&&y>o.bottom&&y<o.top))continue;
      const p=new Vector3(x,y,-.14).applyAxisAngle(UP,turn).add(new Vector3(cx,0,cz));
      box('plaster',p.x,p.y,p.z,xs[i+1]-xs[i],ys[j+1]-ys[j],.28,1,turn);
    }
  }
  function windowFrame(x:number,y:number,z:number,width:number,height:number,turn=0):void{
    windows++;
    const at=(dx:number,dy:number,dz:number):Vector3=>new Vector3(dx,dy,dz).applyAxisAngle(UP,turn).add(new Vector3(x,y,z));
    const part=(surface:Surface,dx:number,dy:number,dz:number,w:number,h:number,d:number,tint=1):void=>{
      const p=at(dx,dy,dz);box(surface,p.x,p.y,p.z,w,h,d,tint,turn);
    };
    part('shadow',0,0,-.2,width,height,.035);
    part('timber',-width/2,0,.015,.10,height+.16,.13);part('timber',width/2,0,.015,.10,height+.16,.13);
    part('timber',0,height/2,.015,width,.10,.13);part('stone',0,-height/2-.04,.055,width+.22,.12,.26);
    for(const fraction of [-.25,0,.25])part('timber',fraction*width,0,-.015,.04,height,.07,.92);
    for(const fraction of [-.23,.18])part('timber',0,fraction*height,-.015,width,.045,.07,.92);
    // Small tilted shutters give the windows physical depth at oblique views.
    const shutter=at(-width/2-.19,0,.04);
    box('timber',shutter.x,shutter.y,shutter.z,.25,height,.09,1.12,turn-.16);
  }
  function roof(cx:number,cz:number,length:number,halfDepth:number,eave:number,ridge:number,turn=0):void{
    const columns=Math.ceil(length/.28),rows=10,w=length/columns;
    const at=(x:number,t:number,side:number,lift=0):Vector3=>{
      const y=ridge-(ridge-eave+.16)*t+.16*t*t*t+lift;
      return new Vector3(x,y,side*t*halfDepth).applyAxisAngle(UP,turn).add(new Vector3(cx,0,cz));
    };
    for(const side of [-1,1])for(let column=0;column<columns;column++)for(let row=0;row<rows;row++){
      const x=-length/2+column*w,t0=row/rows,t1=(row+1)/rows;
      const tint=.88+((column*13+row*7)%11)*.021;roofTiles++;
      // Three facets across each tile create shallow cylindrical channels.
      // A row's raised nose is part of its surface, not a coplanar decal.
      for(let facet=0;facet<3;facet++){
        const u0=facet/3,u1=(facet+1)/3;
        const arc0=Math.sin(u0*Math.PI)*.045,arc1=Math.sin(u1*Math.PI)*.045;
        const a=at(x+w*u0,t0,side,arc0),b=at(x+w*u1,t0,side,arc1);
        const c=at(x+w*u1,t1,side,arc1+.025),d=at(x+w*u0,t1,side,arc0+.025);
        if(side===1)quad('tile',b,a,d,c,tint);else quad('tile',a,b,c,d,tint);
        const c0=at(x+w*u1,t1,side,arc1),d0=at(x+w*u0,t1,side,arc0);
        if(side===1)quad('tile',d,c,c0,d0,tint*.8);else quad('tile',c,d,d0,c0,tint*.8);
      }
    }
    const ridgeA=new Vector3(-length/2-.04,ridge+.09,0).applyAxisAngle(UP,turn).add(new Vector3(cx,0,cz));
    const ridgeB=new Vector3(length/2+.04,ridge+.09,0).applyAxisAngle(UP,turn).add(new Vector3(cx,0,cz));
    beam('tile',ridgeA,ridgeB,.20,.22,1.15);
    for(const side of [-1,1]){
      const a=at(-length/2,1,side,-.07),b=at(length/2,1,side,-.07);beam('timber',a,b,.13,.13,.8);
    }
  }
  function gable(x:number,z:number,base:number,width:number,peak:number,turn=0):void{
    // The white fire wall rises in three steps above a modest tiled roof.
    const boundaries=[-.5,-.32,-.17,.17,.32,.5].map(v=>v*width);
    const drop=Math.min(1.55,(peak-base)*.68);
    const tops=[peak-drop,peak-drop*.53,peak,peak-drop*.53,peak-drop];
    for(let i=0;i<5;i++){
      const middle=(boundaries[i]+boundaries[i+1])*.5,length=boundaries[i+1]-boundaries[i];
      const local=new Vector3(0,0,middle).applyAxisAngle(UP,turn);
      box('plaster',x+local.x,(base+tops[i])/2,z+local.z,.26,tops[i]-base,length,1,turn);
      box('tile',x+local.x,tops[i]+.055,z+local.z,.43,.11,length+.05,1.03,turn);
      // A small thickened end to each cap makes the stepped silhouette legible.
      const end=new Vector3(0,0,boundaries[i]+.045).applyAxisAngle(UP,turn);
      box('tile',x+end.x,tops[i]+.12,z+end.z,.43,.12,.10,.92,turn);
    }
  }

  // Tall hall: actual window/door holes, thick white walls and restrained base.
  const openings:Opening[]=[{left:-.9,right:.9,bottom:0,top:2.65}];
  for(const x of [-2.8,2.8])openings.push({left:x-.7,right:x+.7,bottom:1.2,top:2.5});
  for(const x of [-2.8,0,2.8])openings.push({left:x-.7,right:x+.7,bottom:3.55,top:4.65});
  facade(9,5.2,openings,0,0);
  box('plaster',0,2.6,-4.88,9,5.2,.24);
  for(const x of [-4.38,4.38])box('plaster',x,2.6,-2.5,.24,5.2,5);
  box('stone',0,.17,-5.01,9.1,.34,.16,.85);
  for(const x of [-4.52,4.52])box('stone',x,.17,-2.5,.14,.34,5.1,.85);
  for(const x of [-2.8,2.8])windowFrame(x,1.85,0,1.4,1.3);
  for(const x of [-2.8,0,2.8])windowFrame(x,4.1,0,1.4,1.1);
  // Thin lintel and timber joinery belong to a lived-in house, not a temple gate.
  box('shadow',0,1.3,-.35,1.8,2.6,.06);
  for(const x of [-.96,.96])box('stone',x,1.37,.02,.18,2.74,.38,.95);
  box('stone',0,2.78,.03,2.25,.25,.46,1.1);
  box('timber',0,2.55,-.035,1.8,.13,.19);
  for(const side of [-1,1]){
    const x=side*.46;
    box('timber',x,1.28,-.23,.86,2.48,.12,side===1?1.04:.95,side===1?-.075:0);
    for(let i=0;i<4;i++)box('timber',x-.31+i*.2,1.28,-.151,.025,2.38,.025,1.2);
    box('timber',x,.72,-.13,.72,.065,.05,.8);box('timber',x,1.93,-.13,.72,.065,.05,.8);
    cylinder('stone',side*.14,1.28,-.09,.055,.10,.6);
  }
  box('stone',0,.055,.20,2.1,.11,.65,1.08);
  roof(0,-2.5,8.76,2.82,5.27,7.06);
  gable(-4.5,-2.5,5.15,5.28,7.48);gable(4.5,-2.5,5.15,5.28,7.48);
  // Shallow doorway awning and two slender supports, visibly below main eaves.
  for(const x of [-1.55,1.55]){
    box('timber',x,1.42,.98,.12,2.84,.12,.9);box('stone',x,.13,.98,.28,.26,.28,.92);
    beam('timber',new Vector3(x,2.78,.92),new Vector3(x,2.42,.52),.075,.075);
  }
  box('timber',0,2.82,.98,3.32,.16,.14,.9);
  for(let i=0;i<12;i++){
    const x=-1.72+i*.286;
    quad('tile',new Vector3(x,3.18,.1),new Vector3(x+.286,3.18,.1),new Vector3(x+.286,2.91,1.23),new Vector3(x,2.91,1.23),.9+(i%3)*.06);
    beam('tile',new Vector3(x,3.20,.1),new Vector3(x,2.93,1.23),.045,.045,1.1);
  }

  // Lower west wing opens inward to the courtyard; its roof runs perpendicular.
  const wingTurn=Math.PI/2;
  facade(6,2.92,[{left:-1.95,right:-.75,bottom:1.1,top:2.2},{left:.45,right:1.65,bottom:0,top:2.35}],-3,3,wingTurn);
  box('plaster',-6.37,1.46,3,.24,2.92,6);
  for(const z of [.12,5.88])box('plaster',-4.75,1.46,z,3.5,2.92,.24);
  windowFrame(-3,1.65,4.35,1.2,1.1,wingTurn);
  box('shadow',-3.22,1.12,1.95,.04,2.24,1.2);
  box('timber',-3.12,1.12,1.95,.10,2.24,1.1,1.06);
  for(const z of [1.35,2.55])box('timber',-2.99,1.2,z,.13,2.4,.10);
  box('timber',-2.99,2.4,1.95,.13,.12,1.32);
  box('stone',-4.75,.16,6.03,3.6,.32,.13,.84);
  roof(-4.75,3,6.12,1.78,3.00,4.18,wingTurn);
  gable(-4.75,6.04,2.92,3.5,4.58,wingTurn);

  // Enclosing garden wall and an actual two-metre-wide gate opening.
  box('plaster',5.18,.68,3.2,.24,1.36,6.4,.97);box('tile',5.18,1.4,3.2,.40,.13,6.5,.94);
  box('plaster',4.83,.68,.12,.7,1.36,.24,.97);box('tile',4.83,1.4,.12,.75,.13,.40,.94);
  for(const [left,right] of [[-2.9,1],[3,5.3]]){
    box('plaster',(left+right)/2,.68,6.4,right-left,1.36,.28,.97);
    box('tile',(left+right)/2,1.4,6.4,right-left+.06,.13,.43,.98);
  }
  for(const x of [.86,3.14]){
    box('plaster',x,1.26,6.4,.32,2.52,.47,1.02);box('stone',x,.15,6.4,.42,.3,.56,.87);
  }
  box('plaster',2,2.45,6.4,2.1,.32,.42,1.02);box('timber',2,2.27,6.39,2,.10,.25);
  roof(2,6.4,2.82,.57,2.67,3.02);
  // Small gate leaves opened inward leave the opening legible from the fields.
  box('timber',1.18,1.06,5.92,.12,2.06,.95,.97,-.12);
  box('timber',2.83,1.06,5.92,.12,2.06,.95,1.05,.12);

  // Bench and two planted earthenware jars add domestic scale without clutter.
  box('stone',3.9,.56,2.2,1.6,.18,.52,1.04);
  for(const x of [3.35,4.45])box('stone',x,.25,2.2,.23,.5,.40,.87);
  for(const [x,z,r,h] of [[4.45,5.25,.30,.56],[-2.25,.82,.24,.46]]){
    const pot=new CylinderGeometry(r,r*.62,h,10,1,true).toNonIndexed();
    transform.makeTranslation(x,h*.5,z);addGeometry('clay',pot,transform);pot.dispose();
    cylinder('clay',x,h-.025,z,r*1.08,.09,1.1);cylinder('shadow',x,h+.025,z,r*.82,.012,.85);
    for(let leaf=0;leaf<7;leaf++){
      const angle=leaf*2.399963,reach=r*(1.2+(leaf%3)*.2),top=h+.35+(leaf%3)*.09;
      const a=new Vector3(x,h+.03,z),b=new Vector3(x+Math.cos(angle)*reach,top,z+Math.sin(angle)*reach);
      const side=new Vector3(-Math.sin(angle)*.075,0,Math.cos(angle)*.075);
      quad('leaf',a,b.clone().add(side),b.clone().add(new Vector3(0,.15,0)),b.clone().sub(side),.88+(leaf%3)*.09);
    }
  }

  boxTemplate.dispose();circleTemplate.dispose();
  const group=new Group();group.name='Muse’s Hui courtyard cottage';
  let triangles=0;
  for(const surface of Object.keys(batches) as Surface[]){
    const batch=batches[surface];if(!batch.positions.length)continue;
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(batch.positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(batch.normals,3));geometry.setAttribute('color',new Float32BufferAttribute(batch.colours,3));geometry.computeBoundingSphere();geometry.computeBoundingBox();
    const material=new MeshStandardMaterial({vertexColors:true,roughness:surface==='tile'?.82:.97,side:surface==='leaf'||surface==='tile'?DoubleSide:FrontSide});
    const mesh=new Mesh(geometry,material);mesh.name=`Hui cottage ${surface}`;mesh.castShadow=surface!=='shadow';mesh.receiveShadow=true;group.add(mesh);triangles+=batch.positions.length/9;
  }
  const stats={triangles,drawCalls:group.children.length,roofTiles,windows,gableWalls:3};
  group.userData.stats=stats;
  return {group,stats,dispose(){for(const child of group.children){const mesh=child as Mesh<BufferGeometry,MeshStandardMaterial>;mesh.geometry.dispose();mesh.material.dispose();}group.clear();}};
}
