import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { WindGeometry } from './windGeometry';

export type WildlifeSpecies = 'sailback' | 'kitelet' | 'sand-stitcher';
export const WILDLIFE_SPECIES = ['sailback', 'kitelet', 'sand-stitcher'] as const;
// Proposed anatomy dimensions in metres, kept separate from the deliberately
// enlarged display used by this illustrated world (Scarlet handoff precedent).
export const WILDLIFE_SIZE = { sailback: 0.45, kitelet: 0.22, 'sand-stitcher': 0.14 } as const;
export const WILDLIFE_DISPLAY_SCALE = { sailback: 3, kitelet: 3, 'sand-stitcher': 3 } as const;
/** Crown of the physical seed-cup perches, before the flyer's foot offset. */
export const KITELET_PERCH_HEIGHT = 0.82;
export const WILDLIFE_FEET = {
  sailback: [[-0.053, -0.082], [0.053, -0.082], [-0.053, 0.078], [0.053, 0.078]],
  kitelet: [],
  'sand-stitcher': [[-0.038, -0.028], [0.038, -0.028], [-0.038, 0.03], [0.038, 0.03]],
} as const;
const P = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
// Blue plate, peach skin, ivory membrane, coral membrane, ink, fine rib, dry stem.
const BLUE = 0, PEACH = 1, IVORY = 2, CORAL = 3, INK = 4, RIB = 5, STEM = 6;

/** Each articulated part shares one material; aJoint/pivot make the rig cheap. */
class AnimalBuilder {
  private readonly pieces: Array<{ geometry: BufferGeometry; joint: number; pivot: Vector3 }> = [];
  part(joint: number, pivot: Vector3, make: (b: WindGeometry) => void): void {
    const b = new WindGeometry(); make(b);
    this.pieces.push({ geometry: b.build(), joint, pivot });
  }
  build(): BufferGeometry {
    const values: Record<string, number[]> = { position: [], normal: [], uv: [], aKind: [], aJoint: [], aPivot: [] };
    for (const { geometry, joint, pivot } of this.pieces) {
      for (const name of ['position', 'normal', 'uv', 'aKind']) values[name].push(...Array.from(geometry.getAttribute(name).array));
      for (let i = 0; i < geometry.getAttribute('position').count; i++) {
        values.aJoint.push(joint); values.aPivot.push(pivot.x, pivot.y, pivot.z);
      }
      geometry.dispose();
    }
    const geometry = new BufferGeometry();
    for (const [name, data] of Object.entries(values)) geometry.setAttribute(name, new Float32BufferAttribute(data, name === 'uv' ? 2 : name === 'aKind' || name === 'aJoint' ? 1 : 3));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Cross-section loft: flat belly, tapered shoulders and a blunt capped muzzle. */
function loft(b: WindGeometry, sections: readonly (readonly [number, number, number, number])[], kind: number, sides = 8, underside = kind): void {
  const rings = sections.map(([z, y, width, height]) => Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2;
    return P(Math.cos(a) * width, y + Math.sin(a) * height, z);
  }));
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides, colour = Math.sin((j + 0.5) / sides * Math.PI * 2) < -0.18 ? underside : kind;
    b.quad(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j], colour);
  }
  for (const end of [0, rings.length - 1]) for (let i = 0; i < sides; i++) {
    const c = P(0, sections[end][1], sections[end][0]);
    const colour = Math.sin((i + 0.5) / sides * Math.PI * 2) < -0.18 ? underside : kind;
    if (end === 0) b.triangle(c, rings[end][(i + 1) % sides], rings[end][i], colour);
    else b.triangle(c, rings[end][i], rings[end][(i + 1) % sides], colour);
  }
}

function eye(b: WindGeometry, at: Vector3, radius: number, side: number): void {
  const rim = Array.from({ length: 8 }, (_, i) => P(at.x, at.y + Math.cos(i * Math.PI / 4) * radius, at.z + Math.sin(i * Math.PI / 4) * radius));
  const tip = at.clone().add(P(side * radius * 0.38, 0, 0));
  for (let i = 0; i < 8; i++) b.triangle(rim[i], rim[(i + 1) % 8], tip, INK);
  const glint = at.clone().add(P(side * radius * 0.4, radius * 0.28, radius * 0.19));
  b.triangle(glint.clone().add(P(0, radius * 0.2, 0)), glint.clone().add(P(0, 0, radius * 0.19)), glint.clone().add(P(0, -radius * 0.16, 0)), IVORY);
}

