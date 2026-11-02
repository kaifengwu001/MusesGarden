import GUI from 'lil-gui';
import {
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPaddies } from './build';
import { traceContours } from './contours';
import { TerraceField } from './field';

// The paddy lab (src/dev/paddyLab.html): rice terraces on a flat canvas, from
// a clean plate. A height map from Perlin noise at several scales; cut at
// levels a step apart (each moved a little, and the cut wandering by a slow
// noise); the outlines where the cuts meet the ground; each outline offset
// uphill by its dam's thickness and the dam built along it, a riser under it;
// the tops filled level. Every parameter is on the panel; the hash keeps none.

const params = {
  seed: 23,
  size: 90,
  cell: 0.3,
  relief: 20,
  scale1: 70,
  weight1: 1,
  scale2: 32,
  weight2: 0.45,
  scale3: 15,
  weight3: 0.18,
  scale4: 7,
  weight4: 0.06,
  step: 0.5,
  jitter: 0.3,
  offset: 0.35,
  offsetScale: 14,
  minArea: 12,
  damWidth: 0.34,
  damWidthVar: 0.1,
  damScale: 7,
  damHeight: 0.2,
  damHeightVar: 0.05,
  batter: 0.3,
  outlines: false,
  wireframe: false,
};

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
const scene = new Scene();
scene.background = new Color().setRGB(0.86, 0.9, 0.92, SRGBColorSpace);
const camera = new PerspectiveCamera(38, 1, 0.05, 2000);
camera.position.set(70, 62, 82);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

scene.add(new HemisphereLight(new Color().setRGB(0.88, 0.92, 0.98, SRGBColorSpace), new Color().setRGB(0.42, 0.45, 0.32, SRGBColorSpace), 1.6));
const sun = new DirectionalLight(new Color().setRGB(1, 0.96, 0.9, SRGBColorSpace), 2.2);
sun.position.set(-40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const materials = {
  floors: new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: DoubleSide }),
  dams: new MeshStandardMaterial({ color: new Color().setRGB(0.8, 0.82, 0.64, SRGBColorSpace), roughness: 0.9, side: DoubleSide }),
  risers: new MeshStandardMaterial({ color: new Color().setRGB(0.47, 0.56, 0.34, SRGBColorSpace), roughness: 0.95, side: DoubleSide }),
  sides: new MeshStandardMaterial({ color: new Color().setRGB(0.5, 0.41, 0.31, SRGBColorSpace), roughness: 1, side: DoubleSide }),
  outlines: new LineBasicMaterial({ color: 0xc0392b }),
};
const group = new Group();
scene.add(group);
const stats: Record<string, number> = {};
// (dev: headless shots drive it, and aim at the ground through its field)
const harness = { params, rebuild, camera, controls, stats, scene, renderer, gui: null as GUI | null, field: null as TerraceField | null, ready: false };
(window as unknown as { __paddyLab: typeof harness }).__paddyLab = harness;

function rebuild(): void {
  const t0 = performance.now();
  for (const child of [...group.children]) {
    (child as Mesh).geometry.dispose();
    group.remove(child);
  }
  const half = params.size / 2;
  const field = new TerraceField({
    seed: params.seed,
    relief: params.relief,
    octaves: [
      { scale: params.scale1, weight: params.weight1 },
      { scale: params.scale2, weight: params.weight2 },
      { scale: params.scale3, weight: params.weight3 },
      { scale: params.scale4, weight: params.weight4 },
    ],
    step: params.step,
    jitter: params.jitter,
    offset: params.offset,
    offsetScale: params.offsetScale,
  });
  harness.field = field;
  const contours = traceContours(field, half, params.cell, params.minArea);
  const t1 = performance.now();
  const parts = buildPaddies(field, contours, half, {
    width: params.damWidth,
    widthVar: params.damWidthVar,
    widthScale: params.damScale,
    height: params.damHeight,
    heightVar: params.damHeightVar,
    batter: params.batter,
  });
  for (const name of ['floors', 'dams', 'risers', 'sides'] as const) {
    const mesh = new Mesh(parts[name], materials[name]);
    mesh.castShadow = name !== 'floors';
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  }
  const lines = new LineSegments(parts.outlines, materials.outlines);
  lines.visible = params.outlines;
  lines.name = 'outlines';
  group.add(lines);
  for (const m of Object.values(materials)) if ('wireframe' in m) m.wireframe = params.wireframe;
  // the sun's shadow over the whole canvas
  const s = sun.shadow.camera;
  s.left = -half * 1.2;
  s.right = half * 1.2;
  s.top = half * 1.2;
  s.bottom = -half * 1.2;
  s.near = 1;
  s.far = 300;
  s.updateProjectionMatrix();
  Object.assign(stats, parts.stats, { outlinesMs: Math.round(t1 - t0), buildMs: Math.round(performance.now() - t1) });
  info.textContent = Object.entries(stats)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

const info = document.getElementById('info') as HTMLDivElement;
const gui = new GUI({ title: 'Paddy lab' });
const later = (): void => {
  window.clearTimeout(pending);
  pending = window.setTimeout(rebuild, 120);
};
let pending = 0;
const ground = gui.addFolder('Height map');
ground.add(params, 'seed', 1, 999, 1).onFinishChange(later);
ground.add(params, 'size', 20, 200, 5).name('canvas (m)').onFinishChange(later);
ground.add(params, 'cell', 0.15, 1, 0.05).name('grid (m)').onFinishChange(later);
ground.add(params, 'relief', 1, 30, 0.5).name('relief (m)').onFinishChange(later);
for (let o = 1; o <= 4; o++) {
  ground.add(params, `scale${o}` as 'scale1', 2, 200, 1).name(`scale ${o} (m)`).onFinishChange(later);
  ground.add(params, `weight${o}` as 'weight1', 0, 1, 0.01).name(`weight ${o}`).onFinishChange(later);
}
const cut = gui.addFolder('Levels');
cut.add(params, 'step', 0.15, 2, 0.05).name('step (m)').onFinishChange(later);
cut.add(params, 'jitter', 0, 0.9, 0.05).name('jitter (× step)').onFinishChange(later);
cut.add(params, 'offset', 0, 2, 0.05).name('offset (× step)').onFinishChange(later);
cut.add(params, 'offsetScale', 2, 80, 1).name('offset scale (m)').onFinishChange(later);
cut.add(params, 'minArea', 0, 100, 1).name('smallest ring (m²)').onFinishChange(later);
const dams = gui.addFolder('Dams');
dams.add(params, 'damWidth', 0.1, 1.5, 0.01).name('thickness (m)').onFinishChange(later);
dams.add(params, 'damWidthVar', 0, 0.6, 0.01).name('± thickness (m)').onFinishChange(later);
dams.add(params, 'damScale', 1, 40, 0.5).name('noise scale (m)').onFinishChange(later);
dams.add(params, 'damHeight', 0.05, 0.6, 0.01).name('height (m)').onFinishChange(later);
dams.add(params, 'damHeightVar', 0, 0.3, 0.01).name('± height (m)').onFinishChange(later);
dams.add(params, 'batter', 0, 1, 0.05).name('riser lean').onFinishChange(later);
const view = gui.addFolder('View');
view.add(params, 'outlines').onChange((v: boolean) => {
  const l = group.getObjectByName('outlines');
  if (l) l.visible = v;
});
view.add(params, 'wireframe').onChange((v: boolean) => {
  for (const m of Object.values(materials)) if ('wireframe' in m) m.wireframe = v;
});

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
rebuild();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

harness.gui = gui;
harness.ready = true;
