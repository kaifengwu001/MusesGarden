import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HashSync } from '../core/hashSync';
import { ParamStore } from '../params';
import { CameraRig } from '../view/camera';

const replaceState = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  replaceState.mockReset();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('location', { hash: '', pathname: '/environments/lantern-reed-gardens/', search: '' });
  vi.stubGlobal('history', { state: null, replaceState });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connectPose(hash: HashSync, rig: CameraRig): void {
  hash.register({ key: 'pose', read: () => rig.poseString(), write: value => { if (value) rig.applyPose(value); } });
}

describe('Lantern URL restoration', () => {
  it('restores the explicit camera pose after mode subscribers reset their framing', async () => {
    const store = new ParamStore();
    const rig = new CameraRig();
    const hash = new HashSync(store);
    hash.start();
    connectPose(hash, rig);
    // The same mode-change behavior as main.ts: navigation clears named-view
    // pitch and chooses a zoom endpoint. The URL's explicit pose must win.
    store.subscribe(changed => {
      if (!changed.has('view.mode')) return;
      rig.lookUp(0);
      rig.setZoom(store.values.view.mode === 'wander' ? 1 : 0);
    });

    for (const [mode, zoom, pitch] of [['wander', 0.73, 0.22], ['overview', 0.31, -0.14]] as const) {
      const pose = `0,0,0,1,${zoom},${pitch}`;
      hash.apply(`#cam=${mode}&pose=${pose}`);
      await Promise.resolve(); // The store's previously queued flush must be empty.
      expect(store.values.view.mode).toBe(mode);
      expect(rig.zoomAim).toBe(zoom);
      expect(rig.poseString()).toBe(pose);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('lets pose extras observe the world rebuilt by parameter subscribers', () => {
    const store = new ParamStore();
    const hash = new HashSync(store);
    let rebuiltSeed = store.values.world.seed;
    const poseSeeds: number[] = [];
    store.subscribe(changed => {
      if (changed.has('world.seed')) rebuiltSeed = store.values.world.seed;
    });
    hash.register({ key: 'pose', read: () => null, write: value => { if (value) poseSeeds.push(rebuiltSeed); } });
    hash.apply('#seed=901&pose=0,0,0,1,0.7,0.1');
    expect(poseSeeds).toEqual([901]);
  });

  it('cancels a pending old-view write while allowing subsequent user changes to sync', async () => {
    const store = new ParamStore();
    const rig = new CameraRig();
    const hash = new HashSync(store);
    hash.start();
    connectPose(hash, rig);
    store.set('world.seed', 7);
    store.flush();
    expect(vi.getTimerCount()).toBe(1);

    location.hash = '#seed=12&pose=0,0,0,1,0.73,0.22';
    hash.apply(location.hash);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.values.world.seed).toBe(12);
    expect(rig.poseString()).toBe('0,0,0,1,0.73,0.22');

    store.set('world.seed', 19);
    store.flush();
    vi.advanceTimersByTime(250);
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '#seed=19&pose=0,0,0,1,0.73,0.22');
  });
});
