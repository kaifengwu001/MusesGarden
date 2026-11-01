import { DataTexture, FloatType, NearestFilter, OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { createGroundSample } from '../planet/terrain';
import { fullscreenMesh } from '../../../src/render/fullscreen';
import { warpPoint } from '../../../src/render/warp';
import type { World } from '../world';

// CPU ↔ GPU parity, measured in the page (dev harness): the shaders and their
// CPU mirrors must agree, or picking and placement drift from what you see.
//   terrain  field-map readback vs Terrain.sample at 64 texels near the focus
//   warp     64 points pushed through warp.glsl into a float target vs warp.ts

export interface Parity {
  heightError: number;
  waterError: number;
  warpError: number;
  samples: number;
  heightAt: { cpu: number; gpu: number; water: number; h0: number } | null;
  waterAt: { cpu: number; gpu: number; height: number; h0: number } | null;
}

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? Number.NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

const WARP_FRAGMENT = /* glsl */ `
#include <meadow_warp>
uniform sampler2D uPoints;
void main() {
  vec3 p = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xyz;
  gl_FragColor = vec4(warpPosition(p), 1.0);
}`;

export function measureParity(world: World, renderer: WebGLRenderer): Parity {
  // terrain: the field map's texels against the CPU mirror
  const field = world.field;
  const size = field.ground.width;
  const buf = new Uint16Array(4);
  const u = field.uniforms;
  const c = new Vector3(u.uFieldCentre.value.x, u.uFieldCentre.value.y, u.uFieldCentre.value.z);
  const t1 = u.uFieldT1.value.clone();
  const t2 = new Vector3().crossVectors(c, t1);
  const theta = u.uFieldCentre.value.w;
  const s = createGroundSample();
  let heightError = 0;
  let heightAt: Parity['heightAt'] = null;
  let waterAt: Parity['waterAt'] = null;
  let waterError = 0;
  let n = 0;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const ix = Math.floor(size * (0.12 + 0.76 * (gx / 7)));
      const iy = Math.floor(size * (0.12 + 0.76 * (gy / 7)));
      renderer.readRenderTargetPixels(field.ground, ix, iy, 1, 1, buf);
      const x = ((ix + 0.5) / size) * 2 - 1;
      const y = ((iy + 0.5) / size) * 2 - 1;
      const r = Math.hypot(x, y);
      const a = r * theta;
      const dir = c.clone().multiplyScalar(Math.cos(a)).addScaledVector(t1.clone().multiplyScalar(x / (r || 1)).addScaledVector(t2, y / (r || 1)), Math.sin(a)).normalize();
      world.terrain.sample(dir, s);
      const nextHeightError = Math.abs(half(buf[0]) - s.height);
      if (nextHeightError > heightError) {
        heightError = nextHeightError;
        heightAt = { cpu: s.height, gpu: half(buf[0]), water: s.water, h0: world.terrain.height0(dir) };
      }
      // Shore distance becomes ill-conditioned far inland on nearly flat ground.
      // It is used for water classification and plant clearance near the bank.
      if (Math.abs(s.water) < 6 && Math.abs(half(buf[1]) - s.water) > waterError) {
        waterError = Math.abs(half(buf[1]) - s.water);
        waterAt = { cpu: s.water, gpu: half(buf[1]), height: s.height, h0: world.terrain.height0(dir) };
      }
      n++;
    }
  }

  // warp: 64 points around the focus through the GPU warp
  const pts = new Float32Array(8 * 8 * 4);
  const R = world.growth.radius;
  const focus = world.warp.focus;
  const up = world.warp.up;
  const side = new Vector3().crossVectors(up, new Vector3(0.3, 0.7, 0.2)).normalize();
  const fwd = new Vector3().crossVectors(side, up);
  const pointsCpu: Vector3[] = [];
  for (let k = 0; k < 64; k++) {
    const p = focus.clone().addScaledVector(side, ((k % 8) - 3.5) * 9).addScaledVector(fwd, (Math.floor(k / 8) - 3.5) * 9).addScaledVector(up, (k % 5) * 0.7 - 1);
    pts.set([p.x, p.y, p.z, 1], k * 4);
    pointsCpu.push(p);
  }
  const points = new DataTexture(pts, 8, 8, RGBAFormat, FloatType);
  points.minFilter = points.magFilter = NearestFilter;
  points.needsUpdate = true;
  const target = new WebGLRenderTarget(8, 8, { type: FloatType, format: RGBAFormat, depthBuffer: false });
  const material = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: WARP_FRAGMENT,
    uniforms: { ...world.shared, uPoints: { value: points } },
  });
  const scene = new Scene().add(fullscreenMesh(material));
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new OrthographicCamera());
  const out = new Float32Array(64 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 8, 8, out);
  renderer.setRenderTarget(previous);
  let warpError = 0;
  const cpu = new Vector3();
  for (let k = 0; k < 64; k++) {
    warpPoint(world.warp, pointsCpu[k], cpu);
    warpError = Math.max(warpError, Math.hypot(out[k * 4] - cpu.x, out[k * 4 + 1] - cpu.y, out[k * 4 + 2] - cpu.z));
  }
  target.dispose();
  points.dispose();
  material.dispose();
  void R;
  return { heightError, waterError, warpError, samples: n, heightAt, waterAt };
}
