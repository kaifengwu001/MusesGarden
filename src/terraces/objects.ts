import { DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { BuildQueue } from '../core/buildQueue';
import type { CubeReadback } from './bakeReader';
import { createCellSample, type CellSample } from './cells';
import { gradientFrame } from './fields';
import { surveyCellJob, type SurveyMode } from './survey';
import { houseDistance, type Village } from './villages';
import fragmentShader from './terrace.frag.glsl?raw';
import { buildCellMeshJob } from './terraceMesh';
import vertexShader from './terrace.vert.glsl?raw';
import type { TerraceTerrain } from './terrain';

// The terraces as built objects (ARCHITECTURE.md, "Terraces built on the
// hills"): the cells round the camera surveyed (survey.ts) and built into a
// mesh each (terraceMesh.ts), standing on the hills, whose own mesh is sunk
// under them. Built again whenever the ground is baked anew (the planet's
// size, a parameter), and as the camera moves on, the cells coming into reach.

/** Cells are built out to this far from the focus (m), looked for every so far (m), and between, by their keys in the layout bake, every so far (m). */
export const OBJECTS = { reach: 220, probe: 8, fine: 2 } as const;

interface Pending {
  readonly id: string;
  readonly centre: Vector3;
}

export class TerraceObjects {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly meshes = new Map<string, Mesh>();
  private readonly pending = new Map<string, Pending>();
  private builtFor = '';
  /** Out to here round `centre` (m) every cell is built (the ground sinks only inside it). */
  reach = 0;
  readonly centre = new Vector3(0, 1, 0);
  private planned = 0;
  private cellSize = 64;

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'terraces', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
  }

  /** Drop every mesh and every build under way (the ground was baked anew). */
  clear(queue?: BuildQueue): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes.clear();
    for (const id of this.pending.keys()) queue?.cancel(`terraces:${id}`);
    this.pending.clear();
    this.reach = 0;
    this.planned = 0;
    this.builtFor = '';
  }

  /**
   * Queue the cells within reach of `focus` that are not built yet, nearest first, each surveyed and built
   * a few milliseconds a step (key: everything the meshes depend on); the reach the ground may sink in is
   * as far as every cell is built.
   */
  update(terrain: TerraceTerrain, bakes: { terrain: CubeReadback; layout: CubeReadback }, villages: readonly Village[], focus: Vector3, key: string, queue: BuildQueue): void {
    if (key !== this.builtFor) {
      this.clear(queue);
      this.builtFor = key;
    }
    const R = terrain.radius;
    const size = R / terrain.cells.frequency;
    this.cellSize = size;
    const reach = Math.min(OBJECTS.reach, 0.5 * Math.PI * R);
    // (moved on a few meters: look again for cells coming into reach)
    if (this.planned > 0 && focus.distanceTo(this.centre) * R < 12) {
      this.reach = this.builtReach(focus, R);
      return;
    }
    const a = new Vector3();
    const b = new Vector3();
    gradientFrame(focus, a, b);
    const q = new Vector3();
    const cell = createCellSample();
    const keys = new Set<number>();
    const add = (): void => {
      terrain.cells.at(q, cell);
      keys.add(cell.key);
      for (const mode of ['terraces', 'flats'] as const) {
        const id = `${mode}:${cell.x},${cell.y},${cell.z}`;
        if (this.meshes.has(id) || this.pending.has(id)) continue;
        const c: CellSample = { ...cell, centre: cell.centre.clone(), along: cell.along.clone(), up: cell.up.clone() };
        this.pending.set(id, { id, centre: c.centre });
        queue.add(`terraces:${id}`, Math.acos(Math.min(1, c.centre.dot(focus))) * R, this.job(id, c, R, size, bakes, terrain, mode, villages));
      }
    };
    // the cells round a grid of probes, and any the layout's keys show between them (a small one can lie between probes)
    for (const [step, fine] of [
      [OBJECTS.probe, false],
      [OBJECTS.fine, true],
    ] as const) {
      for (let x = -reach - size; x <= reach + size; x += step) {
        for (let y = -reach - size; y <= reach + size; y += step) {
          if (Math.hypot(x, y) > reach + size) continue;
          q.copy(focus).multiplyScalar(R).addScaledVector(a, x).addScaledVector(b, y).normalize();
          if (fine && keys.has(Math.floor(bakes.layout.nearest(q, 0) * 1024))) continue;
          add();
        }
      }
    }
    this.centre.copy(focus);
    this.planned = reach;
    this.reach = this.builtReach(focus, R);
  }

  private *job(id: string, cell: CellSample, R: number, size: number, bakes: { terrain: CubeReadback; layout: CubeReadback }, terrain: TerraceTerrain, mode: SurveyMode, villages: readonly Village[]): Generator<void, void, void> {
    const yard = (dir: Vector3): number => houseDistance(villages, dir, R);
    const survey = yield* surveyCellJob(cell, R, size, bakes.terrain, bakes.layout, terrain.plots, terrain.seasonFront, mode, yard);
    const geometry = yield* buildCellMeshJob(survey);
    const mesh = new Mesh(geometry ?? undefined, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10; // before the ground: early-z skips the shading of the ground sunk under them
    mesh.visible = geometry !== null;
    this.meshes.set(id, mesh);
    this.pending.delete(id);
    if (geometry) this.group.add(mesh);
  }

  /** How far round the focus every cell is built (m): short of the nearest cell still to build. */
  private builtReach(focus: Vector3, R: number): number {
    let reach = this.planned;
    for (const p of this.pending.values()) reach = Math.min(reach, Math.acos(Math.min(1, p.centre.dot(focus))) * R - 1.2 * this.cellSize);
    return Math.max(reach, 0);
  }

  get triangles(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.visible && m.geometry.index) n += m.geometry.index.count / 3;
    return n;
  }
}
