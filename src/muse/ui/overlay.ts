import './muse.css';
import type { MuseDirection } from '../../life/muse';
import type { World } from '../../world';
import type { MuseId, NowView } from '../contract';
import { MuseApi } from './api';
import { Body } from './body';
import { DevTools } from './dev';
import { el, SimClock } from './dom';

/** The engine's view of Muse is read this often (ms), and again after every dev tools command. */
const REFRESH_MS = 30_000;
/** Toggles the dev tools (free: view/keys.ts and main.ts use W A S D Q E, arrows, H, M, ` and P). */
const DEV_KEY = 'b';
/** The Muse `?dev` follows when the URL names none. */
const HERO = 'hero' as MuseId;

const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Whose engine the page follows: the Muse whose garden `?garden=…/api/muses/<id>` reads, or with `?dev` alone the
 * hero. Null when the page talks to no engine (the garden's placeholders, or a garden served elsewhere).
 */
export function engineMuse(search: string): MuseId | null {
  const params = new URLSearchParams(search);
  const garden = params.get('garden');
  const id = garden ? /\/api\/muses\/([^/]+)\/?$/.exec(new URL(garden, 'http://garden').pathname)?.[1] : undefined;
  if (id) return decodeURIComponent(id) as MuseId;
  return params.has('dev') ? HERO : null;
}

/**
 * Connects the page to the Muse engine when the URL names one (engineMuse). The function returned gives the 3D Muse's
 * direction each frame from the engine's view (null until the engine has answered). `?dev` also shows the dev tools,
 * top left, under the title; B toggles them. Null when the page follows no engine.
 */
export function connectEngine(root: HTMLElement, world: World, search = location.search): ((dt: number) => MuseDirection | null) | null {
  const id = engineMuse(search);
  if (!id) return null;
  const api = new MuseApi(id);
  const clock = new SimClock();
  let view: NowView | null = null;
  const body = new Body(world, clock, () => view);
  const dev = new URLSearchParams(search).has('dev') ? mountDevTools(root, api, () => void refresh()) : null;

  // One refresh at a time; a call during one runs another after it, so a command's effect is never missed.
  let refreshing: Promise<void> | null = null;
  let again = false;
  const refresh = (): Promise<void> => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    const now = api.now().then((v) => {
      view = v;
      clock.sync(v.at);
    });
    refreshing = Promise.allSettled([now, dev?.visible ? dev.refresh() : null]).then(() => {
      refreshing = null;
      if (again) {
        again = false;
        return refresh();
      }
    });
    return refreshing;
  };

  void refresh();
  window.setInterval(() => void refresh(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  return (dt) => body.step(dt);
}

function mountDevTools(root: HTMLElement, api: MuseApi, changed: () => void): DevTools {
  const overlay = el('div', 'mu');
  const dev = new DevTools(api, changed);
  overlay.append(dev.el);
  root.append(overlay);
  // Keys typed into the dev tools' fields are theirs: the camera's movement keys and main.ts's shortcuts never see
  // them. Esc still reaches the window.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && typing(e.target)) e.stopPropagation();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === DEV_KEY && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) dev.toggle();
  });
  return dev;
}
