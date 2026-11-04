import { ACTION, ACTIONS, FACES, LOOKS, MAX_ACTORS, PLAIN_FACES, type ActionId } from './library';
import type { Actor, Beat, DirectorScene, Facing, Gaze, Piece } from './scene';
import type { Block, Take } from './timeline';

// The director's panel (director.ts): the take's controls (play, pause, from the start, over and over, the time),
// who is on the planet (each in its look, shown or not, and a Muse to add), the picked Muse's beats in order (each a
// card: what it does, where, for how long, from what cue; picked, all of it to set), the set pieces, and the scene to
// export, import or start again; and along the bottom, the timeline: each Muse's beats as blocks in time, the playhead
// to drag. It only shows the scene and says what was asked: director.ts changes the scene and calls render again.

/** What the panel asks of the director. */
export interface PanelActions {
  play(): void;
  pause(): void;
  restart(): void;
  seek(t: number, done: boolean): void;
  setLoop(on: boolean): void;
  hide(): void;
  addActor(look: string): void;
  selectActor(id: string): void;
  setActor(id: string, patch: Partial<Pick<Actor, 'name' | 'look' | 'shown'>>): void;
  removeActor(id: string): void;
  placeStart(id: string): void;
  addBeat(actor: string, action: ActionId): void;
  selectBeat(id: string | null): void;
  setBeat(id: string, patch: Partial<Beat>): void;
  placeBeat(id: string): void;
  moveBeat(id: string, by: -1 | 1): void;
  duplicateBeat(id: string): void;
  removeBeat(id: string): void;
  addPiece(kind: Piece['kind']): void;
  selectPiece(id: string): void;
  removePiece(id: string): void;
  exportScene(): void;
  importScene(file: File): void;
  newScene(): void;
  cancelPlacing(): void;
}

export interface PanelState {
  readonly scene: DirectorScene;
  readonly take: Take | null;
  readonly actor: string | null;
  readonly beat: string | null;
  readonly piece: string | null;
  /** What the world's Muses can do here, and the faces its rig can show. */
  readonly abilities: { readonly moves: boolean; readonly props: boolean; readonly plainFaces: boolean; readonly pieces: boolean };
  readonly planet: string;
  /** Asking for a click on the planet (what for), if it is. */
  readonly placing: string | null;
  readonly playing: boolean;
  /** The Muses whose bodies are still being made. */
  readonly loading: ReadonlySet<string>;
}

type Child = Node | string | null | undefined | false;
/** An element's attributes, properties (true, false) and listeners (on…). */
type Prop = string | number | boolean | null | undefined | ((e: Event) => void);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Readonly<Record<string, Prop>> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = String(v);
    else if (typeof v === 'boolean' && k in e) (e as unknown as Record<string, boolean>)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

