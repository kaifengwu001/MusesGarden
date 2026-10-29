/**
 * Frame time. `time` drives the world (wind, clouds, water) and can be frozen
 * for deterministic captures; `realDt` keeps UI motion (camera glides, tweens)
 * running at wall-clock speed.
 */
export class FrameClock {
  /** World time in seconds; constant while frozen. */
  time = 0;
  /** World-time step of this frame; 0 while frozen. */
  dt = 0;
  /** Wall-clock step of this frame in seconds, clamped to [0, 1/15]. */
  realDt = 1 / 60;
  /** Unclamped wall-clock step in milliseconds (for perf stats). */
  frameMs = 1000 / 60;
  frame = 0;
  private last = -1;
  private frozenAt: number | null = null;

  get frozen(): boolean {
    return this.frozenAt !== null;
  }

  /** Freeze world time at `t` seconds, or resume with null. */
  freeze(t: number | null): void {
    this.frozenAt = t !== null && Number.isFinite(t) ? t : null;
    if (this.frozenAt !== null) this.time = this.frozenAt;
  }

  tick(nowMs: number): void {
    this.frameMs = this.last < 0 ? 1000 / 60 : nowMs - this.last;
    this.last = nowMs;
    this.realDt = Math.min(Math.max(this.frameMs / 1000, 0), 1 / 15);
    this.dt = this.frozenAt === null ? this.realDt : 0;
    this.time = this.frozenAt ?? this.time + this.dt;
    this.frame++;
  }
}
