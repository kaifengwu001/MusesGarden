import { DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { CubeReadback } from './bakeReader';
import { createCellSample } from './cells';
import { gradientFrame } from './fields';
import { surveyCell } from './survey';
import fragmentShader from './terrace.frag.glsl?raw';
import { buildCellMesh } from './terraceMesh';
import vertexShader from './terrace.vert.glsl?raw';
import type { TerraceTerrain } from './terrain';

// The terraces as built objects (ARCHITECTURE.md, "Terraces built on the
// hills"): the cells round the camera surveyed (survey.ts) and built into a
// mesh each (terraceMesh.ts), standing on the hills, whose own mesh is sunk
// under them. Built again whenever the ground is baked anew (the planet's
// size, a parameter), and as the camera moves on, the cells coming into reach.

/** Cells are built out to this far from the focus (m), surveyed on the way every so far. */
export const OBJECTS = { reach: 220, probe: 8 } as const;

export class TerraceObjects {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly meshes = new Map<string, Mesh>();
  private builtFor = '';
  /** Out to here round `centre` (m) every cell is built (the ground sinks only inside it). */
  reach = 0;
  readonly centre = new Vector3(0, 1, 0);

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'terraces', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
  }

  /** Drop every mesh (the ground was baked anew). */
  clear(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes.clear();
    this.reach = 0;
    this.builtFor = '';
  }

  /** Build the cells within reach of `focus` that are not built yet (key: everything the meshes depend on). */
  update(terrain: TerraceTerrain, bakes: { terrain: CubeReadback; layout: CubeReadback }, focus: Vector3, key: string): void {
    if (key !== this.builtFor) {
      this.clear();
      this.builtFor = key;
    }
    const R = terrain.radius;
    // (moved on less than a few meters: nothing new in reach)
    if (this.reach > 0 && focus.distanceTo(this.centre) * R < 12) return;
    const size = R / terrain.cells.frequency;
    const reach = Math.min(OBJECTS.reach, 0.5 * Math.PI * R);
    const a = new Vector3();
    const b = new Vector3();
    gradientFrame(focus, a, b);
    const q = new Vector3();
    const cell = createCellSample();
    for (let x = -reach - size; x <= reach + size; x += OBJECTS.probe) {
      for (let y = -reach - size; y <= reach + size; y += OBJECTS.probe) {
        if (Math.hypot(x, y) > reach + size) continue;
        q.copy(focus).multiplyScalar(R).addScaledVector(a, x).addScaledVector(b, y).normalize();
        terrain.cells.at(q, cell);
        const id = `${cell.x},${cell.y},${cell.z}`;
        if (this.meshes.has(id)) continue;
        const survey = surveyCell(cell, R, size, bakes.terrain, bakes.layout, terrain.plots, terrain.seasonFront);
        const geometry = buildCellMesh(survey);
        const mesh = new Mesh(geometry ?? undefined, this.material);
        mesh.frustumCulled = false;
        mesh.visible = geometry !== null;
        this.meshes.set(id, mesh);
        if (geometry) this.group.add(mesh);
      }
    }
    this.centre.copy(focus);
    this.reach = reach;
  }

  get triangles(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.visible && m.geometry.index) n += m.geometry.index.count / 3;
    return n;
  }
}
