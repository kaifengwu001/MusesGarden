import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CanyonGeometry, chalkGeometry, fernGeometry, lampPetalGeometry, mesaGeometry, pebblePatchGeometry, reedColonyGeometry } from './canyonGeometry';

const templates = [
  ...Array.from({ length: 4 }, (_, variant) => ({ name: `reed colony ${variant}`, create: () => reedColonyGeometry(variant) })),
  { name: 'mineral shelf', create: chalkGeometry },
  { name: 'garnet fern', create: fernGeometry },
  { name: 'gravel patch', create: pebblePatchGeometry },
  { name: 'mesa and canopy', create: mesaGeometry },
  { name: 'Lamp Petal', create: lampPetalGeometry },
];

describe('Lantern scenery surface integrity', () => {
  it.each(templates)('$name has no collapsed tips or coincident duplicate faces', ({ create }) => {
    const geometry = create(), positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const vertexAt = (i: number): number => index ? index.getX(i) : i;
    const faces = new Set<string>(), defects: string[] = [];
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      a.fromBufferAttribute(positions, vertexAt(i)); b.fromBufferAttribute(positions, vertexAt(i + 1)); c.fromBufferAttribute(positions, vertexAt(i + 2));
      if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() < 1e-16) defects.push(`collapsed face ${i / 3}`);
      // Ignore winding: a reversed copy of a thin leaf is still a coincident
      // plane. Double-sided shading supplies its back without extra geometry.
      const key = [a, b, c].map(p => [p.x, p.y, p.z].map(v => v.toFixed(6)).join(',')).sort().join(';');
      if (faces.has(key)) defects.push(`duplicate face ${i / 3}`);
      faces.add(key);
      for (let j = i; j < i + 3; j++) {
        const v = vertexAt(j), length = Math.hypot(normals.getX(v), normals.getY(v), normals.getZ(v));
        if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-5) defects.push(`invalid normal ${j}`);
      }
    }
    expect(defects).toEqual([]);
    geometry.dispose();
  });

  it('reuses shared corners without welding hard normals, UV seams or material boundaries', () => {
    const mesh = new CanyonGeometry();
    const a = new Vector3(0, 0, 0), b = new Vector3(1, 0, 0), c = new Vector3(1, 1, 0), d = new Vector3(0, 1, 0);
    mesh.quad(a, b, c, d, 1);
    mesh.quad(a, d, c, b, 1); // Reversed normal.
    mesh.quad(a, b, c, d, 2); // Same face, different material.
    mesh.quad(a, b, c, d, 1, 2, 2); // Different UVs; only the origin is identical.
    const geometry = mesh.build(), index = geometry.getIndex();
    expect(index).not.toBeNull();
    expect(index?.count).toBe(24);
    expect(geometry.getAttribute('position').count).toBe(15);
    const expanded = geometry.toNonIndexed();
    expect(Array.from(expanded.getAttribute('aKind').array)).toEqual([...Array<number>(12).fill(1), ...Array<number>(6).fill(2), ...Array<number>(6).fill(1)]);
    const normal = expanded.getAttribute('normal');
    expect(Array.from({ length: 24 }, (_, i) => normal.getZ(i))).toEqual([...Array<number>(6).fill(1), ...Array<number>(6).fill(-1), ...Array<number>(12).fill(1)]);
    expect(Array.from(expanded.getAttribute('uv').array.slice(36))).toEqual([0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 2]);
    geometry.dispose(); expanded.dispose();
  });
});