/** One thin broad leaf, triangulated around a bowed midrib with fine real veins. */
function membrane(b: WindGeometry, corners: Vector3[], kind: number, ribRadius: number): void {
  const mid = corners[0].clone().lerp(corners[2], 0.5).add(P(0, 0.004, 0));
  // Bow the papery sheet between its four structural corners. The outline
  // remains a diamond/triangle while avoiding four visibly planar facets.
  const rim = corners.flatMap((corner, i) => [corner, corner.clone().lerp(corners[(i + 1) % 4], 0.5).add(P(0, 0.0015, 0))]);
  for (let i = 0; i < rim.length; i++) b.triangle(rim[i], rim[(i + 1) % rim.length], mid, kind, [[i / 8,0],[(i+1)/8,0],[0.5,1]]);
  b.tube([corners[0], mid, corners[2]], [ribRadius, ribRadius * 0.7, ribRadius * 0.25], RIB, 4);
  for (const t of [0.28, 0.48, 0.7]) for (const edge of [1, 3]) {
    const a = corners[0].clone().lerp(corners[2], t);
    const c = corners[0].clone().lerp(corners[edge], Math.min(1, t * 1.5));
    b.tube([a, c], [ribRadius * 0.45, ribRadius * 0.2], RIB, 3);
  }
}

function leg(b: WindGeometry, x: number, z: number, size: number, blue: boolean): void {
  const hip = P(x * 0.86, size * 0.9, z);
  b.tube([hip, P(x * 1.12, size * 0.48, z - size * 0.025), P(x, size * 0.18, z + size * 0.08)], [size * 0.35, size * 0.29, size * 0.22], blue ? BLUE : PEACH, 8);
  // Broad bevelled pads, not rectangular shoes or long stick shins.
  const rim = Array.from({ length: 8 }, (_, i) => P(x + Math.cos(i * Math.PI / 4) * size * 0.32, 0, z + size * 0.1 + Math.sin(i * Math.PI / 4) * size * 0.34));
  const top = rim.map(v => P(x + (v.x - x) * 0.82, size * 0.17, z + size * 0.1 + (v.z - z - size * 0.1) * 0.82));
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    b.quad(rim[i], top[i], top[j], rim[j], BLUE);
    b.triangle(top[i], P(x, size * 0.22, z + size * 0.1), top[j], BLUE);
  }
  // Three soft toe lobes make padded feet read at the displayed scale.
  for (const toe of [-1, 0, 1]) {
    const dx = x + toe * size * 0.17;
    const points = [P(dx,size*0.11,z+size*0.24),P(dx,size*0.085,z+size*0.38),P(dx,size*0.05,z+size*0.46)];
    b.tube(points,[size*0.11,size*0.10,size*0.045],BLUE,6);
  }
}

