import { JOINT, JOINTS, openness, packWeights, SKIN_INSET, smooth01, smoothWeights, type MuseBody, type MuseFit } from './museBody';
import { MeshField, type Box } from './meshField';
import { MuseRig } from './museRig';

// Muse from a sculpted mesh (an export from Tripo3D, say: reference/muse/,
// kept out of git), rigged on Muse's skeleton as it was sculpted and painted
// in the same shaders as the procedural body (museBody.ts).
//
// The sculpt is kept as it was made, so Muse standing is exactly Tripo's.
// Its body is coarse (1.3k vertices), so each triangle is refined into nine
// on the curved surface its normals describe (PN triangles): the outline
// stays round, and a stretched shoulder has vertices to spread over.
//
// Its arms hang grown into its sides from the elbow to the shoulder (Tripo's
// from 0.37 to 0.5 of the height): the arm's inner side and the body's side
// are one surface there. Each arm is found by the crease round it, a minimum
// cut of the body's surface between the hanging arm and the body away from
// it, every edge costing its length and far less where the surface folds
// inward: the cut runs along the crease and closes over the top of the
// shoulder the shortest way. The arm's weight rises from nothing at the cut
// to all of it a few centimetres in (along the surface), and the arm turns
// about the top of its root, so a raised arm goes up beside the hood and
// draws the skin it grew from up out of the side in one taut slope, as a
// plush's fabric goes (reference 6), the side itself staying where it is.
// The joints' matrices are blended (muse.vert.glsl): blended turns would
// swing that stretched skin out round the shoulder in a lump.
//
// Its eyes and mouth are left out: Muse's own are painted on the face's
// plate (muse.frag.glsl), so it blinks and smiles. Each vertex takes the
// sculpt's colour from its paint. The sculpt is the outside of a plush's
// coat, as the reference's silhouette is, so it is brought in by the fur's
// depth along its normals and the shells carry it back out; the face's plate
// keeps its place and grows no fur, and the coat thins to nothing where it
// meets it.

export interface MuseMesh extends MuseBody {
  /** The sculpt's colour at each vertex (linear), from its own paint. */
  colour: Float32Array;
  /**
   * The wave's corrective: at the top of a wave, how far each vertex moves
   * from where the joints take it (H, in the chest's frame), and the skin's
   * normal there, its length how much of it to take (muse.vert.glsl). Only
   * for a sculpt whose arms grew into its sides (Sculpt.corrective).
   */
  raise?: Float32Array;
  raiseNormal?: Float32Array;
  /** And the open sky over it there: a crease the raised arm stretches open is no longer shut in. */
  raiseOpen?: Float32Array;
  /**
   * A T-pose sculpt's hung corrective (rest space, H): how far each vertex
   * about the arms' roots moves before skinning so the hung arms' roots come
   * out ironed, and the normal it should have there (muse.vert.glsl: full
   * on a hanging arm, gone from the left as it rises into a wave).
   */
  hang?: Float32Array;
  hangNormal?: Float32Array;
  /** The fur's lie along the skin (rest space): the way its strands lean over, its length how far (muse.vert.glsl). */
  comb?: Float32Array;
}

/**
 * A sculpt of Muse and how it sits on the skeleton: its fit (joints, H,
 * measured off it; how its arms hang and wave); where its arms' cut is
 * seeded (H, the left arm; the right mirrors it): the arm's own (out past
 * x, between two heights), and the body well away from it (in from x, below
 * or above two heights, ahead of or behind two depths); and whether a raised
 * arm needs the wave's corrective (an arm grown into the side does).
 */
export interface Sculpt {
  fit: MuseFit;
  cut: { arm: { x: number; y: readonly [number, number] }; body: { x: number; y: readonly [number, number]; z: readonly [number, number] } };
  /** Over how far into an arm from its cut its weight rises (H, along the surface). */
  ramp: number;
  /** Into how many each edge is cut (PN triangles): the body's, and the face's pieces' (still, and seen square on). */
  refine: { body: number; face: number };
  corrective: boolean;
  /** Whether its right arm is re-laid along its left's mirror (mirrorArmPath): where the sculpt's arms are curved unalike. */
  mirrorArm?: boolean;
}

/**
 * The shoulders of a sculpt in a T-pose: the share of each arm's turn its
 * shoulder takes; on the body round the root, how much of it the shoulder
 * carries at the cut (and the arm's root with it), fading out over this far
 * (H, along the skin); and over how far either side of the arm's axis that
 * share gives way to none on the side under the arm (H).
 */
const SHOULDER = { share: 0.35, body: 0.5, reach: 0.07, under: 0.05 } as const;

const SPINE = [
  [0, 0, 0],
  [0, 0.14, 0],
  [0, 0.36, 0],
  [0, 0.55, 0],
  [0, 0.7, 0],
] as const;

export const SCULPTS = {
  /**
   * Tripo's first, made with its arms hanging, grown into its sides from the
   * elbow to the shoulder: each upper arm turns about the top of its root,
   * where the arm's axis (fitted through the hanging arm, which leans forward
   * as it goes down) meets the side; the elbow a little above the armpit. It
   * is bound as it hangs and hangs as bound. At the top of a wave the arm is
   * up beside the hood, nearly upright, brought back from its forward lean,
   * the elbow barely bent, as in reference 6.
   */
  tripo: {
    fit: {
      rest: [...SPINE, [0.3, 0.5, -0.01], [0.343, 0.33, 0.05], [-0.3, 0.5, -0.01], [-0.343, 0.33, 0.05], [0.133, 0.14, -0.01], [-0.133, 0.14, -0.01], [0.18, 0.5, -0.01], [-0.18, 0.5, -0.01]],
      bind: { x: 0, z: 0, fore: 0 },
      hang: { x: 0, z: 0, fore: 0 },
      wave: { x: -0.25, y: 0, z: 2.7, fore: 0.15 },
    },
    cut: { arm: { x: 0.3, y: [0, 0.3] }, body: { x: 0.18, y: [-1, 0.62], z: [-0.2, 0.24] } },
    ramp: 0.09,
    refine: { body: 3, face: 2 },
    corrective: true,
  },
  /**
   * Tripo's again, made in a T-pose: the arms straight out from the
   * shoulders, horizontal (their axis 0.56 up, a paddle 0.14 tall and 0.18
   * deep), clear of the sides with an armpit under each. Each upper arm turns
   * about its root, where it leaves the body; the elbow halfway out. It hangs
   * its arms down beside the belly a little out from it and forward, as
   * Tripo's first hung; at the top of a wave the upper arm is up and out
   * beside the hood and the forearm stands upright on it, the mitten at the
   * top of the face, as in reference 6.
   */
  tpose: {
    fit: {
      rest: [...SPINE, [0.26, 0.563, 0.005], [0.42, 0.563, 0.005], [-0.26, 0.563, 0.005], [-0.42, 0.563, 0.005], [0.133, 0.14, 0.01], [-0.133, 0.14, 0.01], [0.15, 0.563, 0.005], [-0.15, 0.563, 0.005]],
      bind: { x: 0, z: 0, fore: 0 },
      hang: { x: -0.15, z: -1.25, fore: 0 },
      wave: { x: 0, y: 0, z: 0.95, fore: 0.63 },
      reach: 0.08,
      shoulder: SHOULDER.share,
    },
    cut: { arm: { x: 0.45, y: [0, 1] }, body: { x: 0.18, y: [0.42, 0.72], z: [-0.16, 0.18] } },
    ramp: 0.15,
    refine: { body: 2, face: 1 },
    corrective: false,
  },
  /**
   * Tripo's T-pose again, regenerated: denser, its arms longer (0.39 from
   * root to tip, as long as the references') and rounder (0.15 tall, 0.2
   * deep), their axis 0.52 up and a little forward, a tail at its back. Each
   * upper arm turns about its root, the elbow halfway out; hung and waved as
   * the first T-pose, with no lengthening.
   */
  tpose2: {
    fit: {
      rest: [...SPINE, [0.26, 0.52, 0.03], [0.46, 0.515, 0.035], [-0.26, 0.52, 0.03], [-0.46, 0.515, 0.035], [0.134, 0.14, 0.008], [-0.134, 0.14, 0.008], [0.15, 0.52, 0.03], [-0.15, 0.52, 0.03]],
      bind: { x: 0, z: 0, fore: 0 },
      hang: { x: -0.15, z: -1.25, fore: 0 },
      wave: { x: 0, y: 0, z: 0.95, fore: 0.63 },
      shoulder: SHOULDER.share,
    },
    cut: { arm: { x: 0.5, y: [0, 1] }, body: { x: 0.18, y: [0.4, 0.7], z: [-0.16, 0.2] } },
    ramp: 0.15,
    refine: { body: 2, face: 2 },
    corrective: false,
  },
  /**
   * Tripo's again, in an A-pose: its arms come down from the shoulders at
   * 38° below level and well forward (their axis along (0.36, −0.62, 0.70)),
   * clear of the sides; even quads, a texture, the face's plate a piece of
   * its own. Hung and waving are both a moderate turn from it (hung is the
   * nearer, as Muse stands most): the turns solved so the arm lies along the
   * hang's direction (down along the front of the belly's side, as in
   * reference 1, its long arm brought in and forward) and,
   * waving, the upper arm up and out beside the hood, a little forward (so
   * its back is not pressed into the body behind), with the forearm upright,
   * the shoulder's share included.
   */
  tpose5: {
    fit: {
      rest: [...SPINE, [0.383, 0.515, -0.075], [0.466, 0.373, 0.086], [-0.383, 0.515, -0.075], [-0.466, 0.373, 0.086], [0.127, 0.14, 0.02], [-0.127, 0.14, 0.02], [0.18, 0.5, -0.05], [-0.18, 0.5, -0.05]],
      bind: { x: 0, z: 0, fore: 0 },
      hang: { x: 0.184, z: -0.464, fore: 0 },
      wave: { x: -0.419, y: 0.332, z: 2.15, fore: 0.7 },
      shoulder: SHOULDER.share,
    },
    cut: { arm: { x: 0.45, y: [0, 1] }, body: { x: 0.2, y: [0.15, 0.72], z: [-0.2, 1] } },
    ramp: 0.15,
    refine: { body: 2, face: 2 },
    corrective: false,
  },
  /**
   * Tripo's again, in a near T-pose with chunky arms: each straight out from
   * the side, 14° below level and a touch back (its axis along (0.964,
   * −0.248, −0.099)), round, 0.19 tall and 0.18 deep from root to mitten, as
   * thick as the references'. Its arms are not each other's mirror: the left
   * slopes down 16° to an elbow at 0.46 out and runs on level; the right
   * starts steeper (27°) and forward and curves round 26°, so it is re-laid
   * along the left's mirror (mirrorArmPath), and the elbow sits on the left's
   * bend. The wave is now the nearer pose (about 70° up)
   * and hanging the farther (about 75° down). The turns solved as tpose5's,
   * fitted to references 1 and 6 (the hang down and a little out and
   * forward; the wave's upper arm up and out, the forearm upright); its arm a
   * little shorter than reference 6's, so it stretches a little as it
   * reaches up.
   */
  tpose6: {
    fit: {
      rest: [...SPINE, [0.28, 0.49, -0.018], [0.44, 0.444, -0.029], [-0.28, 0.49, -0.018], [-0.44, 0.444, -0.029], [0.12, 0.14, -0.01], [-0.12, 0.14, -0.01], [0.15, 0.49, -0.018], [-0.15, 0.49, -0.018]],
      bind: { x: 0, z: 0, fore: 0 },
      hang: { x: -0.426, z: -0.958, fore: -0.3 },
      wave: { x: 0.299, y: -0.246, z: 1.252, fore: 0.532, reach: 0.04 },
      shoulder: SHOULDER.share,
    },
    cut: { arm: { x: 0.45, y: [0, 1] }, body: { x: 0.2, y: [0.3, 0.68], z: [-0.2, 0.2] } },
    ramp: 0.07,
    refine: { body: 2, face: 2 },
    corrective: false,
    mirrorArm: true,
  },
} as const satisfies Record<string, Sculpt>;
export type SculptKind = keyof typeof SCULPTS;

