import { Vector3 } from 'three';
import { warpNormal, warpPoint } from '../../render/warp';
import type { World } from '../../world';
import type { Dir } from '../contract';

export interface Pin {
  readonly el: HTMLElement;
  /** Where on the planet; null hides the pin. */
  dir: Dir | null;
}

interface Placed {
  readonly pin: Pin;
  shown: boolean;
  /** Ground height under `dir` at radius `r`, so a still pin samples the terrain once. */
  heightOf: Dir | null;
  r: number;
  height: number;
}

const p = new Vector3();
const n = new Vector3();
const q = new Vector3();
const toCamera = new Vector3();

/**
 * DOM pins for places on the planet, moved every frame through the CPU mirror of the shader's
 * tiny-planet warp and the camera. Its own animation frame runs after the world's (three's loop
 * asks for its frame first), so pins use the frame just drawn. Only `transform` changes per frame.
 */
export class Pins {
  private readonly placed = new Set<Placed>();
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor(
    private readonly world: World,
    readonly layer: HTMLElement,
  ) {
    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    });
    requestAnimationFrame(this.frame);
  }

  add(el: HTMLElement, dir: Dir | null): Pin {
    const pin: Pin = { el, dir };
    el.classList.add('mu-pin', 'mu-off');
    this.layer.append(el);
    this.placed.add({ pin, shown: false, heightOf: null, r: Number.NaN, height: 0 });
    return pin;
  }

  remove(pin: Pin): void {
    for (const s of this.placed) if (s.pin === pin) this.placed.delete(s);
    pin.el.remove();
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    if (this.placed.size === 0) return;
    const { world } = this;
    const r = world.growth.radius;
    const camera = world.rig.camera;
    for (const s of this.placed) {
      const dir = s.pin.dir;
      let shown = false;
      if (dir) {
        p.set(dir[0], dir[1], dir[2]);
        if (s.heightOf !== dir || s.r !== r) {
          s.height = world.terrain.height(p);
          s.heightOf = dir;
          s.r = r;
        }
        n.copy(p);
        p.multiplyScalar(r + s.height);
        warpNormal(world.warp, p, n, n);
        warpPoint(world.warp, p, q);
        // The warped ground faces the camera: not over the horizon.
        if (toCamera.subVectors(camera.position, q).dot(n) > 0) {
          q.project(camera);
          shown = q.z < 1 && Math.abs(q.x) < 1.05 && Math.abs(q.y) < 1.05;
          if (shown) s.pin.el.style.transform = `translate3d(${((q.x + 1) * 0.5 * this.width).toFixed(1)}px, ${((1 - q.y) * 0.5 * this.height).toFixed(1)}px, 0)`;
        }
      }
      if (shown !== s.shown) {
        s.shown = shown;
        s.pin.el.classList.toggle('mu-off', !shown);
      }
    }
  };
}
