// The basket's phases, as one pure step: a state and an event in, the next
// state and the effects to carry out back. gardenUi carries the effects out
// (the basket's stage, camera flights, the finds' patches, the card) and tells
// the machine when an act has played out (`done`). One table, a row per
// phase: an event a phase has no entry for leaves everything as it was.

/** What the pointer can be over while the basket is out: one of its flowers, or the basket itself. */
export type Target = { readonly kind: 'find'; readonly id: string } | { readonly kind: 'basket' };

/** What was sent home last, and stays lit until the next pick or basket. */
export type Picked = { readonly find: string } | { readonly basket: string };

export type Phase =
  | { readonly kind: 'closed' }
  /** The basket grows out of the rail's icon, flies to the middle, and its flowers rise into the fan. */
  | { readonly kind: 'opening'; readonly basket: string }
  /** The flowers bob over the basket. */
  | { readonly kind: 'open'; readonly basket: string }
  /** Another day picked: the flowers out vanish with a sparkle and this basket's fly out. */
  | { readonly kind: 'swapping'; readonly basket: string }
  /** The flowers drop into the basket and it goes back into the rail. */
  | { readonly kind: 'closing'; readonly basket: string }
  /** One flower is on its way home as the camera flies to it; the rest went back in the basket. */
  | { readonly kind: 'sending'; readonly basket: string; readonly find: string }
  /** Every flower goes home as the camera frames them all. */
  | { readonly kind: 'sendingAll'; readonly basket: string };

export type Kind = Phase['kind'];
/** The phases an act plays out in, and so can be `done`. */
export type Act = Exclude<Kind, 'closed' | 'open'>;

export interface BasketState {
  readonly phase: Phase;
  /** Under the pointer, or tapped once on a touch screen: its preview shows. */
  readonly preview: Target | null;
  readonly picked: Picked | null;
}

export type BasketEvent =
  /** The rail's basket: opens `basket` (the freshest not seen, else the newest) or puts the basket away. */
  | { readonly type: 'rail'; readonly basket: string }
  /** Open on this day's basket (a toast's "Go and see"). */
  | { readonly type: 'show'; readonly basket: string }
  | { readonly type: 'hover'; readonly target: Target | null }
  /** A flower clicked or tapped (a first tap on a touch screen only previews). */
  | { readonly type: 'pick'; readonly find: string; readonly touch: boolean }
  /** The basket clicked or tapped: send them all. */
  | { readonly type: 'pickBasket'; readonly touch: boolean }
  /** The timeline moved to another day's basket (again while swapping: it retargets). */
  | { readonly type: 'day'; readonly basket: string }
  /** Esc, or a click outside the basket. */
  | { readonly type: 'dismiss' }
  /** The post or Muse's page opening. */
  | { readonly type: 'sheet' }
  /** You took the camera (a drag, the wheel, a key). */
  | { readonly type: 'camera' }
  /** The act of this phase played out. */
  | { readonly type: 'done'; readonly phase: Act };

export type Effect =
  /** Bring the basket out to the middle with this basket's flowers in a fan (`animate`: as the phases describe; else at once). */
  | { readonly type: 'open'; readonly basket: string; readonly animate: boolean }
  /** Swap the fan for this basket's flowers. */
  | { readonly type: 'swap'; readonly basket: string; readonly animate: boolean }
  /** Drop the flowers in and put the basket back in the rail. */
  | { readonly type: 'close'; readonly animate: boolean }
  /** The others drop in and the basket goes home; this flower comes down into its patch as the camera arrives. */
  | { readonly type: 'send'; readonly find: string; readonly animate: boolean }
  /** The flowers drop in, the basket waits smaller in the middle, and they leave one by one as the camera nears; then it goes home. */
  | { readonly type: 'sendAll'; readonly basket: string; readonly animate: boolean }
  /** Fly the camera to a find (FIND_VIEW), or to frame a basket's finds (framingToFit). */
  | { readonly type: 'fly'; readonly to: Picked }
  /** Stop the camera where it is: the flowers land where their patches are on screen now. */
  | { readonly type: 'cancelFlight' }
  /** Land whatever is in the air now and put the basket away. */
  | { readonly type: 'settle' }
  /** Light what came home, and stop lighting what came before. */
  | { readonly type: 'highlight'; readonly picked: Picked }
  /** Raise this find's card. */
  | { readonly type: 'card'; readonly find: string }
  /** This basket has been seen (the rail's dot, the timeline's rings). */
  | { readonly type: 'visit'; readonly basket: string };

export interface Step {
  readonly state: BasketState;
  readonly effects: readonly Effect[];
}

export const CLOSED: BasketState = { phase: { kind: 'closed' }, preview: null, picked: null };

/** While these play, a scrim over the planet takes the pointer: a drag never moves the camera under the basket. */
export function holdsPointer(phase: Phase): boolean {
  return phase.kind === 'opening' || phase.kind === 'open' || phase.kind === 'swapping';
}

type PhaseOf<K extends Kind> = Extract<Phase, { kind: K }>;
type EventOf<T extends BasketEvent['type']> = Extract<BasketEvent, { type: T }>;
type Row<P extends Phase> = { readonly [T in BasketEvent['type']]?: (phase: P, event: EventOf<T>, state: BasketState, reduced: boolean) => Step };

const go = (state: BasketState, phase: Phase, effects: readonly Effect[] = [], picked = state.picked): Step => ({ state: { phase, preview: null, picked }, effects });