/** How deep the coat is over a sculpt's skin (H): the sculpt is the coat's outside, as the references' silhouettes are, and the shells (muse.vert.glsl: FUR_LENGTH, lying over) carry it back out. */
const COAT = 0.026;
/** How many rounds the normals are smoothed for the coat's inset (smoothField): over a few times the coat's depth. */
const COAT_SMOOTH = 24;
/**
 * An arm's centreline (mirrorArmPath): its first section this far out from
 * the middle (H, past the body's side), the sections' step (H), a section
 * thinner than this up and down is the mitten's end (H), how many rounds it
 * is smoothed; and over how far from the root the re-laying eases in (H).
 */
const ARM_PATH = { from: 0.3, step: 0.01, end: 0.05, smooth: 2, ease: 0.04 } as const;
/**
 * The right side made the left's mirror (mirrorSide): nothing within this far
 * of the middle (H), easing in over as much again; the mirrored surface's box
 * (the whole right side) and voxels (H); and its weights and corrections the
 * left's mirrored (mirrorMap) past this far from the middle, easing in over
 * as much again (H).
 */
const MIRROR = { middle: 0.06, side: { x: [-0.72, 0.02], y: [-0.03, 1.03], z: [-0.42, 0.42] } as Box, voxel: 0.01, weights: 0.03 } as const;
/** A sculpt's small folds filled (fillFolds): the rings round them filled too, and how many rounds at most. */
const FOLDS = { rings: 2, rounds: 3 } as const;
/** A piece of a sculpt with fewer vertices than this is a stray scrap, left out. */
const STRAY = 30;
/** The arms' cut: over how many degrees of inward fold an edge's cost falls away. */
const FOLD = 10;
/** How broadly the elbow bends (H along the arm, each way). */
const ELBOW = 0.06;
/**
 * The face's plate made smooth (ironPlate): its depth fitted out to this
 * share of the way to its rim (an ellipse about its middle), set wholly onto
 * the fit inside the middle share, eased back to the sculpt's own by the
 * fit's reach; how far off the fit (H) a point starts to count for less;
 * and how deep a carved feature runs (H): the plate is set onto the fit
 * only that near it, eased off over as much again.
 */
const PLATE = { fit: 0.8, middle: 0.55, tolerance: 0.002, carved: 0.005 } as const;
/** The arms' roots' fixes (rootFixes): the band about each cut they correct (H, either side of it, then fading over the next). */
const ROOT = { band: 0.12, fade: 0.06 } as const;
/** The thin plate over the arms' roots (thinPlate): how far past the weights' blend its region reaches over the body (H, along the skin), hung and raised, and how many passes. */
const FILL = { margin: 0.01, raised: 0.12, passes: 600 } as const;
/** The fur's lie (combField): how many rounds it is smoothed, and how clear the way must be for it to lie fully over (its length before normalising). */
const COMB = { rounds: 6, clear: 0.35 } as const;
/** The stretch evened out over the arms' roots (evenOut): how many rounds, how far each step goes, how often the skin is set back onto the surface, and the surface's voxels (H). */
const EVEN = { rounds: 60, step: 0.9, settle: 6, voxel: 0.01 } as const;
/** How many rounds a harmonic weight is relaxed (harmonic): enough to settle across a band a dozen edges wide. */
const HARMONIC_ROUNDS = 400;
/** How many rounds the weights are averaged over the refined skin's neighbours (a ramp read along its edges zigzags). */
const WEIGHT_ROUNDS = 6;
/** A leg (H): its own over its foot's oval round its axis (half across, half along: Tripo's feet reach forward), fading over the next share of it; up to the hip, over a blend. */
const LEG = { across: 0.11, along: 0.17, fade: 0.35, hip: 0.06, blend: 0.1 } as const;
/**
 * The wave's corrective (H): the skin it may move, over this far into the
 * arm and out over the body from the cut, fading over the next; the body's
 * field's voxels; how many rounds the push is smoothed over the skin, and
 * the stretched skin ironed.
 */
const RAISE = { arm: 0.12, body: 0.05, fade: 0.05, voxel: 0.01, smooth: 4, iron: 8 } as const;
/** The window the left arm's socket is filled over (fillSocket): heading about the upright axis (rad, 0 out to Muse's left, + forward), height (H), their steps, and how many steps of the crease round it are filled too. */
const SOCKET = { heading: [-0.75, 0.85], height: [0.3, 0.68], step: { heading: 0.03, height: 0.01 }, crease: 3 } as const;
/** The field for the creases' shade (voxel, H), and its box. */
const VOXEL = 0.012;
const BOX: Box = { x: [-0.62, 0.62], y: [-0.03, 1.03], z: [-0.42, 0.42] };
/** Over how far from the face's plate the coat grows to its full length (H), and how near a point lies on it (H); where to look for the plate. */
const FACE_EDGE = 0.04;
const ON_FACE = 0.006;
const FACE_BOX: Box = { x: [-0.3, 0.3], y: [0.55, 1.0], z: [-0.15, 0.32] };

export type ColourAt = (u: number, v: number, out: number[]) => void;

