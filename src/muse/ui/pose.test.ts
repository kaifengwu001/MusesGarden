import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseHash } from '../../core/hashSync';
import { CameraRig } from '../../view/camera';
import type { Dir } from '../contract';
import { samplePhotos } from '../samples';
import { photoHash, poseFor } from './pose';

const unit = (x: number, y: number, z: number): Dir => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
};

/** dir, forward (not always tangent: lookAlong projects it), zoom. */
const views: readonly (readonly [Dir, Dir, number])[] = [
  ...samplePhotos.items.map((p) => [p.dir, p.forward, p.zoom] as const),
  [unit(0, 1, 0), unit(0, 0, -1), 0],
  [unit(0, -1, 0), unit(1, 0, 0), 1],
  [unit(1, 0, 0), unit(0, 1, 1), 0.35],
  [unit(-0.2, -0.7, 0.68), unit(0.5, 0.2, 0.9), 0.83],
];

function applied(pose: string): CameraRig {
  const rig = new CameraRig();
  expect(rig.applyPose(pose)).toBe(true);
  return rig;
}

describe('poseFor', () => {
  it('writes the pose CameraRig.lookAlong frames, as poseString writes it', () => {
    for (const [dir, forward, zoom] of views) {
      const rig = new CameraRig();
      rig.lookAlong(new Vector3(...dir), new Vector3(...forward));
      rig.setZoom(zoom);
      expect(poseFor(dir, forward, zoom)).toBe(rig.poseString());
    }
  });

  it('round-trips through applyPose: the camera stands at dir, facing forward along the ground', () => {
    for (const [dir, forward, zoom] of views) {
      const rig = applied(poseFor(dir, forward, zoom));
      const up = new Vector3(0, 1, 0).applyQuaternion(rig.frame);
      expect(up.distanceTo(new Vector3(...dir))).toBeLessThan(1e-3);
      const f = new Vector3(...forward);
      const tangent = f.addScaledVector(up, -f.dot(up)).normalize();
      expect(new Vector3(0, 0, -1).applyQuaternion(rig.frame).distanceTo(tangent)).toBeLessThan(1e-3);
      expect(rig.zoom).toBeCloseTo(zoom, 4);
    }
  });

  it('still stands at dir when forward points straight up', () => {
    const dir = unit(0.3, 0.9, -0.2);
    const pose = poseFor(dir, dir, 0.5);
    expect(pose.split(',').map(Number).every(Number.isFinite)).toBe(true);
    const up = new Vector3(0, 1, 0).applyQuaternion(applied(pose).frame);
    expect(up.distanceTo(new Vector3(...dir))).toBeLessThan(1e-3);
  });
});

describe('photoHash', () => {
  it("reopens the photo's planet and view as a postcard", () => {
    const photo = samplePhotos.items[0];
    const hash = parseHash(photoHash(photo));
    expect(hash.get('seed')).toBe(String(photo.worldSeed));
    expect(Number(hash.get('g'))).toBeCloseTo(photo.g, 4);
    expect(hash.get('pc')).toBe('1');
    const up = new Vector3(0, 1, 0).applyQuaternion(applied(hash.get('pose') ?? '').frame);
    expect(up.distanceTo(new Vector3(...photo.dir))).toBeLessThan(1e-3);
  });
});
