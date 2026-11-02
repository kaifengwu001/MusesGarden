import { Vector3, type BufferGeometry } from 'three';
import { CanyonGeometry, addReedLeaf, addSeedLantern } from './canyonGeometry';

/** Stepped bluffs, slender fractured towers and low rubble have different profiles.
 * Planted caps belong to the stone, so island vegetation never floats on water. */
export function remoteRockGeometry(variant: number): BufferGeometry {
  const b = new CanyonGeometry();
  const forms = variant === 0
    ? [[0, 0, 5.8, 4.1, 5.7], [4.2, 1.4, 3.1, 2.8, 3.1], [-3.9, -1.2, 2.6, 2.3, 2.2]]
    : variant === 1
      ? [[0, 0, 2.6, 2.3, 14.5], [3.8, 0.6, 1.7, 1.8, 9.8], [-2.5, -2.7, 1.9, 1.6, 6.1]]
      : [[0, 0, 4.1, 3.0, 2.8], [3.7, -1.1, 2.5, 2.0, 1.6], [-3.6, 1.9, 2.1, 1.7, 2.0], [1.7, 3.0, 1.8, 1.4, 1.2]];
  for (const [index, [cx, cz, width, depth, height]] of forms.entries()) {
    const levels = [-2.5, height * 0.27, height * 0.62, height * 0.87, height];
    const profiles = variant === 0 ? [1.12, 1.08, 0.94, 0.98, 0.81] : variant === 1 ? [1.15, 0.98, 1.04, 0.76, 0.67] : [1.14, 1.06, 0.97, 0.89, 0.62];
    const rings = levels.map((y, j) => Array.from({ length: 9 }, (_, k) => {
      const a = k / 9 * Math.PI * 2;
      const chip = 1 + 0.13 * Math.sin(k * 3.7 + index * 2.2 + variant);
      return new Vector3(cx + Math.cos(a) * width * chip * profiles[j] + y * (variant === 1 ? 0.09 : 0.025),
        y, cz + Math.sin(a) * depth * chip * profiles[j] + Math.sin(j * 1.8 + index) * 0.16);
    }));
    const top = new Vector3(cx + height * (variant === 1 ? 0.09 : 0.025), height, cz + Math.sin(7.2 + index) * 0.16);
    for (let k = 0; k < 9; k++) {
      const next = (k + 1) % 9;
      for (let j = 0; j < 4; j++) b.quad(rings[j][k], rings[j][next], rings[j + 1][next], rings[j + 1][k], variant === 1 ? 13 : 2, width, levels[j + 1] - levels[j]);
      b.triangle(rings[4][k], rings[4][next], top, 2, [[rings[4][k].x, rings[4][k].z], [rings[4][next].x, rings[4][next].z], [top.x, top.z]]);
    }
    // Small, asymmetric mint crowns and lantern shoots soften selected caps;
    // other exposed caps retain their angular mineral silhouette.
    if (index === 0 || (variant !== 1 && index === 2)) {
      for (let shoot = 0; shoot < (variant === 0 ? 7 : variant === 1 ? 2 : 3); shoot++) {
        const a = shoot * 2.4 + index, reach = shoot === 0 ? 0 : width * 0.3;
        const root = top.clone().add(new Vector3(Math.cos(a) * reach, 0, Math.sin(a) * reach));
        const plantHeight = (variant === 1 ? 2.4 : 3.6) + (shoot % 4) * 0.55;
        const bladeLength = variant === 1 ? 2.1 : 3.1 + (shoot % 3) * 0.4;
        const tip = root.clone().add(new Vector3(0.5 * Math.cos(a), plantHeight, 0.4 * Math.sin(a)));
        b.tube([root, root.clone().lerp(tip, 0.6), tip], [0.055, 0.04, 0.022], 7, 5);
        addReedLeaf(b, root.clone().lerp(tip, 0.45), bladeLength, a, 0.7, 1);
        addReedLeaf(b, root.clone().lerp(tip, 0.65), bladeLength * 0.8, a + 2.4, 0.55, 1);
        addSeedLantern(b, tip, 0.48);
      }
    }
  }
  return b.build();
}
