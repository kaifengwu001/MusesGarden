import { Color } from 'three';
import { ROW, type Palette } from '../render/palette';
import './cloudColours.css';

// TEMPORARY: a panel for trying cloud colours live. Here a cloud is two colours: its light (the sunlit body, and the
// highlight drawn from it toward warm white) and its shadow (the shade, and the underside drawn from it a little
// toward the light), with the half-lit faces between them. One click on a swatch sets either; the first swatch of a
// row is the world's own colour at this time of day, and the picker at the end of a row takes any colour. "Each
// part" sets the palette's five cloud cells one by one. Picks hold their cells at every time of day (Palette.pin) and
// are kept in this browser; Copy gives the row as palette.ts writes it. Once the colours are baked into palette.ts,
// delete this file and cloudColours.css, and their lines in main.ts.

/** The palette's cloud cells (clouds.glsl); the birds read the highlight, sunlit and half-lit ones. */
const CELL = { sunlit: 0, shade: 1, half: 2, highlight: 3, underside: 4 } as const;
const COLUMNS = 5;
/** The cells each colour draws (a new one replaces the parts set for them by hand). */
const DRAWS = { light: [CELL.sunlit, CELL.highlight, CELL.half], shadow: [CELL.shade, CELL.underside, CELL.half] } as const;
type Kind = keyof typeof DRAWS;
/** How the other cells follow the two colours: the highlight toward warm white, the underside toward the light, the half-lit faces between. */
const DRAW = { white: new Color('#FFF8E8'), highlight: 0.45, underside: 0.15, half: 0.4 } as const;
const LIGHTS = [
  ['White', '#FFFFFF'],
  ['Ivory', '#FFF5E1'],
  ['Butter', '#FFE9AE'],
  ['Apricot', '#F8C39A'],
  ['Rose', '#F1BCC6'],
  ['Lilac', '#D9CBEE'],
  ['Sky', '#D4E6F5'],
] as const;
const SHADOWS = [
  ['Cool grey', '#B2BCCB'],
  ['Blue', '#9DB0D0'],
  ['Lilac', '#A59DC8'],
  ['Mauve', '#B39BB7'],
  ['Teal', '#9DBFC1'],
  ['Warm grey', '#BCB2AA'],
  ['Slate', '#838FA8'],
] as const;
/** Each part, lightest first: cell, name, what it colours. */
const PARTS = [
  [CELL.highlight, 'Highlight', 'The sunniest faces, and the rim where the sun shines through'],
  [CELL.sunlit, 'Sunlit', 'Faces turned to the sun'],
  [CELL.half, 'Half-lit', 'Faces the sun only grazes'],
  [CELL.shade, 'Shade', 'Faces turned from the sun'],
  [CELL.underside, 'Underside', 'The shade low on the heap, toward its flat base'],
] as const;
const STORAGE_KEY = 'muses-garden.lantern-reed-gardens.cloud-colours';
const HEX = /^#?([0-9a-f]{6})$/i;

/** Colours picked (#RRGGBB), or null where the world's own colour stands. */
interface Picks {
  light: string | null;
  shadow: string | null;
  /** Cells set one by one, by column. */
  parts: Array<string | null>;
}

