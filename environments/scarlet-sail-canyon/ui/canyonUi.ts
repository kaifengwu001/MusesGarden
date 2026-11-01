import type { World } from '../world';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** The people and places of this habitat, independent of the network garden. */
export class CanyonUi {
  private selected: string | null = null;
  private readonly panel = element('section', 'canyon-community');
  private readonly detail = element('div', 'canyon-resident-detail');
  private readonly title = element('h3', '');
  private readonly activity = element('p', 'canyon-activity');
  private readonly name = element('input', 'canyon-name');
  private readonly follow = element('button', '', 'Follow');
  private readonly list = new Map<string, HTMLButtonElement>();
  private readonly announcement = element('p', 'canyon-notice');

  constructor(parent: HTMLElement, private readonly world: World, time: () => number, navigate: () => void) {
    const panel = this.panel;
    panel.setAttribute('aria-label', 'Canyon residents');
    const eyebrow = element('p', 'canyon-eyebrow', 'A place to belong');
    const head = element('h2', '', 'Life among the sails');
    const places = element('nav', 'canyon-places');
    places.setAttribute('aria-label', 'Places');
    for (const [label, preset] of [['Shelter', 'homestead'], ['Three Sails', 'vista'], ['Whole planet', 'homestead']] as const) {
      const button = element('button', '', label);
      button.addEventListener('click', () => {
        navigate();
        world.cameraPreset(preset);
        if (label === 'Whole planet') { world.rig.lookUp(0); world.rig.setZoom(0, true); }
      });
      places.append(button);
    }
    const wildlife = element('div', 'canyon-wildlife');
    wildlife.setAttribute('aria-label', 'Native wildlife');
    for (const species of world.fauna.species) {
      const button = element('button', `canyon-species ${species.id}`, species.name);
      button.setAttribute('aria-label', `Observe ${species.name}`);
      button.title = species.description;
      button.addEventListener('click', () => {
        navigate();
        this.selected = null;
        this.detail.hidden = true;
        world.observeCreature(species.id);
        this.announcement.textContent = species.description;
        this.update();
      });
      wildlife.append(button);
    }
    const residents = element('div', 'canyon-residents');
    for (const resident of world.residents.members) {
      const button = element('button', 'canyon-resident', resident.name);
      button.dataset.resident = resident.id;
      button.style.setProperty('--coat', resident.coat);
      button.setAttribute('aria-label', `Meet ${resident.name}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        navigate();
        this.select(resident.id);
        world.meetResident(resident.id);
      });
      this.list.set(resident.id, button);
      residents.append(button);
    }
    const label = element('label', 'canyon-name-label', 'Name');
    this.name.type = 'text';
    this.name.maxLength = 24;
    this.name.setAttribute('aria-label', 'Resident name');
    label.append(this.name);
    this.name.addEventListener('change', () => {
      if (!this.selected) return;
      world.residents.rename(this.selected, this.name.value);
      const resident = world.residents.members.find(r => r.id === this.selected);
      if (resident) { this.select(resident.id); this.announcement.textContent = `${resident.name}’s name is saved on this device.`; }
    });
    const actions = element('div', 'canyon-resident-actions');
    const greet = element('button', '', 'Say hello');
    greet.addEventListener('click', () => {
      if (!this.selected) return;
      world.residents.greet(this.selected, time());
      this.announcement.textContent = `${this.title.textContent ?? 'Your friend'} waves hello.`;
    });
    this.follow.addEventListener('click', () => {
      if (!this.selected) return;
      const wasFollowing = world.followingResident === this.selected;
      navigate();
      if (wasFollowing) world.followingResident = null;
      else world.meetResident(this.selected);
    });
    const close = element('button', 'canyon-close', 'Close');
    close.setAttribute('aria-label', 'Close resident details');
    close.addEventListener('click', () => { this.selected = null; this.detail.hidden = true; world.followingResident = null; this.update(); });
    actions.append(greet, this.follow, close);
    this.detail.append(this.title, this.activity, label, actions);
    this.detail.hidden = true;
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-live', 'polite');
    panel.append(eyebrow, head, places, wildlife, residents, this.detail, this.announcement);
    parent.append(panel);
  }

  select(id: string): void {
    const resident = this.world.residents.members.find(r => r.id === id);
    if (!resident) return;
    this.selected = id;
    this.title.textContent = resident.name;
    this.name.value = resident.name;
    this.detail.hidden = false;
    this.update();
  }

  update(): void {
    this.panel.classList.toggle('has-selection', this.selected !== null);
    for (const resident of this.world.residents.members) {
      const button = this.list.get(resident.id)!;
      if (button.textContent !== resident.name) button.textContent = resident.name;
      button.setAttribute('aria-label', `Meet ${resident.name}`);
      button.setAttribute('aria-pressed', String(resident.id === this.selected));
    }
    const resident = this.world.residents.members.find(r => r.id === this.selected);
    if (resident) {
      const status = `${resident.role} · ${resident.activity}`;
      if (this.activity.textContent !== status) this.activity.textContent = status;
      this.follow.textContent = this.world.followingResident === resident.id ? 'Stop following' : 'Follow';
    }
  }
}
