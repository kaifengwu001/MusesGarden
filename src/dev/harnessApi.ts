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
  /** Triangles that can reach the rasteriser (collapsed instances excluded). */
  triangles: number;
  /** Triangles submitted, including instances the vertex shaders collapse. */
  trianglesSubmitted: number;
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
  lodMin: number;
  lodMax: number;
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
  /** Set one parameter by path, e.g. set('world.growth', 0.7). */
  set(path: string, value: number | string | boolean): void;
  /** Per-frame stats of the last `count` frames (for hitch tests). */
  frameLog(count: number): Array<{ frameMs: number; jsMs: number; buildMs: number }>;
  /** CPU ↔ GPU agreement: terrain (field map) and the tiny-planet warp. */
  parity(): { heightError: number; waterError: number; warpError: number; samples: number };
  /** Pick the planet at normalised device coordinates. */
  pick(ndcX: number, ndcY: number): { dir: [number, number, number]; water: number } | null;
  /** Jump to a named view: 'homestead', 'lakes', 'meadow' or 'vista' (the reference composition). */
  preset(name: 'homestead' | 'lakes' | 'meadow' | 'vista'): void;
  /** Render `frames` frames back to back (GPU-synchronised); returns ms per frame. */
  benchmark(frames: number): number;
  /** Draw at this render scale (0.5–1) from the next frame, as Auto would. */
  setScale(scale: number): void;
}

declare global {
  interface Window {
    __meadow?: MeadowHarness;
  }
}
