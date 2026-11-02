import { Vector3, type BufferGeometry } from 'three';
import { WindGeometry } from './windGeometry';

/** A small branching volume for coral beyond the close-view mesh range.
 * It uses the exact same accepted roots as detailed plants, so paths, colony
 * edges and gaps survive from ground level to the whole-planet view. */
export function distantCoralGeometry(): BufferGeometry {
  const b=new WindGeometry();
  const p=(x:number,y:number,z=0):Vector3=>new Vector3(x,y,z);
  const paths=[
    [p(0,0),p(.015,.37),p(-.02,.82)],
    [p(.01,.20),p(-.23,.40,.025),p(-.42,.71,.045)],
    [p(.01,.32),p(.24,.48,-.035),p(.42,.79,-.025)],
    [p(0,.56),p(-.14,.66,-.02),p(-.19,.88)],
  ];
  for(const path of paths) {
    b.tube(path,[.045,.036,.025],3,3);
    // Tiny end caps retain blunt branch ends from above as well as the side.
    const tip=path[2],tangent=tip.clone().sub(path[1]).normalize();
    const across=new Vector3().crossVectors(tangent,p(0,0,1)).normalize();
    const other=new Vector3().crossVectors(tangent,across).normalize();
    const ring=Array.from({length:3},(_,i)=>tip.clone()
      .addScaledVector(across,Math.cos(i*Math.PI*2/3)*.025)
      .addScaledVector(other,Math.sin(i*Math.PI*2/3)*.025));
    b.triangle(ring[0],ring[1],ring[2],3);
  }
  const geometry=b.build();geometry.name='Distant branching coral';
  geometry.computeBoundingBox();return geometry;
}
