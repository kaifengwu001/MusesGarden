import { el, nextFrame, wait } from '../ui/garden/dom';

// The ticket you travel on, stamped as you set off, and again as you come home: the moment between two planets. Its
// look is the garden's (.g-transit in src/ui/garden/garden.css), so a page that shows it loads that sheet.

/** A ticket for a planet: "Admit one", the planet, whose guest you are (or the way home), and its stamp. */
export function ticket(where: string, who: string): HTMLElement {
  const home = where === 'Home';
  const t = el('div', 'g-transit-ticket');
  t.append(
    el('p', 'g-transit-admit', 'Admit one'),
    el('p', 'g-transit-where', where),
    el('p', 'g-transit-who', home ? 'Back to Muse’s garden' : `Guest of ${who}`),
    el('span', 'g-transit-stamp', home ? 'Welcome back' : 'Visiting'),
  );
  return t;
}

export class Transit {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = el('div', 'g-transit');
    parent.append(this.el);
  }

  /** Set off for a planet: its ticket comes up and is stamped, then holds a moment. */
  async leave(where: string, host: string): Promise<void> {
    this.el.replaceChildren(ticket(where, host));
    this.el.classList.add('is-on');
    await nextFrame();
    this.el.classList.add('is-stamped');
    await wait(900);
  }

  /** Come home: the ticket stamped “Welcome back”, for a moment. */
  async home(): Promise<void> {
    this.el.replaceChildren(ticket('Home', 'Muse'));
    this.el.classList.add('is-on', 'is-home');
    await wait(450);
  }

  hide(): void {
    this.el.classList.remove('is-on', 'is-stamped', 'is-home');
  }
}
