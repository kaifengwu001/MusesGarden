import GUI, { type Controller } from 'lil-gui';
import { fieldAt, fields, presets, type GroupName, type ParamPath, type ParamStore, type ParamValue, type PresetName } from '../params';

const GROUP_TITLES: Record<GroupName, string> = {
  world: 'World',
  view: 'View',
  terrain: 'Terrain',
  grass: 'Grass',
  flowers: 'Flowers',
  water: 'Water',
  wind: 'Wind',
  clouds: 'Clouds',
  muse: 'Muse',
  light: 'Light',
  style: 'Style',
  quality: 'Quality',
  ui: 'Interface',
};

export interface Panel {
  readonly gui: GUI;
  toggle(): void;
}

/**
 * The full parameter panel, generated from the schema. Controllers edit
 * proxy objects and write through the store (which clamps and broadcasts),
 * and store changes from anywhere else (URL, control bar, presets) flow back.
 */
export function createPanel(store: ParamStore): Panel {
  const gui = new GUI({ title: 'Parameters', width: 292, closeFolders: true });
  gui.domElement.classList.add('meadow-panel');

  const actions = { preset: 'Spring meadow' as PresetName, reset: () => store.reset() };
  gui
    .add(actions, 'preset', Object.keys(presets))
    .name('Preset')
    .onChange((name: PresetName) => store.applyPreset(name));
  gui.add(actions, 'reset').name('Reset to defaults');

  const proxies = new Map<GroupName, Record<string, ParamValue>>();
  const controllers = new Map<ParamPath, Controller>();
  const folders = new Map<GroupName, GUI>();

  for (const e of fields) {
    if (e.field.hidden) continue;
    let folder = folders.get(e.group);
    if (!folder) {
      folder = gui.addFolder(GROUP_TITLES[e.group]);
      folders.set(e.group, folder);
    }
    let proxy = proxies.get(e.group);
    if (!proxy) {
      proxy = {};
      proxies.set(e.group, proxy);
    }
    proxy[e.key] = store.get(e.path);
    const f = e.field;
    const controller =
      f.kind === 'number' ? folder.add(proxy, e.key, f.min, f.max, f.step) : f.kind === 'choice' ? folder.add(proxy, e.key, [...f.options]) : folder.add(proxy, e.key);
    controller.name(f.kind === 'number' && f.unit ? `${f.label} (${f.unit})` : f.label);
    controller.onChange((value: unknown) => store.set(e.path, value));
    controllers.set(e.path, controller);
  }

  store.subscribe((changed) => {
    for (const path of changed) {
      const controller = controllers.get(path);
      const proxy = proxies.get(fieldAt(path).group);
      if (!controller || !proxy) continue;
      proxy[fieldAt(path).key] = store.get(path);
      controller.updateDisplay();
    }
  });

  gui.close();
  return {
    gui,
    toggle() {
      gui.open(gui._closed);
    },
  };
}
