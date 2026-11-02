import '../../src/ui/style.css';
import './ui/sequoia.css';
import { NoToneMapping, SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { BuildBudget } from '../../src/core/buildBudget';
import { FrameClock } from '../../src/core/clock';
import { createGlobals } from '../../src/core/globals';
import { gpuMemory } from '../../src/core/gpuMemory';
import { HashSync } from './core/hashSync';
import { QualityController, detectDevice, runBenchmark, type TierChoice } from '../../src/core/quality';
import { GpuTimer } from '../../src/dev/gpuTimer';
import { installHarness } from './dev/harness';
import { measureParity } from './dev/parity';
import { connectEngine } from './muse/ui/overlay';
import type { ParamPath } from './params';
import { PerfHud, createFrameStats } from './dev/hud';
import { ParamStore } from './params';
import { registerShaderChunks } from './render/glsl';
import { Post } from '../../src/render/post';
import { ControlBar } from './ui/controlBar';
import { GardenUi } from './ui/garden/gardenUi';
import { worldLine } from './ui/format';
import { createPanel } from './ui/panel';
import { Postcard } from './ui/postcard';
import { Ui } from './ui/ui';
import { attachInput } from '../../src/view/input';
import { AHEAD } from '../../src/life/scatter';
import { Keys } from '../../src/view/keys';
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

/**
 * More tiles than this waiting in the near field (you zoomed in, jumped or
 * glided; tiles built ahead of its edge do not count) is a backlog, which
 * the build queue catches up on with a larger slice of the frame, on a phone
 * too (core/buildBudget.ts).
 */
const BACKLOG = 4;

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
  // (a probe build, VITE_PROBE=1 vite build, exposes it too: timings of the production build)
  if (import.meta.env.DEV || import.meta.env.VITE_PROBE) (window as unknown as { __world: World }).__world = world;
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
    ['scroll', 'into the grove'],
    ['W A S D', 'walk'],
    ['Q E', 'up · down'],
    ['click', 'gust · ripple'],
    ['double-click', 'glide there'],
    ['P', 'parameters'],
  ]);

  const places=document.createElement('nav');
  places.className='grove-places';places.setAttribute('aria-label','Places in the grove');
  for(const [label,action] of [
    ['Shrine approach',()=>world.cameraPreset('homestead')],
    ['Ancient grove',()=>world.cameraPreset('meadow')],
    ['Wayside shrines',()=>world.cameraPreset('shrines')],
    ['Muse’s cabin',()=>world.cameraPreset('cabin')],
    ['Whole planet',()=>{world.rig.lookUp(0);world.rig.setZoom(0,true);}],
  ] as const){
    const button=document.createElement('button');button.textContent=label;
    if(label==='Wayside shrines')button.title='Visit the next shrine along the woodland route';
    button.addEventListener('click',()=>{action();world.markPosed();});places.append(button);
  }
  uiRoot.append(places);

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

  }

  const postcard = new Postcard(uiRoot, store);
  const controls = new ControlBar(uiRoot, store, {
    reset: () => {
      store.reset();
      userPosed = false;
      world.defaultPose();

    },
    reroll: () => store.set('world.seed', Math.floor(Math.random() * 10000)),
    vista: () => {
      world.cameraPreset('vista', false);
      userPosed = true;
    },
  });

  // Muse's garden over the meadow: its finds, pins, post, baskets and Muse (ui/garden). A press on Muse itself is
  // Muse's; the garden sees every other tap before the meadow does. When the URL names the Muse engine
  // (`?garden=/api/muses/<id>`, or `?dev`), the engine moves the 3D Muse; `?dev` also shows its dev tools (muse/ui).
  const useGarden=new URLSearchParams(location.search).has('garden')||new URLSearchParams(location.search).has('dev');
  const garden = useGarden ? new GardenUi(uiRoot, world, store, connectEngine(uiRoot, world)) : null;

  // a press on Muse (while it is drawn) is Muse's: a tap and it answers, a hold and it is petted; the meadow's own
  // click, double-click and hold go on everywhere else
  const onMuse = (x: number, y: number): { side: number } | null => world.pickMuse((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
  let pettingMuse = false;
  attachInput(canvas, {
    drag: (dx, dy) => {
      garden?.interrupt();
      world.rig.drag(dx, dy, canvas.clientWidth, canvas.clientHeight);
      userPosed = true;
    },
    zoom: (delta) => {
      garden?.interrupt();
      world.rig.zoomBy(delta);
      userPosed = true;
    },
    tap: (x, y) => {
      if (onMuse(x, y)) {
        world.muse.tap(clock.time);
        return;
      }
      if (garden?.tap(x, y, canvas.clientWidth, canvas.clientHeight)) {
        userPosed = true;
        return;
      }
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (!hit) return;
      if (hit.water < 0) world.ripple(hit.dir, clock.time);
      else world.gust(hit.dir, clock.time);
    },
    doubleTap: (x, y) => {
      if (onMuse(x, y)) {
        world.muse.tap(clock.time);
        return;
      }
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (hit) {
        garden?.interrupt();
        world.rig.glideTo(hit.dir);
        userPosed = true;
      }
    },
    holdStart: (x, y) => {
      const touch = onMuse(x, y);
      if (touch) {
        pettingMuse = true;
        world.muse.hold(clock.time, touch.side);
        return;
      }
      const hit = world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
      if (hit && hit.water >= 0) world.bloomStart(hit.dir);
    },
    holdMove: () => undefined,
    holdEnd: () => {
      if (pettingMuse) {
        pettingMuse = false;
        world.muse.letGo(clock.time);
        return;
      }
      world.bloomEnd();
    },
  });

  // The canvas and the targets sized with it (bufferSize), and the part of them drawn (viewSize):
  // the render scale draws a smaller part of the same targets and the grade spreads it over the
  // canvas, so a change of scale reallocates nothing and does not clear the canvas (a resize did:
  // a frame of 60 to 90 ms each time, iteration 12).
  const bufferSize = new Vector2();
  const viewSize = new Vector2(1, 1);
  const applyScale = (): void => {
    viewSize.set(Math.max(1, Math.round(bufferSize.x * quality.renderScale)), Math.max(1, Math.round(bufferSize.y * quality.renderScale)));
    post.setView(viewSize.x, viewSize.y);
    globals.uResolution.value.copy(viewSize);
  };
  const resize = (): void => {
    // A hidden or collapsed host (iframe, side pane) reports 0×0; zero-size
    // render targets are incomplete framebuffers, so never go below 1×1.
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(quality.pixelRatio(window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.getDrawingBufferSize(bufferSize);
    post.setSize(bufferSize.x, bufferSize.y, quality.samples(window.devicePixelRatio || 1));
    gpuMemory.set('canvas', bufferSize.x * bufferSize.y * 4 * 2); // front + back buffer
    applyScale();
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
  // (A change of render scale is not a resize: applyScale.)
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
    if (keys.update(world.rig, clock.realDt)) {
      userPosed = true;
      garden?.interrupt();
    }
    garden?.update(clock.realDt);
    world.update(clock, window.innerWidth / Math.max(window.innerHeight, 1), viewSize.y);
    garden?.frame(clock.realDt);
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
    stats.width = viewSize.x;
    stats.height = viewSize.y;
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
  // Tile builds run after each frame, in a task of their own: the frame is handed to the GPU first,
  // so a build overlaps the GPU's work instead of delaying it (run at the start of the frame through
  // iteration 13, it added its time to every frame the GPU held up), in the time the frame leaves
  // before the next one (core/buildBudget.ts). It finishes before the next frame's update, which
  // decides from every tile's pages which are drawn (built between the update and the draw, a tile's
  // blades moved to pages not yet marked visible and a strip of it was missing for a frame, iteration 12).
  const budget = new BuildBudget(quality.device.mobile);
  const afterFrame = new MessageChannel();
  let frameStart = 0;
  let frameJsMs = 0;
  afterFrame.port1.onmessage = () => {
    const backlog = world.queue.countBelow(AHEAD) > BACKLOG;
    budget.begin(clock.frameMs, backlog, frameJsMs + world.queue.lastMs);
    world.queue.run(budget.next(backlog, performance.now() - frameStart));
  };
  const frame = (now: number): void => {
    clock.tick(now);
    if (resizePending) {
      resizePending = false;
      resize();
    }
    frameStart = now;
    const t0 = performance.now();
    gpuTimer.begin();
    controls.tick(clock.realDt);
    update();
    render();
    gpuTimer.end();
    gpuTimer.poll();
    const jsMs = performance.now() - t0;
    frameJsMs = jsMs;
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
      resizePending = true;
    } else if (change === 'scale') applyScale();
    hud.frame(stats, quality.tier.budgets, now);
    afterFrame.port2.postMessage(null);
  };

  // Warm every shader before the first frame, against the real render target.
  resize();
  update();
  await post.warm(world.scene, camera);
  // From orbit (the default start) the near field is not drawn, so its first use waited for the
  // way down: the field map's, the clouds' mirror's and the water mask's programs linked and the
  // grass and flower instances sent to the GPU then (a frame of 60–140 ms, which also starved the
  // tile builds for about a second through iteration 13). Pay for them now: one frame drawn in
  // the meadow, then the pose's own, before anything is shown.
  if (!world.nearFieldDrawn) {
    const zoom = world.rig.zoom;
    world.rig.setZoom(1, true);
    world.update(clock, window.innerWidth / Math.max(window.innerHeight, 1), viewSize.y);
    render();
    world.rig.setZoom(zoom, true);
    update();
    render();
  }
  // and every program's first use (its uniforms looked up) now rather than at its first draw
  for (const program of renderer.info.programs ?? []) program.getUniforms();

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
        await world.muse.ready;
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
      setScale: (scale) => {
        quality.renderScale = Math.min(1, Math.max(0.5, scale));
        applyScale();
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
    else if (key === 'm') {
      // to Muse, where it is now on its day
      world.cameraPreset('muse');
      userPosed = true;
    }
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
