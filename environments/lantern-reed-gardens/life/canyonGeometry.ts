import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** Small mesh builder. Hard faces remain hard; foliage is genuinely thin geometry. */
export class CanyonGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private kinds: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1]]): void {
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    // Tapered blades meet at one point. Their collapsed end triangles cover no
    // pixels, but used to carry zero normals and consume work in every colony.
    if (n.lengthSq() < 1e-16) return;
    n.normalize();
    for (const [i, p] of [a, b, c].entries()) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.uvs.push(uv[i][0], uv[i][1]);
      this.kinds.push(kind);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, kind: number, width = 1, height = 1): void {
    this.triangle(a, b, c, kind, [[0, 0], [width, 0], [width, height]]);
    this.triangle(a, c, d, kind, [[0, 0], [width, height], [0, height]]);
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, kind: number): void {
    const x0 = x - width / 2, x1 = x + width / 2;
    const y0 = y - height / 2, y1 = y + height / 2;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    const p = (a: number, b: number, c: number): Vector3 => new Vector3(a, b, c);
    this.quad(p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1),p(x0,y1,z1),kind,width,height);
    this.quad(p(x1,y0,z0),p(x0,y0,z0),p(x0,y1,z0),p(x1,y1,z0),kind,width,height);
    this.quad(p(x0,y0,z0),p(x0,y0,z1),p(x0,y1,z1),p(x0,y1,z0),kind,depth,height);
    this.quad(p(x1,y0,z1),p(x1,y0,z0),p(x1,y1,z0),p(x1,y1,z1),kind,depth,height);
    this.quad(p(x0,y1,z1),p(x1,y1,z1),p(x1,y1,z0),p(x0,y1,z0),kind,width,depth);
    this.quad(p(x0,y0,z0),p(x1,y0,z0),p(x1,y0,z1),p(x0,y0,z1),kind,width,depth);
  }

  tube(points: Vector3[], radii: number[], kind: number, sides = 7): void {
    const rings = points.map((p, i) => {
      const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const across = new Vector3().crossVectors(tangent, Math.abs(tangent.z) < 0.9 ? new Vector3(0,0,1) : new Vector3(1,0,0)).normalize();
      const other = new Vector3().crossVectors(tangent, across).normalize();
      return Array.from({length:sides}, (_, k) => p.clone().addScaledVector(across, Math.cos(k/sides*Math.PI*2)*radii[i]).addScaledVector(other, Math.sin(k/sides*Math.PI*2)*radii[i]));
    });
    let length = 0;
    for (let i=0;i+1<rings.length;i++) {
      const segment = points[i].distanceTo(points[i+1]);
      for (let k=0;k<sides;k++) {
        const next=(k+1)%sides;
        this.triangle(rings[i][k],rings[i][next],rings[i+1][next],kind,[[k/sides,length],[(k+1)/sides,length],[(k+1)/sides,length+segment]]);
        this.triangle(rings[i][k],rings[i+1][next],rings[i+1][k],kind,[[k/sides,length],[(k+1)/sides,length+segment],[k/sides,length+segment]]);
      }
      length+=segment;
    }
  }

  build(): BufferGeometry {
    // Weld only bit-identical GPU vertices: shared triangle corners can reuse a
    // transform, while hard normals, UV seams and material boundaries stay split.
    // Compare Float32 bits, including signed zero, rather than rounded keys.
    const source = [new Float32Array(this.positions), new Float32Array(this.normals), new Float32Array(this.uvs), new Float32Array(this.kinds)];
    const bits = source.map(values => new Uint32Array(values.buffer));
    const sizes = [3, 3, 2, 1];
    const welded: number[][] = [[], [], [], []], indices: number[] = [];
    const first = new Map<number, number>(), originals: number[] = [], next: number[] = [];
    const sameVertex = (original: number, current: number): boolean => {
      for (let attribute = 0; attribute < source.length; attribute++) {
        const originalOffset = original * sizes[attribute], currentOffset = current * sizes[attribute];
        for (let component = 0; component < sizes[attribute]; component++) {
          if (bits[attribute][originalOffset + component] !== bits[attribute][currentOffset + component]) return false;
        }
      }
      return true;
    };
    for (let i = 0; i < this.kinds.length; i++) {
      let hash = 2166136261;
      for (let attribute = 0; attribute < source.length; attribute++) {
        const offset = i * sizes[attribute];
        for (let component = 0; component < sizes[attribute]; component++) hash = Math.imul(hash ^ bits[attribute][offset + component], 16777619);
      }
      let index = first.get(hash) ?? -1;
      // Hashes only locate candidates. Compare every bit before sharing a
      // vertex, so even a collision cannot change the rendered attributes.
      while (index >= 0 && !sameVertex(originals[index], i)) index = next[index];
      if (index < 0) {
        index = originals.length;
        originals.push(i);
        next.push(first.get(hash) ?? -1);
        first.set(hash, index);
        for (let attribute = 0; attribute < source.length; attribute++) {
          const offset = i * sizes[attribute];
          for (let component = 0; component < sizes[attribute]; component++) welded[attribute].push(source[attribute][offset + component]);
        }
      }
      indices.push(index);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(welded[0],3));
    geometry.setAttribute('normal',new Float32BufferAttribute(welded[1],3));
    geometry.setAttribute('uv',new Float32BufferAttribute(welded[2],2));
    geometry.setAttribute('aKind',new Float32BufferAttribute(welded[3],1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Long, thin botanical leaf with a central fold and a pointed, drooping tip. */
export function addReedLeaf(b: CanyonGeometry, origin: Vector3, length: number, turn: number, width = 0.55, kind = 1): void {
  const rows = kind === 3 || kind === 15 ? 4 : 16;
  const phase = turn * 2.7 + origin.y * 1.31;
  const point = (u: number, t: number): Vector3 => {
    // Occasional dry edge nicks and a gentle twist break the repeated cutout silhouette.
    const nick = Math.exp(-Math.pow((t - (0.38 + 0.19 * Math.sin(phase))) * 27, 2));
    const edge = 1 + 0.045 * Math.sin(t * 35 + phase + u * 2) - (u * Math.sin(phase) > 0 ? 0.19 * nick : 0);
    const spread = width * Math.pow(Math.sin(Math.PI * t), 0.72) * edge;
    const x = length * (0.15 * t + 0.82 * t * t);
    const y = length * (0.78 * t - (1.02 + 0.06 * Math.sin(phase)) * t * t)
      + 0.16 * spread * (1 - Math.abs(u)) + spread * u * 0.16 * Math.sin(t * 4 + phase);
    const z = spread * u + length * 0.035 * Math.sin(t * Math.PI) * Math.sin(phase);
    return origin.clone().add(new Vector3(x * Math.cos(turn) + z * Math.sin(turn), y, z * Math.cos(turn) - x * Math.sin(turn)));
  };
  for (let row = 0; row < rows; row++) for (const [a, c] of [[-1, 0], [0, 1]]) {
    const t0 = row / rows, t1 = (row + 1) / rows;
    const p0 = point(a, t0), p1 = point(c, t0), p2 = point(c, t1), p3 = point(a, t1);
    b.triangle(p0, p1, p2, kind, [[(a + 1) / 2, t0], [(c + 1) / 2, t0], [(c + 1) / 2, t1]]);
    b.triangle(p0, p2, p3, kind, [[(a + 1) / 2, t0], [(c + 1) / 2, t1], [(a + 1) / 2, t1]]);
  }
}

/** Six structural ribs hold a fluted papery husk, tapering to a ruby calyx. */
export function addSeedLantern(b: CanyonGeometry, centre: Vector3, size: number): void {
  const levels = [[-0.73,0.025],[0.12,0.34],[0.57,0.14],[0.87,0.008]];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, c = (i + 1) * Math.PI / 3;
    const edge = (angle: number): Vector3[] => levels.map(([y,r]) => centre.clone().add(new Vector3(Math.cos(angle)*size*r,y*size,Math.sin(angle)*size*r)));
    const left=edge(a),right=edge(c);
    // A shallow outward fold catches light across each membrane without rounding
    // away the six clear structural ribs. The case reads as folded plant tissue.
    const fold=levels.map(([y,r],k)=>centre.clone().add(new Vector3(Math.cos((a+c)*.5)*size*r*.94,y*size,Math.sin((a+c)*.5)*size*r*.94)).add(new Vector3(0,k===1?size*.018:0,0)));
    for(let k=0;k+1<levels.length;k++) {
      const y0=(levels[k][0]+0.73)/1.6,y1=(levels[k+1][0]+0.73)/1.6;
      b.triangle(left[k],fold[k],fold[k+1],7,[[0,y0],[.5,y0],[.5,y1]]);
      b.triangle(left[k],fold[k+1],left[k+1],7,[[0,y0],[.5,y1],[0,y1]]);
      b.triangle(fold[k],right[k],right[k+1],7,[[.5,y0],[1,y0],[1,y1]]);
      b.triangle(fold[k],right[k+1],fold[k+1],7,[[.5,y0],[1,y1],[.5,y1]]);
    }
    b.tube(left,[0.011,0.008,0.007,0.006].map(r=>r*size),9,4);
    const calyx=centre.clone().add(new Vector3(0,-size*0.8,0));
    const outer=centre.clone().add(new Vector3(Math.cos(a)*size*0.27,-size*0.34,Math.sin(a)*size*0.27));
    const middle=calyx.clone().lerp(outer,0.5).add(new Vector3(Math.cos(a)*size*0.035,0,Math.sin(a)*size*0.035));
    b.tube([calyx,middle,outer],[0.036,0.036,0.005].map(r=>r*size),3,5);
  }
}

/** Branches are intentionally unequal: tall arching blades among a thicket of thin reed lamps. */
export function reedColonyGeometry(variant = 0): BufferGeometry {
  const b = new CanyonGeometry();
  // A low broken mineral footing keeps the thicket rooted above shallow pools.
  const footing=Array.from({length:11},(_,i)=>{
    const a=i/11*Math.PI*2,r=(.98+.16*Math.sin(i*2.7+variant))*(variant===3?.77:1);
    return new Vector3(Math.cos(a)*r,.11+.02*Math.sin(i*2.1),Math.sin(a)*r);
  });
  for(let i=0;i<footing.length;i++) {
    const next=(i+1)%footing.length;
    b.triangle(footing[i],footing[next],new Vector3(.07,.13,-.04),12);
    b.quad(footing[i].clone().setY(-.15),footing[next].clone().setY(-.15),footing[next],footing[i],12);
  }
  for(let i=0;i<14;i++) {
    const a=i*2.4+variant,r=.82+(i%3)*.18,x=Math.cos(a)*r,z=Math.sin(a)*r,s=.07+(i%4)*.025;
    const ring=Array.from({length:5},(_,k)=>new Vector3(x+Math.cos(k/5*Math.PI*2+i)*s,.06,z+Math.sin(k/5*Math.PI*2+i)*s*.76));
    const shoulder=ring.map((p,k)=>new Vector3(x+(p.x-x)*.58+s*.13,.13+.012*Math.sin(k*2+i),z+(p.z-z)*.62));
    const top=new Vector3(x+s*.09,.143,z);
    for(let k=0;k<5;k++) {
      const n=(k+1)%5;
      b.quad(ring[k],ring[n],shoulder[n],shoulder[k],12);
      b.triangle(shoulder[k],shoulder[n],top,12);
    }
  }
  const count=[5,7,4,3][variant];
  for (let i = 0; i < count; i++) {
    const turn = i * 2.4 + variant * 0.63;
    const height = [5.7,3.8,4.6,2.8,3.2,1.9,2.4][i]*(variant===2?1.35:variant===3?0.48:1);
    const side = new Vector3(Math.cos(turn), 0, Math.sin(turn));
    const stem = Array.from({ length: 7 }, (_, k) => {
      const t = k / 6;
      const bow = (0.13 + i * 0.037) * Math.sin(t * Math.PI);
      const lean = i===0 ? 0 : (.26+.12*Math.sin(turn*1.7))*t*t;
      return side.clone().multiplyScalar(0.18+i*0.08 + (0.22+variant*0.14+lean) * t * t)
        .add(new Vector3(-side.z*bow,0,side.x*bow)).setY(height * t);
    });
    b.tube(stem, stem.map((_, k) => (0.039-k*0.003)*(variant===2?1.2:1)), 8, 5);
    const size=(0.73-i*0.045)*(variant===2?1.17:variant===3?0.72:1)*(i===0?1:.86+.12*Math.sin(turn*1.9));
    addSeedLantern(b, stem[6].clone().add(new Vector3(0,size*0.7,0)),size);
    if (variant!==3 && i<3) addReedLeaf(b,stem[3],2.6-i*0.35,turn+0.5,0.48-i*0.07);
    if (i===0 && variant!==3) {
      addReedLeaf(b,stem[5],variant===2?6.7:4.8,turn+2.1,variant===2?1.05:0.76);
      addReedLeaf(b,stem[2],3.6,turn-0.7,0.66);
    }
  }
  return b.build();
}

export function fanTreeGeometry(): BufferGeometry { return reedColonyGeometry(); }

/** A flat mineral paving fragment, with chipped planes and a sloping fracture edge. */
export function chalkGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  const corners=[[-1.8,-0.68],[-1.1,-1.02],[-0.3,-0.87],[0.2,-1.01],[1.28,-0.78],[1.72,-0.24],[1.48,0.17],[1.8,0.46],[0.68,0.82],[0.14,0.68],[-0.42,1.03],[-1.37,0.72],[-1.66,0.2]];
  // Broken shoulder planes are independent of the top lip: the sides no longer
  // form a continuous extruded stripe around a perfectly level paving tile.
  const outline=corners.flatMap(([x,z],i)=>{
    const [nx,nz]=corners[(i+1)%corners.length];
    const chip=i%3===1?.09:-.025,t=.4+.1*Math.sin(i*3.1);
    return [[x,z],[x+(nx-x)*t+(nz-z)*chip,z+(nz-z)*t-(nx-x)*chip]];
  });
  const lower=outline.map(([x,z],i)=>new Vector3(x*(1.01+.025*Math.sin(i*2.3)),-.31+.07*Math.sin(i*1.7)+x*.018,z*(1.03+.018*Math.cos(i*2.1))));
  const middle=outline.map(([x,z],i)=>new Vector3(x*(1.015+.025*Math.sin(i*1.9)),.06+.055*Math.sin(i*2.3)+x*.025,z*(1.02+.025*Math.cos(i*2.2))));
  const shoulder=outline.map(([x,z],i)=>new Vector3(x,.23+.035*Math.sin(i*1.7)+x*.012,z));
  const upper=outline.map(([x,z],i)=>{
    const bevel=.94-.035*(.5+.5*Math.sin(i*2.6));
    return new Vector3(x*bevel,.31,z*bevel);
  });
  const top = new Vector3(-0.05,0.31,-0.02);
  for (let i = 0; i < outline.length; i++) {
    const n = (i + 1) % outline.length;
    b.quad(lower[i],lower[n],middle[n],middle[i],2,0.9,0.32);
    b.quad(middle[i],middle[n],shoulder[n],shoulder[i],2,0.9,0.24);
    b.quad(shoulder[i],shoulder[n],upper[n],upper[i],2,0.9,0.08);
    b.triangle(upper[i],upper[n],top,2,[[upper[i].x,upper[i].z],[upper[n].x,upper[n].z],[top.x,top.z]]);
  }
  return b.build();
}

/** Deep garnet fern fronds, with separated round lobes instead of soft blobs. */
export function fernGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  for (let f = 0; f < 7; f++) {
    // Seven distinct directions keep the last two fronds from lying over the
    // first two. A slight irregularity reads as growth rather than a rosette.
    const turn = f * Math.PI * 2 / 7 + 0.08 * Math.sin(f * 2.4);
    const height = 0.55 + (f % 3) * 0.23;
    const side = new Vector3(Math.cos(turn), 0, Math.sin(turn));
    const tip = side.clone().multiplyScalar(0.44).setY(height);
    b.tube([new Vector3(),tip],[0.016,0.005],3,4);
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const mid = tip.clone().multiplyScalar(t);
      addReedLeaf(b, mid, 0.34*(1-t*0.55), turn + Math.PI / 2, 0.10, 3);
      addReedLeaf(b, mid, 0.31*(1-t*0.55), turn - Math.PI / 2, 0.09, 3);
    }
  }
  return b.build();
}