export function rigSculpt(position: ArrayLike<number>, normal: ArrayLike<number>, uv: ArrayLike<number>, index: ArrayLike<number>, colourAt?: ColourAt, sculpt: Sculpt = SCULPTS.tripo): MuseMesh {
  const count = position.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], position[i * 3 + a]);
      hi[a] = Math.max(hi[a], position[i * 3 + a]);
    }
  }
  const scale = 1 / (hi[1] - lo[1]);
  const centre = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];

  // weld across the seams: one id per position, its normal the mean of its copies'
  const ids = new Map<string, number>();
  const weld = new Int32Array(count);
  const welded: number[] = [];
  const sums: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = (position[i * 3] - centre[0]) * scale;
    const y = (position[i * 3 + 1] - centre[1]) * scale;
    const z = (position[i * 3 + 2] - centre[2]) * scale;
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let id = ids.get(key);
    if (id === undefined) {
      ids.set(key, (id = ids.size));
      welded.push(x, y, z);
      sums.push(0, 0, 0);
    }
    weld[i] = id;
    for (let a = 0; a < 3; a++) sums[id * 3 + a] += normal[i * 3 + a];
  }
  const P = Float64Array.from(welded);
  const N = Float64Array.from(sums);
  for (let i = 0; i < ids.size; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) N[i * 3 + a] /= l;
  }

  // the pieces: welded positions joined by triangles
  const parent = Int32Array.from({ length: ids.size }, (_, k) => k);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < index.length; t += 3) {
    const b = find(weld[index[t + 1]]);
    parent[find(weld[index[t]])] = b;
    parent[find(weld[index[t + 2]])] = b;
  }
  // each piece's box: the body is the one reaching from the feet to the top; the face's plate the widest
  // across in front of the face; the eyes, the mouth and the like the pieces set on it (inside its box):
  // those are left out, Muse's own painted in their place; anything else (a tail, say) is the body's
  const box = new Map<number, number[]>();
  for (let i = 0; i < ids.size; i++) {
    const r = find(i);
    const b = box.get(r) ?? [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let a = 0; a < 3; a++) {
      b[a * 2] = Math.min(b[a * 2], P[i * 3 + a]);
      b[a * 2 + 1] = Math.max(b[a * 2 + 1], P[i * 3 + a]);
    }
    box.set(r, b);
  }
  const size = (r: number, a: number): number => {
    const b = box.get(r) ?? [0, 0, 0, 0, 0, 0];
    return b[a * 2 + 1] - b[a * 2];
  };
  let body = -1;
  for (const r of box.keys()) if (body < 0 || size(r, 1) > size(body, 1)) body = r;
  let face = -1;
  for (const [r, b] of box) if (r !== body && b[5] > 0.1 && b[3] > 0.6 && (face < 0 || size(r, 0) * size(r, 1) > size(face, 0) * size(face, 1))) face = r;
  const on = box.get(face);
  const vertices = new Map<number, number>();
  for (let i = 0; i < ids.size; i++) vertices.set(find(i), (vertices.get(find(i)) ?? 0) + 1);
  const feature = (r: number): boolean => {
    const b = box.get(r);
    if (r === body || r === face || !b) return false;
    // (and any stray scrap a few vertices big)
    if ((vertices.get(r) ?? 0) < STRAY) return true;
    return !!on && b[0] > on[0] - 0.02 && b[1] < on[1] + 0.02 && b[2] > on[2] - 0.02 && b[3] < on[3] + 0.02;
  };
  const bodyTriangles: number[] = [];
  const faceTriangles: number[] = [];
  const bodyCorners: number[] = [];
  const faceCorners: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const r = find(weld[index[t]]);
    if (feature(r)) continue;
    const [triangles, corners] = r === face ? [faceTriangles, faceCorners] : [bodyTriangles, bodyCorners];
    triangles.push(weld[index[t]], weld[index[t + 1]], weld[index[t + 2]]);
    corners.push(index[t], index[t + 1], index[t + 2]);
  }

  // the face's plate ironed: a sculpt may have its own mouth carved into it, which would show under the paint
  ironPlate(P, N, faceTriangles);
  // and the body's small folds filled (a mitten's thumb notch, crumpled: its crease would shade dark under the coat)
  fillFolds(P, N, bodyTriangles);
  // each arm cut out of the body by its crease; the right re-laid along the left's mirror where the sculpt asks
  const cuts = [cutArm(P, bodyTriangles, 1, sculpt.cut), cutArm(P, bodyTriangles, -1, sculpt.cut)];
  if (sculpt.mirrorArm) {
    mirrorArmPath(P, N, bodyTriangles, cuts[0], cuts[1]);
    mirrorSide(P, N, bodyTriangles);
    // (its crease now where the left's is, mirrored)
    cuts[1] = cutArm(P, bodyTriangles, -1, sculpt.cut);
  }

  // refined, the body and the face apart (a vertex of the face's never shares a body's)
  const fine = new Fine();
  fine.add(P, N, bodyTriangles, bodyCorners, uv, sculpt.refine.body, false);
  const bodyFine = fine.index.length / 3;
  fine.add(P, N, faceTriangles, faceCorners, uv, sculpt.refine.face, true);
  const total = fine.position.length / 3;
  const pos = Float32Array.from(fine.position);
  const nrm = Float32Array.from(fine.normal);
  const fineIndex = total < 65536 ? Uint16Array.from(fine.index) : Uint32Array.from(fine.index);
  const neighbours = adjacency(total, fineIndex);

  // each arm cut out of the body by its crease, its weight rising from the cut into it
  const J = JOINT;
  const full = new Float32Array(total * JOINTS);
  const armShare = new Float32Array(total);
  const left = { cut: new Float32Array(0), inside: new Float32Array(0), along: new Float32Array(0) };
  const roots: { inside: Float32Array; along: Float32Array }[] = [];
  const graded = sculpt.fit.shoulder !== undefined;
  for (const [side, upper, fore, shoulder] of [
    [1, J.upperArmL, J.foreArmL, J.shoulderL],
    [-1, J.upperArmR, J.foreArmR, J.shoulderR],
  ] as const) {
    const cut = cuts[side === 1 ? 0 : 1];
    const inside = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      for (let k = 0; k < 3; k++) inside[i] += fine.share[i * 3 + k] * cut[fine.from[i * 3 + k]];
    }
    const along = inward(pos, neighbours, inside);
    if (side === 1) Object.assign(left, { cut, inside, along });
    roots.push({ inside, along });
    const pivot = sculpt.fit.rest[upper];
    const elbow = sculpt.fit.rest[fore];
    const u = [elbow[0] - pivot[0], elbow[1] - pivot[1], elbow[2] - pivot[2]];
    const lu = Math.hypot(u[0], u[1], u[2]);
    // how far into the root a vertex is (0 at the cut, 1 past the ramp), and how near the cut a vertex of
    // the body round it is (1 at the cut, 0 past the shoulder's reach): harmonic across those bands, so they
    // rise evenly over the skin (distances read along its edges zigzag, and the skin stretches in stripes)
    const into = graded ? harmonic(neighbours, Float32Array.from(along, (d, i) => (inside[i] < 0.5 ? 0 : d >= sculpt.ramp ? 1 : NaN))) : null;
    const beyond = graded ? inward(pos, neighbours, Float32Array.from(inside, (v) => 1 - v)) : null;
    const near = beyond ? harmonic(neighbours, Float32Array.from(beyond, (d, i) => (inside[i] >= 0.5 ? 1 : d >= SHOULDER.reach || fine.face[i] ? 0 : NaN))) : null;
    for (let i = 0; i < total; i++) {
      // (over the shoulder, not the side under the arm: that stays where it is)
      const over = smooth01((pos[i * 3 + 1] - pivot[1] + SHOULDER.under) / (2 * SHOULDER.under));
      if (inside[i] < 0.5) {
        if (!near || fine.face[i]) continue;
        const share = SHOULDER.body * near[i] * over;
        full[i * JOINTS + shoulder] += share;
        armShare[i] += share;
        continue;
      }
      const r = into ? into[i] : along[i] / sculpt.ramp;
      // the arm turns as a whole from its root: its weight rises across the ramp from the cut, the shoulder keeping
      // what it leaves at the body's own share there (none under the arm), so the bend is at the shoulder's line and
      // spread over the body round it, never inside the arm (an arm that turned only partly along its first third
      // came out kinked where its own weight took over)
      const w = smooth01(r);
      const carried = graded ? (1 - w) * SHOULDER.body * over : 0;
      const t = ((pos[i * 3] - pivot[0]) * u[0] + (pos[i * 3 + 1] - pivot[1]) * u[1] + (pos[i * 3 + 2] - pivot[2]) * u[2]) / lu;
      const bend = smooth01((t - lu + ELBOW) / (2 * ELBOW));
      full[i * JOINTS + upper] += w * (1 - bend);
      full[i * JOINTS + fore] += w * bend;
      full[i * JOINTS + shoulder] += carried;
      armShare[i] += w + carried;
    }
  }
  for (let i = 0; i < total; i++) {
    const w = full.subarray(i * JOINTS, (i + 1) * JOINTS);
    if (fine.face[i]) {
      w[J.head] = 1;
      continue;
    }
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    let rest = 1 - armShare[i];
    // the legs: near their axes, up to the hip
    const legs = rest * (1 - smooth01((y - LEG.hip) / LEG.blend));
    for (const leg of [J.legL, J.legR]) {
      const a = sculpt.fit.rest[leg];
      const near = 1 - smooth01((Math.hypot((x - a[0]) / LEG.across, (z - a[2]) / LEG.along) - 1) / LEG.fade);
      const share = legs * near * (leg === J.legL ? smooth01((x + 0.03) / 0.06) : 1 - smooth01((x + 0.03) / 0.06));
      w[leg] += share;
      rest -= share;
    }
    // up the body: pelvis → spine → chest → head
    const s1 = smooth01((y - 0.2) / 0.14);
    const s2 = smooth01((y - 0.4) / 0.14);
    const s3 = smooth01((y - 0.58) / 0.1);
    w[J.pelvis] += rest * (1 - s1);
    w[J.spine] += rest * s1 * (1 - s2);
    w[J.chest] += rest * s2 * (1 - s3);
    w[J.head] += rest * s3;
  }
  smoothWeights(full, fineIndex, WEIGHT_ROUNDS);
  // (where the right side is made the left's mirror, it weighs and corrects as the left, mirrored)
  const mirror = sculpt.mirrorArm ? mirrorMap(pos, fineIndex, fine.face) : null;
  if (mirror) mirrorWeights(full, mirror);
  const { skinIndex, skinWeight } = packWeights(full);

  // the sculpt's colour, from its paint
  const colour = new Float32Array(total * 3).fill(1);
  if (colourAt) {
    const rgb = [1, 1, 1];
    for (let i = 0; i < total; i++) {
      colourAt(fine.uv[i * 2], fine.uv[i * 2 + 1], rgb);
      colour.set(rgb, i * 3);
    }
    settleColours(colour, neighbours, fine.face);
  }

  // the creases' shade from the sculpt's own shape; the coat: none on the face's plate, thin where it
  // meets it and at the soles, full elsewhere; the body brought in under it
  const shape = new MeshField(welded, [...bodyTriangles, ...faceTriangles], BOX, VOXEL, 1);
  const plate = new MeshField(welded, faceTriangles, FACE_BOX, 0.01);
  const fur = new Float32Array(total);
  const open = new Float32Array(total);
  const near = [0, 0, 0];
  const surface = pos.slice();
  // the way in under the coat: the normals smoothed over the skin, so a feature smaller than the coat is deep (a
  // thumb, a crease) moves in as a whole rather than turning inside out
  const under = smoothField(nrm, neighbours, COAT_SMOOTH);
  for (let i = 0; i < total; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    open[i] = openness(x, y, z, nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], (a, b, c) => shape.sample(a, b, c));
    if (fine.face[i]) continue;
    const onPlate = z > 0 ? plate.nearest(x, y, z, near) : -1;
    const closest = onPlate >= 0 ? Math.hypot(near[0] - x, near[1] - y, near[2] - z) : Infinity;
    const coat = smooth01((closest - ON_FACE) / FACE_EDGE);
    fur[i] = coat * smooth01(y / 0.035);
    // in under the coat, the soles kept on the ground: near it, only sideways
    const ground = Math.min(1, Math.max(0, (y - 0.01) / 0.05));
    pos[i * 3] -= under[i * 3] * COAT * coat;
    pos[i * 3 + 1] -= under[i * 3 + 1] * COAT * coat * ground;
    pos[i * 3 + 2] -= under[i * 3 + 2] * COAT * coat;
  }

  const comb = combField(pos, nrm, neighbours, skinIndex, skinWeight, sculpt.fit, fine.face);
  const rigged = { position: pos, normal: nrm, index: fineIndex, skinIndex, skinWeight, fur, open, colour, comb };
  if (graded) {
    // the arms' roots ironed as hung (taken into the rest mesh) and as raised (the wave's corrective)
    const band = (root: { inside: Float32Array; along: Float32Array }): Float32Array => {
      const beyond = inward(pos, neighbours, Float32Array.from(root.inside, (v) => 1 - v));
      return Float32Array.from(root.inside, (v, i) => (fine.face[i] ? 0 : 1 - smooth01(((v >= 0.5 ? root.along[i] : beyond[i]) - ROOT.band) / ROOT.fade)));
    };
    const [l, r] = roots.map(band);
    const both = Float32Array.from(l, (v, i) => Math.max(v, r[i]));
    // the thin plate's region about each root: as far into the arm as its weight's ramp, and over the body as far as
    // the shoulder carries it (in one piece: read from the distances along the skin, not the weights)
    // (a raised arm presses its back into the body behind it: there the plate reaches further over the body)
    const plate = (root: { inside: Float32Array; along: Float32Array }, body: number): Float32Array => {
      const beyond = inward(pos, neighbours, Float32Array.from(root.inside, (v) => 1 - v));
      return Float32Array.from(root.inside, (v, i) => (fine.face[i] ? 0 : (v >= 0.5 ? root.along[i] < sculpt.ramp + FILL.margin : beyond[i] < SHOULDER.reach + body) ? 1 : 0));
    };
    const [pl, pr] = roots.map((root) => plate(root, FILL.margin));
    const plates = { both: Float32Array.from(pl, (v, i) => Math.max(v, pr[i])), left: plate(roots[0], FILL.raised) };
    const { hang, hangNormal, raise, raiseNormal, stretch } = rootFixes(sculpt.fit, pos, nrm, fineIndex, neighbours, skinIndex, skinWeight, both, l, plates);
    if (mirror) {
      mirrorVectors(hang, mirror, false);
      mirrorVectors(hangNormal, mirror, true);
    }
    const raiseOpen = Float32Array.from(open, (o, i) => 1 - (1 - o) / Math.max(1, stretch[i]));
    return { ...rigged, raise, raiseNormal, raiseOpen, hang, hangNormal };
  }
  if (!sculpt.corrective) return rigged;
  // the wave's corrective, for the left arm (the one that waves)
  // (a triangle is the arm's if most of its corners are)
  const leftArm = new Set<number>();
  for (let t = 0; t < bodyTriangles.length; t += 3) {
    if (left.cut[bodyTriangles[t]] + left.cut[bodyTriangles[t + 1]] + left.cut[bodyTriangles[t + 2]] >= 2) leftArm.add(t / 3);
  }
  const { raise, raiseNormal, stretch } = waveCorrective(sculpt.fit, leftArm, fine, bodyFine, surface, pos, neighbours, skinIndex, skinWeight, left.inside, left.along);
  const raiseOpen = Float32Array.from(open, (o, i) => 1 - (1 - o) / Math.max(1, stretch[i]));
  return { ...rigged, raise, raiseNormal, raiseOpen };
}

/**
 * The wave's corrective. Raised beside the hood, the arm the sculpt grew
 * into its side draws that skin up out of the side in a taut slope, as a
 * plush's fabric goes (the joints' matrices blended, muse.vert.glsl); but
 * between the cut's edges, where the arm hung, the stretched skin sinks
 * into the body, a scoop in its side. So the skin there is measured once
 * against the body as it would be with no arm on it: the body with the
 * socket the arm leaves filled, a patch over the arm's cut faired on from
 * the body round it, as a field (meshField.ts). Each vertex about the root,
 * where the joints take it with only the left arm up, that has sunk into
 * that body is carried back out onto it (along its gradient); the
 * difference, smoothed over the skin so no crease marks where it starts, is
 * ironed where it lies (the skin stretched over chords is uneven), and kept
 * in the chest's frame with the corrected skin's own normals, where blended
 * matrices would turn the rest normals wrong across the stretch; the shader
 * adds it as the arm goes up. Standing, nothing moves: Muse is the sculpt.
 */
