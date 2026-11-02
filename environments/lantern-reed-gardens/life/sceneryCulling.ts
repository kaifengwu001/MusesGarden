import type { Sphere, BufferGeometry } from 'three';
import { warpPoint, type WarpFrame } from '../../../src/render/warp';

export interface SceneryBounds {
  readonly horizontal: number;
  readonly low: number;
  readonly high: number;
}

/** Enclose every animated vertex, including both extremes of reed sway and wing flaps. */
export function sceneryBounds(geometry: BufferGeometry): SceneryBounds {
  const position = geometry.getAttribute('position'), kind = geometry.getAttribute('aKind'), uv = geometry.getAttribute('uv');
  let horizontal = 0, low = Infinity, high = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i), material = kind.getX(i);
    const sways = material === 1 || material === 3 || (material >= 7 && material <= 9);
    const dx = sways ? y * y * 0.0025 : 0;
    const dz = material === 1 ? 0.04 * uv.getY(i) ** 2 : 0;
    const dy = material === 10 ? Math.abs(x) * 0.65 : 0;
    horizontal = Math.max(horizontal, Math.hypot(Math.abs(x) + dx, Math.abs(z) + dz));
    low = Math.min(low, y - dy); high = Math.max(high, y + dy);
  }
  return { horizontal, low, high };
}

/** Conservative sphere for the curved placement used by canyonScenery.vert.glsl. */
export function placeScenerySphere(bounds: SceneryBounds, radius: number, x: number, y: number, z: number, height: number, scale: number, out: Sphere): Sphere {
  const low = radius + height + bounds.low * scale, high = radius + height + bounds.high * scale;
  const middle = (low + high) * 0.5;
  const sin = Math.min(bounds.horizontal * scale / radius, 0.9), cos = Math.sqrt(1 - sin * sin);
  const minimum = Math.min(low, high, low * cos, high * cos), maximum = Math.max(low, high, low * cos, high * cos);
  const vertical = Math.max(Math.abs(minimum - middle), Math.abs(maximum - middle));
  const horizontal = Math.max(Math.abs(low), Math.abs(high)) * sin;
  out.center.set(x, y, z).normalize().multiplyScalar(middle);
  out.radius = Math.hypot(vertical, horizontal) * 1.00001 + 0.002;
  return out;
}

/**
 * For |delta| <= r, the quadratic warp displacement differs by at most
 * |k| (2 |tangent(center)| r + r²). This includes the full sphere, not just
 * sampled corners, even when the warp flattens or strongly curves the planet.
 */
export function warpScenerySphere(source: Sphere, warp: WarpFrame, out: Sphere): Sphere {
  const dx = source.center.x - warp.focus.x, dy = source.center.y - warp.focus.y, dz = source.center.z - warp.focus.z;
  const along = dx * warp.up.x + dy * warp.up.y + dz * warp.up.z;
  const tangent = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
  const r = source.radius;
  out.radius = r + Math.abs(warp.k) * (2 * tangent * r + r * r) + 0.01;
  warpPoint(warp, source.center, out.center);
  return out;
}
