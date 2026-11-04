function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

/** Editorial chrome: the title and its metadata line, and the interaction hints. */
export class Ui {
  private readonly title: HTMLElement;
  private readonly line: HTMLElement;
  private readonly hints: HTMLElement;

  constructor(root: HTMLElement) {
    const masthead = element('header', 'masthead');
    const title = element('h1');
    title.textContent = 'Muse’s Garden';
    this.title = title;
    this.line = element('p', 'world-line');
    masthead.append(title, this.line);
    this.hints = element('ul', 'hints');
    root.append(masthead, this.hints);
  }

  setTitle(text: string): void {
    if (this.title.textContent !== text) this.title.textContent = text;
  }

  setWorldLine(text: string): void {
    if (this.line.textContent !== text) this.line.textContent = text;
  }

  /** Each hint is [key or gesture, what it does]. */
  setHints(hints: ReadonlyArray<readonly [string, string]>): void {
    this.hints.replaceChildren(
      ...hints.map(([key, action]) => {
        const li = element('li');
        const k = element('kbd');
        k.textContent = key;
        li.append(k, ` ${action}`);
        return li;
      }),
    );
  }

  static fallback(root: HTMLElement, message: string): void {
    const box = element('div', 'fallback');
    const title = element('h1');
    title.textContent = 'Muse’s Garden';
    const text = element('p');
    text.textContent = message;
    box.append(title, text);
    root.append(box);
  }
}