/** A complete gravel patch costs one instance and contains individual angular lilac pebbles. */
export function pebblePatchGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  for(let i=0;i<22;i++) {
    const a=i*2.3999632297,r=0.18+Math.sqrt(i/22)*1.45;
    const x=Math.cos(a)*r,z=Math.sin(a)*r;
    const size=0.09+((i*7)%11)*0.017;
    // Broken, blunt stone chips have shoulders and an off-centre top plane;
    // a single tip over a regular ring read as a field of tiny pyramids.
    const lower=Array.from({length:6},(_,j)=>{
      const angle=j/6*Math.PI*2+i*.37,chip=1+.15*Math.sin(j*4.7+i);
      return new Vector3(x+Math.cos(angle)*size*chip,0.015,z+Math.sin(angle)*size*.75*chip);
    });
    const upper=lower.map((p,j)=>new Vector3(x+(p.x-x)*.55+size*.12,size*(.4+.08*Math.sin(j*2.2+i)),z+(p.z-z)*.55-size*.08));
    const top=new Vector3(x+size*.08,size*.44,z-size*.05);
    for(let k=0;k<6;k++) {
      const next=(k+1)%6;
      b.quad(lower[k],lower[next],upper[next],upper[k],12);
      b.triangle(upper[k],upper[next],top,12,[[0,0],[1,0],[.5,1]]);
    }
  }
  return b.build();
}

