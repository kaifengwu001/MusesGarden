import { describe, expect, it } from 'vitest';
import { basketStep, CLOSED, holdsPointer, type BasketEvent, type BasketState, type Effect, type Phase, type Picked } from './basketMachine';

const at = (phase: Phase, more: Partial<BasketState> = {}): BasketState => ({ ...CLOSED, phase, ...more });

const PHASES: Record<Phase['kind'], Phase> = {
  closed: { kind: 'closed' },
  opening: { kind: 'opening', basket: 'b1' },
  open: { kind: 'open', basket: 'b1' },
  swapping: { kind: 'swapping', basket: 'b1' },
  closing: { kind: 'closing', basket: 'b1' },
  sending: { kind: 'sending', basket: 'b1', find: 'f1' },
  sendingAll: { kind: 'sendingAll', basket: 'b1' },
};

/** One of each event (`done` for the phase it is sent in). */
const EVENTS = {
  rail: { type: 'rail', basket: 'b2' },
  show: { type: 'show', basket: 'b3' },
  hover: { type: 'hover', target: { kind: 'find', id: 'f1' } },
  pick: { type: 'pick', find: 'f1', touch: false },
  pickBasket: { type: 'pickBasket', touch: false },
  day: { type: 'day', basket: 'b3' },
  dismiss: { type: 'dismiss' },
  sheet: { type: 'sheet' },
  camera: { type: 'camera' },
  done: null,
} as const satisfies Record<BasketEvent['type'], BasketEvent | null>;
type Name = keyof typeof EVENTS;

const event = (name: Name, phase: Phase): BasketEvent => EVENTS[name] ?? { type: 'done', phase: phase.kind as 'opening' };

/** What each phase does with each event: the next phase, the effects, and what is lit after. Everything not listed is ignored. */
type Expect = { phase: Phase; effects: Effect[]; preview?: 'f1'; picked?: Picked };
const opens = (basket: string, first: Effect[] = []): Expect => ({ phase: { kind: 'opening', basket }, effects: [...first, { type: 'open', basket, animate: true }, { type: 'visit', basket }] });
const closes: Expect = { phase: { kind: 'closing', basket: 'b1' }, effects: [{ type: 'close', animate: true }] };
const swaps: Expect = { phase: { kind: 'swapping', basket: 'b3' }, effects: [{ type: 'swap', basket: 'b3', animate: true }, { type: 'visit', basket: 'b3' }] };
const OUT: Partial<Record<Name, Expect>> = {
  rail: closes,
  dismiss: closes,
  sheet: closes,
  hover: { phase: PHASES.open, effects: [], preview: 'f1' },
  pick: { phase: { kind: 'sending', basket: 'b1', find: 'f1' }, effects: [{ type: 'send', find: 'f1', animate: true }, { type: 'fly', to: { find: 'f1' } }] },
  pickBasket: { phase: { kind: 'sendingAll', basket: 'b1' }, effects: [{ type: 'sendAll', basket: 'b1', animate: true }, { type: 'fly', to: { basket: 'b1' } }] },
  day: swaps,
  show: swaps,
};
const lit = (picked: Picked): Effect[] => [{ type: 'settle' }, { type: 'highlight', picked }];
const EXPECT: Record<Phase['kind'], Partial<Record<Name, Expect>>> = {
  closed: { rail: opens('b2'), show: opens('b3') },
  opening: { ...OUT, hover: { ...OUT.hover!, phase: PHASES.opening }, done: { phase: PHASES.open, effects: [] } },
  open: OUT,
  swapping: { ...OUT, hover: { ...OUT.hover!, phase: PHASES.swapping }, done: { phase: PHASES.open, effects: [] } },
  closing: { rail: opens('b2'), show: opens('b3'), done: { phase: PHASES.closed, effects: [] } },
  sending: {
    camera: { phase: PHASES.sending, effects: [{ type: 'cancelFlight' }] },
    done: { phase: PHASES.closed, effects: [{ type: 'highlight', picked: { find: 'f1' } }, { type: 'card', find: 'f1' }], picked: { find: 'f1' } },
    rail: { ...opens('b2', lit({ find: 'f1' })), picked: { find: 'f1' } },
    show: { ...opens('b3', lit({ find: 'f1' })), picked: { find: 'f1' } },
    sheet: { phase: PHASES.closed, effects: lit({ find: 'f1' }), picked: { find: 'f1' } },
  },
  sendingAll: {
    camera: { phase: PHASES.sendingAll, effects: [{ type: 'cancelFlight' }] },
    done: { phase: PHASES.closed, effects: [{ type: 'highlight', picked: { basket: 'b1' } }], picked: { basket: 'b1' } },
    rail: { ...opens('b2', lit({ basket: 'b1' })), picked: { basket: 'b1' } },
    show: { ...opens('b3', lit({ basket: 'b1' })), picked: { basket: 'b1' } },
    sheet: { phase: PHASES.closed, effects: lit({ basket: 'b1' }), picked: { basket: 'b1' } },
  },
};

const CASES = (Object.keys(PHASES) as Phase['kind'][]).flatMap((kind) => (Object.keys(EVENTS) as Name[]).map((name) => ({ kind, name, want: EXPECT[kind][name] })));

