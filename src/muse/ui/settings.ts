import type { CommandResult, HiddenRef, SharingView } from '../contract';
import type { MuseApi } from './api';
import { button, el } from './dom';

/** What Muse shares, friends and share codes, and when baskets arrive. Every change goes to the server, then re-reads. */
export class Settings {
  readonly el = el('section', 'mu-panel mu-settings');
  private readonly body = el('div', 'mu-panel-body');
  private readonly note = el('p', 'mu-note');

  constructor(
    private readonly api: MuseApi,
    private readonly changed: () => void,
  ) {
    this.el.setAttribute('aria-label', 'Settings');
    const head = el('header', 'mu-panel-head');
    head.append(el('h2', 'mu-panel-title', 'Settings'));
    this.note.setAttribute('role', 'status');
    this.el.append(head, this.body, this.note);
  }

  async refresh(): Promise<void> {
    const s = await this.api.sharing();
    // Rebuilt from the server's answer; keep the focus on the control the owner was using.
    const focused = this.el.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
    this.body.replaceChildren(this.shares(s), this.friends(s), this.basketTime(s));
    if (focused) this.body.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  private async run(action: Promise<CommandResult>, done?: string): Promise<void> {
    const r = await action;
    this.note.textContent = r.ok ? (done ?? '') : r.error;
    this.note.classList.toggle('mu-error', !r.ok);
    this.changed();
  }

  private shares(s: SharingView): HTMLElement {
    const section = group('What Muse shares', 'Friends’ Muses see these. Hide anything you’d rather keep at home.');
    const toggle = (label: string, ref: HiddenRef, hidden: boolean): HTMLElement => {
      const row = el('li', 'mu-row');
      const b = button(hidden ? 'Hidden' : 'Shared', 'mu-switch', () => void this.run(this.api.setHidden(ref, !hidden)));
      b.setAttribute('aria-pressed', String(!hidden));
      b.setAttribute('aria-label', `Share ${label}`);
      row.append(el('span', 'mu-row-label', label), b);
      return row;
    };
    const interests = el('ul', 'mu-rows');
    interests.append(...s.interests.map((i) => toggle(i.label, `topic:${i.topic}`, i.hidden)));
    const finds = el('ul', 'mu-rows');
    finds.append(...s.finds.map((f) => toggle(f.title, `discovery:${f.id}`, f.hidden)));
    section.append(el('h4', 'mu-subhead', 'Interests'), interests, el('h4', 'mu-subhead', 'Finds'), finds);
    return section;
  }

  private friends(s: SharingView): HTMLElement {
    const section = group('Friends', 'Introduce Muse to a friend’s Muse with their share code.');
    const rows = el('ul', 'mu-rows');
    rows.append(
      ...s.friends.map((f) => {
        const row = el('li', 'mu-row');
        const unshare = button('Unshare', 'mu-btn', () => void this.run(this.api.unshare(f.museId), `${f.name} is no longer introduced.`));
        unshare.setAttribute('aria-label', `Unshare ${f.name}`);
        row.append(el('span', 'mu-row-label', f.name), el('span', 'mu-chip', f.origin === 'introduced' ? 'introduced' : f.origin === 'known-on' ? 'known online' : 'met beyond'), unshare);
        return row;
      }),
    );
    if (s.friends.length === 0) rows.append(el('li', 'mu-empty', 'No friends yet.'));

    const code = el('div', 'mu-row');
    const copy = button('Copy', 'mu-btn', () => void navigator.clipboard?.writeText(s.shareCode).then(() => (this.note.textContent = 'Share code copied.')));
    code.append(el('span', 'mu-row-label', 'Your share code'), el('code', 'mu-code', s.shareCode), copy);

    const form = el('form', 'mu-row mu-introduce');
    const input = el('input', 'mu-input');
    input.name = 'code';
    input.placeholder = 'A friend’s code';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Introduce with a code');
    const submit = el('button', 'mu-btn mu-primary', 'Introduce');
    submit.type = 'submit';
    form.append(input, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) void this.run(this.api.introduce(input.value.trim()), 'Introduced.');
    });
    section.append(rows, code, form);
    return section;
  }

  private basketTime(s: SharingView): HTMLElement {
    const section = group('Basket time', 'When Muse delivers a basket, at most one a day.');
    const name = 'mu-basket-time';
    const whenever = radio(name, 'Whenever it’s ready', s.basketTime === null);
    const at = radio(name, 'At', s.basketTime !== null);
    const clock = el('input', 'mu-input mu-time');
    clock.type = 'time';
    clock.value = s.basketTime ?? '09:00';
    clock.setAttribute('aria-label', 'Basket time');
    clock.disabled = s.basketTime === null;
    at.label.append(clock);
    const save = (): void => void this.run(this.api.setBasketTime(at.input.checked ? clock.value || null : null), 'Saved.');
    whenever.input.addEventListener('change', save);
    at.input.addEventListener('change', save);
    clock.addEventListener('change', save);
    section.append(whenever.label, at.label);
    return section;
  }
}

function group(title: string, hint: string): HTMLElement {
  const section = el('section', 'mu-group');
  section.append(el('h3', 'mu-group-title', title), el('p', 'mu-hint', hint));
  return section;
}

function radio(name: string, text: string, checked: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el('label', 'mu-radio');
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.checked = checked;
  label.append(input, ` ${text} `);
  return { label, input };
}