function waveCorrective(
  fit: MuseFit,
  arm: Set<number>,
  fine: Fine,
  bodyFine: number,
  surface: Float32Array,
  pos: Float32Array,
  neighbours: number[][],
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  inside: Float32Array,
  along: Float32Array,
): { raise: Float32Array; raiseNormal: Float32Array; stretch: Float32Array } {
  const total = pos.length / 3;
  // the body with the arm's socket filled, as a field
  const triangles: number[] = [];
  for (let t = 0; t < fine.index.length / 3; t++) {
    if (t < bodyFine && arm.has(fine.source[t])) continue;
    triangles.push(fine.index[t * 3], fine.index[t * 3 + 1], fine.index[t * 3 + 2]);
  }
  const socket = fillSocket(surface, triangles);
  const points = new Float32Array(surface.length + socket.position.length);
  points.set(surface);
  points.set(socket.position, surface.length);
  for (const v of socket.index) triangles.push(v + total);
  const body = new MeshField(points, triangles, BOX, RAISE.voxel, 1);
  // (the skin lies the coat's depth in under the sculpt's surface)
  const field = (x: number, y: number, z: number): number => body.sample(x, y, z) + SKIN_INSET;

  // the skin with only the left arm up
  const rig = new MuseRig(fit);
  rig.raiseLeft();
  const posed = rig.deform(pos, skinIndex, skinWeight, new Float32Array(total * 3));
  // the skin it may move: about the left arm's cut, into the arm and out over the body
  const beyond = inward(pos, neighbours, Float32Array.from(inside, (v) => 1 - v));
  const share = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (fine.face[i] || pos[i * 3] < 0.05) continue;
    const reach = inside[i] >= 0.5 ? along[i] - RAISE.arm : beyond[i] - RAISE.body;
    share[i] = 1 - smooth01(reach / RAISE.fade);
  }
  // what has sunk into the body, carried back out onto it
  const e = 0.004;
  const delta = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    if (share[i] <= 0) continue;
    let x = posed[i * 3];
    let y = posed[i * 3 + 1];
    let z = posed[i * 3 + 2];
    for (let step = 0; step < 4; step++) {
      const f = field(x, y, z);
      if (f >= 0) break;
      const gx = (field(x + e, y, z) - field(x - e, y, z)) / (2 * e);
      const gy = (field(x, y + e, z) - field(x, y - e, z)) / (2 * e);
      const gz = (field(x, y, z + e) - field(x, y, z - e)) / (2 * e);
      const l2 = gx * gx + gy * gy + gz * gz;
      if (l2 < 1e-8) break;
      x -= (f * gx) / l2;
      y -= (f * gy) / l2;
      z -= (f * gz) / l2;
    }
    delta[i * 3] = x - posed[i * 3];
    delta[i * 3 + 1] = y - posed[i * 3 + 1];
    delta[i * 3 + 2] = z - posed[i * 3 + 2];
  }
  // smoothed over the skin, so the push has no edge; then each vertex's share of it
  const next = new Float32Array(total * 3);
  for (let round = 0; round < RAISE.smooth; round++) {
    next.set(delta);
    for (let i = 0; i < total; i++) {
      if (share[i] <= 0) continue;
      const ns = neighbours[i];
      for (let a = 0; a < 3; a++) {
        let sum = delta[i * 3 + a];
        for (const j of ns) sum += delta[j * 3 + a];
        next[i * 3 + a] = sum / (1 + ns.length);
      }
    }
    delta.set(next);
  }
  const moved = posed.slice();
  for (let i = 0; i < total * 3; i++) moved[i] += delta[i] * share[Math.floor(i / 3)];
  // the stretched skin ironed where it lies, then its own normals and stretch
  iron(moved, neighbours, share, RAISE.iron);
  const raise = new Float32Array(total * 3);
  for (let i = 0; i < total * 3; i++) raise[i] = moved[i] - posed[i];
  const { normal: raiseNormal, stretch } = skinAsPosed(pos, moved, fine.index, share);
  return { raise, raiseNormal, stretch };
}

/**
 * Skin ironed where it lies (Taubin's smoothing: a step in, a step back
 * out, so it keeps its size), each vertex by its share; in place.
 */
function iron(points: Float32Array, neighbours: number[][], share: Float32Array, rounds: number): void {
  const next = new Float32Array(points.length);
  for (let round = 0; round < rounds * 2; round++) {
    const factor = round % 2 === 0 ? 0.5 : -0.53;
    next.set(points);
    for (let i = 0; i < share.length; i++) {
      if (share[i] <= 0) continue;
      const ns = neighbours[i];
      for (let a = 0; a < 3; a++) {
        let mean = 0;
        for (const j of ns) mean += points[j * 3 + a];
        next[i * 3 + a] = points[i * 3 + a] + factor * share[i] * (mean / ns.length - points[i * 3 + a]);
      }
    }
    points.set(next);
  }
}

/**
 * Skin as posed, where it has a share: its own normals (its triangles',
 * area-weighted, each of length its share), and how much the skin about each
 * vertex is stretched (the area of its triangles against theirs at rest).
 */
function skinAsPosed(rest: Float32Array, posed: Float32Array, index: ArrayLike<number>, share: Float32Array): { normal: Float32Array; stretch: Float32Array } {
  const count = share.length;
  const normal = new Float32Array(count * 3);
  const area = new Float32Array(count * 2);
  const cross = (p: Float32Array, a: number, b: number, c: number, out: number[]): void => {
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
  };
  const before = [0, 0, 0];
  const after = [0, 0, 0];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (share[a] <= 0 && share[b] <= 0 && share[c] <= 0) continue;
    cross(rest, a, b, c, before);
    cross(posed, a, b, c, after);
    const was = Math.hypot(before[0], before[1], before[2]);
    const is = Math.hypot(after[0], after[1], after[2]);
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) normal[v * 3 + k] += after[k];
      area[v * 2] += was;
      area[v * 2 + 1] += is;
    }
  }
  const stretch = new Float32Array(count).fill(1);
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normal[i * 3 + k] *= share[i] / l;
    if (area[i * 2] > 0) stretch[i] = 1 + share[i] * (area[i * 2 + 1] / area[i * 2] - 1);
  }
  return { normal, stretch };
}

/**
 * The arms' roots of a sculpt made in a T-pose (or an A-pose), as posed.
 * Blended matrices take the skin round a root by chords: hung or raised, it
 * folds on the inside of the bend, cuts the corner on the outside, and
 * stretches in streaks. So the skin about the roots (as far as the cut's
 * band, `share`) is solved as a membrane instead: as rigid as possible
 * (Sorkine and Alexa 2007), each patch of it turned as a whole rather than
 * sheared, held at the band's edges where the joints put the arm and the
 * body, so a bend spreads evenly over the band, as a plush's fabric takes it.
 * Measured in the two poses that matter: hung, as Muse stands, the
 * difference and the solved skin's normals go back into rest space through
 * each vertex's blended matrix (inverted), so the joints carry the skin onto
 * them; at the top of a wave, about the left root alone, the difference as
 * posed, in the chest's frame, with the normals, as the first sculpt's wave's
 * corrective (muse.vert.glsl plays the hung one out of the left arm as the
 * raised one comes in).
 */
function rootFixes(
  fit: MuseFit,
  pos: Float32Array,
  nrm: Float32Array,
  index: ArrayLike<number>,
  neighbours: number[][],
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  share: Float32Array,
  left: Float32Array,
  plates: { both: Float32Array; left: Float32Array },
): { hang: Float32Array; hangNormal: Float32Array; raise: Float32Array; raiseNormal: Float32Array; stretch: Float32Array } {
  const total = pos.length / 3;
  const rig = new MuseRig(fit);
  // hung: back into rest space
  rig.hang();
  const hung = rig.deform(pos, skinIndex, skinWeight, new Float32Array(total * 3));
  const solved = evenOut(pos, thinPlate(hung, neighbours, plates.both), index, neighbours, plates.both);
  const { normal } = skinAsPosed(pos, solved, index, share);
  const hang = new Float32Array(total * 3);
  const hangNormal = nrm.slice();
  const m = new Float64Array(9);
  for (let i = 0; i < total; i++) {
    if (share[i] <= 0) continue;
    // the vertex's blended matrix (its turn and stretch), inverted
    m.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[i * 4 + k];
      if (w === 0) continue;
      const el = rig.skin[skinIndex[i * 4 + k]].elements;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] += w * el[c * 4 + r];
    }
    const inv = invert3(m);
    if (!inv) continue;
    const d = [solved[i * 3] - hung[i * 3], solved[i * 3 + 1] - hung[i * 3 + 1], solved[i * 3 + 2] - hung[i * 3 + 2]];
    const n = [normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]];
    const bent = [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        hang[i * 3 + r] += inv[r * 3 + c] * d[c];
        bent[r] += inv[r * 3 + c] * n[c];
      }
    }
    // (the normal: mixed in by the share, as the skinned one turns it back)
    const l = Math.hypot(bent[0], bent[1], bent[2]) || 1;
    for (let a = 0; a < 3; a++) hangNormal[i * 3 + a] = nrm[i * 3 + a] * (1 - share[i]) + bent[a] / l;
    const ln = Math.hypot(hangNormal[i * 3], hangNormal[i * 3 + 1], hangNormal[i * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) hangNormal[i * 3 + a] /= ln;
  }
  // raised: the wave's corrective, about the left root alone (from the skin as made)
  rig.raiseLeft();
  const raised = rig.deform(pos, skinIndex, skinWeight, new Float32Array(total * 3));
  const moved = evenOut(pos, thinPlate(raised, neighbours, plates.left), index, neighbours, plates.left);
  const raise = new Float32Array(total * 3);
  for (let i = 0; i < total * 3; i++) raise[i] = moved[i] - raised[i];
  const { normal: raiseNormal, stretch } = skinAsPosed(pos, moved, index, left);
  return { hang, hangNormal, raise, raiseNormal, stretch };
}

/**
 * Skin filled over a region as a thin plate: each vertex where the
 * bi-Laplacian of the skin vanishes (Kobbelt's bi-umbrella, relaxed from the
 * posed skin), the rest held, so the region joins what is round it smoothly,
 * its position and its slope, with no fold or wrinkle in it. A copy.
 */
function thinPlate(posed: Float32Array, neighbours: number[][], region: Float32Array): Float32Array {
  const out = posed.slice();
  const free: number[] = [];
  for (let i = 0; i < region.length; i++) if (region[i] > 0 && neighbours[i].length > 0) free.push(i);
  const umbrella = new Float32Array(posed.length);
  const lap = (i: number): void => {
    const ns = neighbours[i];
    for (let a = 0; a < 3; a++) {
      let mean = 0;
      for (const j of ns) mean += out[j * 3 + a];
      umbrella[i * 3 + a] = mean / ns.length - out[i * 3 + a];
    }
  };
  // the vertices whose umbrellas the free ones read (themselves and their neighbours)
  const ring = new Set<number>(free);
  for (const i of free) for (const j of neighbours[i]) ring.add(j);
  const near = [...ring];
  const nu = new Float32Array(region.length);
  for (const i of free) {
    let sum = 0;
    for (const j of neighbours[i]) sum += 1 / neighbours[j].length;
    nu[i] = 1 + sum / neighbours[i].length;
  }
  for (let pass = 0; pass < FILL.passes; pass++) {
    for (const i of near) lap(i);
    for (const i of free) {
      const ns = neighbours[i];
      for (let a = 0; a < 3; a++) {
        let mean = 0;
        for (const j of ns) mean += umbrella[j * 3 + a];
        const u2 = mean / ns.length - umbrella[i * 3 + a];
        out[i * 3 + a] -= u2 / nu[i];
      }
      lap(i);
    }
  }
  return out;
}

/**
 * The fur's lie (rest space, per vertex): as a plush's pile is brushed, down
 * the body, and along each arm from the shoulder toward the mitten (by its
 * weight on the arm), laid into the skin's tangent plane; then smoothed over
 * the skin by area (each vertex the mean of its neighbours', a few rounds),
 * so it flows across the triangles rather than following them. Where the
 * way down has no slope (the crown) it fades to nothing: the strands stand.
 */
