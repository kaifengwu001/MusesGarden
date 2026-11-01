import type { FrameClock } from '../../../src/core/clock';
import type { HashSync } from '../core/hashSync';
import type { FrameStats, MeadowHarness } from '../../../src/dev/harnessApi';

export interface HarnessHost {
  readonly hash: HashSync;
  readonly clock: FrameClock;
  readonly gl: WebGL2RenderingContext;
  readonly stats: FrameStats;
  /** One synchronous update + render, ending on the canvas framebuffer. */
  renderFrame(): void;
  /** Finish pending work so the next frame is a pure function of the state. */
  settle(): Promise<void>;
  set(path: string, value: number | string | boolean): void;
  parity(): ReturnType<MeadowHarness['parity']>;
  pick(ndcX: number, ndcY: number): ReturnType<MeadowHarness['pick']>;
  frameLog(count: number): ReturnType<MeadowHarness['frameLog']>;
  preset(name: 'homestead' | 'lakes' | 'meadow' | 'vista' | 'muse'): void;
  setScale(scale: number): void;
}

export const HARNESS_VERSION = 'S0';

/**
 * window.__meadow: the API the screenshot harness and browser invariant tests
 * drive. It never changes what a normal visitor sees.
 */
export function installHarness(host: HarnessHost, ready: Promise<void>): MeadowHarness {
  const api: MeadowHarness = {
    version: HARNESS_VERSION,
    isReady: false,
    ready,
    setHash(hash) {
      host.hash.apply(hash);
      host.hash.writeNow();
    },
    getHash() {
      return host.hash.serialize();
    },
    freeze(t) {
      host.clock.freeze(t);
    },
    async settle() {
      await host.settle();
      host.renderFrame();
    },
    renderFrame() {
      host.renderFrame();
    },
    frameHash() {
      host.renderFrame();
      return hashCanvasPixels(host.gl);
    },
    stats() {
      return { ...host.stats };
    },
    set(path, value) {
      host.set(path, value);
    },
    frameLog(count) {
      return host.frameLog(count);
    },
    parity() {
      return host.parity();
    },
    pick(x, y) {
      return host.pick(x, y);
    },
    preset(name) {
      host.preset(name);
    },
    setScale(scale) {
      host.setScale(scale);
    },
    benchmark(frames) {
      const gl = host.gl;
      const pixel = new Uint8Array(4);
      host.renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) host.renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // waits for the GPU
      return (performance.now() - t0) / frames;
    },
  };
  void ready.then(() => {
    api.isReady = true;
  });
  window.__meadow = api;
  return api;
}

/**
 * FNV-1a over the canvas pixels. Must run in the same task as the render:
 * without preserveDrawingBuffer the buffer is only valid until compositing.
 */
function hashCanvasPixels(gl: WebGL2RenderingContext): string {
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let hash = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) {
    hash ^= pixels[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${w}x${h}`;
}