function sailback(): BufferGeometry {
  const a = new AnimalBuilder();
  a.part(0, P(0, 0, 0), b => {
    const body = [[-0.13, 0.053, 0.031, 0.023], [-0.08, 0.061, 0.061, 0.031], [0.04, 0.061, 0.057, 0.03], [0.11, 0.054, 0.032, 0.025]] as const;
    loft(b, body, BLUE, 12, PEACH);
    // Armour follows the body's actual curved cross sections. Earlier planar
    // lids cut through that surface, exposing peach over most of the back.
    const shellPoint = (z: number, angle: number): Vector3 => {
      let k = 0; while (k < body.length - 2 && z > body[k + 1][0]) k++;
      const p = body[k], q = body[k + 1], t = (z - p[0]) / (q[0] - p[0]);
      const y = p[1] + (q[1] - p[1]) * t, w = p[2] + (q[2] - p[2]) * t, h = p[3] + (q[3] - p[3]) * t;
      return P(Math.cos(angle) * (w + 0.002), y + Math.sin(angle) * (h + 0.003), z);
    };
    const seams = [-0.128, -0.088, -0.042, 0.005, 0.052, 0.108];
    for (let row = 0; row < seams.length - 1; row++) for (let band = 0; band < 6; band++) {
      const a0 = band / 6 * Math.PI, a1 = (band + 1) / 6 * Math.PI;
      const z0 = seams[row] + 0.001, z1 = seams[row + 1] - 0.001;
      b.quad(shellPoint(z0, a0), shellPoint(z0, a1), shellPoint(z1, a1), shellPoint(z1, a0), BLUE);
    }
    for (const z of seams.slice(1, -1)) {
      const points = Array.from({ length: 7 }, (_, i) => shellPoint(z, i / 6 * Math.PI));
      b.tube(points, points.map(() => 0.00045), RIB, 3);
    }
    loft(b, [[0.10, 0.052, 0.027, 0.019], [0.145, 0.06, 0.042, 0.025], [0.19, 0.055, 0.034, 0.021], [0.215, 0.052, 0.023, 0.012]], BLUE, 12, PEACH);
    for (const s of [-1, 1]) eye(b, P(s * 0.038, 0.065, 0.168), 0.008, s);
    // A straight, tapering plated tail completes the quadruped silhouette.
    loft(b, [[-0.235, 0.028, 0.0015, 0.0015], [-0.19, 0.038, 0.009, 0.007], [-0.13, 0.053, 0.031, 0.018]], BLUE, 8, PEACH);
  });
  WILDLIFE_FEET.sailback.forEach(([x, z], i) => a.part(i + 1, P(x, 0.048, z), b => leg(b, x, z, 0.052, true)));
  for (const [i, z] of [-0.075, 0.075].entries()) {
    const pivot = P(0, 0.094, z);
    a.part(5 + i, pivot, b => membrane(b, [pivot.clone().add(P(0, 0, 0.028)), pivot.clone().add(P(0.003, 0.09, 0.003)), pivot.clone().add(P(0, 0.173 - i * 0.016, -0.10)), pivot.clone().add(P(-0.005, 0.035, -0.088))], IVORY, 0.001));
  }
  return a.build();
}

