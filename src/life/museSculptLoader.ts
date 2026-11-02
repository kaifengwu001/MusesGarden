import { Vector3, type BufferGeometry, type Mesh, type MeshStandardMaterial, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DressedKind, MuseMesh, SculptKind } from './museMesh';
import SculptWorker from './museSculpt.worker?worker&inline';

// The imported sculpts of Muse (src/assets/muse/: each one GLB, unrigged, its
// 2K base colour inside it), loaded and rigged on Muse's skeleton
// (museMesh.ts, in a worker), their colours read off their paint. Imported
// only when asked for, so the loader stays out of the app until then; the
// build carries the files as assets, fetched only when asked for.

/** The sculpts: the first sculpt (arms hanging, grown into the sides), and its T-poses (arms straight out). */
export const SCULPT_URLS: Record<SculptKind, string> = {
  sculpt: new URL('../assets/muse/sculpt.glb', import.meta.url).href,
  tpose: new URL('../assets/muse/sculpt-tpose.glb', import.meta.url).href,
  tpose2: new URL('../assets/muse/sculpt-tpose2.glb', import.meta.url).href,
  tpose5: new URL('../assets/muse/sculpt-tpose5.glb', import.meta.url).href,
  tpose6: new URL('../assets/muse/sculpt-tpose6.glb', import.meta.url).href,
};

/** The muses in clothes (museMesh.ts DRESSED). */
export const DRESSED_URLS: Record<DressedKind, string> = {
  muse0: new URL('../assets/muse/muses/muse0.glb', import.meta.url).href,
  muse1: new URL('../assets/muse/muses/muse1.glb', import.meta.url).href,
  muse2: new URL('../assets/muse/muses/muse2.glb', import.meta.url).href,
  muse3: new URL('../assets/muse/muses/muse3.glb', import.meta.url).href,
  muse4: new URL('../assets/muse/muses/muse4.glb', import.meta.url).href,
  muse5: new URL('../assets/muse/muses/muse5.glb', import.meta.url).href,
  muse6: new URL('../assets/muse/muses/muse6.glb', import.meta.url).href,
  muse7: new URL('../assets/muse/muses/muse7.glb', import.meta.url).href,
  muse8: new URL('../assets/muse/muses/muse8.glb', import.meta.url).href,
  muse9: new URL('../assets/muse/muses/muse9.glb', import.meta.url).href,
  muse10: new URL('../assets/muse/muses/muse10.glb', import.meta.url).href,
  muse11: new URL('../assets/muse/muses/muse11.glb', import.meta.url).href,
  muse12: new URL('../assets/muse/muses/muse12.glb', import.meta.url).href,
};

/**
 * The coat's albedo Muse is painted with (muse.frag.glsl FUR, linear): the
 * reference's cream, as the studio light of the lab returns its belly. The
 * sculpt's paint is graded so its middle fur colour lands here.
 */
const CREAM = [0.776, 0.658, 0.503] as const;

export interface Loaded {
  body: MuseMesh;
  /** A gain per channel (linear) that takes the paint's middle fur colour to the reference's cream (a dressed muse keeps its own). */
  grade: Vector3;
  /** The mesh as exported (the lab shows it as it came). */
  raw: Mesh<BufferGeometry, MeshStandardMaterial>;
  /** Its texture as made (a dressed muse's cloth is painted from it). */
  paint: Texture | null;
}

export async function loadSculpt(kind: SculptKind | DressedKind = 'sculpt'): Promise<Loaded> {
  const dressed = kind in DRESSED_URLS;
  const url = dressed ? DRESSED_URLS[kind as DressedKind] : SCULPT_URLS[kind as SculptKind];
  const gltf = await new GLTFLoader().loadAsync(url);
  let found: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  gltf.scene.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh<BufferGeometry, MeshStandardMaterial>;
  });
  const raw = found as Mesh<BufferGeometry, MeshStandardMaterial> | null;
  if (!raw) throw new Error(`${url} holds no mesh`);
  const g = raw.geometry;
  if (!g.index || !g.attributes.uv || !g.attributes.normal) throw new Error(`${url}: expected an indexed mesh with normals and texture coordinates`);
  const map = raw.material.map;
  // (the paint's pixels go with it: read at texture coordinates, glTF's, v down from the top)
  const paint = map ? pixels(map, 1024) : null;
  const job = {
    kind,
    position: Float32Array.from(g.attributes.position.array),
    normal: Float32Array.from(g.attributes.normal.array),
    uv: Float32Array.from(g.attributes.uv.array),
    index: g.index.array.slice(),
    paint: paint ? { width: paint.width, height: paint.height, data: paint.data } : null,
  };
  const body = await new Promise<MuseMesh>((resolve, reject) => {
    const worker = new SculptWorker();
    worker.onmessage = (event: MessageEvent<MuseMesh>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(`the sculpt could not be rigged: ${error.message}`));
    };
    worker.postMessage(job, [job.position.buffer, job.normal.buffer, job.uv.buffer, ...(job.paint ? [job.paint.data.buffer] : [])]);
  });
  return { body, grade: map && !dressed ? gradeFor(map) : new Vector3(1, 1, 1), raw, paint: map };
}

/** A texture's image drawn at most `size` square, read back. */
function pixels(map: Texture, size: number): ImageData {
  const image = map.image as CanvasImageSource & { width: number; height: number };
  const w = Math.min(size, image.width);
  const h = Math.min(size, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new ImageData(1, 1);
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * The grade for a sculpt's paint: the median of its fur's texels (neither
 * the dark seams nor the brightest highlights), linear, against CREAM. A
 * gain per channel keeps the paint's strands and shading, only its colour
 * moves (the source paint runs warmer and yellower than the reference).
 */
function gradeFor(map: Texture): Vector3 {
  const px = pixels(map, 512).data;
  const channels: number[][] = [[], [], []];
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    if (lum < 120 || lum > 245) continue;
    for (let c = 0; c < 3; c++) channels[c].push(px[i + c]);
  }
  if (channels[0].length < 100) return new Vector3(1, 1, 1);
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const median = channels.map((v) => linear(v.sort((a, b) => a - b)[v.length >> 1] / 255));
  return new Vector3(CREAM[0] / median[0], CREAM[1] / median[1], CREAM[2] / median[2]);
}
