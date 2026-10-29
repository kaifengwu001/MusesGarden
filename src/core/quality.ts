import { OrthographicCamera, Scene, ShaderMaterial, UnsignedByteType, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { fullscreenMesh, fullscreenVertex } from '../render/fullscreen';

export type TierName = 'low' | 'high';
export type TierChoice = 'auto' | TierName;

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
  /** MSAA samples when the drawing buffer is small enough to afford them. */
  readonly msaa: number;
  readonly grassDensityScale: number;
  readonly grassRadiusScale: number;
  readonly flowerRadiusScale: number;
  readonly shadowMapSize: number;
  readonly bloom: boolean;
  /** Vertices per CDLOD node edge. */
  readonly terrainGrid: number;
  readonly budgets: Budgets;
}

const FRAME_60 = 1000 / 60;

export const TIERS: Readonly<Record<TierName, Tier>> = {
  high: {
    name: 'high',
    msaa: 4,
    grassDensityScale: 1,
    grassRadiusScale: 1,
    flowerRadiusScale: 1,
    shadowMapSize: 2048,
    bloom: true,
    terrainGrid: 17,
    budgets: { drawCalls: 120, triangles: 1_500_000, grassInstances: 250_000, gpuMemoryMB: 256, jsMs: 4, frameMs: FRAME_60 },
  },
  low: {
    name: 'low',
    msaa: 0,
    grassDensityScale: 0.45,
    grassRadiusScale: 0.7,
    flowerRadiusScale: 0.7,
    shadowMapSize: 1024,
    bloom: false,
    terrainGrid: 17,
    budgets: { drawCalls: 120, triangles: 500_000, grassInstances: 60_000, gpuMemoryMB: 256, jsMs: 4, frameMs: FRAME_60 },
  },
};

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
 * Picks the tier and steps quality down live. Render scale drops first
 * (×0.85 per step, floor 0.6) when frame time stays high for 2 s; if it is
 * already at the floor, an auto tier drops to low. It steps back up after
 * 8 s of comfortable frames. Locked during deterministic captures.
 */
export class QualityController {
  tier: Tier = TIERS.high;
  choice: TierChoice = 'auto';
  benchMs = Number.NaN;
  renderScale = 1;
  locked = false;
  private emaMs = FRAME_60;
  private slowMs = 0;
  private fastMs = 0;

  constructor(readonly device: DeviceInfo) {}

  choose(choice: TierChoice, benchMs: number): void {
    this.choice = choice;
    if (Number.isFinite(benchMs)) this.benchMs = benchMs;
    this.tier = TIERS[choice === 'auto' ? this.autoTier() : choice];
    this.renderScale = 1;
    this.slowMs = this.fastMs = 0;
  }

  pixelRatio(devicePixelRatio: number): number {
    return Math.min(devicePixelRatio, this.device.dprCap) * this.renderScale;
  }

  /** MSAA only when the drawing buffer is small; at DPR ≥ 1.75 density does the AA. */
  samples(pixelRatio: number): number {
    return pixelRatio < 1.75 ? this.tier.msaa : 0;
  }

  observe(frameMs: number): QualityChange {
    if (this.locked || document.hidden || frameMs > 250) return null; // tab switches and stalls
    this.emaMs += (frameMs - this.emaMs) * 0.05;
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
    if (this.slowMs > 2000) {
      this.slowMs = 0;
      if (this.renderScale > 0.6) {
        this.renderScale = Math.max(0.6, this.renderScale * 0.85);
        return 'scale';
      }
      if (this.choice === 'auto' && this.tier.name === 'high') {
        this.tier = TIERS.low;
        this.renderScale = 1;
        return 'tier';
      }
    }
    if (this.fastMs > 8000 && this.renderScale < 1) {
      this.fastMs = 0;
      this.renderScale = Math.min(1, this.renderScale / 0.85);
      return 'scale';
    }
    return null;
  }

  private autoTier(): TierName {
    if (this.device.mobile) return 'low';
    return this.benchMs > 2.5 ? 'low' : 'high';
  }
}
