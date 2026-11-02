import type { Frustum, IUniform, Ray, Vector3, Vector4 } from 'three';
import type { WarpFrame } from '../../../src/render/warp';
import type { Terrain } from '../planet/terrain';
import { Muse, type MuseModel, type MuseWhere } from './muse';
import { DEFAULT_RESIDENTS, loadResidents, RESIDENT_STORAGE_KEY, residentName, ResidentLife, type ResidentIdentity, type ResidentStorage } from './residentLife';

export interface Resident extends ResidentIdentity {
  readonly muse: Muse;
  readonly where: MuseWhere;
  activity: string;
}
export interface ResidentHit { resident: Resident; side: number; distance: number }

/** Three local neighbours: identities persist, while their days are seed deterministic. */
export class Residents {
  readonly members: readonly Resident[];
  readonly ready: Promise<void>;
  private readonly lives = DEFAULT_RESIDENTS.map((_, i) => new ResidentLife(i));
  private readonly storage: ResidentStorage | undefined;
  private disposed = false;

  constructor(shared: Record<string, IUniform>, options: { storage?: ResidentStorage; model?: MuseModel } = {}) {
    try { this.storage = options.storage ?? window.localStorage; } catch { this.storage = options.storage; }
    // Companions must never overwrite the host's grass-press uniforms.
    const isolated = Object.fromEntries(Object.entries(shared).filter(([key]) => key !== 'uMusePress' && key !== 'uMusePressK'));
    this.members = loadResidents(this.storage).map((identity) => {
      const muse = new Muse(isolated, { homeProps: false });
      muse.setCoat(identity.coat);
      muse.useModel(options.model ?? 'tpose6');
      return { ...identity, muse, where: muse.where, activity: 'Settling in' };
    });
    this.ready = Promise.all(this.members.map(({ muse }) => muse.ready)).then(() => undefined);
    this.persist();
  }

  private persist(): void {
    try { this.storage?.setItem(RESIDENT_STORAGE_KEY, JSON.stringify(this.members.map(({ id, name }) => ({ id, name })))); } catch { /* A restricted/full store leaves this visit usable. */ }
  }

  rename(id: string, name: string): string | null {
    const resident = this.members.find((member) => member.id === id);
    if (!resident) return null;
    resident.name = residentName(name, resident.name);
    this.persist();
    return resident.name;
  }

  resetRoster(): void {
    this.members.forEach((resident, i) => { resident.name = DEFAULT_RESIDENTS[i].name; });
    this.persist();
  }

  update(time: number, terrain: Terrain, camera: Vector3, wind: Vector4, pixelAngle: number, show = true): void {
    if (this.disposed) return;
    this.members.forEach((resident, i) => {
      resident.muse.setLife(this.lives[i].at(time, terrain, camera));
      resident.activity = this.lives[i].activity;
      resident.muse.update(time, terrain, camera, wind, pixelAngle, show);
    });
  }

  cull(frustum: Frustum, warp: WarpFrame): void {
    this.members.forEach(({ muse }) => muse.cull(frustum, warp));
  }

  pick(ray: Ray, warp: WarpFrame): ResidentHit | null {
    let closest: ResidentHit | null = null;
    for (const resident of this.members) {
      const hit = resident.muse.pick(ray, warp);
      if (hit && (!closest || hit.distance < closest.distance)) closest = { resident, ...hit };
    }
    return closest;
  }

  private life(id: string): ResidentLife | undefined { return this.lives[this.members.findIndex((member) => member.id === id)]; }
  tap(id: string, time: number): void { this.life(id)?.tap(time); }
  hold(id: string, time: number, side: number): void { this.life(id)?.hold(time, side); }
  letGo(id: string, time: number): void { this.life(id)?.letGo(time); }
  greet(id: string, time: number): void { this.life(id)?.tap(time); }
  bloom(time: number): void { this.lives.forEach((life) => life.tap(time)); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.members.forEach(({ muse }) => muse.dispose());
  }
}
