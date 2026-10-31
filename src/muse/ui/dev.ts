import type { CommandResult, MetricsRow, MindView } from '../contract';
import type { ClockMode, MuseApi } from './api';
import { button, day, el, time } from './dom';

const METRIC_COLUMNS: readonly (readonly [Exclude<keyof MetricsRow, 'day'>, string, (v: number) => string])[] = [
  ['finds', 'finds', String],
  ['newAreas', 'new', String],
  ['revisits', 'revisit', String],
  ['trips', 'trips', String],
  ['photos', 'photos', String],
  ['restHours', 'rest h', (v) => v.toFixed(1)],
  ['socialHours', 'social h', (v) => v.toFixed(1)],
  ['workHours', 'work h', (v) => v.toFixed(1)],
  ['ownerDrivenShare', 'owner %', (v) => String(Math.round(v * 100))],
];

function bar(value: number, className = ''): HTMLElement {
  const b = el('span', `mu-bar ${className}`.trim());
  b.style.setProperty('--v', String(Math.min(1, Math.abs(value))));
  if (value < 0) b.classList.add('neg');
  return b;
}

function section(title: string, open: boolean, ...children: HTMLElement[]): HTMLDetailsElement {
  const d = el('details', 'mu-dev-section');
  d.open = open;
  d.append(el('summary', '', title), ...children);
  return d;
}

/** Dev only: the sim clock, the host simulator (the Muse app's side) and the Mind inspector. */
export class DevTools {
  readonly el = el('aside', 'mu-dev');
  private readonly simTime = el('span', 'mu-mono');
  private readonly modes = new Map<ClockMode, HTMLButtonElement>();
  private readonly note = el('p', 'mu-note');
  private readonly mind = el('div', 'mu-mind');
  private readonly metrics = el('div', 'mu-metrics');
  private readonly soul = el('pre', 'mu-soul');

  constructor(
    private readonly api: MuseApi,
    private readonly changed: () => void,
  ) {
    this.el.setAttribute('aria-label', 'Muse dev tools');
    const head = el('header', 'mu-dev-head');
    head.append(el('h2', 'mu-panel-title', 'Muse, backstage'), el('span', 'mu-hint', 'B hides'));
    this.note.setAttribute('role', 'status');
    this.el.append(
      head,
      section('Clock', true, this.clockControls()),
      section('Host simulator', true, this.hostControls()),
      this.note,
      section('Mind', true, this.mind),
      section('Metrics', false, this.metrics),
      section('SOUL.md', false, this.soul),
    );
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    if (!this.el.hidden) void this.refresh();
  }

  async refresh(): Promise<void> {
    const [clock, mind, metrics, soul] = await Promise.all([this.api.clock(), this.api.mind(), this.api.metrics(), this.api.soulMd()]);
    this.simTime.textContent = `${day(clock.now)}, ${time(clock.now)}`;
    for (const [mode, b] of this.modes) b.setAttribute('aria-pressed', String(mode === clock.mode));
    this.renderMind(mind);
    this.renderMetrics(metrics);
    this.soul.textContent = soul;
  }

  private async run(action: Promise<CommandResult>, done: string): Promise<void> {
    const r = await action;
    this.note.textContent = r.ok ? done : r.error;
    this.note.classList.toggle('mu-error', !r.ok);
    this.changed();
  }

