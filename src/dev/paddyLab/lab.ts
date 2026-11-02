import GUI from 'lil-gui';
import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLab } from './build';
import { TerraceField } from './field';

// The paddy lab (src/dev/paddyLab.html): rice terraces on a flat canvas, from
// a clean plate. A height map from Perlin noise at several scales; cut at
// levels a step apart (each level wandering on its own, so its banks offset in
// and out); the slope sorting the ground into woods, terraces and flat plots;
// the bands cut into paddies (the cuts cascading down the slope, each
// paddy's bank sitting in or out of the next and curving in to the cut); a dam
// along each bank, a riser under it, a cross-bank along each cut; the tops
// filled level. Every parameter is on the panel; the hash keeps none.

const params = {
  seed: 5,
  size: 90,
  cell: 0.3,
  relief: 36,
  scale1: 260,
  weight1: 1,
  scale2: 80,
  weight2: 0.35,
  scale3: 28,
  weight3: 0.1,
  scale4: 10,
  weight4: 0.035,
  step: 0.38,
  jitter: 0.15,
  offset: 0.35,
  offsetScale: 14,
  bank: 0.4,
  bankScale: 9,
  minArea: 12,
  steep: 0.3,
  flat: 0.06,
  cutFrom: 7,
  cutTo: 20,
  cascade: 0.75,
  drift: 0.5,
  shift: 0.45,
  blend: 1.2,
  damWidth: 0.3,
  damWidthVar: 0.08,
  damScale: 7,
  damHeight: 0.13,
  damHeightVar: 0.04,
  batter: 0.3,
  plotWidth: 9,
  plotLength: 15,
  plotAngle: 0.5,
  plotWarp: 0.25,
  treeSpacing: 2.2,
  leastWoods: 60,
  leastFlats: 400,
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
  woods: new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide }),
  dams: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }),
  risers: new MeshStandardMaterial({ color: new Color().setRGB(0.47, 0.56, 0.34, SRGBColorSpace), roughness: 0.95, side: DoubleSide }),
  sides: new MeshStandardMaterial({ color: new Color().setRGB(0.5, 0.41, 0.31, SRGBColorSpace), roughness: 1, side: DoubleSide }),
  crowns: new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
  trunks: new MeshStandardMaterial({ color: new Color().setRGB(0.36, 0.27, 0.2, SRGBColorSpace), roughness: 1 }),
  outlines: new LineBasicMaterial({ color: 0xc0392b }),
};
const crown = new IcosahedronGeometry(1, 1);
const trunk = new CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0);
const group = new Group();
scene.add(group);
const stats: Record<string, number> = {};
const info = document.getElementById('info') as HTMLDivElement;
// (dev: headless shots drive it, and aim at the ground through its field)
const harness = { params, rebuild, camera, controls, stats, scene, renderer, gui: null as GUI | null, field: null as TerraceField | null, cuts: [] as Array<{ band: number; xy: number[] }>, ready: false };
(window as unknown as { __paddyLab: typeof harness }).__paddyLab = harness;

function rebuild(): void {
  const t0 = performance.now();
  for (const child of [...group.children]) {
    if (child instanceof InstancedMesh) child.dispose();
    else if (child instanceof Mesh || child instanceof LineSegments) (child.geometry as BufferGeometry).dispose();
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
    bank: params.bank,
    bankScale: params.bankScale,
    steep: params.steep,
    flat: params.flat,
  });
  harness.field = field;
  const parts = buildLab(field, {
    half,
    cell: params.cell,
    minArea: params.minArea,
    dam: { width: params.damWidth, widthVar: params.damWidthVar, widthScale: params.damScale, height: params.damHeight, heightVar: params.damHeightVar, batter: params.batter },
    cut: { spacing: [params.cutFrom, Math.max(params.cutTo, params.cutFrom)], cascade: params.cascade, drift: params.drift, shift: params.shift, blend: params.blend },
    plot: { width: params.plotWidth, length: params.plotLength, angle: params.plotAngle, warp: params.plotWarp },
    treeSpacing: params.treeSpacing,
    leastWoods: params.leastWoods,
    leastFlats: params.leastFlats,
  });
  harness.cuts = parts.cuts;
  for (const name of ['floors', 'woods', 'dams', 'risers', 'sides'] as const) {
    const mesh = new Mesh(parts[name], materials[name]);
    mesh.castShadow = name !== 'floors' && name !== 'woods';
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  }
  // the trees: a crown on a trunk, each its own size and green
  const { trees } = parts;
  const crowns = new InstancedMesh(crown, materials.crowns, Math.max(trees.count, 1));
  const trunks = new InstancedMesh(trunk, materials.trunks, Math.max(trees.count, 1));
  crowns.count = trunks.count = trees.count;
  const mat = new Matrix4();
  const q = new Quaternion();
  const c = new Color();
  for (let i = 0; i < trees.count; i++) {
    const [x, y, z, h, r] = trees.at.slice(5 * i, 5 * i + 5);
    mat.compose(new Vector3(x, y + h - r * 0.9, z), q, new Vector3(r, r * 0.95, r));
    crowns.setMatrixAt(i, mat);
    crowns.setColorAt(i, c.setRGB(trees.tint[3 * i], trees.tint[3 * i + 1], trees.tint[3 * i + 2]));
    mat.compose(new Vector3(x, y - 0.2, z), q, new Vector3(1, h - r, 1));
    trunks.setMatrixAt(i, mat);
  }
  crowns.castShadow = trunks.castShadow = true;
  crowns.receiveShadow = true;
  group.add(crowns, trunks);
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
  Object.assign(stats, parts.stats, { buildMs: Math.round(performance.now() - t0) });
  info.textContent = Object.entries(stats)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

