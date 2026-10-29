interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/**
 * GPU frame time from EXT_disjoint_timer_query_webgl2 (Chrome desktop; Safari
 * has no timer queries, so `ms` stays NaN there). Results arrive a few frames
 * late; at most four queries are in flight and they are recycled.
 */
export class GpuTimer {
  /** Most recent GPU time in ms; NaN when unsupported or not yet available. */
  ms = Number.NaN;
  private readonly ext: TimerQueryExt | null;
  private readonly free: WebGLQuery[] = [];
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length >= 4) return;
    const query = this.free.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll(): void {
    const ext = this.ext;
    if (!ext) return;
    const gl = this.gl;
    while (this.pending.length > 0) {
      const query = this.pending[0];
      if (!(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      if (!(gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean)) this.ms = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
      this.pending.shift();
      this.free.push(query);
    }
  }
}
