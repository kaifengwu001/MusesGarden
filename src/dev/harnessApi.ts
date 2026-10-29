// Types shared by the in-page harness (harness.ts) and the Playwright specs
// that drive it. Type-only: safe to import from Node.

/** One frame's numbers, as shown in the perf HUD. */
export interface FrameStats {
  /** Wall-clock time between frames, ms. */
  frameMs: number;
  /** JS time for update + render submission, ms. */
  jsMs: number;
  /** GPU time from a timer query, ms; NaN where unsupported (Safari). */
  gpuMs: number;
  drawCalls: number;
  triangles: number;
  grassInstances: number;
  flowerInstances: number;
  textures: number;
  geometries: number;
  programs: number;
  /** Estimated GPU memory from our allocation ledger, bytes. */
  gpuBytes: number;
  width: number;
  height: number;
  pixelRatio: number;
  samples: number;
  tier: string;
  tierChoice: string;
  benchMs: number;
  renderScale: number;
  growth: number;
  area: number;
  radius: number;
  chunks: number;
  buildQueue: number;
  buildMs: number;
  /** Time from navigation start to the first presented frame, ms. */
  firstFrameMs: number;
  time: number;
  frozen: boolean;
}

export interface MeadowHarness {
  readonly version: string;
  /** True once shaders are warm and the first frame has been presented. */
  isReady: boolean;
  readonly ready: Promise<void>;
  /** Apply a full hash state (params, camera pose, frozen time) as if the URL changed. */
  setHash(hash: string): void;
  /** The canonical hash for the current state. */
  getHash(): string;
  /** Freeze world time at t seconds, or resume with null. */
  freeze(t: number | null): void;
  /** Finish pending work (build queues, growth fades), warm shaders, render one frame. */
  settle(): Promise<void>;
  /** One synchronous update + render. */
  renderFrame(): void;
  /** Render one frame and return an FNV-1a hash of the canvas pixels. */
  frameHash(): string;
  stats(): FrameStats;
}

declare global {
  interface Window {
    __meadow?: MeadowHarness;
  }
}