const gui = new GUI({ title: 'Paddy lab' });
let pending = 0;
const later = (): void => {
  window.clearTimeout(pending);
  pending = window.setTimeout(rebuild, 150);
};
const ground = gui.addFolder('Height map');
ground.add(params, 'seed', 1, 999, 1).onFinishChange(later);
ground.add(params, 'size', 20, 200, 5).name('canvas (m)').onFinishChange(later);
ground.add(params, 'cell', 0.15, 1, 0.05).name('grid (m)').onFinishChange(later);
ground.add(params, 'relief', 1, 40, 0.5).name('relief (m)').onFinishChange(later);
for (let o = 1; o <= 4; o++) {
  ground.add(params, `scale${o}` as 'scale1', 2, 200, 1).name(`scale ${o} (m)`).onFinishChange(later);
  ground.add(params, `weight${o}` as 'weight1', 0, 1, 0.01).name(`weight ${o}`).onFinishChange(later);
}
ground.close();
const levels = gui.addFolder('Levels and banks');
levels.add(params, 'step', 0.1, 2, 0.02).name('step (m)').onFinishChange(later);
levels.add(params, 'jitter', 0, 0.9, 0.05).name('jitter (× step)').onFinishChange(later);
levels.add(params, 'offset', 0, 2, 0.05).name('all wander (× step)').onFinishChange(later);
levels.add(params, 'offsetScale', 2, 80, 1).name('all wander scale (m)').onFinishChange(later);
levels.add(params, 'bank', 0, 1.2, 0.05).name('own wander (× step)').onFinishChange(later);
levels.add(params, 'bankScale', 1, 40, 0.5).name('own wander scale (m)').onFinishChange(later);
levels.add(params, 'minArea', 0, 100, 1).name('smallest ring (m²)').onFinishChange(later);
const slope = gui.addFolder('Slope decides');
slope.add(params, 'steep', 0.05, 2, 0.01).name('woods above').onFinishChange(later);
slope.add(params, 'flat', 0, 0.5, 0.005).name('plots below').onFinishChange(later);
const cuts = gui.addFolder('Cuts');
cuts.add(params, 'cutFrom', 1, 60, 0.5).name('apart from (m)').onFinishChange(later);
cuts.add(params, 'cutTo', 1, 80, 0.5).name('apart to (m)').onFinishChange(later);
cuts.add(params, 'cascade', 0, 1, 0.01).name('cascade').onFinishChange(later);
cuts.add(params, 'drift', 0, 3, 0.05).name('drift (m)').onFinishChange(later);
cuts.add(params, 'shift', 0, 0.6, 0.01).name('bank in/out (× step)').onFinishChange(later);
cuts.add(params, 'blend', 0.1, 6, 0.05).name('curve in (m)').onFinishChange(later);
const dams = gui.addFolder('Dams');
dams.add(params, 'damWidth', 0.1, 1.5, 0.01).name('thickness (m)').onFinishChange(later);
dams.add(params, 'damWidthVar', 0, 0.6, 0.01).name('± thickness (m)').onFinishChange(later);
dams.add(params, 'damScale', 1, 40, 0.5).name('noise scale (m)').onFinishChange(later);
dams.add(params, 'damHeight', 0.03, 0.6, 0.01).name('height (m)').onFinishChange(later);
dams.add(params, 'damHeightVar', 0, 0.3, 0.01).name('± height (m)').onFinishChange(later);
dams.add(params, 'batter', 0, 1, 0.05).name('riser lean').onFinishChange(later);
const flats = gui.addFolder('Plots and woods');
flats.add(params, 'plotWidth', 2, 40, 0.5).name('plot width (m)').onFinishChange(later);
flats.add(params, 'plotLength', 2, 60, 0.5).name('plot length (m)').onFinishChange(later);
flats.add(params, 'plotAngle', 0, Math.PI, 0.01).name('plot turn').onFinishChange(later);
flats.add(params, 'plotWarp', 0, 1, 0.01).name('plot warp').onFinishChange(later);
flats.add(params, 'treeSpacing', 1, 8, 0.1).name('trees apart (m)').onFinishChange(later);
flats.add(params, 'leastWoods', 0, 2000, 10).name('least woods (m²)').onFinishChange(later);
flats.add(params, 'leastFlats', 0, 5000, 10).name('least plots (m²)').onFinishChange(later);
flats.close();
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
