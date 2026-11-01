import type { World } from '../world';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** The people and places of this habitat, independent of the network garden. */
export class WindfieldUi {
  private selected: string | null = null;
  private readonly panel = element('section', 'windfield-community');
  private readonly detail = element('div', 'windfield-resident-detail');
  private readonly title = element('h3', '');
  private readonly activity = element('p', 'windfield-activity');
  private readonly name = element('input', 'windfield-name');
  private readonly follow = element('button', '', 'Follow');
  private readonly list = new Map<string, HTMLButtonElement>();
  private readonly announcement = element('p', 'windfield-notice');

  constructor(parent: HTMLElement, private readonly world: World, time: () => number, navigate: () => void) {
    const panel = this.panel;
    panel.setAttribute('aria-label', 'Windfield residents');
    const eyebrow = element('p', 'windfield-eyebrow', 'Carried by a fair wind');
    const head = element('h2', '', 'The windfield residents');
    const places = element('nav', 'windfield-places');
    places.setAttribute('aria-label', 'Places');
    for (const [label, preset] of [['Shelter', 'homestead'], ['Wind Window', 'vista'], ['Whole planet', 'homestead']] as const) {
      const button = element('button', '', label);
      button.addEventListener('click', () => {
        navigate();
        world.cameraPreset(preset);
        if (label === 'Whole planet') {
          world.rig.setZoom(0, true);
          world.rig.lookUp(0);
        }
      });
      places.append(button);
    }
    const wildlife = element('nav', 'windfield-wildlife');
    wildlife.setAttribute('aria-label', 'Wildlife encounters');
    const wildlifeLabel = element('p', 'windfield-eyebrow', 'Look closer');
    wildlife.append(wildlifeLabel);
    for (const [id, label] of [['sailback', 'Sailback'], ['kitelet', 'Kitelet'], ['sand-stitcher', 'Sand Stitcher']] as const) {
      const button = element('button', '', label);
      button.setAttribute('aria-label', `Watch ${label}`);
      button.addEventListener('click', () => {
        navigate();
        this.selected = null;
        this.detail.hidden = true;
        world.watchWildlife(id);
        this.update();
      });
      wildlife.append(button);
    }
    const residents = element('div', 'windfield-residents');
    for (const resident of world.residents.members) {
      const button = element('button', 'windfield-resident', resident.name);
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
    const label = element('label', 'windfield-name-label', 'Name');
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
    const actions = element('div', 'windfield-resident-actions');
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
      if (wasFollowing) world.stopFollowing();
      else world.meetResident(this.selected);
    });
    const close = element('button', 'windfield-close', 'Close');
    close.setAttribute('aria-label', 'Close resident details');
    close.addEventListener('click', () => { this.selected = null; this.detail.hidden = true; world.stopFollowing(); this.update(); });
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
    if (this.world.followingWildlife) {
      const animal = this.world.wildlife.encounter(this.world.followingWildlife);
      if (animal) this.announcement.textContent = `${animal.name} · ${animal.activity}`;
    }
    if (resident) {
      const status = `${resident.role} · ${resident.activity}`;
      if (this.activity.textContent !== status) this.activity.textContent = status;
      this.follow.textContent = this.world.followingResident === resident.id ? 'Stop following' : 'Follow';
    }
  }
}
