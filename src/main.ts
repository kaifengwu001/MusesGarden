import './ui/style.css';
import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from 'three';
import { FrameClock } from './core/clock';
import { createGlobals } from './core/globals';
import { gpuMemory } from './core/gpuMemory';
import { HashSync } from './core/hashSync';
import { QualityController, detectDevice, runBenchmark, type TierChoice } from './core/quality';
import { GpuTimer } from './dev/gpuTimer';
import { installHarness } from './dev/harness';
import { PerfHud, createFrameStats } from './dev/hud';
import { ParamStore } from './params';
import { growthState, type GrowthState } from './planet/growth';
import { registerShaderChunks } from './render/glsl';
import { Post } from './render/post';
import { Sky } from './render/sky';
import { worldLine } from './ui/format';
import { createPanel } from './ui/panel';
import { Ui } from './ui/ui';

function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer | null {
  try {
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false, // the scene target carries MSAA where affordable
      alpha: false,
      depth: false, // the canvas only receives the fullscreen grade
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.info.autoReset = false; // counted across every pass of a frame
    renderer.debug.checkShaderErrors = import.meta.env.DEV;
    return renderer;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const uiRoot = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !uiRoot) throw new Error('index.html is missing #scene or #ui');

  // State: parameters live in the URL hash, and so does frozen time (t=12).
  const store = new ParamStore();
  const hash = new HashSync(store);
  const clock = new FrameClock();
  hash.register({
    key: 't',
    read: () => (clock.frozen ? String(Number(clock.time.toFixed(3))) : null),
    write: (value) => clock.freeze(value === null || value === '' ? null : Number(value)),
  });
  hash.start();

  const renderer = createRenderer(canvas);
  if (!renderer) {
    Ui.fallback(uiRoot, 'This world needs WebGL2, which this browser could not provide.');
    return;
  }
  const gl = renderer.getContext() as WebGL2RenderingContext;
  registerShaderChunks();

  // Quality tier: `auto` runs a short GPU benchmark once, on first need.
  const quality = new QualityController(detectDevice(gl));
  const chooseTier = (choice: TierChoice): void => {
    const needBench = choice === 'auto' && !Number.isFinite(quality.benchMs);
    quality.choose(choice, needBench ? runBenchmark(renderer) : Number.NaN);
  };
  chooseTier(store.values.quality.tier);

  const globals = createGlobals();
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 20_000);
  const sky = new Sky();
  scene.add(sky.mesh);
  const post = new Post(renderer);
  const gpuTimer = new GpuTimer(gl);
  const stats = createFrameStats();
  const hud = new PerfHud(uiRoot);
  const ui = new Ui(uiRoot);
  const panel = createPanel(store);
  ui.setHints([
    ['H', 'perf HUD'],
    ['P', 'parameters'],
  ]);

  const growth: GrowthState = { g: 0, area: 0, radius: 0 };
  const skyUp = new Vector3(0, 1, 0);
  const bufferSize = new Vector2();

  const updateGrowth = (): void => {
    const w = store.values.world;
    growthState(w.growth, w.areaMin, w.areaMax, growth);
  };

  const resize = (): void => {
    const pixelRatio = quality.pixelRatio(window.devicePixelRatio || 1);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.getDrawingBufferSize(bufferSize);
    post.setSize(bufferSize.x, bufferSize.y, quality.samples(pixelRatio));
    camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.updateProjectionMatrix();
    globals.uResolution.value.copy(bufferSize);
    gpuMemory.set('canvas', bufferSize.x * bufferSize.y * 4 * 2); // front + back buffer
  };

  const applyUi = (): void => {
    updateGrowth();
    hud.visible = store.values.ui.hud;
    ui.setWorldLine(worldLine(store.values, growth));
  };

  store.subscribe((changed) => {
    if (changed.has('quality.tier')) {
      chooseTier(store.values.quality.tier);
      resize();
    }
    applyUi();
  });

  const update = (): void => {
    updateGrowth();
    globals.uTime.value = clock.time;
    globals.uRadius.value = growth.radius;
    globals.uRadiusLag.value = growth.radius; // S1: the lagged follower that drives growth fades
    // S0: a fixed Overview framing of the planet to come; the camera rig arrives in S1.
    camera.position.set(0, 0, growth.radius * 3.4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    sky.update(camera, skyUp, 0);
  };

  const render = (): void => {
    renderer.info.reset();
    post.render(scene, camera, store.values.style.grain);
  };

  const collectStats = (jsMs: number): void => {
    const info = renderer.info;
    stats.frameMs = clock.frameMs;
    stats.jsMs = jsMs;
    stats.gpuMs = gpuTimer.ms;
    stats.drawCalls = info.render.calls;
    stats.triangles = info.render.triangles;
    stats.textures = info.memory.textures;
    stats.geometries = info.memory.geometries;
    stats.programs = info.programs?.length ?? 0;
    stats.gpuBytes = gpuMemory.total();
    stats.width = bufferSize.x;
    stats.height = bufferSize.y;
    stats.pixelRatio = renderer.getPixelRatio();
    stats.samples = post.samples;
    stats.tier = quality.tier.name;
    stats.tierChoice = quality.choice;
    stats.benchMs = quality.benchMs;
    stats.renderScale = quality.renderScale;
    stats.growth = growth.g;
    stats.area = growth.area;
    stats.radius = growth.radius;
    stats.time = clock.time;
    stats.frozen = clock.frozen;
  };

  const frame = (now: number): void => {
    clock.tick(now);
    const t0 = performance.now();
    gpuTimer.begin();
    update();
    render();
    gpuTimer.end();
    gpuTimer.poll();
    const jsMs = performance.now() - t0;
    if (Number.isNaN(stats.firstFrameMs)) stats.firstFrameMs = performance.now();
    collectStats(jsMs);
    quality.locked = clock.frozen; // never change resolution under a deterministic capture
    if (quality.observe(clock.frameMs)) resize();
    hud.frame(stats, quality.tier.budgets, now);
  };

  // Warm every shader before the first frame, against the real render target.
  resize();
  update();
  await post.warm(scene, camera);

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  installHarness(
    {
      hash,
      clock,
      gl,
      stats,
      renderFrame: () => {
        update();
        render();
      },
      settle: async () => {
        store.flush();
        await post.warm(scene, camera);
      },
    },
    ready,
  );

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (key === 'h' || key === '`') store.set('ui.hud', !store.values.ui.hud);
    else if (key === 'p') panel.toggle();
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  applyUi();
  let first = true;
  renderer.setAnimationLoop((now) => {
    frame(now);
    if (first) {
      first = false;
      markReady();
    }
  });
}

boot().catch((error: unknown) => console.error(error));
