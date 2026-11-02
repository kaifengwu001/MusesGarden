import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SPECIES_MESH } from '../../life/flowerMeshes';
import { basketFan, freeRect, type Fan } from './basketFan';
import type { BasketStage as Stage, StageFlower } from './basketStage';

// The stage without a browser: it gets no canvas to draw on, but its flowers still move frame by frame, and the
// overlay's buttons follow their heads (layout()), which is where a flower is drawn.

const SCREEN = { width: 1440, height: 900 };
const RAIL = { left: 1372, top: 430, width: 44, height: 44 };
const DT = 1 / 60;

let BasketStage: typeof Stage;

beforeAll(async () => {
  const node = (): object => ({ className: '', style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, append() {}, getContext: () => null });
  vi.stubGlobal('window', { innerWidth: SCREEN.width, innerHeight: SCREEN.height, devicePixelRatio: 2, addEventListener() {}, requestIdleCallback() {} });
  vi.stubGlobal('document', { createElement: node });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ({ BasketStage } = await import('./basketStage'));
});

const flowers = (n: number, day: string): StageFlower[] =>
  Array.from({ length: n }, (_, k) => {
    const species = (k % 4) as StageFlower['species'];
    return { id: `${day}-${k}`, species, colours: new Float32Array(SPECIES_MESH[species]().getAttribute('position').count * 3), size: 1 + 0.25 * (k % 3) };
  });

const fanOf = (n: number): Fan => basketFan(n, SCREEN, freeRect(SCREEN, RAIL));

const newStage = (): Stage => new BasketStage({ append() {} } as unknown as HTMLElement, { cameraRemaining: () => 0, basketHome: () => undefined });

type Heads = Map<string, Array<{ x: number; y: number }>>;

/** Frames until the act is done (and a few after): each flower's head per frame, and the basket's box on the frame each head first shows. */
function play(stage: Stage, act: (done: () => void) => void): { heads: Heads; first: Map<string, boolean> } {
  let done = false;
  act(() => (done = true));
  const heads: Heads = new Map();
  const first = new Map<string, boolean>();
  for (let i = 0, after = 0; i < 240 && after < 10; i++) {
    stage.frame(DT);
    const layout = stage.layout();
    const box = layout.basket!;
    for (const f of layout.flowers) {
      if (!heads.has(f.id)) {
        heads.set(f.id, []);
        first.set(f.id, Math.abs(f.x - box.x) <= box.width / 2 && Math.abs(f.y - box.y) <= box.height / 2);
      }
      heads.get(f.id)!.push({ x: f.x, y: f.y });
    }
    if (done) after++;
  }
  return { heads, first };
}

/** Frames whose step is a jump: over 4 px and more than twice the larger step either side of it. */
function jumps(path: ReadonlyArray<{ x: number; y: number }>): number[] {
  const step = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  return step.flatMap((d, i) => (d > 4 && d > 2 * Math.max(step[i - 1] ?? 0, step[i + 1] ?? 0) ? [i + 1] : []));
}

function expectRise(fan: Fan, ids: readonly string[], { heads, first }: ReturnType<typeof play>): void {
  ids.forEach((id, k) => {
    const path = heads.get(id);
    expect(path, `${id} is shown`).toBeDefined();
    expect(first.get(id), `${id} comes out of the basket`).toBe(true);
    expect(jumps(path!), `${id} never jumps`).toEqual([]);
    const end = path!.at(-1)!;
    expect(Math.hypot(end.x - fan.slots[k].x, end.y - fan.slots[k].y), `${id} ends on its slot`).toBeLessThan(8);
  });
}

describe('a basket’s flowers', () => {
  it('rise out of the basket into their fan as it opens, with no jump', () => {
    for (const n of [1, 3, 5, 12]) {
      const stage = newStage();
      const fan = fanOf(n);
      const day = flowers(n, 'a');
      const run = play(stage, (done) => stage.open(day, RAIL, fan, true, done));
      expectRise(
        fan,
        day.map((f) => f.id),
        run,
      );
    }
  });

  it('rise out of the basket into their fan when another day is picked, with no jump', () => {
    const stage = newStage();
    play(stage, (done) => stage.open(flowers(3, 'a'), RAIL, fanOf(3), true, done));
    for (const n of [5, 12, 1]) {
      const fan = fanOf(n);
      const day = flowers(n, `d${n}`);
      const run = play(stage, (done) => stage.swap(day, fan, true, done));
      expectRise(
        fan,
        day.map((f) => f.id),
        run,
      );
    }
  });
});