/** Run events from a state; the effects of all of them. */
function run(state: BasketState, events: readonly BasketEvent[], reduced = false): { state: BasketState; effects: Effect[] } {
  const effects: Effect[] = [];
  for (const e of events) {
    const step = basketStep(state, e, reduced);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe('the basket’s phases', () => {
  it.each(CASES.filter((c) => c.want))('$kind, on $name', ({ kind, name, want }) => {
    const step = basketStep(at(PHASES[kind]), event(name, PHASES[kind]), false);
    expect(step.state.phase).toEqual(want!.phase);
    expect(step.effects).toEqual(want!.effects);
    expect(step.state.preview).toEqual(want!.preview ? { kind: 'find', id: want!.preview } : null);
    expect(step.state.picked).toEqual(want!.picked ?? null);
  });

  it.each(CASES.filter((c) => !c.want))('$kind ignores $name', ({ kind, name }) => {
    const before = at(PHASES[kind], { preview: { kind: 'basket' }, picked: { find: 'f0' } });
    const step = basketStep(before, event(name, PHASES[kind]), false);
    expect(step.state).toBe(before);
    expect(step.effects).toEqual([]);
  });

  it('ignores an act that ends after its phase was left (a stale done)', () => {
    for (const [kind, phase] of Object.entries(PHASES)) {
      for (const stale of ['opening', 'swapping', 'closing', 'sending', 'sendingAll'] as const) {
        if (stale === kind) continue;
        const before = at(phase);
        expect(basketStep(before, { type: 'done', phase: stale }, false)).toEqual({ state: before, effects: [] });
      }
    }
  });

  it('holds the pointer only while the basket is out', () => {
    expect(Object.values(PHASES).filter(holdsPointer).map((p) => p.kind)).toEqual(['opening', 'open', 'swapping']);
  });
});

describe('a basket opened, a flower picked and sent home', () => {
  it('plays from the rail to the card, and keeps the flower lit after', () => {
    const { state, effects } = run(CLOSED, [
      { type: 'rail', basket: 'b2' },
      { type: 'done', phase: 'opening' },
      { type: 'hover', target: { kind: 'find', id: 'f4' } },
      { type: 'pick', find: 'f4', touch: false },
      { type: 'camera' },
      { type: 'done', phase: 'sending' },
    ]);
    expect(state).toEqual({ phase: { kind: 'closed' }, preview: null, picked: { find: 'f4' } });
    expect(effects).toEqual([
      { type: 'open', basket: 'b2', animate: true },
      { type: 'visit', basket: 'b2' },
      { type: 'send', find: 'f4', animate: true },
      { type: 'fly', to: { find: 'f4' } },
      { type: 'cancelFlight' },
      { type: 'highlight', picked: { find: 'f4' } },
      { type: 'card', find: 'f4' },
    ]);
  });

  it('keeps the last flower lit while the basket opens again, until the next pick', () => {
    const sent = run(CLOSED, [{ type: 'rail', basket: 'b2' }, { type: 'pick', find: 'f4', touch: false }, { type: 'done', phase: 'sending' }]).state;
    const again = run(sent, [{ type: 'rail', basket: 'b2' }, { type: 'done', phase: 'opening' }, { type: 'dismiss' }, { type: 'done', phase: 'closing' }]);
    expect(again.state.picked).toEqual({ find: 'f4' });
    expect(again.effects.some((e) => e.type === 'highlight')).toBe(false);
    const all = run(again.state, [{ type: 'rail', basket: 'b2' }, { type: 'pickBasket', touch: false }, { type: 'done', phase: 'sendingAll' }]);
    expect(all.state.picked).toEqual({ basket: 'b2' });
    expect(all.effects.at(-1)).toEqual({ type: 'highlight', picked: { basket: 'b2' } });
  });
});

describe('on a touch screen', () => {
  const open = at(PHASES.open);

  it('previews on the first tap and sends on a second tap of the same flower', () => {
    const first = basketStep(open, { type: 'pick', find: 'f2', touch: true }, false);
    expect(first.state).toEqual({ ...open, preview: { kind: 'find', id: 'f2' } });
    expect(first.effects).toEqual([]);
    const other = basketStep(first.state, { type: 'pick', find: 'f3', touch: true }, false);
    expect(other.state.preview).toEqual({ kind: 'find', id: 'f3' });
    expect(other.state.phase.kind).toBe('open');
    const second = basketStep(other.state, { type: 'pick', find: 'f3', touch: true }, false);
    expect(second.state.phase).toEqual({ kind: 'sending', basket: 'b1', find: 'f3' });
  });

  it('previews the basket on the first tap and sends them all on the second', () => {
    const first = basketStep(open, { type: 'pickBasket', touch: true }, false);
    expect(first.state.preview).toEqual({ kind: 'basket' });
    expect(first.state.phase.kind).toBe('open');
    expect(basketStep(first.state, { type: 'pickBasket', touch: true }, false).state.phase).toEqual({ kind: 'sendingAll', basket: 'b1' });
  });

  it('sends at the first click with a mouse, previewed or not', () => {
    expect(basketStep(open, { type: 'pick', find: 'f2', touch: false }, false).state.phase.kind).toBe('sending');
    expect(basketStep(open, { type: 'pickBasket', touch: false }, false).state.phase.kind).toBe('sendingAll');
  });
});

describe('interrupts', () => {
  it('retargets a swap to the latest day dragged to, and opens on it', () => {
    const { state, effects } = run(at(PHASES.open), [
      { type: 'day', basket: 'b2' },
      { type: 'day', basket: 'b3' },
      { type: 'day', basket: 'b3' },
      { type: 'done', phase: 'swapping' },
    ]);
    expect(state.phase).toEqual({ kind: 'open', basket: 'b3' });
    expect(effects).toEqual([
      { type: 'swap', basket: 'b2', animate: true },
      { type: 'visit', basket: 'b2' },
      { type: 'swap', basket: 'b3', animate: true },
      { type: 'visit', basket: 'b3' },
    ]);
  });

  it('ignores the timeline landing on the day already out', () => {
    const open = at(PHASES.open);
    expect(basketStep(open, { type: 'day', basket: 'b1' }, false)).toEqual({ state: open, effects: [] });
  });

  it('puts the basket away mid-opening, and opens it again mid-closing', () => {
    const { state, effects } = run(CLOSED, [{ type: 'rail', basket: 'b1' }, { type: 'rail', basket: 'b1' }, { type: 'rail', basket: 'b1' }, { type: 'done', phase: 'closing' }, { type: 'done', phase: 'opening' }]);
    expect(state.phase).toEqual({ kind: 'open', basket: 'b1' });
    expect(effects.map((e) => e.type)).toEqual(['open', 'visit', 'close', 'open', 'visit']);
  });

  it('sends a flower picked while the fan is still rising or swapping', () => {
    for (const kind of ['opening', 'swapping'] as const) expect(basketStep(at(PHASES[kind]), { type: 'pick', find: 'f2', touch: false }, false).state.phase).toEqual({ kind: 'sending', basket: 'b1', find: 'f2' });
  });

  it('lands a flower at once when the post opens on its way, and raises no card', () => {
    const { state, effects } = run(at(PHASES.sending), [{ type: 'sheet' }, { type: 'done', phase: 'sending' }]);
    expect(state).toEqual({ phase: { kind: 'closed' }, preview: null, picked: { find: 'f1' } });
    expect(effects).toEqual(lit({ find: 'f1' }));
  });

  it('stops the camera each time you take it during a send, and still lands', () => {
    const { state, effects } = run(at(PHASES.sendingAll), [{ type: 'camera' }, { type: 'camera' }, { type: 'done', phase: 'sendingAll' }]);
    expect(state.phase.kind).toBe('closed');
    expect(effects).toEqual([{ type: 'cancelFlight' }, { type: 'cancelFlight' }, { type: 'highlight', picked: { basket: 'b1' } }]);
  });

  it('drops the preview whenever the basket leaves the screen', () => {
    const hovered = at(PHASES.open, { preview: { kind: 'find', id: 'f1' } });
    for (const e of [{ type: 'dismiss' }, { type: 'pick', find: 'f1', touch: false }, { type: 'day', basket: 'b2' }] as const) expect(basketStep(hovered, e, false).state.preview).toBeNull();
  });
});

describe('with reduced motion', () => {
  it('opens, swaps and closes at once, with nothing to watch', () => {
    const { state, effects } = run(CLOSED, [{ type: 'rail', basket: 'b1' }, { type: 'day', basket: 'b2' }, { type: 'dismiss' }], true);
    expect(state.phase).toEqual({ kind: 'closed' });
    expect(effects).toEqual([
      { type: 'open', basket: 'b1', animate: false },
      { type: 'visit', basket: 'b1' },
      { type: 'swap', basket: 'b2', animate: false },
      { type: 'visit', basket: 'b2' },
      { type: 'close', animate: false },
    ]);
  });

  it('still waits for the camera before the card rises', () => {
    const sent = run(CLOSED, [{ type: 'rail', basket: 'b1' }, { type: 'pick', find: 'f1', touch: false }], true);
    expect(sent.state.phase).toEqual({ kind: 'sending', basket: 'b1', find: 'f1' });
    expect(sent.effects).toContainEqual({ type: 'send', find: 'f1', animate: false });
    expect(sent.effects).not.toContainEqual({ type: 'card', find: 'f1' });
    expect(basketStep(sent.state, { type: 'done', phase: 'sending' }, true).effects).toContainEqual({ type: 'card', find: 'f1' });
  });

  it('never enters an opening, a swap or a closing, whatever happens', () => {
    const names = Object.keys(EVENTS) as Name[];
    let state = CLOSED;
    for (let k = 0; k < 2000; k++) {
      const name = names[Math.floor(Math.abs(Math.sin(k * 78.233)) * names.length) % names.length];
      state = basketStep(state, name === 'done' ? { type: 'done', phase: 'sending' } : EVENTS[name], true).state;
      expect(['opening', 'swapping', 'closing']).not.toContain(state.phase.kind);
    }
  });
});