  private clockControls(): HTMLElement {
    const box = el('div', 'mu-dev-box');
    const now = el('p', 'mu-dev-line');
    now.append('Sim time ', this.simTime);
    const modes = el('div', 'mu-actions');
    for (const [mode, label] of [
      ['live', 'Live'],
      ['fast-forward', 'Fast-forward'],
    ] as const) {
      const b = button(label, 'mu-btn mu-seg', () => void this.run(this.api.setClock(mode), `Clock: ${label.toLowerCase()}.`));
      b.setAttribute('aria-pressed', 'false');
      this.modes.set(mode, b);
      modes.append(b);
    }
    const form = el('form', 'mu-actions');
    const hours = el('input', 'mu-input mu-hours');
    hours.type = 'number';
    hours.min = '0.25';
    hours.step = '0.25';
    hours.value = '6';
    hours.setAttribute('aria-label', 'Hours to advance');
    const go = el('button', 'mu-btn mu-primary', 'Advance');
    go.type = 'submit';
    form.append(hours, el('span', 'mu-hint', 'hours'), go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const h = Number(hours.value);
      void this.run(this.api.advance(h), `Advanced ${h} h.`);
    });
    box.append(now, modes, form);
    return box;
  }

  private hostControls(): HTMLElement {
    const box = el('div', 'mu-dev-box');
    const work = el('div', 'mu-actions');
    work.append(
      el('span', 'mu-dev-line', 'Work'),
      button('Start', 'mu-btn', () => void this.run(this.api.hostWork('started'), 'Work started: laptop out.')),
      button('Stop', 'mu-btn', () => void this.run(this.api.hostWork('ended'), 'Work ended.')),
    );
    box.append(work, this.doc('SOUL.md', 'Muse’s own voice, with temperament frontmatter', (text) => this.api.hostSoul(text), false));
    box.append(this.doc('MEMORY.md', 'Sent once, then cleared: only allow-listed topics are kept', (text) => this.api.hostMemory(text), true));
    return box;
  }

  /** A document textarea with a Send button. `forget` clears it as it is sent, so the text never stays in the page. */
  private doc(name: string, hint: string, send: (text: string) => Promise<CommandResult>, forget: boolean): HTMLElement {
    const form = el('form', 'mu-doc');
    const area = el('textarea', 'mu-input mu-area');
    area.rows = 4;
    area.spellcheck = false;
    area.placeholder = hint;
    area.setAttribute('aria-label', name);
    const go = el('button', 'mu-btn mu-primary', `Send ${name}`);
    go.type = 'submit';
    form.append(el('label', 'mu-dev-line', name), area, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = area.value;
      if (!text.trim()) return;
      if (forget) area.value = '';
      void this.run(send(text), `${name} sent.`);
    });
    return form;
  }

  private renderMind(m: MindView): void {
    const t = m.temperament;
    const traits = el('div', 'mu-traits');
    for (const [k, v] of Object.entries(t) as [string, number][]) {
      const row = el('div', 'mu-trait');
      row.append(el('span', '', k), bar(v), el('span', 'mu-mono', v.toFixed(2)));
      traits.append(row);
    }

    const interests = el('ul', 'mu-interests');
    for (const i of [...m.interests].sort((a, b) => b.salienceNow + b.affinity - (a.salienceNow + a.affinity))) {
      const li = el('li', 'mu-interest');
      const head = el('div', 'mu-interest-head');
      head.append(el('span', 'mu-title', i.label), el('span', `mu-chip stage-${i.stage}`, i.stage), el('span', 'mu-chip', `from ${i.seededBy}`));
      const bars = el('div', 'mu-pair');
      bars.append(el('span', 'mu-hint', 'salience'), bar(i.salienceNow, 'sal'), el('span', 'mu-mono', i.salienceNow.toFixed(2)));
      bars.append(el('span', 'mu-hint', 'affinity'), bar(i.affinity, 'aff'), el('span', 'mu-mono', i.affinity.toFixed(2)));
      li.append(head, bars);
      interests.append(li);
    }

    const questions = el('ul', 'mu-list');
    for (const q of m.questions) questions.append(el('li', '', `${q.text} (${q.topic})`));
    if (!m.questions.length) questions.append(el('li', 'mu-empty', 'No open questions.'));

    const rel = el('ul', 'mu-list');
    const most = Math.max(1, ...m.relationships.map((r) => r.rapport));
    for (const r of m.relationships) {
      const li = el('li', 'mu-trait');
      li.append(el('span', '', `${r.name} · ${r.status} · ${r.origin === 'introduced' ? 'introduced' : 'met beyond'}`), bar(r.rapport / most), el('span', 'mu-mono', r.rapport.toFixed(1)));
      rel.append(li);
    }
    if (!m.relationships.length) rel.append(el('li', 'mu-empty', 'No one yet.'));

    const refl = el('ul', 'mu-list');
    for (const r of [...m.reflections].reverse()) refl.append(el('li', '', `v${r.version} · ${day(r.at)}: ${r.narrative || '(no narrative)'}`));
    if (!m.reflections.length) refl.append(el('li', 'mu-empty', 'No reflections yet.'));

    this.mind.replaceChildren(
      el('h4', 'mu-subhead', `Temperament · SOUL v${m.soulVersion}`),
      traits,
      el('h4', 'mu-subhead', 'Interests'),
      interests,
      el('h4', 'mu-subhead', 'Questions'),
      questions,
      el('h4', 'mu-subhead', 'Relationships · rapport'),
      rel,
      el('h4', 'mu-subhead', 'Reflections'),
      refl,
    );
  }

  private renderMetrics(rows: readonly MetricsRow[]): void {
    const table = el('table', 'mu-table');
    const head = el('tr');
    head.append(el('th', '', 'day'), ...METRIC_COLUMNS.map(([, label]) => el('th', '', label)));
    table.append(head);
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', '', r.day.slice(5)), ...METRIC_COLUMNS.map(([key, , fmt]) => el('td', '', fmt(r[key]))));
      table.append(tr);
    }
    this.metrics.replaceChildren(rows.length ? table : el('p', 'mu-empty', 'No days yet.'));
  }
}