/** Jointed mineral faces, broken shoulders and a broad irregular top. */
export function mesaGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  const profile=[1.2,1.08,.94,.96,.80,.79];
  for(let column=0;column<6;column++) {
    const angle=column*2.4,off=column===0?0:5.5;
    const height=[27,17,22,11,15,8][column]*.7,width=column===0?6.2:3.8;
    const rings=Array.from({length:6},(_,j)=>Array.from({length:11},(_,k)=>{
      const a=k/11*Math.PI*2;
      const fracture=1+.18*Math.sin(k*2.7+column*1.9)+.035*Math.cos(j*2.7+k*1.4)-(k%4===2?.09:0);
      const r=width*fracture*profile[j];
      const shiftX=Math.sin(j*.7+column)*.62,shiftZ=Math.cos(j*.65+column)*.54;
      const ledge=(j===2||j===4)?Math.sin(k*1.7+column)*1.1:0;
      return new Vector3(Math.cos(angle)*off+Math.cos(a)*r+shiftX,height*j/5+(j===5?Math.sin(k*1.8)*1.1:ledge),Math.sin(angle)*off+Math.sin(a)*r+shiftZ);
    }));
    for(let j=0;j<5;j++)for(let k=0;k<11;k++)b.quad(rings[j][k],rings[j][(k+1)%11],rings[j+1][(k+1)%11],rings[j+1][k],13,3.3,height/5);
    const top=new Vector3(Math.cos(angle)*off,height-.15,Math.sin(angle)*off);
    for(let k=0;k<11;k++)b.triangle(rings[5][k],rings[5][(k+1)%11],top,13,[[0,0],[1,0],[.5,1]]);
    // Small red plants collect on fracture ledges; their scale makes the faces
    // read as cliffs with shelves rather than oversized featureless crystals.
    for(let shelf=0;shelf<3;shelf++) {
      const origin=rings[2+shelf][(column*3+shelf*4)%11].clone().add(new Vector3(0,.06,0));
      const spread=.38+.1*shelf;
      for(let f=0;f<3;f++) {
        const turn=f*2.4+column;
        const tip=origin.clone().add(new Vector3(Math.cos(turn)*spread,.65+.17*f,Math.sin(turn)*spread));
        b.tube([origin,tip],[.035,.012],15,4);
        addReedLeaf(b,origin.clone().lerp(tip,.55),.6,turn+.9,.15,15);
        addReedLeaf(b,origin.clone().lerp(tip,.82),.43,turn-.8,.12,15);
      }
    }
    // Overlapping, asymmetric umbrella crowns read as a living canopy, not
    // a flat cap. Thin trailing roots hang down the exposed ledges.
    if(column<4)for(let tree=0;tree<3;tree++) {
      const ta=tree*2.4+column,root=top.clone().add(new Vector3(Math.cos(ta)*2.1,0,Math.sin(ta)*2.1));
      const crown=root.clone().add(new Vector3(.3,3.1+tree*.65,0));
      const fork=root.clone().lerp(crown,.65);
      b.tube([root,fork,crown],[.19,.12,.075],14,5);
      for(let cluster=0;cluster<3;cluster++) {
        const centre=crown.clone().add(new Vector3(Math.cos(cluster*2.6)*1.4,cluster*.31+.12*Math.sin(column+tree),Math.sin(cluster*2.6)*1.25));
        b.tube([fork,fork.clone().lerp(centre,.5).add(new Vector3(.25,-.12,0)),centre],[.095,.07,.035],14,4);
        const rim=Array.from({length:14},(_,k)=>{
          const a=(k+.12*Math.sin(k*2.1+tree))/14*Math.PI*2;
          const lobes=1+.12*Math.sin(k*2.7+tree)+.07*Math.cos(k*4.3+column);
          const r=(2.2+cluster*.3)*lobes;
          return centre.clone().add(new Vector3(Math.cos(a)*r,.2*Math.sin(k*1.3+cluster)+.12*Math.cos(a+tree),Math.sin(a)*r));
        });
        const crownRings=[[-.36,.59],[0,1],[.67,.82],[1.13,.34]].map(([y,scale])=>rim.map(point=>centre.clone().addScaledVector(point.clone().sub(centre),scale).add(new Vector3(0,y,0))));
        for(let k=0;k<rim.length;k++) {
          const next=(k+1)%rim.length;
          for(let level=0;level<3;level++) b.quad(crownRings[level][k],crownRings[level][next],crownRings[level+1][next],crownRings[level+1][k],14);
          b.triangle(centre.clone().add(new Vector3(-.15,1.22,.1)),crownRings[3][k],crownRings[3][next],14);
          b.triangle(centre.clone().add(new Vector3(0,-.43,0)),crownRings[0][next],crownRings[0][k],14);
        }
        if(cluster===0)for(let vine=0;vine<3;vine++) {
          const hang=rim[vine*3];
          b.tube([hang,hang.clone().add(new Vector3(.12,-2.1-vine*.7,.15))],[.045,.018],14,4);
        }
      }
    }
  }
  return b.build();
}