function combField(pos: Float32Array, nrm: Float32Array, neighbours: number[][], skinIndex: Uint16Array, skinWeight: Float32Array, fit: MuseFit, face: boolean[]): Float32Array {
  const count = pos.length / 3;
  const J = JOINT;
  const along = [
    [J.upperArmL, J.foreArmL],
    [J.upperArmR, J.foreArmR],
  ].map(([upper, fore]) => {
    const a = fit.rest[upper];
    const b = fit.rest[fore];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  });
  const comb = new Float32Array(count * 3);
  const flat = (i: number, g: number[]): void => {
    const d = g[0] * nrm[i * 3] + g[1] * nrm[i * 3 + 1] + g[2] * nrm[i * 3 + 2];
    for (let e = 0; e < 3; e++) comb[i * 3 + e] = g[e] - d * nrm[i * 3 + e];
  };
  for (let i = 0; i < count; i++) {
    if (face[i]) continue;
    let left = 0;
    let right = 0;
    for (let k = 0; k < 4; k++) {
      const j = skinIndex[i * 4 + k];
      if (j === J.upperArmL || j === J.foreArmL) left += skinWeight[i * 4 + k];
      if (j === J.upperArmR || j === J.foreArmR) right += skinWeight[i * 4 + k];
    }
    const body = Math.max(0, 1 - left - right);
    flat(i, [0, 1, 2].map((e) => body * (e === 1 ? -1 : 0) + left * along[0][e] + right * along[1][e]));
  }
  // smoothed over the skin, kept in its tangent planes
  const next = new Float32Array(comb.length);
  for (let round = 0; round < COMB.rounds; round++) {
    for (let i = 0; i < count; i++) {
      const g = [comb[i * 3], comb[i * 3 + 1], comb[i * 3 + 2]];
      for (const j of neighbours[i]) for (let e = 0; e < 3; e++) g[e] += comb[j * 3 + e];
      const d = g[0] * nrm[i * 3] + g[1] * nrm[i * 3 + 1] + g[2] * nrm[i * 3 + 2];
      for (let e = 0; e < 3; e++) next[i * 3 + e] = (g[e] - d * nrm[i * 3 + e]) / (1 + neighbours[i].length);
    }
    comb.set(next);
  }
  // unit length where the way is clear, fading to none where it is not
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(comb[i * 3], comb[i * 3 + 1], comb[i * 3 + 2]);
    const k = face[i] || l < 1e-6 ? 0 : smooth01(l / COMB.clear) / l;
    for (let e = 0; e < 3; e++) comb[i * 3 + e] *= k;
  }
  return comb;
}

/** A 3×3 matrix (row-major) inverted, or null if it is (nearly) singular. */
function invert3(m: Float64Array): number[] | null {
  const [a, b, c, d, e, f, g, h, k] = m;
  const A = e * k - f * h;
  const B = -(d * k - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-6) return null;
  return [A / det, -(b * k - c * h) / det, (b * f - c * e) / det, B / det, (a * k - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * The body's side where the left arm grew from it, filled as the body would
 * be without it: the body's distance from its upright axis read over a
 * window of heading and height about the socket (rays out from the axis, at
 * the triangles left once the arm's are gone), and where a ray finds none,
 * the distance filled in smoothly from all round (the biharmonic equation,
 * solved by relaxation, so the fill carries the body's own curvature on
 * across). A patch over the whole window (where the body was found, on it).
 */
function fillSocket(position: Float32Array, triangles: number[]): { position: number[]; index: number[] } {
  const { heading, height, step } = SOCKET;
  const cols = Math.round((heading[1] - heading[0]) / step.heading) + 1;
  const rows = Math.round((height[1] - height[0]) / step.height) + 1;
  // the triangles near the window (in heading and height)
  const near: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    let inside = false;
    for (let k = 0; k < 3; k++) {
      const v = triangles[t + k];
      const a = Math.atan2(position[v * 3 + 2], position[v * 3]);
      const y = position[v * 3 + 1];
      if (a > heading[0] - 0.2 && a < heading[1] + 0.2 && y > height[0] - 0.05 && y < height[1] + 0.05) inside = true;
    }
    if (inside) near.push(triangles[t], triangles[t + 1], triangles[t + 2]);
  }
  const r = new Float64Array(cols * rows).fill(NaN);
  for (let j = 0; j < rows; j++) {
    const y = height[0] + j * step.height;
    for (let i = 0; i < cols; i++) {
      const a = heading[0] + i * step.heading;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // the farthest hit out along the ray (Möller–Trumbore)
      let far = NaN;
      for (let t = 0; t < near.length; t += 3) {
        const [p, q, w] = [near[t] * 3, near[t + 1] * 3, near[t + 2] * 3];
        const e1 = [position[q] - position[p], position[q + 1] - position[p + 1], position[q + 2] - position[p + 2]];
        const e2 = [position[w] - position[p], position[w + 1] - position[p + 1], position[w + 2] - position[p + 2]];
        const h = [-e2[1] * dz, e2[0] * dz - e2[2] * dx, e2[1] * dx];
        const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if (Math.abs(det) < 1e-12) continue;
        const s0 = [-position[p], y - position[p + 1], -position[p + 2]];
        const u = (s0[0] * h[0] + s0[1] * h[1] + s0[2] * h[2]) / det;
        if (u < 0 || u > 1) continue;
        const qv = [s0[1] * e1[2] - s0[2] * e1[1], s0[2] * e1[0] - s0[0] * e1[2], s0[0] * e1[1] - s0[1] * e1[0]];
        const v = (dx * qv[0] + dz * qv[2]) / det;
        if (v < 0 || u + v > 1) continue;
        const d = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
        if (d > 0 && !(d < far)) far = d;
      }
      r[j * cols + i] = far;
    }
  }
  // the gaps filled (and the crease round them, which only the arm made: SOCKET.crease cells), relaxed
  // towards a vanishing biharmonic, the distances found farther out held
  const known = Uint8Array.from(r, (v) => (Number.isNaN(v) ? 0 : 1));
  for (let round = 0; round < SOCKET.crease; round++) {
    const was = known.slice();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!was[j * cols + i]) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && ii < cols && jj >= 0 && jj < rows && !was[jj * cols + ii]) known[j * cols + i] = 0;
        }
      }
    }
  }
  let mean = 0;
  let found = 0;
  for (let k = 0; k < r.length; k++) {
    if (!known[k]) continue;
    mean += r[k];
    found++;
  }
  for (let k = 0; k < r.length; k++) if (!known[k]) r[k] = mean / Math.max(1, found);
  const at = (i: number, j: number): number => r[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  for (let pass = 0; pass < 3000; pass++) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (known[j * cols + i]) continue;
        const ring = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1);
        const corners = at(i - 1, j - 1) + at(i + 1, j - 1) + at(i - 1, j + 1) + at(i + 1, j + 1);
        const far = at(i - 2, j) + at(i + 2, j) + at(i, j - 2) + at(i, j + 2);
        r[j * cols + i] = (8 * ring - 2 * corners - far) / 20;
      }
    }
  }
  const out: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = heading[0] + i * step.heading;
      out.push(r[j * cols + i] * Math.cos(a), height[0] + j * step.height, r[j * cols + i] * Math.sin(a));
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const k = j * cols + i;
      index.push(k, k + cols, k + 1, k + 1, k + cols, k + cols + 1);
    }
  }
  return { position: out, index };
}

/**
 * A mesh refined on PN triangles (Vlachos et al. 2001): each triangle a
 * cubic patch through its corners, its edges bowed out along the corners'
 * normals, with normals varying quadratically across it; an edge's points
 * depend on its two ends alone, so neighbours meet without cracks. Each
 * refined vertex keeps the welded vertices it lies between and its shares of
 * them (to carry values given per welded vertex), and its texture
 * coordinates from the sculpt's corners.
 */
class Fine {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly from: number[] = [];
  readonly share: number[] = [];
  readonly face: boolean[] = [];
  readonly index: number[] = [];
  /** Each refined triangle's own, as numbered in the list it was refined from. */
  readonly source: number[] = [];
  /** The patch being refined: its corners' normals and its mid-edge ones. */
  private readonly corner = new Float64Array(9);
  private readonly mids = new Float64Array(9);

  add(P: Float64Array, N: Float64Array, triangles: number[], corners: number[] | null, uv: ArrayLike<number> | null, n: number, face: boolean): void {
    const shared = new Map<string, number>();
    const grid = new Int32Array(((n + 1) * (n + 2)) / 2);
    const at = (j: number, k: number): number => (k * (2 * n + 3 - k)) / 2 + j;
    const b = new Float64Array(30);
    for (let t = 0; t < triangles.length; t += 3) {
      const v = [triangles[t], triangles[t + 1], triangles[t + 2]];
      this.patch(P, N, v[0], v[1], v[2], b);
      for (let k = 0; k <= n; k++) {
        for (let j = 0; j <= n - k; j++) {
          const i = n - j - k;
          // a corner, a point of an edge (shared with the neighbour across it), or inside
          let key: string | null = null;
          if (i === n || j === n || k === n) key = `v${v[i === n ? 0 : j === n ? 1 : 2]}`;
          else if (k === 0) key = edgeKey(v[0], v[1], j, n);
          else if (i === 0) key = edgeKey(v[1], v[2], k, n);
          else if (j === 0) key = edgeKey(v[2], v[0], i, n);
          let id = key ? shared.get(key) : undefined;
          if (id === undefined) {
            id = this.position.length / 3;
            if (key) shared.set(key, id);
            const s = i / n;
            const r = j / n;
            const q = k / n;
            this.point(b, s, r, q);
            this.from.push(v[0], v[1], v[2]);
            this.share.push(s, r, q);
            if (corners && uv) {
              const c = [corners[t], corners[t + 1], corners[t + 2]];
              this.uv.push(s * uv[c[0] * 2] + r * uv[c[1] * 2] + q * uv[c[2] * 2], s * uv[c[0] * 2 + 1] + r * uv[c[1] * 2 + 1] + q * uv[c[2] * 2 + 1]);
            } else this.uv.push(0, 0);
            this.face.push(face);
          }
          grid[at(j, k)] = id;
        }
      }
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < n - k; j++) {
          this.index.push(grid[at(j, k)], grid[at(j + 1, k)], grid[at(j, k + 1)]);
          this.source.push(t / 3);
          if (j + k < n - 1) {
            this.index.push(grid[at(j + 1, k)], grid[at(j + 1, k + 1)], grid[at(j, k + 1)]);
            this.source.push(t / 3);
          }
        }
      }
    }
  }

  /** The patch's control points (b300 b030 b003 b210 b120 b021 b012 b102 b201 b111) and its mid-edge normals (n110 n011 n101), into b. */
  private patch(P: Float64Array, N: Float64Array, a: number, c1: number, c2: number, b: Float64Array): void {
    const v = [a, c1, c2];
    for (let k = 0; k < 3; k++) for (let e = 0; e < 3; e++) b[k * 3 + e] = P[v[k] * 3 + e];
    // the edge points: two thirds along each edge, pulled onto the tangent plane at its nearer end
    const edge = (i: number, j: number, slot: number): void => {
      let w = 0;
      for (let e = 0; e < 3; e++) w += (P[v[j] * 3 + e] - P[v[i] * 3 + e]) * N[v[i] * 3 + e];
      for (let e = 0; e < 3; e++) b[slot * 3 + e] = (2 * P[v[i] * 3 + e] + P[v[j] * 3 + e] - w * N[v[i] * 3 + e]) / 3;
    };
    edge(0, 1, 3);
    edge(1, 0, 4);
    edge(1, 2, 5);
    edge(2, 1, 6);
    edge(2, 0, 7);
    edge(0, 2, 8);
    for (let e = 0; e < 3; e++) {
      let mean = 0;
      for (let s = 3; s < 9; s++) mean += b[s * 3 + e] / 6;
      const centre = (b[e] + b[3 + e] + b[6 + e]) / 3;
      b[27 + e] = mean + (mean - centre) / 2;
    }
    // the normals halfway along the edges, mirrored in the plane across each edge
    const mid = (i: number, j: number, slot: number): void => {
      let d2 = 0;
      let dn = 0;
      for (let e = 0; e < 3; e++) {
        const d = P[v[j] * 3 + e] - P[v[i] * 3 + e];
        d2 += d * d;
        dn += d * (N[v[i] * 3 + e] + N[v[j] * 3 + e]);
      }
      const k = d2 > 0 ? (2 * dn) / d2 : 0;
      let l = 0;
      for (let e = 0; e < 3; e++) {
        const m = N[v[i] * 3 + e] + N[v[j] * 3 + e] - k * (P[v[j] * 3 + e] - P[v[i] * 3 + e]);
        this.mids[slot * 3 + e] = m;
        l += m * m;
      }
      l = Math.sqrt(l) || 1;
      for (let e = 0; e < 3; e++) this.mids[slot * 3 + e] /= l;
    };
    mid(0, 1, 0);
    mid(1, 2, 1);
    mid(2, 0, 2);
    for (let k = 0; k < 3; k++) for (let e = 0; e < 3; e++) this.corner[k * 3 + e] = N[v[k] * 3 + e];
  }

  /** The patch at barycentric (s, r, q) of its corners: the point and its normal, appended. */
  private point(b: Float64Array, s: number, r: number, q: number): void {
    const w = [s * s * s, r * r * r, q * q * q, 3 * s * s * r, 3 * s * r * r, 3 * r * r * q, 3 * r * q * q, 3 * s * q * q, 3 * s * s * q, 6 * s * r * q];
    const nw = [s * s, r * r, q * q, s * r, r * q, q * s];
    let l = 0;
    const n = [0, 0, 0];
    for (let e = 0; e < 3; e++) {
      let p = 0;
      for (let k = 0; k < 10; k++) p += w[k] * b[k * 3 + e];
      this.position.push(p);
      n[e] = nw[0] * this.corner[e] + nw[1] * this.corner[3 + e] + nw[2] * this.corner[6 + e] + nw[3] * this.mids[e] + nw[4] * this.mids[3 + e] + nw[5] * this.mids[6 + e];
      l += n[e] * n[e];
    }
    l = Math.sqrt(l) || 1;
    this.normal.push(n[0] / l, n[1] / l, n[2] / l);
  }
}

