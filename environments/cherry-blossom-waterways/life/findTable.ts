// Each find's state, as its patch and its sphere read it: one row of STRIDE
// floats per find, uploaded as a float texture (two texels a find, PER_ROW
// finds to a row). Kept by find, not by place in the garden, so a find keeps
// its planting, its card's light and its basket's mark when the garden is
// laid out again round a newer basket.

/** Planted long ago: fully grown. Not planted yet: hidden. */
export const LONG_AGO = -1e6;
export const NOT_YET = 1e9;
/** Floats per find (two RGBA texels), and finds per row of the texture. */
export const STRIDE = 8;
export const PER_ROW = 256;
/** Where each value sits in a find's row (findState.glsl reads them back). */
export const FIELD = { planted: 0, open: 1, lift: 2, pulsed: 3, mark: 4 } as const;
/** How fast a patch lifts under the pointer, and takes on or loses its basket's mark (s). */
const LIFT_TIME = 0.12;
const MARK_TIME = 0.5;

export class FindTable {
  data = new Float32Array(PER_ROW * STRIDE);
  /** Bumped on every change, so the texture knows to upload again. */
  version = 0;
  private ids: readonly string[] = [];
  private slots = new Map<string, number>();
  private hoveredId: string | null = null;
  private openId: string | null = null;
  private picked: readonly string[] = [];
  /** Finds still easing toward their lift or their mark. */
  private readonly moving = new Set<string>();

  get size(): number {
    return this.ids.length;
  }

  /** Rows the texture needs. */
  get rows(): number {
    return this.data.length / (PER_ROW * STRIDE);
  }

  get hovered(): string | null {
    return this.hoveredId;
  }

  /** The picked basket's finds. */
  get selected(): readonly string[] {
    return this.picked;
  }

  slot(id: string): number | undefined {
    return this.slots.get(id);
  }

  get(id: string, field: keyof typeof FIELD): number | undefined {
    const s = this.slots.get(id);
    return s === undefined ? undefined : this.data[s * STRIDE + FIELD[field]];
  }

  /**
   * Lay out these finds, one row each in the order given. A find laid out before keeps its state; a new
   * one stands grown. `hidden`: finds not planted yet, which wait unseen until planted.
   */
  assign(ids: readonly string[], hidden: ReadonlySet<string>): void {
    const data = new Float32Array(Math.max(1, Math.ceil(ids.length / PER_ROW)) * PER_ROW * STRIDE);
    const slots = new Map<string, number>();
    ids.forEach((id, s) => {
      const at = s * STRIDE;
      const was = this.slots.get(id);
      if (was !== undefined) data.set(this.data.subarray(was * STRIDE, was * STRIDE + STRIDE), at);
      else {
        data[at + FIELD.planted] = LONG_AGO;
        data[at + FIELD.pulsed] = LONG_AGO;
      }
      if (hidden.has(id)) data[at + FIELD.planted] = NOT_YET;
      else if (data[at + FIELD.planted] === NOT_YET) data[at + FIELD.planted] = LONG_AGO;
      slots.set(id, s);
    });
    this.data = data;
    this.ids = ids.slice();
    this.slots = slots;
    this.version++;
  }

  /** Plant these finds from `at` (s), one after another `gap` s apart. */
  plant(ids: readonly string[], at: number, gap: number): void {
    ids.forEach((id, k) => this.write(id, FIELD.planted, at + k * gap));
  }

  unplant(ids: readonly string[]): void {
    for (const id of ids) this.write(id, FIELD.planted, NOT_YET);
  }

  pulse(ids: readonly string[], at: number): void {
    for (const id of ids) this.write(id, FIELD.pulsed, at);
  }

  /** The find whose card is up (null: none). */
  open(id: string | null): void {
    if (id === this.openId) return;
    if (this.openId !== null) this.write(this.openId, FIELD.open, 0);
    this.openId = id;
    if (id !== null) this.write(id, FIELD.open, 1);
  }

  /** The find under the pointer (null: none): its patch lifts. */
  hover(id: string | null): void {
    if (id === this.hoveredId) return;
    if (this.hoveredId !== null) this.moving.add(this.hoveredId);
    if (id !== null) this.moving.add(id);
    this.hoveredId = id;
  }

  /** The picked basket's finds: they take its mark, and the last basket's lose it. */
  select(ids: readonly string[]): void {
    for (const id of this.picked) this.moving.add(id);
    for (const id of ids) this.moving.add(id);
    this.picked = ids.slice();
  }

  /** Move the lifts and marks on by `dt` s. */
  ease(dt: number): void {
    if (this.moving.size === 0) return;
    const lift = Math.min(1, dt / LIFT_TIME);
    const mark = Math.min(1, dt / MARK_TIME);
    for (const id of this.moving) {
      const s = this.slots.get(id);
      if (s === undefined) {
        this.moving.delete(id);
        continue;
      }
      const at = s * STRIDE;
      const a = approach(this.data[at + FIELD.lift], id === this.hoveredId ? 1 : 0, lift);
      const b = approach(this.data[at + FIELD.mark], this.picked.includes(id) ? 1 : 0, mark);
      this.data[at + FIELD.lift] = a.value;
      this.data[at + FIELD.mark] = b.value;
      if (a.settled && b.settled) this.moving.delete(id);
    }
    this.version++;
  }

  private write(id: string, field: number, value: number): void {
    const s = this.slots.get(id);
    if (s === undefined) return;
    this.data[s * STRIDE + field] = value;
    this.version++;
  }
}

function approach(value: number, target: number, k: number): { value: number; settled: boolean } {
  const next = value + (target - value) * k;
  return Math.abs(target - next) < 2e-3 ? { value: target, settled: true } : { value: next, settled: false };
}
