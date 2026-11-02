import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, type Mesh, type ShaderMaterial, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { gpuMemory } from '../../../src/core/gpuMemory';
import { Post } from '../render/post';

function recordingRenderer() {
  const targets: Array<WebGLRenderTarget | null> = [];
  const draws: Scene[] = [];
  const renderer = {
    extensions: { has: () => true },
    autoClear: true,
    setRenderTarget: (target: WebGLRenderTarget | null) => { targets.push(target); },
    compileAsync: () => Promise.resolve(),
    clear: () => undefined,
    render: (scene: Scene) => { draws.push(scene); },
  } as unknown as WebGLRenderer;
  return { renderer, targets, draws };
}

afterEach(() => {
  for (const key of ['scene target', 'cirrus compositing', 'bloom chain']) gpuMemory.delete(key);
});

describe('optional postprocessing allocations', () => {
  it('never binds or retains a bloom target while disabled, including warm-up and resize', async () => {
    const { renderer, targets, draws } = recordingRenderer();
    const post = new Post(renderer);
    post.bloomEnabled = false;
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    for (const [width, height] of [[1600, 1000], [800, 600]]) {
      post.setSize(width, height, 4);
      post.setView(width / 2, height / 2);
      await post.warm(scene, camera);
      post.render(scene, camera, 0.02);
    }
    expect(targets.every(target => target === null || target === post.target)).toBe(true);
    expect(gpuMemory.entries().has('bloom chain')).toBe(false);
    const grade = draws.at(-1)!.children[0] as Mesh;
    const uniforms = (grade.material as ShaderMaterial).uniforms;
    expect(uniforms.tBloom.value).toBeNull();
    expect(uniforms.uBloom.value).toBe(0);
    expect(post.samples).toBe(4);
  });

  it('releases an enabled chain and recreates it at the current size and render scale', () => {
    const { renderer, targets } = recordingRenderer();
    const post = new Post(renderer);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    post.setSize(1600, 1000, 4);
    post.render(scene, camera, 0.02);
    const first = [...new Set(targets.filter((target): target is WebGLRenderTarget => target !== null && target !== post.target))];
    expect(first).toHaveLength(4);
    const disposed = new Set<WebGLRenderTarget>();
    for (const level of first) level.addEventListener('dispose', () => disposed.add(level));
    post.bloomEnabled = false;
    expect(disposed.size).toBe(4);
    expect(gpuMemory.entries().has('bloom chain')).toBe(false);

    targets.length = 0;
    post.setSize(800, 600, 4);
    post.setView(400, 300);
    post.bloomEnabled = true;
    post.render(scene, camera, 0.02);
    const second = [...new Set(targets.filter((target): target is WebGLRenderTarget => target !== null && target !== post.target))];
    expect(second).toHaveLength(4);
    expect(second.every(target => !first.includes(target))).toBe(true);
    expect(second[0].width).toBe(400);
    expect(second[0].height).toBe(300);
    expect(second[0].viewport.z).toBe(200);
    expect(second[0].viewport.w).toBe(150);
    const bytes = second.reduce((sum, target) => sum + target.width * target.height * 8, 0);
    expect(gpuMemory.entries().get('bloom chain')).toBe(bytes);
    post.bloomEnabled = false;
  });
});
