import './muse.css';
import { Vector3 } from 'three';
import type { World } from '../../world';
import type { MuseId, PlantCard } from '../contract';
import { Anchors } from './anchors';
import { MuseApi } from './api';
import { DevTools } from './dev';
import { button, el, SimClock } from './dom';
import { Mailbox } from './mailbox';
import { Pins } from './pins';
import { Settings } from './settings';
import { Shelf } from './shelf';
import { Status } from './status';
import { Visit } from './visit';

type PanelName = 'mailbox' | 'shelf' | 'settings';

interface Panel {
  readonly el: HTMLElement;
  refresh(): Promise<void>;
}

/** Status, mailbox and the backstage refresh this often (ms). */
const REFRESH_MS = 30_000;
/** Toggles the dev tools (free: view/keys.ts and main.ts use W A S D Q E, arrows, H, ` and P). */
const DEV_KEY = 'm';

const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * The Muse overlay: DOM only, drawn over the planet with no GPU cost. Mounts when the URL has
 * `?muse` (`?muse=<id>` picks the owner's Muse, default "hero"), or whenever the page is not under
 * automation, so the frame-hash and screenshot tests never see it. `?dev` shows the dev tools; M toggles them.
 */
export function mountMuse(root: HTMLElement, world: World): void {
  const params = new URLSearchParams(location.search);
  if (!params.has('muse') && navigator.webdriver) return;
  const api = new MuseApi((params.get('muse') || 'hero') as MuseId);
  const clock = new SimClock();

  const overlay = el('div', 'mu');
  const layer = el('div', 'mu-pins');
  root.append(overlay);
  const pins = new Pins(world, layer);
  const status = new Status(api, world, clock, pins);
  const anchors = new Anchors(pins, () => setOpen(null));
  const toast = el('p', 'mu-toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  const say = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    window.setTimeout(() => (toast.hidden = true), 6000);
  };
  const visit = new Visit(api, world, anchors, clock, (visiting, note) => {
    status.setAway(visiting);
    overlay.classList.toggle('visiting', visiting);
    if (note) say(note);
    if (visiting) setOpen(null);
    else void homeAnchors();
  });

  /** The owner's own planet: one anchor per collected object, its card fetched on click. */
  async function homeAnchors(): Promise<void> {
    if (visit.active) return;
    const w = await api.world();
    if (!visit.active) anchors.set(w.plants.map((p) => ({ id: p.id, dir: p.dir, preview: p.preview, card: () => api.plant(p.id) })));
  }

  const showOnPlanet = (card: PlantCard): void => {
    status.unfollow();
    world.rig.glideTo(new Vector3(...card.place.dir));
    anchors.highlight(card.id);
  };

  // One refresh at a time; a call during one runs another after it, so a command's effect is never missed.
  let refreshing: Promise<void> | null = null;
  let again = false;
  const refresh = (): Promise<void> => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = Promise.allSettled([status.refresh(), homeAnchors(), refreshBadge(), open ? show(open) : null, dev.visible ? dev.refresh() : null]).then(() => {
      refreshing = null;
      visit.tick();
      if (again) {
        again = false;
        return refresh();
      }
    });
    return refreshing;
  };

  const panels: Record<PanelName, Panel> = {
    mailbox: new Mailbox(api, () => status.museName, () => void refresh(), (card) => void visit.enter(card), showOnPlanet),
    shelf: new Shelf(api),
    settings: new Settings(api, () => void refresh()),
  };
  const dev = new DevTools(api, () => void refresh());
  dev.el.hidden = !params.has('dev');

  const dock = el('nav', 'mu-dock');
  dock.setAttribute('aria-label', 'Muse');
  const badge = el('span', 'mu-badge');
  badge.hidden = true;
  const dockButtons = {} as Record<PanelName, HTMLButtonElement>;
  for (const [name, label] of [
    ['mailbox', 'Mailbox'],
    ['shelf', 'Shelf'],
    ['settings', 'Settings'],
  ] as const) {
    const b = button(label, 'mu-btn mu-dock-btn', () => setOpen(open === name ? null : name));
    const panel = panels[name].el;
    panel.id = `mu-${name}`;
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.append(el('p', 'mu-fail'));
    b.setAttribute('aria-controls', panel.id);
    b.setAttribute('aria-expanded', 'false');
    dockButtons[name] = b;
    dock.append(b);
  }
  dockButtons.mailbox.append(badge);

  async function refreshBadge(): Promise<void> {
    const n = Mailbox.pending(await api.invitations());
    badge.hidden = n === 0;
    badge.textContent = String(n);
    dockButtons.mailbox.setAttribute('aria-label', n ? `Mailbox, ${n} waiting` : 'Mailbox');
  }

  async function show(name: PanelName): Promise<void> {
    const panel = panels[name];
    const fail = panel.el.querySelector<HTMLElement>('.mu-fail');
    try {
      await panel.refresh();
      if (fail) fail.textContent = '';
    } catch (error) {
      if (fail) fail.textContent = `Couldn’t reach the garden (${error instanceof Error ? error.message : 'unknown error'}).`;
    }
  }

  let open: PanelName | null = null;
  function setOpen(next: PanelName | null): void {
    const prev = open;
    if (prev === next) return;
    if (next) anchors.close();
    if (prev) {
      panels[prev].el.hidden = true;
      dockButtons[prev].setAttribute('aria-expanded', 'false');
    }
    open = next;
    if (next) {
      const panel = panels[next].el;
      panel.hidden = false;
      dockButtons[next].setAttribute('aria-expanded', 'true');
      panel.focus({ preventScroll: true });
      void show(next).then(() => {
        if (open !== next || !panel.contains(document.activeElement)) return;
        (panel.querySelector<HTMLElement>('[data-card]') ?? panel.querySelector<HTMLElement>('button:not([disabled]), a[href], input'))?.focus({ preventScroll: true });
      });
    } else if (prev && panels[prev].el.contains(document.activeElement)) dockButtons[prev].focus();
  }

  // The pins come after the dock in tab order: Follow and the dock first, then the objects on the planet.
  overlay.append(status.el, visit.banner, dock, layer, ...Object.values(panels).map((p) => p.el), anchors.panel, dev.el, toast);

  // Keys typed into the overlay's fields, and arrows inside a panel, are the overlay's: the camera's
  // movement keys and main.ts's shortcuts (H, P) never see them. Esc still reaches the window.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return;
    if (typing(e.target) || (e.key.startsWith('Arrow') && e.target instanceof Element && e.target.closest('.mu-panel'))) e.stopPropagation();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!anchors.close()) setOpen(null);
    } else if (e.key.toLowerCase() === DEV_KEY && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) dev.toggle();
  });

  void refresh();
  window.setInterval(() => void refresh(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
}
