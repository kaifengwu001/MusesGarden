// Pointer gestures on the canvas, translated into intents: drag (orbit or
// glide), zoom (wheel or pinch), tap (click), hold (press and hold), and
// double-tap. No camera or world logic lives here.

export interface InputHandlers {
  drag(dx: number, dy: number): void;
  zoom(delta: number): void;
  tap(x: number, y: number): void;
  doubleTap(x: number, y: number): void;
  holdStart(x: number, y: number): void;
  holdMove(x: number, y: number): void;
  holdEnd(): void;
}

const TAP_SLOP = 6; // px
const HOLD_MS = 380;
const DOUBLE_MS = 320;

export function attachInput(el: HTMLElement, h: InputHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  let pinchDist = 0;
  let moved = false;
  let holding = false;
  let holdTimer = 0;
  let lastTapT = -1e9;
  let lastTapX = 0;
  let lastTapY = 0;

  const local = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const clearHold = (): void => {
    window.clearTimeout(holdTimer);
    if (holding) h.holdEnd();
    holding = false;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    el.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() });
    if (pointers.size === 1) {
      moved = false;
      holdTimer = window.setTimeout(() => {
        if (!moved && pointers.size === 1) {
          holding = true;
          h.holdStart(x, y);
        }
      }, HOLD_MS);
    } else {
      clearHold();
      moved = true;
      pinchDist = pinchDistance();
    }
  };

  const onMove = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = local(e);
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (pointers.size >= 2) {
      const d = pinchDistance();
      if (pinchDist > 0 && d > 0) h.zoom(Math.log(d / pinchDist) * 0.55);
      pinchDist = d;
      return;
    }
    if (holding) {
      h.holdMove(x, y);
      return;
    }
    if (!moved && Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) {
      moved = true;
      window.clearTimeout(holdTimer);
    }
    if (moved) h.drag(dx, dy);
  };

  const onUp = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      pinchDist = pinchDistance();
      return;
    }
    const wasHolding = holding;
    clearHold();
    if (moved || wasHolding || e.type === 'pointercancel') return;
    const [x, y] = local(e);
    const now = performance.now();
    if (now - lastTapT < DOUBLE_MS && Math.hypot(x - lastTapX, y - lastTapY) < 24) {
      lastTapT = -1e9;
      h.doubleTap(x, y);
      return;
    }
    lastTapT = now;
    lastTapX = x;
    lastTapY = y;
    h.tap(x, y);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // trackpad pinch arrives as ctrl+wheel with small deltas
    const scale = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.0012;
    h.zoom(-e.deltaY * scale);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
  };
}
