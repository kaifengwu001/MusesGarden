import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Dir, PhotoView } from '../contract';

/**
 * The `pose=qx,qy,qz,qw,zoom` hash value for a view standing at `dir` and facing `forward`, built
 * exactly as CameraRig.lookAlong builds its frame and formatted as CameraRig.poseString formats it.
 */
export function poseFor(dir: Dir, forward: Dir, zoom: number): string {
  const up = new Vector3(...dir).normalize();
  const right = new Vector3().crossVectors(new Vector3(...forward), up);
  // A forward along `up` names no heading: face any tangent rather than build a NaN frame.
  if (right.lengthSq() < 1e-12) right.crossVectors(Math.abs(up.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), up);
  right.normalize();
  const back = new Vector3().crossVectors(up, right).negate();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
  const z = Math.min(1, Math.max(0, zoom));
  return [q.x, q.y, q.z, q.w, z].map((v) => String(Number(v.toFixed(4)))).join(',');
}

/** The URL hash that reopens a photo: its planet's seed and growth, the pose, framed as a postcard. */
export function photoHash(photo: PhotoView): string {
  return `seed=${photo.worldSeed}&g=${Number(photo.g.toFixed(4))}&pose=${poseFor(photo.dir, photo.forward, photo.zoom)}&pc=1`;
}
