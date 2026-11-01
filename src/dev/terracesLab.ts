import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The terraces lab (dev only, served at /src/dev/terracesLab.html): the
// terraces' parts one at a time, away from the planet, so each can be nailed
// against the references before they are put together. The hash picks the
// part and the view:
//   stage=models: one model alone on a turntable
//     model=mountain1…5|house1…5   src=raw (reference/terraces/models, as Kai sent them)
//     view=turn:<deg>[,<elevation deg>]|top
// window.__lab.ready turns true once the part is drawn.

const params = new URLSearchParams(location.hash.slice(1));
const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
const scene = new Scene();
scene.background = new Color('#c9d3dc');
const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, canvas);
scene.add(new HemisphereLight('#dfe8f0', '#5d6b55', 1.4));
const sun = new DirectionalLight('#fff4e0', 2.2);
sun.position.set(-0.5, 0.8, 0.6);
scene.add(sun);

const lab = { ready: false, stats: {} as Record<string, unknown> };
(window as unknown as { __lab: typeof lab }).__lab = lab;

/** Frames an object from an azimuth and elevation (deg), or from straight above. */
function frame(obj: Object3D, view: string): void {
  const box = new Box3().setFromObject(obj);
  const size = box.getSize(new Vector3());
  const mid = box.getCenter(new Vector3());
  const r = size.length() / 2;
  const d = r / Math.sin((camera.fov * Math.PI) / 360);
  if (view === 'top') {
    camera.position.set(mid.x, mid.y + d, mid.z + 1e-3);
  } else {
    const [az, el] = (view.split(':')[1] ?? '30,12').split(',').map(Number);
    const a = (az * Math.PI) / 180;
    const e = ((el ?? 12) * Math.PI) / 180;
    camera.position.set(mid.x + d * Math.cos(e) * Math.sin(a), mid.y + d * Math.sin(e), mid.z + d * Math.cos(e) * Math.cos(a));
  }
  camera.near = d / 50;
  camera.far = d * 4;
  camera.updateProjectionMatrix();
  controls.target.copy(mid);
  controls.update();
  lab.stats = { size: size.toArray().map((v) => +v.toFixed(2)) };
}

async function models(): Promise<void> {
  const name = params.get('model') ?? 'mountain2';
  const src = params.get('src') ?? 'opt';
  const url = src === 'raw' ? `/reference/terraces/models/${name}.glb` : new URL(`../assets/terraces/${name}.glb`, import.meta.url).href;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  // the optimized files hold a node per level of detail: show the one asked for
  const lod = params.get('lod') ?? '0';
  for (const child of [...gltf.scene.children]) if (/^lod\d$/.test(child.name)) child.visible = child.name === `lod${lod}`;
  scene.add(gltf.scene);
  frame(gltf.scene, params.get('view') ?? 'turn:30,12');
}

const stage = params.get('stage') ?? 'models';
if (stage === 'models') await models();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
lab.ready = true;
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
