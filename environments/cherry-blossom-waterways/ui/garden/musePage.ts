import type { GardenState } from '../../garden/state';
import { agoPhrase, el, shortDate, toggle } from '../../../../src/ui/garden/dom';
import { topicColour } from './findCard';
import { ICONS } from './icons';
import { Sheet } from '../../../../src/ui/garden/sheet';

// Muse's page: who it is (the line its soul.md gives, all it carries into
// the garden), where it is, and three tabs. Its interests, each shared with
// other Muses or kept private (private ones never leave the planet). Its
// friends, other Muses it has met by what they share, named by their own
// names only, tagged when their human is your friend on Instagram or
// Facebook. And what the garden keeps private, in plain words.

type Tab = 'interests' | 'friends' | 'privacy';

/** Local preferences on the privacy tab (not sent anywhere yet: the backend decides what they mean). */
const PREFS_KEY = 'muses-garden.garden.privacy.v1';
const PREFS = [
  { id: 'visits', label: 'Friends’ Muses can visit Muse’s garden', on: true },
  { id: 'strangers', label: 'Invitations from Muses you haven’t met', on: false },
  { id: 'known', label: 'Say when a Muse’s human is your friend on Instagram or Facebook', on: true },
] as const;

function readPrefs(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export class MuseSheet extends Sheet {
  private tab: Tab = 'interests';

  constructor(
    parent: HTMLElement,
    private readonly state: GardenState,
    private readonly faces: { muse: string; friend: string },
    private readonly setHome: (home: boolean) => void,
  ) {
    super(parent, 'Muse', '', 'g-muse');
  }

  render(): void {
    const s = this.state.snapshot;
    if (!s) return;
    const status = this.state.status;
    const sub = this.el.querySelector('.g-sheet-sub');
    if (sub) sub.textContent = status.home ? `At home · ${status.note ?? 'in its cottage'}` : `Out exploring · ${status.note ?? 'back later'}`;
    const hero = el('div', 'g-muse-hero');
    const face = el('span', `g-muse-face${status.home ? '' : ' is-out'}`);
    face.style.backgroundImage = `url(${this.faces.muse})`;
    hero.append(face, el('blockquote', 'g-soul', s.muse.soul));
    const tabs = el('div', 'g-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [
      ['interests', 'Interests'],
      ['friends', 'Friends'],
      ['privacy', 'Privacy'],
    ] as const) {
      const t = el('button', `g-tab${this.tab === id ? ' is-on' : ''}`, label);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(this.tab === id));
      t.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
      tabs.append(t);
    }
    const panel = el('div', 'g-tabpanel');
    if (this.tab === 'interests') this.interests(panel);
    else if (this.tab === 'friends') this.friends(panel);
    else this.privacy(panel);
    this.body.replaceChildren(hero, tabs, panel);
  }

  private interests(panel: HTMLElement): void {
    panel.append(el('p', 'g-intro', 'What Muse is into grows as it explores, and goes into its soul.md. Shared interests are all other Muses can see of it, and how it finds friends; private ones never leave its planet.'));
    const list = el('ul', 'g-interests');
    for (const interest of this.state.interests) {
      const li = el('li', 'g-interest');
      const dot = el('i', 'g-flower');
      dot.style.background = topicColour(interest);
      const name = el('div', 'g-interest-name');
      name.append(el('span', '', interest.name), el('small', '', `since ${shortDate(interest.since)}`));
      li.append(dot, name, toggle(`Share ${interest.name} with other Muses`, interest.shared, (on) => this.state.setShared(interest.id, on), ['Shared', 'Private']));
      list.append(li);
    }
    panel.append(list);
  }

  private friends(panel: HTMLElement): void {
    const friends = this.state.snapshot?.friends ?? [];
    panel.append(el('p', 'g-intro', 'Muses that Muse has met. It chooses whom to meet by the interests they share; you only ever see Muses’ own names.'));
    const list = el('ul', 'g-friends');
    for (const f of friends) {
      const li = el('li', 'g-friend');
      const face = el('span', 'g-friend-face');
      face.style.backgroundImage = `url(${this.faces.friend})`;
      face.style.setProperty('--coat', f.coat);
      const text = el('div', 'g-friend-text');
      const top = el('p', 'g-friend-name');
      top.append(el('span', '', f.name), el('small', '', `met ${agoPhrase(f.met)}`));
      text.append(top);
      const chips = el('p', 'g-chips');
      for (const name of f.shared) {
        const interest = this.state.interests.find((i) => i.name === name);
        const chip = el('span', 'g-chip');
        const dot = el('i');
        dot.style.background = topicColour(interest);
        chip.append(dot, name);
        chips.append(chip);
      }
      text.append(chips);
      if (f.knownOn) {
        const tag = el('p', 'g-known');
        tag.innerHTML = f.knownOn === 'instagram' ? ICONS.camera : ICONS.people;
        tag.append(`You’re friends on ${f.knownOn === 'instagram' ? 'Instagram' : 'Facebook'}`);
        text.append(tag);
      }
      li.append(face, text);
      list.append(li);
    }
    panel.append(list);
  }

  private privacy(panel: HTMLElement): void {
    const card = el('div', 'g-privacy-card');
    card.append(el('h3', '', 'What Muse brings into the garden'));
    const items = el('ul', 'g-privacy-list');
    for (const [strong, rest] of [
      ['Its soul.md, ', 'a few lines on who it is becoming. That is all.'],
      ['Never its memory, ', 'your messages, or anything about you.'],
      ['Only Muses’ names. ', 'No human’s name appears in any garden, yours or a friend’s.'],
      ['Shared interests only. ', 'Private ones stay on Muse’s planet.'],
    ]) {
      const li = el('li');
      li.append(el('strong', '', strong), rest);
      items.append(li);
    }
    card.append(items);
    panel.append(card);
    const prefs = readPrefs();
    const list = el('div', 'g-prefs');
    for (const p of PREFS) {
      list.append(
        toggle(p.label, prefs[p.id] ?? p.on, (on) => {
          const next = { ...readPrefs(), [p.id]: on };
          try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(next));
          } catch {
            // forgotten in a private window
          }
        }),
      );
    }
    panel.append(list);
    // a preview of the garden while Muse is out (until the backend says where Muse is)
    const demo = el('div', 'g-demo');
    demo.append(el('p', 'g-demo-label', 'Preview'));
    demo.append(toggle('Muse is out exploring', !this.state.status.home, (on) => this.setHome(!on)));
    panel.append(demo);
  }
}
