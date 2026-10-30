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

/** The frame budget on every tier (ms): about 40 frames a second. */
export const FRAME_BUDGET_MS = 24;

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

/**
 * Picks the tier and steps quality live against the frame budget (24 ms).
 * When frames stay slow for 2 s, the render scale drops first (×0.85 a
 * step, to 0.72), then an Auto tier steps down one level (high → medium →
 * low), its scale back at full. After 8 s of comfortable frames the scale
 * steps back up; after 12 s of easy frames at full scale, and at least a
 * minute after it stepped down, an Auto tier steps back up (never above the
 * tier it started at). Locked during deterministic captures.
 */
export class QualityController {
  tier: Tier = TIERS.high;
  choice: TierChoice = 'auto';
  benchMs = Number.NaN;
  renderScale = 1;
  locked = false;
  private emaMs = FRAME_BUDGET_MS * 0.7;
  private slowMs = 0;
  private fastMs = 0;
  /** The tier Auto started at (it never climbs above it), and the time left before it may climb after stepping down (ms). */
  private ceiling: TierName = 'high';
  private cooldownMs = 0;

  constructor(readonly device: DeviceInfo) {}

  choose(choice: TierChoice, benchMs: number): void {
    this.choice = choice;
    if (Number.isFinite(benchMs)) this.benchMs = benchMs;
    const start = choice === 'auto' ? this.autoTier() : choice;
    this.tier = TIERS[start];
    this.ceiling = start;
    this.cooldownMs = 0;
    this.renderScale = 1;
    this.slowMs = this.fastMs = 0;
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
    this.cooldownMs = Math.max(0, this.cooldownMs - frameMs);
    const budget = this.tier.budgets.frameMs;
    if (this.emaMs > budget * 1.12) {
      this.slowMs += frameMs;
      this.fastMs = 0;
    } else if (this.emaMs < budget * 0.8) {
      this.fastMs += frameMs;
      this.slowMs = 0;
    } else {
      this.slowMs = this.fastMs = 0;
    }
    const step = TIER_ORDER.indexOf(this.tier.name);
    if (this.slowMs > 2000) {
      this.slowMs = 0;
      if (this.renderScale > 0.73) {
        this.renderScale = Math.max(0.72, this.renderScale * 0.85);
        return 'scale';
      }
      if (this.choice === 'auto' && step > 0) {
        this.tier = TIERS[TIER_ORDER[step - 1]];
        this.renderScale = 1;
        this.cooldownMs = 60000;
        return 'tier';
      }
    }
    if (this.fastMs > 8000 && this.renderScale < 1) {
      this.fastMs = 0;
      this.renderScale = Math.min(1, this.renderScale / 0.85);
      return 'scale';
    }
    if (this.fastMs > 12000 && this.choice === 'auto' && this.cooldownMs === 0 && step < TIER_ORDER.indexOf(this.ceiling) && this.emaMs < budget * 0.6) {
      this.fastMs = 0;
      this.tier = TIERS[TIER_ORDER[step + 1]];
      return 'tier';
    }
    return null;
  }

  private autoTier(): TierName {
    if (this.device.mobile) return 'low';
    if (this.benchMs > 2.5) return 'low';
    return this.benchMs > 1.2 ? 'medium' : 'high';
  }
}
