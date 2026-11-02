import { describe, expect, it } from 'vitest';
import { Color, Mesh, PerspectiveCamera, Vector2, Vector3, Vector4, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { Clouds, createCloudUniforms } from '../life/clouds';
import { TerrainBake } from '../planet/bake';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

/** Record passes without a GL context: these tests exercise work scheduling. */
function recorder() {
  let target: WebGLRenderTarget | null = null;
  let alpha = 1;
  const colour = new Color(0x456789);
  const renders: Array<{ scene: Scene; target: WebGLRenderTarget | null }> = [];
  const clears: Array<WebGLRenderTarget | null> = [];
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (value: WebGLRenderTarget | null) => { target = value; },
    getClearColor: (out: Color) => out.copy(colour),
    getClearAlpha: () => alpha,
    setClearColor: (value: Color | number, a = 1) => { colour.set(value); alpha = a; },
    clear: () => { clears.push(target); },
    render: (scene: Scene) => { renders.push({ scene, target }); },
  } as unknown as WebGLRenderer;
  return { renderer, renders, clears };
}

const params: FieldParams = { roll: 1.5, hummocks: 0.25, wetlands: 0.58, waterLevel: 0, grain: 0.5, density: 0, patchiness: 0.9, patchSize: 13, weights: [0.1, 0.7, 0.1, 0.1] };

describe('inactive Lantern rendering work', () => {
  it('reuses each zero-flora cube through growth and refreshes after flowers are disabled again', () => {
    const terrain = new Terrain(generateLayout(412));
    const bake = new TerrainBake(32);
    const { renderer, renders } = recorder();
    terrain.update(128, params, 0.5);
    bake.bake(renderer, terrain.fields, 'empty-128', false);
    expect(renders).toHaveLength(12);
    terrain.update(130, params, 0.5);
    bake.bake(renderer, terrain.fields, 'empty-130', false);
    expect(renders).toHaveLength(18);
    // The full-resolution cube has its own initialization state.
    bake.bake(renderer, terrain.fields, 'empty-130', true);
    expect(renders).toHaveLength(30);
    terrain.update(130, { ...params, density: 1 }, 0.5);
    bake.bake(renderer, terrain.fields, 'flowers', false);
    expect(renders).toHaveLength(42);
    terrain.update(130, params, 0.5);
    bake.bake(renderer, terrain.fields, 'empty-again', false);
    expect(renders).toHaveLength(54);
    bake.bake(renderer, terrain.fields, 'empty-next-radius', false);
    expect(renders).toHaveLength(60);
  });

  it('keeps resident shadows in clear weather while reusing empty reflections', () => {
    const uniforms = createCloudUniforms();
    const shared = { ...uniforms, uWindVec: { value: new Vector4(1, 0, 0, 0.3) }, uResolution: { value: new Vector2(1600, 1000) } };
    const clouds = new Clouds(shared, uniforms, 16, 16, 32);
    const residentShadow = new Mesh();
    clouds.addShadowCaster(residentShadow);
    const { renderer, renders, clears } = recorder();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 132, 0);
    const up = new Vector3(0, 1, 0);
    const warp = { focus: up.clone().multiplyScalar(128), up, k: 0 };
    const weather = { coverage: 0, altitude: 12, speed: 0.2, shadow: 0.5 };
    clouds.update(renderer, 412, 128, 1, weather, up, up, camera, warp, up, 0.5);
    expect(clouds.count).toBe(0);
    expect(clouds.mesh.visible).toBe(false);
    expect(clouds.bounds()).toEqual([]);
    expect(uniforms.uCloudLook.value.z).toBe(0);
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every(pass => pass.scene.children.includes(residentShadow))).toBe(true);
    const firstPasses = renders.length;
    const firstClears = clears.length;
    clouds.update(renderer, 9999, 128, 2, weather, up, up, camera, warp, up, 0.5);
    expect(renders).toHaveLength(firstPasses * 2);
    // Six empty layer faces and one empty mirror were cleared only once.
    expect(clears.length - firstClears).toBe(firstClears - 7);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearAlpha()).toBe(1);
    expect(renderer.getClearColor(new Color()).getHex()).toBe(0x456789);
  });
});
