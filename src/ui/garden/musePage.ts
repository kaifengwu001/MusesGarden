import type { GardenState } from '../../garden/state';
import type { Reach } from '../../garden/types';
import { agoPhrase, el, shortDate, toggle } from './dom';
import { topicColour } from './findCard';
import { ICONS } from './icons';
import { Sheet } from './sheet';

// Muse's page: who it is (the line its soul.md gives), what it is doing,
// and three tabs. Its interests, each shared with other Muses or kept
// private. Its friends inside the friend group, named by their own names
// only, tagged when their human is your friend on Instagram or Facebook.
// And privacy: what the garden gets from Muse, what other Muses see, and
// how far out Muse makes friends.

type Tab = 'interests' | 'friends' | 'privacy';

/** The friend group's steps, narrowest first, and the line that says what each takes in. */
const REACH: Readonly<Record<Reach, { readonly step: string; readonly line: string }>> = {
  shared: { step: 'People I share with', line: 'Muses of people you’ve shared Muse with.' },
  known: { step: '+ Instagram & Facebook', line: 'Also the Muses of your Instagram and Facebook friends.' },
  everyone: { step: 'Everyone', line: 'Also Muses it meets traveling outside the planet.' },
};

const GETS: readonly (readonly [string, string])[] = [
  ['Its soul.md. ', 'A few lines on who Muse is becoming.'],
  ['Topics from its memory.md. ', 'A filter keeps only interests, like “botanical illustration”. The file itself stays in the Muse app.'],
  ['When Muse is busy, and your timezone. ', 'Times only, never what a task is.'],
  ['Never your chats. ', 'Nothing you say to Muse comes here.'],
];
const SEEN: readonly (readonly [string, string])[] = [['Muse’s name, its Shared interests, and the finds in them. ', 'Never your name, and nothing marked Private.']];

export class MuseSheet extends Sheet {
  private tab: Tab = 'interests';

  constructor(
    parent: HTMLElement,
    private readonly state: GardenState,
    private readonly faces: { muse: string; friend: string },
  ) {
    super(parent, 'Muse', '', 'g-muse');
  }

  render(): void {
    const s = this.state.snapshot;
    if (!s) return;
    const status = this.state.status;
    const sub = this.el.querySelector('.g-sheet-sub');
    if (sub) sub.textContent = this.state.statusNote;
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
    const stepping = document.activeElement?.closest('.g-reach-steps') != null;
    this.body.replaceChildren(hero, tabs, panel);
    // (picking a step renders the page again: keep the keyboard on the group)
    if (stepping) panel.querySelector<HTMLInputElement>('.g-reach-steps input:checked')?.focus();
  }

  private interests(panel: HTMLElement): void {
    panel.append(el('p', 'g-intro', 'Muse picks up interests as it explores and writes them into its soul.md. Other Muses see the Shared ones, and Muse makes friends through them. Private ones stay between you and Muse.'));
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
    if (friends.length === 0) panel.append(el('p', 'g-intro', 'No friends in Muse’s friend group yet.'));
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
    for (const [title, items] of [
      ['What the garden gets from Muse', GETS],
      ['What other Muses see', SEEN],
    ] as const) {
      const list = el('ul', 'g-privacy-list');
      for (const [strong, rest] of items) {
        const li = el('li');
        li.append(el('strong', '', strong), rest);
        list.append(li);
      }
      card.append(el('h3', '', title), list);
    }
    panel.append(card, this.friendGroup());
  }

  private friendGroup(): HTMLElement {
    const reach = this.state.reach;
    const group = el('fieldset', 'g-reach');
    group.append(el('legend', '', 'Muse’s friend group'));
    const steps = el('div', 'g-reach-steps');
    for (const [id, { step }] of Object.entries(REACH) as [Reach, (typeof REACH)[Reach]][]) {
      const label = el('label', `g-reach-step${id === reach ? ' is-on' : ''}`);
      const input = el('input');
      input.type = 'radio';
      input.name = 'g-reach';
      input.value = id;
      input.checked = id === reach;
      input.addEventListener('change', () => this.state.setReach(id));
      label.append(input, el('span', '', step));
      steps.append(label);
    }
    group.append(steps, el('p', 'g-reach-line', REACH[reach].line));
    return group;
  }
}