/**
 * The face's plate made smooth: a sculpt may carve its own mouth (or more)
 * into it, which would show under the paint, its triangles too dense for
 * smoothing over the mesh to reach. The plate is a dome facing forward, so
 * its depth is fitted as a smooth function of x and y (a quartic, least
 * squares, a few rounds weighting down what stands off it), and its middle
 * set onto that, eased back to the sculpt's own towards the rim (which wraps
 * back into the hood); the normals are taken again from the result.
 */
function ironPlate(P: Float64Array, N: Float64Array, triangles: number[]): void {
  const plate = [...new Set(triangles)];
  if (plate.length < 20) return;
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const v of plate) {
    lo = [Math.min(lo[0], P[v * 3]), Math.min(lo[1], P[v * 3 + 1])];
    hi = [Math.max(hi[0], P[v * 3]), Math.max(hi[1], P[v * 3 + 1])];
  }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  const half = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2];
  // where a vertex lies across the plate (0 the middle, 1 the rim's reach), and the quartic's terms there
  const radius = (v: number): number => Math.hypot((P[v * 3] - c[0]) / half[0], (P[v * 3 + 1] - c[1]) / half[1]);
  const terms = (v: number): number[] => {
    const u = (P[v * 3] - c[0]) / half[0];
    const w = (P[v * 3 + 1] - c[1]) / half[1];
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) out.push(u ** i * w ** j);
    return out;
  };
  const fitted = plate.filter((v) => radius(v) < PLATE.fit);
  let weight = fitted.map(() => 1);
  let coef: number[] = [];
  for (let round = 0; round < 4; round++) {
    // normal equations, weighted
    const k = terms(fitted[0]).length;
    const A = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
    fitted.forEach((v, n) => {
      const t = terms(v);
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) A[i][j] += weight[n] * t[i] * t[j];
        A[i][k] += weight[n] * t[i] * P[v * 3 + 2];
      }
    });
    coef = solve(A);
    // what stands off the fit by more than a millimetre or two counts for less
    weight = fitted.map((v) => {
      const off = Math.abs(terms(v).reduce((sum, t, i) => sum + t * coef[i], 0) - P[v * 3 + 2]);
      return 1 / (1 + (off / PLATE.tolerance) ** 2);
    });
  }
  for (const v of plate) {
    // only a carved feature's few millimetres: where the plate leaves the fit by more (a deeper dome's edge,
    // curving back faster than a quartic follows), the plate is its own
    const ease = 1 - smooth01((radius(v) - PLATE.middle) / (PLATE.fit - PLATE.middle));
    if (ease <= 0) continue;
    const z = terms(v).reduce((sum, t, i) => sum + t * coef[i], 0);
    const carved = 1 - smooth01((Math.abs(z - P[v * 3 + 2]) - PLATE.carved) / PLATE.carved);
    P[v * 3 + 2] += ease * carved * (z - P[v * 3 + 2]);
  }
  // the normals again, from the triangles (each kept on the side the sculpt's was)
  const sums = new Map<number, number[]>();
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, d] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const w = [P[d * 3] - P[a * 3], P[d * 3 + 1] - P[a * 3 + 1], P[d * 3 + 2] - P[a * 3 + 2]];
    const m = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, d]) {
      const sum = sums.get(v) ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) sum[i] += m[i];
      sums.set(v, sum);
    }
  }
  for (const [v, sum] of sums) {
    const side = sum[0] * N[v * 3] + sum[1] * N[v * 3 + 1] + sum[2] * N[v * 3 + 2] < 0 ? -1 : 1;
    const l = (Math.hypot(sum[0], sum[1], sum[2]) || 1) * side;
    for (let i = 0; i < 3; i++) N[v * 3 + i] = sum[i] / l;
  }
}

/**
 * Skin evened out over a region as posed: its vertices slid along the
 * surface (it keeps its shape) so the stretch spreads evenly over it, as a
 * plush's fabric shares a pull, rather than gathering where the joints
 * pulled hardest (the skin there stretched twice and more, the fur's strands
 * smeared over it). Each vertex goes, a step at a time and in its tangent
 * plane only, toward the mean of its neighbours weighted by one over their
 * rest distance (on a chain, that leaves every link stretched alike); now
 * and then they are set back onto the surface (the closest point of it as
 * it was, meshField.ts). The region's rim holds. A copy.
 */
function evenOut(rest: Float32Array, posed: Float32Array, index: ArrayLike<number>, neighbours: number[][], region: Float32Array): Float32Array {
  const out = posed.slice();
  const count = region.length;
  const free: number[] = [];
  for (let i = 0; i < count; i++) if (region[i] > 0 && neighbours[i].length > 0 && neighbours[i].every((j) => region[j] > 0)) free.push(i);
  if (free.length === 0) return out;
  // the surface to stay on: the triangles about the region, as posed, in a box about them
  const about = new Set<number>(free);
  for (let ring = 0; ring < 2; ring++) for (const i of [...about]) for (const j of neighbours[i]) about.add(j);
  const triangles: number[] = [];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < index.length; t += 3) {
    if (!about.has(index[t]) && !about.has(index[t + 1]) && !about.has(index[t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const v = index[t + k];
      triangles.push(v);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], posed[v * 3 + a]);
        hi[a] = Math.max(hi[a], posed[v * 3 + a]);
      }
    }
  }
  const pad = 0.05;
  const box: Box = { x: [lo[0] - pad, hi[0] + pad], y: [lo[1] - pad, hi[1] + pad], z: [lo[2] - pad, hi[2] + pad] };
  const surface = new MeshField(posed, triangles, box, EVEN.voxel);
  // each edge's weight: one over its rest length
  const weights = free.map((i) =>
    neighbours[i].map((j) => 1 / (Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]) || 1e-6)),
  );
  const normal = new Float32Array(count * 3);
  const near = [0, 0, 0];
  for (let round = 0; round < EVEN.rounds; round++) {
    // the normals as the skin now lies
    normal.fill(0);
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
      const u = [out[b * 3] - out[a * 3], out[b * 3 + 1] - out[a * 3 + 1], out[b * 3 + 2] - out[a * 3 + 2]];
      const v = [out[c * 3] - out[a * 3], out[c * 3 + 1] - out[a * 3 + 1], out[c * 3 + 2] - out[a * 3 + 2]];
      const m = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const w of [a, b, c]) for (let e = 0; e < 3; e++) normal[w * 3 + e] += m[e];
    }
    free.forEach((i, k) => {
      const ns = neighbours[i];
      const ws = weights[k];
      const target = [0, 0, 0];
      let sum = 0;
      for (let m = 0; m < ns.length; m++) {
        for (let e = 0; e < 3; e++) target[e] += ws[m] * out[ns[m] * 3 + e];
        sum += ws[m];
      }
      const d = [target[0] / sum - out[i * 3], target[1] / sum - out[i * 3 + 1], target[2] / sum - out[i * 3 + 2]];
      const ln = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
      const nn = [normal[i * 3] / ln, normal[i * 3 + 1] / ln, normal[i * 3 + 2] / ln];
      const along = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2];
      for (let e = 0; e < 3; e++) out[i * 3 + e] += EVEN.step * region[i] * (d[e] - along * nn[e]);
      // back onto the surface, now and then
      if ((round + 1) % EVEN.settle === 0 || round === EVEN.rounds - 1) {
        if (surface.nearest(out[i * 3], out[i * 3 + 1], out[i * 3 + 2], near) >= 0) for (let e = 0; e < 3; e++) out[i * 3 + e] = near[e];
      }
    });
  }
  return out;
}

/**
 * A sculpt's small folds filled: where a triangle faces against its
 * corners' normals (a crumpled crease, a few millimetres across: invisible
 * as exported, but the coat's shading darkens it and the shells curl over
 * it), its corners and a couple of rings round them are filled as a thin
 * plate (thinPlate: the smoothest surface joining what is round them), and
 * their normals taken again from their faces; a few times, until none is
 * left.
 */
function fillFolds(P: Float64Array, N: Float64Array, triangles: number[]): void {
  const count = P.length / 3;
  const neighbours = adjacency(count, triangles);
  const face = (t: number): number[] => {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const v = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  for (let round = 0; round < FOLDS.rounds; round++) {
    const region = new Float32Array(count);
    let folds = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const f = face(t);
      if (![0, 1, 2].some((k) => f[0] * N[triangles[t + k] * 3] + f[1] * N[triangles[t + k] * 3 + 1] + f[2] * N[triangles[t + k] * 3 + 2] < 0)) continue;
      folds++;
      for (let k = 0; k < 3; k++) region[triangles[t + k]] = 1;
    }
    if (folds === 0) return;
    for (let ring = 0; ring < FOLDS.rings; ring++) {
      const grown = region.slice();
      for (let i = 0; i < count; i++) if (region[i] > 0) for (const j of neighbours[i]) grown[j] = 1;
      region.set(grown);
    }
    P.set(thinPlate(Float32Array.from(P), neighbours, region));
    const sums = new Float64Array(count * 3);
    for (let t = 0; t < triangles.length; t += 3) {
      if (![0, 1, 2].some((k) => region[triangles[t + k]] > 0)) continue;
      const f = face(t);
      for (let k = 0; k < 3; k++) for (let e = 0; e < 3; e++) sums[triangles[t + k] * 3 + e] += f[e];
    }
    for (let i = 0; i < count; i++) {
      if (region[i] <= 0) continue;
      const l = Math.hypot(sums[i * 3], sums[i * 3 + 1], sums[i * 3 + 2]) || 1;
      for (let e = 0; e < 3; e++) N[i * 3 + e] = sums[i * 3 + e] / l;
    }
  }
}

/**
 * A sculpt's right arm laid along its left's mirror. Tripo's arms are not
 * each other's mirror (tpose6's right runs down steeper and forward, then
 * curves round to level), and no pair of joints can straighten a curve: hung,
 * such an arm bows out at the elbow. So in rest space each vertex of the
 * right arm is found on the arm's own centreline (how far along it, as a share
 * of its length, and its offset there in the centreline's frame) and placed
 * at the same share along the mirror of the left arm's centreline, with the
 * same offset in that frame, its normal turned with it; eased in over the
 * root, where the two arms already agree. Its joints and turns are then the
 * left's mirrored, and it hangs and moves as the left's mirror.
 */
