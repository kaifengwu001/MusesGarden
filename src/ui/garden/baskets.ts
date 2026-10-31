import type { GardenState } from '../../garden/state';
import { dayName, el } from './dom';
import { topicColour } from './findCard';
import { ICONS } from './icons';
import { Sheet } from './sheet';

// The baskets Muse has handed you, newest first, down a timeline: each day
// with its name (if Muse gave it one), its finds as small pictures, and how
// many there were. One you missed is marked new. Tap a day and the camera
// flies to its patch on the planet (planting it, if you had not been yet)
// and its first card rises.

export class BasketsSheet extends Sheet {
  constructor(
    parent: HTMLElement,
    private readonly state: GardenState,
    private readonly pick: (basket: string) => void,
  ) {
    super(parent, 'Baskets', 'What Muse brought home, day by day', 'g-baskets');
  }

  render(): void {
    const list = el('ol', 'g-timeline');
    for (const basket of this.state.baskets) {
      const fresh = !this.state.visitedBasket(basket.id);
      const item = el('li', `g-day${fresh ? ' is-fresh' : ''}`);
      const row = el('button', 'g-day-row');
      row.type = 'button';
      const when = el('p', 'g-day-when');
      when.append(el('span', '', dayName(basket.day)));
      if (fresh) when.append(el('span', 'g-new', 'New'));
      row.append(when);
      if (basket.title) row.append(el('p', 'g-day-title', basket.title));
      const thumbs = el('div', 'g-thumbs');
      const topics: string[] = [];
      for (const id of basket.finds) {
        const find = this.state.find(id);
        if (!find) continue;
        const interest = this.state.interest(find.topic);
        if (interest && !topics.includes(interest.name)) topics.push(interest.name);
        const t = el('span', `g-thumb g-thumb-${find.media.kind}`);
        if (find.media.image) t.style.backgroundImage = `url("${find.media.image}")`;
        const dot = el('i');
        dot.style.background = topicColour(interest);
        t.append(dot);
        if (this.state.liked(id)) t.classList.add('is-liked');
        thumbs.append(t);
      }
      row.append(thumbs);
      row.append(el('p', 'g-day-meta', `${basket.finds.length} ${basket.finds.length === 1 ? 'find' : 'finds'} · ${topics.join(', ')}`));
      const go = el('span', 'g-day-go');
      go.innerHTML = ICONS.right;
      row.append(go);
      row.addEventListener('click', () => {
        this.close();
        this.pick(basket.id);
      });
      item.append(row);
      list.append(item);
    }
    const foot = el('p', 'g-sheet-note', 'Each day’s finds grow side by side as a patch of their own, a little farther out each day. Nothing scrolls on forever: this is all of it.');
    this.body.replaceChildren(list, foot);
  }
}