const opening = (s: BasketState, basket: string, reduced: boolean): Step =>
  go(s, reduced ? { kind: 'open', basket } : { kind: 'opening', basket }, [{ type: 'open', basket, animate: !reduced }, { type: 'visit', basket }]);

const closing = (s: BasketState, basket: string, reduced: boolean): Step => go(s, reduced ? { kind: 'closed' } : { kind: 'closing', basket }, [{ type: 'close', animate: !reduced }]);

const swapping = (s: BasketState, from: string, basket: string, reduced: boolean): Step =>
  basket === from ? { state: s, effects: [] } : go(s, reduced ? { kind: 'open', basket } : { kind: 'swapping', basket }, [{ type: 'swap', basket, animate: !reduced }, { type: 'visit', basket }]);

const previewing = (s: BasketState, target: Target | null): Step => ({ state: { ...s, preview: target }, effects: [] });

const previewed = (s: BasketState, target: Target): boolean =>
  s.preview !== null && s.preview.kind === target.kind && (target.kind === 'basket' || (s.preview.kind === 'find' && s.preview.id === target.id));

/** A send is interrupted (the rail, a toast, a sheet): what is in the air lands at once and stays lit. */
const landNow = (picked: Picked): Effect[] => [{ type: 'settle' }, { type: 'highlight', picked }];

/** Out of the basket: opening, open or swapping. Its flowers can be previewed and picked, and the basket put away. */
const OUT: Row<PhaseOf<'opening' | 'open' | 'swapping'>> = {
  rail: (p, _e, s, r) => closing(s, p.basket, r),
  dismiss: (p, _e, s, r) => closing(s, p.basket, r),
  sheet: (p, _e, s, r) => closing(s, p.basket, r),
  hover: (_p, e, s) => previewing(s, e.target),
  pick: (p, e, s, r) => {
    const target: Target = { kind: 'find', id: e.find };
    if (e.touch && !previewed(s, target)) return previewing(s, target);
    return go(s, { kind: 'sending', basket: p.basket, find: e.find }, [
      { type: 'send', find: e.find, animate: !r },
      { type: 'fly', to: { find: e.find } },
    ]);
  },
  pickBasket: (p, e, s, r) => {
    if (e.touch && !previewed(s, { kind: 'basket' })) return previewing(s, { kind: 'basket' });
    return go(s, { kind: 'sendingAll', basket: p.basket }, [
      { type: 'sendAll', basket: p.basket, animate: !r },
      { type: 'fly', to: { basket: p.basket } },
    ]);
  },
  day: (p, e, s, r) => swapping(s, p.basket, e.basket, r),
  show: (p, e, s, r) => swapping(s, p.basket, e.basket, r),
};

const TABLE: { readonly [K in Kind]: Row<PhaseOf<K>> } = {
  closed: {
    rail: (_p, e, s, r) => opening(s, e.basket, r),
    show: (_p, e, s, r) => opening(s, e.basket, r),
  },
  opening: { ...OUT, done: (p, _e, s) => go(s, { kind: 'open', basket: p.basket }) },
  open: OUT,
  swapping: { ...OUT, done: (p, _e, s) => go(s, { kind: 'open', basket: p.basket }) },
  closing: {
    rail: (_p, e, s, r) => opening(s, e.basket, r),
    show: (_p, e, s, r) => opening(s, e.basket, r),
    done: (_p, _e, s) => go(s, { kind: 'closed' }),
  },
  sending: {
    camera: (_p, _e, s) => ({ state: s, effects: [{ type: 'cancelFlight' }] }),
    done: (p, _e, s) => go(s, { kind: 'closed' }, [{ type: 'highlight', picked: { find: p.find } }, { type: 'card', find: p.find }], { find: p.find }),
    rail: (p, e, s, r) => after(opening(s, e.basket, r), landNow({ find: p.find }), { find: p.find }),
    show: (p, e, s, r) => after(opening(s, e.basket, r), landNow({ find: p.find }), { find: p.find }),
    sheet: (p, _e, s) => go(s, { kind: 'closed' }, landNow({ find: p.find }), { find: p.find }),
  },
  sendingAll: {
    camera: (_p, _e, s) => ({ state: s, effects: [{ type: 'cancelFlight' }] }),
    done: (p, _e, s) => go(s, { kind: 'closed' }, [{ type: 'highlight', picked: { basket: p.basket } }], { basket: p.basket }),
    rail: (p, e, s, r) => after(opening(s, e.basket, r), landNow({ basket: p.basket }), { basket: p.basket }),
    show: (p, e, s, r) => after(opening(s, e.basket, r), landNow({ basket: p.basket }), { basket: p.basket }),
    sheet: (p, _e, s) => go(s, { kind: 'closed' }, landNow({ basket: p.basket }), { basket: p.basket }),
  },
};

/** A step that first carries out `first`, and keeps `picked` lit. */
function after(step: Step, first: readonly Effect[], picked: Picked): Step {
  return { state: { ...step.state, picked }, effects: [...first, ...step.effects] };
}

/** The basket's next state and the effects to carry out. `reduced`: reduced motion asked for (no opening, swapping or closing to watch). */
export function basketStep(state: BasketState, event: BasketEvent, reduced: boolean): Step {
  const phase = state.phase;
  // an act that ended after its phase was left behind (a stale `done`) changes nothing
  if (event.type === 'done' && event.phase !== phase.kind) return { state, effects: [] };
  const row = TABLE[phase.kind] as Row<Phase>;
  const handle = row[event.type] as ((p: Phase, e: BasketEvent, s: BasketState, r: boolean) => Step) | undefined;
  return handle ? handle(phase, event, state, reduced) : { state, effects: [] };
}
