import { describe, expect, it } from 'vitest';
import { CameraRig } from '../view/camera';

describe('wildlife inspection lens', () => {
  it('reaches the small species without changing their size, then restores walking height', () => {
    const rig = new CameraRig();
    rig.setZoom(1, true);
    for (const height of [0.5, 0.29, 0.18, 1.6]) {
      rig.detailEyeHeight = height;
      rig.update(1, 128, 1.6, () => 0);
      expect(rig.camera.position.length() - 128).toBeCloseTo(height, 5);
      expect(rig.altitude).toBeCloseTo(height, 5);
      expect(rig.camera.near).toBeLessThan(height);
    }
  });
});