/** Four thin ivory petal wings around one small gold thorax. */
export function lampPetalGeometry(): BufferGeometry {
  const b = new CanyonGeometry();
  b.tube([new Vector3(0,-0.015,-0.08),new Vector3(0,0.015,0.07),new Vector3(0,0,0.13)],[0.018,0.025,0.014],11,6);
  b.tube([new Vector3(-0.026,0.016,0.086),new Vector3(-0.026,0.016,0.107)],[0.018,0.018],6,6);
  b.tube([new Vector3(0.026,0.016,0.086),new Vector3(0.026,0.016,0.107)],[0.018,0.018],6,6);
  for (let wing = 0; wing < 4; wing++) {
    const side = wing < 2 ? -1 : 1;
    const forward = wing % 2 === 0 ? 1 : -1;
    const root = new Vector3(side * 0.018,0,forward * 0.024);
    const tip = new Vector3(side * 0.23,0.015,forward * 0.16);
    const axis=tip.clone().sub(root),across=new Vector3(-axis.z,0,axis.x).normalize();
    const point=(u: number,t: number): Vector3 => root.clone().addScaledVector(axis,t)
      .addScaledVector(across,u*.072*Math.pow(Math.sin(t*Math.PI),.72))
      .add(new Vector3(0,(1-Math.abs(u))*.015*Math.sin(t*Math.PI),0));
    for(let row=0;row<10;row++)for(const [a,c] of [[-1,0],[0,1]]) {
      const t=row/10,next=(row+1)/10;
      b.triangle(point(a,t),point(c,t),point(c,next),10,[[(a+1)/2,t],[(c+1)/2,t],[(c+1)/2,next]]);
      b.triangle(point(a,t),point(c,next),point(a,next),10,[[(a+1)/2,t],[(c+1)/2,next],[(a+1)/2,next]]);
    }
  }
  return b.build();
}
