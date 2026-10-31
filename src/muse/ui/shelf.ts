import type { MuseApi } from './api';
import { el, outLink, thumb } from './dom';

/** Muse's ten most loved things, on display at home (stands in for the house interior). */
export class Shelf {
  readonly el = el('section', 'mu-panel mu-shelf');
  private readonly list = el('ol', 'mu-shelf-list');

  constructor(private readonly api: MuseApi) {
    this.el.setAttribute('aria-label', 'Shelf');
    const head = el('header', 'mu-panel-head');
    head.append(el('h2', 'mu-panel-title', 'The shelf'), el('p', 'mu-panel-sub', 'What Muse loves most right now'));
    const body = el('div', 'mu-panel-body');
    body.append(this.list);
    this.el.append(head, body);
  }

  async refresh(): Promise<void> {
    const { items } = await this.api.shelf();
    if (items.length === 0) {
      this.list.replaceChildren(el('p', 'mu-empty', 'The shelf is empty for now.'));
      return;
    }
    const most = Math.max(...items.map((i) => i.fondness), 1e-6);
    this.list.replaceChildren(
      ...items.map((item) => {
        const li = el('li', 'mu-shelf-item');
        const a = outLink(item.url, 'mu-shelf-link');
        const frame = el('span', 'mu-shelf-thumb mu-shelf-blank');
        const img = thumb(item.thumb, 'mu-shelf-thumb');
        if (img) frame.append(img);
        a.append(frame);
        const text = el('span', 'mu-shelf-text');
        const bar = el('span', 'mu-bar');
        bar.style.setProperty('--v', String(item.fondness / most));
        bar.title = `Fondness ${item.fondness.toFixed(2)}`;
        text.append(el('span', 'mu-title', item.title), el('span', 'mu-quote', item.reason), bar);
        a.append(text);
        li.append(a);
        return li;
      }),
    );
  }
}