function kitelet(): BufferGeometry {
  const a = new AnimalBuilder();
  a.part(0, P(0, 0, 0), b => {
    loft(b, [[-0.026, 0, 0.002, 0.003], [-0.01, 0, 0.012, 0.008], [0.018, 0, 0.011, 0.009], [0.026, 0, 0.006, 0.006]], IVORY);
    for (const s of [-1, 1]) eye(b, P(s * 0.0106, 0.002, 0.016), 0.0028, s);
    for (const s of [-1, 1]) b.tube([P(s * 0.004, -0.004, -0.003), P(s * 0.01, -0.014, 0.005)], [0.0013, 0.0007], RIB, 4);
  });
  for (const [i, [s, z]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
    const root = P(s * 0.006, 0, z * 0.005);
    a.part(5 + i, root, b => membrane(b, [root, P(s * 0.042, 0.004, z * 0.069), P(s * 0.11, 0.008, z * 0.087), P(s * 0.077, 0.004, z * 0.012)], CORAL, 0.0007));
  }
  return a.build();
}

function stitcher(): BufferGeometry {
  const a = new AnimalBuilder();
  a.part(0, P(0, 0, 0), b => {
    // The hidden torso is flattened under the tapered shell rims. Keep the
    // same belly contour and widths; extra upper skin must not pierce the
    // blue panels at their front/rear ends. The separate face is unchanged.
    loft(b, [[-0.062, 0.029, 0.013, 0.006], [-0.038, 0.0295, 0.04, 0.0105], [0.027, 0.0295, 0.039, 0.0105], [0.055, 0.0265, 0.022, 0.0095]], PEACH);
    // Exactly two convex shell panels, with a narrow exposed split seam.
    // Five lengthwise sections round the front/rear rather than making a lid.
    for (const s of [-1, 1]) {
      const sections = [[-0.061, 0.017, 0.041], [-0.042, 0.039, 0.061], [-0.012, 0.044, 0.068], [0.022, 0.042, 0.064], [0.043, 0.027, 0.044]];
      const at = (i: number, band: number): Vector3 => {
        const [z, width, crown] = sections[i], angle = band / 4 * Math.PI / 2;
        return P(s * (0.0014 + Math.sin(angle) * width), 0.028 + (crown - 0.028) * Math.cos(angle), z);
      };
      for (let i = 0; i < sections.length - 1; i++) for (let band = 0; band < 4; band++) {
        if (s > 0) b.quad(at(i, band), at(i + 1, band), at(i + 1, band + 1), at(i, band + 1), BLUE);
        else b.quad(at(i, band + 1), at(i + 1, band + 1), at(i + 1, band), at(i, band), BLUE);
      }
    }
    loft(b, [[0.04, 0.03, 0.014, 0.011], [0.055, 0.03, 0.022, 0.016], [0.068, 0.029, 0.02, 0.014], [0.078, 0.027, 0.012, 0.008]], PEACH, 12);
    for (const s of [-1, 1]) eye(b, P(s * 0.021, 0.035, 0.061), 0.0048, s);
  });
  WILDLIFE_FEET['sand-stitcher'].forEach(([x, z], i) => a.part(i + 1, P(x, 0.025, z), b => leg(b, x, z, 0.027, false)));
  // One straight dry stem, held crosswise and lowered intact during placement.
  a.part(9, P(0, 0.028, 0.078), b => b.tube([P(-0.069, 0.022, 0.085), P(0.069, 0.034, 0.085)], [0.0017, 0.0012], STEM, 5));
  return a.build();
}

export function wildlifeGeometry(species: WildlifeSpecies): BufferGeometry {
  const geometry = species === 'sailback' ? sailback() : species === 'kitelet' ? kitelet() : stitcher();
  geometry.name = `${species}: reference anatomy in metres`;
  return geometry;
}

/** Physical landing and litter-catching surfaces, in displayed world metres. */
export function wildlifeHabitatGeometry(species: 'kitelet' | 'sand-stitcher'): BufferGeometry {
  const a = new AnimalBuilder();
  a.part(0, P(0,0,0), b => {
    if (species === 'kitelet') {
      const h = KITELET_PERCH_HEIGHT;
      b.tube([P(-0.18,0,0.06),P(-0.17,h*0.4,0.03),P(-0.08,h*0.78,-0.06),P(0,h,0)],[0.024,0.017,0.011,0.006],STEM,7);
      // A cupped leaf, not a circular platform. Its bowed midrib provides the
      // exact landing point while each stand turns and scales independently.
      const centre=P(0,h,0);
      const rim=[P(-0.08,h-0.17,-0.16),P(0.12,h+0.025,-0.035),P(0.035,h+0.13,0.19),P(-0.13,h+0.018,0.025)];
      for(let i=0;i<4;i++) b.triangle(centre,rim[i],rim[(i+1)%4],IVORY);
      b.tube([rim[0],centre.clone().add(P(0,-0.003,0)),rim[2]],[0.004,0.0025,0.001],RIB,4);
      membrane(b,[P(-0.16,h*0.4,0.03),P(-0.28,h*0.61,0.035),P(-0.34,h*0.88,-0.05),P(-0.14,h*0.57,-0.04)],IVORY,0.0025);
    } else {
      // Low coral roots hold three older stems. A fourth is placed during the
      // carry cycle; all remain world-anchored instead of following the mouth.
      for(const side of [-1,1]) for(let i=0;i<3;i++) {
        const x=side*(0.19+i*0.045),z=0.23+i*0.09;
        b.tube([P(x,0,z),P(x*0.96,0.13+i*0.035,z+0.035),P(x+side*0.045,0.22+i*0.025,z+0.02)],[0.021,0.013,0.004],7,6);
      }
      for(let i=0;i<3;i++) b.tube([P(-0.24+i*0.015,0.021+i*0.008,0.33+i*0.1),P(0.24-i*0.01,0.047+i*0.01,0.35+i*0.1)],[0.005,0.004],STEM,5);
    }
  });
  if(species==='sand-stitcher') a.part(9,P(0,0,0),b=>b.tube([P(-0.207,0.021,0.255),P(0.207,0.057,0.255)],[0.0051,0.0036],STEM,5));
  const geometry=a.build(); geometry.name=`${species} physical habitat`; return geometry;
}