function select(value: string, options: readonly (readonly [string, string] | { readonly group: string; readonly options: readonly (readonly [string, string, boolean?])[] })[], onChange: (v: string) => void, cls = ''): HTMLSelectElement {
  const s = h('select', { class: cls });
  for (const o of options) {
    if ('group' in o) {
      const g = h('optgroup', { label: o.group });
      for (const [v, label, disabled] of o.options) g.append(h('option', { value: v, disabled: disabled === true }, label));
      s.append(g);
    } else s.append(h('option', { value: o[0] }, o[1]));
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

const fmt = (t: number): string => `${t.toFixed(1)} s`;

export class Panel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly tracks: HTMLElement;
  private readonly head: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly loop: HTMLInputElement;
  private readonly note: HTMLElement;
  private state: PanelState | null = null;
  /** The timeline's span (s), and where its tracks are (px), for the playhead and scrubbing. */
  private span = 20;
  private scrubbing = false;
  private shown = true;

  constructor(
    parent: HTMLElement,
    private readonly actions: PanelActions,
  ) {
    this.playButton = h('button', { class: 'd-play', title: 'Play or pause (Space)', onclick: () => (this.state?.playing ? actions.pause() : actions.play()) }, '▶');
    this.loop = h('input', { type: 'checkbox', onchange: () => actions.setLoop(this.loop.checked) });
    this.clock = h('span', { class: 'd-clock' }, '0.0 s');
    this.note = h('p', { class: 'd-note' });
    this.body = h('div', { class: 'd-body' });
    this.root = h(
      'section',
      { class: 'director-panel', 'aria-label': 'Director' },
      h(
        'header',
        { class: 'd-head' },
        h('h2', {}, 'Director'),
        h('button', { class: 'd-hide', title: 'Hide everything for the shot (H); H again brings it back', onclick: () => actions.hide() }, 'Hide · H'),
      ),
      this.note,
      this.body,
    );
    this.tracks = h('div', { class: 'd-tracks' });
    this.head = h('div', { class: 'd-playhead' });
    const ruler = h('div', { class: 'd-ruler' });
    this.timeline = h(
      'section',
      { class: 'director-timeline', 'aria-label': 'Timeline' },
      h(
        'div',
        { class: 'd-transport' },
        h('button', { class: 'd-restart', title: 'From the start (Home)', onclick: () => actions.restart() }, '⏮'),
        this.playButton,
        this.clock,
        h('label', { class: 'd-loop', title: 'Play the take over and over' }, this.loop, ' loop'),
      ),
      h('div', { class: 'd-lanes' }, ruler, this.tracks, this.head),
    );
    const lanes = this.timeline.querySelector('.d-lanes') as HTMLElement;
    lanes.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.d-block')) return;
      this.scrubbing = true;
      lanes.setPointerCapture(e.pointerId);
      this.scrubTo(e, lanes, false);
    });
    lanes.addEventListener('pointermove', (e) => this.scrubbing && this.scrubTo(e, lanes, false));
    lanes.addEventListener('pointerup', (e) => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      this.scrubTo(e, lanes, true);
    });
    parent.append(this.root, this.timeline);
  }

  set visible(on: boolean) {
    this.shown = on;
    this.root.style.display = on ? '' : 'none';
    this.timeline.style.display = on ? '' : 'none';
  }

  get visible(): boolean {
    return this.shown;
  }

  private scrubTo(e: PointerEvent, lanes: HTMLElement, done: boolean): void {
    const r = this.tracks.getBoundingClientRect();
    const t = Math.max(0, ((e.clientX - r.left) / Math.max(r.width, 1)) * this.span);
    void lanes;
    this.actions.seek(t, done);
  }

  /** Each frame: the time, the playhead, play or pause. */
  tick(t: number, playing: boolean): void {
    this.clock.textContent = `${fmt(t)} / ${fmt(this.state?.take?.length ?? 0)}`;
    this.playButton.textContent = playing ? '❚❚' : '▶';
    this.playButton.classList.toggle('is-on', playing);
    const r = this.tracks.getBoundingClientRect();
    const lanes = this.head.parentElement?.getBoundingClientRect();
    if (lanes) this.head.style.left = `${r.left - lanes.left + (Math.min(t, this.span) / this.span) * r.width}px`;
  }

  /** Show the scene as it now is. */
  render(state: PanelState): void {
    this.state = state;
    this.loop.checked = state.scene.loop;
    this.note.textContent = state.placing ? `${state.placing} · Esc to stop` : '';
    this.note.classList.toggle('is-on', !!state.placing);
    this.body.replaceChildren(this.castSection(state), this.beatsSection(state), this.piecesSection(state), this.sceneSection());
    this.renderTimeline(state);
  }

  // ---- the cast ---------------------------------------------------------------------------------------

  private castSection(s: PanelState): HTMLElement {
    const a = this.actions;
    const rows = s.scene.actors.map((actor) =>
      h(
        'li',
        { class: `d-actor${actor.id === s.actor ? ' is-picked' : ''}${actor.shown ? '' : ' is-hidden'}`, onclick: () => a.selectActor(actor.id) },
        h('span', { class: `d-swatch${s.loading.has(actor.id) ? ' is-loading' : ''}`, style: `background:${actor.colour}`, title: s.loading.has(actor.id) ? 'Its body is still being made…' : '' }),
        h('input', {
          class: 'd-name',
          value: actor.name,
          title: 'Its name on the planet',
          onchange: (e: Event) => a.setActor(actor.id, { name: (e.target as HTMLInputElement).value.trim() || actor.name }),
          onclick: (e: Event) => e.stopPropagation(),
        }),
        select(
          actor.look,
          LOOKS.map((l) => [l.look, `${l.name} (${l.look})`] as const),
          (v) => a.setActor(actor.id, { look: v as Actor['look'] }),
          'd-look',
        ),
        h('button', { class: 'd-icon', title: actor.shown ? 'Hide it' : 'Show it', onclick: (e: Event) => (e.stopPropagation(), a.setActor(actor.id, { shown: !actor.shown })) }, actor.shown ? '◉' : '○'),
        h('button', { class: 'd-icon', title: 'Place where it starts (click the planet)', onclick: (e: Event) => (e.stopPropagation(), a.placeStart(actor.id)) }, '⌖'),
        actor.host ? h('span', { class: 'd-icon d-host', title: "The planet's own Muse" }, '⌂') : h('button', { class: 'd-icon', title: 'Take it off the planet', onclick: (e: Event) => (e.stopPropagation(), a.removeActor(actor.id)) }, '×'),
      ),
    );
    const full = s.scene.actors.length >= MAX_ACTORS;
    const adder = select(
      '',
      [['', full ? `A shot holds ${MAX_ACTORS} Muses` : '+ Add a Muse…'] as const, ...LOOKS.map((l) => [l.look, `${l.name} (${l.look})`] as const)],
      (v) => v && a.addActor(v),
      'd-add',
    );
    adder.disabled = full;
    return h('section', { class: 'd-section' }, h('h3', {}, 'Muses'), h('ul', { class: 'd-actors' }, ...rows), adder);
  }

  // ---- the picked Muse's beats -----------------------------------------------------------------------

  private actionOptions(s: PanelState): { group: string; options: [string, string, boolean][] }[] {
    const groups = new Map<string, [string, string, boolean][]>();
    for (const def of ACTIONS) {
      const can = def.needs === null || (def.needs === 'moves' && s.abilities.moves) || (def.needs === 'props' && s.abilities.props);
      const list = groups.get(def.group) ?? [];
      list.push([def.id, can ? def.label : `${def.label} (not on this planet)`, !can]);
      groups.set(def.group, list);
    }
    return [...groups].map(([group, options]) => ({ group, options }));
  }

  private beatsSection(s: PanelState): HTMLElement {
    const a = this.actions;
    const actor = s.scene.actors.find((x) => x.id === s.actor);
    if (!actor) return h('section', { class: 'd-section' }, h('h3', {}, 'Beats'), h('p', { class: 'd-empty' }, 'Pick a Muse to direct it.'));
    const take = s.take?.actors.get(actor.id);
    const cards = actor.beats.map((b, i) => {
      const def = ACTION[b.action];
      const t = take?.beats.get(b.id);
      const problem = take?.problems.get(b.id);
      const blocked = take?.routes.some((r) => r.beat === b.id && r.blocked);
      const picked = b.id === s.beat;
      const amount = def.unit === 'times' ? `×${b.amount}` : `${b.amount} s`;
      const card = h(
        'li',
        { class: `d-beat${picked ? ' is-picked' : ''}`, onclick: () => a.selectBeat(picked ? null : b.id) },
        h(
          'div',
          { class: 'd-beat-line' },
          h('span', { class: 'd-num', style: `background:${actor.colour}` }, String(i + 1)),
          h('b', {}, def.label),
          h('span', { class: 'd-amount' }, amount),
          h('span', { class: 'd-when' }, t ? `${fmt(t.starts)}–${fmt(t.ends)}` : ''),
        ),
        problem ? h('p', { class: 'd-warn' }, problem) : null,
        blocked ? h('p', { class: 'd-warn' }, 'Its way is blocked (red on the planet): its mark is in the water or a wall, or there is no way round. Move its mark.') : null,
      );
      if (picked) card.append(this.inspector(s, actor, b));
      return card;
    });
    const adder = select('', [['', '+ Add a beat…'] as const, ...this.actionOptions(s)], (v) => v && a.addBeat(actor.id, v as ActionId), 'd-add');
    return h('section', { class: 'd-section' }, h('h3', {}, `${actor.name}'s beats`), h('ol', { class: 'd-beats' }, ...cards), adder);
  }

  private inspector(s: PanelState, actor: Actor, b: Beat): HTMLElement {
    const a = this.actions;
    const def = ACTION[b.action];
    const others = s.scene.actors.filter((x) => x.id !== actor.id);
    const set = (patch: Partial<Beat>): void => a.setBeat(b.id, patch);
    const row = (label: string, ...control: Child[]): HTMLElement => h('label', { class: 'd-row' }, h('span', {}, label), ...control);
    const stop = (e: Event): void => e.stopPropagation();
    // what
    const action = select(b.action, this.actionOptions(s), (v) => set({ action: v as ActionId, amount: ACTION[v as ActionId].amount }));
    // where
    const pieces = s.scene.pieces.filter((p) => p.kind === def.piece);
    const where = def.piece
      ? select(
          b.piece ?? '',
          [['', pieces.length ? `Pick a ${def.piece}…` : `Place a ${def.piece} first (Set pieces)`] as const, ...pieces.map((p, i) => [p.id, `${def.piece === 'bench' ? 'Bench' : 'Stove'} ${i + 1}`] as const)],
          (v) => set({ piece: v || null }),
        )
      : h(
          'span',
          { class: 'd-where' },
          h('button', { onclick: () => a.placeBeat(b.id), title: 'Click the planet where it goes' }, b.mark ? 'Move its mark' : 'Give it a mark'),
          b.mark ? h('button', { onclick: () => set({ mark: null }), title: 'Do it where the last beat left it' }, 'Where it is') : h('span', { class: 'd-dim' }, 'where it is'),
        );
    // which way
    const facingValue = b.facing.kind === 'actor' ? `actor:${b.facing.actor}` : b.facing.kind;
    const facing = def.piece
      ? h('span', { class: 'd-dim' }, `as the ${def.piece} has it`)
      : select(facingValue, [['mark', "Its mark's arrow"] as const, ['camera', 'The camera (as it plays)'] as const, ...others.map((o) => [`actor:${o.id}`, `Toward ${o.name}`] as const)], (v) =>
          set({ facing: (v.startsWith('actor:') ? { kind: 'actor', actor: v.slice(6) } : { kind: v }) as Facing }),
        );
    // how long
    const amount = h('input', {
      type: 'number',
      class: 'd-num-input',
      min: String(def.min),
      max: String(def.max),
      step: def.unit === 'times' ? '1' : '0.5',
      value: String(b.amount),
      onchange: (e: Event) => {
        const n = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(n)) set({ amount: Math.min(def.max, Math.max(def.min, def.unit === 'times' ? Math.round(n) : n)) });
      },
    });
    const unit = h('span', { class: 'd-dim' }, def.unit === 'times' ? `times${def.each ? ` (about ${def.each.toFixed(1)} s each)` : ''}` : 'seconds');
    // from when
    const cueValue = b.cue.kind === 'event' ? `event:${b.cue.actor}:${b.cue.beat}:${b.cue.when}` : b.cue.kind;
    const cueOptions: (readonly [string, string])[] = [['after', 'Right after the last'], ['at', 'Not before a time…']];
    for (const o of others) {
      o.beats.forEach((ob, i) => {
        const label = `${o.name}'s ${i + 1}. ${ACTION[ob.action].label.toLowerCase()}`;
        cueOptions.push([`event:${o.id}:${ob.id}:starts`, `When ${label} sets off`], [`event:${o.id}:${ob.id}:arrives`, `When ${label} begins`], [`event:${o.id}:${ob.id}:ends`, `When ${label} ends`]);
      });
    }
    const cue = select(cueValue, cueOptions, (v) => {
      if (v === 'after') set({ cue: { kind: 'after' } });
      else if (v === 'at') set({ cue: { kind: 'at', time: s.take?.times(b.id)?.starts ?? 0 } });
      else {
        const [, actorId, beatId, when] = v.split(':');
        set({ cue: { kind: 'event', actor: actorId, beat: beatId, when: when as 'starts' | 'arrives' | 'ends' } });
      }
    });
    const at =
      b.cue.kind === 'at'
        ? h('input', {
            type: 'number',
            class: 'd-num-input',
            min: '0',
            step: '0.5',
            value: String(b.cue.time),
            onchange: (e: Event) => {
              const n = Number((e.target as HTMLInputElement).value);
              if (Number.isFinite(n)) set({ cue: { kind: 'at', time: Math.max(0, n) } });
            },
          })
        : null;
    // its face and its look
    const faces = s.abilities.plainFaces ? PLAIN_FACES : Object.keys(FACES);
    const face = select(b.face, faces.map((f) => [f, f] as const), (v) => set({ face: v }));
    const gazeValue = b.gaze.kind === 'actor' ? `actor:${b.gaze.actor}` : b.gaze.kind;
    const gaze = select(gazeValue, [['own', 'Its own way'] as const, ['camera', 'At the camera'] as const, ['ahead', 'Straight ahead'] as const, ...others.map((o) => [`actor:${o.id}`, `At ${o.name}`] as const)], (v) =>
      set({ gaze: (v.startsWith('actor:') ? { kind: 'actor', actor: v.slice(6) } : { kind: v }) as Gaze }),
    );
    return h(
      'div',
      { class: 'd-inspector', onclick: stop },
      row('Does', action),
      def.note ? h('p', { class: 'd-dim d-hint' }, def.note) : null,
      row('Where', where),
      row('Facing', facing),
      row('For', amount, unit),
      row('Starts', cue, at),
      row('Face', face),
      row('Looking', gaze),
      h(
        'div',
        { class: 'd-buttons' },
        h('button', { onclick: () => a.moveBeat(b.id, -1), title: 'Earlier' }, '↑'),
        h('button', { onclick: () => a.moveBeat(b.id, 1), title: 'Later' }, '↓'),
        h('button', { onclick: () => a.duplicateBeat(b.id) }, 'Duplicate'),
        h('button', { class: 'd-danger', onclick: () => a.removeBeat(b.id) }, 'Delete'),
      ),
    );
  }

  // ---- set pieces and the scene --------------------------------------------------------------------------

  private piecesSection(s: PanelState): HTMLElement {
    const a = this.actions;
    let benches = 0;
    let stoves = 0;
    const rows = s.scene.pieces.map((p) => {
      const n = p.kind === 'bench' ? ++benches : ++stoves;
      return h(
        'li',
        { class: `d-piece${p.id === s.piece ? ' is-picked' : ''}`, onclick: () => a.selectPiece(p.id) },
        h('span', {}, `${p.kind === 'bench' ? 'Bench' : 'Stove'} ${n}`),
        h('button', { class: 'd-icon', title: 'Take it away', onclick: (e: Event) => (e.stopPropagation(), a.removePiece(p.id)) }, '×'),
      );
    });
    return h(
      'section',
      { class: 'd-section' },
      h('h3', {}, 'Set pieces'),
      h('ul', { class: 'd-pieces' }, ...rows),
      h('div', { class: 'd-buttons' }, h('button', { onclick: () => a.addPiece('bench'), disabled: !s.abilities.pieces || !s.abilities.moves }, '+ Bench'), h('button', { onclick: () => a.addPiece('stove'), disabled: !s.abilities.pieces || !s.abilities.props }, '+ Stove')),
      s.abilities.pieces && s.abilities.moves ? null : h('p', { class: 'd-dim' }, 'This planet’s Muse can’t sit on a bench or cook.'),
    );
  }

  private sceneSection(): HTMLElement {
    const a = this.actions;
    const file = h('input', {
      type: 'file',
      accept: '.json,application/json',
      style: 'display:none',
      onchange: (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) a.importScene(f);
      },
    });
    return h(
      'section',
      { class: 'd-section' },
      h('h3', {}, 'Scene'),
      h('p', { class: 'd-dim' }, 'Kept in this browser as you go.'),
      h(
        'div',
        { class: 'd-buttons' },
        h('button', { onclick: () => a.exportScene() }, 'Export'),
        h('button', { onclick: () => file.click() }, 'Import'),
        h('button', { class: 'd-danger', onclick: () => a.newScene() }, 'New scene'),
        file,
      ),
      h('p', { class: 'd-dim d-keys' }, 'Space play · Home start · H hide all · Esc stop placing · drag the playhead to scrub'),
    );
  }

  // ---- the timeline -----------------------------------------------------------------------------------

  private renderTimeline(s: PanelState): void {
    const take = s.take;
    this.span = Math.max(15, Math.ceil(((take?.length ?? 0) + 4) / 5) * 5);
    const ruler = this.timeline.querySelector('.d-ruler') as HTMLElement;
    const step = this.span > 120 ? 20 : this.span > 60 ? 10 : this.span > 30 ? 5 : 2;
    const ticks: HTMLElement[] = [];
    for (let t = 0; t <= this.span; t += step) ticks.push(h('span', { class: 'd-tick', style: `left:${(t / this.span) * 100}%` }, `${t}`));
    ruler.replaceChildren(...ticks);
    const lanes = s.scene.actors.map((actor) => {
      const blocks: Block[] = take?.blocks(actor.id) ?? [];
      const lane = h('div', { class: `d-lane${actor.id === s.actor ? ' is-picked' : ''}`, style: `--c:${actor.colour}` }, h('span', { class: 'd-lane-name' }, actor.name));
      for (const b of blocks) {
        const end = Math.min(b.end, this.span);
        if (b.kind === 'rest' || end <= b.start) continue;
        const beat = b.beat ? actor.beats.findIndex((x) => x.id === b.beat) : -1;
        const el = h(
          'div',
          {
            class: `d-block is-${b.kind}${b.beat && b.beat === s.beat ? ' is-picked' : ''}`,
            style: `left:${(b.start / this.span) * 100}%;width:${((end - b.start) / this.span) * 100}%`,
            title: `${beat >= 0 ? `${beat + 1}. ` : ''}${b.label} · ${fmt(b.start)}–${fmt(b.end)}`,
            onpointerdown: (e: Event) => e.stopPropagation(),
            onclick: () => {
              this.actions.selectActor(actor.id);
              if (b.beat) this.actions.selectBeat(b.beat);
            },
          },
          b.kind === 'do' ? b.label : '',
        );
        lane.append(el);
      }
      return lane;
    });
    this.tracks.replaceChildren(...lanes);
  }

  dispose(): void {
    this.root.remove();
    this.timeline.remove();
  }
}
