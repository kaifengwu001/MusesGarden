import type { ParamPath, ParamStore } from '../params';

// The compact control bar: Unfold, Bloom, wind, camera (Overview or Wander, and
// the Vista), seed and reset. Every control writes through the param store, so the URL, the panel
// and the bar always agree. Unfold and Bloom animate their value to the far end
// (or back, when already there): Bloom over about 8 s, Unfold over 16 (8 to unveil, 8 to grow).

const PLAY_SECONDS = 8;
/** The unfolding plays slower: it unveils the planet, then grows it (planet/unfold.ts). */
const UNFOLD_SECONDS = 16;

interface Player {
  path: ParamPath;
  button: HTMLButtonElement;
  direction: number;
  playing: boolean;
  label: string;
  seconds: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface ControlBarActions {
  reset(): void;
  reroll(): void;
  /** Move to the vista (the reference framing). */
  vista(): void;
}

export class ControlBar {
  readonly el: HTMLElement;
  private readonly players: Player[] = [];
  private readonly sliders = new Map<ParamPath, HTMLInputElement>();
  private readonly cameraButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly store: ParamStore,
    actions: ControlBarActions,
  ) {
    this.el = el('nav', 'controlbar');
    this.el.setAttribute('aria-label', 'Controls');

    this.el.append(
      // (the unfolding in place of the radius slider: it unveils the planet, then grows it; planet/unfold.ts)
      this.group(this.player('world.unfold', 'Unfold', UNFOLD_SECONDS), this.slider('world.unfold', 0, 1, 0.0001, 'Unfold')),
      this.group(this.player('world.bloom', 'Bloom'), this.slider('world.bloom', 0, 1, 0.001, 'Bloom')),
      this.group(el('span', 'cb-label', 'Wind'), this.slider('wind.strength', 0, 1, 0.01, 'Wind strength'), this.slider('wind.direction', 0, 360, 1, 'Wind direction', 'cb-dir')),
    );
    this.cameraButton = el('button', 'cb-button', 'Wander');
    this.cameraButton.addEventListener('click', () => store.set('view.mode', store.values.view.mode === 'wander' ? 'overview' : 'wander'));
    const vista = el('button', 'cb-button', 'Vista');
    vista.title = 'A view across the lakes, framed like the reference painting';
    vista.addEventListener('click', () => actions.vista());
    const seed = el('button', 'cb-button', 'Seed');
    seed.title = 'Re-roll the world';
    seed.addEventListener('click', () => actions.reroll());
    const reset = el('button', 'cb-button', 'Reset');
    reset.addEventListener('click', () => actions.reset());
    const postcard = el('button', 'cb-button', 'Postcard');
    postcard.title = 'Frame this view as a postcard (Esc to close)';
    postcard.addEventListener('click', () => store.set('ui.postcard', true));
    this.el.append(this.group(this.cameraButton, vista, seed, reset, postcard));
    parent.append(this.el);

    store.subscribe((changed) => {
      for (const [path, input] of this.sliders) if (changed.has(path)) input.value = String(store.get(path));
      if (changed.has('view.mode')) this.cameraButton.textContent = store.values.view.mode === 'wander' ? 'Overview' : 'Wander';
    });
    this.cameraButton.textContent = store.values.view.mode === 'wander' ? 'Overview' : 'Wander';
  }

  /** Advance Unfold / Bloom playback; call once per frame with wall-clock dt. */
  tick(realDt: number): void {
    for (const p of this.players) {
      if (!p.playing) continue;
      const v = (this.store.get(p.path) as number) + (p.direction * realDt) / p.seconds;
      const done = p.direction > 0 ? v >= 1 : v <= 0;
      this.store.set(p.path, Math.min(1, Math.max(0, v)));
      if (done) this.stop(p);
    }
  }

  get playing(): boolean {
    return this.players.some((p) => p.playing);
  }

  private group(...children: HTMLElement[]): HTMLElement {
    const g = el('div', 'cb-group');
    g.append(...children);
    return g;
  }

  private player(path: ParamPath, label: string, seconds = PLAY_SECONDS): HTMLButtonElement {
    const button = el('button', 'cb-button cb-play', label);
    const player: Player = { path, button, direction: 1, playing: false, label, seconds };
    button.addEventListener('click', () => {
      if (player.playing) {
        this.stop(player);
        return;
      }
      const v = this.store.get(path) as number;
      player.direction = v >= 0.999 ? -1 : 1;
      player.playing = true;
      button.classList.add('playing');
      button.textContent = player.direction > 0 ? `${label} ▸` : `${label} ◂`;
    });
    this.players.push(player);
    return button;
  }

  private stop(p: Player): void {
    p.playing = false;
    p.button.classList.remove('playing');
    p.button.textContent = p.label;
  }

  private slider(path: ParamPath, min: number, max: number, step: number, label: string, className = ''): HTMLInputElement {
    const input = el('input', `cb-slider ${className}`.trim());
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.store.get(path));
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      for (const p of this.players) if (p.path === path) this.stop(p);
      this.store.set(path, Number(input.value));
    });
    this.sliders.set(path, input);
    return input;
  }
}
