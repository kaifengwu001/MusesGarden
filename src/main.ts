import './ui/style.css';
import { NoToneMapping, SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { FrameClock } from './core/clock';
import { createGlobals } from './core/globals';
import { gpuMemory } from './core/gpuMemory';
import { HashSync } from './core/hashSync';
import { QualityController, detectDevice, runBenchmark, type TierChoice } from './core/quality';
import { GpuTimer } from './dev/gpuTimer';
import { installHarness } from './dev/harness';
import { measureParity } from './dev/parity';
import type { ParamPath } from './params';
import { PerfHud, createFrameStats } from './dev/hud';
import { ParamStore } from './params';
import { registerShaderChunks } from './render/glsl';
import { Post } from './render/post';
import { ControlBar } from './ui/controlBar';
import { worldLine } from './ui/format';
import { createPanel } from './ui/panel';
import { Postcard } from './ui/postcard';
import { Ui } from './ui/ui';
import { attachInput } from './view/input';
import { Keys } from './view/keys';
import { World } from './world';

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

/** Budget for background work (tile builds) per frame, ms. */
const BUILD_BUDGET_MS = 2;
/**
 * The frame's JS (update, building, render submission) aims to stay under
 * this (ms): the build queue gets what is left after the update and the
 * render (as long as the last one took), never less than BUILD_MIN_MS so
 * the meadow keeps growing in, never more than its slice.
 */
const FRAME_JS_MS = 3.6;
const BUILD_MIN_MS = 0.5;
/**
 * While a backlog of tiles waits (more than BACKLOG jobs: you zoomed in or
 * jumped), a desktop lets the frame's JS run to this and the build to its
 * larger slice, so the grass catches up about twice as fast; the GPU's share
 * of the frame is far longer, so the frame rate holds. Phones keep the
 * plain budget.
 */
const BACKLOG = 4;
const BACKLOG_FRAME_JS_MS = 5;
const BACKLOG_BUILD_BUDGET_MS = 3.6;

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const uiRoot = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !uiRoot) throw new Error('index.html is missing #scene or #ui');

  // State: parameters live in the URL hash, and so do frozen time and the camera pose.
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
  const world = new World(renderer, globals, store, quality.tier);
  if (import.meta.env.DEV) (window as unknown as { __world: World }).__world = world;
  const camera = world.rig.camera;
  const post = new Post(renderer);
  post.bloomEnabled = quality.tier.bloom;
  const gpuTimer = new GpuTimer(gl);
  const stats = createFrameStats();
  const hud = new PerfHud(uiRoot);
  const ui = new Ui(uiRoot);
  const panel = createPanel(store);
  ui.setHints([
    ['drag', 'orbit · glide'],
    ['scroll', 'down to the meadow'],
    ['W A S D', 'walk'],
    ['Q E', 'up · down'],
    ['click', 'gust · ripple'],
    ['double-click', 'glide there'],
    ['hold', 'bloom'],
  ]);

  // Camera pose in the URL; without one, frame the homestead.
  let userPosed = false;
  hash.register({
    key: 'pose',
    read: () => (userPosed ? world.rig.poseString() : null),
    write: (value) => {
      if (value && world.rig.applyPose(value)) {
        userPosed = true;
        world.markPosed();
      }
    },
  });
  if (world.needsDefaultPose) {
    world.defaultPose();
    world.rig.setZoom(store.values.view.mode === 'wander' ? 1 : 0, true);
  }

  const postcard = new Postcard(uiRoot, store);
  const controls = new ControlBar(uiRoot, store, {
    reset: () => {
      store.reset();
      userPosed = false;
      world.defaultPose();
      world.rig.setZoom(0);
    },
    reroll: () => store.set('world.seed', Math.floor(Math.random() * 10000)),
    vista: () => {
      world.cameraPreset('vista', false);
      userPosed = true;
    },
  });

  attachInput(canvas, {
    drag: (dx, dy) => {
      world.rig.drag(dx, dy, canvas.clientWidth, canvas.clientHeight);
      userPosed = true;
    },
    zoom: (delta) => {
      world.rig.zoomBy(delta);
      userPosed = true;
    },
    tap: (x, y) => {
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (!hit) return;
      if (hit.water < 0) world.ripple(hit.dir, clock.time);
      else world.gust(hit.dir, clock.time);
    },
    doubleTap: (x, y) => {
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (hit) {
        world.rig.glideTo(hit.dir);
        userPosed = true;
      }
    },
    holdStart: (x, y) => {
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (hit && hit.water >= 0) world.bloomStart(hit.dir);
    },
    holdMove: () => undefined,
    holdEnd: () => world.bloomEnd(),
  });

  const bufferSize = new Vector2();
  const resize = (): void => {
    // A hidden or collapsed host (iframe, side pane) reports 0×0; zero-size
    // render targets are incomplete framebuffers, so never go below 1×1.
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = quality.pixelRatio(window.devicePixelRatio || 1);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.getDrawingBufferSize(bufferSize);
    post.setSize(bufferSize.x, bufferSize.y, quality.samples(window.devicePixelRatio || 1));
    globals.uResolution.value.copy(bufferSize);
    gpuMemory.set('canvas', bufferSize.x * bufferSize.y * 4 * 2); // front + back buffer
  };

  const applyUi = (): void => {
    hud.visible = store.values.ui.hud;
    postcard.apply();
    ui.setWorldLine(worldLine(store.values, world.growth));
  };

  // The Overview/Wander param follows the zoom, and the toggle drives it.
  let syncingMode = false;
  // A resize clears the canvas: inside a frame it waits for the next frame's start, so the
  // resized canvas is drawn before it is shown (resized after a draw, the frame shows blank).
  let resizePending = false;
  store.subscribe((changed) => {
    if (changed.has('quality.tier')) {
      chooseTier(store.values.quality.tier);
      world.applyTier(quality.tier);
      post.bloomEnabled = quality.tier.bloom;
      resizePending = true;
    }
    if (changed.has('view.mode') && !syncingMode) world.rig.setZoom(store.values.view.mode === 'wander' ? 1 : 0);
    world.onParams(changed);
    applyUi();
  });

  const keys = new Keys();
  const update = (): void => {
    if (keys.update(world.rig, clock.realDt)) userPosed = true;
    world.update(clock, window.innerWidth / Math.max(window.innerHeight, 1), bufferSize.y);
    if (world.rig.mode !== store.values.view.mode) {
      syncingMode = true;
      store.set('view.mode', world.rig.mode);
      store.flush();
      syncingMode = false;
    }
    if (world.rig.consumeChange()) hash.schedule();
    postcard.update(world.rig.up, world.growth.radius);
  };

  const render = (): void => {
    renderer.info.reset();
    post.render(world.scene, camera, store.values.style.grain, store.values.style.contrast, store.values.style.brightness);
  };

  const collectStats = (jsMs: number): void => {
    const info = renderer.info;
    const sel = world.surface.selection;
    stats.frameMs = clock.frameMs;
    stats.jsMs = jsMs;
    stats.gpuMs = gpuTimer.ms;
    stats.drawCalls = info.render.calls;
    stats.trianglesSubmitted = info.render.triangles;
    stats.triangles = world.effectiveTriangles(info.render.triangles);
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
    stats.growth = world.growth.g;
    stats.area = world.growth.area;
    stats.radius = world.growth.radius;
    stats.grassInstances = world.grass.layer.visibleInstances;
    stats.flowerInstances = world.flowers.layer.visibleInstances;
    stats.chunks = sel.count;
    stats.lodMin = sel.minLevel;
    stats.lodMax = sel.maxLevel;
    stats.buildQueue = world.queue.size;
    stats.buildMs = world.queue.lastMs;
    stats.time = clock.time;
    stats.frozen = clock.frozen;
  };

  // the last few seconds of frames, for hitch tests (a preallocated ring)
  const LOG = 600;
  const frameLog = Array.from({ length: LOG }, () => ({ frameMs: 0, jsMs: 0, buildMs: 0 }));
  let logHead = 0;
  let logCount = 0;
  const recentFrames = (count: number): Array<{ frameMs: number; jsMs: number; buildMs: number }> => {
    const n = Math.min(count, logCount);
    return Array.from({ length: n }, (_, k) => ({ ...frameLog[(logHead - n + k + LOG) % LOG] }));
  };
  let renderMs = 1;
  let updateMs = 1;
  const frame = (now: number): void => {
    clock.tick(now);
    if (resizePending) {
      resizePending = false;
      resize();
    }
    const t0 = performance.now();
    gpuTimer.begin();
    // Finish the tiles first: the update then decides what to draw from every tile's pages as
    // they are. (Built between the update and the draw, a tile's blades moved to pages the
    // update had not marked visible, so a strip of it went missing for a frame.) The budget is
    // what the update and the render leave of the frame's JS, the update as long as the
    // slowest of the last frames' (it can jump from one frame to the next while the world grows).
    const catchUp = world.queue.size > BACKLOG && !quality.device.mobile;
    world.queue.run(Math.min(catchUp ? BACKLOG_BUILD_BUDGET_MS : BUILD_BUDGET_MS, Math.max(BUILD_MIN_MS, (catchUp ? BACKLOG_FRAME_JS_MS : FRAME_JS_MS) - updateMs - renderMs)));
    const u0 = performance.now();
    controls.tick(clock.realDt);
    update();
    updateMs = Math.max(performance.now() - u0, updateMs * 0.95);
    const r0 = performance.now();
    render();
    renderMs += (performance.now() - r0 - renderMs) * 0.25;
    gpuTimer.end();
    gpuTimer.poll();
    const jsMs = performance.now() - t0;
    if (Number.isNaN(stats.firstFrameMs)) stats.firstFrameMs = performance.now();
    collectStats(jsMs);
    const entry = frameLog[logHead];
    entry.frameMs = clock.frameMs;
    entry.jsMs = jsMs;
    entry.buildMs = world.queue.lastMs;
    logHead = (logHead + 1) % LOG;
    logCount = Math.min(logCount + 1, LOG);
    quality.locked = clock.frozen; // never change resolution under a deterministic capture
    const change = quality.observe(clock.frameMs);
    if (change === 'tier') {
      world.applyTier(quality.tier);
      post.bloomEnabled = quality.tier.bloom;
    }
    if (change) resizePending = true;
    hud.frame(stats, quality.tier.budgets, now);
  };

  // Warm every shader before the first frame, against the real render target.
  resize();
  update();
  await post.warm(world.scene, camera);

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  installHarness(
    {
      hash,
      clock,
      gl,
      stats,
      renderFrame: () => {
        const t0 = performance.now();
        update();
        render();
        collectStats(performance.now() - t0);
      },
      settle: async () => {
        store.flush();
        world.settle();
        update();
        world.settle();
        await post.warm(world.scene, camera);
      },
      set: (path, value) => {
        store.set(path as ParamPath, value);
        store.flush();
      },
      parity: () => measureParity(world, renderer),
      pick: (x, y) => {
        const hit = world.pick(x, y);
        return hit ? { dir: [hit.dir.x, hit.dir.y, hit.dir.z], water: hit.water } : null;
      },
      frameLog: recentFrames,
      preset: (name) => {
        world.cameraPreset(name);
        userPosed = true;
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