function mirrorArmPath(P: Float64Array, N: Float64Array, triangles: number[], left: Float32Array, right: Float32Array): void {
  const own = centreline(P, triangles, right, -1);
  const target = centreline(P, triangles, left, 1).map(([x, y, z]) => [-x, y, z]);
  if (own.length < 4 || target.length < 4) return;
  const a = path(own);
  const b = path(target);
  const count = P.length / 3;
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (right[i] < 0.5) continue;
    for (let e = 0; e < 3; e++) v[e] = P[i * 3 + e];
    // where it lies along its own centreline (the closest point, the ends extended), and its offset in the frame there
    let best = Infinity;
    let at = 0;
    for (let k = 0; k + 1 < own.length; k++) {
      const p = own[k];
      const q = own[k + 1];
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      let f = ((v[0] - p[0]) * d[0] + (v[1] - p[1]) * d[1] + (v[2] - p[2]) * d[2]) / l2;
      f = k === 0 ? Math.min(f, 1) : k === own.length - 2 ? Math.max(f, 0) : Math.min(1, Math.max(0, f));
      const c = [p[0] + f * d[0], p[1] + f * d[1], p[2] + f * d[2]];
      const dist = Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]);
      if (dist < best) {
        best = dist;
        at = a.length[k] + f * (a.length[k + 1] - a.length[k]);
      }
    }
    const share = at / a.total;
    const from = a.frame(share);
    const to = b.frame(share);
    const ease = smooth01(at / ARM_PATH.ease);
    if (ease <= 0) continue;
    const d = [v[0] - from.point[0], v[1] - from.point[1], v[2] - from.point[2]];
    const coords = [0, 1, 2].map((k) => d[0] * from.axes[k][0] + d[1] * from.axes[k][1] + d[2] * from.axes[k][2]);
    const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
    const nc = [0, 1, 2].map((k) => n[0] * from.axes[k][0] + n[1] * from.axes[k][1] + n[2] * from.axes[k][2]);
    for (let e = 0; e < 3; e++) {
      const moved = to.point[e] + coords[0] * to.axes[0][e] + coords[1] * to.axes[1][e] + coords[2] * to.axes[2][e];
      P[i * 3 + e] = v[e] + ease * (moved - v[e]);
      N[i * 3 + e] = n[e] + ease * (nc[0] * to.axes[0][e] + nc[1] * to.axes[1][e] + nc[2] * to.axes[2][e] - n[e]);
    }
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    for (let e = 0; e < 3; e++) N[i * 3 + e] /= l;
  }
}

/**
 * A sculpt's right side made its left's mirror. Laid along the left's path
 * (mirrorArmPath), the right arm still has its own sections and root
 * (tpose6's: thinner above, fuller in the mitten), and the body round it is a
 * few millimetres off the left's mirror (its shoulder fuller, a crease from
 * the face's corner deeper): three-quarter on, its outline and its shading
 * are not the left's. So each vertex of the body's right side is carried onto
 * the mirror of the left side's surface (the closest point of it,
 * meshField.ts) and takes the normal there; near the middle it keeps its own,
 * easing over. (The face's plate, a piece of its own, is not moved.)
 */
function mirrorSide(P: Float64Array, N: Float64Array, triangles: number[]): void {
  const count = P.length / 3;
  // the body's surface on the left, mirrored (and its normals)
  const mirrored = Float64Array.from(P, (v, i) => (i % 3 === 0 ? -v : v));
  const normals = Float64Array.from(N, (v, i) => (i % 3 === 0 ? -v : v));
  const left: number[] = [];
  const body = new Uint8Array(count);
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    body[a] = body[b] = body[c] = 1;
    if (P[a * 3] + P[b * 3] + P[c * 3] > 0) left.push(a, c, b);
  }
  const surface = new MeshField(mirrored, left, MIRROR.side, MIRROR.voxel);
  const near = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const x = P[i * 3];
    const w = body[i] ? smooth01((-x - MIRROR.middle) / MIRROR.middle) : 0;
    if (w <= 0) continue;
    const t = surface.nearest(x, P[i * 3 + 1], P[i * 3 + 2], near);
    if (t < 0) continue;
    // the normal there: its triangle's corners' normals, by its barycentric weights
    const [a, b, c] = [left[t * 3], left[t * 3 + 1], left[t * 3 + 2]];
    const u = [mirrored[b * 3] - mirrored[a * 3], mirrored[b * 3 + 1] - mirrored[a * 3 + 1], mirrored[b * 3 + 2] - mirrored[a * 3 + 2]];
    const v = [mirrored[c * 3] - mirrored[a * 3], mirrored[c * 3 + 1] - mirrored[a * 3 + 1], mirrored[c * 3 + 2] - mirrored[a * 3 + 2]];
    const d = [near[0] - mirrored[a * 3], near[1] - mirrored[a * 3 + 1], near[2] - mirrored[a * 3 + 2]];
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const uv = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const du = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const dv = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    const den = uu * vv - uv * uv || 1;
    const sb = (vv * du - uv * dv) / den;
    const sc = (uu * dv - uv * du) / den;
    const sa = 1 - sb - sc;
    const n = [0, 1, 2].map((e) => sa * normals[a * 3 + e] + sb * normals[b * 3 + e] + sc * normals[c * 3 + e]);
    for (let e = 0; e < 3; e++) {
      P[i * 3 + e] += w * (near[e] - P[i * 3 + e]);
      N[i * 3 + e] += w * (n[e] - N[i * 3 + e]);
    }
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    for (let e = 0; e < 3; e++) N[i * 3 + e] /= l;
  }
}

/**
 * Where a sculpt's right side is made its left's mirror (mirrorSide), each of
 * its vertices' mirror on the left's skin: the triangle at the mirror of its
 * place there (the closest point of the left's skin, its corners and their
 * barycentric shares), and how much of what is found there it takes (near the
 * middle, its own, easing over). Anything weighed or measured on the skin can
 * then be carried from the left to the right (mirrorWeights, mirrorVectors),
 * so the same shape weighs and moves the same.
 */
interface MirrorMap {
  corners: Int32Array;
  shares: Float32Array;
  take: Float32Array;
}

function mirrorMap(pos: Float32Array, index: ArrayLike<number>, face: boolean[]): MirrorMap {
  const count = pos.length / 3;
  const mirrored = Float32Array.from(pos, (v, i) => (i % 3 === 0 ? -v : v));
  const left: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (face[a] || face[b] || face[c]) continue;
    if (pos[a * 3] + pos[b * 3] + pos[c * 3] > 0) left.push(a, c, b);
  }
  const surface = new MeshField(mirrored, left, MIRROR.side, MIRROR.voxel);
  const map: MirrorMap = { corners: new Int32Array(count * 3), shares: new Float32Array(count * 3), take: new Float32Array(count) };
  const near = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (face[i]) continue;
    const x = pos[i * 3];
    const take = smooth01((-x - MIRROR.weights) / MIRROR.weights);
    if (take <= 0) continue;
    const t = surface.nearest(x, pos[i * 3 + 1], pos[i * 3 + 2], near);
    if (t < 0) continue;
    // the closest point's barycentric shares of its triangle (kept inside it)
    const [a, b, c] = [left[t * 3], left[t * 3 + 1], left[t * 3 + 2]];
    const u = [mirrored[b * 3] - mirrored[a * 3], mirrored[b * 3 + 1] - mirrored[a * 3 + 1], mirrored[b * 3 + 2] - mirrored[a * 3 + 2]];
    const v = [mirrored[c * 3] - mirrored[a * 3], mirrored[c * 3 + 1] - mirrored[a * 3 + 1], mirrored[c * 3 + 2] - mirrored[a * 3 + 2]];
    const d = [near[0] - mirrored[a * 3], near[1] - mirrored[a * 3 + 1], near[2] - mirrored[a * 3 + 2]];
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const uv = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const du = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const dv = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    const den = uu * vv - uv * uv || 1;
    const sb = Math.max(0, (vv * du - uv * dv) / den);
    const sc = Math.max(0, (uu * dv - uv * du) / den);
    const sa = Math.max(0, 1 - sb - sc);
    const sum = sa + sb + sc || 1;
    map.corners.set([a, b, c], i * 3);
    map.shares.set([sa / sum, sb / sum, sc / sum], i * 3);
    map.take[i] = take;
  }
  return map;
}

/** Skin weights (JOINTS per vertex) carried from the left to the right by a mirror map, the arms', shoulders' and legs' joints swapped. */
function mirrorWeights(full: Float32Array, map: MirrorMap): void {
  const J = JOINT;
  const swap = Array.from({ length: JOINTS }, (_, j) => j);
  for (const [a, b] of [
    [J.upperArmL, J.upperArmR],
    [J.foreArmL, J.foreArmR],
    [J.shoulderL, J.shoulderR],
    [J.legL, J.legR],
  ]) {
    swap[a] = b;
    swap[b] = a;
  }
  const own = full.slice();
  const w = new Float64Array(JOINTS);
  for (let i = 0; i < map.take.length; i++) {
    const take = map.take[i];
    if (take <= 0) continue;
    w.fill(0);
    for (let k = 0; k < 3; k++) {
      const corner = map.corners[i * 3 + k];
      const share = map.shares[i * 3 + k];
      for (let j = 0; j < JOINTS; j++) w[swap[j]] += share * own[corner * JOINTS + j];
    }
    for (let j = 0; j < JOINTS; j++) full[i * JOINTS + j] = own[i * JOINTS + j] + take * (w[j] - own[i * JOINTS + j]);
  }
}

/** Vectors (3 per vertex, rest space) carried from the left to the right by a mirror map, their x turned round; as directions, made unit again. */
function mirrorVectors(field: Float32Array, map: MirrorMap, unit: boolean): void {
  const own = field.slice();
  for (let i = 0; i < map.take.length; i++) {
    const take = map.take[i];
    if (take <= 0) continue;
    const v = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const corner = map.corners[i * 3 + k];
      const share = map.shares[i * 3 + k];
      for (let e = 0; e < 3; e++) v[e] += share * own[corner * 3 + e] * (e === 0 ? -1 : 1);
    }
    for (let e = 0; e < 3; e++) field[i * 3 + e] = own[i * 3 + e] + take * (v[e] - own[i * 3 + e]);
    if (!unit) continue;
    const l = Math.hypot(field[i * 3], field[i * 3 + 1], field[i * 3 + 2]) || 1;
    for (let e = 0; e < 3; e++) field[i * 3 + e] /= l;
  }
}

/**
 * An arm's centreline (side 1 the left, −1 the right): cut across by planes
 * |x| = c out from its root, each section's middle (of its extents up and
 * deep), until the mitten's end; smoothed a little.
 */
function centreline(P: Float64Array, triangles: number[], arm: Float32Array, side: number): number[][] {
  const mine: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    if (arm[triangles[t]] + arm[triangles[t + 1]] + arm[triangles[t + 2]] >= 2) mine.push(triangles[t], triangles[t + 1], triangles[t + 2]);
  }
  const out: number[][] = [];
  for (let c = ARM_PATH.from; ; c += ARM_PATH.step) {
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let t = 0; t < mine.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const p = mine[t + e];
        const q = mine[t + ((e + 1) % 3)];
        const sp = side * P[p * 3] - c;
        const sq = side * P[q * 3] - c;
        if (sp < 0 === sq < 0) continue;
        const f = sp / (sp - sq);
        const y = P[p * 3 + 1] + f * (P[q * 3 + 1] - P[p * 3 + 1]);
        const z = P[p * 3 + 2] + f * (P[q * 3 + 2] - P[p * 3 + 2]);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
    if (y1 - y0 < ARM_PATH.end) break;
    out.push([side * c, (y0 + y1) / 2, (z0 + z1) / 2]);
  }
  // smoothed (1-2-1, the ends held)
  for (let round = 0; round < ARM_PATH.smooth; round++) {
    const was = out.map((p) => p.slice());
    for (let k = 1; k + 1 < out.length; k++) for (let e = 1; e < 3; e++) out[k][e] = (was[k - 1][e] + 2 * was[k][e] + was[k + 1][e]) / 4;
  }
  return out;
}