const none = (): Picks => ({ light: null, shadow: null, parts: Array.from({ length: COLUMNS }, () => null) });
const hexOf = (c: Color): string => `#${c.getHexString().toUpperCase()}`;
const asHex = (value: unknown): string | null => {
  const m = typeof value === 'string' ? HEX.exec(value.trim()) : null;
  return m ? `#${m[1].toUpperCase()}` : null;
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export class CloudColours {
  private picks = none();
  /** What each cell is pinned to now (null: the keys decide). */
  private readonly pinned: Array<string | null> = Array.from({ length: COLUMNS }, () => null);
  /** The keys' cloud row the pins were drawn against (the time of day moves it). */
  private keyed = '';
  /** What the panel last showed, so the page is touched only when it changes. */
  private shown = '';
  private readonly rows = new Map<Kind, { own: HTMLButtonElement; swatches: HTMLButtonElement[]; any: HTMLInputElement }>();
  private readonly parts = new Map<number, { root: HTMLElement; swatch: HTMLInputElement; hex: HTMLInputElement }>();
  private readonly copy = element('button', '', 'Copy row');
  private readonly note = element('p', 'cloud-colours-note', 'The birds take the light colours too.');
  private readonly colour = new Color();

  constructor(parent: HTMLElement, private readonly palette: Palette) {
    const panel = element('details', 'cloud-colours');
    panel.open = window.innerHeight >= 700;
    const summary = element('summary', '');
    summary.append(element('span', 'canyon-eyebrow', 'Temporary'), element('span', 'cloud-colours-title', 'Cloud colours'));
    const reset = element('button', '', 'Reset');
    reset.addEventListener('click', () => {
      this.picks = none();
      this.changed();
    });
    this.copy.addEventListener('click', () => void this.copyRow());
    const actions = element('div', 'cloud-colours-actions');
    actions.append(this.copy, reset);
    panel.append(summary, this.swatchRow('light', 'Light', LIGHTS), this.swatchRow('shadow', 'Shadow', SHADOWS), this.partList(), actions, this.note);
    parent.append(panel);
    this.picks = this.load();
    this.update();
  }

  /** Follow the time of day (the world's own colours, and the cells drawn from them) and show what the clouds have now. */
  update(): void {
    const keyed = this.row((col) => this.palette.unpinned(ROW.CLOUD, col, this.colour));
    if (keyed !== this.keyed) {
      this.keyed = keyed;
      this.apply();
    }
    const shown = [keyed, this.row((col) => this.palette.get(ROW.CLOUD, col, this.colour)), this.picks.light, this.picks.shadow, ...this.picks.parts].join(' ');
    if (shown === this.shown) return;
    this.shown = shown;
    this.refresh();
  }

  private row(colour: (col: number) => Color): string {
    return Array.from({ length: COLUMNS }, (_, col) => hexOf(colour(col))).join(' ');
  }

  /** Pin each cell to what the picks make of it, or hand it back to the keys. */
  private apply(): void {
    const { light, shadow, parts } = this.picks;
    const L = light ? new Color(light) : this.palette.unpinned(ROW.CLOUD, CELL.sunlit);
    const S = shadow ? new Color(shadow) : this.palette.unpinned(ROW.CLOUD, CELL.shade);
    const drawn: Array<Color | null> = [];
    drawn[CELL.sunlit] = light ? L : null;
    drawn[CELL.highlight] = light ? L.clone().lerp(DRAW.white, DRAW.highlight) : null;
    drawn[CELL.shade] = shadow ? S : null;
    drawn[CELL.underside] = shadow ? S.clone().lerp(L, DRAW.underside) : null;
    drawn[CELL.half] = light || shadow ? L.clone().lerp(S, DRAW.half) : null;
    for (let col = 0; col < COLUMNS; col++) {
      const c = drawn[col];
      const hex = parts[col] ?? (c ? hexOf(c) : null);
      if (hex === this.pinned[col]) continue;
      this.pinned[col] = hex;
      this.palette.pin(ROW.CLOUD, col, hex);
    }
  }

  private choose(kind: Kind, hex: string | null): void {
    this.picks[kind] = asHex(hex);
    for (const col of DRAWS[kind]) this.picks.parts[col] = null;
    this.changed();
  }

  private setPart(col: number, hex: string): void {
    this.picks.parts[col] = asHex(hex);
    this.changed();
  }

  private changed(): void {
    this.apply();
    this.save();
    this.update();
  }

  /** A row of swatches for one colour: the world's own, a few to try in a click, and a picker for any other. */
  private swatchRow(kind: Kind, label: string, swatches: ReadonlyArray<readonly [string, string]>): HTMLElement {
    const row = element('div', 'cloud-colours-row');
    const list = element('div', 'cloud-colours-swatches');
    const own = element('button', 'cloud-colours-swatch cloud-colours-own');
    own.title = `${label}: this world's own`;
    own.setAttribute('aria-label', own.title);
    own.addEventListener('click', () => this.choose(kind, null));
    const buttons = swatches.map(([name, hex]) => {
      const button = element('button', 'cloud-colours-swatch');
      button.style.background = hex;
      button.dataset.hex = hex;
      button.title = `${name} ${hex}`;
      button.setAttribute('aria-label', `${label}: ${name}`);
      button.addEventListener('click', () => this.choose(kind, hex));
      return button;
    });
    const any = element('input', 'cloud-colours-any');
    any.type = 'color';
    any.title = `${label}: any colour`;
    any.setAttribute('aria-label', any.title);
    any.addEventListener('input', () => this.choose(kind, any.value));
    list.append(own, ...buttons, any);
    row.append(element('span', 'cloud-colours-label', label), list);
    this.rows.set(kind, { own, swatches: buttons, any });
    return row;
  }

  /** The five cells one by one, folded away. */
  private partList(): HTMLElement {
    const list = element('details', 'cloud-colours-parts');
    list.append(element('summary', '', 'Each part'));
    for (const [col, name, about] of PARTS) {
      const root = element('div', 'cloud-colours-part');
      root.title = about;
      const swatch = element('input', '');
      swatch.type = 'color';
      swatch.setAttribute('aria-label', `${name} colour`);
      swatch.addEventListener('input', () => this.setPart(col, swatch.value));
      const hex = element('input', 'cloud-colours-hex');
      hex.spellcheck = false;
      hex.maxLength = 7;
      hex.setAttribute('aria-label', `${name} hex`);
      hex.addEventListener('change', () => {
        if (asHex(hex.value)) this.setPart(col, hex.value);
        else hex.value = hexOf(this.palette.get(ROW.CLOUD, col, this.colour));
      });
      root.append(swatch, element('span', '', name), hex);
      list.append(root);
      this.parts.set(col, { root, swatch, hex });
    }
    return list;
  }

  /** Show the colours the clouds have now, and which swatches stand. */
  private refresh(): void {
    for (const [kind, row] of this.rows) {
      const cell = kind === 'light' ? CELL.sunlit : CELL.shade;
      const picked = this.picks[kind];
      row.own.style.background = hexOf(this.palette.unpinned(ROW.CLOUD, cell, this.colour));
      row.own.setAttribute('aria-pressed', String(picked === null));
      let listed = picked === null;
      for (const button of row.swatches) {
        const on = button.dataset.hex === picked;
        listed ||= on;
        button.setAttribute('aria-pressed', String(on));
      }
      row.any.classList.toggle('on', !listed);
      row.any.value = hexOf(this.palette.get(ROW.CLOUD, cell, this.colour)).toLowerCase();
    }
    for (const [col, part] of this.parts) {
      const hex = hexOf(this.palette.get(ROW.CLOUD, col, this.colour));
      part.swatch.value = hex.toLowerCase();
      if (document.activeElement !== part.hex) part.hex.value = hex;
      part.root.classList.toggle('picked', this.picks.parts[col] !== null);
    }
  }

  /** The row as palette.ts writes it, every cell as the clouds have it now, to the clipboard. */
  private async copyRow(): Promise<void> {
    const text = `[ROW.CLOUD]: [${this.row((col) => this.palette.get(ROW.CLOUD, col, this.colour)).split(' ').map((hex) => `'${hex}'`).join(', ')}],`;
    try {
      await navigator.clipboard.writeText(text);
      this.copy.textContent = 'Copied';
      window.setTimeout(() => (this.copy.textContent = 'Copy row'), 1200);
    } catch {
      this.note.textContent = text; // no clipboard here: show it to copy by hand
    }
  }

  private load(): Picks {
    const picks = none();
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Picks> | null;
      picks.light = asHex(saved?.light);
      picks.shadow = asHex(saved?.shadow);
      picks.parts = picks.parts.map((_, col) => asHex(saved?.parts?.[col]));
    } catch {
      // nothing kept, or unreadable: start from the world's own
    }
    return picks;
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.picks));
    } catch {
      // storage unavailable (a private window): picks last this visit
    }
  }
}
