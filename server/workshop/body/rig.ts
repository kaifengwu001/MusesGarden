// A made body rigged here in Node, as the page will rig it (rigSculpt, src/life/museMesh.ts), before Muse is shown
// it: a body that won't rig, or whose face isn't found, is never offered. As tools/workflows/muse-rig/scripts/
// probe.vitest.ts rigs the muses in clothes.
import { rigSculpt, SCULPTS, type FaceLayout, type Sculpt } from '../../../src/life/museMesh';
import { paintAt, readGlb } from './glb';

/**
 * How a made body is rigged until its own entry is measured: muse-rig's starting entry for a new muse in clothes
 * (SKILL.md, "Register it"): DRESSED_CUT(0.45), ramp 0.07, refine { body: 2, face: 2 }, no corrective, fur told
 * from cloth at ΔE 9–16, and tpose6's fit (a dressed sculpt's own is measured off it as it's rigged). It equals
 * DRESSED.muse3's entry. The page's loader rigs a gen-* look with this, merged with the overrides in its
 * /api/looks/<id>.json (written as {} by the workshop).
 */
export const GEN_SCULPT: Sculpt = {
  fit: SCULPTS.tpose6.fit,
  cut: { arm: { x: 0.45, y: [0, 1] }, body: { x: 0.2, y: [0.3, 0.68], z: [-0.2, 0.2] } },
  ramp: 0.07,
  refine: { body: 2, face: 2 },
  corrective: false,
  dress: { fur: [9, 16] },
};

export interface RigReport {
  readonly ms: number;
  /** The GLB as made: its vertices and triangles (Tripo's 5000 quads come as about 10000 triangles). */
  readonly made: { readonly vertices: number; readonly triangles: number };
  /** The rigged body. */
  readonly vertices: number;
  readonly triangles: number;
  /** Its share of cloth (0–1). */
  readonly cloth: number;
  /** How tall it stands (H; a hat or ears reach above 1). */
  readonly top: number;
  readonly face: FaceLayout;
}

export type RigCheck = (glb: Buffer) => Promise<{ readonly ok: true; readonly report: RigReport } | { readonly ok: false; readonly error: string }>;

/**
 * Rigs the GLB with `sculpt` and reports it, or says plainly why it won't do. It runs on this thread and takes a
 * few seconds for a body of 5000 quads.
 */
export function rigCheck(sculpt: Sculpt = GEN_SCULPT): RigCheck {
  return async (glb) => {
    let mesh;
    try {
      mesh = readGlb(glb);
    } catch (e) {
      return { ok: false, error: `its model couldn't be read: ${(e as Error).message}` };
    }
    const colourAt = mesh.paint ? await paintAt(mesh.paint).catch(() => undefined) : undefined;
    if (!colourAt) return { ok: false, error: 'its model carries no paint the rig can read' };
    const t0 = performance.now();
    let m;
    try {
      m = rigSculpt(mesh.position, mesh.normal, mesh.uv, mesh.index, colourAt, sculpt);
    } catch (e) {
      return { ok: false, error: `it couldn't be rigged: ${(e as Error).message}` };
    }
    const ms = Math.round(performance.now() - t0);
    if (!m.features) return { ok: false, error: "its face wasn't found when it was rigged (its eyes weren't: they may be grown into its face)" };
    const n = m.position.length / 3;
    let cloth = 0;
    let top = 0;
    for (let i = 0; i < n; i++) {
      cloth += (m.cloth?.[i] ?? 0) > 0.5 ? 1 : 0;
      top = Math.max(top, m.position[i * 3 + 1]);
    }
    return {
      ok: true,
      report: {
        ms,
        made: { vertices: mesh.position.length / 3, triangles: mesh.index.length / 3 },
        vertices: n,
        triangles: m.index.length / 3,
        cloth: n ? cloth / n : 0,
        top,
        face: m.features,
      },
    };
  };
}