/**
 * A polyline as a path: the length along it to each point, and at any share
 * of its length the point and a frame (along it; across it, level; across
 * it, toward the front), interpolated between the points' own.
 */
function path(points: number[][]): { length: number[]; total: number; frame: (share: number) => { point: number[]; axes: number[][] } } {
  const length = [0];
  for (let k = 1; k < points.length; k++) length.push(length[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1], points[k][2] - points[k - 1][2]));
  const total = length[length.length - 1];
  const tangents = points.map((_, k) => {
    const p = points[Math.max(0, k - 1)];
    const q = points[Math.min(points.length - 1, k + 1)];
    return [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  });
  const frame = (share: number): { point: number[]; axes: number[][] } => {
    // (beyond either end, on along the end's direction)
    const s = share * total;
    let k = 0;
    while (k + 2 < points.length && length[k + 1] < s) k++;
    const f = (s - length[k]) / (length[k + 1] - length[k] || 1);
    const point = [0, 1, 2].map((e) => points[k][e] + f * (points[k + 1][e] - points[k][e]));
    const g = Math.min(1, Math.max(0, f));
    const t = [0, 1, 2].map((e) => tangents[k][e] + g * (tangents[k + 1][e] - tangents[k][e]));
    const lt = Math.hypot(t[0], t[1], t[2]) || 1;
    for (let e = 0; e < 3; e++) t[e] /= lt;
    // toward the front, square to it; then level across it
    const front = [-t[2] * t[0], -t[2] * t[1], 1 - t[2] * t[2]];
    const lf = Math.hypot(front[0], front[1], front[2]) || 1;
    for (let e = 0; e < 3; e++) front[e] /= lf;
    const across = [front[1] * t[2] - front[2] * t[1], front[2] * t[0] - front[0] * t[2], front[0] * t[1] - front[1] * t[0]];
    return { point, axes: [t, across, front] };
  };
  return { length, total, frame };
}

/** Unit vectors per vertex smoothed over the mesh (each the mean of itself and its neighbours, renormalised), some rounds. A copy. */
function smoothField(field: Float32Array, neighbours: number[][], rounds: number): Float32Array {
  let out = field.slice();
  let next = new Float32Array(field.length);
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < neighbours.length; i++) {
      const v = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      for (const j of neighbours[i]) for (let a = 0; a < 3; a++) v[a] += out[j * 3 + a];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      for (let a = 0; a < 3; a++) next[i * 3 + a] = v[a] / l;
    }
    [out, next] = [next, out];
  }
  return out;
}

/** A small dense linear system solved (Gaussian elimination, partial pivoting): the augmented matrix in, the unknowns out. */
function solve(A: number[][]): number[] {
  const k = A.length;
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const p = A[col][col] || 1e-12;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col] / p;
      for (let j = col; j <= k; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row, i) => row[k] / (row[i] || 1e-12));
}

/** A point of an edge, step s of n from a towards b, named the same from either end. */
function edgeKey(a: number, b: number, s: number, n: number): string {
  return a < b ? `e${a},${b},${s}` : `e${b},${a},${n - s}`;
}

/** Each vertex's neighbours along the mesh's edges. */
function adjacency(count: number, index: ArrayLike<number>): number[][] {
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e];
      const b = index[t + ((e + 1) % 3)];
      if (!neighbours[a].includes(b)) neighbours[a].push(b);
      if (!neighbours[b].includes(a)) neighbours[b].push(a);
    }
  }
  return neighbours;
}

/**
 * One arm cut out of the body by the crease round it (side 1 the left, −1
 * the right): a minimum cut of the body's surface (welded) between the
 * hanging arm and the body well away from it, every edge costing its length,
 * far less where the surface folds inward. 1 per vertex of the arm.
 */
function cutArm(P: Float64Array, triangles: number[], side: number, cut: Sculpt['cut']): Float32Array {
  const n = P.length / 3;
  // each edge's triangles, and how far the surface folds inward across it (degrees)
  const faces = new Map<number, number[]>();
  const normals: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / l, ny / l, nz / l);
    for (const [p, q, o] of [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ]) {
      const key = Math.min(p, q) * n + Math.max(p, q);
      const list = faces.get(key) ?? [];
      list.push(t / 3, o);
      faces.set(key, list);
    }
  }
  const ends: number[] = [];
  const costs: number[] = [];
  for (const [key, list] of faces) {
    const a = Math.floor(key / n);
    const b = key % n;
    let fold = 0;
    if (list.length === 4) {
      const [f, , g, o] = list;
      const cos = normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2];
      // inward if the far corner of one face lies above the other's plane
      const above = (P[o * 3] - P[a * 3]) * normals[f * 3] + (P[o * 3 + 1] - P[a * 3 + 1]) * normals[f * 3 + 1] + (P[o * 3 + 2] - P[a * 3 + 2]) * normals[f * 3 + 2];
      fold = above > 0 ? (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI : 0;
    }
    const length = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    ends.push(a, b);
    costs.push(length * (0.03 + Math.exp(-fold / FOLD)));
  }
  const used = new Uint8Array(n);
  for (const v of triangles) used[v] = 1;
  const arm: number[] = [];
  const away: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const x = side * P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    if (x > cut.arm.x && y > cut.arm.y[0] && y < cut.arm.y[1]) arm.push(i);
    else if (x < cut.body.x || y < cut.body.y[0] || y > cut.body.y[1] || z < cut.body.z[0] || z > cut.body.z[1]) away.push(i);
  }
  const reach = minCut(n, ends, costs, arm, away);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = reach[i];
  return out;
}

/**
 * The minimum cut of an undirected graph between two sets of vertices
 * (Dinic's maximum flow): 1 for each vertex left on the sources' side.
 */
function minCut(n: number, ends: number[], costs: number[], sources: number[], sinks: number[]): Uint8Array {
  const S = n;
  const T = n + 1;
  const head = new Int32Array(n + 2).fill(-1);
  const to: number[] = [];
  const cap: number[] = [];
  const next: number[] = [];
  // arcs in pairs, each with its reverse at the index's other parity
  const arc = (a: number, b: number, forward: number, back: number): void => {
    to.push(b, a);
    cap.push(forward, back);
    next.push(head[a], head[b]);
    head[a] = to.length - 2;
    head[b] = to.length - 1;
  };
  for (let e = 0; e < costs.length; e++) arc(ends[e * 2], ends[e * 2 + 1], costs[e], costs[e]);
  for (const s of sources) arc(S, s, Infinity, 0);
  for (const t of sinks) arc(t, T, Infinity, 0);
  const level = new Int32Array(n + 2);
  const cursor = new Int32Array(n + 2);
  const queue = new Int32Array(n + 2);
  const EPS = 1e-12;
  const levels = (): boolean => {
    level.fill(-1);
    level[S] = 0;
    let read = 0;
    let write = 0;
    queue[write++] = S;
    while (read < write) {
      const u = queue[read++];
      for (let e = head[u]; e >= 0; e = next[e]) {
        if (cap[e] > EPS && level[to[e]] < 0) {
          level[to[e]] = level[u] + 1;
          queue[write++] = to[e];
        }
      }
    }
    return level[T] >= 0;
  };
  const push = (u: number, f: number): number => {
    if (u === T) return f;
    for (; cursor[u] >= 0; cursor[u] = next[cursor[u]]) {
      const e = cursor[u];
      const v = to[e];
      if (cap[e] <= EPS || level[v] !== level[u] + 1) continue;
      const d = push(v, Math.min(f, cap[e]));
      if (d > EPS) {
        cap[e] -= d;
        cap[e ^ 1] += d;
        return d;
      }
    }
    return 0;
  };
  while (levels()) {
    cursor.set(head);
    while (push(S, Infinity) > EPS);
  }
  levels();
  const reach = new Uint8Array(n);
  for (let i = 0; i < n; i++) reach[i] = level[i] >= 0 ? 1 : 0;
  return reach;
}

/**
 * A harmonic function over the mesh: the given values held (NaN where free),
 * each free vertex relaxed to the mean of its neighbours (Gauss–Seidel, the
 * free ones started at ½), so it runs smoothly and evenly between them.
 */
function harmonic(neighbours: number[][], fixed: Float32Array): Float32Array {
  const value = Float32Array.from(fixed, (v) => (Number.isNaN(v) ? 0.5 : v));
  const free: number[] = [];
  for (let i = 0; i < fixed.length; i++) if (Number.isNaN(fixed[i]) && neighbours[i].length > 0) free.push(i);
  for (let round = 0; round < HARMONIC_ROUNDS; round++) {
    for (const i of free) {
      let sum = 0;
      for (const j of neighbours[i]) sum += value[j];
      value[i] = sum / neighbours[i].length;
    }
  }
  return value;
}

/** How far each vertex inside a region (inside ≥ ½) lies from its edge, along the mesh (Dijkstra from the vertices outside). */
function inward(pos: Float32Array, neighbours: number[][], inside: Float32Array): Float32Array {
  const count = inside.length;
  const dist = new Float32Array(count).fill(Infinity);
  const heap = new Heap();
  for (let i = 0; i < count; i++) {
    if (inside[i] < 0.5) {
      dist[i] = 0;
      heap.push(i, 0);
    }
  }
  while (heap.size > 0) {
    const [a, d] = heap.pop();
    if (d > dist[a]) continue;
    for (const b of neighbours[a]) {
      if (inside[b] < 0.5) continue;
      const nd = d + Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
      if (nd < dist[b]) {
        dist[b] = nd;
        heap.push(b, nd);
      }
    }
  }
  return dist;
}

/** A binary min-heap of (item, key). */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): [number, number] {
    const { items, keys } = this;
    const top: [number, number] = [items[0], keys[0]];
    const item = items.pop() as number;
    const key = keys.pop() as number;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        items[i] = items[c];
        keys[i] = keys[c];
        i = c;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * The sculpt's colours as the coat wears them: a paint's dark seams and
 * fine strands read at single points mottle a mesh, so any vertex of the
 * coat far darker than its middle takes the middle, and the rest are
 * smoothed over their neighbours a few times (the shells draw the strands).
 * The face's pieces are painted in the shader and keep theirs.
 */
function settleColours(colour: Float32Array, neighbours: number[][], face: boolean[]): void {
  const n = colour.length / 3;
  const lum = (i: number): number => 0.2126 * colour[i * 3] + 0.7152 * colour[i * 3 + 1] + 0.0722 * colour[i * 3 + 2];
  const coat = Array.from({ length: n }, (_, i) => i).filter((i) => !face[i]);
  if (coat.length === 0) return;
  coat.sort((a, b) => lum(a) - lum(b));
  const mid = coat[coat.length >> 1];
  const middle = [colour[mid * 3], colour[mid * 3 + 1], colour[mid * 3 + 2]];
  const floor = 0.55 * lum(mid);
  for (const i of coat) if (lum(i) < floor) colour.set(middle, i * 3);
  const next = new Float32Array(colour);
  for (let pass = 0; pass < 4; pass++) {
    for (const i of coat) {
      let r = colour[i * 3];
      let g = colour[i * 3 + 1];
      let b = colour[i * 3 + 2];
      for (const j of neighbours[i]) {
        r += colour[j * 3];
        g += colour[j * 3 + 1];
        b += colour[j * 3 + 2];
      }
      const w = 1 / (1 + neighbours[i].length);
      next[i * 3] = r * w;
      next[i * 3 + 1] = g * w;
      next[i * 3 + 2] = b * w;
    }
    colour.set(next);
  }
}
