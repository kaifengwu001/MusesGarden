import type { Residents } from '../life/residents';

export type HamletSeason = 'snow' | 'rain';
export type HamletPlace = 'home' | 'bridge' | 'planet' | 'muse';

export interface HamletUiOptions {
  readonly residents: Residents;
  getSeason(): HamletSeason;
  setSeason(season: HamletSeason): void;
  navigate(place: HamletPlace): void;
  follow(id: string | null): void;
  getFollowing(): string | null;
  getTime(): number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A small edge toolbar; the landscape stays open until a neighbour is selected. */
export class HamletUi {
  private readonly root = el('section', 'hamlet-ui');
  private readonly detail = el('section', 'hamlet-detail');
  private readonly title = el('h2', 'hamlet-resident-title');
  private readonly activity = el('p', 'hamlet-activity');
  private readonly name = el('input', 'hamlet-name');
  private readonly follow = el('button', 'hamlet-button', 'Follow');
  private readonly notice = el('p', 'hamlet-notice');
  private readonly residents = new Map<string, HTMLButtonElement>();
  private readonly seasons = new Map<HamletSeason, HTMLButtonElement>();
  private readonly events = new AbortController();
  private selected: string | null = null;

  constructor(parent: HTMLElement, private readonly options: HamletUiOptions) {
    this.root.setAttribute('aria-label', 'Hamlet controls');
    const seasons = el('div', 'hamlet-seasons');
    seasons.setAttribute('role', 'group');
    seasons.setAttribute('aria-label', 'Weather');
    for (const [season, label] of [['snow', 'Snow'], ['rain', 'Rain']] as const) {
      const button = this.button(label, () => options.setSeason(season));
      button.setAttribute('aria-pressed', String(options.getSeason() === season));
      this.seasons.set(season, button);
      seasons.append(button);
    }
    const places = el('nav', 'hamlet-places');
    places.setAttribute('aria-label', 'Hamlet views');
    for (const [place, label] of [['home', 'Home'], ['bridge', 'Bridge'], ['planet', 'Whole planet'], ['muse', 'Muse']] as const) {
      places.append(this.button(label, () => options.navigate(place)));
    }
    const neighbours = el('div', 'hamlet-neighbours');
    neighbours.setAttribute('role', 'group');
    neighbours.setAttribute('aria-label', 'Local neighbours');
    for (const resident of options.residents.members) {
      const button = this.button(resident.name, () => {
        this.select(resident.id);
        options.follow(resident.id);
      });
      button.classList.add('hamlet-neighbour');
      button.style.setProperty('--coat', resident.coat);
      button.dataset.resident = resident.id;
      button.setAttribute('aria-label', `Meet ${resident.name}`);
      button.setAttribute('aria-pressed', 'false');
      this.residents.set(resident.id, button);
      neighbours.append(button);
    }
    const bar = el('div', 'hamlet-toolbar');
    bar.append(seasons, places, neighbours);
    this.detail.hidden = true;
    this.detail.setAttribute('aria-label', 'Neighbour details');
    const heading = el('div', 'hamlet-detail-heading');
    const close = this.button('×', () => {
      this.selected = null;
      this.detail.hidden = true;
      options.follow(null);
      this.update();
    });
    close.classList.add('hamlet-close');
    close.setAttribute('aria-label', 'Close neighbour details');
    heading.append(this.title, close);
    const form = el('form', 'hamlet-name-form');
    const label = el('label', 'hamlet-name-label', 'Name');
    this.name.type = 'text';
    this.name.maxLength = 48; // the persistence validator limits Unicode characters, not UTF-16 code units
    this.name.setAttribute('aria-label', 'Neighbour name');
    this.name.autocomplete = 'off';
    label.append(this.name);
    const save = el('button', 'hamlet-button', 'Save');
    save.type = 'submit';
    form.append(label, save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      this.saveName();
    }, { signal: this.events.signal });
    this.name.addEventListener('change', () => this.saveName(), { signal: this.events.signal });
    const actions = el('div', 'hamlet-actions');
    const greet = this.button('Say hello', () => {
      if (!this.selected) return;
      options.residents.greet(this.selected, options.getTime());
      this.notice.textContent = `${this.title.textContent ?? 'Your neighbour'} waves hello.`;
    });
    this.follow.type = 'button';
    this.follow.addEventListener('click', () => {
      if (this.selected) options.follow(options.getFollowing() === this.selected ? null : this.selected);
    }, { signal: this.events.signal });
    actions.append(greet, this.follow);
    this.notice.setAttribute('role', 'status');
    this.notice.setAttribute('aria-live', 'polite');
    this.detail.append(heading, this.activity, form, actions, this.notice);
    this.root.append(bar, this.detail);
    parent.append(this.root);
    this.update();
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = el('button', 'hamlet-button', label);
    button.type = 'button';
    button.addEventListener('click', action, { signal: this.events.signal });
    return button;
  }

  private saveName(): void {
    if (!this.selected) return;
    const saved = this.options.residents.rename(this.selected, this.name.value);
    if (!saved) return;
    this.title.textContent = saved;
    this.name.value = saved;
    this.notice.textContent = `${saved}’s name is saved on this device.`;
    this.update();
  }

  select(id: string): void {
    const resident = this.options.residents.members.find(member => member.id === id);
    if (!resident) return;
    this.selected = id;
    this.title.textContent = resident.name;
    this.name.value = resident.name;
    this.notice.textContent = '';
    this.detail.hidden = false;
    this.update();
  }

  update(): void {
    for (const [season, button] of this.seasons) button.setAttribute('aria-pressed', String(this.options.getSeason() === season));
    for (const resident of this.options.residents.members) {
      const button = this.residents.get(resident.id)!;
      if (button.textContent !== resident.name) button.textContent = resident.name;
      button.setAttribute('aria-label', `Meet ${resident.name}`);
      button.setAttribute('aria-pressed', String(resident.id === this.selected));
      if (resident.id === this.selected) {
        const text = `${resident.role} · ${resident.activity}`;
        if (this.activity.textContent !== text) this.activity.textContent = text;
        const following = this.options.getFollowing() === resident.id;
        this.follow.textContent = following ? 'Stop following' : 'Follow';
        this.follow.setAttribute('aria-pressed', String(following));
      }
    }
  }

  dispose(): void {
    this.events.abort();
    this.root.remove();
  }
}
