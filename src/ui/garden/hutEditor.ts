import { Box3, Matrix4, Object3D, Ray, Vector3 } from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Placed } from '../../life/hut';
import type { World } from '../../world';
import { button, el } from './dom';
import { ICONS } from './icons';

// A temporary editor for the hut's layout (Kai, 2026-11-01), shown in the
// cutaway when the page's address has ?edit. Tap a piece of furniture (or
// pick it from the list) and a gizmo stands on it: move it (along the room's
// walls, or up off the floor; its middle slides it over the floor), turn it
// about up, or scale it along its own width, height and depth, or all
// together. Its light, its shadow on the floor and, on the showpiece,
// the favourites' places go with it. Export puts the layout into the box
// below as text (and on the clipboard) to paste back, from which hut.ts's
// PIECES are set. Nothing is kept: a reload lays the room out again.

type Mode = 'translate' | 'rotate' | 'scale';
const MODES: ReadonlyArray<[Mode, string]> = [
  ['translate', 'Move'],
  ['rotate', 'Turn'],
  ['scale', 'Scale'],
];
/** Snapping: to 5 cm, 15° and 5 %. */
const SNAP = { move: 0.05, turn: Math.PI / 12, scale: 0.05 } as const;

export class HutEditor {
  readonly el: HTMLElement;
  private controls: TransformControls | null = null;
  private loading: Promise<void> | null = null;
  private selected: Placed | null = null;
  private mode: Mode = 'translate';
  private snap = false;
  private on = false;
  private readonly list: HTMLSelectElement;
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>();
  private readonly out: HTMLTextAreaElement;
  private readonly note: HTMLElement;
  /** Where each handle started when the editor first opened, for Reset. */
  private readonly start = new Map<Object3D, Matrix4>();
  /** Moving, the gizmo stands on this instead, square to the room's walls (the piece follows it); its height as a drag began. */
  private readonly proxy = new Object3D();
  private dragY = 0;

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly canvas: HTMLCanvasElement,
    private readonly closed: () => void,
  ) {
    this.el = el('section', 'g-editor');
    this.el.setAttribute('aria-label', 'Layout editor');
    const head = el('header', 'g-editor-head');
    head.append(el('h2', '', 'Edit the hut'), button('g-editor-close', 'Done', ICONS.close, () => this.close()));
    this.list = el('select', 'g-editor-list');
    this.list.addEventListener('change', () => this.select(this.world.hut.pieces.find((p) => p.name === this.list.value) ?? null));
    const modes = el('div', 'g-editor-modes');
    for (const [mode, label] of MODES) {
      const b = button('g-editor-mode', label, '', () => this.setMode(mode));
      b.textContent = label;
      this.modeButtons.set(mode, b);
      modes.append(b);
    }
    const snapRow = el('label', 'g-editor-snap');
    const snap = el('input');
    snap.type = 'checkbox';
    snap.addEventListener('change', () => this.setSnap(snap.checked));
    snapRow.append(snap, el('span', '', 'Snap (5 cm, 15°, 5 %)'));
    const actions = el('div', 'g-editor-actions');
    const reset = button('g-editor-action', 'Reset this piece', '', () => this.reset(false));
    reset.textContent = 'Reset piece';
    const resetAll = button('g-editor-action', 'Reset every piece', '', () => this.reset(true));
    resetAll.textContent = 'Reset all';
    const exp = button('g-editor-export', 'Export the layout', '', () => void this.export());
    exp.textContent = 'Export';
    actions.append(reset, resetAll, exp);
    this.note = el('p', 'g-editor-note', 'Tap a piece, or pick it here.');
    this.out = el('textarea', 'g-editor-out');
    this.out.readOnly = true;
    this.out.rows = 7;
    this.out.placeholder = 'Export puts the layout here (and on the clipboard) to paste back.';
    this.el.append(head, this.list, modes, snapRow, actions, this.note, this.out);
    parent.append(this.el);
    this.setMode('translate');
  }

  /** Whether the editor is open. */
  get active(): boolean {
    return this.on;
  }

  /** Whether the gizmo has the pointer (under it, or dragging): the camera and the garden leave it alone then. */
  get busy(): boolean {
    const c = this.controls;
    return this.on && c !== null && (c.dragging || c.axis !== null);
  }

  /** Open it (the room's furniture in): the list filled, the gizmo ready. */
  async open(): Promise<void> {
    await this.world.hut.load();
    this.loading ??= this.makeControls();
    await this.loading;
    const pieces = this.world.hut.pieces;
    for (const p of pieces) if (!this.start.has(p.handle)) this.start.set(p.handle, p.handle.matrix.clone());
    this.list.replaceChildren(el('option', '', 'Pick a piece…'), ...pieces.map((p) => Object.assign(el('option', '', p.name), { value: p.name })));
    this.list.value = this.selected?.name ?? 'Pick a piece…';
    this.on = true;
    this.el.classList.add('is-on');
    this.controls!.enabled = true;
    if (this.selected) this.attach();
  }

  close(): void {
    if (!this.on) return;
    this.on = false;
    this.el.classList.remove('is-on');
    if (this.controls) {
      this.controls.detach();
      this.controls.enabled = false;
    }
    this.closed();
  }

  private async makeControls(): Promise<void> {
    const { TransformControls } = await import('three/addons/controls/TransformControls.js');
    const c = new TransformControls(this.world.rig.camera, this.canvas);
    c.setSpace('local');
    c.size = 0.85;
    c.addEventListener('mouseDown', () => (this.dragY = this.proxy.position.y));
    c.addEventListener('objectChange', () => {
      const p = this.selected;
      if (p) {
        if (this.mode === 'translate') {
          // (the middle slides it over the floor; only the up arrow lifts it)
          if (c.axis === 'XYZ') this.proxy.position.y = this.dragY;
          p.handle.position.copy(this.proxy.position);
        } else {
          // turning is about up alone
          const r = p.handle.rotation;
          r.set(0, r.y, 0);
          this.proxy.position.copy(p.handle.position);
        }
      }
      this.world.hut.refresh();
      this.describe();
    });
    this.world.hut.group.add(this.proxy);
    this.world.scene.add(c.getHelper());
    this.controls = c;
    this.applyMode();
  }

  /** A tap in the cutaway while editing: the piece under it is picked (true: the editor took the tap). */
  pick(x: number, y: number, width: number, height: number): boolean {
    if (!this.on) return false;
    const w = this.world;
    const camera = w.rig.camera;
    const ray = new Ray(camera.position.clone(), new Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera).sub(camera.position).normalize());
    // into the room's frame (the homestead's, as it is drawn: the cutaway lets go of the warp)
    const toRoom = new Matrix4().copy(w.hut.group.matrixWorld).invert();
    ray.applyMatrix4(toRoom);
    let best: Placed | null = null;
    let nearest = Infinity;
    const hit = new Vector3();
    const box = new Box3();
    for (const p of w.hut.pieces) {
      box.copy(p.box).applyMatrix4(p.place.value);
      // (the rug lies flat: give it a little thickness to be hit)
      if (box.max.y - box.min.y < 0.05) box.max.y += 0.05;
      if (!ray.intersectBox(box, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      // (the rug only where nothing stands on it)
      const rank = p.piece ? d : d + 50;
      if (rank < nearest) {
        nearest = rank;
        best = p;
      }
    }
    this.select(best);
    return true;
  }

  private select(p: Placed | null): void {
    this.selected = p;
    this.list.value = p?.name ?? 'Pick a piece…';
    this.attach();
    this.describe();
  }

  /** The gizmo on the picked piece: moving, on its stand-in square to the room; turning or scaling, on the piece itself. */
  private attach(): void {
    const c = this.controls;
    const p = this.selected;
    if (!c) return;
    if (!p) {
      c.detach();
      return;
    }
    this.proxy.position.copy(p.handle.position);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.scale.set(1, 1, 1);
    c.attach(this.mode === 'translate' ? this.proxy : p.handle);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const [m, b] of this.modeButtons) b.classList.toggle('is-on', m === mode);
    this.applyMode();
  }

  private setSnap(on: boolean): void {
    this.snap = on;
    this.applyMode();
  }

  private applyMode(): void {
    const c = this.controls;
    if (!c) return;
    c.setMode(this.mode);
    this.attach();
    // turning only about up; moving and scaling along any of its axes
    const turning = this.mode === 'rotate';
    c.showX = !turning;
    c.showZ = !turning;
    c.showY = true;
    c.setTranslationSnap(this.snap ? SNAP.move : null);
    c.setRotationSnap(this.snap ? SNAP.turn : null);
    c.setScaleSnap(this.snap ? SNAP.scale : null);
  }

  private reset(all: boolean): void {
    const pieces = all ? this.world.hut.pieces : this.selected ? [this.selected] : [];
    for (const p of pieces) {
      const m = this.start.get(p.handle);
      if (!m) continue;
      m.decompose(p.handle.position, p.handle.quaternion, p.handle.scale);
    }
    this.world.hut.refresh();
    this.attach();
    this.describe();
  }

  /** The picked piece in a line: where its foot is, its turn and size. */
  private describe(): void {
    const p = this.selected;
    if (!p) {
      this.note.textContent = 'Tap a piece, or pick it here.';
      return;
    }
    const l = this.world.hut.layout().find((e) => e.name === p.name);
    if (!l) return;
    this.note.textContent = `${p.name}: at ${l.at.join(', ')} m · turned ${l.turn}° · ${l.size.join(' × ')} m`;
  }

  /** The layout as text, in the box and on the clipboard. */
  private async export(): Promise<void> {
    const rows = this.world.hut.layout().map((e) => `  ${JSON.stringify(e.name)}: ${JSON.stringify({ at: e.at, turn: e.turn, size: e.size, scale: e.scale })}`);
    const text = [
      '// Muse’s hut, as laid out in the editor: at = the foot’s middle (m: x to the right, lift off the floor, z toward the front),',
      '// turn = ° about up (0 faces the front, 90 the right end), size = width × height × depth (m), scale = from as laid out',
      '{',
      rows.join(',\n'),
      '}',
    ].join('\n');
    this.out.value = text;
    this.out.focus();
    this.out.select();
    try {
      await navigator.clipboard.writeText(text);
      this.note.textContent = 'Layout copied to the clipboard.';
    } catch {
      this.note.textContent = 'Select and copy the layout text below.';
    }
  }
}
