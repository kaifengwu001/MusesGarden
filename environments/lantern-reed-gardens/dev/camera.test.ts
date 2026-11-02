import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig as SharedCameraRig } from '../../../src/view/camera';
import { Flight } from '../../../src/view/flight';
import { CameraRig } from '../view/camera';

const RADIUS = 128;
const ASPECT = 16 / 9;
const ground = (): number => 0.8;

function settle(rig: SharedCameraRig): void {
  rig.settle();
  rig.update(20, RADIUS, ASPECT, ground);
}

function namedView(): CameraRig {
  const rig = new CameraRig();
  rig.update(0, RADIUS, ASPECT, ground);
  const up = new Vector3(0.22, 0.91, -0.35).normalize();
  const forward = new Vector3(0, 0, -1).addScaledVector(up, up.z).normalize();
  rig.lookAlong(up, forward);
  rig.setZoom(0.8234, true);
  rig.lookUp(0.1337, false);
  return rig;
}

const pitchOf = (rig: CameraRig): number => Number(rig.poseString().split(',')[5]);

describe('Lantern shared camera views', () => {
  it('restores a named view’s framing, including its requested pitch before the transition settles', () => {
    const original = namedView();
    const link = original.poseString();
    expect(link.split(',')).toHaveLength(6);
    const reopened = new CameraRig();
    expect(reopened.applyPose(link)).toBe(true);
    settle(original);
    settle(reopened);
    expect(reopened.camera.position.distanceTo(original.camera.position)).toBeLessThan(0.02);
    expect(reopened.camera.quaternion.angleTo(original.camera.quaternion)).toBeLessThan(0.0002);
    expect(reopened.camera.fov).toBe(original.camera.fov);
    expect(reopened.poseString()).toBe(link);
  });

  it('accepts legacy five-number links and clears a previous named-view pitch', () => {
    const legacy = new SharedCameraRig();
    legacy.setZoom(0.71, true);
    const restored = namedView();
    expect(restored.applyPose(legacy.poseString())).toBe(true);
    settle(legacy);
    settle(restored);
    expect(pitchOf(restored)).toBe(0);
    expect(restored.camera.quaternion.angleTo(legacy.camera.quaternion)).toBeLessThan(0.0002);
    expect(restored.camera.position.distanceTo(legacy.camera.position)).toBeLessThan(0.02);
  });

  it.each([
    '', '0,0,0,1', '0,0,0,1,0.7,0.2,3',
    '0,0,,1,0.7,0.2', '0,0,0,1, ,0.2',
    '0,0,0,0,0.7,0.2', 'NaN,0,0,1,0.7,0.2',
    '0,0,0,1,Infinity,0.2', '0,0,0,1,0.7,NaN',
    '0,0,0,1,0.7,1.6', '0,0,0,1,0.7,-1.6',
  ])('rejects malformed pose %j without changing the current view', text => {
    const rig = namedView();
    const before = rig.poseString();
    expect(rig.applyPose(text)).toBe(false);
    expect(rig.poseString()).toBe(before);
  });

  it('normalizes finite quaternions, preserves legacy zoom clamping and accepts both pitch limits', () => {
    const rig = new CameraRig();
    expect(rig.applyPose(`0,0,0,1e200,2,${Math.PI / 2}`)).toBe(true);
    expect(rig.frame.length()).toBeCloseTo(1, 12);
    expect(rig.zoomAim).toBe(1);
    expect(new CameraRig().applyPose(rig.poseString())).toBe(true);
    expect(rig.applyPose(`0,0,0,2,-1,${-Math.PI / 2}`)).toBe(true);
    expect(rig.zoomAim).toBe(0);
    expect(new CameraRig().applyPose(rig.poseString())).toBe(true);
  });

  const navigation: Array<[string, (rig: CameraRig) => void]> = [
    ['drag', rig => rig.drag(8, 4, 1280, 720)],
    ['zoom', rig => rig.zoomBy(-0.1)],
    ['walk ahead', rig => rig.walk(1, 0)],
    ['walk across', rig => rig.walk(0, 1)],
    ['turn', rig => rig.turn(0.2)],
    ['glide', rig => rig.glideTo(new Vector3(0, 1, 0))],
    ['zero-distance drag', rig => rig.drag(0, 0, 1280, 720)],
    ['zero zoom input', rig => rig.zoomBy(0)],
  ];
  it.each(navigation)('%s clears the shared pitch along with the base navigation target', (_name, move) => {
    const rig = namedView();
    settle(rig);
    move(rig);
    expect(pitchOf(rig)).toBe(0);
    const restored = new CameraRig();
    expect(restored.applyPose(rig.poseString())).toBe(true);
    // The inherited double-click glide has its own target timing; compare only
    // the camera's pitch after navigation rather than its evolving surface frame.
    rig.update(20, RADIUS, ASPECT, ground);
    const expected = new SharedCameraRig();
    expect(expected.applyPose(rig.poseString().split(',').slice(0, 5).join(','))).toBe(true);
    settle(rig);
    settle(expected);
    expect(rig.camera.quaternion.angleTo(expected.camera.quaternion)).toBeLessThan(0.0002);
  });

  it('preserves framing for idle keys and explicit position/zoom changes', () => {
    const rig = namedView();
    rig.walk(0, 0);
    rig.turn(0);
    rig.lookAlong(new Vector3(0, 1, 0), new Vector3(0, 0, -1));
    rig.setZoom(0.6);
    expect(pitchOf(rig)).toBe(0.1337);
  });

  it('remains compatible with shared flights and saves the resulting view', () => {
    const rig = namedView();
    settle(rig);
    const flight = new Flight(rig);
    flight.to({ dir: new Vector3(0, 1, 0), ground: 0.8, distance: 12, height: 5, aim: 1, from: new Vector3(0, 0, -1) }, RADIUS, ground);
    flight.update(10);
    expect(flight.flying).toBe(false);
    expect(Math.abs(pitchOf(rig))).toBeGreaterThan(0.01);
    const restored = new CameraRig();
    expect(restored.applyPose(rig.poseString())).toBe(true);
    settle(rig);
    settle(restored);
    expect(restored.camera.quaternion.angleTo(rig.camera.quaternion)).toBeLessThan(0.0002);
  });
});
