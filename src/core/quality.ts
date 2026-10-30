import { OrthographicCamera, Scene, ShaderMaterial, UnsignedByteType, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { fullscreenMesh, fullscreenVertex } from '../render/fullscreen';

export type TierName = 'low' | 'medium' | 'high';
export type TierChoice = 'auto' | TierName;
/** Tiers from the lightest up (Auto steps along this). */
export const TIER_ORDER: readonly TierName[] = ['low', 'medium', 'high'];

export interface Budgets {
  drawCalls: number;
  triangles: number;
  grassInstances: number;
  gpuMemoryMB: number;
  jsMs: number;
  frameMs: number;
}

export interface Tier {
  readonly name: TierName;
  /** MSAA samples when the display's own pixel ratio is low enough to afford them. */
  readonly msaa: number;
  readonly grassDensityScale: number;
  readonly grassRadiusScale: number;
  /** The blades thin toward the edge of their radius: full density out to `full` of it, `edge` of it kept at the edge. */
  readonly grassFade: { readonly full: number; readonly edge: number };
  readonly flowerRadiusScale: number;
  readonly flowerDensityScale: number;
  readonly bloom: boolean;
  /** Vertices per CDLOD node edge. */
  readonly terrainGrid: number;
  /** Map sizes, chosen when the world is built: terrain bake, field map, the clouds' shadow and cover cube faces, and the shadows' sharper window. */
  readonly maps: { readonly bake: number; readonly field: number; readonly cloudShadow: number; readonly cloudLayer: number; readonly cloudWindow: number };
  readonly budgets: Budgets;
}

/**
 * The frame time Auto aims at (ms): a steady 60 frames a second. A 60 Hz
 * screen shows anything slower as 30, so a looser budget (24 ms, tried in
 * iteration 6) reads as a stutter even while every frame is in time.
 */
export const FRAME_BUDGET_MS = 1000 / 60;

export const TIERS: Readonly<Record<TierName, Tier>> = {
  high: {
    name: 'high',
    msaa: 4,
    grassDensityScale: 1,
    grassRadiusScale: 1.6,
    grassFade: { full: 0.45, edge: 0.24 },
    flowerRadiusScale: 1.5,
    flowerDensityScale: 1,
    bloom: true,
    terrainGrid: 17,
    maps: { bake: 512, field: 512, cloudShadow: 1536, cloudLayer: 768, cloudWindow: 2048 },
    budgets: { drawCalls: 120, triangles: 4_000_000, grassInstances: 600_000, gpuMemoryMB: 256, jsMs: 4, frameMs: FRAME_BUDGET_MS },
  },
  medium: {
    name: 'medium',
    msaa: 4,
    grassDensityScale: 1,
    grassRadiusScale: 1,
    grassFade: { full: 0.35, edge: 0.16 },
    flowerRadiusScale: 1,
    flowerDensityScale: 1,
    bloom: true,
    terrainGrid: 17,
    maps: { bake: 512, field: 256, cloudShadow: 1536, cloudLayer: 768, cloudWindow: 2048 },
    budgets: { drawCalls: 120, triangles: 1_800_000, grassInstances: 250_000, gpuMemoryMB: 256, jsMs: 4, frameMs: FRAME_BUDGET_MS },
  },
  low: {
    name: 'low',
    msaa: 0,
    grassDensityScale: 0.45,
    grassRadiusScale: 0.7,
    grassFade: { full: 0.35, edge: 0.16 },
    flowerRadiusScale: 0.7,
    flowerDensityScale: 0.6,
    bloom: false,
    terrainGrid: 17,
    maps: { bake: 384, field: 192, cloudShadow: 768, cloudLayer: 384, cloudWindow: 1024 },
    budgets: { drawCalls: 120, triangles: 500_000, grassInstances: 60_000, gpuMemoryMB: 256, jsMs: 4, frameMs: FRAME_BUDGET_MS },
  },
};

/** Instance pools (pages) for grass and flowers, sized for the highest tier, so any tier chosen later fills in completely. */
export const POOL_PAGES = { grass: 1000, flowers: 480 } as const;

export interface DeviceInfo {
  readonly mobile: boolean;
  /** Device-pixel-ratio cap: 2 on desktop, 1.5 on phones and tablets. */
  readonly dprCap: number;
  readonly gpu: string;
}

export function detectDevice(gl: WebGL2RenderingContext): DeviceInfo {
  const ua = navigator.userAgent;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // iPadOS reports a desktop UA; a coarse pointer with multi-touch gives it away.
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (coarse && navigator.maxTouchPoints > 1);
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return { mobile, dprCap: mobile ? 1.5 : 2, gpu };
}

// A fill-rate probe: a fixed amount of ALU work per pixel over a 1024² target.
// Provisional; S10 replaces it with a benchmark of the real scene.
const BENCH_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float acc = 0.0;
  for (int i = 0; i < 48; i++) {
    p = vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 0.6 + vUv - 0.5;
    acc += sin(p.x * 3.1 + float(i)) * cos(p.y * 1.7);
  }
  gl_FragColor = vec4(vec3(fract(acc)), 1.0);
}`;

/** Milliseconds per 1024² pass of the probe shader (GPU-synchronised). */
export function runBenchmark(renderer: WebGLRenderer): number {
  const target = new WebGLRenderTarget(1024, 1024, { type: UnsignedByteType, depthBuffer: false });
  const material = new ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: BENCH_FRAGMENT, depthTest: false, depthWrite: false });
  const mesh = fullscreenMesh(material);
  const scene = new Scene().add(mesh);
  const camera = new OrthographicCamera();
  const pixel = new Uint8Array(4);
  const passes = (n: number): void => {
    renderer.setRenderTarget(target);
    for (let i = 0; i < n; i++) renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel); // waits for the GPU
  };
  passes(2); // compile and warm up
  const t0 = performance.now();
  passes(6);
  const ms = (performance.now() - t0) / 6;
  renderer.setRenderTarget(null);
  target.dispose();
  material.dispose();
  mesh.geometry.dispose();
  return ms;
}

export type QualityChange = 'scale' | 'tier' | null;

/** How the render scale follows the frame rate (see QualityController). */
const SCALE = {
  /** Smallest scale, and the factor of one step. */
  floor: 0.6,
  step: 0.9,
  /** Frames slower than budget × this, for this long (ms), step it down. */
  slow: 1.12,
  slowFor: 1500,
  /** Frames at budget × this or better, for this long (ms; doubled after each step up that proved too much, up to the most), step it up. */
  steady: 1.06,
  upAfter: 6000,
  upAfterMost: 120000,
  /** A step up that is followed by a step down within this long (ms) proved too much. */
  proof: 4000,
} as const;
/** The last resort, for a machine still slow at the floor: frames slower than budget × this, for this long (ms), step an Auto tier down (once a tier). */
const DESPERATE = { slow: 1.5, for: 5000 } as const;

/**
 * Picks the tier and keeps the frame rate by the render scale.
 * Auto starts desktops on medium (phones, and desktops that fail the
 * startup probe, on low) and does not change the tier as you go: a tier
 * change rebuilds every blade and flower in sight, which reads as the
 * meadow reloading and flickering (iterations 6–10 did it, and dropped the
 * scale back to full each time, so frames got slower before they got
 * faster). High is there to choose. Frames slow for 1.5 s step the render
 * scale down (×0.9, to 0.6); steady frames step it back up, first after
 * 6 s and, each time a step up proves too much, after twice as long (to
 * 2 min), so it does not hunt. A 60 Hz display never shows a frame faster
 * than 16.7 ms, so "steady" there is at the refresh rate, and only a step
 * up can tell whether there is room. Only a machine still far too slow at
 * the smallest scale steps an Auto tier down, keeping its scale, and never
 * back up. Locked during deterministic captures.
 */
export class QualityController {
  tier: Tier = TIERS.high;
  choice: TierChoice = 'auto';
  benchMs = Number.NaN;
  renderScale = 1;
  locked = false;
  private emaMs = FRAME_BUDGET_MS;
  private slowMs = 0;
  private steadyMs = 0;
  private desperateMs = 0;
  /** How long steady frames must last before a step up (ms), and the time since the last step up (ms). */
  private upAfter: number = SCALE.upAfter;
  private sinceUp = Number.POSITIVE_INFINITY;

  constructor(readonly device: DeviceInfo) {}

  choose(choice: TierChoice, benchMs: number): void {
    this.choice = choice;
    if (Number.isFinite(benchMs)) this.benchMs = benchMs;
    this.tier = TIERS[choice === 'auto' ? this.autoTier() : choice];
    this.renderScale = 1;
    this.slowMs = this.steadyMs = this.desperateMs = 0;
    this.upAfter = SCALE.upAfter;
    this.sinceUp = Number.POSITIVE_INFINITY;
  }

  pixelRatio(devicePixelRatio: number): number {
    return Math.min(devicePixelRatio, this.device.dprCap) * this.renderScale;
  }

  /** MSAA only on displays of low pixel ratio; at DPR ≥ 1.75 density does the AA (whatever the render scale). */
  samples(devicePixelRatio: number): number {
    return Math.min(devicePixelRatio, this.device.dprCap) < 1.75 ? this.tier.msaa : 0;
  }

  observe(frameMs: number): QualityChange {
    if (this.locked || document.hidden || frameMs > 250) return null; // tab switches and stalls
    this.emaMs += (frameMs - this.emaMs) * 0.05;
    this.sinceUp += frameMs;
    const budget = this.tier.budgets.frameMs;
    const slow = this.emaMs > budget * SCALE.slow;
    this.slowMs = slow ? this.slowMs + frameMs : 0;
    this.steadyMs = this.emaMs < budget * SCALE.steady ? this.steadyMs + frameMs : 0;
    this.desperateMs = this.emaMs > budget * DESPERATE.slow && this.renderScale <= SCALE.floor + 1e-3 ? this.desperateMs + frameMs : 0;
    if (this.slowMs > SCALE.slowFor && this.renderScale > SCALE.floor + 1e-3) {
      this.slowMs = 0;
      // a step up that did not last: wait twice as long before the next
      if (this.sinceUp < SCALE.proof) this.upAfter = Math.min(this.upAfter * 2, SCALE.upAfterMost);
      this.sinceUp = Number.POSITIVE_INFINITY;
      this.renderScale = Math.max(SCALE.floor, this.renderScale * SCALE.step);
      return 'scale';
    }
    if (this.desperateMs > DESPERATE.for && this.choice === 'auto') {
      this.desperateMs = 0;
      const step = TIER_ORDER.indexOf(this.tier.name);
      if (step > 0) {
        this.tier = TIERS[TIER_ORDER[step - 1]];
        return 'tier';
      }
    }
    if (this.steadyMs > this.upAfter && this.renderScale < 1) {
      this.steadyMs = 0;
      this.sinceUp = 0;
      this.renderScale = Math.min(1, this.renderScale / SCALE.step);
      return 'scale';
    }
    return null;
  }

  private autoTier(): TierName {
    if (this.device.mobile || this.benchMs > 2.5) return 'low';
    return 'medium';
  }
}
