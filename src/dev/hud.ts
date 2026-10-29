import type { Budgets } from '../core/quality';
import { formatArea } from '../ui/format';
import type { FrameStats } from './harnessApi';

export function createFrameStats(): FrameStats {
  return {
    frameMs: 0,
    jsMs: 0,
    gpuMs: Number.NaN,
    drawCalls: 0,
    triangles: 0,
    trianglesSubmitted: 0,
    grassInstances: 0,
    flowerInstances: 0,
    textures: 0,
    geometries: 0,
    programs: 0,
    gpuBytes: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
    samples: 0,
    tier: '',
    tierChoice: '',
    benchMs: Number.NaN,
    renderScale: 1,
    growth: 0,
    area: 0,
    radius: 0,
    chunks: 0,
    lodMin: 0,
    lodMax: 0,
    buildQueue: 0,
    buildMs: 0,
    firstFrameMs: Number.NaN,
    time: 0,
    frozen: false,
  };
}

const ROWS = ['frame', 'js', 'gpu', 'draws', 'tris', 'grass', 'memory', 'objects', 'canvas', 'tier', 'planet', 'chunks', 'boot'] as const;
type Row = (typeof ROWS)[number];

const MB = 1024 * 1024;
const SPARK_SAMPLES = 120;
const SPARK_MAX_MS = 40;

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Perf HUD. Per frame it only writes numbers into preallocated arrays; the DOM
 * and the frame-time sparkline repaint four times a second. Values over their
 * budget turn coral.
 */
export class PerfHud {
  readonly el: HTMLElement;
  private readonly values = new Map<Row, HTMLElement>();
  private readonly spark: HTMLCanvasElement;
  private readonly sparkCtx: CanvasRenderingContext2D | null;
  private readonly history = new Float32Array(SPARK_SAMPLES);
  private head = 0;
  private lastPaint = 0;
  private sumFrame = 0;
  private sumJs = 0;
  private maxFrame = 0;
  private samples = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'hud';
    this.el.setAttribute('aria-label', 'Performance');
    const head = document.createElement('header');
    head.textContent = 'perf';
    this.spark = document.createElement('canvas');
    this.spark.width = SPARK_SAMPLES * 2;
    this.spark.height = 44;
    this.sparkCtx = this.spark.getContext('2d');
    head.append(this.spark);
    this.el.append(head);
    const grid = document.createElement('dl');
    for (const row of ROWS) {
      const dt = document.createElement('dt');
      dt.textContent = row;
      const dd = document.createElement('dd');
      grid.append(dt, dd);
      this.values.set(row, dd);
    }
    this.el.append(grid);
    parent.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  frame(s: FrameStats, budgets: Budgets, nowMs: number): void {
    this.history[this.head] = s.frameMs;
    this.head = (this.head + 1) % SPARK_SAMPLES;
    this.sumFrame += s.frameMs;
    this.sumJs += s.jsMs;
    this.maxFrame = Math.max(this.maxFrame, s.frameMs);
    this.samples++;
    if (this.el.hidden || nowMs - this.lastPaint < 250) return;
    this.lastPaint = nowMs;
    this.paint(s, budgets);
    this.sumFrame = this.sumJs = this.maxFrame = this.samples = 0;
  }

  private set(row: Row, text: string, over = false): void {
    const el = this.values.get(row);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('over', over);
  }

  private paint(s: FrameStats, b: Budgets): void {
    const avg = this.sumFrame / this.samples;
    const js = this.sumJs / this.samples;
    const mem = s.gpuBytes / MB;
    this.set('frame', `${(1000 / avg).toFixed(0)} fps · ${avg.toFixed(1)} ms · max ${this.maxFrame.toFixed(1)}`, avg > b.frameMs * 1.1);
    this.set('js', `${js.toFixed(2)} / ${b.jsMs} ms`, js > b.jsMs);
    this.set('gpu', Number.isFinite(s.gpuMs) ? `${s.gpuMs.toFixed(2)} ms` : 'n/a (no timer query)', s.gpuMs > b.frameMs);
    this.set('draws', `${s.drawCalls} / ${b.drawCalls}`, s.drawCalls > b.drawCalls);
    this.set('tris', `${compact(s.triangles)} / ${compact(b.triangles)} · ${compact(s.trianglesSubmitted)} sent`, s.triangles > b.triangles);
    this.set('grass', `${compact(s.grassInstances)} / ${compact(b.grassInstances)} · flowers ${compact(s.flowerInstances)}`, s.grassInstances > b.grassInstances);
    this.set('memory', `${mem.toFixed(1)} / ${b.gpuMemoryMB} MB`, mem > b.gpuMemoryMB);
    this.set('objects', `${s.textures} tex · ${s.geometries} geo · ${s.programs} prog`);
    this.set('canvas', `${s.width}×${s.height} @${s.pixelRatio.toFixed(2)} · msaa ${s.samples}`);
    const bench = Number.isFinite(s.benchMs) ? ` · bench ${s.benchMs.toFixed(2)} ms` : '';
    const scale = s.renderScale < 1 ? ` · scale ${s.renderScale.toFixed(2)}` : '';
    this.set('tier', `${s.tier} (${s.tierChoice})${bench}${scale}`);
    this.set('planet', `R ${s.radius.toFixed(1)} m · ${formatArea(s.area)} m² · g ${s.growth.toFixed(4)}`);
    this.set('chunks', `${s.chunks} nodes L${s.lodMin}–${s.lodMax} · queue ${s.buildQueue} · ${s.buildMs.toFixed(2)} ms`);
    const t = `t ${s.time.toFixed(2)} s${s.frozen ? ' (frozen)' : ''}`;
    this.set('boot', `${Number.isFinite(s.firstFrameMs) ? `first frame ${s.firstFrameMs.toFixed(0)} ms` : '…'} · ${t}`, s.firstFrameMs > 2000);
    this.paintSpark(b.frameMs);
  }

  private paintSpark(budgetMs: number): void {
    const ctx = this.sparkCtx;
    if (!ctx) return;
    const { width: w, height: h } = this.spark;
    ctx.clearRect(0, 0, w, h);
    const barW = w / SPARK_SAMPLES;
    for (let i = 0; i < SPARK_SAMPLES; i++) {
      const ms = this.history[(this.head + i) % SPARK_SAMPLES];
      const bh = Math.min(ms / SPARK_MAX_MS, 1) * h;
      ctx.fillStyle = ms > budgetMs * 1.1 ? '#E05A4F' : 'rgba(62, 58, 54, 0.42)';
      ctx.fillRect(i * barW, h - bh, Math.max(barW - 0.5, 1), bh);
    }
    const y = h - (budgetMs / SPARK_MAX_MS) * h;
    ctx.fillStyle = 'rgba(46, 110, 158, 0.75)';
    ctx.fillRect(0, Math.round(y), w, 1);
  }
}
